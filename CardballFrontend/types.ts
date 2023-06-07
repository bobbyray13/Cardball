// types.ts
import { ReactNode } from 'react';
import { StackNavigationProp } from '@react-navigation/stack';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

export type RootStackParamList = {
  Home: undefined;
  Draft: undefined;
  TeamSelect: undefined;
  PostDraft: undefined;
  LineupSelect: undefined;
  LineupSelectHome: undefined;
  PlayBall: undefined;
  GameplayScreen: undefined;
  TempGameplay: undefined;
};

export type HomeComponentProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Home'>;
}

export type DraftScreenNavigationProp = StackNavigationProp<
  RootStackParamList,
  'Draft'
>;

export type TeamSelectScreenNavigationProp = StackNavigationProp<
  RootStackParamList,
  'TeamSelect'
>;

export type LineupSelectScreenNavigationProp = StackNavigationProp<
  RootStackParamList,
  'LineupSelect'
>;
export type LineupSelectHomeScreenNavigationProp = StackNavigationProp<
  RootStackParamList,
  'LineupSelectHome'
>;

export enum PlayerType {
  Batter = "Batter",
  Pitcher = "Pitcher"
}

export interface Player {
  name: string;
  position: PlayerPosition;
  bat_skill: number;
  pow_skill: number;
  pit_skill: number;
  fld_skill: number;
  run_skill: number;
  playerType: PlayerType;
  id: number;
  year: number;
  role: PlayerRole;
}
  
export interface Team {
  id: number;  // Unique identifier for the team
  name: string;  // Name of the team
  score: number;  // Team's current score
  role: TeamRole;  // Role of the team (either onOffense or onDefense)
  players: Player[];
  lineup: number[];  // Ordered list of players in batting lineup
  fieldPositions: Record<string, string>; // Array of fieldPositions (1B, SS, RF, etc.) and the player id who is playing there
  batters: Player[]; // List of players in the team who are Batters
  pitchers: Player[]; // List of players in the team who are Pitchers
  bench: Player[];  // List of players in the team's bench
}

export interface LineupData {
  lineup: number[];
  fieldPositions: Record<string, string>; // Array of fieldPositions (1B, SS, RF, etc.) and the player id who is playing there
}
  
export interface Game {
    id?: number;
    homeTeam: Team;
    awayTeam: Team;
    home_team_score?: number;
    away_team_score?: number;
    currentInning: number;
    currentHalf: 'top' | 'bottom';
    currentOuts: number;
    bases:  Base[];
    maxInnings: number;
    isInProgress: boolean;
    isTie: boolean;
    draftPlayers: () => Promise<void>;
  }
  
  interface AtBat {
    batter: Player;
    pitcher: Player;
    result?: AtBatResult;
    roll: 'pitch' | 'swing';
  }

  interface GameContextProps {
    game: Game | null;
    setGame: (game: Game | null) => void;
    substitutePlayer: (team: Team, playerOut: Player, playerIn: Player, playerType: PlayerType) => Promise<void>;
    gameId: number | null;
    setGameId: (id: number | null) => void;
    endHalfInningAndUpdateState: (gameId: number) => Promise<void>;
    handleNextPitch: () => Promise<void>;
  }

export interface GameProviderProps {
  children: ReactNode;
}
  
  interface Base {
    baseNumber: number; // 1, 2, or 3
    isOccupied: boolean;
    player?: Player; // the player currently on this base, if any
  }
  
  interface Skills {
    bat_skill: number; 
    pit_skill: number; 
    pow_skill: number; 
    run_skill: number; 
    fld_skill: number; 
  }

export { GameContextProps }

  // Define the roles for each player
export type PlayerRole = 'upToBat' | 'upToPitch' | 'upToSteal' | 'upToDefend' | 'onBase' | 'onBench';
  
  // Define the positions a player can play
export type PlayerPosition = 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF' | 'DH' | 'P' | 'BN';
  
  // Define the outcomes of an at-bat
export type AtBatResult = 'hit' | 'strikeout' | 'foul ball' | 'walk';
  
  // Define the outcomes of a game
export type GameResult = 'win' | 'loss' | 'tie';
  
  // Define the roles for a team
export type TeamRole = 'onOffense' | 'onDefense';
  //END OF types.ts