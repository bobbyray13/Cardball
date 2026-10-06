import { hitMod } from '@cardball/shared';
import type { Position } from '@cardball/shared';
import type { SavedLineup } from '@cardball/db';
import type { CardSnapshot } from './cards.js';

const FIELD: Position[] = ['C', 'SS', 'CF', '2B', '3B', 'RF', 'LF', '1B'];

export interface RosterCard {
  /** team_cards.id as a string — the id used in saved lineups */
  id: string;
  card: CardSnapshot;
}

const bestAvg = (c: CardSnapshot) => Math.max(...c.seasons.map((s) => (s.ab >= 100 ? (s.avg ?? 0) : 0)), 0);
const bestEra = (c: CardSnapshot) => Math.min(...c.seasons.map((s) => (s.pitching && s.pitching.ipOuts >= 30 ? (s.pitching.era ?? 99) : 99)), 99);

/**
 * Fill a sensible default lineup: scarcest positions first, best fielder that
 * also hits; DH is the best remaining bat; order by batting modifier.
 * Returns null with a reason when the roster can't field a legal team.
 */
export function autoLineup(roster: RosterCard[]): { lineup: SavedLineup } | { error: string } {
  const hitters = roster.filter((r) => r.card.playable && r.card.canBat);
  const used = new Set<string>();
  const fieldPositions: Partial<Record<Position, string>> = {};

  for (const pos of FIELD) {
    const candidates = hitters
      .filter((r) => !used.has(r.id) && r.card.positions.includes(pos))
      .sort((a, b) => score(b, pos) - score(a, pos));
    const pick = candidates[0];
    if (!pick) return { error: `Nobody on the roster can play ${pos}` };
    fieldPositions[pos] = pick.id;
    used.add(pick.id);
  }

  const dh = hitters.filter((r) => !used.has(r.id) && r.card.pitcherClass === null).sort((a, b) => bestAvg(b.card) - bestAvg(a.card))[0]
    ?? hitters.filter((r) => !used.has(r.id)).sort((a, b) => bestAvg(b.card) - bestAvg(a.card))[0];
  if (!dh) return { error: 'Need a 9th hitter for the DH spot' };
  used.add(dh.id);

  const starter = roster
    .filter((r) => r.card.pitcherClass === 'SP' && !used.has(r.id))
    .sort((a, b) => bestEra(a.card) - bestEra(b.card))[0];
  if (!starter) return { error: 'Need a starting pitcher (a 100+ IP season in his career)' };

  const lineup = [...used].sort((a, b) => {
    const ca = roster.find((r) => r.id === a)!.card;
    const cb = roster.find((r) => r.id === b)!.card;
    return hitMod(bestAvg(cb)) - hitMod(bestAvg(ca)) || bestAvg(cb) - bestAvg(ca);
  });

  return { lineup: { lineup, fieldPositions, startingPitcherId: starter.id } };
}

function score(r: RosterCard, pos: Position): number {
  return (r.card.fielding[pos] ?? 0) * 2 + hitMod(bestAvg(r.card));
}
