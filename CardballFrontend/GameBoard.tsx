// GameBoard.tsx
import React from 'react';
import { Game, Player, Team } from './types';
import { View, Text } from 'react-native';
import GameplayScreen from './screens/GameplayScreen';

interface GameBoardProps {
  game: Game | null;
}

const getCurrentBatter = (team: Team): Player | undefined => {
  return team.players.find(player => player.role === 'upToBat');
};

const getCurrentPitcher = (team: Team): Player | undefined => {
  return team.players.find(player => player.role === 'upToPitch');
};

const GameBoard: React.FC<GameBoardProps> = ({ game }) => {
  if (!game) {
    return <Text>Loading...</Text>;
  }

  const battingTeam = game.homeTeam.role === 'onOffense' ? game.homeTeam : game.awayTeam;
  const pitchingTeam = game.homeTeam.role === 'onOffense' ? game.awayTeam : game.homeTeam;

  const currentBatter = getCurrentBatter(battingTeam);
  const currentPitcher = getCurrentPitcher(pitchingTeam);

  return (
    <View>
      <Text>Home Team: {game.homeTeam?.name} Score: {game.homeTeamScore}</Text>
      <Text>Away Team: {game.awayTeam?.name} Score: {game.awayTeamScore}</Text>
      <Text>Inning: {game.currentInning} Half: {game.currentHalf}</Text>
      <Text>Outs: {game.outs}</Text>
      {game.bases && <Text>Bases: {game.bases.map((base, index) => base.isOccupied ? `Base ${index + 1}: Occupied` : `Base ${index + 1}: Empty`).join(', ')}</Text>}
      {currentBatter && <Text>Current Batter: {currentBatter.name}</Text>}
      {currentPitcher && <Text>Current Pitcher: {currentPitcher.name}</Text>}
    </View>
  );
};

export default GameBoard;
// END OF GameBoard.tsx
