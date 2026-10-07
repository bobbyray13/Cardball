import { and, between, inArray } from 'drizzle-orm';
import { activeHouseRules, isPosition } from '@cardball/shared';
import type { CardSnapshot, HouseRules, Position, SeasonStats } from '@cardball/shared';
import type { PersonRow, SeasonRow } from '@cardball/db';
import { seasonRowToStats, seasons } from '@cardball/db';
import type { Ctx } from './context.js';

export type { CardSnapshot };

/**
 * Card years we accept for a player: the year after his debut through the year
 * after his last known season. An active player has no `finalYear` in the
 * people table (his final game hasn't happened), so his seasons decide — pass
 * them and his newest season's card can be printed the year after it, which
 * keeps current players collectable without waiting for the next data import.
 */
export function validCardYears(
  person: Pick<PersonRow, 'debutYear' | 'finalYear'>,
  seasons: { year: number }[] = [],
): { min: number; max: number } | null {
  const last = person.finalYear ?? (seasons.length > 0 ? Math.max(...seasons.map((s) => s.year)) : null);
  if (!person.debutYear || last === null) return null;
  return { min: person.debutYear + 1, max: last + 1 };
}

export function windowRange(cardYear: number, rules: HouseRules = activeHouseRules()): { from: number; to: number } {
  return { from: cardYear - rules.statWindowSeasons, to: cardYear - 1 };
}

/** Pitching on the card back, in outs, needed before a card can take the mound at all. */
const MIN_WINDOW_PITCHING_OUTS = 30;

export function buildCard(
  person: PersonRow,
  allSeasons: SeasonRow[],
  cardYear: number,
  rules: HouseRules = activeHouseRules(),
): CardSnapshot {
  const { from, to } = windowRange(cardYear, rules);
  const window = allSeasons
    .filter((s) => s.personId === person.id && s.year >= from && s.year <= to && s.games > 0)
    .sort((a, b) => a.year - b.year)
    .map(seasonRowToStats);

  const canBat = window.some((s) => s.ab >= rules.fullGameAb);
  const windowPitchOuts = window.reduce((sum, s) => sum + (s.pitching?.ipOuts ?? 0), 0);
  const canPitch = windowPitchOuts >= MIN_WINDOW_PITCHING_OUTS;
  const pitcherClass = canPitch ? (person.isStarter ? 'SP' : 'RP') : null;

  // Positions: games across the window; rating is the games-weighted average.
  const games = new Map<Position, { games: number; weighted: number }>();
  for (const s of window) {
    for (const p of s.positionsPlayed) {
      if (p.position === 'P' || !isPosition(p.position)) continue;
      const agg = games.get(p.position) ?? { games: 0, weighted: 0 };
      agg.games += p.games;
      agg.weighted += p.rating * p.games;
      games.set(p.position, agg);
    }
  }
  const positions: Position[] = [];
  const fielding: Partial<Record<Position, number>> = {};
  if (canBat) {
    for (const [pos, agg] of [...games.entries()].sort((a, b) => b[1].games - a[1].games)) {
      if (agg.games < rules.positionEligibilityGames) continue;
      positions.push(pos);
      fielding[pos] = Math.max(-3, Math.min(3, Math.round(agg.weighted / agg.games)));
    }
    positions.push('DH');
  }

  const latest = window[window.length - 1];
  const teamLabel = latest?.teamLabel.split('/').pop() ?? '';

  let ineligibleReason: string | null = null;
  if (window.length === 0) ineligibleReason = `No MLB seasons from ${from} to ${to} on this card`;
  else if (!canBat && !canPitch) ineligibleReason = `Needs a ${rules.fullGameAb} AB season or real pitching on the card back`;

  return {
    personId: person.id,
    bbrefId: person.bbrefId,
    name: `${person.nameFirst} ${person.nameLast}`.trim(),
    cardYear,
    teamLabel,
    bats: person.bats,
    throws: person.throws,
    seasons: window,
    positions,
    fielding,
    pitcherClass,
    canBat,
    canPitch,
    playable: ineligibleReason === null,
    ineligibleReason,
  };
}

/** Load every season that could appear on any of these cards, in one query. */
export async function loadWindowSeasons(
  ctx: Ctx,
  cards: { personId: number; cardYear: number }[],
  rules: HouseRules = activeHouseRules(),
): Promise<SeasonRow[]> {
  if (cards.length === 0) return [];
  const personIds = [...new Set(cards.map((c) => c.personId))];
  const minYear = Math.min(...cards.map((c) => windowRange(c.cardYear, rules).from));
  const maxYear = Math.max(...cards.map((c) => windowRange(c.cardYear, rules).to));
  return ctx.db
    .select()
    .from(seasons)
    .where(and(inArray(seasons.personId, personIds), between(seasons.year, minYear, maxYear)));
}
