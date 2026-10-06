import { randomUUID } from 'node:crypto';
import { and, asc, between, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { DraftCard, DraftConfig, DraftListItem, DraftParticipant, DraftRarity, DraftView } from '@cardball/shared';
import { DRAFT_LIMITS, RULES_CONFIG } from '@cardball/shared';
import { draftParticipants, drafts, people, seasons, userCards, users } from '@cardball/db';
import type { DraftRow, PersonRow, SeasonRow } from '@cardball/db';
import { buildCard } from './cards.js';
import type { CardSnapshot } from './cards.js';
import { ensureCardModel } from './routes/cards.js';
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

const { minSeats: MIN_SEATS, maxSeats: MAX_SEATS, maxRounds: MAX_ROUNDS, minPackSize: MIN_PACK_SIZE, maxPackSize: MAX_PACK_SIZE } =
  DRAFT_LIMITS;

/** The per-draft state kept in `drafts.state`. */
interface DraftState {
  /** 1-based round being opened */
  round: number;
  /** seat index whose turn it is */
  turn: number;
  /** pack each seat is holding, keyed by seat index */
  packs: Record<string, DraftCard[]>;
  /** cards each seat has taken, keyed by seat index */
  picks: Record<string, DraftCard[]>;
  log: { seq: number; text: string }[];
}

const stored = (row: DraftRow) => row.state as DraftState;

// ---------------------------------------------------------------------------
// The card pool
// ---------------------------------------------------------------------------

/** How good a card looks, from the same stats the dice read. */
function rateCard(card: CardSnapshot): { rarity: DraftRarity; headline: string } {
  const bestHr = Math.max(0, ...card.seasons.map((s) => s.homeRuns));
  const bestAvg = Math.max(0, ...card.seasons.filter((s) => s.ab >= 100).map((s) => s.avg ?? 0));
  const bestSb = Math.max(0, ...card.seasons.map((s) => s.sb));
  const bestEra = Math.min(
    99,
    ...card.seasons.filter((s) => (s.pitching?.ipOuts ?? 0) >= 30).map((s) => s.pitching?.era ?? 99),
  );

  const batting = `max(${bestHr} HR, .${String(Math.round(bestAvg * 1000)).padStart(3, '0')} AVG)`;
  const pitching = bestEra < 99 ? `${bestEra.toFixed(2)} ERA` : 'no pitching';
  const headline = card.canPitch && !card.canBat ? pitching : card.canPitch ? `${batting} · ${pitching}` : batting;

  let rarity: DraftRarity = 'common';
  if (bestHr >= 40 || bestAvg >= 0.33 || bestEra <= 2.5 || bestSb >= 60) rarity = 'chase';
  else if (bestHr >= 30 || bestAvg >= 0.31 || bestEra <= 3.0 || bestSb >= 40) rarity = 'rare';
  else if (bestHr >= 20 || bestAvg >= 0.29 || bestEra <= 3.75 || bestSb >= 25) rarity = 'uncommon';
  return { rarity, headline };
}

/**
 * Deal a pack: `count` random players who appeared in the card's stat window.
 * Over-fetches, because some candidates turn out to have no usable card.
 */
async function dealPack(ctx: Ctx, config: DraftConfig, count: number): Promise<DraftCard[]> {
  const from = config.cardYear - RULES_CONFIG.statWindowSeasons;
  const to = config.cardYear - 1;

  const candidates = await ctx.db
    .select({ id: seasons.personId })
    .from(seasons)
    .where(and(between(seasons.year, from, to), gt(seasons.games, 0)))
    .groupBy(seasons.personId)
    .orderBy(sql`random()`)
    .limit(count * 4 + 40);

  if (candidates.length === 0) throw badRequest(`No players appeared between ${from} and ${to}`);

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
    const card = buildCard(person, seasonsByPerson.get(person.id) ?? [], config.cardYear);
    if (!card.playable && config.playableOnly) continue;
    const { rarity, headline } = rateCard(card);
    pack.push({
      id: randomUUID(),
      personId: card.personId,
      cardYear: card.cardYear,
      name: card.name,
      teamLabel: card.teamLabel,
      rarity,
      headline,
      playable: card.playable,
    });
  }

  if (pack.length === 0) throw badRequest('Could not build any cards for that year — try another one');
  return pack;
}

async function dealAllPacks(ctx: Ctx, config: DraftConfig, seats: number): Promise<Record<string, DraftCard[]>> {
  const packs: Record<string, DraftCard[]> = {};
  for (let seat = 0; seat < seats; seat++) packs[String(seat)] = await dealPack(ctx, config, config.packSize);
  return packs;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function parseConfig(row: DraftRow): DraftConfig {
  return row.config as DraftConfig;
}

function participantsOf(rows: { userId: number; seat: number }[], hostUserId: number, names: Map<number, string>): DraftParticipant[] {
  return [...rows]
    .sort((a, b) => a.seat - b.seat)
    .map((r) => ({ userId: r.userId, seat: r.seat, name: names.get(r.userId) ?? '?', isHost: r.userId === hostUserId }));
}

function toView(row: DraftRow, seatOfUser: number | null, participants: DraftParticipant[], state: DraftState): DraftView {
  const seats = participants.length;
  const myKey = seatOfUser === null ? null : String(seatOfUser);
  const pickCounts: Record<string, number> = {};
  for (let seat = 0; seat < seats; seat++) pickCounts[String(seat)] = state.picks[String(seat)]?.length ?? 0;

  return {
    id: row.id,
    phase: row.status as DraftView['phase'],
    config: parseConfig(row),
    hostUserId: row.hostUserId,
    participants,
    round: state.round,
    turn: state.turn,
    myPack: myKey ? (state.packs[myKey] ?? []) : [],
    myPicks: myKey ? (state.picks[myKey] ?? []) : [],
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
  return toView(row, mine?.seat ?? null, participants, stored(row));
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface CreateDraftInput {
  rounds: number;
  packSize: number;
  cardYear: number;
  playableOnly: boolean;
}

function validateConfig(input: CreateDraftInput): DraftConfig {
  if (!Number.isInteger(input.rounds) || input.rounds < 1 || input.rounds > MAX_ROUNDS) {
    throw badRequest(`Rounds must be between 1 and ${MAX_ROUNDS}`);
  }
  if (!Number.isInteger(input.packSize) || input.packSize < MIN_PACK_SIZE || input.packSize > MAX_PACK_SIZE) {
    throw badRequest(`Pack size must be between ${MIN_PACK_SIZE} and ${MAX_PACK_SIZE}`);
  }
  if (!Number.isInteger(input.cardYear) || input.cardYear < 1872 || input.cardYear > 2100) {
    throw badRequest('Pick a real card year');
  }
  return { rounds: input.rounds, packSize: input.packSize, cardYear: input.cardYear, playableOnly: input.playableOnly };
}

export async function createDraft(ctx: Ctx, user: AuthUser, input: CreateDraftInput): Promise<DraftView> {
  const config = validateConfig(input);
  // Fail fast if the year has no pool at all, instead of at deal time.
  await dealPack(ctx, config, 1);

  const state: DraftState = { round: 1, turn: 0, packs: {}, picks: {}, log: [{ seq: 1, text: `${user.displayName} opened the room.` }] };
  const [row] = await ctx.db
    .insert(drafts)
    .values({ hostUserId: user.id, status: 'lobby', config, state })
    .returning();
  await ctx.db.insert(draftParticipants).values({ draftId: row!.id, userId: user.id, seat: 0 });
  return viewOf(ctx, row!, user.id);
}

export async function listDrafts(ctx: Ctx, user: AuthUser): Promise<DraftListItem[]> {
  const rows = await ctx.db.select().from(drafts).orderBy(desc(drafts.updatedAt)).limit(50);
  const names = await loadNames(ctx);
  const items: DraftListItem[] = [];
  for (const row of rows) {
    const seats = await loadParticipants(ctx, row.id);
    const config = parseConfig(row);
    items.push({
      id: row.id,
      phase: row.status as DraftListItem['phase'],
      cardYear: config.cardYear,
      rounds: config.rounds,
      packSize: config.packSize,
      hostName: names.get(row.hostUserId) ?? '?',
      seats: seats.length,
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

export async function joinDraft(ctx: Ctx, user: AuthUser, draftId: number): Promise<DraftView> {
  const row = await loadRow(ctx, draftId);
  const seats = await loadParticipants(ctx, draftId);
  if (seats.some((s) => s.userId === user.id)) return viewOf(ctx, row, user.id);
  if (row.status !== 'lobby') throw badRequest('That draft has already started');
  if (seats.length >= MAX_SEATS) throw badRequest(`Drafts hold at most ${MAX_SEATS} managers`);

  await ctx.db.insert(draftParticipants).values({ draftId, userId: user.id, seat: seats.length });
  const state = stored(row);
  state.log.push({ seq: state.log.length + 1, text: `${user.displayName} took seat ${seats.length + 1}.` });
  const [updated] = await ctx.db.update(drafts).set({ state, updatedAt: new Date() }).where(eq(drafts.id, draftId)).returning();
  return viewOf(ctx, updated!, user.id);
}

export async function startDraft(ctx: Ctx, user: AuthUser, draftId: number): Promise<DraftView> {
  const row = await loadRow(ctx, draftId);
  if (row.hostUserId !== user.id) throw forbidden('Only the host can start the draft');
  if (row.status !== 'lobby') throw badRequest('That draft already started');

  const seats = await loadParticipants(ctx, draftId);
  if (seats.length < MIN_SEATS) throw badRequest(`A draft needs at least ${MIN_SEATS} managers`);

  const config = parseConfig(row);
  const packs = await dealAllPacks(ctx, config, seats.length);
  const state: DraftState = {
    round: 1,
    turn: 0,
    packs,
    picks: Object.fromEntries(seats.map((s) => [String(s.seat), []])),
    log: [{ seq: 1, text: `Pack 1 of ${config.rounds} is open. ${config.packSize} cards each — take one and pass.` }],
  };
  const [updated] = await ctx.db
    .update(drafts)
    .set({ status: 'active', state, updatedAt: new Date() })
    .where(eq(drafts.id, draftId))
    .returning();
  broadcast(ctx, updated!);
  return viewOf(ctx, updated!, user.id);
}

/** Move the drafted card into the manager's collection. */
async function filePickedCard(ctx: Ctx, userId: number, card: DraftCard): Promise<void> {
  const cardModelId = await ensureCardModel(ctx, {
    personId: card.personId,
    cardYear: card.cardYear,
    setLabel: 'Draft',
    rarity: card.rarity,
    source: 'draft',
    userId,
  });
  await ctx.db.insert(userCards).values({ userId, cardModelId, notes: `Drafted (${card.rarity})` });
}

export async function pickCard(ctx: Ctx, user: AuthUser, draftId: number, cardId: string): Promise<DraftView> {
  const row = await loadRow(ctx, draftId);
  if (row.status !== 'active') throw badRequest('That draft is not running');

  const seats = await loadParticipants(ctx, draftId);
  const state = stored(row);
  const me = seats.find((s) => s.userId === user.id);
  if (!me) throw forbidden('You are not in this draft');
  if (state.turn !== me.seat) throw badRequest('Wait for your turn');

  const key = String(me.seat);
  const pack = state.packs[key] ?? [];
  const index = pack.findIndex((c) => c.id === cardId);
  if (index < 0) throw badRequest('That card is not in your pack');

  const [card] = pack.splice(index, 1);
  state.picks[key] = [...(state.picks[key] ?? []), card!];
  await filePickedCard(ctx, user.id, card!);

  const seatCount = seats.length;
  const log = (text: string) => state.log.push({ seq: state.log.length + 1, text });
  const packAt = (seat: number) => state.packs[String(seat)] ?? [];

  log(`${user.displayName} took ${card!.name} (${card!.rarity}).`);

  // Pass every pack one seat along.
  const rotated: Record<string, DraftCard[]> = {};
  for (let seat = 0; seat < seatCount; seat++) rotated[String((seat + 1) % seatCount)] = packAt(seat);
  state.packs = rotated;

  const allEmpty = Array.from({ length: seatCount }, (_, seat) => packAt(seat).length === 0).every(Boolean);
  let status: string = 'active';
  if (allEmpty) {
    const config = parseConfig(row);
    if (state.round >= config.rounds) {
      status = 'finished';
      state.packs = {};
      log("That's the last pack — draft complete.");
    } else {
      state.round += 1;
      // Alternate which seat opens each round, so the first-pick edge of the
      // pass order evens out over the draft.
      state.turn = (state.round - 1) % seatCount;
      state.packs = await dealAllPacks(ctx, config, seatCount);
      log(`Pack ${state.round} of ${config.rounds} is open.`);
    }
  } else {
    // The turn follows the packs: the next seat actually holding cards picks.
    // (A pack can run dry mid-round, so the next seat in line may be empty.)
    let turn = (state.turn + 1) % seatCount;
    while (packAt(turn).length === 0) turn = (turn + 1) % seatCount;
    state.turn = turn;
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
}

function broadcast(ctx: Ctx, row: DraftRow): void {
  ctx.io?.to(`draft:${row.id}`).emit('draft:update', { draftId: row.id, phase: row.status, updatedAt: row.updatedAt.toISOString() });
}
