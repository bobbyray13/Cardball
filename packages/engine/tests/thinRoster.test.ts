import { describe, expect, it } from 'vitest';
import { applyAction, waitingOn } from '../src/apply.js';
import { botAction } from '../src/bot.js';
import { createGame } from '../src/create.js';
import { seededRng } from '../src/rng.js';
import type { GameState, PlayerSetup, TeamSetup } from '../src/types.js';
import { batter, pitcher } from './fixtures.js';

const BOT = { userId: null, isBot: true };
const FIELD = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as const;

/**
 * Nine hitters and one starting pitcher: no bench, no bullpen. That is the
 * smallest legal team, and the shape a player with a small collection fields.
 * It exercises the shallow-lineup and exhausted-staff paths that the deep
 * `randomTeam` roster never reaches.
 */
function thinTeam(prefix: string): TeamSetup {
  const hitters: PlayerSetup[] = FIELD.map((pos, i) => batter(`${prefix}${i}`, [pos]));
  const dh = batter(`${prefix}dh`, ['1B']);
  const sp = pitcher(`${prefix}sp`, 'SP');
  return {
    userId: null,
    isBot: true,
    name: `Thin ${prefix.toUpperCase()}`,
    players: [...hitters, dh, sp],
    lineup: [...hitters.map((h) => h.id), dh.id],
    fieldPositions: Object.fromEntries(FIELD.map((pos, i) => [pos, `${prefix}${i}`])),
    startingPitcherId: sp.id,
  };
}

function play(seed: number, innings: number): GameState {
  const rng = seededRng(seed);
  let { state } = createGame({ id: `thin${seed}`, mode: 'bot', regulationInnings: innings, teams: [thinTeam('a'), thinTeam('b')] }, rng);
  ({ state } = applyAction(state, { type: 'start-game' }, BOT, rng));

  let steps = 0;
  while (state.phase === 'live' && steps++ < 20_000) {
    const waiting = waitingOn(state);
    expect(waiting, `game stalled with nobody to act: ${JSON.stringify({ inning: state.inning, half: state.half, pending: state.pendingDecision })}`).not.toBeNull();
    const action = botAction(state, waiting!.side);
    expect(action, `no legal move for ${waiting!.kind}: ${waiting!.prompt}`).not.toBeNull();
    ({ state } = applyAction(state, action!, BOT, rng));
  }
  return state;
}

describe('smallest legal roster', () => {
  it('finishes 120 games with no bench and a one-man pitching staff', () => {
    let runs = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const state = play(seed, [3, 6, 9][seed % 3]!);
      expect(state.phase).toBe('finished');
      expect(state.winner).not.toBeNull();
      expect(state.home.score).not.toBe(state.away.score);
      runs += state.home.score + state.away.score;
    }
    // A one-man staff gets worn down, so scoring runs below the deep-roster sim.
    expect(runs).toBeGreaterThan(120);
  }, 60_000);
});
