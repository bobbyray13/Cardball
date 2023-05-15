// types.ts

import { NativeStackNavigationProp } from '@react-navigation/native-stack';

export type RootStackParamList = {
  Home: undefined;
  Draft: undefined;
};

export type HomeComponentProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Home'>;
}

interface Player {
    id: number;
    name: string;
    position: PlayerPosition;
    role: PlayerRole;
    skills: Skills;
  }
  
export interface Team {
    id: number;
    name: string;
    players: Player[];
    benchPlayers: Player[];  // New field to represent bench players
    score: number;
    role: TeamRole;
    lineup: Player[]; // ordered list of players in batting lineup
  }
  
  interface Inning {
    number: number;
    team1Score: number;
    team2Score: number;
    outs: number;  // New field to represent number of outs
    half: 'top' | 'bottom';  // New field to represent top or bottom of inning
  }
  
  interface Game {
    id: number;
    team1: Team;
    team2: Team;
    currentInning: number;
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
  
  interface GameContextType {
    game: Game;
    inning: Inning;
    teams: Team[];
    players: Player[];
    atBat: AtBat;
    base: Base[];  // New field to represent bases
    initializeGame: () => Promise<void>;
    playInningHalf: (onOffense: Team, onDefense: Team) => Promise<void>;
    substitutePlayer: (team: Team, playerOut: Player, playerIn: Player) => Promise<void>;  // New method for player substitution
    endHalfInning: () => Promise<void>;  // New method for ending a half inning
    incrementOuts: () => void;  // New method for incrementing outs
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
  type PlayerRole = 'upToBat' | 'upToPitch' | 'upToSteal' | 'upToDefend' | 'onBase' | 'onBench';
  
  // Define the positions a player can play
  type PlayerPosition = 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF' | 'DH' | 'P' | 'BN';
  
  // Define the outcomes of an at-bat
  type AtBatResult = 'hit' | 'strikeout' | 'foul ball' | 'walk';
  
  // Define the outcomes of a game
  type GameResult = 'win' | 'loss' | 'tie';
  
  // Define the roles for a team
  type TeamRole = 'onOffense' | 'onDefense';
  