import React, { useContext, useEffect } from 'react';
import { View, Button, StyleSheet, Text } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { GameContext } from '../contexts/gameContext';
import { RootStackParamList, Player, Team } from '../types';
import { rollForNextPitch } from '../api/gamePlayAPI';

type TempGameplayScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'TempGameplay'>;

type Props = {
  navigation: TempGameplayScreenNavigationProp;
};

const findPlayerWithRole = (players: Player[], role: string): Player | undefined => {
  return players.find(player => player.role === role);
};

const TempGameplay: React.FC<Props> = ({ navigation }) => {
  const gameContext = useContext(GameContext);

  useEffect(() => {
    console.log('Game state on render:', gameContext?.game);
  }, [gameContext]);

  const handleNextPitch = async () => {
    if (gameContext?.gameId && gameContext?.game) {
      try {
        await rollForNextPitch(gameContext.gameId);
      } catch (error) {
        console.error('Error rolling for next pitch:', error);
      }
    } else {
      console.error('Game ID is not set or Game object is not defined');
    }
  };

  if (gameContext?.game) {
    const { homeTeam, awayTeam, currentInning, currentHalf } = gameContext.game;

    const batter = findPlayerWithRole(homeTeam.players, 'upToBat') || findPlayerWithRole(awayTeam.players, 'upToBat');
    const pitcher = findPlayerWithRole(homeTeam.players, 'upToPitch') || findPlayerWithRole(awayTeam.players, 'upToPitch');

    return (
      <View style={styles.container}>
        <Text style={styles.score}>Home Team Score: {homeTeam.score}</Text>
        <Text style={styles.score}>Away Team Score: {awayTeam.score}</Text>
        <Text style={styles.inning}>Inning Number: {currentInning}</Text>
        <Text style={styles.inning}>Inning Half: {currentHalf}</Text>
        <Text style={styles.player}>Batter: {batter ? batter.name : 'None'}</Text>
        <Text style={styles.player}>Pitcher: {pitcher ? pitcher.name : 'None'}</Text>
        <Button title="Roll for Next Pitch" onPress={handleNextPitch} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text>Loading game...</Text>
    </View>
  );
};

export default TempGameplay;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  score: {
    fontSize: 20,
    margin: 10,
  },
  inning: {
    fontSize: 18,
    margin: 10,
  },
  player: {
    fontSize: 16,
    margin: 10,
  },
});
