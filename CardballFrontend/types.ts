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
  PlayBall: undefined;
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
  benchPlayers: Player[];  // List of players in the team's bench
  score: number;  // Team's current score
  role: TeamRole;  // Role of the team (either on offense or on defense)
  players: Player[];
  lineup: Player[];  // Ordered list of players in batting lineup
  batters: Player[]; // List of players in the team who are Batters
  pitchers: Player[]; // List of players in the team who are Pitchers
}
  
export interface Inning {
  number: number;
  homeTeamScore: number;
  awayTeamScore: number;
  outs: number;
  half: 'top' | 'bottom';
}
  
export interface Game {
    id?: number;
    homeTeam: Team;
    awayTeam: Team;
    currentInning: Inning;
    currentInningDetails: Inning;
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

export interface GameContextProps {
    game: Game | null;
    setGame: React.Dispatch<React.SetStateAction<Game | null>>;
    substitutePlayer: (team: Team, playerOut: Player, playerIn: Player, playerType: PlayerType) => Promise<void>;
  }

export interface GameProviderProps {
  children: ReactNode;
}
  
  interface Base {
    baseNumber: number; // 1, 2, 3, or 4 (representing home)
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