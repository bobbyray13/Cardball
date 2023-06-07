//PostDraft.tsx:
import React, { useContext } from 'react';
import { Text, ScrollView, Button, View, StyleSheet } from 'react-native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList, GameContextProps, Team, Player } from '../types';
import { GameContext } from '../contexts/gameContext';

type PostDraftScreenNavigationProp = StackNavigationProp<
  RootStackParamList,
  'PostDraft'
>;

interface Props {
  navigation: PostDraftScreenNavigationProp;
}

export const PostDraft: React.FC<Props> = ({ navigation }) => {
  const gameContext = useContext<GameContextProps | undefined>(GameContext);

  const { game } = gameContext || {};

  if (!game) {
    return <Text>Loading...</Text>;
  }

  const renderPlayers = (team: Team) => {
    return team.players.map((player: Player, index: number) => {
      if (!player) {
        return <Text key={index}>Undefined player</Text>;
      }
      return <Text key={index}>{player.name} - {player.position}</Text>;
    });
  };
  
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.teamContainer}>
        {game.homeTeam ? 
          <>
            <Text style={styles.teamName}>{game.homeTeam.name}</Text>
            <Text>Home Team</Text>
            {renderPlayers(game.homeTeam)}
          </>
          :
          <Text>Loading Home Team...</Text>
        }
      </View>

      <View style={styles.teamContainer}>
        {game.awayTeam ? 
          <>
            <Text style={styles.teamName}>{game.awayTeam.name}</Text>
            <Text>Away Team</Text>
            {renderPlayers(game.awayTeam)}
          </>
          :
          <Text>Loading Away Team...</Text>
        }
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
//END OF PostDraft.tsx