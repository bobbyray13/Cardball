// DraftScreen.tsx:
import React, { useState, useContext, useEffect } from 'react';
import { View, Text, TextInput, Button, FlatList, StyleSheet } from 'react-native';
import { DraftScreenNavigationProp } from '../types';
import { Player, PlayerPosition, Team as TeamType, PlayerRole } from '../types';
import { getPlayers } from '../api/playerAPI';
import { GameContext, } from '../contexts/gameContext';

type Props = {
  navigation: DraftScreenNavigationProp;
};

export const DraftScreen: React.FC<Props> = ({ navigation }) => {
  const [homeTeam, setHomeTeam] = useState('');
  const [awayTeam, setAwayTeam] = useState('');
  const gameContext = useContext(GameContext);
  const [availablePlayers, setAvailablePlayers] = useState<Player[]>([]);
  const [draftTurn, setDraftTurn] = useState<'Home' | 'Away'>('Away');

  if (!gameContext) {
    // handle the case where the context is not inside a provider
    throw new Error("GameContext must be used within a GameProvider");
  }

  const { game, setGame } = gameContext;

  const submitTeams = () => {
    if (homeTeam && awayTeam) {
      setGame(prevGame => {
        if (prevGame === null) return null;

        return {
          ...prevGame,
          homeTeam: { ...prevGame.homeTeam, name: homeTeam },
          awayTeam: { ...prevGame.awayTeam, name: awayTeam },
          currentInningDetails: prevGame.currentInningDetails || {
            number: 1,
            homeTeamScore: 0,
            awayTeamScore: 0,
            outs: 0,
            half: 'top'
          },
        };
      });
      navigation.navigate('Home');
    } else {
      // Handle the case where homeTeam or awayTeam is empty
    }
};

  useEffect(() => {
    const initializeDraft = async () => {
        try {
            const players = await getPlayers();
            setAvailablePlayers(players);
          } catch (err) {
            console.error('Failed to fetch players:', err);
          }
    };

    initializeDraft();
  }, []);

  const draftPlayer = (player: Player) => {
    // Determine the team that's currently drafting
    const draftingTeam = draftTurn === 'Away' ? 'awayTeam' : 'homeTeam';
  
    // Update the drafting team with the new player
    setGame((prevGame) => {
        if (prevGame) {
          const updatedTeam = {
            ...prevGame[draftingTeam === 'homeTeam' ? 'homeTeam' : 'awayTeam'],
            players: [...prevGame[draftingTeam === 'homeTeam' ? 'homeTeam' : 'awayTeam'].players, player],
          };
      
          if (draftingTeam === 'homeTeam') {
            return {
              ...prevGame,
              homeTeam: updatedTeam,
            };
          } else {
            return {
              ...prevGame,
              awayTeam: updatedTeam,
            };
          }
        }
        return null;
      });
      
  
    // Remove the player from the available players
    setAvailablePlayers((prevPlayers) =>
      prevPlayers.filter((p) => p.id !== player.id)
    );
  
    // Alternate the draft turn
    setDraftTurn((prevTurn) => (prevTurn === 'Away' ? 'Home' : 'Away'));
  };



  return (
    <View style={styles.container}>
      <Text style={styles.text}>Enter Team Names:</Text>
      <TextInput
        style={styles.input}
        placeholder="Home Team"
        onChangeText={setHomeTeam}
      />
      <TextInput
        style={styles.input}
        placeholder="Away Team"
        onChangeText={setAwayTeam}
      />
      <Button title="Submit" onPress={submitTeams} />
      <Text>Home Team: {homeTeam}</Text>
      <Text>Away Team: {awayTeam}</Text>
      <Text>Draft for {draftTurn} team</Text>
      <FlatList
        data={availablePlayers}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <View>
            <Text>{item.name} - {item.position}</Text>
            <Button title="Draft Player" onPress={() => draftPlayer(item)} />
          </View>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  text: {
    fontSize: 24,
    marginBottom: 20,
    alignSelf: 'center',
  },
  input: {
    height: 40,
    borderColor: 'gray',
    borderWidth: 1,
    marginBottom: 20,
    padding: 10,
  },
});
// END OF DraftScreen.tsx