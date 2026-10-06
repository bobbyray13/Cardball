import type { GameEvent, GameEventKind, GameState, RollDetail } from './types.js';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export interface EventDraft {
  kind: GameEventKind;
  text: string;
  rolls?: RollDetail[];
  refs?: Mutable<GameEvent>['refs'];
}

/** Assigns the next sequence number and stamps inning/half. Mutates state.lastEventSeq. */
export function pushEvent(state: GameState, draft: EventDraft): GameEvent {
  state.lastEventSeq += 1;
  const event: GameEvent = {
    seq: state.lastEventSeq,
    inning: state.inning,
    half: state.half,
    kind: draft.kind,
    text: draft.text,
    ...(draft.rolls !== undefined ? { rolls: draft.rolls } : {}),
    ...(draft.refs !== undefined ? { refs: draft.refs } : {}),
  };
  return event;
}

/** Build a roll detail with its modifier math shown. */
export function roll(
  label: string,
  sides: 6 | 20,
  value: number,
  modifier: number,
  modifierNote?: string,
): RollDetail {
  return { label, sides, value, modifier, modifierNote, total: value + modifier };
}
