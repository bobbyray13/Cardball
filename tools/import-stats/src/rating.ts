/**
 * Computed fielding ratings (−3 … +3), the Cardball replacement for the
 * tabletop game's "mutually agreed" fielding value.
 *
 * A player-season-position only gets a rating when the player appeared at the
 * position at least `RULES_CONFIG.fieldingRatingMinGames` times. Qualifiers are
 * compared with everyone else who played that position in that season:
 *
 *   range factor  9 * (PO + A) / (InnOuts / 3)   (old seasons: (PO + A) / G)
 *   fielding pct  (PO + A) / (PO + A + E)
 *   catcher CS%   CS / (SB + CS)                 (when the columns are present)
 *
 * The metrics are z-scored within the position-season, combined
 * (0.6 range + 0.4 fielding pct; catchers 0.3 range + 0.4 fielding pct +
 * 0.3 CS%), turned into a percentile and banded.
 */
import { RULES_CONFIG } from '@cardball/shared';
import type { Position } from '@cardball/shared';

export interface FieldingCandidate {
  playerId: string;
  year: number;
  position: Position;
  games: number;
  innOuts: number;
  po: number;
  assists: number;
  errors: number;
  /** stolen bases allowed (catchers only) */
  sb: number;
  /** runners caught stealing (catchers only) */
  cs: number;
}

export interface FieldingMetrics {
  rangeFactor: number;
  fieldingPct: number;
  caughtStealingPct: number | null;
}

export const CATCHER_WEIGHTS = { fieldingPct: 0.4, rangeFactor: 0.3, caughtStealing: 0.3 } as const;
export const FIELDER_WEIGHTS = { rangeFactor: 0.6, fieldingPct: 0.4 } as const;

export function fieldingMetrics(candidate: {
  games: number;
  innOuts: number;
  po: number;
  assists: number;
  errors: number;
  sb: number;
  cs: number;
}): FieldingMetrics {
  const chances = candidate.po + candidate.assists;
  const rangeFactor =
    candidate.innOuts > 0
      ? (9 * chances) / (candidate.innOuts / 3)
      : candidate.games > 0
        ? chances / candidate.games
        : 0;
  const denominator = chances + candidate.errors;
  const fieldingPct = denominator > 0 ? chances / denominator : 0;
  const stealAttempts = candidate.sb + candidate.cs;
  return {
    rangeFactor,
    fieldingPct,
    caughtStealingPct: stealAttempts > 0 ? candidate.cs / stealAttempts : null,
  };
}

/** Population z-scores; a zero-variance pool scores 0 for everyone. */
export function zScores(values: readonly number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  if (sd < 1e-12) return values.map(() => 0);
  return values.map((value) => (value - mean) / sd);
}

export function combinedScore(
  position: Position,
  z: { rangeFactor: number; fieldingPct: number; caughtStealing: number | null },
): number {
  if (position === 'C') {
    if (z.caughtStealing !== null) {
      return (
        CATCHER_WEIGHTS.fieldingPct * z.fieldingPct +
        CATCHER_WEIGHTS.rangeFactor * z.rangeFactor +
        CATCHER_WEIGHTS.caughtStealing * z.caughtStealing
      );
    }
    const total = CATCHER_WEIGHTS.fieldingPct + CATCHER_WEIGHTS.rangeFactor;
    return (
      (CATCHER_WEIGHTS.fieldingPct / total) * z.fieldingPct +
      (CATCHER_WEIGHTS.rangeFactor / total) * z.rangeFactor
    );
  }
  return FIELDER_WEIGHTS.rangeFactor * z.rangeFactor + FIELDER_WEIGHTS.fieldingPct * z.fieldingPct;
}

/**
 * Midrank percentile within the comparison pool: `(below + half of ties) / pool`.
 * The midrank keeps small pools from producing extreme ratings — a lone
 * qualifier sits neutral at 0, a four-player pool tops out at ±2, and +3 needs
 * at least 17 qualifiers at the position that season.
 */
export function percentileRank(score: number, scores: readonly number[]): number {
  const n = scores.length;
  if (n === 0) return 50;
  let below = 0;
  let equal = 0;
  for (const other of scores) {
    if (other < score) below += 1;
    else if (other === score) equal += 1;
  }
  return (100 * (below + 0.5 * equal)) / n;
}

export function ratingFromPercentile(percentile: number): number {
  if (percentile >= 97) return 3;
  if (percentile >= 85) return 2;
  if (percentile >= 65) return 1;
  if (percentile >= 35) return 0;
  if (percentile >= 15) return -1;
  if (percentile >= 3) return -2;
  return -3;
}

export function ratingKey(playerId: string, year: number, position: string): string {
  return `${playerId}|${year}|${position}`;
}

/**
 * Computes a rating for every qualifying player-season-position.
 * Players below `minGames` simply have no entry (they rate neutral, 0).
 * Pitchers are excluded — the game models pitching through the pitching stats.
 */
export function computeFieldingRatings(
  candidates: readonly FieldingCandidate[],
  minGames: number = RULES_CONFIG.fieldingRatingMinGames,
): Map<string, number> {
  const pools = new Map<string, FieldingCandidate[]>();
  for (const candidate of candidates) {
    if (candidate.position === 'P') continue;
    if (candidate.games < minGames) continue;
    const key = `${candidate.year}|${candidate.position}`;
    const pool = pools.get(key);
    if (pool === undefined) pools.set(key, [candidate]);
    else pool.push(candidate);
  }

  const ratings = new Map<string, number>();
  for (const pool of pools.values()) {
    const metrics = pool.map((candidate) => fieldingMetrics(candidate));
    const rangeZ = zScores(metrics.map((metric) => metric.rangeFactor));
    const pctZ = zScores(metrics.map((metric) => metric.fieldingPct));
    const csValues = metrics.map((metric) =>
      metric.caughtStealingPct === null ? null : metric.caughtStealingPct,
    );
    const hasCs = csValues.every((value) => value !== null);
    const csZ = hasCs ? zScores(csValues as number[]) : csValues.map(() => null);

    const scores = pool.map((candidate, index) =>
      combinedScore(candidate.position, {
        rangeFactor: rangeZ[index] ?? 0,
        fieldingPct: pctZ[index] ?? 0,
        caughtStealing: csZ[index] ?? null,
      }),
    );

    pool.forEach((candidate, index) => {
      const score = scores[index] ?? 0;
      ratings.set(
        ratingKey(candidate.playerId, candidate.year, candidate.position),
        ratingFromPercentile(percentileRank(score, scores)),
      );
    });
  }

  return ratings;
}
