import type { Position } from '@cardball/shared';

/** One Lahman `Batting.csv` row (a single team stint). */
export interface BattingStint {
  playerId: string;
  year: number;
  stint: number;
  teamId: string;
  games: number;
  ab: number;
  h: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  rbi: number;
  sb: number;
  bb: number;
  hbp: number;
  sh: number;
  sf: number;
}

/** One Lahman `Pitching.csv` row (a single team stint). */
export interface PitchingStint {
  playerId: string;
  year: number;
  stint: number;
  teamId: string;
  games: number;
  ipOuts: number;
  er: number;
  bf: number;
}

/** One Lahman `Fielding.csv` (or `FieldingOFsplit.csv`) row. */
export interface FieldingStint {
  playerId: string;
  year: number;
  stint: number;
  teamId: string;
  position: string;
  games: number;
  innOuts: number;
  po: number;
  assists: number;
  errors: number;
  /** stolen bases allowed (catchers) */
  sb: number;
  /** runners caught stealing (catchers) */
  cs: number;
}

export interface FieldingTotals {
  games: number;
  innOuts: number;
  po: number;
  assists: number;
  errors: number;
  sb: number;
  cs: number;
}

/** A player from `People.csv`. */
export interface PersonSeed {
  /** Lahman `playerID` — the key all the stat files use. */
  playerId: string;
  bbrefId: string;
  nameFirst: string;
  nameLast: string;
  nameGiven: string | null;
  bats: string | null;
  throws: string | null;
  debutYear: number | null;
  finalYear: number | null;
  /** true when the pitcher threw 100+ innings in at least one MLB season */
  isStarter: boolean;
}

export interface PositionPlayed {
  position: Position;
  games: number;
  rating: number;
}

/** One merged (player, year) row ready for the `seasons` table. */
export interface SeasonSeed {
  bbrefId: string;
  year: number;
  teamLabel: string;
  games: number;
  ab: number;
  h: number;
  avg: number | null;
  doubles: number;
  triples: number;
  homeRuns: number;
  rbi: number;
  sb: number;
  pa: number;
  pitchGames: number;
  pitchIpOuts: number;
  pitchEra: number | null;
  pitchBf: number;
  primaryPosition: Position | null;
  positionsPlayed: PositionPlayed[];
}

export interface ParsedDataset {
  people: PersonSeed[];
  seasons: SeasonSeed[];
}
