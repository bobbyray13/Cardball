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
        }
      }
    };
  
    fetchGameState();
  }, [gameId, setGame]);

  const renderTeam = (team: Team, homeOrAway: string) => {
    if (!team.lineup || !team.fieldPositions || !team.role) {
      return <Text>Loading...</Text>;
    }

    const unorderedPlayers: (Player | undefined)[] = team.lineup.map(lineupPosition => 
      team.players.find((player: Player) => player.id === lineupPosition)
    );

    const orderedPlayers: Player[] = unorderedPlayers.filter(
      (player): player is Player => player !== undefined
    );

    return (
      <View>
        <Text>{homeOrAway === 'home' ? 'Home Team' : 'Away Team'}: {team.name}</Text>
        <Text>Role: {team.role}</Text>
        {orderedPlayers.map((player, index) => (
          <Text key={player.id}>
            {index + 1}. {player.name} ({team.fieldPositions[player.id]})
          </Text>
        ))}
      </View>
    );
  };

  const navigation = useNavigation<PlayBallScreenNavigationProp>();

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20 }}>
      {game && (
        <>
          <Text>{JSON.stringify(game, null, 2)}</Text>
          {renderTeam(game.homeTeam, 'home')}
          {renderTeam(game.awayTeam, 'away')}
          <Button title="Play Ball!" onPress={() => navigation.navigate('GameplayScreen')} />
        </>
      )}
    </ScrollView>
  );
};

export default PlayBall;
