import type { GameAction } from '@cardball/shared';
import { applySetFieldingOverride, applySetLineup, startGame } from './create.js';
import { GameError } from './errors.js';
import { finishGame, startHalfInning } from './flow.js';
import { applyDpDecision, applyRollBat, applySendDecision, applyThrowPitch } from './pitch.js';
import { getDefense, getOffense, getTeam } from './queries.js';
import type { Rng } from './rng.js';
import { applySteal } from './steal.js';
import { applyPitcherChange, applySubstitute, substituteSide } from './subs.js';
import type { Actor, GameEvent, GameState, Side } from './types.js';
import { otherSide } from './types.js';

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
}

export function controlsSide(state: GameState, side: Side, actor: Actor): boolean {
  const team = getTeam(state, side);
  if (team.isBot) return actor.isBot === true;
  return team.userId !== null && team.userId === actor.userId;
}

/** Sides this actor may act for (two in hotseat, none for spectators). */
export function sidesFor(state: GameState, actor: Actor): Side[] {
  return (['away', 'home'] as const).filter((s) => controlsSide(state, s, actor));
}

/** Which side must make this action, or null when either participant may. */
export function requiredSide(state: GameState, action: GameAction): Side | null {
  switch (action.type) {
    case 'set-lineup':
    case 'set-fielding-override':
      return action.side;
    case 'start-game':
      return null;
    case 'substitute':
      return state.pendingDecision?.kind === 'pinch-runner' || state.pendingDecision?.kind === 'lineup-fill'
        ? state.pendingDecision.side
        : substituteSide(state, action.outPlayerId);
    case 'pitcher-change':
    case 'dp-attempt':
      return getDefense(state).side;
    case 'attempt-steal':
    case 'send-runner':
    case 'roll-bat':
      return getOffense(state).side;
    case 'throw-pitch':
      // A paced game has the defense throw the pitcher's die; otherwise the
      // offense resolves the whole roll.
      return state.config.pacedPitch ? getDefense(state).side : getOffense(state).side;
    case 'concede':
      return action.side ?? null;
  }
}

/**
 * The single entry point: validate who is acting, apply the action to a
 * clone of the state, and return the new state plus the events it produced.
 * Throws GameError for illegal moves; the input state is never mutated.
 */
export function applyAction(input: GameState, action: GameAction, actor: Actor, rng: Rng): ApplyResult {
  const state = structuredClone(input);
  const mySides = sidesFor(state, actor);
  if (mySides.length === 0) throw new GameError('You are not managing a team in this game');

  const side = requiredSide(state, action);
  if (side !== null && !mySides.includes(side)) throw new GameError("It's not your call");

  if (state.phase === 'finished') throw new GameError('The game is over');

  const pending = state.pendingDecision;
  if (pending && action.type !== 'concede') {
    const resolves =
      (pending.kind === 'dp-attempt' && action.type === 'dp-attempt') ||
      (pending.kind === 'send-runner' && action.type === 'send-runner') ||
      (pending.kind === 'pitcher-change' && action.type === 'pitcher-change') ||
      (pending.kind === 'batter-roll' && action.type === 'roll-bat') ||
      ((pending.kind === 'pinch-runner' || pending.kind === 'lineup-fill') && action.type === 'substitute');
    if (!resolves) throw new GameError(`Waiting on a decision: ${pending.prompt}`);
  }

  let events: GameEvent[];
  switch (action.type) {
    case 'set-lineup':
      events = applySetLineup(state, action.side, action.lineup, action.fieldPositions, action.startingPitcherId);
      break;
    case 'set-fielding-override':
      events = applySetFieldingOverride(state, action.side, action.playerId, action.position, action.rating);
      break;
    case 'start-game':
      events = startGame(state, rng);
      break;
    case 'substitute':
      events = applySubstitute(state, action.outPlayerId, action.inPlayerId, action.fieldPosition);
      break;
    case 'pitcher-change':
      events = applyPitcherChange(state, action.inPlayerId);
      break;
    case 'attempt-steal':
      events = applySteal(state, action.runnerId, rng);
      break;
    case 'throw-pitch':
      events = applyThrowPitch(state, rng);
      break;
    case 'roll-bat':
      events = applyRollBat(state, rng);
      break;
    case 'dp-attempt':
      events = applyDpDecision(state, action.attempt, rng);
      break;
    case 'send-runner':
      events = applySendDecision(state, action.send, rng);
      break;
    case 'concede': {
      const loser = action.side ?? mySides[0]!;
      if (!mySides.includes(loser)) throw new GameError("You can't concede for the other team");
      events = [];
      finishGame(state, otherSide(loser), 'concede', events);
      break;
    }
  }

  // Half-innings that ended mid-action need dice to begin the next one.
  let guard = 0;
  while (state.phase === 'live' && state.needsHalfStart && guard++ < 50) {
    startHalfInning(state, events, rng);
  }

  state.version += 1;
  return { state, events };
}

/** Who the game is waiting on right now, for the UI and the bot driver. */
export function waitingOn(state: GameState): { side: Side; kind: string; prompt: string } | null {
  if (state.phase !== 'live') return null;
  if (state.pendingDecision) {
    return { side: state.pendingDecision.side, kind: state.pendingDecision.kind, prompt: state.pendingDecision.prompt };
  }
  if (state.currentPa) {
    const offense = getOffense(state);
    if (state.config.pacedPitch) {
      const defense = getDefense(state);
      return { side: defense.side, kind: 'throw-pitch', prompt: `${defense.name} to pitch — throw it in.` };
    }
    return { side: offense.side, kind: 'throw-pitch', prompt: `${offense.name} to bat — throw the pitch.` };
  }
  return null;
}
