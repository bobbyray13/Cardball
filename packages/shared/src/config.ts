/**
 * Tunable house rules.
 *
 * Everything in this file is a value that was NOT printed on the Ball Card
 * spreadsheet or in the rules doc — each is a clearly-marked default the
 * commissioner can tune during playtesting. All gameplay code reads these
 * through this module, so tuning is a one-file change.
 */

import type { Position } from './positions.js';
import type { MinBand } from './ballCard.js';

export const RULES_CONFIG = {
  /** How many seasons with any MLB appearance make up a card's stat window. */
  statWindowSeasons: 6,

  /** Plate appearances (AB) a batter season needs to be "healthy" when rolled. */
  fullGameAb: 100,

  /** Outs on the mound (120 outs = 40.0 IP) a pitcher season needs to be "healthy". */
  pitcherInjuryIpOuts: 120,

  /** Innings (IP, not outs) pitched in a single MLB season that make a pitcher a starter. */
  starterIpThreshold: 100,

  /**
   * THE MOUND, post-fatigue: a pitcher may stay in as long as his manager
   * will have him, but every fatigued inning costs him on the pitch roll.
   */
  /** Innings a starting pitcher works at full strength in a 9-inning game. */
  starterFreshInnings: 5,
  /** Pitch-roll penalty per fatigued inning (starters past their fresh innings, relievers after every full inning). */
  fatiguePerInning: 1,

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
export const RBI_BONUS_BANDS: readonly MinBand[] = [
  { min: 120, mod: 2 },
  { min: 100, mod: 1 },
];

/**
 * How many innings a starter pitches at full strength in a game this long.
 * A 9-inning game gives him `starterFreshInnings` (5); a 6-inning game scales
 * it down (3), a 3-inning game further (2) — so short games fatigue the same
 * way, just sooner. Takes the rules loosely, so a game snapshotted before the
 * fatigue rules existed still reads the shipped default.
 */
export function freshInningsFor(regulationInnings: number, rules: { starterFreshInnings?: number } = {}): number {
  const fresh = rules.starterFreshInnings ?? RULES_CONFIG.starterFreshInnings;
  return Math.max(1, Math.round((fresh * regulationInnings) / 9));
}

/** The fatigue penalty per fatigued inning, defaulted for pre-fatigue rule snapshots. */
export function fatiguePerInning(rules: { fatiguePerInning?: number } = {}): number {
  return rules.fatiguePerInning ?? RULES_CONFIG.fatiguePerInning;
}

export function rbiBonus(rbi: number, bands: readonly MinBand[] = RBI_BONUS_BANDS): number {
  for (const band of bands) {
    if (rbi >= band.min) return band.mod;
  }
  return 0;
}

/**
 * Era used to determine which seasons appear "on the back" of a virtual card.
 * A card copyrighted in year Y shows the seasons Y-6 … Y-1 (standard modern
 * card back), skipping seasons in which the player did not appear at all.
 */
export function statWindowYears(cardYear: number, seasons: number = RULES_CONFIG.statWindowSeasons): number[] {
  const years: number[] = [];
  for (let i = 1; i <= seasons; i++) {
    years.push(cardYear - i);
  }
  return years; // [Y-1, Y-2, ..., Y-6], most recent first
}
