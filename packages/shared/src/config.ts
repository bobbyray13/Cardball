/**
 * Tunable house rules.
 *
 * Everything in this file is a value that was NOT printed on the Ball Card
 * spreadsheet or in the rules doc — each is a clearly-marked default the
 * commissioner can tune during playtesting. All gameplay code reads these
 * through this module, so tuning is a one-file change.
 */

import type { Position } from './positions.js';

export const RULES_CONFIG = {
  /** How many seasons with any MLB appearance make up a card's stat window. */
  statWindowSeasons: 6,

  /** Plate appearances (AB) a batter season needs to be "healthy" when rolled. */
  fullGameAb: 100,

  /** Outs on the mound (120 outs = 40.0 IP) a pitcher season needs to be "healthy". */
  pitcherInjuryIpOuts: 120,

  /** Innings (IP, not outs) pitched in a single MLB season that make a pitcher a starter. */
  starterIpThreshold: 100,

  /** Total innings a pitcher may throw in a Cardball game, by role. */
  ipCaps: { starter: 4, reliever: 2, closer: 1 },

  /** These regulation innings must be pitched by relievers. */
  relieverOnlyInnings: [8, 9],

  /** Consecutive tie pitch-rolls that become a walk. */
  walkBalls: 3,

  /** Catcher bonus when a runner attempts to steal 3rd. */
  stealThirdCatcherBonus: 1,

  /** Baserunners re-roll all 1s when advancing on a send/tag-up attempt. */
  sendRerollOnes: true,

  /** A double-play attempt must sum to MORE than this on the d20 factors. */
  dpTarget: 20,

  /** Games at a position (in any window season) required to be eligible to field it. */
  positionEligibilityGames: 10,

  /** Games at a position required for a computed fielding rating (below → neutral). */
  fieldingRatingMinGames: 10,

  /** Regulation innings choices offered when creating a game. */
  regulationInningsOptions: [3, 6, 9] as const,
} as const;

/**
 * Spray chart — the d6 hit-direction roll.
 * Each direction lists infield and outfield candidates; the contact d20
 * decides which defender fields it (≤10 → infielder, ≥11 → outfielder).
 * Matches the original build's chart and the Longoria example
 * (roll 1 + power 12 → hard grounder to 3rd).
 */
export const SPRAY_CHART: Record<number, { infield: Position[]; outfield: Position[] }> = {
  1: { infield: ['3B'], outfield: ['LF'] },
  2: { infield: ['SS', '3B'], outfield: ['LF', 'CF'] },
  3: { infield: ['SS'], outfield: ['CF'] },
  4: { infield: ['2B'], outfield: ['CF'] },
  5: { infield: ['2B', '1B'], outfield: ['CF', 'RF'] },
  6: { infield: ['1B'], outfield: ['RF'] },
};

/**
 * Contact-roll results colored on the physical Ball Card.
 * Red: +1 to baserunners' advance rolls. Blue: −1.
 * DEFAULT (not on the spreadsheet): line drives help runners, weak
 * pop-ups/grounders hold them.
 */
export const RUNNER_ADVANTAGE = {
  red: [15, 16, 17] as const,
  blue: [1, 2] as const,
} as const;

/**
 * RBI advantage — with a runner on 2nd or 3rd, big RBI seasons add to the
 * batter's pitch roll. Best matching band applies.
 * DEFAULT (not on the spreadsheet).
 */
export const RBI_BONUS_BANDS: readonly { min: number; mod: number }[] = [
  { min: 120, mod: 2 },
  { min: 100, mod: 1 },
];

export function rbiBonus(rbi: number): number {
  for (const band of RBI_BONUS_BANDS) {
    if (rbi >= band.min) return band.mod;
  }
  return 0;
}

/**
 * Era used to determine which seasons appear "on the back" of a virtual card.
 * A card copyrighted in year Y shows the seasons Y-6 … Y-1 (standard modern
 * card back), skipping seasons in which the player did not appear at all.
 */
export function statWindowYears(cardYear: number): number[] {
  const years: number[] = [];
  for (let i = 1; i <= RULES_CONFIG.statWindowSeasons; i++) {
    years.push(cardYear - i);
  }
  return years; // [Y-1, Y-2, ..., Y-6], most recent first
}
