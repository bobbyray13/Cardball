import { sbMod } from '@cardball/shared';
import type { GameAction } from '@cardball/shared';
import { canSteal } from './steal.js';
import { canSubstituteNow } from './subs.js';
import {
  availablePitchers,
  fielderAt,
  fieldingRating,
  getDefense,
  getOffense,
  getTeam,
  pitcherFatigue,
  pitcherTotalMod,
  rulesOf,
  runnerSbMod,
  runnersOn,
  seasonForPlayer,
} from './queries.js';
import type { GameState, Side } from './types.js';

/** Average d6 with 1s re-rolled. */
const SEND_EXPECTED_ROLL = 4;
const D6_EXPECTED = 3.5;
const D20_EXPECTED = 10.5;

/**
 * A simple, honest auto-manager: answers every forced decision sensibly,
 * takes calculated DP, send, and steal gambles. Returns null when the bot
 * has nothing to do for this side right now.
 */
export function botAction(state: GameState, side: Side): GameAction | null {
  if (state.phase !== 'live') return null;
  // A steal goes first: before the pitch, or while the pitcher's die is in
  // the air, whenever the situation demands it.
  const stealAction = botSteal(state, side);
  if (stealAction) return stealAction;
  const rules = rulesOf(state);
  const team = getTeam(state, side);
  const pending = state.pendingDecision;

  if (pending) {
    if (pending.side !== side) return null;
    switch (pending.kind) {
      case 'dp-attempt': {
        const f = pending.detail?.dpFactors ?? { diff: 0, fielding: 0, batterSb: 0 };
        // Batter speed works against the defense.
        const expected = f.diff + f.fielding - f.batterSb + D20_EXPECTED;
        return { type: 'dp-attempt', attempt: expected > rules.dpTarget };
      }
      case 'send-runner': {
        const runner = team.players.find((p) => p.id === pending.playerId);
        const thrower = getDefense(state).players.find((p) => p.id === pending.detail?.throwerId);
        if (!runner) return { type: 'send-runner', send: false };
        const rMod = sbMod(seasonForPlayer(state, runner).sb, rules.sbBands) + (pending.detail?.runnerAdvantage ?? 0);
        const tMod = thrower ? fieldingRating(thrower, thrower.fieldPosition ?? 'CF') : 0;
        return { type: 'send-runner', send: SEND_EXPECTED_ROLL + rMod >= D6_EXPECTED + tMod };
      }
      case 'pitcher-change': {
        const options = availablePitchers(state, side);
        const best = maxBy(options, (p) => pitcherTotalMod(state, p).mod);
        return best ? { type: 'pitcher-change', inPlayerId: best.id } : null;
      }
      case 'batter-roll':
        // Paced pitching: the bot takes its own roll without hesitation.
        return { type: 'roll-bat' };
    }
  }

  if (state.currentPa) {
    const offense = getOffense(state);
    if (state.config.pacedPitch) {
      // The defense throws the pitcher's die; the offense answers with roll-bat.
      return getDefense(state).side === side ? { type: 'throw-pitch' } : null;
    }
    return offense.side === side ? { type: 'throw-pitch' } : null;
  }
  return null;
}

/**
 * A move a bot manager makes off the clock: stealing a base when the
 * situation demands it, or going to the bullpen when his tired pitcher is a
 * worse bet than the best fresh arm. Callers decide which sides they drive —
 * a live game only drives its bot teams, a simulation drives both.
 */
export function botOffClockAction(state: GameState, side: Side): GameAction | null {
  if (state.phase !== 'live') return null;
  const stealAction = botSteal(state, side);
  if (stealAction) return stealAction;
  if (getDefense(state).side !== side) return null;
  if (!canSubstituteNow(state)) return null;

  const defense = getDefense(state);
  const pitcher = defense.players.find((p) => p.id === defense.activePitcherId);
  if (!pitcher || pitcherFatigue(state, pitcher) === 0) return null;

  const current = pitcherTotalMod(state, pitcher).mod;
  const best = maxBy(availablePitchers(state, side), (p) => pitcherTotalMod(state, p).mod);
  if (!best || pitcherTotalMod(state, best).mod <= current) return null;
  return { type: 'pitcher-change', inPlayerId: best.id };
}

/**
 * When the bot's offense risks a steal: d6 + SB vs d6 + the catcher's arm,
 * with the situation setting the bar. Nothing to gain early or in a blowout;
 * down to the last chances in a close one, the bot goes on a coin flip.
 */
function botSteal(state: GameState, side: Side): GameAction | null {
  const offense = getTeam(state, side);
  if (getOffense(state).side !== side) return null;
  const defense = getDefense(state);
  const rules = rulesOf(state);

  const deficit = defense.score - offense.score;
  const late = state.inning >= Math.max(2, state.config.regulationInnings - 1);
  const close = Math.abs(deficit) <= 2;
  if (!late && !close) return null; // nothing to gain yet
  if (deficit <= -3) return null; // a big lead doesn't need the gamble
  // Down late the bot takes a coin flip; any other time it wants a full run
  // of speed over the catcher's arm.
  const needed = late && deficit >= 1 ? 0 : 1;

  const catcher = fielderAt(state, defense.side, 'C');
  const cArm = catcher ? fieldingRating(catcher, 'C') : 0;
  for (const runner of runnersOn(offense)) {
    if (runner.base === null || runner.base >= 3) continue;
    if (!canSteal(state, runner.id).ok) continue;
    const target = runner.base + 1;
    const cBonus = target === 3 ? rules.stealThirdCatcherBonus : 0;
    const rMod = runnerSbMod(seasonForPlayer(state, runner), rules).mod;
    if (rMod - cArm - cBonus >= needed) return { type: 'attempt-steal', runnerId: runner.id };
  }
  return null;
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
