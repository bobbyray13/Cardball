import { RULES_CONFIG, hitMod, pitMod, sbMod } from '@cardball/shared';
import type { GameAction } from '@cardball/shared';
import { benchHitters } from './flow.js';
import { availablePitchers, fieldingRating, getDefense, getOffense, getTeam, seasonForPlayer } from './queries.js';
import type { EnginePlayer, GameState, Side, TeamState } from './types.js';

/** Average d6 with 1s re-rolled. */
const SEND_EXPECTED_ROLL = 4;
const D6_EXPECTED = 3.5;
const D20_EXPECTED = 10.5;

/**
 * A simple, honest auto-manager: answers every forced decision sensibly,
 * takes calculated DP and send gambles, never steals. Returns null when the
 * bot has nothing to do for this side right now.
 */
export function botAction(state: GameState, side: Side): GameAction | null {
  if (state.phase !== 'live') return null;
  const team = getTeam(state, side);
  const pending = state.pendingDecision;

  if (pending) {
    if (pending.side !== side) return null;
    switch (pending.kind) {
      case 'dp-attempt': {
        const f = pending.detail?.dpFactors ?? { diff: 0, fielding: 0, batterSb: 0 };
        // Batter speed works against the defense.
        const expected = f.diff + f.fielding - f.batterSb + D20_EXPECTED;
        return { type: 'dp-attempt', attempt: expected > RULES_CONFIG.dpTarget };
      }
      case 'send-runner': {
        const runner = team.players.find((p) => p.id === pending.playerId);
        const thrower = getDefense(state).players.find((p) => p.id === pending.detail?.throwerId);
        if (!runner) return { type: 'send-runner', send: false };
        const rMod = sbMod(seasonForPlayer(state, runner).sb) + (pending.detail?.runnerAdvantage ?? 0);
        const tMod = thrower ? fieldingRating(thrower, thrower.fieldPosition ?? 'CF') : 0;
        return { type: 'send-runner', send: SEND_EXPECTED_ROLL + rMod >= D6_EXPECTED + tMod };
      }
      case 'pinch-runner':
      case 'lineup-fill': {
        const out = team.players.find((p) => p.id === pending.playerId);
        const pick = bestBench(state, team, out ?? null, pending.kind === 'pinch-runner' ? 'speed' : 'bat');
        if (!pick || !pending.playerId) return null;
        return { type: 'substitute', outPlayerId: pending.playerId, inPlayerId: pick.id };
      }
      case 'pitcher-change': {
        const options = availablePitchers(state, side);
        const best = maxBy(options, (p) => pitMod(seasonForPlayer(state, p).pitching?.era ?? null));
        return best ? { type: 'pitcher-change', inPlayerId: best.id } : null;
      }
    }
  }

  if (state.currentPa && getOffense(state).side === side) return { type: 'throw-pitch' };
  return null;
}

function bestBench(state: GameState, team: TeamState, out: EnginePlayer | null, by: 'speed' | 'bat'): EnginePlayer | null {
  const bench = benchHitters(team);
  const pos = out?.fieldPosition ?? null;
  return maxBy(bench, (p) => {
    const season = seasonForPlayer(state, p);
    const value = by === 'speed' ? sbMod(season.sb) : hitMod(season.avg);
    // Strongly prefer someone who can actually play the vacated position.
    const fits = !pos || pos === 'DH' || p.positions.includes(pos) ? 10 : 0;
    return value + fits;
  });
}

function maxBy<T>(items: T[], score: (item: T) => number): T | null {
  let best: T | null = null;
  let bestScore = -Infinity;
  for (const item of items) {
    const s = score(item);
    if (s > bestScore) {
      best = item;
      bestScore = s;
    }
  }
  return best;
}
