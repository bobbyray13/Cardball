//TeamSelect.tsx
import React, { useState, useContext } from 'react';
import { View, Text, TextInput, Button, StyleSheet } from 'react-native';
import { TeamSelectScreenNavigationProp } from '../types';
import { GameContext } from '../contexts/gameContext';
import { createGame } from '../api/gameAPI';

type Props = {
  navigation: TeamSelectScreenNavigationProp;
};

export const TeamSelect: React.FC<Props> = ({ navigation }) => {
  const [homeTeam, setHomeTeam] = useState('');
  const [awayTeam, setAwayTeam] = useState('');
  const gameContext = useContext(GameContext);

  if (!gameContext) {
    throw new Error("GameContext must be used within a GameProvider");
  }

  const { setGame } = gameContext;

  const submitTeams = async () => {
    if (homeTeam && awayTeam) {
      try {
        console.log(homeTeam, awayTeam);  // Add this line
        const game = await createGame(homeTeam, awayTeam);
        setGame(game);

        console.log(game)
        
        navigation.navigate('Draft');
      } catch (error) {
        alert('Failed to create game');
      }
    } else {
      alert('Both Home and Away teams must have a name');
    }
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
//END OF TeamSelect.tsx