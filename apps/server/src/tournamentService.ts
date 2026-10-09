/**
 * Tournaments.
 *
 * A tournament owns a draft room. Three or four managers take seats, the host
 * deals, and when the last pack is empty each manager's picks become their
 * tournament team — a team built from exactly those cards and nothing else, so
 * a tournament is won with what you drafted.
 *
 * From there the tournament schedules itself: a round robin, or semifinals
 * with a final and a third place game. Each match is an ordinary game room,
 * so managers play it live on the same mat as any other game; turn on
 * auto-simulate and the server plays each match out with the bot policy the
 * moment it is scheduled.
 *
 * Everything that depends on something else finishing happens in `sync`,
 * which runs on every read and every command, so the tournament catches up
 * with its draft and its games without any cross-service hooks.
 */

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  DRAFT_LIMITS,
  TOURNAMENT_LIMITS,
  activeHouseRules,
  championSeat,
  formatLabel,
  packTheme,
  packThemesForYears,
  resolveMatchRules,
  scheduleMatches,
  slotSeat,
  standingsFrom,
  tournamentEraLabel,
} from '@cardball/shared';
import type {
  DraftCard,
  MatchRules,
  MatchScore,
  MatchSlot,
  Position,
  PackThemeId,
  TournamentConfig,
  TournamentFormat,
  TournamentListItem,
  TournamentMatch,
  TournamentSeatView,
  TournamentView,
} from '@cardball/shared';
import { autoPlay, createGame, cryptoRng } from '@cardball/engine';
import type { TeamSetup } from '@cardball/engine';
import { cardModels, draftParticipants, drafts, gameEvents, games, teamCards, teams, tournaments, userCards } from '@cardball/db';
import type { TournamentRow } from '@cardball/db';
import type { StoredGame } from './gameService.js';
import { toView as gameView } from './gameService.js';
import { recordCardLines } from './cardStats.js';
import { autoLineup } from './autoLineup.js';
import type { AuthUser } from './auth.js';
import type { Ctx } from './context.js';
import { withKeyLock } from './lock.js';
import { namesFor } from './names.js';
import { createDraft, joinDraft, startDraft } from './draftService.js';
import type { CreateDraftInput } from './draftService.js';
import { rewardTournamentWin } from './packs.js';
import { badRequest, forbidden, notFound } from './http.js';
import { loadTeam, photoMap, rosterCards, teamSetupFor } from './roster.js';

/** The per-tournament state kept in `tournaments.state`. */
interface TournamentState {
  draftId: number | null;
  /**
   * Seats, carried only by a rematch: the unique index on `tournaments.draft_id`
   * lets one row own a draft room, so a rematch row keeps its seats here and
   * reuses the teams the original draft built.
   */
  seats?: { userId: number; seat: number }[];
  /** seat → the team built from that manager's draft picks */
  teams: Record<string, number>;
  matches: TournamentMatch[];
  championSeat: number | null;
  log: { seq: number; text: string }[];
}

const stored = (row: TournamentRow) => row.state as TournamentState;
const configOf = (row: TournamentRow) => row.config as TournamentConfig;

// Commands on one tournament run one at a time, so a double-clicked start
// can't deal two drafts.
const locks = new Map<number, Promise<unknown>>();
function withLock<T>(tournamentId: number, fn: () => Promise<T>): Promise<T> {
  return withKeyLock(locks, tournamentId, fn);
}

// ---------------------------------------------------------------------------
// Queries the service keeps re-running
// ---------------------------------------------------------------------------

async function loadRow(ctx: Ctx, tournamentId: number): Promise<TournamentRow> {
  const [row] = await ctx.db.select().from(tournaments).where(eq(tournaments.id, tournamentId)).limit(1);
  if (!row) throw notFound('Tournament not found');
  return row;
}

/** Display names for exactly the people seated in this tournament. */
function seatedNames(ctx: Ctx, seats: { userId: number }[], hostUserId: number): Promise<Map<number, string>> {
  return namesFor(ctx, [hostUserId, ...seats.map((s) => s.userId)]);
}

/** The seated managers, in seat order: seats are the draft room's seats. */
async function seatRows(ctx: Ctx, state: TournamentState): Promise<{ userId: number; seat: number }[]> {
  // A rematch row has no draft of its own; its seats came along in its state.
  if (state.draftId === null) return state.seats ?? [];
  return ctx.db
    .select({ userId: draftParticipants.userId, seat: draftParticipants.seat })
    .from(draftParticipants)
    .where(eq(draftParticipants.draftId, state.draftId))
    .orderBy(draftParticipants.seat);
}

/** Every listed draft's seats in one query, keyed by draft id. */
async function seatsByDraft(ctx: Ctx, draftIds: number[]): Promise<Map<number, { userId: number; seat: number }[]>> {
  if (draftIds.length === 0) return new Map();
  const rows = await ctx.db
    .select({ draftId: draftParticipants.draftId, userId: draftParticipants.userId, seat: draftParticipants.seat })
    .from(draftParticipants)
    .where(inArray(draftParticipants.draftId, draftIds))
    .orderBy(asc(draftParticipants.seat));
  const byDraft = new Map<number, { userId: number; seat: number }[]>();
  for (const row of rows) {
    const list = byDraft.get(row.draftId) ?? [];
    list.push({ userId: row.userId, seat: row.seat });
    byDraft.set(row.draftId, list);
  }
  return byDraft;
}

/** The final line of every listed game, in one query, keyed by game id. Only
 * the score leaves the database — not each game's whole engine state. */
async function loadScores(ctx: Ctx, matches: TournamentMatch[]): Promise<Map<number, MatchScore>> {
  const ids = [...new Set(matches.map((m) => m.gameId).filter((id): id is number => id !== null))];
  if (ids.length === 0) return new Map();
  const rows = await ctx.db
    .select({
      id: games.id,
      home: sql<number>`(${games.state}->'engine'->'home'->>'score')::int`,
      away: sql<number>`(${games.state}->'engine'->'away'->>'score')::int`,
      winner: sql<string | null>`${games.state}->'engine'->>'winner'`,
    })
    .from(games)
    .where(inArray(games.id, ids));
  const out = new Map<number, MatchScore>();
  for (const row of rows) {
    if (row.winner !== 'home' && row.winner !== 'away') continue;
    out.set(row.id, { home: row.home, away: row.away, winner: row.winner });
  }
  return out;
}

/** Decided matches' final lines, keyed by match id, for standings and views. */
async function matchScores(ctx: Ctx, matches: TournamentMatch[]): Promise<Record<string, MatchScore>> {
  const byGame = await loadScores(ctx, matches);
  const out: Record<string, MatchScore> = {};
  for (const m of matches) {
    if (m.gameId === null) continue;
    const score = byGame.get(m.gameId);
    if (score) out[m.id] = score;
  }
  return out;
}

async function teamName(ctx: Ctx, teamId: number): Promise<string | null> {
  const [team] = await ctx.db.select({ name: teams.name }).from(teams).where(eq(teams.id, teamId)).limit(1);
  return team?.name ?? null;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

async function toView(ctx: Ctx, row: TournamentRow): Promise<TournamentView> {
  const state = stored(row);
  const config = configOf(row);
  const seats = await seatRows(ctx, state);
  const names = await seatedNames(ctx, seats, row.hostUserId);
  const scores = await matchScores(ctx, state.matches);
  const table = standingsFrom(config.seats, state.matches, (id) => scores[id] ?? null);

  const seatViews: TournamentSeatView[] = [];
  for (let seat = 0; seat < config.seats; seat++) {
    const holder = seats.find((s) => s.seat === seat);
    const record = table[seat] ?? { seat, wins: 0, losses: 0, runsFor: 0, runsAgainst: 0 };
    const teamId = state.teams[String(seat)] ?? null;
    seatViews.push({
      userId: holder?.userId ?? 0,
      name: holder ? (names.get(holder.userId) ?? '?') : 'Open seat',
      seat,
      isHost: holder?.userId === row.hostUserId,
      teamId,
      teamName: teamId ? (await teamName(ctx, teamId)) : null,
      wins: record.wins,
      losses: record.losses,
      runsFor: record.runsFor,
      runsAgainst: record.runsAgainst,
    });
  }

  return {
    id: row.id,
    name: row.name,
    status: row.status as TournamentView['status'],
    config,
    hostUserId: row.hostUserId,
    seats: seatViews,
    matches: state.matches,
    scores,
    draftId: state.draftId,
    championSeat: state.championSeat,
    log: state.log.slice(-60),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface CreateTournamentInput {
  name: string;
  format: TournamentFormat;
  seats: number;
  regulationInnings: number;
  autoSimulate: boolean;
  draft: {
    rounds: number;
    packSize: number;
    yearFrom: number;
    yearTo: number;
    themes?: readonly string[];
    rarityCaps?: { rare: number; star: number; mythic: number } | null;
  };
}

function validateConfig(input: CreateTournamentInput): TournamentConfig {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 40) throw badRequest('Give the tournament a name of 2 to 40 characters');
  if (!Number.isInteger(input.seats) || input.seats < TOURNAMENT_LIMITS.minSeats || input.seats > TOURNAMENT_LIMITS.maxSeats) {
    throw badRequest(`A tournament seats ${TOURNAMENT_LIMITS.minSeats} to ${TOURNAMENT_LIMITS.maxSeats} managers`);
  }
  if (input.format !== 'round-robin' && input.format !== 'semis') throw badRequest('Pick a format');
  if (!activeHouseRules().regulationInningsOptions.includes(input.regulationInnings)) {
    throw badRequest('Pick a regulation length from the house rules');
  }

  const { rounds, packSize, yearFrom, yearTo } = input.draft;
  if (!Number.isInteger(rounds) || rounds < TOURNAMENT_LIMITS.minRounds || rounds > TOURNAMENT_LIMITS.maxRounds) {
    throw badRequest(`Packs each must be between ${TOURNAMENT_LIMITS.minRounds} and ${TOURNAMENT_LIMITS.maxRounds}`);
  }
  if (!Number.isInteger(packSize) || packSize < TOURNAMENT_LIMITS.minPackSize || packSize > TOURNAMENT_LIMITS.maxPackSize) {
    throw badRequest(`Pack size must be between ${TOURNAMENT_LIMITS.minPackSize} and ${TOURNAMENT_LIMITS.maxPackSize}`);
  }
  // A tournament team is only its drafted cards, so every manager has to leave
  // the draft with enough cards to field nine and keep a bench.
  if (rounds * packSize < TOURNAMENT_LIMITS.minPicks) {
    throw badRequest(`A tournament draft hands out at least ${TOURNAMENT_LIMITS.minPicks} cards each — raise the packs or the pack size`);
  }
  if (!Number.isInteger(yearFrom) || !Number.isInteger(yearTo) || yearFrom < DRAFT_LIMITS.minYear || yearTo > DRAFT_LIMITS.maxYear) {
    throw badRequest('Pick a real range of card years');
  }
  if (yearTo < yearFrom) throw badRequest('The era has to end after it starts');
  if (yearTo - yearFrom > 60) throw badRequest('Keep the era to 60 years or fewer, so the packs stay of one time');

  const offered = new Set(packThemesForYears(yearFrom, yearTo).map((t) => t.id));
  const dropped = [...new Set(input.draft.themes ?? [])].filter((t) => offered.has(t as PackThemeId) === false);
  if (dropped.length > 0) {
    throw badRequest(`${dropped.map((t) => packTheme(t as PackThemeId).name).join(', ')} not dealt in ${yearFrom}–${yearTo}`);
  }
  const themes = [...new Set(input.draft.themes ?? [])].filter((t): t is PackThemeId => offered.has(t as PackThemeId));

  const rawCaps = input.draft.rarityCaps ?? null;
  const caps =
    rawCaps && (rawCaps.rare > 0 || rawCaps.star > 0 || rawCaps.mythic > 0)
      ? {
          rare: rawCaps.rare > 0 ? rawCaps.rare : DRAFT_LIMITS.maxRare,
          star: rawCaps.star > 0 ? rawCaps.star : DRAFT_LIMITS.maxStar,
          mythic: rawCaps.mythic > 0 ? rawCaps.mythic : DRAFT_LIMITS.maxMythic,
        }
      : null;

  return {
    format: input.format,
    seats: input.seats,
    regulationInnings: input.regulationInnings,
    autoSimulate: input.autoSimulate,
    // `TournamentConfig` still types the caps as the pre-Mythic `{ rare, chase }`
    // shape (that shared file is frozen); today's tiers are what is stored.
    draft: { rounds, packSize, yearFrom, yearTo, themes: themes.length > 0 ? themes : ['mixed'], rarityCaps: caps as unknown as TournamentConfig['draft']['rarityCaps'] },
  };
}

/**
 * The draft's caps read in today's tiers, mapped through the shared resolver so
 * a row capped back when the top tier was "chase" still plays the same cards.
 */
function draftMatch(config: TournamentConfig): MatchRules {
  return {
    ...resolveMatchRules({ yearFrom: config.draft.yearFrom, yearTo: config.draft.yearTo, rarityCaps: config.draft.rarityCaps }),
    outOfPosition: true,
  };
}

/** The draft a tournament runs: playable cards only, since they must field nine. */
function draftConfig(config: TournamentConfig): CreateDraftInput {
  const d = config.draft;
  return {
    rounds: d.rounds,
    packSize: d.packSize,
    yearFrom: d.yearFrom,
    yearTo: d.yearTo,
    playableOnly: true,
    themes: d.themes,
    rarityCaps: d.rarityCaps as unknown as CreateDraftInput['rarityCaps'],
    regulationInnings: config.regulationInnings,
  };
}

export async function createTournament(ctx: Ctx, user: AuthUser, input: CreateTournamentInput): Promise<TournamentView> {
  const config = validateConfig(input);
  // Open the draft room first: if no pack can be dealt from this era, fail
  // before the tournament exists. The host takes seat 1 of the draft, which is
  // seat 1 of the tournament.
  const draft = await createDraft(ctx, user, draftConfig(config), false);
  const state: TournamentState = {
    draftId: draft.id,
    teams: {},
    matches: [],
    championSeat: null,
    log: [{ seq: 1, text: `${user.displayName} opened the room: ${formatLabel(config.format)}, ${config.seats} seats.` }],
  };
  const [row] = await ctx.db
    .insert(tournaments)
    .values({ hostUserId: user.id, name: input.name.trim(), status: 'lobby', config, state, draftId: draft.id })
    .returning();
  ctx.io?.to('list:tournaments').emit('tournaments:update', { tournamentId: row!.id });
  return toView(ctx, row!);
}

export async function listTournaments(ctx: Ctx, user: AuthUser): Promise<TournamentListItem[]> {
  const rows = await ctx.db.select().from(tournaments).orderBy(desc(tournaments.updatedAt)).limit(50);
  // Every draft's seats in one query, keyed by draft id.
  const draftIds = [...new Set(rows.map((r) => stored(r).draftId).filter((id): id is number => id !== null))];
  const seatLists = await seatsByDraft(ctx, draftIds);
  const seatsOf = (draftId: number | null) => (draftId === null ? [] : seatLists.get(draftId) ?? []);
  const names = await namesFor(
    ctx,
    rows.flatMap((r) => [r.hostUserId, ...seatsOf(stored(r).draftId).map((s) => s.userId)]),
  );
  const items: TournamentListItem[] = [];
  for (const row of rows) {
    const state = stored(row);
    const config = configOf(row);
    const seats = seatsOf(state.draftId);
    const champion = state.championSeat === null ? null : seats.find((s) => s.seat === state.championSeat);
    items.push({
      id: row.id,
      name: row.name,
      status: row.status as TournamentListItem['status'],
      format: config.format,
      seats: config.seats,
      seatsFilled: seats.length,
      hostName: names.get(row.hostUserId) ?? '?',
      era: tournamentEraLabel(config.draft),
      championName: champion ? (names.get(champion.userId) ?? '?') : null,
      isMine: seats.some((s) => s.userId === user.id),
      updatedAt: row.updatedAt.toISOString(),
    });
  }
  return items;
}

export function getTournament(ctx: Ctx, _user: AuthUser, id: number): Promise<TournamentView> {
  return withLock(id, async () => {
    const row = await loadRow(ctx, id);
    return toView(ctx, await sync(ctx, row));
  });
}

export function joinTournament(ctx: Ctx, user: AuthUser, id: number): Promise<TournamentView> {
  return withLock(id, async () => {
    const row = await loadRow(ctx, id);
    if (row.status !== 'lobby') throw badRequest('That tournament already started');
    const config = configOf(row);
    const seats = await seatRows(ctx, stored(row));
    if (seats.some((s) => s.userId === user.id)) return toView(ctx, row);
    if (seats.length >= config.seats) throw badRequest(`All ${config.seats} seats are taken`);

    await joinDraft(ctx, user, stored(row).draftId!, false);
    const fresh = await loadRow(ctx, id);
    const state = stored(fresh);
    state.log.push({ seq: state.log.length + 1, text: `${user.displayName} took seat ${seats.length + 1}.` });
    return toView(ctx, await save(ctx, fresh, state, fresh.status));
  });
}

export function startTournament(ctx: Ctx, user: AuthUser, id: number): Promise<TournamentView> {
  return withLock(id, async () => {
    const row = await loadRow(ctx, id);
    if (row.hostUserId !== user.id) throw forbidden('Only the host can start the tournament');
    if (row.status !== 'lobby') throw badRequest('That tournament already started');

    const config = configOf(row);
    const state = stored(row);
    const seats = await seatRows(ctx, state);
    if (seats.length < config.seats) throw badRequest(`This tournament needs ${config.seats} managers — ${seats.length} seated`);

    // A rematch: the teams are already built from the first run's draft, so
    // there is nothing to deal — only a fresh bracket to schedule.
    if (state.draftId === null) {
      if (Object.keys(state.teams).length < config.seats) throw badRequest('The teams from that tournament are gone');
      state.matches = scheduleMatches(config.format, config.seats);
      state.log.push({
        seq: state.log.length + 1,
        text: `Same teams, fresh bracket — ${formatLabel(config.format)}. Play ball.`,
      });
      return toView(ctx, await save(ctx, row, state, 'playing'));
    }

    // Everyone is seated: deal the packs and let the draft room take over.
    await startDraft(ctx, user, state.draftId, false);
    state.matches = scheduleMatches(config.format, config.seats);
    state.log.push({
      seq: state.log.length + 1,
      text: `Packs on the table. Draft your teams — ${formatLabel(config.format)} when the packs run out.`,
    });
    return toView(ctx, await save(ctx, row, state, 'drafting'));
  });
}

/** Play out every match that is scheduled but not yet decided (host only). */
export function simulateTournament(ctx: Ctx, user: AuthUser, id: number): Promise<TournamentView> {
  return withLock(id, async () => {
    const row = await loadRow(ctx, id);
    if (row.hostUserId !== user.id) throw forbidden('Only the host can simulate the tournament');
    const synced = await sync(ctx, row);
    if (synced.status === 'finished') throw badRequest('This tournament is already finished');
    if (synced.status !== 'playing') throw badRequest('The matches are not scheduled yet — finish the draft first');

    const state = stored(synced);
    const pending = state.matches.filter((match) => match.winnerSeat === null && match.gameId !== null && match.error === null);
    let played = 0;
    for (const [index, match] of pending.entries()) {
      ctx.io?.to(`tournament:${id}`).emit('tournament:progress', { current: index + 1, total: pending.length, stage: match.stage });
      if (await playMatch(ctx, match.gameId!)) played += 1;
    }
    if (played === 0) throw badRequest('Every match has already been played');
    const updated = await sync(ctx, await loadRow(ctx, id));
    ctx.io?.to(`tournament:${id}`).emit('tournament:progress', { current: pending.length, total: pending.length, done: true });
    return toView(ctx, updated);
  });
}

/**
 * Run the same tournament again with the same drafted teams: a new row, the
 * same config, and the same teams — no second draft. The seats come along in
 * the new row's state, because the unique index on `tournaments.draft_id`
 * lets one row own a draft room and the original still owns this one.
 */
export function rematchTournament(ctx: Ctx, user: AuthUser, id: number): Promise<TournamentView> {
  return withLock(id, async () => {
    const row = await loadRow(ctx, id);
    if (row.hostUserId !== user.id) throw forbidden('Only the host can run a rematch');
    if (row.status !== 'finished') throw badRequest('That tournament is still going');
    const config = configOf(row);
    const state = stored(row);
    if (Object.keys(state.teams).length < config.seats) throw badRequest('The teams from that tournament are gone');
    const seats = await seatRows(ctx, state);

    const suffix = ' (rematch)';
    const name = row.name.length + suffix.length <= 40 ? `${row.name}${suffix}` : `${row.name.slice(0, 40 - suffix.length)}${suffix}`;
    const fresh: TournamentState = {
      draftId: null,
      seats: seats.map((s) => ({ ...s })),
      teams: { ...state.teams },
      matches: [],
      championSeat: null,
      log: [{ seq: 1, text: `Rematch of ${row.name} — same teams, fresh bracket.` }],
    };
    const [created] = await ctx.db
      .insert(tournaments)
      .values({ hostUserId: row.hostUserId, name, status: 'lobby', config, state: fresh, draftId: null })
      .returning();
    ctx.io?.to('list:tournaments').emit('tournaments:update', { tournamentId: created!.id });
    return toView(ctx, created!);
  });
}

export function deleteTournament(ctx: Ctx, user: AuthUser, id: number): Promise<void> {
  return withLock(id, async () => {
    const row = await loadRow(ctx, id);
    if (row.hostUserId !== user.id) throw forbidden('Only the host can close the tournament');
    const state = stored(row);
    // The draft room goes with it; games already played and the teams built
    // from the picks stay with their managers.
    if (state.draftId !== null) await ctx.db.delete(drafts).where(eq(drafts.id, state.draftId));
    await ctx.db.delete(tournaments).where(eq(tournaments.id, id));
    ctx.io?.to('list:tournaments').emit('tournaments:update', { tournamentId: id });
  });
}

// ---------------------------------------------------------------------------
// Catching up
// ---------------------------------------------------------------------------

/**
 * Bring a tournament up to date: turn a finished draft into teams and a
 * schedule, record finished games, schedule matches whose slots are decided,
 * and crown a champion when everything is. Safe to run repeatedly, and it
 * only writes when something actually changed.
 */
async function sync(ctx: Ctx, row: TournamentRow): Promise<TournamentRow> {
  let current = row;
  const config = configOf(current);
  const state = stored(current);
  const seated = await seatRows(ctx, state);
  const names = await seatedNames(ctx, seated, current.hostUserId);
  const label = (seat: number | null) => {
    if (seat === null) return 'nobody';
    const holder = seated.find((s) => s.seat === seat);
    return holder ? (names.get(holder.userId) ?? `seat ${seat + 1}`) : `seat ${seat + 1}`;
  };
  let dirty = false;

  // 1. The draft finished: build each manager a team out of what they drafted.
  if (current.status === 'drafting' && state.draftId !== null) {
    const [draft] = await ctx.db.select().from(drafts).where(eq(drafts.id, state.draftId)).limit(1);
    if (draft?.status === 'finished') {
      await buildTeams(ctx, current, state, label);
      state.log.push({ seq: state.log.length + 1, text: 'The draft is done. Every roster is exactly the cards its manager drafted.' });
      current = await save(ctx, current, state, 'playing');
    }
  }

  // 2. Record the games that have finished since we looked.
  const decided = new Map(state.matches.map((m) => [m.id, m] as const));
  const recordResults = async (): Promise<boolean> => {
    // One narrowed query for every undecided match — no whole engine states.
    const pending = state.matches.filter((m) => m.winnerSeat === null && m.gameId !== null);
    if (pending.length === 0) return false;
    const byGame = await loadScores(ctx, pending);
    let recorded = false;
    for (const match of pending) {
      const score = byGame.get(match.gameId!);
      if (!score) continue;
      match.winnerSeat = score.winner === 'home' ? match.homeSeat : match.awaySeat;
      match.loserSeat = score.winner === 'home' ? match.awaySeat : match.homeSeat;
      decided.set(match.id, match);
      const hi = Math.max(score.home, score.away);
      const lo = Math.min(score.home, score.away);
      state.log.push({ seq: state.log.length + 1, text: `${match.stage} final: ${label(match.winnerSeat)} ${hi}, ${label(match.loserSeat)} ${lo}.` });
      dirty = true;
      recorded = true;
    }
    return recorded;
  };

  // 3. Fill in the slots that earlier matches have now decided, and schedule
  //    every match whose teams are known. A side that can't take the field
  //    forfeits, so the tournament always reaches its end.
  const deadEnd = (slot: MatchSlot) => {
    if ('seed' in slot) return false;
    const from = decided.get('winnerOf' in slot ? slot.winnerOf : slot.loserOf);
    return from !== undefined && from.error !== null && from.winnerSeat === null;
  };
  const scheduleReady = async (): Promise<boolean> => {
    let progressed = false;
    for (const match of state.matches) {
      if (match.error !== null || match.winnerSeat !== null || match.gameId !== null) continue;
      if (deadEnd(match.home) || deadEnd(match.away)) {
        match.error = 'an earlier match could not be played';
        state.log.push({ seq: state.log.length + 1, text: `${match.stage} is off: an earlier match could not be played.` });
        progressed = true;
        continue;
      }
      const home = slotSeat(match.home, decided);
      const away = slotSeat(match.away, decided);
      if (home === null || away === null) continue;

      match.homeSeat = home;
      match.awaySeat = away;
      progressed = true;
      const scheduled = await createMatchGame(ctx, current, config, state, home, away, label);
      if ('reason' in scheduled) {
        // Say so once, then stop trying.
        match.error = scheduled.reason;
        if (scheduled.unplayable.length === 1) {
          match.forfeit = true;
          match.loserSeat = scheduled.unplayable[0]!;
          match.winnerSeat = match.loserSeat === home ? away : home;
          state.log.push({
            seq: state.log.length + 1,
            text: `${match.stage}: ${label(match.winnerSeat)} wins by forfeit. ${label(match.loserSeat)} can't take the field.`,
          });
        } else {
          state.log.push({ seq: state.log.length + 1, text: `${match.stage} can't be played: ${scheduled.reason}` });
        }
        decided.set(match.id, match);
        continue;
      }
      match.gameId = scheduled.gameId;
      state.log.push({ seq: state.log.length + 1, text: `${match.stage}: ${label(home)} vs. ${label(away)}.` });
      if (config.autoSimulate) await playMatch(ctx, scheduled.gameId);
    }
    if (progressed) dirty = true;
    return progressed;
  };

  // Results unlock later matches (a semifinal decides the final), so keep
  // going until a pass changes nothing. Each match can only move forward.
  await recordResults();
  while (current.status === 'playing') {
    const scheduled = await scheduleReady();
    const recorded = await recordResults();
    if (!scheduled && !recorded) break;
  }

  // 4. Everything decided: crown a champion. (Scores are re-read here, because
  //    step 3 may have just played games out.)
  if (state.matches.length > 0 && state.matches.every((m) => m.winnerSeat !== null || m.error !== null)) {
    const scores = await matchScores(ctx, state.matches);
    const champion = championSeat(config.format, config.seats, state.matches, (id) => scores[id] ?? null);
    if (state.championSeat === null && champion !== null) {
      state.championSeat = champion;
      state.log.push({ seq: state.log.length + 1, text: `${label(champion)} wins the tournament.` });
      // The champion's packs, granted once: the reward key is the tournament.
      const champ = seated.find((s) => s.seat === champion);
      if (champ) await rewardTournamentWin(ctx.db, { id: current.id, name: current.name }, champ.userId);
      dirty = true;
    }
    if (current.status !== 'finished') return save(ctx, current, state, 'finished');
    if (dirty) return save(ctx, current, state, current.status);
    return current;
  }

  if (dirty) return save(ctx, current, state, current.status);
  return current;
}

/**
 * Each manager's tournament team: a new team holding exactly the cards they
 * drafted, with a lineup filled in for them. A manager whose picks can't
 * field nine is logged, not fatal — the tournament goes on without them.
 */
async function buildTeams(
  ctx: Ctx,
  row: TournamentRow,
  state: TournamentState,
  label: (seat: number | null) => string,
): Promise<void> {
  if (state.draftId === null) return;
  const [draft] = await ctx.db.select().from(drafts).where(eq(drafts.id, state.draftId)).limit(1);
  if (!draft) return;
  const picks = (draft.state as { picks: Record<string, DraftCard[]> }).picks;
  const seats = await seatRows(ctx, state);

  for (const { userId, seat } of seats) {
    const built = await teamFromPicks(ctx, row, userId, label(seat), picks[String(seat)] ?? []);
    const log = (text: string) => state.log.push({ seq: state.log.length + 1, text });
    if (built === null) {
      log(`${label(seat)} drafted nothing that can take the field, and forfeits.`);
      continue;
    }
    state.teams[String(seat)] = built.teamId;
    if (built.problem) log(`${label(seat)} can't field a team (${built.problem}), and forfeits.`);
    else if (built.outOfPosition.length) {
      log(`${label(seat)} drafted nobody for ${built.outOfPosition.join(', ')}: someone plays out of position there.`);
    }
  }
}

/**
 * Build one manager's team from the (person, year) pairs they drafted. The
 * team is kept even when it can't take the field, so its manager can see why.
 */
async function teamFromPicks(
  ctx: Ctx,
  row: TournamentRow,
  userId: number,
  manager: string,
  drafted: DraftCard[],
): Promise<{ teamId: number; problem: string | null; outOfPosition: Position[] } | null> {
  if (drafted.length === 0) return null;
  const owned = await ctx.db
    .select({ id: userCards.id, personId: cardModels.personId, cardYear: cardModels.cardYear })
    .from(userCards)
    .innerJoin(cardModels, eq(cardModels.id, userCards.cardModelId))
    // Drafted cards are sandbox rows; when the manager also owns a real copy of
    // the same card, the sandbox row is the one on the team, so it wins here.
    .where(eq(userCards.userId, userId))
    .orderBy(userCards.sandbox);
  const byPair = new Map(owned.map((o) => [`${o.personId}:${o.cardYear}`, o.id]));

  // The same card can come up twice in a draft; a team carries one of each.
  const userCardIds = [...new Set(drafted.map((c) => byPair.get(`${c.personId}:${c.cardYear}`)))].filter(
    (id): id is number => id !== undefined,
  );
  if (userCardIds.length === 0) return null;

  const [team] = await ctx.db
    .insert(teams)
    .values({ userId, name: `${manager} · ${row.name}`.slice(0, 40), tournamentId: row.id })
    .returning();
  await ctx.db.insert(teamCards).values(userCardIds.map((userCardId) => ({ teamId: team!.id, userCardId })));

  // Fill in a lineup so the manager can go straight to the field; they can
  // reset it from the team page like any other team.
  const loaded = await loadTeam(ctx, team!.id);
  const roster = rosterCards(loaded.roster);
  const auto = autoLineup(roster, undefined, { outOfPosition: true });
  if ('error' in auto) return { teamId: team!.id, problem: auto.error, outOfPosition: [] };
  await ctx.db.update(teams).set({ lineup: auto.lineup }).where(eq(teams.id, team!.id));
  const outOfPosition = (Object.entries(auto.lineup.fieldPositions) as [Position, string][])
    .filter(([pos, id]) => !roster.find((r) => r.id === id)?.card.positions.includes(pos))
    .map(([pos]) => pos);
  return { teamId: team!.id, problem: null, outOfPosition };
}

/**
 * The game room for one match: an ordinary remote game with both managers in
 * it from the start. Fails with a reason when the teams can't take the field.
 */
async function createMatchGame(
  ctx: Ctx,
  row: TournamentRow,
  config: TournamentConfig,
  state: TournamentState,
  homeSeat: number,
  awaySeat: number,
  seatLabel: (seat: number | null) => string,
): Promise<{ gameId: number } | { reason: string; unplayable: number[] }> {
  // Each side on its own, so we know who can't take the field.
  const prepare = async (seat: number, prefix: string) => {
    const teamId = state.teams[String(seat)];
    if (teamId === undefined) return { seat, problem: `${seatLabel(seat)} has no team` };
    try {
      const loaded = await loadTeam(ctx, teamId);
      return { seat, loaded, setup: teamSetupFor(loaded, prefix, { userId: loaded.team.userId, isBot: false, outOfPosition: true }) };
    } catch (err) {
      return { seat, problem: err instanceof Error ? err.message : 'no legal lineup' };
    }
  };
  const sides = [await prepare(homeSeat, 'h'), await prepare(awaySeat, 'g')];
  const failed = sides.filter((s) => 'problem' in s);
  if (failed.length) return { reason: failed.map((s) => s.problem).join('; '), unplayable: failed.map((s) => s.seat) };
  const [homeSide, awaySide] = sides as { seat: number; loaded: Awaited<ReturnType<typeof loadTeam>>; setup: TeamSetup }[];
  const home = homeSide!.loaded;
  const away = awaySide!.loaded;
  // The tournament's era and caps ride along so the room prints the terms;
  // drafted rosters may field out of position.
  const match: MatchRules = draftMatch(config);

  let engine: ReturnType<typeof createGame>;
  try {
    engine = createGame(
      {
        id: `t${row.id}-${state.matches.length}-${homeSeat}-${awaySeat}`,
        mode: 'remote',
        regulationInnings: config.regulationInnings,
        // Snapshot the commissioner's rules into the match.
        rules: activeHouseRules(),
        match,
        teams: [homeSide!.setup, awaySide!.setup],
      },
      cryptoRng(),
    );
  } catch (err) {
    return { reason: err instanceof Error ? err.message : 'the teams cannot take the field', unplayable: [homeSeat, awaySeat] };
  }

  const room: StoredGame = {
    engine: engine.state,
    hostUserId: home.team.userId,
    hostTeamId: home.team.id,
    guestUserId: away.team.userId,
    photos: { ...photoMap(home.roster, 'h'), ...photoMap(away.roster, 'g') },
    ready: [],
  };
  const [game] = await ctx.db
    .insert(games)
    .values({
      mode: 'remote',
      regulationInnings: config.regulationInnings,
      matchRules: match,
      homeUserId: home.team.userId,
      awayUserId: away.team.userId,
      homeTeamId: home.team.id,
      awayTeamId: away.team.id,
      status: engine.state.phase,
      state: room,
      tournamentId: row.id,
    })
    .returning();
  if (engine.events.length) {
    await ctx.db.insert(gameEvents).values(
      engine.events.map((e) => ({ gameId: game!.id, seq: e.seq, inning: e.inning, half: e.half, kind: e.kind, text: e.text, data: e })),
    );
  }
  return { gameId: game!.id };
}

/**
 * Play one match out with the bot policy for both sides. A manager playing the
 * same game live wins the version race, and the match is left to them.
 */
async function playMatch(ctx: Ctx, gameId: number): Promise<boolean> {
  const [row] = await ctx.db.select().from(games).where(eq(games.id, gameId)).limit(1);
  if (!row) return false;
  const before = row.state as StoredGame;
  if (!before.engine || before.engine.phase === 'finished') return false;

  const result = autoPlay(before.engine, cryptoRng());
  const next: StoredGame = { ...before, engine: result.state };

  const updated = await ctx.db.transaction(async (tx) => {
    const saved = await tx
      .update(games)
      .set({
        state: next,
        version: row.version + 1,
        status: result.state.phase,
        winnerSide: result.state.winner,
        updatedAt: new Date(),
      })
      .where(and(eq(games.id, gameId), eq(games.version, row.version)))
      .returning();
    if (saved.length === 0) return null;
    if (result.events.length) {
      await tx.insert(gameEvents).values(
        result.events.map((e) => ({ gameId, seq: e.seq, inning: e.inning, half: e.half, kind: e.kind, text: e.text, data: e })),
      );
    }
    await recordCardLines(tx, gameId, result.state);
    return saved[0]!;
  });
  if (updated === null) return false;
  // Same shape the game room broadcasts, so an open mat updates live.
  ctx.io?.to(`game:${gameId}`).emit('game:update', { game: gameView(updated), events: result.events });
  return true;
}

async function save(ctx: Ctx, row: TournamentRow, state: TournamentState, status: string): Promise<TournamentRow> {
  const [updated] = await ctx.db
    .update(tournaments)
    .set({ state, status, draftId: state.draftId, updatedAt: new Date() })
    .where(eq(tournaments.id, row.id))
    .returning();
  ctx.io?.to(`tournament:${row.id}`).emit('tournament:update', { tournamentId: row.id, status });
  ctx.io?.to('list:tournaments').emit('tournaments:update', { tournamentId: row.id });
  return updated!;
}
