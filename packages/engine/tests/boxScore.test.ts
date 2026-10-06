import { describe, expect, it } from 'vitest';
import { emptyBattingLine, emptyPitchingLine, formatBattingLine, formatPitchingLine, earnedRunAverage, battingAverage } from '@cardball/shared';
import { createGame } from '../src/create.js';
import { seededRng } from '../src/rng.js';
import { autoPlay } from '../src/sim.js';
import type { GameState, Side } from '../src/types.js';
import { randomTeam } from './fixtures.js';

function played(seed: number, innings = 9): { state: GameState; events: ReturnType<typeof autoPlay>['events'] } {
  const home = randomTeam('h', seed * 5 + 1);
  const away = randomTeam('g', seed * 5 + 2);
  const created = createGame({ id: `box${seed}`, mode: 'bot', regulationInnings: innings, teams: [home, away] }, seededRng(seed));
  return autoPlay(created.state, seededRng(seed + 1000));
}

const sum = <T>(rows: T[], f: (row: T) => number) => rows.reduce((n, row) => n + f(row), 0);
const other = (side: Side): Side => (side === 'home' ? 'away' : 'home');

describe('box score', () => {
  it('adds up to the scoreboard in every simulated game', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { state, events } = played(seed);
      expect(state.phase).toBe('finished');
      for (const side of ['home', 'away'] as const) {
        const batting = Object.values(state.box![side].batting);
        const opposingPitching = Object.values(state.box![other(side)].pitching);
        const half = side === 'away' ? 'top' : 'bottom';

        // Runs: scored by the batters, charged to the other side's pitchers.
        expect(sum(batting, (b) => b.r)).toBe(state[side].score);
        expect(sum(opposingPitching, (p) => p.r)).toBe(state[side].score);
        expect(sum(batting, (b) => b.rbi)).toBeLessThanOrEqual(state[side].score);

        // Hits match the play-by-play.
        expect(sum(batting, (b) => b.h)).toBe(events.filter((e) => e.kind === 'hit' && e.half === half).length);
        // Both sides of the matchup agree.
        expect(sum(opposingPitching, (p) => p.h)).toBe(sum(batting, (b) => b.h));
        expect(sum(opposingPitching, (p) => p.k)).toBe(sum(batting, (b) => b.k));
        expect(sum(opposingPitching, (p) => p.bb)).toBe(sum(batting, (b) => b.bb));
        expect(sum(opposingPitching, (p) => p.hr)).toBe(sum(batting, (b) => b.hr));
        expect(sum(opposingPitching, (p) => p.bf)).toBe(sum(batting, (b) => b.pa));

        for (const b of batting) {
          expect(b.ab).toBe(b.pa - b.bb - b.sf);
          expect(b.doubles + b.triples + b.hr).toBeLessThanOrEqual(b.h);
        }
        // Outs on the mound line up with what the pitchers' own counters say.
        for (const [id, p] of Object.entries(state.box![other(side)].pitching)) {
          const pitcher = state[other(side)].players.find((pl) => pl.id === id)!;
          expect(p.outs).toBe(pitcher.outsPitched);
        }
      }
    }
  });

  it('lists the starting nine and both starters before the first pitch is decided', () => {
    const { state } = played(3, 3);
    for (const side of ['home', 'away'] as const) {
      const spots = Object.values(state.box![side].batting).map((b) => b.spot);
      for (let spot = 0; spot < 9; spot++) expect(spots).toContain(spot);
      expect(Object.keys(state.box![side].pitching).length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('box-score lines', () => {
  it('reads a batter the way a broadcaster does', () => {
    expect(formatBattingLine(emptyBattingLine())).toBe('');
    expect(formatBattingLine({ ...emptyBattingLine(), pa: 4, ab: 3, h: 2, hr: 2, rbi: 3, r: 2, bb: 1 })).toBe('2 for 3, 2 HR, 3 RBI, 2 R, BB');
    expect(formatBattingLine({ ...emptyBattingLine(), pa: 1, ab: 1, k: 1 })).toBe('0 for 1, K');
    expect(battingAverage({ h: 1, ab: 3 })).toBe('.333');
  });

  it('reads a pitcher in innings and thirds', () => {
    expect(formatPitchingLine(emptyPitchingLine())).toBe('');
    expect(formatPitchingLine({ outs: 5, bf: 9, h: 2, r: 2, bb: 1, k: 3, hr: 0 })).toBe('1.2 IP, 2 H, 2 ER, 1 BB, 3 K');
    expect(earnedRunAverage({ r: 2, outs: 27 })).toBe('2.00');
    expect(earnedRunAverage({ r: 0, outs: 0 })).toBe('—');
  });
});
