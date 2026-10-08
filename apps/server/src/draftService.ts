import { and, asc, desc, eq, isNotNull } from 'drizzle-orm';
import type { DraftCard, DraftConfig, DraftListItem, DraftParticipant, DraftRarity, DraftView, PackThemeId } from '@cardball/shared';
import { DRAFT_LIMITS, PACK_THEME_IDS, packTheme, packThemesForYears, themeForRound } from '@cardball/shared';
import { draftParticipants, drafts, tournaments } from '@cardball/db';
import type { DraftRow } from '@cardball/db';
import { fileCardIntoCollection } from './cardFiling.js';
import { dealFieldInsurance, dealPack } from './packDeal.js';
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
 * Every card taken lands in the manager's collection, so a draft is how a
 * friend group builds collections together.
 *
 * The pool is built from the stats database for one card year: a pack is a
 * random handful of players who appeared in the six seasons before that year.
 */

const { minSeats: MIN_SEATS, maxSeats: MAX_SEATS, maxRounds: MAX_ROUNDS, minPackSize: MIN_PACK_SIZE, maxPackSize: MAX_PACK_SIZE, minYear: MIN_YEAR, maxYear: MAX_YEAR, maxRare: MAX_RARE, maxChase: MAX_CHASE } =
  DRAFT_LIMITS;

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
}

const stored = (row: DraftRow) => row.state as DraftState;

/** Rare and chase cards a manager has taken so far. */
function tally(picks: DraftCard[]): { rare: number; chase: number } {
  return {
    rare: picks.filter((c) => c.rarity === 'rare').length,
    chase: picks.filter((c) => c.rarity === 'chase').length,
  };
}

/** Would taking this card put the manager over one of the draft's rarity caps? */
function capBlocks(caps: DraftConfig['rarityCaps'], picks: DraftCard[], card: DraftCard): string | null {
  if (!caps) return null;
  const have = tally(picks);
  if (card.rarity === 'chase' && have.chase >= caps.chase) return `You already have ${caps.chase} chase card${caps.chase === 1 ? '' : 's'}`;
  if (card.rarity === 'rare' && have.rare >= caps.rare) return `You already have ${caps.rare} rare card${caps.rare === 1 ? '' : 's'}`;
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

async function dealAllPacks(ctx: Ctx, config: DraftConfig, seats: number, round: number): Promise<Record<string, DraftCard[]>> {
  const packs: Record<string, DraftCard[]> = {};
  for (let seat = 0; seat < seats; seat++) {
    packs[String(seat)] = await dealPack(ctx, config, config.packSize, themeForRound(config.themes, round, seat));
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
 * Read a stored config, filling in fields added after the room was created, so
 * rooms from before themed packs still open.
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
    rarityCaps: raw.rarityCaps ?? null,
  };
}

function parseState(row: DraftRow): DraftState {
  const raw = stored(row);
  return { ...raw, packThemes: raw.packThemes ?? {}, opened: raw.opened ?? [], picks: raw.picks ?? {} };
}

function participantsOf(rows: { userId: number; seat: number }[], hostUserId: number, names: Map<number, string>): DraftParticipant[] {
  return [...rows]
    .sort((a, b) => a.seat - b.seat)
    .map((r) => ({ userId: r.userId, seat: r.seat, name: names.get(r.userId) ?? '?', isHost: r.userId === hostUserId }));
}

function toView(row: DraftRow, seatOfUser: number | null, participants: DraftParticipant[], state: DraftState): Omit<DraftView, 'tournamentId'> {
  const seats = participants.length;
  const myKey = seatOfUser === null ? null : String(seatOfUser);
  const pickCounts: Record<string, number> = {};
  for (let seat = 0; seat < seats; seat++) pickCounts[String(seat)] = state.picks[String(seat)]?.length ?? 0;

  const myPicks = myKey ? (state.picks[myKey] ?? []) : [];
  const myPack = myKey ? (state.packs[myKey] ?? []) : [];
  const opened = seatOfUser !== null && state.opened.includes(seatOfUser);

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

async function viewOf(ctx: Ctx, row: DraftRow, userId: number): Promise<DraftView> {
  const seatRows = await loadParticipants(ctx, row.id);
  const names = await namesFor(ctx, [row.hostUserId, ...seatRows.map((s) => s.userId)]);
  const participants = participantsOf(seatRows, row.hostUserId, names);
  const mine = participants.find((p) => p.userId === userId);
  const [owner] = await ctx.db
    .select({ id: tournaments.id })
    .from(tournaments)
    .where(eq(tournaments.draftId, row.id))
    .limit(1);
  return { ...toView(row, mine?.seat ?? null, participants, parseState(row)), tournamentId: owner?.id ?? null };
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
  rarityCaps?: { rare: number; chase: number } | null;
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
    const chase = Number.isInteger(rawCaps.chase) ? rawCaps.chase : 0;
    if (rare < 0 || rare > MAX_RARE || chase < 0 || chase > MAX_CHASE) throw badRequest('That rarity cap is out of range');
    // A cap of zero would make every card of that tier undraftable; treat it as no cap.
    if (rare > 0 || chase > 0) rarityCaps = { rare: rare > 0 ? rare : MAX_RARE, chase: chase > 0 ? chase : MAX_CHASE };
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

  const state: DraftState = {
    round: 1,
    waitingOn: [],
    packs: {},
    packThemes: {},
    opened: [],
    picks: {},
    log: [{ seq: 1, text: `${user.displayName} opened the room.` }],
  };
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
  const packs = await dealAllPacks(ctx, config, seats.length, 1);
  const state: DraftState = {
    round: 1,
    waitingOn: seatsWithCards(packs, seats.length),
    packs,
    packThemes: themesForSeats(config, seats.length, 1),
    opened: [],
    picks: Object.fromEntries(seats.map((s) => [String(s.seat), []])),
    log: parseState(row).log,
  };
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

/** Move the drafted card into the manager's collection. */
async function filePickedCard(db: Executor, userId: number, card: DraftCard): Promise<void> {
  await fileCardIntoCollection(db, {
    userId,
    personId: card.personId,
    cardYear: card.cardYear,
    setLabel: 'Draft',
    rarity: card.rarity,
    source: 'draft',
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
        status = 'finished';
        state.packs = {};
        state.packThemes = {};
        log("That's the last pack — draft complete.");
        // No seat leaves a finished draft unable to field a team.
        insurance = await topUpForFielding(ctx, row, seats, state);
      } else {
        state.round += 1;
        state.packs = await dealAllPacks(ctx, config, seatCount, state.round);
        state.packThemes = themesForSeats(config, seatCount, state.round);
        state.opened = [];
        state.waitingOn = seatsWithCards(state.packs, seatCount);
        log(`Pack ${state.round} of ${config.rounds} is on the table. This one passes ${passDirection(state.round)}.`);
      }
    }
  }

  // File the card and save the pick in one transaction: a failure between the
  // two can no longer leave the card in the collection and still in the pack.
  // The insurance cards ride along, so a topped-up seat owns what it was dealt.
  const updated = await ctx.db.transaction(async (tx) => {
    await filePickedCard(tx, user.id, card!);
    for (const deal of insurance) await filePickedCard(tx, deal.userId, deal.card);
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

export async function deleteDraft(ctx: Ctx, user: AuthUser, draftId: number): Promise<void> {
  const row = await loadRow(ctx, draftId);
  if (row.hostUserId !== user.id) throw forbidden('Only the host can close the room');
  await ctx.db.delete(drafts).where(eq(drafts.id, draftId));
  ctx.io?.to(`draft:${draftId}`).emit('draft:closed', { draftId });
}

function broadcast(ctx: Ctx, row: DraftRow): void {
  ctx.io?.to(`draft:${row.id}`).emit('draft:update', { draftId: row.id, phase: row.status, updatedAt: row.updatedAt.toISOString() });
}
