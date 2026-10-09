/**
 * Wire types shared by the server and the web client.
 *
 * These describe what the REST API actually returns, so the client never has
 * to guess and the server cannot drift from it. Types that depend on the rules
 * engine are generic over the engine's state type, which keeps this module free
 * of any engine import.
 */
import type { MatchRules } from './match.js';
import type { DrawnCard, PackShape, PackSource, PackThemeId } from './packs.js';
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
  /** the art to show: this copy's own photo, else the shared art for this player + year */
  photoId: number | null;
  /** the photo this manager attached to this copy, if any */
  ownPhotoId: number | null;
  notes: string | null;
  addedAt: string;
  card: CardSnapshot;
}

/** A pack on a manager's shelf: sealed, or torn open with its cards filed. */
export interface PackView {
  id: number;
  themeId: PackThemeId;
  shape: PackShape;
  /** how many cards it holds */
  size: number;
  source: PackSource;
  /** where it came from, e.g. "Beat the Bot Nine" */
  label: string | null;
  /** what earned it, e.g. "game:12#0"; ties a pack back to the game that dealt it */
  rewardKey: string | null;
  /** the card years the deal draws from */
  era: { from: number; to: number };
  createdAt: string;
  /** null while it is still sealed */
  openedAt: string | null;
  /** what it dealt, once opened */
  drawn: DrawnCard[] | null;
}

/** The one-time starter packs a manager can still claim. */
export interface StarterPackOffer {
  /** false once the account has its starter packs, however it got them */
  claimable: boolean;
  /** how many packs arrive when claimed */
  packs: number;
}

/** Everything on a manager's pack shelf, plus the starter claim. */
export interface PackShelfView {
  packs: PackView[];
  starter: StarterPackOffer;
}

// ---------------------------------------------------------------------------
// Historic team collections
// ---------------------------------------------------------------------------

/** One lineup slot of a historic team, and the card that fills it. */
export interface ChallengePlayerView {
  bbrefId: string;
  name: string;
  position: string;
  /** true when the manager owns a card covering the season */
  have: boolean;
  /** the owned card that fills the slot, when there is one */
  cardYear: number | null;
  /** the collection entry filling the slot, when there is one */
  userCardId: number | null;
}

/** A historic team collection, with this manager's progress through its lineup. */
export interface ChallengeView {
  id: string;
  year: number;
  name: string;
  franchise: string;
  tagline: string;
  players: ChallengePlayerView[];
  owned: number;
  total: number;
  /** every slot filled by an owned card */
  complete: boolean;
  /** the reward packs have been claimed */
  rewardClaimed: boolean;
  /** packs waiting once the collection completes */
  rewardPacks: number;
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
  /** a tournament team: starters may field positions their cards don't list */
  outOfPosition: boolean;
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

/** One stock team offered as a Vs. Bot opponent. */
export interface StockTeamSummary {
  id: string;
  name: string;
  year: number;
  tagline: string;
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
  /** the manager has opened their binder to the league: profile, collection, teams, and finished games */
  publicProfile: boolean;
}

export interface InviteSummary {
  code: string;
  createdAt: string;
  expiresAt: string | null;
  usedBy: string | null;
}

/** One finished game on a manager's public card. */
export interface PublicGameResult {
  id: number;
  mode: GameMode;
  /** when the final out was recorded */
  finishedAt: string;
  home: { name: string; score: number };
  away: { name: string; score: number };
  winner: 'home' | 'away' | null;
  /** whether the manager this card belongs to was on the winning side */
  won: boolean | null;
}

/** A manager's public card: collection, teams, and finished games, for whoever has opted in. */
export interface PublicProfileView {
  user: { id: number; displayName: string; joinedAt: string };
  /** false while the manager keeps the binder closed: only the header shows */
  open: boolean;
  collection: CollectionCard[] | null;
  teams: TeamSummary[] | null;
  games: PublicGameResult[] | null;
}

/** A game room, generic over the engine's state type. */
export interface GameView<S = unknown> {
  id: number;
  mode: GameMode;
  status: GameStatus;
  regulationInnings: number;
  /** what cards this match allows, so the room can print the terms */
  match: MatchRules;
  /** optimistic-concurrency counter, bumped on every applied action */
  version: number;
  hostUserId: number;
  guestUserId: number | null;
  discordUrl: string | null;
  /** the host set a password: anyone but the managers gives it to watch or join */
  locked: boolean;
  /** sides whose manager has pressed play */
  ready: ('home' | 'away')[];
  /** engine player id → photo id, so real card art shows up in games */
  photos: Record<string, number>;
  /** the draft whose sandbox this game belongs to, or null for an ordinary game */
  draftId: number | null;
  state: S | null;
  updatedAt: string;
}

/** One row of the games lobby list. */
export interface GameListItem {
  id: number;
  mode: GameMode;
  status: GameStatus;
  regulationInnings: number;
  /** what cards this match allows, so a joiner knows before they sit down */
  match: MatchRules;
  updatedAt: string;
  hostName: string;
  guestName: string | null;
  isMine: boolean;
  /** watching or joining takes a password */
  locked: boolean;
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
export type DraftRarity = 'common' | 'uncommon' | 'rare' | 'star' | 'mythic';

export interface DraftConfig {
  /** how many packs each manager opens */
  rounds: number;
  /** cards in each pack */
  packSize: number;
  /** the card year the pool is built from; the top of the era range */
  cardYear: number;
  /** era cutoff: the pool is drawn from cards built on years in this range */
  yearFrom: number;
  yearTo: number;
  /** only deal cards that can actually play a game */
  playableOnly: boolean;
  /** the themed packs in the rotation; empty means a mixed pack every round */
  themes: PackThemeId[];
  /** most rare, star, and mythic cards one manager may take all draft, or null for no limit */
  rarityCaps: { rare: number; star: number; mythic: number } | null;
  /** regulation innings the series' games are played to */
  regulationInnings: number;
}

/** Draft room limits, shared so the client and server agree on them. */
export const DRAFT_LIMITS = {
  minSeats: 2,
  maxSeats: 8,
  maxRounds: 10,
  minPackSize: 3,
  maxPackSize: 15,
  minYear: 1872,
  maxYear: 2100,
  maxRare: 20,
  maxStar: 20,
  maxMythic: 20,
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
  /** where the card can field, empty when it can't bat (missing on old drafts) */
  positions?: Position[];
  /** a starting pitcher (missing on old drafts) */
  starter?: boolean;
  /** a relief pitcher (missing on old drafts) */
  reliever?: boolean;
}

export interface DraftParticipant {
  userId: number;
  name: string;
  seat: number;
  isHost: boolean;
}

export type DraftPhase = 'lobby' | 'active' | 'assembling' | 'playing' | 'finished';

/** One game of a draft's series, decided by seat. */
export interface DraftGameResult {
  gameId: number;
  /** which seats played, and which side each was */
  homeSeat: number;
  awaySeat: number;
  homeScore: number;
  awayScore: number;
  /** null until the game is decided */
  winnerSeat: number | null;
}

/** Every seat's picks as the draft unfolds, so the table sees each team emerge. */
export interface DraftSeatPicks {
  seat: number;
  userId: number;
  name: string;
  isHost: boolean;
  picks: DraftCard[];
  /** true once this seat has locked in a lineup for the series */
  lineupReady: boolean;
}

/** The draft room, generic-free: the server owns the whole shape. */
export interface DraftView {
  id: number;
  phase: DraftPhase;
  config: DraftConfig;
  hostUserId: number;
  participants: DraftParticipant[];
  /** round currently being opened, 1-based */
  round: number;
  /** seats that still have to take a card before the packs pass; everyone picks at once */
  waitingOn: number[];
  /** packs pass to the next seat up in odd rounds and back down in even ones */
  passDirection: 'left' | 'right';
  /** the pack in front of the viewer; empty once the round's packs run out */
  myPack: DraftCard[];
  /** the wrapper the viewer is holding, or null when they hold no pack */
  myPackTheme: PackThemeId | null;
  /** false while the viewer's pack is still sealed */
  myPackOpened: boolean;
  /** true once the viewer has taken this pass's card and is waiting for the others */
  iHavePicked: boolean;
  /** every card the viewer has taken */
  myPicks: DraftCard[];
  /** rare, star, and mythic cards the viewer has taken, against the draft's caps */
  myTally: { rare: number; star: number; mythic: number };
  /** how many picks each seat has made */
  pickCounts: Record<string, number>;
  /** every seat's picks, positions included, so both teams are visible as they emerge */
  seats: DraftSeatPicks[];
  /** the lineup the viewer has locked in (draft card ids), during and after assembly */
  myLineup: SavedLineup | null;
  /** the series' current game, once every seat is assembled */
  gameId: number | null;
  /** the series so far, newest first */
  games: DraftGameResult[];
  /**
   * Games this viewer's seat has won, keyed by game id: the card they kept,
   * or null while the keep is still pending. Empty when the viewer won nothing.
   */
  myKeeps: Record<string, string | null>;
  /** the finished game whose winner's pack choice is still pending, if any */
  myPendingChoice: number | null;
  /** newest-last draft log */
  log: { seq: number; text: string }[];
  /** the tournament this room drafts for, if any: picks become its roster */
  tournamentId: number | null;
  updatedAt: string;
}

/** One drafted card with its full stats, for the team-assembly screen. */
export interface DraftTeamCard {
  card: DraftCard;
  snapshot: CardSnapshot;
}

/** The assembly screen's answer: this seat's cards and a suggested lineup. */
export interface DraftTeamView {
  cards: DraftTeamCard[];
  suggested: SavedLineup | null;
  lineup: SavedLineup | null;
}

export interface DraftListItem {
  id: number;
  phase: DraftPhase;
  cardYear: number;
  yearFrom: number;
  yearTo: number;
  rounds: number;
  packSize: number;
  themes: PackThemeId[];
  hostName: string;
  seats: number;
  seatsFilled: number;
  isMine: boolean;
  updatedAt: string;
}
