import { randomUUID } from 'node:crypto';
import { and, asc, between, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { DraftCard, DraftConfig, DraftListItem, DraftParticipant, DraftRarity, DraftView, PackThemeId } from '@cardball/shared';
import { DRAFT_LIMITS, PACK_THEME_IDS, activeHouseRules, packTheme, packThemesForYears, rateCard, themeForRound } from '@cardball/shared';
import type { PackTheme } from '@cardball/shared';
import { draftParticipants, drafts, people, seasons, tournaments, users } from '@cardball/db';
import type { DraftRow, PersonRow, SeasonRow } from '@cardball/db';
import { fileCardIntoCollection } from './cardFiling.js';
import { buildCard, windowRange } from './cards.js';
import type { CardSnapshot } from './cards.js';
import type { AuthUser } from './auth.js';
import type { Ctx } from './context.js';
import { badRequest, forbidden, notFound } from './http.js';

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

// Commands on one draft run one at a time, so a double-clicked pick can't take two cards.
const locks = new Map<number, Promise<unknown>>();
function withLock<T>(draftId: number, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(draftId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(draftId, next.catch(() => undefined));
  return next;
}

// ---------------------------------------------------------------------------
// The card pool
// ---------------------------------------------------------------------------

/**
 * Deal a themed pack: `count` random players whose card, built on `cardYear`,
 * fits the wrapper's label. Over-fetches, because some candidates turn out to
 * have no usable card or fall outside the theme.
 */
async function dealPackAtYear(ctx: Ctx, cardYear: number, count: number, theme: PackTheme, playableOnly: boolean): Promise<DraftCard[]> {
  const rules = activeHouseRules();
  const { from, to } = windowRange(cardYear, rules);

  const candidates = await ctx.db
    .select({ id: seasons.personId })
    .from(seasons)
    .where(and(between(seasons.year, from, to), gt(seasons.games, 0)))
    .groupBy(seasons.personId)
    .orderBy(sql`random()`)
    // A themed pack throws most of these away — only a fraction of the players
    // in any six-year window had a 30-homer or a 30-steal season — so the
    // sample has to be much wider than the pack.
    .limit(count * 15 + 150);

  if (candidates.length === 0) return [];

  const ids = candidates.map((c) => c.id);
  const personRows = await ctx.db.select().from(people).where(inArray(people.id, ids));
  const seasonRows = await ctx.db
    .select()
    .from(seasons)
    .where(and(inArray(seasons.personId, ids), between(seasons.year, from, to)));

  const seasonsByPerson = new Map<number, SeasonRow[]>();
  for (const row of seasonRows) {
    const list = seasonsByPerson.get(row.personId) ?? [];
    list.push(row);
    seasonsByPerson.set(row.personId, list);
  }

  const pack: DraftCard[] = [];
  const personById = new Map((personRows as PersonRow[]).map((p) => [p.id, p]));
  for (const id of ids) {
    if (pack.length >= count) break;
    const person = personById.get(id);
    if (!person) continue;
    const card = buildCard(person, seasonsByPerson.get(person.id) ?? [], cardYear);
    if (!card.playable && playableOnly) continue;
    const rating = rateCard(card);
    if (!theme.matches(rating)) continue;
    pack.push({
      id: randomUUID(),
      personId: card.personId,
      cardYear: card.cardYear,
      name: card.name,
      teamLabel: card.teamLabel,
      rarity: rating.rarity,
      headline: rating.headline,
      playable: card.playable,
      positions: card.canBat ? card.positions : [],
      starter: card.pitcherClass === 'SP',
    });
  }

  return pack;
}

/** How many card years a pack will try before giving up on filling itself. */
const PACK_YEAR_TRIES = 10;

/**
 * Deal one pack. A pack is built on a single card year drawn from the draft's
 * era, so the whole wrapper is coherent ("a 1973 pack"); the theme decides
 * which of that year's cards are eligible.
 */
async function dealPack(ctx: Ctx, config: DraftConfig, count: number, themeId: PackThemeId): Promise<DraftCard[]> {
  const theme = packTheme(themeId);
  const span = config.yearTo - config.yearFrom + 1;
  let best: DraftCard[] = [];
  for (let attempt = 0; attempt < PACK_YEAR_TRIES; attempt++) {
    const cardYear = config.yearFrom + Math.floor(Math.random() * span);
    const pack = await dealPackAtYear(ctx, cardYear, count, theme, config.playableOnly);
    if (pack.length >= count) return pack;
    if (pack.length > best.length) best = pack;
  }
  if (best.length > 0) return best;
  throw badRequest(
    `No ${theme.name.toLowerCase()} cards to deal from ${config.yearFrom}–${config.yearTo} — widen the era or drop that pack`,
  );
}

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

async function loadNames(ctx: Ctx): Promise<Map<number, string>> {
  const rows = await ctx.db.select({ id: users.id, name: users.displayName }).from(users);
  return new Map(rows.map((r) => [r.id, r.name]));
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

async function viewOf(ctx: Ctx, row: DraftRow, userId: number): Promise<DraftView> {
  const participants = participantsOf(await loadParticipants(ctx, row.id), row.hostUserId, await loadNames(ctx));
  const mine = participants.find((p) => p.userId === userId);
  const [owner] = await ctx.db
    .select({ id: tournaments.id })
    .from(tournaments)
    .where(sql`${tournaments.state}->>'draftId' = ${String(row.id)}`)
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
    (await ctx.db.select({ state: tournaments.state }).from(tournaments))
      .map((t) => (t.state as { draftId: number | null }).draftId)
      .filter((id): id is number => id !== null),
  );
  const names = await loadNames(ctx);
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
  const [updated] = await ctx.db.update(drafts).set({ state, updatedAt: new Date() }).where(eq(drafts.id, draftId)).returning();
  broadcast(ctx, updated!);
  return viewOf(ctx, updated!, user.id);
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
  const [updated] = await ctx.db
    .update(drafts)
    .set({ status: 'active', state, updatedAt: new Date() })
    .where(eq(drafts.id, draftId))
    .returning();
  broadcast(ctx, updated!);
  return viewOf(ctx, updated!, user.id);
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
  const [updated] = await ctx.db.update(drafts).set({ state, updatedAt: new Date() }).where(eq(drafts.id, draftId)).returning();
  broadcast(ctx, updated!);
  return viewOf(ctx, updated!, user.id);
}

/** Move the drafted card into the manager's collection. */
async function filePickedCard(ctx: Ctx, userId: number, card: DraftCard): Promise<void> {
  await fileCardIntoCollection(ctx, {
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
  await filePickedCard(ctx, user.id, card!);

  const seatCount = seats.length;
  const log = (text: string) => state.log.push({ seq: state.log.length + 1, text });
  const packAt = (seat: number) => state.packs[String(seat)] ?? [];

  log(`${user.displayName} took ${card!.name} (${card!.rarity}).`);
  state.waitingOn = state.waitingOn.filter((seat) => seat !== me.seat);

  let status: string = 'active';
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

  const [updated] = await ctx.db
    .update(drafts)
    .set({ state, status, updatedAt: new Date() })
    .where(eq(drafts.id, draftId))
    .returning();
  broadcast(ctx, updated!);
  return viewOf(ctx, updated!, user.id);
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
