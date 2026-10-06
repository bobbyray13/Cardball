import { describe, expect, it } from 'vitest';
import {
  appearanceGames,
  battingAverage,
  buildTeamLabel,
  earnedRunAverage,
  mergeBatting,
  mergeFielding,
  mergePitching,
  plateAppearances,
  preferPerson,
} from '../src/merge.js';
import type { BattingStint, FieldingStint, PitchingStint } from '../src/types.js';

function battingStint(overrides: Partial<BattingStint> = {}): BattingStint {
  return {
    playerId: 'testa01',
    year: 2004,
    stint: 1,
    teamId: 'SEA',
    games: 100,
    ab: 400,
    h: 120,
    doubles: 20,
    triples: 5,
    homeRuns: 10,
    rbi: 60,
    sb: 20,
    bb: 30,
    hbp: 2,
    sh: 1,
    sf: 3,
    ...overrides,
  };
}

function pitchingStint(overrides: Partial<PitchingStint> = {}): PitchingStint {
  return {
    playerId: 'testp01',
    year: 1995,
    stint: 1,
    teamId: 'ATL',
    games: 28,
    ipOuts: 620,
    er: 38,
    bf: 800,
    ...overrides,
  };
}

describe('mergeBatting', () => {
  it('sums stints into one season and derives AVG/PA', () => {
    const merged = mergeBatting([
      battingStint(),
      battingStint({ stint: 2, teamId: 'NYA', games: 40, ab: 150, h: 50, doubles: 5, sb: 10, bb: 10, hbp: 1, sh: 0, sf: 1, homeRuns: 4, rbi: 25 }),
    ]);

    expect(merged.games).toBe(140);
    expect(merged.ab).toBe(550);
    expect(merged.h).toBe(170);
    expect(merged.doubles).toBe(25);
    expect(merged.homeRuns).toBe(14);
    expect(merged.rbi).toBe(85);
    expect(merged.sb).toBe(30);
    expect(merged.avg).toBeCloseTo(170 / 550);
    // AB + BB + HBP + SH + SF
    expect(merged.pa).toBe(550 + 40 + 3 + 1 + 4);
  });

  it('has no average when the season has no at-bats', () => {
    const merged = mergeBatting([battingStint({ ab: 0, h: 0, bb: 5, hbp: 0, sh: 2, sf: 0 })]);
    expect(merged.avg).toBeNull();
    expect(merged.pa).toBe(7);
  });

  it('computes average and plate appearances from their definitions', () => {
    expect(battingAverage(0, 0)).toBeNull();
    expect(battingAverage(3, 10)).toBeCloseTo(0.3);
    expect(plateAppearances(10, 4, 1, 1, 2)).toBe(18);
  });
});

describe('mergePitching', () => {
  it('sums stints and converts outs to ERA', () => {
    const merged = mergePitching([
      pitchingStint(),
      pitchingStint({ stint: 2, teamId: 'NYA', games: 5, ipOuts: 100, er: 10, bf: 120 }),
    ]);
    expect(merged.games).toBe(33);
    expect(merged.ipOuts).toBe(720);
    expect(merged.er).toBe(48);
    expect(merged.bf).toBe(920);
    // 48 earned runs in 240 innings
    expect(merged.era).toBeCloseTo(1.8);
  });

  it('has no ERA without recorded outs', () => {
    expect(earnedRunAverage(5, 0)).toBeNull();
    expect(mergePitching([pitchingStint({ ipOuts: 0, er: 0 })]).era).toBeNull();
  });
});

describe('mergeFielding', () => {
  it('sums only the requested position', () => {
    const rows: FieldingStint[] = [
      { playerId: 'x', year: 1951, stint: 1, teamId: 'NY1', position: 'CF', games: 100, innOuts: 800, po: 200, assists: 5, errors: 4, sb: 0, cs: 0 },
      { playerId: 'x', year: 1951, stint: 1, teamId: 'NY1', position: 'LF', games: 10, innOuts: 80, po: 20, assists: 1, errors: 1, sb: 0, cs: 0 },
      { playerId: 'x', year: 1951, stint: 2, teamId: 'BSN', position: 'CF', games: 20, innOuts: 160, po: 40, assists: 1, errors: 0, sb: 0, cs: 0 },
    ];
    const totals = mergeFielding(rows, 'CF');
    expect(totals.games).toBe(120);
    expect(totals.innOuts).toBe(960);
    expect(totals.po).toBe(240);
    expect(totals.assists).toBe(6);
    expect(totals.errors).toBe(4);
    expect(mergeFielding(rows, 'SS').games).toBe(0);
  });
});

describe('buildTeamLabel', () => {
  it('joins teams in stint order and collapses duplicate rows per stint', () => {
    expect(
      buildTeamLabel([
        { stint: 2, teamId: 'BOS' },
        { stint: 1, teamId: 'NYA' },
        { stint: 1, teamId: 'NYA' }, // same stint seen in the pitching file
        { stint: 1, teamId: 'NYA' },
      ]),
    ).toBe('NYA/BOS');
  });

  it('keeps a genuine return to a team in a later stint', () => {
    expect(
      buildTeamLabel([
        { stint: 1, teamId: 'NYA' },
        { stint: 2, teamId: 'OAK' },
        { stint: 3, teamId: 'NYA' },
      ]),
    ).toBe('NYA/OAK/NYA');
  });

  it('ignores blank team ids', () => {
    expect(buildTeamLabel([{ stint: 1, teamId: '  ' }, { stint: 2, teamId: 'ATL' }])).toBe('ATL');
  });
});

describe('appearanceGames', () => {
  it('prefers the Appearances.csv total', () => {
    expect(
      appearanceGames({ appearancesGames: 125, battingGames: 120, pitchingGames: 0, fieldingGames: 118 }),
    ).toBe(125);
  });

  it('falls back to the largest count when appearances are unavailable', () => {
    expect(
      appearanceGames({ appearancesGames: null, battingGames: 12, pitchingGames: 0, fieldingGames: 30 }),
    ).toBe(30);
    expect(
      appearanceGames({ appearancesGames: 0, battingGames: 12, pitchingGames: 15, fieldingGames: 0 }),
    ).toBe(15);
  });
});

describe('preferPerson', () => {
  const person = (playerId: string, bbrefId: string, debutYear: number | null) => ({
    playerId,
    bbrefId,
    debutYear,
  });

  it('prefers the row whose playerID is the bbrefID', () => {
    // hallch02 (real player) vs hallch03 (duplicate row), both bbref hallch02.
    expect(preferPerson(person('hallch03', 'hallch02', null), person('hallch02', 'hallch02', 1906))).toEqual(
      person('hallch02', 'hallch02', 1906),
    );
  });

  it('otherwise prefers the row that actually played', () => {
    expect(
      preferPerson(person('brownb01', 'brownba02', null), person('brownba02', 'brownba02', 1905)),
    ).toEqual(person('brownba02', 'brownba02', 1905));
  });

  it('keeps the first row when neither has an edge', () => {
    const first = person('clay01', 'clay04', null);
    expect(preferPerson(first, person('clay02', 'clay04', null))).toEqual(first);
  });
});
