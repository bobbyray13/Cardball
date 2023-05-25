//GameplayScreen.tsx
import React, { useContext } from 'react';
import { Button, Text, View, StyleSheet } from 'react-native';
import { GameContext } from '../contexts/gameContext';

export const GameplayScreen: React.FC = () => {
  const gameContext = useContext(GameContext);

  // If game state has not loaded, show a loading message
  if (!gameContext || !gameContext.game) {
    return <Text>Loading...</Text>;
  }

  // Get the game state
  const game = gameContext.game;
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

  console.log('Home team role:', homeTeam.role);
  console.log('Away team role:', awayTeam.role);
  
  console.log('Home team field positions:', homeTeam.fieldPositions);
  console.log('Away team field positions:', awayTeam.fieldPositions);

  console.log('Defensive player ID:', defensivePlayerId);
  console.log('Defensive player:', defensivePlayer);

  // Extract player names, defaulting to 'Unknown' if not found
  const offensivePlayerName = offensivePlayer ? offensivePlayer.name : 'Unknown';
  const defensivePlayerName = defensivePlayer ? defensivePlayer.name : 'Unknown';

  return (
    <View style={styles.container}>
      <Text style={styles.textStyle}>
        Top of 1st - 0 Out - 0 Runners on Base
      </Text>
      <Text style={styles.textStyle}>
        Home Team - 0 (*)Away Team - 0
      </Text>
      <Text style={styles.textStyle}>
        Batter: {offensivePlayerName} Pitcher: {defensivePlayerName}
      </Text>
      <View style={styles.buttonContainer}>
        <Button
          title="Next Pitch"
          onPress={() => console.log('Next Pitch clicked')}
        />
      </View>
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