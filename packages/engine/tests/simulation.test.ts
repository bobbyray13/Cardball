import { describe, expect, it } from 'vitest';
import { applyAction, waitingOn } from '../src/apply.js';
import { botAction } from '../src/bot.js';
import { createGame } from '../src/create.js';
import { seededRng } from '../src/rng.js';
import type { GameEvent, GameState } from '../src/types.js';
import { randomTeam } from './fixtures.js';

const BOT = { userId: null, isBot: true };

function checkInvariants(state: GameState): void {
  expect(state.outs).toBeGreaterThanOrEqual(0);
  expect(state.outs).toBeLessThan(3);
  for (const team of [state.home, state.away]) {
    const bases = team.players.filter((p) => p.base !== null).map((p) => p.base);
    expect(new Set(bases).size).toBe(bases.length);
    expect(team.players.filter((p) => p.base !== null).every((p) => p.status === 'active')).toBe(true);
    const lineup = team.lineup.filter((id): id is string => id !== null);
    expect(new Set(lineup).size).toBe(lineup.length);
  }
  const defense = state.half === 'top' ? state.home : state.away;
  if (state.phase === 'live') {
    const fielders = defense.players.filter((p) => p.status === 'active' && p.fieldPosition && p.fieldPosition !== 'DH');
    const positions = fielders.map((p) => p.fieldPosition);
    expect(new Set(positions).size).toBe(positions.length);
  }
}

function simulate(seed: number, innings: number): { state: GameState; events: GameEvent[]; actions: number } {
  const rng = seededRng(seed);
  let { state, events } = createGame(
    { id: `sim${seed}`, mode: 'bot', regulationInnings: innings, teams: [randomTeam('a', seed * 2 + 1), randomTeam('b', seed * 2 + 2)] },
    rng,
  );
  const all = [...events];
  ({ state, events } = applyAction(state, { type: 'start-game' }, BOT, rng));
  all.push(...events);

  let actions = 0;
  while (state.phase === 'live' && actions < 20_000) {
    const waiting = waitingOn(state);
    if (!waiting) throw new Error(`Game stalled: ${JSON.stringify({ inning: state.inning, half: state.half, pending: state.pendingDecision })}`);
    const action = botAction(state, waiting.side);
    if (!action) throw new Error(`Bot has no move for ${waiting.kind}: ${waiting.prompt}`);
    ({ state, events } = applyAction(state, action, BOT, rng));
    all.push(...events);
    checkInvariants(state);
    actions++;
  }
  return { state, events: all, actions };
}

describe('bot vs bot simulation', () => {
  it('plays 300 complete games without breaking the rules', () => {
    let totalRuns = 0;
    let extraInningGames = 0;
    let stealAttempts = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const innings = [3, 6, 9][seed % 3]!;
      const { state, events } = simulate(seed, innings);
      expect(state.phase).toBe('finished');
      expect(state.winner).not.toBeNull();
      expect(state.home.score).not.toBe(state.away.score);

      // Every run on the board has a matching run event.
      const runEvents = events.filter((e) => e.kind === 'run');
      expect(runEvents.length).toBe(state.home.score + state.away.score);

      // Event sequence numbers are gapless.
      events.forEach((e, i) => expect(e.seq).toBe(i + 1));

      if (state.inning > innings) extraInningGames++;
      totalRuns += state.home.score + state.away.score;
      stealAttempts += events.filter((e) => e.kind === 'steal').length;
    }
    console.log(`300 sims: ${(totalRuns / 300).toFixed(1)} runs/game, ${extraInningGames} went to extras, ${stealAttempts} steal attempts`);
    // Sanity: offense actually happens, and games aren't absurd.
    expect(totalRuns).toBeGreaterThan(300);
    expect(extraInningGames).toBeLessThan(150);
    // The running game is alive: the bots do go when the situation demands.
    expect(stealAttempts).toBeGreaterThan(0);
  }, 120_000);

  it('is deterministic for a given seed', () => {
    const a = simulate(42, 9);
    const b = simulate(42, 9);
    expect(a.state).toEqual(b.state);
  });
});
