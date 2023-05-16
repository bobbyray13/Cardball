// types.ts
import { ReactNode } from 'react';
import { StackNavigationProp } from '@react-navigation/stack';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

export type RootStackParamList = {
  Home: undefined;
  Draft: undefined;
};

export type HomeComponentProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Home'>;
}

export type DraftScreenNavigationProp = StackNavigationProp<
  RootStackParamList,
  'Draft'
>;

export interface Player {
    id: number;
    name: string;
    position: PlayerPosition;
    role: PlayerRole;
    skills: Skills;
  }
  
export interface Team {
  id: number;  // Unique identifier for the team
  name: string;  // Name of the team
  players: Player[];  // List of players in the team
  benchPlayers: Player[];  // List of players in the team's bench
  score: number;  // Team's current score
  role: TeamRole;  // Role of the team (either on offense or on defense)
  lineup: Player[];  // Ordered list of players in batting lineup
}
  
export interface Inning {
  number: number;
  homeTeamScore: number;
  awayTeamScore: number;
  outs: number;  // New field to represent number of outs
  half: 'top' | 'bottom';  // New field to represent top or bottom of inning
}
  
export interface Game {
    id?: number;
    homeTeam: Team;
    awayTeam: Team;
    currentInning: Inning;
    currentInningDetails: Inning;
    maxInnings: number;
    isInProgress: boolean;
    isTie: boolean;  // New field to represent tie condition
    draftPlayers: () => Promise<void>;  // New method for player draft
  }
  
  interface AtBat {
    batter: Player;
    pitcher: Player;
    result?: AtBatResult;
    roll: 'pitch' | 'swing';  // New field to represent player rolls
  }

export interface GameContextProps {
    game: Game | null;
    setGame: React.Dispatch<React.SetStateAction<Game | null>>;
    initializeGame: (homeTeamName: string, awayTeamName: string) => Promise<void>;
    playInningHalf: (onOffense: Team, onDefense: Team) => Promise<void>;
    substitutePlayer: (team: Team, playerOut: Player, playerIn: Player) => Promise<void>;
    endHalfInning: () => Promise<void>;
    incrementOuts: () => void;
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