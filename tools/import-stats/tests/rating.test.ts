import { describe, expect, it } from 'vitest';
import { RULES_CONFIG } from '@cardball/shared';
import {
  combinedScore,
  computeFieldingRatings,
  fieldingMetrics,
  percentileRank,
  ratingFromPercentile,
  ratingKey,
  zScores,
  type FieldingCandidate,
} from '../src/rating.js';

function candidate(overrides: Partial<FieldingCandidate> = {}): FieldingCandidate {
  return {
    playerId: 'p01',
    year: 1995,
    position: 'SS',
    games: 120,
    innOuts: 1000,
    po: 200,
    assists: 400,
    errors: 20,
    sb: 0,
    cs: 0,
    ...overrides,
  };
}

describe('fieldingMetrics', () => {
  it('uses innings when they are recorded', () => {
    // 9 * 600 / (900 / 3) = 18 put-outs + assists per nine innings
    const metrics = fieldingMetrics({
      games: 100,
      innOuts: 900,
      po: 400,
      assists: 200,
      errors: 20,
      sb: 0,
      cs: 0,
    });
    expect(metrics.rangeFactor).toBeCloseTo(18);
    expect(metrics.fieldingPct).toBeCloseTo(600 / 620);
    expect(metrics.caughtStealingPct).toBeNull();
  });

  it('falls back to games when innings are missing (pre-1954)', () => {
    const metrics = fieldingMetrics({
      games: 100,
      innOuts: 0,
      po: 300,
      assists: 50,
      errors: 10,
      sb: 0,
      cs: 0,
    });
    expect(metrics.rangeFactor).toBeCloseTo(3.5);
  });

  it('reports caught-stealing percentage only when there were attempts', () => {
    expect(
      fieldingMetrics({ games: 100, innOuts: 800, po: 700, assists: 50, errors: 5, sb: 60, cs: 40 })
        .caughtStealingPct,
    ).toBeCloseTo(0.4);
    expect(
      fieldingMetrics({ games: 100, innOuts: 800, po: 700, assists: 50, errors: 5, sb: 0, cs: 0 })
        .caughtStealingPct,
    ).toBeNull();
  });
});

describe('zScores', () => {
  it('standardises values', () => {
    const z = zScores([1, 2, 3]);
    expect(z[0]).toBeCloseTo(-1.2247, 3);
    expect(z[2]).toBeCloseTo(1.2247, 3);
  });

  it('returns zeroes when every value is identical', () => {
    expect(zScores([5, 5, 5])).toEqual([0, 0, 0]);
    expect(zScores([])).toEqual([]);
  });
});

describe('percentileRank', () => {
  it('is neutral for a lone qualifier', () => {
    expect(percentileRank(1, [1])).toBe(50);
  });

  it('ranks the best and worst of a pool', () => {
    const scores = [0, 1, 2, 3];
    expect(percentileRank(3, scores)).toBeCloseTo(87.5);
    expect(percentileRank(0, scores)).toBeCloseTo(12.5);
  });

  it('gives tied values the same midrank', () => {
    expect(percentileRank(1, [1, 1])).toBe(50);
  });
});

describe('ratingFromPercentile', () => {
  it('bands percentiles onto the -3..+3 scale', () => {
    expect(ratingFromPercentile(100)).toBe(3);
    expect(ratingFromPercentile(97)).toBe(3);
    expect(ratingFromPercentile(96.9)).toBe(2);
    expect(ratingFromPercentile(85)).toBe(2);
    expect(ratingFromPercentile(84.9)).toBe(1);
    expect(ratingFromPercentile(65)).toBe(1);
    expect(ratingFromPercentile(64.9)).toBe(0);
    expect(ratingFromPercentile(35)).toBe(0);
    expect(ratingFromPercentile(34.9)).toBe(-1);
    expect(ratingFromPercentile(15)).toBe(-1);
    expect(ratingFromPercentile(14.9)).toBe(-2);
    expect(ratingFromPercentile(3)).toBe(-2);
    expect(ratingFromPercentile(2.9)).toBe(-3);
    expect(ratingFromPercentile(0)).toBe(-3);
  });
});

describe('combinedScore', () => {
  it('weights range factor more heavily than fielding percentage for fielders', () => {
    const rangeOnly = combinedScore('SS', { rangeFactor: 1, fieldingPct: 0, caughtStealing: null });
    const pctOnly = combinedScore('SS', { rangeFactor: 0, fieldingPct: 1, caughtStealing: null });
    expect(rangeOnly).toBeCloseTo(0.6);
    expect(pctOnly).toBeCloseTo(0.4);
  });

  it('adds caught stealing for catchers', () => {
    const withCs = combinedScore('C', { rangeFactor: 1, fieldingPct: 1, caughtStealing: 1 });
    const withoutCs = combinedScore('C', { rangeFactor: 1, fieldingPct: 1, caughtStealing: null });
    expect(withCs).toBeCloseTo(1);
    expect(withoutCs).toBeCloseTo(1);
  });

  it('renormalises catcher weights when the CS columns are blank', () => {
    expect(combinedScore('C', { rangeFactor: 1, fieldingPct: 0, caughtStealing: null })).toBeCloseTo(
      0.3 / 0.7,
    );
  });
});

describe('computeFieldingRatings', () => {
  const poolSize = 30;

  function pool(position: FieldingCandidate['position'], year = 1995): FieldingCandidate[] {
    return Array.from({ length: poolSize }, (_, index) =>
      candidate({
        playerId: `p${index.toString().padStart(2, '0')}`,
        year,
        position,
        po: 100 + index * 10,
        assists: 0,
        errors: 0,
      }),
    );
  }

  it('gives the best and worst qualifiers the extreme ratings', () => {
    const ratings = computeFieldingRatings(pool('SS'));
    expect(ratings.get(ratingKey('p29', 1995, 'SS'))).toBe(3);
    expect(ratings.get(ratingKey('p00', 1995, 'SS'))).toBe(-3);
  });

  it('produces a sane spread across the whole band range', () => {
    const ratings = [...computeFieldingRatings(pool('SS')).values()];
    expect(ratings).toHaveLength(poolSize);
    expect(new Set(ratings).size).toBeGreaterThan(3);
    expect(Math.min(...ratings)).toBe(-3);
    expect(Math.max(...ratings)).toBe(3);
    expect(ratings.filter((rating) => rating === 0).length).toBeGreaterThan(0);
  });

  it('skips players below the minimum games threshold', () => {
    const candidates = pool('SS');
    candidates.push(candidate({ playerId: 'scrub01', games: RULES_CONFIG.fieldingRatingMinGames - 1, po: 999 }));
    const ratings = computeFieldingRatings(candidates);
    expect(ratings.has(ratingKey('scrub01', 1995, 'SS'))).toBe(false);
    expect(ratings.get(ratingKey('p29', 1995, 'SS'))).toBe(3);
  });

  it('rates each season and position independently', () => {
    const ratings = computeFieldingRatings([...pool('SS', 1995), ...pool('SS', 1996), ...pool('C', 1995)]);
    expect(ratings.get(ratingKey('p29', 1995, 'SS'))).toBe(3);
    expect(ratings.get(ratingKey('p29', 1996, 'SS'))).toBe(3);
    expect(ratings.get(ratingKey('p00', 1995, 'C'))).toBe(-3);
  });

  it('never rates pitchers', () => {
    const ratings = computeFieldingRatings(pool('P'));
    expect(ratings.size).toBe(0);
  });

  it('keeps tiny pools from producing extreme ratings', () => {
    const solo = computeFieldingRatings([candidate({ playerId: 'solo01', position: 'SS' })]);
    expect(solo.get(ratingKey('solo01', 1995, 'SS'))).toBe(0);

    const small = pool('SS').slice(0, 4);
    const ratings = [...computeFieldingRatings(small).values()];
    expect(Math.max(...ratings)).toBeLessThanOrEqual(2);
    expect(Math.min(...ratings)).toBeGreaterThanOrEqual(-2);
  });

  it('rewards a catcher who throws out runners', () => {
    const catchers = Array.from({ length: 20 }, (_, index) =>
      candidate({
        playerId: `c${index.toString().padStart(2, '0')}`,
        position: 'C',
        po: 800,
        assists: 50,
        errors: 5,
        sb: 80,
        cs: 20,
      }),
    );
    // Best-throwing catcher, everything else identical.
    catchers[0] = { ...(catchers[0] as FieldingCandidate), cs: 60, sb: 40 };
    const ratings = computeFieldingRatings(catchers);
    expect(ratings.get(ratingKey('c00', 1995, 'C'))).toBe(3);
  });
});
