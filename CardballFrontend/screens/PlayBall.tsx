import React, { useContext, useEffect } from 'react';
import { Button, Text, View, StyleSheet, ScrollView } from 'react-native';
import { GameContext } from '../contexts/gameContext';
import { Team, Player } from '../types';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList, GameContextProps } from '../types';
import { getGameState } from '../api/playerAPI';

type PlayBallScreenNavigationProp = StackNavigationProp<RootStackParamList, 'GameplayScreen'>;

const PlayBall: React.FC = () => {
  const gameContext = useContext(GameContext);
  const { game = null, setGame = () => {}, gameId = null } = gameContext || {};

  useEffect(() => {
    const fetchGameState = async () => {
      if (gameId !== null) {
        const gameState = await getGameState(gameId);
        if (setGame) {
          setGame(gameState);
          console.log('Updated game state:', gameState);  // Add this line
        }
      }
    };
  
    fetchGameState();
  }, [gameId, setGame]);

  const renderTeam = (team: Team, homeOrAway: string) => {
    if (!team.lineup || !team.fieldPositions || !team.role) {
      return <Text>Loading...</Text>;
    }
  
    const orderedPlayers: Player[] = [...team.players].sort((a, b) => {
      const aLineupPos = team.lineup.indexOf(a.id);
      const bLineupPos = team.lineup.indexOf(b.id);
  
      if (aLineupPos === -1 || bLineupPos === -1) {
        return 0;
      }
  
      return aLineupPos - bLineupPos;
    });

    console.log('Lineup:', team.lineup);
    console.log('Ordered players:', orderedPlayers);

    return (
      <View style={styles.teamContainer}>
        <Text style={styles.teamName}>{team.name}</Text>
        <Text>{homeOrAway.charAt(0).toUpperCase() + homeOrAway.slice(1)} Team</Text>
        <Text>Role: {team.role.charAt(0).toUpperCase() + team.role.slice(1)}</Text>
        {orderedPlayers.map((player, index) => (
          <Text key={player.id}>
            {team.lineup.indexOf(player.id) + 1}. {player.name} ({team.fieldPositions[player.id]})
          </Text>
        ))}
      </View>
    );
  };

  const navigation = useNavigation<PlayBallScreenNavigationProp>();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {game ? (
        <>
          {renderTeam(game.awayTeam, 'away')}
          {renderTeam(game.homeTeam, 'home')}
          <Button
            title="Play Ball!"
            onPress={() => {
              console.log(`Current Inning: ${game.currentInning}, Current Half: ${game.currentHalf}`);
              navigation.navigate('GameplayScreen');
            }}
          /> 
       </>
      ) : (
        <Text>Loading game...</Text>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  teamContainer: {
    marginBottom: 24,
  },
  teamName: {
    fontSize: 24,
    marginBottom: 8,
  },
});

export default PlayBall;
