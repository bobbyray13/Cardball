import { describe, expect, it } from 'vitest';
import {
  accumulateOfGames,
  emptyOfGames,
  isOutfieldSpot,
  mostPlayedOfSpot,
  resolveOutfieldRows,
} from '../src/fielding.js';
import type { FieldingStint } from '../src/types.js';

function ofRow(overrides: Partial<FieldingStint> = {}): FieldingStint {
  return {
    playerId: 'mayswi01',
    year: 1951,
    stint: 1,
    teamId: 'NY1',
    position: 'OF',
    games: 121,
    innOuts: 1000,
    po: 300,
    assists: 10,
    errors: 6,
    sb: 0,
    cs: 0,
    ...overrides,
  };
}

describe('outfield helpers', () => {
  it('recognises outfield spots', () => {
    expect(isOutfieldSpot('CF')).toBe(true);
    expect(isOutfieldSpot('OF')).toBe(false);
  });

  it('picks the spot with the most games, defaulting when there is no data', () => {
    expect(mostPlayedOfSpot({ LF: 2, CF: 115, RF: 3 })).toBe('CF');
    expect(mostPlayedOfSpot({ LF: 0, CF: 0, RF: 0 }, 'RF')).toBe('RF');
    expect(mostPlayedOfSpot({ LF: 0, CF: 0, RF: 0 })).toBe('CF');
  });

  it('accumulates career outfield games per player', () => {
    const career = new Map<string, ReturnType<typeof emptyOfGames>>();
    accumulateOfGames(career, 'mayswi01', ofRow({ position: 'LF', games: 3 }));
    accumulateOfGames(career, 'mayswi01', ofRow({ position: 'CF', games: 100 }));
    expect(career.get('mayswi01')).toEqual({ LF: 3, CF: 100, RF: 0 });
  });
});

describe('resolveOutfieldRows', () => {
  it('returns the split rows when the split file covers the stint', () => {
    const splitRows = [
      ofRow({ position: 'CF', games: 118, po: 290 }),
      ofRow({ position: 'LF', games: 3, po: 5 }),
    ];
    expect(resolveOutfieldRows({ ofRows: [ofRow()], splitRows })).toEqual(splitRows);
  });

  it('trusts the split file when its stint numbering differs', () => {
    const splitRows = [ofRow({ stint: 7, position: 'RF', games: 40 })];
    expect(resolveOutfieldRows({ ofRows: [ofRow({ stint: 1 })], splitRows })).toEqual(splitRows);
  });

  it('keeps the split rows when there is no legacy OF row at all', () => {
    const splitRows = [ofRow({ position: 'CF', games: 20 })];
    expect(resolveOutfieldRows({ ofRows: [], splitRows })).toEqual(splitRows);
  });

  it('splits an uncovered stint with the season games-by-field', () => {
    const resolved = resolveOutfieldRows({
      ofRows: [ofRow()],
      splitRows: [],
      ofTotals: { LF: 2, CF: 115, RF: 3 },
    });
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.position).toBe('CF');
    expect(resolved[0]?.games).toBe(121);
  });

  it('prefers the season split over the career spot', () => {
    const resolved = resolveOutfieldRows({
      ofRows: [ofRow()],
      splitRows: [],
      ofTotals: { LF: 100, CF: 1, RF: 1 },
      careerSpot: 'CF',
    });
    expect(resolved[0]?.position).toBe('LF');
  });

  it('falls back to the career spot and then to CF', () => {
    expect(
      resolveOutfieldRows({ ofRows: [ofRow()], splitRows: [], ofTotals: null, careerSpot: 'RF' })[0]
        ?.position,
    ).toBe('RF');
    expect(
      resolveOutfieldRows({ ofRows: [ofRow()], splitRows: [], ofTotals: null, careerSpot: null })[0]
        ?.position,
    ).toBe('CF');
  });

  it('only falls back for the stints the split file misses', () => {
    const resolved = resolveOutfieldRows({
      ofRows: [ofRow({ stint: 1 }), ofRow({ stint: 2, teamId: 'BSN', games: 20 })],
      splitRows: [ofRow({ stint: 1, position: 'CF' })],
      ofTotals: null,
      careerSpot: 'RF',
    });
    expect(resolved).toHaveLength(2);
    expect(resolved[0]?.position).toBe('CF');
    expect(resolved[1]?.stint).toBe(2);
    expect(resolved[1]?.position).toBe('RF');
  });
});
