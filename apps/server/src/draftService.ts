import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type {
  CardSnapshot,
  DraftCard,
  DraftConfig,
  DraftGameResult,
  DraftListItem,
  DraftParticipant,
  DraftRarity,
  DraftSeatPicks,
  DraftTeamCard,
  DraftTeamView,
  DraftView,
  MatchRules,
  PackThemeId,
  Position,
  SavedLineup,
} from '@cardball/shared';
import { DRAFT_LIMITS, PACK_THEME_IDS, WINNER_PACK_THEMES, activeHouseRules, packTheme, packThemesForYears, themeForRound } from '@cardball/shared';
import { createGame, cryptoRng } from '@cardball/engine';
import type { Side, TeamSetup } from '@cardball/engine';
import { cardModels, draftParticipants, drafts, gameEvents, games, people, teamCards, teams, tournaments, userCards } from '@cardball/db';
import type { DraftRow } from '@cardball/db';
import { autoLineup } from './autoLineup.js';
import { buildCard, loadWindowSeasons } from './cards.js';
import { fileCardIntoCollection, keepSandboxCard } from './cardFiling.js';
import { dealFieldInsurance, dealPack } from './packDeal.js';
import { grantPacks } from './packs.js';
import { lineupProblem, loadTeam, photoMap, rosterCards, teamSetupFor } from './roster.js';
import type { LoadedTeam } from './roster.js';
import type { StoredGame } from './gameService.js';
import type { AuthUser } from './auth.js';
import type { Ctx } from './context.js';
import { badRequest, forbidden, notFound, HttpError } from './http.js';
import { withKeyLock } from './lock.js';
import { namesFor } from './names.js';
import type { Executor } from './context.js';

/**
 * Pass-the-pack drafts.
 *
 * Everyone in the room opens a pack, takes one card, and passes the rest to the
 * next seat. When the packs come back around empty, the next round is dealt.
 * Every card taken lands in that manager's sandbox: playable on the team built
 * from their picks, but not in their binder until they keep it. When the last
 * pack empties the room moves to assembly, and the first two seats play a
 * series of 1v1 games with the teams they drafted — the loser gets a
 * consolation pack, the winner chooses a bonus wrapper and keeps one card.
 *
 * The pool is built from the stats database for one card year: a pack is a
 * random handful of players who appeared in the six seasons before that year.
 * No player is dealt twice in one draft, so no two seats can draft the same man.
 */

const { minSeats: MIN_SEATS, maxSeats: MAX_SEATS, maxRounds: MAX_ROUNDS, minPackSize: MIN_PACK_SIZE, maxPackSize: MAX_PACK_SIZE, minYear: MIN_YEAR, maxYear: MAX_YEAR, maxRare: MAX_RARE, maxStar: MAX_STAR, maxMythic: MAX_MYTHIC } =
  DRAFT_LIMITS;

/** The two seats that play the series; the rest of the table watches. */
const SERIES_SEATS = [0, 1] as const;

/** The per-draft state kept in `drafts.state`. */
interface DraftState {
  /** 1-based round being opened */
  round: number;
  /** seats that still have to take a card before the packs pass */
  waitingOn: number[];
  /** pack each seat is holding, keyed by seat index */
  packs: Record<string, DraftCard[]>;
  /** the wrapper each seat is holding, keyed by seat index */
  packThemes: Record<string, PackThemeId>;
  /** seats that have torn their pack open this round */
  opened: number[];
  /** cards each seat has taken, keyed by seat index */
  picks: Record<string, DraftCard[]>;
  log: { seq: number; text: string }[];
  /** every person dealt in this draft, so no player is dealt twice */
  dealtPersonIds: number[];
  /** draft card id → the sandbox `user_cards` row it was filed as */
  cardFiling: Record<string, number>;
  /** seat → the team built from that seat's picks, once the packs run out */
  teams: Record<string, number>;
  /** seats that have locked in a lineup for the series */
  assembled: number[];
  /** the series' current game */
  seriesGameId: number | null;
  /** the series so far, oldest first */
  games: DraftGameResult[];
  /** game id → the card the winner kept, keyed by game id as a string */
  keeps: Record<string, { userId: number; cardId: string; userCardId: number }>;
  /** game id → the wrapper the winner chose */
  packChoices: Record<string, PackThemeId>;
}

const stored = (row: DraftRow) => row.state as DraftState;

/** Rare, star, and mythic cards a manager has taken so far. */
function tally(picks: DraftCard[]): { rare: number; star: number; mythic: number } {
  return {
    rare: picks.filter((c) => c.rarity === 'rare').length,
    star: picks.filter((c) => c.rarity === 'star').length,
    mythic: picks.filter((c) => c.rarity === 'mythic').length,
  };
}

/** Would taking this card put the manager over one of the draft's rarity caps? */
function capBlocks(caps: DraftConfig['rarityCaps'], picks: DraftCard[], card: DraftCard): string | null {
  if (!caps) return null;
  const have = tally(picks);
  for (const tier of ['mythic', 'star', 'rare'] as const) {
    if (card.rarity !== tier) continue;
    const cap = caps[tier];
    if (have[tier] >= cap) return `You already have ${cap} ${tier} card${cap === 1 ? '' : 's'}`;
  }
  return null;
}

/**
 * What a seat's picks are short of a legal lineup: nine distinct bats plus a
 * starter who is none of them. That is the engine's own rule — the pitcher
 * never bats for himself here — and `DraftCard` carries all it takes to count
 * it: `positions` is empty exactly when a card cannot bat, and `starter`
 * marks an SP.
 */
function fieldingShortfall(picks: DraftCard[]): { starters: number; bats: number } {
  const distinct = new Map(picks.map((p) => [p.personId, p]));
  let starters = 0;
  let bats = 0;
  for (const card of distinct.values()) {
    if (!card.playable) continue;
    if (card.starter) starters++;
    else if ((card.positions?.length ?? 0) > 0) bats++;
  }
  return { starters: Math.max(0, 1 - starters), bats: Math.max(0, 9 - bats) };
}

/**
 * Field insurance, dealt as the last pack empties. A pass-the-pack draft can
 * hand a seat sixteen cards but no starter or no ninth bat, and a seat that
 * cannot field forfeits on the deal's luck. Every seat short of a legal lineup
 * is topped up with just what they lack — logged, filed into the collection,
 * and kept in the picks — so a finished draft always leaves every seat able
 * to take the field.
 */
async function topUpForFielding(
  ctx: Ctx,
  row: DraftRow,
  seats: { userId: number; seat: number }[],
  state: DraftState,
): Promise<{ userId: number; card: DraftCard }[]> {
  const config = parseConfig(row);
  const names = await namesFor(ctx, seats.map((s) => s.userId));
  const filed: { userId: number; card: DraftCard }[] = [];

  for (const { userId, seat } of seats) {
    const key = String(seat);
    const picks = state.picks[key] ?? [];
    const need = fieldingShortfall(picks);
    if (need.starters === 0 && need.bats === 0) continue;

    const dealt = await dealFieldInsurance(ctx, config, need, [...new Set(picks.map((p) => p.personId))]);
    for (const card of dealt) {
      state.picks[key] = [...(state.picks[key] ?? []), card];
      state.log.push({
        seq: state.log.length + 1,
        text: `Field insurance: the league deals ${names.get(userId) ?? 'a manager'} ${card.name} — ${card.starter ? 'a starter' : 'another bat'}.`,
      });
      filed.push({ userId, card });
    }
    if (dealt.length < need.starters + need.bats) {
      state.log.push({
        seq: state.log.length + 1,
        text: `Field insurance ran thin: ${names.get(userId) ?? 'a manager'} still cannot field a team from this era.`,
      });
    }
  }
  return filed;
}

// Commands on one draft run one at a time, so a double-clicked pick can't take two cards.
const locks = new Map<number, Promise<unknown>>();
function withLock<T>(draftId: number, fn: () => Promise<T>): Promise<T> {
  return withKeyLock(locks, draftId, fn);
}

// ---------------------------------------------------------------------------
// The card pool
// ---------------------------------------------------------------------------
// Dealing is shared with the pack shelf: see packDeal.ts.

/**
 * Deal one pack to every seat, skipping every player this draft has already
 * dealt — all rounds, all seats — so nobody can draft the same man twice. A
 * pack that runs out of fresh candidates comes back short rather than
 * repeating a player, and the dealt ids are remembered on the state.
 */
async function dealAllPacks(ctx: Ctx, config: DraftConfig, seats: number, round: number, state: DraftState): Promise<Record<string, DraftCard[]>> {
  const packs: Record<string, DraftCard[]> = {};
  for (let seat = 0; seat < seats; seat++) {
    const pack = await dealPack(ctx, config, config.packSize, themeForRound(config.themes, round, seat), state.dealtPersonIds);
    packs[String(seat)] = pack;
    state.dealtPersonIds.push(...pack.map((c) => c.personId));
  }
  return packs;
}

/** The wrapper each seat is holding, matching the pack just dealt to them. */
function themesForSeats(config: DraftConfig, seats: number, round: number): Record<string, PackThemeId> {
  const map: Record<string, PackThemeId> = {};
  for (let seat = 0; seat < seats; seat++) map[String(seat)] = themeForRound(config.themes, round, seat);
  return map;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

const passDirection = (round: number): 'left' | 'right' => (round % 2 === 1 ? 'left' : 'right');

/** Seats holding cards; they all pick before the packs move. */
function seatsWithCards(packs: Record<string, DraftCard[]>, seatCount: number): number[] {
  return Array.from({ length: seatCount }, (_, seat) => seat).filter((seat) => (packs[String(seat)] ?? []).length > 0);
}

/**
 * A draft's rarity caps, read in today's tiers. A room capped before the
 * Star/Mythic split stored `{ rare, chase }`, where chase was the star cap; a
 * tier left at zero has always meant "no cap at all" in a draft (unlike a
 * match, where zero is a real cap), so a zero reads as the tier's maximum.
 */
function draftCaps(raw: unknown): DraftConfig['rarityCaps'] {
  if (!raw) return null;
  const caps = raw as { rare?: number; star?: number; mythic?: number; chase?: number };
  const pick = (value: number | undefined, fallback: number) => (typeof value === 'number' && value > 0 ? value : fallback);
  return {
    rare: pick(caps.rare, MAX_RARE),
    star: pick(caps.star ?? caps.chase, MAX_STAR),
    mythic: pick(caps.mythic, MAX_MYTHIC),
  };
}

/**
 * Read a stored config, filling in fields added after the room was created, so
 * rooms from before themed packs (or before the series) still open.
 */
function parseConfig(row: DraftRow): DraftConfig {
  const raw = row.config as Partial<DraftConfig>;
  const cardYear = raw.cardYear ?? 2000;
  return {
    rounds: raw.rounds ?? 3,
    packSize: raw.packSize ?? 5,
    cardYear,
    yearFrom: raw.yearFrom ?? cardYear,
    yearTo: raw.yearTo ?? cardYear,
    playableOnly: raw.playableOnly ?? true,
    themes: raw.themes && raw.themes.length > 0 ? raw.themes : ['mixed'],
    rarityCaps: draftCaps(raw.rarityCaps),
    regulationInnings: raw.regulationInnings ?? 9,
  };
}

/** A brand-new draft state: nothing dealt, nothing assembled, nothing played. */
function freshState(log: DraftState['log']): DraftState {
  return {
    round: 1,
    waitingOn: [],
    packs: {},
    packThemes: {},
    opened: [],
    picks: {},
    log,
    dealtPersonIds: [],
    cardFiling: {},
    teams: {},
    assembled: [],
    seriesGameId: null,
    games: [],
    keeps: {},
    packChoices: {},
  };
}

/** Every field added after the room was created is defaulted, so old rows load. */
function parseState(row: DraftRow): DraftState {
  const raw = stored(row);
  return {
    ...raw,
    packThemes: raw.packThemes ?? {},
    opened: raw.opened ?? [],
    picks: raw.picks ?? {},
    dealtPersonIds: raw.dealtPersonIds ?? [],
    cardFiling: raw.cardFiling ?? {},
    teams: raw.teams ?? {},
    assembled: raw.assembled ?? [],
    seriesGameId: raw.seriesGameId ?? null,
    games: raw.games ?? [],
    keeps: raw.keeps ?? {},
    packChoices: raw.packChoices ?? {},
  };
}

function participantsOf(rows: { userId: number; seat: number }[], hostUserId: number, names: Map<number, string>): DraftParticipant[] {
  return [...rows]
    .sort((a, b) => a.seat - b.seat)
    .map((r) => ({ userId: r.userId, seat: r.seat, name: names.get(r.userId) ?? '?', isHost: r.userId === hostUserId }));
}

/**
 * The viewer's team lineup, translated out of team-card ids and back into the
 * draft card ids the room works in. Null when the seat has no team, has not
 * saved a lineup, or the lineup names a card that is no longer on the team.
 */
async function lineupInCardSpace(ctx: Ctx, state: DraftState, seat: number | null): Promise<SavedLineup | null> {
  const teamId = seat === null ? undefined : state.teams[String(seat)];
  if (teamId === undefined) return null;
  const [team] = await ctx.db.select({ lineup: teams.lineup }).from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team?.lineup) return null;
  return toCardSpace(team.lineup, await cardIdsByTeamCard(ctx, state, teamId));
}

/**
 * team-card id → draft card id for one team. A draft team is built from the
 * sandbox rows the picks were filed as, so the filing map is what ties a card
 * on the field back to the card in the room.
 */
async function cardIdsByTeamCard(ctx: Ctx, state: DraftState, teamId: number): Promise<Map<string, string>> {
  const links = await ctx.db.select({ id: teamCards.id, userCardId: teamCards.userCardId }).from(teamCards).where(eq(teamCards.teamId, teamId));
  // A card dealt twice files as one row, so keep the first dealt id — the same
  // one the team build and the assembly screen keep.
  const draftByUserCard = new Map<number, string>();
  for (const [cardId, userCardId] of Object.entries(state.cardFiling ?? {})) {
    if (!draftByUserCard.has(userCardId)) draftByUserCard.set(userCardId, cardId);
  }
  const out = new Map<string, string>();
  for (const link of links) {
    const cardId = draftByUserCard.get(link.userCardId);
    if (cardId !== undefined) out.set(String(link.id), cardId);
  }
  return out;
}

/** A lineup in team-card ids, read as draft card ids. Null if any id is unknown. */
function toCardSpace(lineup: SavedLineup, byTeamCard: Map<string, string>): SavedLineup | null {
  const ids = lineup.lineup.map((id) => byTeamCard.get(id));
  const pitcher = byTeamCard.get(lineup.startingPitcherId);
  const fields: Partial<Record<Position, string>> = {};
  for (const [pos, id] of Object.entries(lineup.fieldPositions)) {
    const mapped = byTeamCard.get(id as string);
    if (mapped === undefined) return null;
    fields[pos as Position] = mapped;
  }
  if (ids.some((id) => id === undefined) || pitcher === undefined) return null;
  return { lineup: ids as string[], fieldPositions: fields, startingPitcherId: pitcher };
}

/** The inverse: a lineup in draft card ids, read as team-card ids. */
function fromCardSpace(lineup: SavedLineup, byDraftCard: Map<string, string>): SavedLineup | null {
  const ids = lineup.lineup.map((id) => byDraftCard.get(id));
  const pitcher = byDraftCard.get(lineup.startingPitcherId);
  const fields: Partial<Record<Position, string>> = {};
  for (const [pos, id] of Object.entries(lineup.fieldPositions)) {
    const mapped = byDraftCard.get(id as string);
    if (mapped === undefined) return null;
    fields[pos as Position] = mapped;
  }
  if (ids.some((id) => id === undefined) || pitcher === undefined) return null;
  return { lineup: ids as string[], fieldPositions: fields, startingPitcherId: pitcher };
}

async function toView(
  ctx: Ctx,
  row: DraftRow,
  seatOfUser: number | null,
  participants: DraftParticipant[],
  state: DraftState,
): Promise<Omit<DraftView, 'tournamentId'>> {
  const seats = participants.length;
  const myKey = seatOfUser === null ? null : String(seatOfUser);
  const pickCounts: Record<string, number> = {};
  for (let seat = 0; seat < seats; seat++) pickCounts[String(seat)] = state.picks[String(seat)]?.length ?? 0;

  const myPicks = myKey ? (state.picks[myKey] ?? []) : [];
  const myPack = myKey ? (state.packs[myKey] ?? []) : [];
  const opened = seatOfUser !== null && state.opened.includes(seatOfUser);

  const seatPicks: DraftSeatPicks[] = participants.map((p) => ({
    seat: p.seat,
    userId: p.userId,
    name: p.name,
    isHost: p.isHost,
    picks: state.picks[String(p.seat)] ?? [],
    lineupReady: state.assembled.includes(p.seat),
  }));

  // The viewer's side of the series: the games they won, and whether the
  // winner's pack choice is still waiting on them.
  const myKeeps: Record<string, string | null> = {};
  const pending: number[] = [];
  if (seatOfUser !== null) {
    for (const game of state.games) {
      if (game.winnerSeat !== seatOfUser) continue;
      myKeeps[String(game.gameId)] = state.keeps[String(game.gameId)]?.cardId ?? null;
      if (state.packChoices[String(game.gameId)] === undefined) pending.push(game.gameId);
    }
  }

  return {
    id: row.id,
    phase: row.status as DraftView['phase'],
    config: parseConfig(row),
    hostUserId: row.hostUserId,
    participants,
    round: state.round,
    waitingOn: state.waitingOn,
    passDirection: passDirection(state.round),
    myPack,
    myPackTheme: myKey && myPack.length > 0 ? (state.packThemes[myKey] ?? 'mixed') : null,
    myPackOpened: opened,
    iHavePicked: seatOfUser !== null && row.status === 'active' && !state.waitingOn.includes(seatOfUser),
    myPicks,
    myTally: tally(myPicks),
    pickCounts,
    seats: seatPicks,
    myLineup: await lineupInCardSpace(ctx, state, seatOfUser),
    gameId: state.seriesGameId,
    games: [...state.games].reverse(),
    myKeeps,
    myPendingChoice: pending.length > 0 ? Math.min(...pending) : null,
    log: state.log.slice(-60),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadParticipants(ctx: Ctx, draftId: number) {
  return ctx.db
    .select({ userId: draftParticipants.userId, seat: draftParticipants.seat })
    .from(draftParticipants)
    .where(eq(draftParticipants.draftId, draftId))
    .orderBy(asc(draftParticipants.seat));
}

async function loadRow(ctx: Ctx, draftId: number): Promise<DraftRow> {
  const [row] = await ctx.db.select().from(drafts).where(eq(drafts.id, draftId)).limit(1);
  if (!row) throw notFound('Draft not found');
  return row;
}

/** Persist a new draft state with an optimistic version check, as games are saved. */
async function saveDraft(ctx: Ctx, row: DraftRow, state: DraftState, status: string = row.status): Promise<DraftRow> {
  const [updated] = await ctx.db
    .update(drafts)
    .set({ state, status, version: row.version + 1, updatedAt: new Date() })
    .where(and(eq(drafts.id, row.id), eq(drafts.version, row.version)))
    .returning();
  if (!updated) throw new HttpError(409, 'The draft moved on — refresh and try again');
  broadcast(ctx, updated);
  return updated;
}

/** The tournament that owns this draft room, if any: it drives its own post-draft flow. */
async function draftOwner(ctx: Ctx, draftId: number): Promise<number | null> {
  const [owner] = await ctx.db.select({ id: tournaments.id }).from(tournaments).where(eq(tournaments.draftId, draftId)).limit(1);
  return owner?.id ?? null;
}

async function viewOf(ctx: Ctx, row: DraftRow, userId: number): Promise<DraftView> {
  const seatRows = await loadParticipants(ctx, row.id);
  const names = await namesFor(ctx, [row.hostUserId, ...seatRows.map((s) => s.userId)]);
  const participants = participantsOf(seatRows, row.hostUserId, names);
  const mine = participants.find((p) => p.userId === userId);
  return { ...(await toView(ctx, row, mine?.seat ?? null, participants, parseState(row))), tournamentId: await draftOwner(ctx, row.id) };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface CreateDraftInput {
  rounds: number;
  packSize: number;
  yearFrom: number;
  yearTo: number;
  playableOnly: boolean;
  /** theme ids as they came off the wire; unknown ones are dropped */
  themes?: readonly string[];
  rarityCaps?: { rare: number; star: number; mythic: number } | null;
  /** regulation innings the series' games are played to */
  regulationInnings?: number;
}

function validateConfig(input: CreateDraftInput): DraftConfig {
  if (!Number.isInteger(input.rounds) || input.rounds < 1 || input.rounds > MAX_ROUNDS) {
    throw badRequest(`Rounds must be between 1 and ${MAX_ROUNDS}`);
  }
  if (!Number.isInteger(input.packSize) || input.packSize < MIN_PACK_SIZE || input.packSize > MAX_PACK_SIZE) {
    throw badRequest(`Pack size must be between ${MIN_PACK_SIZE} and ${MAX_PACK_SIZE}`);
  }
  const yearFrom = input.yearFrom ?? input.yearTo;
  const yearTo = input.yearTo ?? input.yearFrom;
  if (!Number.isInteger(yearFrom) || !Number.isInteger(yearTo) || yearFrom < MIN_YEAR || yearTo > MAX_YEAR) {
    throw badRequest('Pick a real range of card years');
  }
  if (yearTo < yearFrom) throw badRequest('The era has to end after it starts');
  if (yearTo - yearFrom > 60) throw badRequest('Keep the era to 60 years or fewer, so the packs stay of one time');

  const offered = new Set(packThemesForYears(yearFrom, yearTo).map((t) => t.id));
  const themes = [...new Set(input.themes ?? [])].filter((t): t is PackThemeId => PACK_THEME_IDS.includes(t as PackThemeId));
  const dropped = themes.filter((t) => !offered.has(t));
  if (dropped.length > 0) {
    throw badRequest(`${dropped.map((t) => packTheme(t).name).join(', ')} ${dropped.length === 1 ? 'is' : 'are'} not dealt in ${yearFrom}–${yearTo}`);
  }

  const rawCaps = input.rarityCaps ?? null;
  let rarityCaps: DraftConfig['rarityCaps'] = null;
  if (rawCaps) {
    const rare = Number.isInteger(rawCaps.rare) ? rawCaps.rare : 0;
    const star = Number.isInteger(rawCaps.star) ? rawCaps.star : 0;
    const mythic = Number.isInteger(rawCaps.mythic) ? rawCaps.mythic : 0;
    if (rare < 0 || rare > MAX_RARE || star < 0 || star > MAX_STAR || mythic < 0 || mythic > MAX_MYTHIC) {
      throw badRequest('That rarity cap is out of range');
    }
    // A cap of zero would make every card of that tier undraftable; treat it as no cap.
    if (rare > 0 || star > 0 || mythic > 0) {
      rarityCaps = { rare: rare > 0 ? rare : MAX_RARE, star: star > 0 ? star : MAX_STAR, mythic: mythic > 0 ? mythic : MAX_MYTHIC };
    }
  }

  return {
    rounds: input.rounds,
    packSize: input.packSize,
    cardYear: yearTo,
    yearFrom,
    yearTo,
    playableOnly: input.playableOnly,
    themes: themes.length > 0 ? themes : ['mixed'],
    rarityCaps,
    regulationInnings: input.regulationInnings ?? 9,
  };
}

export async function createDraft(ctx: Ctx, user: AuthUser, input: CreateDraftInput): Promise<DraftView> {
  const config = validateConfig(input);
  // Fail fast if a pack can't be dealt, instead of mid-draft.
  for (const theme of config.themes) await dealPack(ctx, config, 1, theme);
  // And if the era could never field a team, since field insurance tops every
  // seat up out of this same pool when the last pack empties.
  const fieldable = await dealFieldInsurance(ctx, config, { starters: 1, bats: 9 });
  if (fieldable.length < 10) {
    const missing = fieldable.some((c) => c.starter) ? 'not enough distinct bats' : 'no starting pitcher';
    throw badRequest(`That era cannot deal a team that can take the field — ${missing} — so widen ${config.yearFrom}–${config.yearTo}`);
  }

  const state = freshState([{ seq: 1, text: `${user.displayName} opened the room.` }]);
  const [row] = await ctx.db
    .insert(drafts)
    .values({ hostUserId: user.id, status: 'lobby', config, state })
    .returning();
  await ctx.db.insert(draftParticipants).values({ draftId: row!.id, userId: user.id, seat: 0 });
  return viewOf(ctx, row!, user.id);
}

export async function listDrafts(ctx: Ctx, user: AuthUser): Promise<DraftListItem[]> {
  const rows = await ctx.db.select().from(drafts).orderBy(desc(drafts.updatedAt)).limit(50);
  // A tournament owns its draft room: seats come through the tournament, so
  // the room stays off the public list.
  const owned = new Set(
    (await ctx.db
      .select({ draftId: tournaments.draftId })
      .from(tournaments)
      .where(isNotNull(tournaments.draftId)))
      .map((t) => t.draftId)
      .filter((id): id is number => id !== null),
  );
  const names = await namesFor(ctx, rows.map((r) => r.hostUserId));
  const items: DraftListItem[] = [];
  for (const row of rows) {
    if (owned.has(row.id)) continue;
    const seats = await loadParticipants(ctx, row.id);
    const config = parseConfig(row);
    items.push({
      id: row.id,
      phase: row.status as DraftListItem['phase'],
      cardYear: config.cardYear,
      yearFrom: config.yearFrom,
      yearTo: config.yearTo,
      rounds: config.rounds,
      packSize: config.packSize,
      themes: config.themes,
      hostName: names.get(row.hostUserId) ?? '?',
      seats: MAX_SEATS,
      seatsFilled: seats.length,
      isMine: seats.some((s) => s.userId === user.id),
      updatedAt: row.updatedAt.toISOString(),
    });
  }
  return items;
}

export async function getDraft(ctx: Ctx, user: AuthUser, draftId: number): Promise<DraftView> {
  return viewOf(ctx, await loadRow(ctx, draftId), user.id);
}

export function joinDraft(ctx: Ctx, user: AuthUser, draftId: number): Promise<DraftView> {
  return withLock(draftId, () => joinUnlocked(ctx, user, draftId));
}

export function startDraft(ctx: Ctx, user: AuthUser, draftId: number): Promise<DraftView> {
  return withLock(draftId, () => startUnlocked(ctx, user, draftId));
}

export function pickCard(ctx: Ctx, user: AuthUser, draftId: number, cardId: string): Promise<DraftView> {
  return withLock(draftId, () => pickUnlocked(ctx, user, draftId, cardId));
}

async function joinUnlocked(ctx: Ctx, user: AuthUser, draftId: number): Promise<DraftView> {
  const row = await loadRow(ctx, draftId);
  const seats = await loadParticipants(ctx, draftId);
  if (seats.some((s) => s.userId === user.id)) return viewOf(ctx, row, user.id);
  if (row.status !== 'lobby') throw badRequest('That draft has already started');
  if (seats.length >= MAX_SEATS) throw badRequest(`Drafts hold at most ${MAX_SEATS} managers`);

  await ctx.db.insert(draftParticipants).values({ draftId, userId: user.id, seat: seats.length });
  const state = parseState(row);
  state.log.push({ seq: state.log.length + 1, text: `${user.displayName} took seat ${seats.length + 1}.` });
  const updated = await saveDraft(ctx, row, state);
  return viewOf(ctx, updated, user.id);
}

async function startUnlocked(ctx: Ctx, user: AuthUser, draftId: number): Promise<DraftView> {
  const row = await loadRow(ctx, draftId);
  if (row.hostUserId !== user.id) throw forbidden('Only the host can start the draft');
  if (row.status !== 'lobby') throw badRequest('That draft already started');

  const seats = await loadParticipants(ctx, draftId);
  if (seats.length < MIN_SEATS) throw badRequest(`A draft needs at least ${MIN_SEATS} managers`);

  const config = parseConfig(row);
  const state = freshState(parseState(row).log);
  state.packs = await dealAllPacks(ctx, config, seats.length, 1, state);
  state.packThemes = themesForSeats(config, seats.length, 1);
  state.waitingOn = seatsWithCards(state.packs, seats.length);
  state.picks = Object.fromEntries(seats.map((s) => [String(s.seat), []]));
  const first = packTheme(themeForRound(config.themes, 1, 0));
  state.log.push({
    seq: state.log.length + 1,
    text: `Pack 1 of ${config.rounds} is on the table — ${first.name.toLowerCase()}, ${config.packSize} cards each. Tear yours open, take one, then pass ${passDirection(1)}.`,
  });
  const updated = await saveDraft(ctx, row, state, 'active');
  return viewOf(ctx, updated, user.id);
}

export function openPack(ctx: Ctx, user: AuthUser, draftId: number): Promise<DraftView> {
  return withLock(draftId, () => openUnlocked(ctx, user, draftId));
}

/** Tear the wrapper off the pack in front of you, revealing its cards. */
async function openUnlocked(ctx: Ctx, user: AuthUser, draftId: number): Promise<DraftView> {
  const row = await loadRow(ctx, draftId);
  if (row.status !== 'active') throw badRequest('That draft is not running');

  const seats = await loadParticipants(ctx, draftId);
  const me = seats.find((s) => s.userId === user.id);
  if (!me) throw forbidden('You are not in this draft');
  const state = parseState(row);
  if ((state.packs[String(me.seat)] ?? []).length === 0) throw badRequest('You are not holding a pack');
  if (state.opened.includes(me.seat)) return viewOf(ctx, row, user.id);

  state.opened.push(me.seat);
  const updated = await saveDraft(ctx, row, state);
  return viewOf(ctx, updated, user.id);
}

/**
 * File a drafted card into the manager's sandbox: playable on the team built
 * from these picks, but not in the binder until they keep it.
 */
async function filePickedCard(db: Executor, userId: number, card: DraftCard): Promise<number> {
  return fileCardIntoCollection(db, {
    userId,
    personId: card.personId,
    cardYear: card.cardYear,
    setLabel: 'Draft',
    rarity: card.rarity,
    source: 'draft',
    sandbox: true,
    notes: `Drafted (${card.rarity})`,
  });
}

async function pickUnlocked(ctx: Ctx, user: AuthUser, draftId: number, cardId: string): Promise<DraftView> {
  const row = await loadRow(ctx, draftId);
  if (row.status !== 'active') throw badRequest('That draft is not running');

  const seats = await loadParticipants(ctx, draftId);
  const state = parseState(row);
  const me = seats.find((s) => s.userId === user.id);
  if (!me) throw forbidden('You are not in this draft');
  if (!state.opened.includes(me.seat)) throw badRequest('Open your pack first');
  if (!state.waitingOn.includes(me.seat)) throw badRequest('You already took a card from this pack. Wait for the pass.');

  const key = String(me.seat);
  const pack = state.packs[key] ?? [];
  const index = pack.findIndex((c) => c.id === cardId);
  if (index < 0) throw badRequest('That card is not in your pack');

  const blocked = capBlocks(parseConfig(row).rarityCaps, state.picks[key] ?? [], pack[index]!);
  if (blocked) throw badRequest(`${blocked} — this draft caps it. Take another card.`);

  const [card] = pack.splice(index, 1);
  state.picks[key] = [...(state.picks[key] ?? []), card!];

  const seatCount = seats.length;
  const log = (text: string) => state.log.push({ seq: state.log.length + 1, text });
  const packAt = (seat: number) => state.packs[String(seat)] ?? [];

  log(`${user.displayName} took ${card!.name} (${card!.rarity}).`);
  state.waitingOn = state.waitingOn.filter((seat) => seat !== me.seat);

  let status: string = 'active';
  // Field insurance dealt as the last pack empties, filed with the last pick.
  let insurance: { userId: number; card: DraftCard }[] = [];
  // The last pack of the last round: every seat's picks become their team.
  let assembling = false;
  if (state.waitingOn.length === 0) {
    // Everyone has picked: pass every pack one seat along together, wrapper and all.
    const step = passDirection(state.round) === 'left' ? 1 : seatCount - 1;
    const passed: Record<string, DraftCard[]> = {};
    const passedThemes: Record<string, PackThemeId> = {};
    for (let seat = 0; seat < seatCount; seat++) {
      const target = (seat + step) % seatCount;
      passed[String(target)] = packAt(seat);
      passedThemes[String(target)] = state.packThemes[String(seat)] ?? 'mixed';
    }
    state.packs = passed;
    state.packThemes = passedThemes;
    state.opened = [];
    state.waitingOn = seatsWithCards(state.packs, seatCount);

    if (state.waitingOn.length === 0) {
      const config = parseConfig(row);
      if (state.round >= config.rounds) {
        state.packs = {};
        state.packThemes = {};
        log("That's the last pack — draft complete.");
        // No seat leaves a finished draft unable to field a team.
        insurance = await topUpForFielding(ctx, row, seats, state);
        state.dealtPersonIds.push(...insurance.map((deal) => deal.card.personId));
        if (await draftOwner(ctx, row.id)) {
          // A tournament drives its own post-draft flow: it reads 'finished'
          // and builds its rosters itself.
          status = 'finished';
        } else {
          status = 'assembling';
          assembling = true;
          log('Cards drafted — build your lineup.');
        }
      } else {
        state.round += 1;
        state.packs = await dealAllPacks(ctx, config, seatCount, state.round, state);
        state.packThemes = themesForSeats(config, seatCount, state.round);
        state.opened = [];
        state.waitingOn = seatsWithCards(state.packs, seatCount);
        log(`Pack ${state.round} of ${config.rounds} is on the table. This one passes ${passDirection(state.round)}.`);
      }
    }
  }

  // File the card and save the pick in one transaction: a failure between the
  // two can no longer leave the card in the sandbox and still in the pack. The
  // insurance cards ride along, so a topped-up seat owns what it was dealt.
  const updated = await ctx.db.transaction(async (tx) => {
    state.cardFiling[card!.id] = await filePickedCard(tx, user.id, card!);
    for (const deal of insurance) state.cardFiling[deal.card.id] = await filePickedCard(tx, deal.userId, deal.card);
    if (assembling) await buildDraftTeams(ctxOn(tx), seats, state);
    const [saved] = await tx
      .update(drafts)
      .set({ state, status, version: row.version + 1, updatedAt: new Date() })
      .where(and(eq(drafts.id, row.id), eq(drafts.version, row.version)))
      .returning();
    if (!saved) throw new HttpError(409, 'The draft moved on — refresh and try again');
    return saved;
  });
  broadcast(ctx, updated);
  return viewOf(ctx, updated, user.id);
}

// ---------------------------------------------------------------------------
// The series
// ---------------------------------------------------------------------------

/**
 * A ctx-shaped handle over any executor, so team building can run inside the
 * transaction that files the last pick.
 */
function ctxOn(db: Executor): Ctx {
  return { db: db as Ctx['db'], io: null };
}

/**
 * Build one manager's team from exactly the cards they drafted, with a lineup
 * filled in for them. The team is kept even when it cannot take the field, so
 * its manager can see why; a sandbox card is filed per (user, player, year),
 * so the draft's own filing map is the reliable way back to it.
 */
export async function buildTeamFromPicks(
  ctx: Ctx,
  opts: { userId: number; name: string; drafted: DraftCard[]; cardFiling?: Record<string, number> },
): Promise<{ teamId: number; problem: string | null } | null> {
  if (opts.drafted.length === 0) return null;
  const sandbox = await ctx.db
    .select({ id: userCards.id, personId: cardModels.personId, cardYear: cardModels.cardYear })
    .from(userCards)
    .innerJoin(cardModels, eq(cardModels.id, userCards.cardModelId))
    .where(and(eq(userCards.userId, opts.userId), eq(userCards.sandbox, true)));
  const byPair = new Map(sandbox.map((o) => [`${o.personId}:${o.cardYear}`, o.id]));

  // The same card can come up twice in a draft; a team carries one of each.
  const filed = opts.cardFiling ?? {};
  const userCardIds = [...new Set(opts.drafted.map((c) => filed[c.id] ?? byPair.get(`${c.personId}:${c.cardYear}`)))].filter(
    (id): id is number => id !== undefined,
  );
  if (userCardIds.length === 0) return null;

  const [team] = await ctx.db
    .insert(teams)
    .values({ userId: opts.userId, name: opts.name.slice(0, 40), tournamentId: null })
    .returning();
  await ctx.db.insert(teamCards).values(userCardIds.map((userCardId) => ({ teamId: team!.id, userCardId }))).onConflictDoNothing();

  // Fill in a lineup so the manager can go straight to the field; they can
  // change it from the draft room like any other team. A drafted roster can't
  // go shopping for a center fielder, so out-of-position is allowed.
  const loaded = await loadTeam(ctx, team!.id);
  const auto = autoLineup(rosterCards(loaded.roster), undefined, { outOfPosition: true });
  if ('error' in auto) return { teamId: team!.id, problem: auto.error };
  await ctx.db.update(teams).set({ lineup: auto.lineup }).where(eq(teams.id, team!.id));
  return { teamId: team!.id, problem: null };
}

/** Every seat's team, built the moment the last pack empties. */
async function buildDraftTeams(ctx: Ctx, seats: { userId: number; seat: number }[], state: DraftState): Promise<void> {
  const names = await namesFor(ctx, seats.map((s) => s.userId));
  for (const { userId, seat } of seats) {
    const manager = names.get(userId) ?? `Seat ${seat + 1}`;
    const built = await buildTeamFromPicks(ctx, {
      userId,
      name: `${manager} · Draft`,
      drafted: state.picks[String(seat)] ?? [],
      cardFiling: state.cardFiling,
    });
    const log = (text: string) => state.log.push({ seq: state.log.length + 1, text });
    if (built === null) {
      log(`${manager} drafted nothing that can take the field.`);
      continue;
    }
    state.teams[String(seat)] = built.teamId;
    if (built.problem) log(`${manager} can't field a team (${built.problem}).`);
  }
}

/**
 * The next game of the series: an ordinary remote game between seats 1 and 2
 * on the teams they drafted, under the draft's era and caps. The two managers
 * then use the room's own ready-then-play flow, like any other remote game.
 */
async function startSeriesGame(
  ctx: Ctx,
  row: DraftRow,
  seats: { userId: number; seat: number }[],
  state: DraftState,
  config: DraftConfig,
): Promise<{ gameId: number } | { reason: string }> {
  const sides: { seat: number; teamId: number; loaded: LoadedTeam; setup: TeamSetup }[] = [];
  for (const [i, seat] of SERIES_SEATS.entries()) {
    const teamId = state.teams[String(seat)];
    if (teamId === undefined || !seats.some((s) => s.seat === seat)) return { reason: `seat ${seat + 1} has no team` };
    try {
      const loaded = await loadTeam(ctx, teamId);
      const setup = teamSetupFor(loaded, i === 0 ? 'h' : 'g', { userId: loaded.team.userId, isBot: false, outOfPosition: true });
      sides.push({ seat, teamId, loaded, setup });
    } catch (err) {
      return { reason: err instanceof Error ? err.message : `seat ${seat + 1} cannot take the field` };
    }
  }
  const [first, second] = sides as [(typeof sides)[number], (typeof sides)[number]];
  const match: MatchRules = {
    yearFrom: config.yearFrom,
    yearTo: config.yearTo,
    rarityCaps: config.rarityCaps,
    outOfPosition: true,
  };

  let created: ReturnType<typeof createGame>;
  try {
    created = createGame(
      {
        id: `d${row.id}-${state.games.length}-${first.seat}-${second.seat}`,
        mode: 'remote',
        regulationInnings: config.regulationInnings,
        pacedPitch: true,
        // Snapshot the commissioner's rules into the series game.
        rules: activeHouseRules(),
        match,
        teams: [first.setup, second.setup],
      },
      cryptoRng(),
    );
  } catch (err) {
    return { reason: err instanceof Error ? err.message : 'the teams cannot take the field' };
  }

  // The dice decide who is home, not the seat order, so read the seats back
  // off the created game: the series records the winner by seat, and the
  // reward follows the winner.
  const home = created.state.home.userId === first.loaded.team.userId ? first : second;
  const away = home === first ? second : first;
  const room: StoredGame = {
    engine: created.state,
    hostUserId: home.loaded.team.userId,
    hostTeamId: home.teamId,
    guestUserId: away.loaded.team.userId,
    photos: { ...photoMap(home.loaded.roster, 'h'), ...photoMap(away.loaded.roster, 'g') },
    ready: [],
  };
  const [game] = await ctx.db
    .insert(games)
    .values({
      mode: 'remote',
      regulationInnings: config.regulationInnings,
      matchRules: match,
      homeUserId: home.loaded.team.userId,
      awayUserId: away.loaded.team.userId,
      homeTeamId: home.teamId,
      awayTeamId: away.teamId,
      status: created.state.phase,
      state: room,
      draftId: row.id,
    })
    .returning();
  if (created.events.length) {
    await ctx.db.insert(gameEvents).values(
      created.events.map((e) => ({ gameId: game!.id, seq: e.seq, inning: e.inning, half: e.half, kind: e.kind, text: e.text, data: e })),
    );
  }

  state.seriesGameId = game!.id;
  state.games.push({ gameId: game!.id, homeSeat: home.seat, awaySeat: away.seat, homeScore: 0, awayScore: 0, winnerSeat: null });
  state.log.push({ seq: state.log.length + 1, text: `The series is on — game ${state.games.length}.` });
  if (seats.length > 2) {
    state.log.push({ seq: state.log.length + 1, text: `Seats 1 and 2 play the series; the rest of the table watches.` });
  }
  return { gameId: game!.id };
}

/**
 * The draft's half of a finished series game: record the result, pay the loser
 * a consolation pack, and leave the winner's bonus waiting on them. Runs under
 * the draft's lock and checks the result is not recorded yet, so a crash and a
 * replay cannot pay the same game twice.
 */
export async function recordDraftSeriesResult(
  ctx: Ctx,
  draftId: number,
  result: { gameId: number; homeScore: number; awayScore: number; winner: Side | null },
): Promise<void> {
  await withLock(draftId, async () => {
    const row = await loadRow(ctx, draftId);
    const state = parseState(row);
    const game = state.games.find((g) => g.gameId === result.gameId);
    if (!game || game.winnerSeat !== null || result.winner === null) return;

    game.winnerSeat = result.winner === 'home' ? game.homeSeat : game.awaySeat;
    game.homeScore = result.homeScore;
    game.awayScore = result.awayScore;
    const loserSeat = result.winner === 'home' ? game.awaySeat : game.homeSeat;

    const seats = await loadParticipants(ctx, draftId);
    const names = await namesFor(ctx, seats.map((s) => s.userId));
    const label = (seat: number) => {
      const holder = seats.find((s) => s.seat === seat);
      return holder ? (names.get(holder.userId) ?? `seat ${seat + 1}`) : `seat ${seat + 1}`;
    };
    const index = state.games.indexOf(game) + 1;
    state.log.push({
      seq: state.log.length + 1,
      text: `Game ${index} final: ${label(game.winnerSeat)} ${Math.max(result.homeScore, result.awayScore)}, ${label(loserSeat)} ${Math.min(result.homeScore, result.awayScore)}.`,
    });

    // The loser is paid on the spot; the winner chooses their own wrapper.
    const loser = seats.find((s) => s.seat === loserSeat);
    if (loser) {
      const config = parseConfig(row);
      await grantPacks(
        ctx.db,
        loser.userId,
        [{ themeId: 'mixed', size: 5, source: 'draft-runner-up', label: 'Draft series loss', era: { from: config.yearFrom, to: config.yearTo } }],
        `draft:${draftId}:${result.gameId}:runner-up`,
      );
      state.log.push({ seq: state.log.length + 1, text: `${label(loserSeat)} takes a consolation pack.` });
    }
    await saveDraft(ctx, row, state);
  });
}

/** The assembly screen: this seat's drafted cards, a suggested lineup, and the saved one. */
export async function getDraftTeam(ctx: Ctx, user: AuthUser, draftId: number): Promise<DraftTeamView> {
  const row = await loadRow(ctx, draftId);
  if (row.status === 'lobby' || row.status === 'active') throw badRequest('The draft is still dealing');
  const seats = await loadParticipants(ctx, draftId);
  const me = seats.find((s) => s.userId === user.id);
  if (!me) throw forbidden('You are not in this draft');

  const state = parseState(row);
  const cards = await draftTeamCards(ctx, state, me.seat);
  const auto = autoLineup(
    cards.map((c) => ({ id: c.card.id, card: c.snapshot })),
    undefined,
    { outOfPosition: true },
  );
  return { cards, suggested: 'error' in auto ? null : auto.lineup, lineup: await lineupInCardSpace(ctx, state, me.seat) };
}

/**
 * A seat's drafted cards with their full stats, deduped by player the way the
 * team itself is. Built from the picks, so it also answers for a legacy room
 * that finished before teams existed.
 */
async function draftTeamCards(ctx: Ctx, state: DraftState, seat: number): Promise<DraftTeamCard[]> {
  const picks = state.picks[String(seat)] ?? [];
  if (picks.length === 0) return [];
  const personRows = await ctx.db.select().from(people).where(inArray(people.id, [...new Set(picks.map((p) => p.personId))]));
  const seasonRows = await loadWindowSeasons(ctx, picks.map((p) => ({ personId: p.personId, cardYear: p.cardYear })));
  const byId = new Map(personRows.map((p) => [p.id, p]));

  const out: DraftTeamCard[] = [];
  const seen = new Set<string>();
  for (const card of picks) {
    const pair = `${card.personId}:${card.cardYear}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    const person = byId.get(card.personId);
    if (!person) continue;
    out.push({ card, snapshot: buildCard(person, seasonRows, card.cardYear) });
  }
  return out;
}

/** Lock in this seat's lineup for the series, in draft card id space. */
export async function setDraftLineup(ctx: Ctx, user: AuthUser, draftId: number, lineup: SavedLineup): Promise<DraftView> {
  return withLock(draftId, async () => {
    const row = await loadRow(ctx, draftId);
    if (row.status === 'lobby' || row.status === 'active') throw badRequest('The draft is still dealing');
    const seats = await loadParticipants(ctx, draftId);
    const me = seats.find((s) => s.userId === user.id);
    if (!me) throw forbidden('You are not in this draft');
    const state = parseState(row);
    const teamId = state.teams[String(me.seat)];
    if (teamId === undefined) throw badRequest('This draft has no team to assemble');

    // Validate in the team's own id space, with the same checker a team save
    // uses — a drafted roster may start a fielder out of position.
    const loaded = await loadTeam(ctx, teamId);
    const byTeamCard = await cardIdsByTeamCard(ctx, state, teamId);
    const translated = fromCardSpace(lineup, new Map([...byTeamCard].map(([teamCard, card]) => [card, teamCard])));
    if (!translated) throw badRequest('That lineup names a card that is not on your drafted team');
    const problem = lineupProblem(loaded, translated, activeHouseRules(), true);
    if (problem) throw badRequest(problem);
    await ctx.db.update(teams).set({ lineup: translated }).where(eq(teams.id, teamId));

    if (!state.assembled.includes(me.seat)) {
      state.assembled.push(me.seat);
      state.log.push({ seq: state.log.length + 1, text: `${user.displayName} locked in their lineup.` });
    }
    // Both series seats are ready and no game is on the field: deal one.
    let status = row.status;
    if (state.seriesGameId === null && SERIES_SEATS.every((seat) => state.assembled.includes(seat))) {
      const started = await startSeriesGame(ctx, row, seats, state, parseConfig(row));
      if ('reason' in started) state.log.push({ seq: state.log.length + 1, text: `The series can't start yet — ${started.reason}.` });
      else status = 'playing';
    }
    return viewOf(ctx, await saveDraft(ctx, row, state, status), user.id);
  });
}

/** Deal the series a new game with the same drafted teams. */
export async function rematchDraft(ctx: Ctx, user: AuthUser, draftId: number): Promise<{ draft: DraftView; gameId: number }> {
  return withLock(draftId, async () => {
    const row = await loadRow(ctx, draftId);
    const seats = await loadParticipants(ctx, draftId);
    if (!seats.some((s) => s.userId === user.id)) throw forbidden('You are not in this draft');
    const state = parseState(row);
    if (state.seriesGameId === null) throw badRequest('The series has not started yet');
    const [game] = await ctx.db.select({ id: games.id, status: games.status }).from(games).where(eq(games.id, state.seriesGameId)).limit(1);
    if (!game) throw badRequest('The series game is gone');
    if (game.status !== 'finished') throw badRequest('Finish the game in front of you first');

    const started = await startSeriesGame(ctx, row, seats, state, parseConfig(row));
    if ('reason' in started) throw badRequest(`The rematch can't be dealt — ${started.reason}`);
    return { draft: await viewOf(ctx, await saveDraft(ctx, row, state), user.id), gameId: started.gameId };
  });
}

/** The winner of a series game files one card from their drafted team. */
export async function keepDraftCard(ctx: Ctx, user: AuthUser, draftId: number, gameId: number, cardId: string): Promise<DraftView> {
  return withLock(draftId, async () => {
    const row = await loadRow(ctx, draftId);
    const seats = await loadParticipants(ctx, draftId);
    const me = seats.find((s) => s.userId === user.id);
    if (!me) throw forbidden('You are not in this draft');
    const state = parseState(row);
    const game = state.games.find((g) => g.gameId === gameId);
    if (!game) throw badRequest('That game is not part of this series');
    if (game.winnerSeat !== me.seat) throw forbidden('Only the winner of that game keeps a card');
    if (state.keeps[String(gameId)]) throw badRequest('You already kept a card from that game');

    const card = (state.picks[String(me.seat)] ?? []).find((c) => c.id === cardId);
    if (!card) throw badRequest('That card is not in your drafted team');
    const sandboxId = await sandboxRowId(ctx, user.id, card, state);
    if (sandboxId === undefined) throw badRequest('That card is not in your draft sandbox');

    const userCardId = await keepSandboxCard(ctx.db, user.id, sandboxId);
    state.keeps[String(gameId)] = { userId: user.id, cardId, userCardId };
    state.log.push({ seq: state.log.length + 1, text: `${user.displayName} kept ${card.name} from game ${state.games.indexOf(game) + 1}.` });
    return viewOf(ctx, await saveDraft(ctx, row, state), user.id);
  });
}

/** The winner of a series game picks the wrapper of their bonus pack. */
export async function chooseDraftPack(ctx: Ctx, user: AuthUser, draftId: number, gameId: number, themeId: string): Promise<DraftView> {
  return withLock(draftId, async () => {
    const row = await loadRow(ctx, draftId);
    const seats = await loadParticipants(ctx, draftId);
    const me = seats.find((s) => s.userId === user.id);
    if (!me) throw forbidden('You are not in this draft');
    const state = parseState(row);
    const game = state.games.find((g) => g.gameId === gameId);
    if (!game) throw badRequest('That game is not part of this series');
    if (game.winnerSeat !== me.seat) throw forbidden('Only the winner of that game chooses a pack');
    if (state.packChoices[String(gameId)]) throw badRequest('You already chose your bonus pack');
    const theme = WINNER_PACK_THEMES.find((t) => t === themeId);
    if (!theme) throw badRequest('Pick one of the offered wrappers');

    const config = parseConfig(row);
    await grantPacks(
      ctx.db,
      user.id,
      [{ themeId: theme, size: 5, source: 'draft-win', label: 'Draft game won', era: { from: config.yearFrom, to: config.yearTo } }],
      `draft:${draftId}:${gameId}:winner`,
    );
    state.packChoices[String(gameId)] = theme;
    state.log.push({ seq: state.log.length + 1, text: `${user.displayName} took the ${theme} pack for game ${state.games.indexOf(game) + 1}.` });
    return viewOf(ctx, await saveDraft(ctx, row, state), user.id);
  });
}

/** The sandbox row a drafted card was filed as, from the map or by its pair. */
async function sandboxRowId(ctx: Ctx, userId: number, card: DraftCard, state: DraftState): Promise<number | undefined> {
  const filed = state.cardFiling?.[card.id];
  if (filed !== undefined) return filed;
  const [row] = await ctx.db
    .select({ id: userCards.id })
    .from(userCards)
    .innerJoin(cardModels, eq(cardModels.id, userCards.cardModelId))
    .where(
      and(
        eq(userCards.userId, userId),
        eq(userCards.sandbox, true),
        eq(cardModels.personId, card.personId),
        eq(cardModels.cardYear, card.cardYear),
      ),
    )
    .limit(1);
  return row?.id;
}

export async function deleteDraft(ctx: Ctx, user: AuthUser, draftId: number): Promise<void> {
  const row = await loadRow(ctx, draftId);
  if (row.hostUserId !== user.id) throw forbidden('Only the host can close the room');
  await ctx.db.delete(drafts).where(eq(drafts.id, draftId));
  ctx.io?.to(`draft:${draftId}`).emit('draft:closed', { draftId });
}

function broadcast(ctx: Ctx, row: DraftRow): void {
  ctx.io?.to(`draft:${row.id}`).emit('draft:update', { draftId: row.id, phase: row.status, updatedAt: row.updatedAt.toISOString() });
}
