import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { GameError, applyAction, botAction, botOffClockAction, createGame, cryptoRng, sidesFor, waitingOn } from '@cardball/engine';
import type { GameEvent, GameMode, GameState, Side } from '@cardball/engine';
import { activeHouseRules, MATCH_LIMITS, matchProblem, openMatch } from '@cardball/shared';
import type { ChatMessage, GameAction, GameStatus, GameView, MatchRules } from '@cardball/shared';
import { chatMessages, gameEvents, gameViewers, games, tournaments, users } from '@cardball/db';
import type { GameRow } from '@cardball/db';
import { hashPassword, verifyPassword } from './auth.js';
import type { AuthUser } from './auth.js';
import { recordCardLines } from './cardStats.js';
import type { Ctx } from './context.js';
import { recordDraftSeriesResult } from './draftService.js';
import { env } from './env.js';
import { HttpError, badRequest, forbidden, notFound } from './http.js';
import { withKeyLock } from './lock.js';
import { namesFor } from './names.js';
import { rewardAchievements, rewardGameWin } from './packs.js';
import { loadTeam, photoMap, rosterMatchCards, teamSetupFor } from './roster.js';
import type { LoadedTeam } from './roster.js';
import { stockTeamForGame } from './stockTeams.js';

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

/** A game room as the API returns it. */
export type GameRoomView = GameView<GameState>;
export type { ChatMessage, GameStatus };

const BOT = { userId: null, isBot: true } as const;
const MAX_BOT_ACTIONS = 500;

// One action at a time per game (single server process).
const locks = new Map<number, Promise<unknown>>();
function withLock<T>(gameId: number, fn: () => Promise<T>): Promise<T> {
  return withKeyLock(locks, gameId, fn);
}

const stored = (row: GameRow) => row.state as StoredGame;

function statusOf(s: StoredGame): GameStatus {
  return s.engine ? s.engine.phase : 'open';
}

const isManager = (row: GameRow, userId: number) => {
  const s = stored(row);
  return s.hostUserId === userId || s.guestUserId === userId;
};

/** Said when a password-protected game turns someone away; the room asks for the password on it. */
export const GAME_LOCKED = 'This game is password protected';

/**
 * Every game is open to anyone signed in, unless its host set a password:
 * then only the two managers and whoever has given the password get in.
 */
async function canWatch(ctx: Ctx, row: GameRow, userId: number): Promise<boolean> {
  if (!row.passwordHash || isManager(row, userId)) return true;
  const [viewer] = await ctx.db
    .select({ userId: gameViewers.userId })
    .from(gameViewers)
    .where(and(eq(gameViewers.gameId, row.id), eq(gameViewers.userId, userId)))
    .limit(1);
  return viewer !== undefined;
}

/** Check a game's password and remember that this user gave it. */
async function admit(ctx: Ctx, row: GameRow, userId: number, password: string | undefined): Promise<void> {
  if (await canWatch(ctx, row, userId)) return;
  if (!password || !(await verifyPassword(row.passwordHash!, password))) throw forbidden(password ? 'That password is not right' : GAME_LOCKED);
  await ctx.db.insert(gameViewers).values({ gameId: row.id, userId }).onConflictDoNothing();
}

export function toView(row: GameRow): GameRoomView {
  const s = stored(row);
  return {
    id: row.id,
    mode: row.mode as GameMode,
    status: statusOf(s),
    regulationInnings: row.regulationInnings,
    match: matchOf(row),
    version: row.version,
    hostUserId: s.hostUserId,
    guestUserId: s.guestUserId,
    discordUrl: row.discordInviteUrl ?? env.discordVoiceUrl,
    locked: row.passwordHash !== null,
    ready: s.ready,
    photos: s.photos,
    draftId: row.draftId,
    state: s.engine,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The match a game row is played under, defaulted for rows made before match rules. */
export function matchOf(row: GameRow): MatchRules {
  return row.matchRules ? (row.matchRules as MatchRules) : openMatch();
}

async function loadRow(ctx: Ctx, gameId: number): Promise<GameRow> {
  const [row] = await ctx.db.select().from(games).where(eq(games.id, gameId)).limit(1);
  if (!row) throw notFound('Game not found');
  return row;
}

function broadcast(ctx: Ctx, row: GameRow, events: GameEvent[]): void {
  ctx.io?.to(`game:${row.id}`).emit('game:update', { game: toView(row), events });
  ctx.io?.to('list:lobby').emit('lobby:update', { gameId: row.id });
  // A tournament catches up on its next read; nudge its open pages to read.
  if (row.tournamentId !== null && stored(row).engine?.phase === 'finished') {
    ctx.io?.to(`tournament:${row.tournamentId}`).emit('tournament:update', { tournamentId: row.tournamentId, status: 'playing' });
  }
}

/**
 * A draft owned by a tournament drives its own post-draft flow, so its games
 * pay like ordinary games. Only a standalone draft's series is special.
 */
async function isTournamentDraft(db: Ctx['db'], draftId: number): Promise<boolean> {
  const [owner] = await db.select({ id: tournaments.id }).from(tournaments).where(eq(tournaments.draftId, draftId)).limit(1);
  return owner !== undefined;
}

/** Persist a new stored state (+ events) with an optimistic version check. */
async function save(ctx: Ctx, row: GameRow, next: StoredGame, events: GameEvent[]): Promise<GameRow> {
  const engine = next.engine;
  const justFinished = engine?.phase === 'finished' && stored(row).engine?.phase !== 'finished';
  // A draft series game pays through its draft instead of the ordinary win.
  const draftGame = justFinished && row.draftId !== null && !(await isTournamentDraft(ctx.db, row.draftId));
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
    // The final save is the one moment a game becomes a win: the cards get
    // their box-score lines, and the winning manager earns a pack on the shelf.
    if (justFinished && engine) {
      await recordCardLines(tx, row.id, engine);
      // Feats pay in every mode, the draft series included.
      await rewardAchievements(tx, row.id, engine);
      if (!draftGame) await rewardGameWin(tx, { id: row.id, mode: row.mode }, engine);
    }
    return result;
  });
  // The draft's own bookkeeping runs once the game is safely saved, so a
  // hiccup there can never lose the action that ended the game. It is keyed
  // and idempotent, so a retry cannot pay the same game twice.
  if (draftGame && engine) {
    await recordDraftSeriesResult(ctx, row.draftId!, {
      gameId: row.id,
      homeScore: engine.home.score,
      awayScore: engine.away.score,
      winner: engine.winner,
    });
  }
  return updated!;
}

/** Let bot-managed teams take every move that's theirs. */
function runBots(state: GameState): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const rng = cryptoRng();
  for (let i = 0; i < MAX_BOT_ACTIONS; i++) {
    // Off the clock first: a bot manager can still visit the bullpen between
    // pitches, so a tired starter is pulled even while the other side bats.
    let offClock = false;
    for (const side of ['home', 'away'] as const) {
      const team = side === 'home' ? state.home : state.away;
      if (!team.isBot) continue;
      const change = botOffClockAction(state, side);
      if (!change) continue;
      const result = applyAction(state, change, BOT, rng);
      state = result.state;
      events.push(...result.events);
      offClock = true;
      break;
    }
    if (offClock) continue;

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
  /** a ready-made bot team from the stock catalog, instead of an owned team */
  opponentStockTeamId?: string | undefined;
  /** what cards this match allows; missing means any card, no caps */
  match?: MatchRules | undefined;
  /** when set, watching or joining takes this password */
  password?: string | undefined;
}

/**
 * The match rules as they will be stored: the host's choice, defaulted and
 * checked so a bad range is refused before a game row exists.
 */
export function resolveMatch(input: MatchRules | undefined): MatchRules {
  if (!input) return openMatch();
  if (input.yearTo < input.yearFrom) throw badRequest('The era has to end after it starts');
  if (input.yearTo - input.yearFrom > MATCH_LIMITS.maxSpan) throw badRequest(`Keep the era to ${MATCH_LIMITS.maxSpan} years or fewer`);
  return {
    yearFrom: input.yearFrom,
    yearTo: input.yearTo,
    rarityCaps: input.rarityCaps
      ? { rare: input.rarityCaps.rare, star: input.rarityCaps.star, mythic: input.rarityCaps.mythic }
      : null,
  };
}

/** Refuse a roster that breaks the match, naming the card that does it. */
function checkRoster(loaded: LoadedTeam, match: MatchRules): void {
  const problem = matchProblem(loaded.team.name, rosterMatchCards(loaded.roster), match);
  if (problem) throw badRequest(problem);
}

export async function createNewGame(ctx: Ctx, user: AuthUser, input: CreateGameInput): Promise<GameRoomView> {
  const match = resolveMatch(input.match);
  const host = await loadTeam(ctx, input.teamId, user.id);
  checkRoster(host, match);
  const base: StoredGame = { engine: null, hostUserId: user.id, hostTeamId: host.team.id, guestUserId: null, photos: photoMap(host.roster, 'h'), ready: [] };

  let next = base;
  let events: GameEvent[] = [];
  if (input.mode !== 'remote') {
    const isBot = input.mode === 'bot';
    if (input.opponentStockTeamId) {
      // A ready-made bot team: no rows of its own, cards built from the stats
      // database, and a lineup the same auto-lineup would pick.
      if (input.opponentTeamId) throw badRequest('Pick one opponent — a team of yours or a stock team, not both');
      const setup = await stockTeamForGame(ctx, input.opponentStockTeamId, match);
      const created = buildEngine(`${Date.now()}`, input, match, [() => teamSetupFor(host, 'h', { userId: user.id, isBot: false }), () => setup]);
      next = { ...base, engine: created.state, guestUserId: null };
      events = created.events;
    } else {
      if (!input.opponentTeamId) throw badRequest('Pick an opponent team');
      const opp = await loadTeam(ctx, input.opponentTeamId, user.id);
      checkRoster(opp, match);
      const created = buildEngine(`${Date.now()}`, input, match, [
        () => teamSetupFor(host, 'h', { userId: user.id, isBot: false }),
        () => teamSetupFor(opp, 'g', { userId: isBot ? null : user.id, isBot }),
      ]);
      next = { ...base, engine: created.state, guestUserId: isBot ? null : user.id, photos: { ...base.photos, ...photoMap(opp.roster, 'g') } };
      events = created.events;
    }
  }

  const [row] = await ctx.db
    .insert(games)
    .values({
      mode: input.mode,
      regulationInnings: input.regulationInnings,
      matchRules: match,
      homeUserId: user.id,
      homeTeamId: host.team.id,
      // A stock opponent has no team row, so the away seat stays empty.
      awayTeamId: input.opponentStockTeamId ? null : (input.opponentTeamId ?? null),
      status: statusOf(next),
      state: next,
      passwordHash: input.password ? await hashPassword(input.password) : null,
    })
    .returning();
  if (events.length) {
    await ctx.db.insert(gameEvents).values(
      events.map((e) => ({ gameId: row!.id, seq: e.seq, inning: e.inning, half: e.half, kind: e.kind, text: e.text, data: e })),
    );
  }
  ctx.io?.to('list:lobby').emit('lobby:update', { gameId: row!.id });
  return toView(row!);
}

function buildEngine(
  id: string,
  input: Pick<CreateGameInput, 'mode' | 'regulationInnings'>,
  match: MatchRules,
  setups: [() => ReturnType<typeof teamSetupFor>, () => ReturnType<typeof teamSetupFor>],
) {
  try {
    return createGame(
      {
        id,
        mode: input.mode,
        regulationInnings: input.regulationInnings,
        // Human-vs-human games pace the pitch roll (the batter sees the
        // pitcher's die, then rolls); a bot game resolves it at once.
        pacedPitch: input.mode !== 'bot',
        // Snapshot the commissioner's rules into this game.
        rules: activeHouseRules(),
        match,
        teams: [setups[0](), setups[1]()],
      },
      cryptoRng(),
    );
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : String(err));
  }
}

export async function joinGame(ctx: Ctx, user: AuthUser, gameId: number, teamId: number, password?: string): Promise<GameRoomView> {
  return withLock(gameId, async () => {
    const row = await loadRow(ctx, gameId);
    const s = stored(row);
    if (s.engine) throw badRequest('This game already has two teams');
    if (s.hostUserId === user.id) throw badRequest("You can't join your own game — pick hotseat mode to play yourself");
    await admit(ctx, row, user.id, password);

    const host = await loadTeam(ctx, s.hostTeamId);
    const guest = await loadTeam(ctx, teamId, user.id);
    // The guest has to bring a roster that fits the host's match.
    const match = matchOf(row);
    checkRoster(guest, match);
    const created = buildEngine(String(row.id), { mode: 'remote', regulationInnings: row.regulationInnings }, match, [
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

export async function performAction(ctx: Ctx, user: AuthUser, gameId: number, action: GameAction): Promise<{ game: GameRoomView; events: GameEvent[] }> {
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

export async function setDiscordUrl(ctx: Ctx, user: AuthUser, gameId: number, url: string | null): Promise<GameRoomView> {
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
  ctx.io?.to('list:lobby').emit('lobby:update', { gameId });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getGame(ctx: Ctx, user: AuthUser, gameId: number) {
  const row = await loadRow(ctx, gameId);
  if (!(await canWatch(ctx, row, user.id))) throw forbidden(GAME_LOCKED);
  const events = await ctx.db.select({ data: gameEvents.data }).from(gameEvents).where(eq(gameEvents.gameId, gameId)).orderBy(asc(gameEvents.seq));
  return { game: toView(row), events: events.map((e) => e.data as GameEvent), chat: await loadChat(ctx, gameId) };
}

/** Give a protected game's password; on success the room opens like any other. */
export async function unlockGame(ctx: Ctx, user: AuthUser, gameId: number, password: string) {
  const row = await loadRow(ctx, gameId);
  await admit(ctx, row, user.id, password);
  return getGame(ctx, user, gameId);
}

/** The lobby: every game in the league, newest first.
 *
 * This used to load 100 full engine states — every player card and stat line
 * in every game — just to print lobby rows. Only the fields a row shows are
 * selected now, pulled out of the state JSONB inside Postgres, so the wire
 * shape of GameListItem is unchanged while the payload stops scaling with
 * game size. */
export async function listGames(ctx: Ctx, user: AuthUser) {
  const s = games.state;
  const rows = await ctx.db
    .select({
      id: games.id,
      mode: games.mode,
      regulationInnings: games.regulationInnings,
      updatedAt: games.updatedAt,
      matchRules: games.matchRules,
      locked: sql<boolean>`${games.passwordHash} is not null`,
      hostUserId: sql<number>`(${s}->>'hostUserId')::int`,
      guestUserId: sql<number | null>`(${s}->>'guestUserId')::int`,
      status: sql<string | null>`${s}->'engine'->>'phase'`,
      homeName: sql<string | null>`${s}->'engine'->'home'->>'name'`,
      homeScore: sql<number | null>`(${s}->'engine'->'home'->>'score')::int`,
      awayName: sql<string | null>`${s}->'engine'->'away'->>'name'`,
      awayScore: sql<number | null>`(${s}->'engine'->'away'->>'score')::int`,
      inning: sql<number | null>`(${s}->'engine'->>'inning')::int`,
      half: sql<string | null>`${s}->'engine'->>'half'`,
      winner: sql<string | null>`${s}->'engine'->>'winner'`,
    })
    .from(games)
    .orderBy(desc(games.updatedAt))
    .limit(100);
  // Names for exactly the managers with a game on the board — not the whole league.
  const names = await namesFor(ctx, rows.flatMap((r) => [r.hostUserId, r.guestUserId]));
  return rows.map((r) => ({
    id: r.id,
    mode: r.mode as GameMode,
    status: (r.status ?? 'open') as GameStatus,
    regulationInnings: r.regulationInnings,
    match: (r.matchRules ? (r.matchRules as MatchRules) : openMatch()) satisfies MatchRules,
    updatedAt: r.updatedAt.toISOString(),
    hostName: names.get(r.hostUserId) ?? '?',
    guestName: r.guestUserId ? (names.get(r.guestUserId) ?? '?') : null,
    isMine: r.hostUserId === user.id || r.guestUserId === user.id,
    locked: r.locked,
    home: r.homeName !== null ? { name: r.homeName, score: r.homeScore ?? 0 } : null,
    away: r.awayName !== null ? { name: r.awayName, score: r.awayScore ?? 0 } : null,
    inning: r.inning ?? null,
    half: (r.half ?? null) as 'top' | 'bottom' | null,
    winner: (r.winner ?? null) as 'home' | 'away' | null,
  }));
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

async function loadChat(ctx: Ctx, gameId: number): Promise<ChatMessage[]> {
  const rows = await ctx.db
    .select({ id: chatMessages.id, userId: chatMessages.userId, name: users.displayName, body: chatMessages.body, createdAt: chatMessages.createdAt })
    .from(chatMessages)
    .leftJoin(users, eq(users.id, chatMessages.userId))
    .where(eq(chatMessages.gameId, gameId))
    .orderBy(desc(chatMessages.id))
    .limit(200);
  return rows.reverse().map((r) => ({ ...r, name: r.name ?? 'Former member', createdAt: r.createdAt.toISOString() }));
}

export async function postChat(ctx: Ctx, user: AuthUser, gameId: number, body: string): Promise<ChatMessage> {
  const text = body.trim().slice(0, 500);
  if (!text) throw badRequest('Say something!');
  const row = await loadRow(ctx, gameId);
  if (!(await canWatch(ctx, row, user.id))) throw forbidden();
  const [msg] = await ctx.db.insert(chatMessages).values({ gameId, userId: user.id, body: text }).returning();
  const view: ChatMessage = { id: msg!.id, userId: user.id, name: user.displayName, body: text, createdAt: msg!.createdAt.toISOString() };
  ctx.io?.to(`game:${gameId}`).emit('chat:message', { gameId, message: view });
  return view;
}
