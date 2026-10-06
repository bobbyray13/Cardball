import { activeHouseRules, hitMod } from '@cardball/shared';
import type { HouseRules, Position } from '@cardball/shared';
import type { SavedLineup } from '@cardball/db';
import type { CardSnapshot } from './cards.js';

const FIELD: Position[] = ['C', 'SS', 'CF', '2B', '3B', 'RF', 'LF', '1B'];

export interface RosterCard {
  /** team_cards.id as a string — the id used in saved lineups */
  id: string;
  card: CardSnapshot;
}

const bestAvg = (c: CardSnapshot, rules: HouseRules) =>
  Math.max(...c.seasons.map((s) => (s.ab >= rules.fullGameAb ? (s.avg ?? 0) : 0)), 0);
const bestEra = (c: CardSnapshot) =>
  Math.min(...c.seasons.map((s) => (s.pitching && s.pitching.ipOuts >= 30 ? (s.pitching.era ?? 99) : 99)), 99);

/**
 * Fill a sensible default lineup.
 *
 * Two things matter beyond raw quality. First, positions are filled in order of
 * scarcity: if only one card on the roster can catch, the catcher has to be
 * decided before anything else, or a versatile star will have already been used
 * up elsewhere. Second, among candidates for a spot, a card that can *only*
 * play that spot is preferred over one that could cover several — that is what
 * keeps a Sosa (RF, and a good CF) from being spent at CF and leaving right
 * field empty.
 *
 * DH is the best remaining bat; the order is by batting modifier. Returns an
 * error when the roster cannot field a legal team.
 */
export function autoLineup(roster: RosterCard[], rules: HouseRules = activeHouseRules()): { lineup: SavedLineup } | { error: string } {
  const hitters = roster.filter((r) => r.card.playable && r.card.canBat);
  const used = new Set<string>();
  const fieldPositions: Partial<Record<Position, string>> = {};

  const candidatesFor = (pos: Position) => hitters.filter((r) => !used.has(r.id) && r.card.positions.includes(pos));

  // Scarcest position first (fewest eligible cards), original order as the tie-break.
  const order = [...FIELD].sort((a, b) => {
    const count = candidatesFor(a).length - candidatesFor(b).length;
    return count !== 0 ? count : FIELD.indexOf(a) - FIELD.indexOf(b);
  });

  for (const pos of order) {
    const candidates = candidatesFor(pos);
    if (candidates.length === 0) return { error: `Nobody on the roster can play ${pos}` };
    const open = order.filter((p) => p !== pos && !fieldPositions[p]);
    const pick = candidates.sort((a, b) => score(b, pos, open, rules) - score(a, pos, open, rules))[0]!;
    fieldPositions[pos] = pick.id;
    used.add(pick.id);
  }

  const remaining = hitters.filter((r) => !used.has(r.id));
  const dh =
    remaining.filter((r) => r.card.pitcherClass === null).sort((a, b) => bestAvg(b.card, rules) - bestAvg(a.card, rules))[0] ??
    remaining.sort((a, b) => bestAvg(b.card, rules) - bestAvg(a.card, rules))[0];
  if (!dh) return { error: 'Need a 9th hitter for the DH spot' };
  used.add(dh.id);

  const starter = roster
    .filter((r) => r.card.pitcherClass === 'SP' && !used.has(r.id))
    .sort((a, b) => bestEra(a.card) - bestEra(b.card))[0];
  if (!starter) return { error: `Need a starting pitcher (a ${rules.starterIpThreshold}+ IP season in his career)` };

  const lineup = [...used].sort((a, b) => {
    const ca = roster.find((r) => r.id === a)!.card;
    const cb = roster.find((r) => r.id === b)!.card;
    return hitMod(bestAvg(cb, rules), rules.hitBands) - hitMod(bestAvg(ca, rules), rules.hitBands) || bestAvg(cb, rules) - bestAvg(ca, rules);
  });

  return { lineup: { lineup, fieldPositions, startingPitcherId: starter.id } };
}

function score(r: RosterCard, pos: Position, openPositions: Position[], rules: HouseRules): number {
  // Fielding first, then the bat, then a bonus for cards that cannot cover the
  // positions still to be filled (they are the ones with nowhere else to go).
  const coversOthers = openPositions.some((other) => r.card.positions.includes(other)) ? 1 : 0;
  return (r.card.fielding[pos] ?? 0) * 2 + hitMod(bestAvg(r.card, rules), rules.hitBands) - coversOthers;
}
