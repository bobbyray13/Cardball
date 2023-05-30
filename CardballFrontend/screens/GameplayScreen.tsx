//GameplayScreen.tsx
import React, { useContext } from 'react';
import { Button, Text, View, StyleSheet } from 'react-native';
import { GameContext } from '../contexts/gameContext';
import { rollForNextPitch } from '../api/gamePlayAPI'

export const GameplayScreen: React.FC = () => {
  const gameContext = useContext(GameContext);

  if (!gameContext || !gameContext.game || !gameContext.game.currentHalf) {
    return <Text>Loading...</Text>;
  }
  const game = gameContext.game;
  const { gameId } = gameContext;
  const { homeTeam, awayTeam } = game;

  // Determine which team is on offense and which is on defense
  const offensiveTeam = homeTeam.role === 'onOffense' ? homeTeam : awayTeam;
  const defensiveTeam = homeTeam.role === 'onDefense' ? homeTeam : awayTeam;

  // Get the player in the lineup position 1 for the team on offense
  const offensivePlayerId = offensiveTeam.lineup[0];
  const offensivePlayer = offensiveTeam.players.find(player => player.id === offensivePlayerId);

  // Get the player in the 'P' field position for the team on defense
  const defensivePlayerId = Number(Object.keys(defensiveTeam.fieldPositions).find(id => defensiveTeam.fieldPositions[Number(id)] === 'P'));
  const defensivePlayer = defensiveTeam.players.find(player => player.id === Number(defensivePlayerId));

  // Extract player names, defaulting to 'Unknown' if not found
  const offensivePlayerName = offensivePlayer ? offensivePlayer.name : 'Unknown';
  const defensivePlayerName = defensivePlayer ? defensivePlayer.name : 'Unknown';

  // Mapping base number to base name
  const baseNames = ['1st Base', '2nd Base', '3rd Base'];

  // Bases text
  let basesText = '';
  if (game.bases) {
    basesText = game.bases.map(base => {
      const baseName = baseNames[base.baseNumber - 1];
      const playerName = base.player ? base.player.name : '-';
      return `${baseName}: ${playerName}`;
    }).join(' ');
  }

  let currentHalfText = '';
  if (game.currentHalf) {
    currentHalfText = game.currentHalf.charAt(0).toUpperCase() + game.currentHalf.slice(1);
  }

  const handleRollForNextPitch = async () => {
    if (gameId) {
      try {
        const updatedGameState = await rollForNextPitch(gameId);
        gameContext.setGame(updatedGameState);
      } catch (error) {
        console.error(error);
      }
    }
  };  

  return (
    <View style={styles.container}>
      <Text style={styles.textStyle}>
        {currentHalfText} of {game.currentInning} - Outs: {game.currentOuts || 0}      </Text>
      <Text style={styles.textStyle}>
        {basesText}
      </Text>
      <Text style={styles.textStyle}>
        {homeTeam.name} - {game.home_team_score || 0}            {awayTeam.name} - {game.away_team_score || 0}
      </Text>
      <Text style={styles.textStyle}>
        Batter: {offensivePlayerName} Pitcher: {defensivePlayerName}
      </Text>
      <Button title="Roll for Next Pitch" onPress={handleRollForNextPitch} />
    </View>
  );
};


const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  buttonContainer: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    padding: 20,
  },
  textStyle: {
    fontSize: 16,
    marginBottom: 20,
  },
});
//END OF GameplayScreen.tsx