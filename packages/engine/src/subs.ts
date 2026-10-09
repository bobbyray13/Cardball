import type { Position } from '@cardball/shared';
import { battingLine, pitchingLine } from './box.js';
import { pushEvent } from './events.js';
import { GameError } from './errors.js';
import { openPlateAppearance } from './flow.js';
import {
  canEnterAsPitcher,
  formatIp,
  getDefense,
  getPlayerTeam,
  roleForEnteringPitcher,
} from './queries.js';
import type { GameEvent, GameState, Side } from './types.js';

/** Between plate appearances (or before the first pitch of one), nothing in flight. */
function betweenPitches(state: GameState): boolean {
  return state.phase === 'live' && !state.pendingPlay && (!state.currentPa || state.currentPa.balls === 0);
}

/**
 * May substitutions happen right now? Managers can move players — pinch
 * hitters, pinch runners, defensive swaps, and pitching changes — any time
 * between pitches. False once a play is in flight or another decision is
 * pending.
 */
export function canSubstituteNow(state: GameState): boolean {
  if (state.phase !== 'live') return false;
  if (state.pendingDecision && state.pendingDecision.kind !== 'pinch-runner' && state.pendingDecision.kind !== 'lineup-fill') return false;
  return betweenPitches(state);
}

/** Which side owns the substitution decision (for permission checks). */
export function substituteSide(state: GameState, outPlayerId: string): Side {
  return getPlayerTeam(state, outPlayerId).side;
}

export function applySubstitute(
  state: GameState,
  outPlayerId: string,
  inPlayerId: string,
  fieldPosition: Position | undefined,
): GameEvent[] {
  if (state.phase !== 'live') throw new GameError('Substitutions happen during the game');
  const team = getPlayerTeam(state, outPlayerId);
  const outgoing = team.players.find((p) => p.id === outPlayerId)!;
  const incoming = team.players.find((p) => p.id === inPlayerId);
  if (!incoming) throw new GameError('The incoming player is not on this team');
  if (incoming.status !== 'bench') throw new GameError(`${incoming.name} is not available on the bench`);
  if (incoming.positions.length === 0) throw new GameError(`${incoming.name} can't play the field or bat`);

  const pending = state.pendingDecision;
  let kind: 'pinch-runner' | 'lineup-fill' | 'pinch-hitter' | 'defensive';

  if (pending && (pending.kind === 'pinch-runner' || pending.kind === 'lineup-fill')) {
    if (pending.playerId !== outPlayerId) throw new GameError('Resolve the pending substitution first');
    kind = pending.kind;
  } else if (pending) {
    throw new GameError('A decision is pending');
  } else {
    if (!betweenPitches(state)) throw new GameError('Substitutions happen between plate appearances');
    if (outgoing.status !== 'active') throw new GameError(`${outgoing.name} is not in the game`);
    if (outgoing.lineupSpot === null) throw new GameError('Use a pitching change to replace the pitcher');
    if (state.currentPa?.batterId === outgoing.id) kind = 'pinch-hitter';
    else if (outgoing.base !== null) kind = 'pinch-runner';
    else kind = 'defensive';
  }

  const spot = outgoing.lineupSpot;
  if (spot === null) throw new GameError(`${outgoing.name} has no lineup spot to fill`);

  const targetPosition = fieldPosition ?? outgoing.fieldPosition;
  if (targetPosition === 'P') throw new GameError('Use a pitching change to put someone on the mound');

  // Swap positions with whoever already plays the requested one.
  if (targetPosition && targetPosition !== outgoing.fieldPosition) {
    const holder = team.players.find((p) => p.status === 'active' && p.fieldPosition === targetPosition);
    if (holder) holder.fieldPosition = outgoing.fieldPosition;
  }

  incoming.status = 'active';
  incoming.lineupSpot = spot;
  incoming.fieldPosition = targetPosition;
  incoming.base = outgoing.base;
  // A pinch-runner inherits whoever is on the hook for the runner.
  incoming.chargedTo = outgoing.chargedTo ?? null;
  team.lineup[spot] = incoming.id;
  battingLine(state, team.side, incoming);

  outgoing.status = 'out';
  outgoing.base = null;
  outgoing.lineupSpot = null;
  outgoing.fieldPosition = null;

  if (state.currentPa?.batterId === outgoing.id) state.currentPa.batterId = incoming.id;

  const label = {
    'pinch-runner': 'pinch-runs for',
    'lineup-fill': 'replaces',
    'pinch-hitter': 'pinch-hits for',
    defensive: 'replaces',
  }[kind];
  const events: GameEvent[] = [
    pushEvent(state, {
      kind: 'sub',
      text: `${team.name}: ${incoming.name} ${label} ${outgoing.name}${targetPosition ? ` (${targetPosition})` : ''}.`,
      refs: { playerIds: [incoming.id, outgoing.id], side: team.side, ...(targetPosition ? { position: targetPosition } : {}) },
    }),
  ];
  if (targetPosition && targetPosition !== 'DH' && !incoming.positions.includes(targetPosition)) {
    events.push(
      pushEvent(state, {
        kind: 'info',
        text: `${incoming.name} is playing out of position at ${targetPosition} (fielding −3).`,
        refs: { playerId: incoming.id, side: team.side },
      }),
    );
  }

  if (pending) {
    state.pendingDecision = null;
    openPlateAppearance(state, events);
  }
  return events;
}

export function applyPitcherChange(state: GameState, inPlayerId: string): GameEvent[] {
  if (state.phase !== 'live') throw new GameError('Pitching changes happen during the game');
  const defense = getDefense(state);
  const pending = state.pendingDecision;
  if (pending && pending.kind !== 'pitcher-change') throw new GameError('A decision is pending');
  if (!pending && !betweenPitches(state)) throw new GameError('Pitching changes happen between plate appearances');

  const incoming = defense.players.find((p) => p.id === inPlayerId);
  if (!incoming) throw new GameError('That pitcher is not on the fielding team');
  const legal = canEnterAsPitcher(state, incoming);
  if (!legal.ok) throw new GameError(`${incoming.name} ${legal.reason}`);

  const outgoing = defense.players.find((p) => p.id === defense.activePitcherId);
  if (outgoing) {
    outgoing.status = 'out';
  }

  incoming.status = 'active';
  incoming.pitchingRole = roleForEnteringPitcher(state);
  incoming.outsPitched = 0;
  defense.activePitcherId = incoming.id;
  if (state.currentPa) state.currentPa.pitcherId = incoming.id;
  pitchingLine(state, defense.side, incoming.id);

  const events: GameEvent[] = [
    pushEvent(state, {
      kind: 'pitcher-change',
      text: outgoing
        ? `${defense.name} go to the bullpen: ${incoming.name} (${incoming.pitchingRole}) replaces ${outgoing.name} after ${formatIp(outgoing.outsPitched)} IP.`
        : `${incoming.name} takes the mound for ${defense.name}.`,
      refs: { playerIds: outgoing ? [incoming.id, outgoing.id] : [incoming.id], side: defense.side, position: 'P' },
    }),
  ];

  if (pending) {
    state.pendingDecision = null;
    openPlateAppearance(state, events);
  }
  return events;
}
