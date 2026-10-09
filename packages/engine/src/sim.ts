/**
 * Playing a game out without two managers at the keyboard.
 *
 * Tournaments and tests both need a whole nine innings decided in one call.
 * `autoPlay` asks the bot policy for whichever side is on the clock — the
 * pitcher's choice of pitch, the manager's decision on a double-play attempt —
 * and applies it, whoever manages that team.
 */

import { applyAction, waitingOn } from './apply.js';
import { botAction, botOffClockAction } from './bot.js';
import { getTeam } from './queries.js';
import type { Rng } from './rng.js';
import { SIDES } from './types.js';
import type { Actor, GameEvent, GameState, Side } from './types.js';

/** An actor that may speak for this side, bot or not. */
function actorFor(state: GameState, side: Side): Actor {
  return { userId: getTeam(state, side).userId, isBot: true };
}

/** Guards against a policy that never ends the game. */
const MAX_SIM_ACTIONS = 2000;

export function autoPlay(state: GameState, rng: Rng, maxActions = MAX_SIM_ACTIONS): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  let next = state;

  // A scheduled match starts on its own: play ball.
  if (next.phase === 'lobby') {
    const result = applyAction(next, { type: 'start-game' }, actorFor(next, 'home'), rng);
    next = result.state;
    events.push(...result.events);
  }

  for (let i = 0; i < maxActions; i++) {
    if (next.phase === 'finished') break;

    // Off the clock: a driven manager can still visit the bullpen between
    // pitches, whichever side the game is waiting on.
    let offClock = false;
    for (const side of SIDES) {
      const action = botOffClockAction(next, side);
      if (!action) continue;
      const result = applyAction(next, action, actorFor(next, side), rng);
      next = result.state;
      events.push(...result.events);
      offClock = true;
      break;
    }
    if (offClock) continue;

    const waiting = waitingOn(next);
    if (!waiting) break;
    const action = botAction(next, waiting.side);
    if (!action) break;
    const result = applyAction(next, action, actorFor(next, waiting.side), rng);
    next = result.state;
    events.push(...result.events);
  }
  return { state: next, events };
}
