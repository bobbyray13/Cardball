/**
 * Dealing cards out of the stats database.
 *
 * Both kinds of pack draw from the same shelf: sample players who appeared in
 * the six seasons before the pack's card year, build each one's card, and keep
 * the ones the wrapper asks for. A draft pack keeps whatever fits its theme; a
 * starter pack is shaped — one player at every position, or a pitching staff —
 * so a brand-new manager can field a legal team out of the box.
 */

import { randomUUID } from 'node:crypto';
import { and, between, gt, inArray, sql } from 'drizzle-orm';
import { activeHouseRules, packTheme, rateCard } from '@cardball/shared';
import type { DraftCard, PackTheme, PackThemeId } from '@cardball/shared';
import { people, seasons } from '@cardball/db';
import type { PersonRow, SeasonRow } from '@cardball/db';
import { buildCard, windowRange } from './cards.js';
import type { CardSnapshot } from './cards.js';
import type { Executor } from './context.js';
import { badRequest } from './http.js';

export type { CardSnapshot };

/** Deal queries run on the pool or inside a transaction, so opening a pack is one unit. */
type DealDb = { db: Executor };

const dbOf = (handle: DealDb) => handle.db;

/** The engine's eight field positions, in batting-order-agnostic list. */
const FIELD_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as const;

/**
 * Sample `sample` players who appeared in `cardYear`'s stat window and build
 * their cards, in random order. Over-fetches on purpose: callers keep only a
 * fraction of the sample, and some candidates turn out to have no usable card.
 */
async function sampleCards(handle: DealDb, cardYear: number, sample: number, playableOnly: boolean): Promise<CardSnapshot[]> {
  const db = dbOf(handle);
  const rules = activeHouseRules();
  const { from, to } = windowRange(cardYear, rules);

  const candidates = await db
    .select({ id: seasons.personId })
    .from(seasons)
    .where(and(between(seasons.year, from, to), gt(seasons.games, 0)))
    .groupBy(seasons.personId)
    .orderBy(sql`random()`)
    .limit(sample);
  if (candidates.length === 0) return [];

  const ids = candidates.map((c) => c.id);
  const personRows = await db.select().from(people).where(inArray(people.id, ids));
  const seasonRows = await db.select().from(seasons).where(and(inArray(seasons.personId, ids), between(seasons.year, from, to)));

  const seasonsByPerson = new Map<number, SeasonRow[]>();
  for (const row of seasonRows) {
    const list = seasonsByPerson.get(row.personId) ?? [];
    list.push(row);
    seasonsByPerson.set(row.personId, list);
  }

  const personById = new Map((personRows as PersonRow[]).map((p) => [p.id, p]));
  const cards: CardSnapshot[] = [];
  for (const id of ids) {
    const person = personById.get(id);
    if (!person) continue;
    const card = buildCard(person, seasonsByPerson.get(person.id) ?? [], cardYear);
    if (!card.playable && playableOnly) continue;
    cards.push(card);
  }
  return cards;
}

/** The pack-view of a card: what a manager sees when it is dealt. */
function toDealCard(card: CardSnapshot): DraftCard {
  const rating = rateCard(card);
  return {
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
  };
}

/**
 * Deal a themed pack: `count` random players whose card, built on `cardYear`,
 * fits the wrapper's label.
 */
export async function dealPackAtYear(
  handle: DealDb,
  cardYear: number,
  count: number,
  theme: PackTheme,
  playableOnly: boolean,
): Promise<DraftCard[]> {
  const pack: DraftCard[] = [];
  // A themed pack throws most of the sample away — only a fraction of the players
  // in any six-year window had a 30-homer or a 30-steal season — so the sample
  // has to be much wider than the pack.
  const cards = await sampleCards(handle, cardYear, count * 15 + 150, playableOnly);
  for (const card of cards) {
    if (pack.length >= count) break;
    if (!theme.matches(rateCard(card))) continue;
    pack.push(toDealCard(card));
  }
  return pack;
}

/** How many card years a pack will try before giving up on filling itself. */
export const PACK_YEAR_TRIES = 10;

/**
 * Deal one pack. A pack is built on a single card year drawn from the era, so
 * the whole wrapper is coherent ("a 1973 pack"); the theme decides which of
 * that year's cards are eligible.
 */
export async function dealPack(
  handle: DealDb,
  config: { yearFrom: number; yearTo: number; playableOnly?: boolean },
  count: number,
  themeId: PackThemeId,
): Promise<DraftCard[]> {
  const theme = packTheme(themeId);
  const playableOnly = config.playableOnly ?? true;
  const span = config.yearTo - config.yearFrom + 1;
  let best: DraftCard[] = [];
  for (let attempt = 0; attempt < PACK_YEAR_TRIES; attempt++) {
    const cardYear = config.yearFrom + Math.floor(Math.random() * span);
    const pack = await dealPackAtYear(handle, cardYear, count, theme, playableOnly);
    if (pack.length >= count) return pack;
    if (pack.length > best.length) best = pack;
  }
  if (best.length > 0) return best;
  throw badRequest(`No ${theme.name.toLowerCase()} cards to deal from ${config.yearFrom}–${config.yearTo} — widen the era or drop that pack`);
}

/**
 * The starter "lineup" pack: one card at every field position plus the best
 * remaining bat as the DH, so the collection it lands in can take the field.
 */
export async function dealLineupPack(handle: DealDb, cardYear: number): Promise<DraftCard[]> {
  let sample = 900;
  let picks: DraftCard[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const cards = await sampleCards(handle, cardYear, sample, true);
    const batCards = cards.filter((c) => c.canBat);
    const used = new Set<number>();
    picks = [];

    // One card per position, leaving the rest of the sample for the DH slot.
    for (const pos of FIELD_POSITIONS) {
      const pick = batCards.find((c) => c.positions.includes(pos) && !used.has(c.personId));
      if (pick) {
        used.add(pick.personId);
        picks.push(toDealCard(pick));
      }
    }

    if (picks.length === FIELD_POSITIONS.length) {
      const dh = batCards
        .filter((c) => !used.has(c.personId))
        .sort((a, b) => rateCard(b).score - rateCard(a).score)[0];
      if (dh) picks.push(toDealCard(dh));
      return picks;
    }
    sample *= 2; // some position came up empty; try a wider sample once
  }

  // Real data always has a card at every position in a modern window, but a
  // sparse database may not: fill the gaps with bats so the pack still opens.
  const cards = await sampleCards(handle, cardYear, sample, true);
  const bats = cards.filter((c) => c.canBat).map(toDealCard);
  const seen = new Set<number>();
  for (const card of bats) {
    if (seen.size >= 9) break;
    if (seen.has(card.personId)) continue;
    seen.add(card.personId);
    picks.push(card);
  }
  return picks;
}

/** The starter "mound" pack: two starting pitchers and two relievers. */
export async function dealMoundPack(handle: DealDb, cardYear: number): Promise<DraftCard[]> {
  const cards = await sampleCards(handle, cardYear, 600, true);
  const taken = new Set<number>();
  const picks: DraftCard[] = [];
  const pitchers = cards.filter((c) => c.canPitch);

  const take = (count: number, pool: CardSnapshot[]) => {
    for (const card of pool) {
      if (picks.length >= 9 || taken.has(card.personId)) continue;
      taken.add(card.personId);
      picks.push(toDealCard(card));
    }
  };

  take(2, pitchers.filter((c) => c.pitcherClass === 'SP'));
  take(2, pitchers.filter((c) => c.pitcherClass === 'RP'));
  // A thin era can run out of relievers (or starters); fill the staff from
  // whatever arms are left so the pack still opens with pitchers.
  if (picks.length < 4) take(4 - picks.length, pitchers);
  return picks;
}

/**
 * Field insurance: the few cards a seat is short of a legal lineup — a starter
 * and enough distinct bats — dealt straight from the era's pool, ignoring the
 * draft's themes (the league deals these, not the wrapper).
 *
 * Commons and uncommons first, so an insurance card never pushes a seat over
 * the rarity caps its draft set; only a window without enough cheap cards
 * falls back to the whole sample. `skip` are the persons the seat already
 * holds, since a lineup needs distinct bats and a starter who is none of them.
 */
export async function dealFieldInsurance(
  handle: DealDb,
  config: { yearFrom: number; yearTo: number; playableOnly?: boolean },
  need: { starters: number; bats: number },
  skip: readonly number[] = [],
): Promise<DraftCard[]> {
  const playableOnly = config.playableOnly ?? true;
  const span = config.yearTo - config.yearFrom + 1;
  const taken = new Set(skip);
  const picks: DraftCard[] = [];
  let starters = need.starters;
  let bats = need.bats;

  const takeFrom = (cards: CardSnapshot[]) => {
    for (const card of cards) {
      if (starters <= 0 && bats <= 0) return;
      if (taken.has(card.personId) || !card.playable) continue;
      if (card.pitcherClass === 'SP' && starters > 0) {
        taken.add(card.personId);
        picks.push(toDealCard(card));
        starters--;
      } else if (card.pitcherClass !== 'SP' && card.canBat && bats > 0) {
        taken.add(card.personId);
        picks.push(toDealCard(card));
        bats--;
      }
    }
  };

  for (let attempt = 0; attempt < PACK_YEAR_TRIES && (starters > 0 || bats > 0); attempt++) {
    const cardYear = config.yearFrom + Math.floor(Math.random() * span);
    const cards = await sampleCards(handle, cardYear, 300, playableOnly);
    takeFrom(cards.filter((c) => ['common', 'uncommon'].includes(rateCard(c).rarity)));
    takeFrom(cards);
  }
  return picks;
}

/** Deal the cards a sealed pack holds, by its shape and theme. */
export async function dealSealedPack(
  handle: DealDb,
  pack: { shape: string; themeId: string; size: number; yearFrom: number; yearTo: number },
): Promise<DraftCard[]> {
  const config = { yearFrom: pack.yearFrom, yearTo: pack.yearTo, playableOnly: true };
  // The shaped starter packs are dealt at the top of the era, so the cards
  // a new manager starts with are current players.
  if (pack.shape === 'lineup') {
    const cards = await dealLineupPack(handle, pack.yearTo);
    if (cards.length > 0) return cards;
  } else if (pack.shape === 'mound') {
    const cards = await dealMoundPack(handle, pack.yearTo);
    if (cards.length > 0) return cards;
  } else {
    try {
      return await dealPack(handle, config, pack.size, pack.themeId as PackThemeId);
    } catch {
      // A themed pack can run dry in a thin era; every card fits a mixed wrapper.
    }
  }
  return dealPack(handle, config, pack.size, 'mixed');
}
