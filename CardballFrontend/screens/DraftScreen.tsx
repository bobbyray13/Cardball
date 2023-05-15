import React, { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { Team } from '../components/Team';

type DraftScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  'Draft'
>;

type Props = {
  navigation: DraftScreenNavigationProp;
};

export const DraftScreen = ({ navigation }: Props) => {
  const [homeTeam, setHomeTeam] = useState('');
  const [awayTeam, setAwayTeam] = useState('');

  const submitTeams = () => {
    Team.setTeams(homeTeam, awayTeam);
    navigation.navigate('Home');
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
