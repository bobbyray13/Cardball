import type { ContactType, GameMode, HitKind, Position, SeasonStats, ContactTypeInfo } from '@cardball/shared';

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

export type Side = 'home' | 'away';
export const SIDES: readonly Side[] = ['home', 'away'];

export function otherSide(side: Side): Side {
  return side === 'home' ? 'away' : 'home';
}

export type { GameMode };

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

/** A card as a game participant — a frozen snapshot of everything needed to play. */
export interface EnginePlayer {
  id: string;
  cardModelId: number;
  userCardId: number | null;
  name: string;
  cardYear: number;
  /** franchise label for card art, e.g. "Rays" */
  teamLabel: string;
  rarity: string | null;

  /** positions this card is eligible to field */
  positions: Position[];
  /** card stat window — seasons with any MLB appearance within the card years, ASC by year */
  seasons: SeasonStats[];
  /** fielding rating by position (-3..3), computed at import and overridable pre-game */
  fielding: Partial<Record<Position, number>>;

  /** career: SP (ever >100 IP in a season), RP (pitched but never that much), null (never pitched) */
  pitcherClass: 'SP' | 'RP' | null;

  // ---- mutable in-game state ----
  /** bench = available, active = in the game (lineup or mound), out = removed */
  status: 'bench' | 'active' | 'out';
  /** batting order spot (0-8) when status === 'lineup' */
  lineupSpot: number | null;
  /** the field position currently played (DH included; P handled via pitchingRole) */
  fieldPosition: Position | null;
  /** base occupied while on the bases */
  base: 1 | 2 | 3 | null;
  /** outs recorded on the mound this game */
  outsPitched: number;
  /** role assigned when this player took the mound */
  pitchingRole: 'starter' | 'reliever' | 'closer' | null;
  /** true when a rolled season injured this player — must exit at next opportunity */
  injured: boolean;
  /** injured pitcher who has finished his batter and must now come out */
  exitDue: boolean;
  /** pitch limits waived because no legal reliever was left in the bullpen */
  fatigueWaived: boolean;
}

// ---------------------------------------------------------------------------
// Teams & game state
// ---------------------------------------------------------------------------

export interface TeamState {
  side: Side;
  userId: number | null;
  isBot: boolean;
  name: string;
  players: EnginePlayer[];
  score: number;
  /** this team's d6 for the current inning's roll-for-year (null before roll) */
  yearRoll: number | null;
  /** index (0-8) of the next lineup spot due to bat */
  lineupCursor: number;
  /** batting order: player ids by spot; null = vacated (injured) spot */
  lineup: (string | null)[];
  /** player currently on the mound */
  activePitcherId: string | null;
}

export type Phase = 'lobby' | 'live' | 'finished';

/** A question the engine needs answered before play continues. */
export interface PendingDecision {
  kind: 'dp-attempt' | 'send-runner' | 'pinch-runner' | 'pitcher-change' | 'lineup-fill';
  side: Side;
  /** runner being sent / needing a pinch-runner */
  playerId?: string;
  /** human-readable context for the UI ("Rays lead runner Ichiro on 2nd — send him?") */
  prompt: string;
  /** extra data the UI may want (e.g. send target base, dp odds) */
  detail?: {
    targetBase?: number;
    throwerId?: string;
    runnerAdvantage?: number;
    dpFactors?: { diff: number; fielding: number; batterSb: number };
  };
}

/** The plate appearance in progress (survives pauses for decisions). */
export interface PlateAppearance {
  batterId: string;
  pitcherId: string;
  /** consecutive tie pitch-rolls this PA */
  balls: number;
}

/**
 * A partially-resolved play awaiting a decision. Everything needed to
 * continue resolution after the manager answers.
 */
export interface PlayContext {
  batterId: string;
  pitcherId: string;
  directionRoll: number;
  contactRoll: number;
  contact: ContactTypeInfo;
  /** null when nobody fields it (home run) */
  defenderId: string | null;
  defenseRoll: number | null;
  hitKind: HitKind | null;
  /** what happens next once the pending decision is resolved */
  stage: 'await-dp' | 'await-tag' | 'await-send' | 'finish';
  /** send/tag details */
  send?: {
    runnerId: string;
    fromBase: 1 | 2 | 3;
    toBase: number; // 2..4
    throwerId: string;
    advantage: number; // red/blue contact modifier
    context: 'hit' | 'tag-up';
  };
}

export interface GameConfig {
  mode: GameMode;
  regulationInnings: number;
}

export interface GameState {
  id: string;
  version: number;
  config: GameConfig;
  phase: Phase;
  home: TeamState;
  away: TeamState;
  inning: number;
  half: 'top' | 'bottom';
  outs: number;
  /** consecutive-tie ball count within the current PA (mirrors PlateAppearance) */
  currentPa: PlateAppearance | null;
  pendingDecision: PendingDecision | null;
  pendingPlay: PlayContext | null;
  /** true once the first pitch of the game has been thrown */
  firstPitchThrown: boolean;
  /** set when a half-inning ended; applyAction then rolls/opens the next half */
  needsHalfStart: boolean;
  /** last assigned event sequence number (for continuing seq across actions) */
  lastEventSeq: number;
  winner: Side | null;
  /** how the game ended (score, concede) */
  endedBy: 'score' | 'concede' | null;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type GameEventKind =
  | 'game-created'
  | 'side-roll'
  | 'lineup'
  | 'game-start'
  | 'inning-start'
  | 'year-roll'
  | 'injury'
  | 'steal'
  | 'pitch'
  | 'strikeout'
  | 'ball'
  | 'walk'
  | 'contact'
  | 'fielding'
  | 'out'
  | 'hit'
  | 'dp-made'
  | 'dp-failed'
  | 'send'
  | 'run'
  | 'sub'
  | 'pitcher-change'
  | 'half-end'
  | 'game-over'
  | 'concede'
  | 'info';

/** One die with its visible modifier math, for dice animations and the log. */
export interface RollDetail {
  label: string;
  sides: 6 | 20;
  value: number;
  modifier: number;
  modifierNote?: string;
  total: number;
}

export interface GameEvent {
  seq: number;
  inning: number;
  half: 'top' | 'bottom';
  kind: GameEventKind;
  /** play-by-play text, scorer's-book style */
  text: string;
  rolls?: RollDetail[];
  /** ids and values the UI animates against */
  refs?: {
    playerId?: string;
    playerIds?: string[];
    position?: Position | null;
    side?: Side;
    base?: number;
    contactRoll?: number;
    directionRoll?: number;
    hitKind?: HitKind;
    contactType?: ContactType;
    runCount?: number;
  };
}

// ---------------------------------------------------------------------------
// Setup (server → engine)
// ---------------------------------------------------------------------------

export interface PlayerSetup {
  id: string;
  cardModelId: number;
  userCardId: number | null;
  name: string;
  cardYear: number;
  teamLabel: string;
  rarity: string | null;
  positions: Position[];
  seasons: SeasonStats[];
  /** computed rating by position, with any manager overrides already merged in */
  fielding: Partial<Record<Position, number>>;
  pitcherClass: 'SP' | 'RP' | null;
}

export interface TeamSetup {
  userId: number | null;
  isBot?: boolean;
  name: string;
  players: PlayerSetup[];
  /** batting order, 9 player ids */
  lineup: string[];
  /** field positions: C/1B/2B/3B/SS/LF/CF/RF → player id (DH is implicit in the lineup) */
  fieldPositions: Partial<Record<Position, string>>;
  startingPitcherId: string;
}

export interface GameSetup {
  id: string;
  mode: GameMode;
  regulationInnings: number;
  /** two teams in join order — the engine rolls dice to see who is home */
  teams: [TeamSetup, TeamSetup];
}

/** Who is trying to act. userId null + bot teams → server-driven bot actions. */
export interface Actor {
  userId: number | null;
  isBot?: boolean;
}
