import { and, asc, desc, eq, or } from 'drizzle-orm';
import { GameError, applyAction, botAction, createGame, cryptoRng, sidesFor, waitingOn } from '@cardball/engine';
import type { GameEvent, GameMode, GameState, Side } from '@cardball/engine';
import type { GameAction } from '@cardball/shared';
import { chatMessages, gameEvents, games, users } from '@cardball/db';
import type { GameRow } from '@cardball/db';
import type { AuthUser } from './auth.js';
import type { Ctx } from './context.js';
import { env } from './env.js';
import { HttpError, badRequest, forbidden, notFound } from './http.js';
import { loadTeam, photoMap, teamSetupFor } from './roster.js';

/** What we keep in games.state: the engine state plus room bookkeeping. */
export interface StoredGame {
  engine: GameState | null;
  hostUserId: number;
  hostTeamId: number;
  guestUserId: number | null;
  /** engine player id → photo id, for real card art */
  photos: Record<string, number>;
  /** remote games start when both managers are ready */
  ready: Side[];
}

export type GameStatus = 'open' | 'lobby' | 'live' | 'finished';

const BOT = { userId: null, isBot: true } as const;
const MAX_BOT_ACTIONS = 500;

// One action at a time per game (single server process).
const locks = new Map<number, Promise<unknown>>();
function withLock<T>(gameId: number, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(gameId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(gameId, next.catch(() => undefined));
  return next;
}

const stored = (row: GameRow) => row.state as StoredGame;

function statusOf(s: StoredGame): GameStatus {
  return s.engine ? s.engine.phase : 'open';
}

export function canView(row: GameRow, userId: number): boolean {
  const s = stored(row);
  return s.hostUserId === userId || s.guestUserId === userId || statusOf(s) === 'open';
}

export interface GameView {
  id: number;
  mode: GameMode;
  status: GameStatus;
  regulationInnings: number;
  version: number;
  hostUserId: number;
  guestUserId: number | null;
  discordUrl: string | null;
  ready: Side[];
  photos: Record<string, number>;
  state: GameState | null;
  updatedAt: string;
}

export function toView(row: GameRow): GameView {
  const s = stored(row);
  return {
    id: row.id,
    mode: row.mode as GameMode,
    status: statusOf(s),
    regulationInnings: row.regulationInnings,
    version: row.version,
    hostUserId: s.hostUserId,
    guestUserId: s.guestUserId,
    discordUrl: row.discordInviteUrl ?? env.discordVoiceUrl,
    ready: s.ready,
    photos: s.photos,
    state: s.engine,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadRow(ctx: Ctx, gameId: number): Promise<GameRow> {
  const [row] = await ctx.db.select().from(games).where(eq(games.id, gameId)).limit(1);
  if (!row) throw notFound('Game not found');
  return row;
}

function broadcast(ctx: Ctx, row: GameRow, events: GameEvent[]): void {
  ctx.io?.to(`game:${row.id}`).emit('game:update', { game: toView(row), events });
}

/** Persist a new stored state (+ events) with an optimistic version check. */
async function save(ctx: Ctx, row: GameRow, next: StoredGame, events: GameEvent[]): Promise<GameRow> {
  const engine = next.engine;
  const [updated] = await ctx.db.transaction(async (tx) => {
    const result = await tx
      .update(games)
      .set({
        state: next,
        version: row.version + 1,
        status: statusOf(next),
        winnerSide: engine?.winner ?? null,
        homeUserId: engine ? engine.home.userId : row.homeUserId,
        awayUserId: engine ? engine.away.userId : row.awayUserId,
        updatedAt: new Date(),
      })
      .where(and(eq(games.id, row.id), eq(games.version, row.version)))
      .returning();
    if (result.length === 0) throw new HttpError(409, 'The game moved on — refresh and try again');
    if (events.length) {
      await tx.insert(gameEvents).values(
        events.map((e) => ({ gameId: row.id, seq: e.seq, inning: e.inning, half: e.half, kind: e.kind, text: e.text, data: e })),
      );
    }
    return result;
  });
  return updated!;
}

/** Let bot-managed teams take every move that's theirs. */
function runBots(state: GameState): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const rng = cryptoRng();
  for (let i = 0; i < MAX_BOT_ACTIONS; i++) {
    const waiting = waitingOn(state);
    if (!waiting) break;
    const team = waiting.side === 'home' ? state.home : state.away;
    if (!team.isBot) break;
    const action = botAction(state, waiting.side);
    if (!action) break;
    const result = applyAction(state, action, BOT, rng);
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface CreateGameInput {
  mode: GameMode;
  regulationInnings: number;
  teamId: number;
  opponentTeamId?: number | undefined;
}

export async function createNewGame(ctx: Ctx, user: AuthUser, input: CreateGameInput): Promise<GameView> {
  const host = await loadTeam(ctx, input.teamId, user.id);
  const base: StoredGame = { engine: null, hostUserId: user.id, hostTeamId: host.team.id, guestUserId: null, photos: photoMap(host.roster, 'h'), ready: [] };

  let next = base;
  let events: GameEvent[] = [];
  if (input.mode !== 'remote') {
    if (!input.opponentTeamId) throw badRequest('Pick an opponent team');
    const opp = await loadTeam(ctx, input.opponentTeamId, user.id);
    const isBot = input.mode === 'bot';
    const created = buildEngine(`${Date.now()}`, input, [
      () => teamSetupFor(host, 'h', { userId: user.id, isBot: false }),
      () => teamSetupFor(opp, 'g', { userId: isBot ? null : user.id, isBot }),
    ]);
    next = { ...base, engine: created.state, guestUserId: isBot ? null : user.id, photos: { ...base.photos, ...photoMap(opp.roster, 'g') } };
    events = created.events;
  }

  const [row] = await ctx.db
    .insert(games)
    .values({
      mode: input.mode,
      regulationInnings: input.regulationInnings,
      homeUserId: user.id,
      homeTeamId: host.team.id,
      awayTeamId: input.opponentTeamId ?? null,
      status: statusOf(next),
      state: next,
    })
    .returning();
  if (events.length) {
    await ctx.db.insert(gameEvents).values(
      events.map((e) => ({ gameId: row!.id, seq: e.seq, inning: e.inning, half: e.half, kind: e.kind, text: e.text, data: e })),
    );
  }
  return toView(row!);
}

function buildEngine(
  id: string,
  input: Pick<CreateGameInput, 'mode' | 'regulationInnings'>,
  setups: [() => ReturnType<typeof teamSetupFor>, () => ReturnType<typeof teamSetupFor>],
) {
  try {
    return createGame(
      { id, mode: input.mode, regulationInnings: input.regulationInnings, teams: [setups[0](), setups[1]()] },
      cryptoRng(),
    );
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : String(err));
  }
}

export async function joinGame(ctx: Ctx, user: AuthUser, gameId: number, teamId: number): Promise<GameView> {
  return withLock(gameId, async () => {
    const row = await loadRow(ctx, gameId);
    const s = stored(row);
    if (s.engine) throw badRequest('This game already has two teams');
    if (s.hostUserId === user.id) throw badRequest("You can't join your own game — pick hotseat mode to play yourself");

    const host = await loadTeam(ctx, s.hostTeamId);
    const guest = await loadTeam(ctx, teamId, user.id);
    const created = buildEngine(String(row.id), { mode: 'remote', regulationInnings: row.regulationInnings }, [
      () => teamSetupFor(host, 'h', { userId: s.hostUserId, isBot: false }),
      () => teamSetupFor(guest, 'g', { userId: user.id, isBot: false }),
    ]);
    const next: StoredGame = { ...s, engine: created.state, guestUserId: user.id, photos: { ...s.photos, ...photoMap(guest.roster, 'g') } };
    const saved = await save(ctx, row, next, created.events);
    await ctx.db.update(games).set({ awayTeamId: teamId }).where(eq(games.id, row.id));
    broadcast(ctx, saved, created.events);
    return toView(saved);
  });
}

export async function performAction(ctx: Ctx, user: AuthUser, gameId: number, action: GameAction): Promise<{ game: GameView; events: GameEvent[] }> {
  return withLock(gameId, async () => {
    const row = await loadRow(ctx, gameId);
    const s = stored(row);
    if (!s.engine) throw badRequest('Waiting for an opponent to join');
    const actor = { userId: user.id };

    // Remote games: both managers press "Play ball" before the first pitch.
    if (action.type === 'start-game' && row.mode === 'remote') {
      const mine = sidesFor(s.engine, actor);
      if (mine.length === 0) throw forbidden('You are not managing a team in this game');
      const ready = [...new Set([...s.ready, ...mine])];
      if (ready.length < 2) {
        const saved = await save(ctx, row, { ...s, ready }, []);
        broadcast(ctx, saved, []);
        return { game: toView(saved), events: [] };
      }
    }

    let result: { state: GameState; events: GameEvent[] };
    try {
      result = applyAction(s.engine, action, actor, cryptoRng());
      const bots = runBots(result.state);
      result = { state: bots.state, events: [...result.events, ...bots.events] };
    } catch (err) {
      if (err instanceof GameError) throw badRequest(err.message);
      throw err;
    }

    const saved = await save(ctx, row, { ...s, engine: result.state, ready: action.type === 'start-game' ? ['home', 'away'] : s.ready }, result.events);
    broadcast(ctx, saved, result.events);
    return { game: toView(saved), events: result.events };
  });
}

export async function setDiscordUrl(ctx: Ctx, user: AuthUser, gameId: number, url: string | null): Promise<GameView> {
  const row = await loadRow(ctx, gameId);
  const s = stored(row);
  if (s.hostUserId !== user.id && s.guestUserId !== user.id) throw forbidden();
  const [saved] = await ctx.db.update(games).set({ discordInviteUrl: url }).where(eq(games.id, gameId)).returning();
  broadcast(ctx, saved!, []);
  return toView(saved!);
}

export async function deleteOpenGame(ctx: Ctx, user: AuthUser, gameId: number): Promise<void> {
  const row = await loadRow(ctx, gameId);
  const s = stored(row);
  if (s.hostUserId !== user.id) throw forbidden();
  if (s.engine && s.engine.phase !== 'finished' && row.mode === 'remote') {
    throw badRequest('Concede the game instead of deleting it');
  }
  await ctx.db.delete(games).where(eq(games.id, gameId));
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getGame(ctx: Ctx, user: AuthUser, gameId: number) {
  const row = await loadRow(ctx, gameId);
  if (!canView(row, user.id)) throw forbidden('This game is private to its managers');
  const events = await ctx.db.select({ data: gameEvents.data }).from(gameEvents).where(eq(gameEvents.gameId, gameId)).orderBy(asc(gameEvents.seq));
  return { game: toView(row), events: events.map((e) => e.data as GameEvent), chat: await loadChat(ctx, gameId) };
}

export async function listGames(ctx: Ctx, user: AuthUser) {
  const rows = await ctx.db
    .select()
    .from(games)
    .where(or(eq(games.homeUserId, user.id), eq(games.awayUserId, user.id), eq(games.status, 'open')))
    .orderBy(desc(games.updatedAt))
    .limit(100);
  const names = new Map((await ctx.db.select({ id: users.id, name: users.displayName }).from(users)).map((u) => [u.id, u.name]));
  return rows
    .filter((r) => canView(r, user.id))
    .map((r) => {
      const v = toView(r);
      return {
        id: v.id,
        mode: v.mode,
        status: v.status,
        regulationInnings: v.regulationInnings,
        updatedAt: v.updatedAt,
        hostName: names.get(v.hostUserId) ?? '?',
        guestName: v.guestUserId ? (names.get(v.guestUserId) ?? '?') : null,
        isMine: v.hostUserId === user.id || v.guestUserId === user.id,
        home: v.state ? { name: v.state.home.name, score: v.state.home.score } : null,
        away: v.state ? { name: v.state.away.name, score: v.state.away.score } : null,
        inning: v.state?.inning ?? null,
        half: v.state?.half ?? null,
        winner: v.state?.winner ?? null,
      };
    });
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export interface ChatView {
  id: number;
  userId: number | null;
  name: string;
  body: string;
  createdAt: string;
}

async function loadChat(ctx: Ctx, gameId: number): Promise<ChatView[]> {
  const rows = await ctx.db
    .select({ id: chatMessages.id, userId: chatMessages.userId, name: users.displayName, body: chatMessages.body, createdAt: chatMessages.createdAt })
    .from(chatMessages)
    .leftJoin(users, eq(users.id, chatMessages.userId))
    .where(eq(chatMessages.gameId, gameId))
    .orderBy(desc(chatMessages.id))
    .limit(200);
  return rows.reverse().map((r) => ({ ...r, name: r.name ?? 'Former member', createdAt: r.createdAt.toISOString() }));
}

export async function postChat(ctx: Ctx, user: AuthUser, gameId: number, body: string): Promise<ChatView> {
  const text = body.trim().slice(0, 500);
  if (!text) throw badRequest('Say something!');
  const row = await loadRow(ctx, gameId);
  if (!canView(row, user.id)) throw forbidden();
  const [msg] = await ctx.db.insert(chatMessages).values({ gameId, userId: user.id, body: text }).returning();
  const view: ChatView = { id: msg!.id, userId: user.id, name: user.displayName, body: text, createdAt: msg!.createdAt.toISOString() };
  ctx.io?.to(`game:${gameId}`).emit('chat:message', { gameId, message: view });
  return view;
}
