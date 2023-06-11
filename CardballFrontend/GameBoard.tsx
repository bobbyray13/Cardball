// GameBoard.tsx
import React from 'react';
import { Game } from './types';
import { View, Text } from 'react-native';

interface GameBoardProps {
  game: Game | null;
}

const GameBoard: React.FC<GameBoardProps> = ({ game }) => {
  if (!game) {
    return <Text>Loading...</Text>;
  }

  return (
    <View>
      <Text>Home Team: {game.homeTeam?.name} Score: {game.home_team_score}</Text>
      <Text>Away Team: {game.awayTeam?.name} Score: {game.away_team_score}</Text>
      <Text>Inning: {game.currentInning} Half: {game.currentHalf}</Text>
      <Text>Outs: {game.currentOuts}</Text>
      {game.bases && <Text>Bases: {game.bases.map((base, index) => base.isOccupied ? `Base ${index + 1}: Occupied` : `Base ${index + 1}: Empty`).join(', ')}</Text>}
    </View>
  );
};

export default GameBoard;
// END OF GameBoard.tsx
