// PostDraft.tsx
import React, { useContext } from 'react';
import { View, Text, StyleSheet, ScrollView, Button, } from 'react-native';
import { GameContext } from '../contexts/gameContext';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types';

type PostDraftScreenNavigationProp = StackNavigationProp<
  RootStackParamList,
  'PostDraft'
>;

interface Props {
    navigation: PostDraftScreenNavigationProp;
  }  

  export const PostDraft: React.FC<Props> = ({ navigation }) => {
    const gameContext = useContext(GameContext);

  if (!gameContext) {
    throw new Error("GameContext must be used within a GameProvider");
  }

  const { game } = gameContext;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.teamContainer}>
        <Text style={styles.teamName}>{game?.homeTeam.name}</Text>
        <Text>Home Team</Text>
        {game?.homeTeam.players.map((player, index) => (
          <Text key={index}>{player.name} - {player.position}</Text>
        ))}
      </View>

      <View style={styles.teamContainer}>
        <Text style={styles.teamName}>{game?.awayTeam.name}</Text>
        <Text>Away Team</Text>
        {game?.awayTeam.players.map((player, index) => (
          <Text key={index}>{player.name} - {player.position}</Text>
        ))}
      </View>

      <Button
        title="Go To Lineup Select"
        onPress={() => navigation.navigate('LineupSelect')}
      />
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
