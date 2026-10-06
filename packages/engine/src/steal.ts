import { pushEvent, roll } from './events.js';
import { GameError } from './errors.js';
import { endHalfInning } from './flow.js';
import { recordOut } from './pitch.js';
import { fielderAt, fieldingRating, fmtMod, getDefense, getOffense, rulesOf, runnerSbMod, seasonForPlayer } from './queries.js';
import type { Rng } from './rng.js';
import type { GameEvent, GameState } from './types.js';

/** Can this runner try to steal right now? (2nd or 3rd, next base open, before the pitch) */
export function canSteal(state: GameState, runnerId: string): { ok: boolean; reason: string } {
  if (state.phase !== 'live') return { ok: false, reason: 'The game is not in progress' };
  if (state.pendingDecision || state.pendingPlay) return { ok: false, reason: 'A decision is pending' };
  if (!state.currentPa || state.currentPa.balls > 0) return { ok: false, reason: 'Steals happen before the at-bat starts' };
  const offense = getOffense(state);
  const runner = offense.players.find((p) => p.id === runnerId);
  if (!runner || runner.base === null) return { ok: false, reason: 'That player is not on base' };
  if (runner.base === 3) return { ok: false, reason: 'Stealing home is not allowed' };
  const target = runner.base + 1;
  if (offense.players.some((p) => p.base === target)) return { ok: false, reason: `${target === 2 ? 'Second' : 'Third'} base is occupied` };
  return { ok: true, reason: '' };
}

export function applySteal(state: GameState, runnerId: string, rng: Rng): GameEvent[] {
  const check = canSteal(state, runnerId);
  if (!check.ok) throw new GameError(check.reason);

  const events: GameEvent[] = [];
  const offense = getOffense(state);
  const defense = getDefense(state);
  const runner = offense.players.find((p) => p.id === runnerId)!;
  const target = (runner.base! + 1) as 2 | 3;
  const catcher = fielderAt(state, defense.side, 'C');

  const { mod: rMod, note: rNote } = runnerSbMod(seasonForPlayer(state, runner), rulesOf(state));
  const cBase = catcher ? fieldingRating(catcher, 'C') : 0;
  const cBonus = target === 3 ? rulesOf(state).stealThirdCatcherBonus : 0;
  const rRoll = rng.d6();
  const cRoll = rng.d6();
  const rTotal = rRoll + rMod;
  const cTotal = cRoll + cBase + cBonus;

  const rolls = [
    roll(`${runner.name} (stealing)`, 6, rRoll, rMod, rNote),
    roll(`${catcher?.name ?? 'Catcher'} (throwing)`, 6, cRoll, cBase + cBonus, `C rating ${fmtMod(cBase)}${cBonus ? `, +${cBonus} throw to 3rd` : ''}`),
  ];

  if (rTotal >= cTotal) {
    runner.base = target;
    events.push(
      pushEvent(state, {
        kind: 'steal',
        text: `${runner.name} steals ${target === 2 ? 'second' : 'third'}! (${rTotal} vs ${cTotal})`,
        rolls,
        refs: { playerId: runner.id, base: target, side: offense.side },
      }),
    );
    return events;
  }

  runner.base = null;
  events.push(
    pushEvent(state, {
      kind: 'steal',
      text: `${catcher?.name ?? 'The catcher'} guns him down — ${runner.name} caught stealing (${rTotal} vs ${cTotal}).`,
      rolls,
      refs: { playerId: runner.id, base: target, side: offense.side },
    }),
  );
  recordOut(state, events, `${runner.name} is out at ${target === 2 ? 'second' : 'third'}.`, runner.id, offense.side);
  if (state.outs >= 3) endHalfInning(state, events, false);
  return events;
}
