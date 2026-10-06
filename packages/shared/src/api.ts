/**
 * Wire types shared by the server and the web client.
 *
 * These describe what the REST API actually returns, so the client never has
 * to guess and the server cannot drift from it. Types that depend on the rules
 * engine are generic over the engine's state type, which keeps this module free
 * of any engine import.
 */
import type { Position } from './positions.js';
import type { SeasonStats } from './stats.js';

export type GameMode = 'remote' | 'hotseat' | 'bot';
export type GameStatus = 'open' | 'lobby' | 'live' | 'finished';

/** A team's saved default lineup, keyed by team-card id (as strings). */
export interface SavedLineup {
  lineup: string[];
  fieldPositions: Partial<Record<Position, string>>;
  startingPitcherId: string;
}

/** Everything the UI and engine need about one card (player + card year). */
export interface CardSnapshot {
  personId: number;
  bbrefId: string;
  name: string;
  cardYear: number;
  /** franchise on the most recent season of the card back */
  teamLabel: string;
  bats: string | null;
  throws: string | null;
  /** seasons on the back of the card, oldest first */
  seasons: SeasonStats[];
  /** eligible field positions, plus DH for anyone who can hit */
  positions: Position[];
  fielding: Partial<Record<Position, number>>;
  pitcherClass: 'SP' | 'RP' | null;
  canBat: boolean;
  canPitch: boolean;
  /** usable in a game at all */
  playable: boolean;
  /** why not, when it isn't */
  ineligibleReason: string | null;
}

/** One entry in a user's collection. */
export interface CollectionCard {
  /** user_cards.id */
  id: number;
  cardModelId: number;
  setLabel: string;
  rarity: string | null;
  quantity: number;
  photoId: number | null;
  notes: string | null;
  addedAt: string;
  card: CardSnapshot;
}

/** A card on a team, tagged with its roster slot. */
export interface RosterEntryView extends CollectionCard {
  /** team_cards.id — the id used in saved lineups */
  teamCardId: number;
}

export interface TeamSummary {
  id: number;
  name: string;
  primaryColor: string | null;
  size: number;
  hasLineup: boolean;
}

export interface TeamView {
  id: number;
  name: string;
  primaryColor: string | null;
  lineup: SavedLineup | null;
  /** why the saved lineup is not legal, or null when it is */
  lineupProblem: string | null;
  roster: RosterEntryView[];
}

export interface PersonSummary {
  id: number;
  nameFirst: string;
  nameLast: string;
  debutYear: number | null;
  finalYear: number | null;
  isStarter: boolean;
  primaryPosition: Position | null;
}

export interface PersonDetail extends PersonSummary {
  bbrefId: string;
  nameGiven: string | null;
  bats: string | null;
  throws: string | null;
  seasons: SeasonStats[];
  cardYears: { min: number; max: number } | null;
}

export interface ChatMessage {
  id: number;
  userId: number | null;
  name: string;
  body: string;
  createdAt: string;
}

export interface SessionUser {
  id: number;
  email: string;
  displayName: string;
  isAdmin: boolean;
}

export interface InviteSummary {
  code: string;
  createdAt: string;
  expiresAt: string | null;
  usedBy: string | null;
}

/** A game room, generic over the engine's state type. */
export interface GameView<S = unknown> {
  id: number;
  mode: GameMode;
  status: GameStatus;
  regulationInnings: number;
  /** optimistic-concurrency counter, bumped on every applied action */
  version: number;
  hostUserId: number;
  guestUserId: number | null;
  discordUrl: string | null;
  /** sides whose manager has pressed play */
  ready: ('home' | 'away')[];
  /** engine player id → photo id, so real card art shows up in games */
  photos: Record<string, number>;
  state: S | null;
  updatedAt: string;
}

/** One row of the games lobby list. */
export interface GameListItem {
  id: number;
  mode: GameMode;
  status: GameStatus;
  regulationInnings: number;
  updatedAt: string;
  hostName: string;
  guestName: string | null;
  isMine: boolean;
  home: { name: string; score: number } | null;
  away: { name: string; score: number } | null;
  inning: number | null;
  half: 'top' | 'bottom' | null;
  winner: 'home' | 'away' | null;
}

// ---------------------------------------------------------------------------
// Drafts — pass-the-pack card drafts
// ---------------------------------------------------------------------------

/** How good a drafted card looks, for the foil on the front. */
export type DraftRarity = 'common' | 'uncommon' | 'rare' | 'chase';

export interface DraftConfig {
  /** how many packs each manager opens */
  rounds: number;
  /** cards in each pack */
  packSize: number;
  /** the card year the pool is built from */
  cardYear: number;
  /** only deal cards that can actually play a game */
  playableOnly: boolean;
}

/** Draft room limits, shared so the client and server agree on them. */
export const DRAFT_LIMITS = {
  minSeats: 2,
  maxSeats: 8,
  maxRounds: 10,
  minPackSize: 3,
  maxPackSize: 15,
} as const;

/** A card sitting in a pack, or one a manager has taken. */
export interface DraftCard {
  /** stable within the draft */
  id: string;
  personId: number;
  cardYear: number;
  name: string;
  teamLabel: string;
  rarity: DraftRarity;
  /** one-line scouting note, e.g. "41 HR, .328 AVG" or "2.44 ERA" */
  headline: string;
  /** true when the card can bat or pitch in a game */
  playable: boolean;
}

export interface DraftParticipant {
  userId: number;
  name: string;
  seat: number;
  isHost: boolean;
}

export type DraftPhase = 'lobby' | 'active' | 'finished';

/** The draft room, generic-free: the server owns the whole shape. */
export interface DraftView {
  id: number;
  phase: DraftPhase;
  config: DraftConfig;
  hostUserId: number;
  participants: DraftParticipant[];
  /** round currently being opened, 1-based */
  round: number;
  /** seat index whose turn it is */
  turn: number;
  /** the pack the viewer is holding, empty when it is not their turn to hold one */
  myPack: DraftCard[];
  /** every card the viewer has taken */
  myPicks: DraftCard[];
  /** how many picks each seat has made */
  pickCounts: Record<string, number>;
  /** newest-last draft log */
  log: { seq: number; text: string }[];
  updatedAt: string;
}

export interface DraftListItem {
  id: number;
  phase: DraftPhase;
  cardYear: number;
  rounds: number;
  packSize: number;
  hostName: string;
  seats: number;
  seatsFilled: number;
  isMine: boolean;
  updatedAt: string;
}
