import { describe, expect, it } from 'vitest';
import { createGame } from '../src/create.js';
import { seededRng } from '../src/rng.js';
import { autoPlay } from '../src/sim.js';
import type { GameState } from '../src/types.js';
import { randomTeam } from './fixtures.js';

/** Two teams managed by humans, as tournament matches are. */
function humanGame(seed: number, innings = 3): GameState {
  const home = randomTeam('h', seed * 3 + 1, false);
  const away = randomTeam('g', seed * 3 + 2, false);
  home.userId = 101;
  away.userId = 202;
  return createGame(
    { id: `sim${seed}`, mode: 'remote', regulationInnings: innings, teams: [home, away] },
    seededRng(seed),
  ).state;
}

describe('autoPlay', () => {
  it('plays a scheduled match out from the lobby, whoever manages the teams', () => {
    const before = humanGame(7);
    expect(before.phase).toBe('lobby');

    const { state, events } = autoPlay(before, seededRng(70));

    expect(state.phase).toBe('finished');
    expect(state.winner).not.toBeNull();
    expect(state.home.score).not.toBe(state.away.score);
    // It said play ball first, and the event log stayed gapless.
    expect(events[0]?.kind).toBe('game-start');
    events.forEach((e, i) => expect(e.seq).toBe(events[0]!.seq + i));
  });

  it('is deterministic for a given seed', () => {
    const a = autoPlay(humanGame(11), seededRng(1));
    const b = autoPlay(humanGame(11), seededRng(1));
    expect(a.state).toEqual(b.state);
    expect(a.events).toEqual(b.events);
  });

  it('leaves a finished game alone', () => {
    const played = autoPlay(humanGame(23, 3), seededRng(2)).state;
    const again = autoPlay(played, seededRng(3));
    // Nothing left to do: no actions, no events, the same state back.
    expect(again.state).toBe(played);
    expect(again.events).toEqual([]);
  });
});
