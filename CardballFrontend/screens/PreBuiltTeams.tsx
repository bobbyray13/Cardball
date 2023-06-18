// PreBuiltTeams.tsx
import React, { useState, useContext } from 'react';
import { View, Text, Button, Alert } from 'react-native';
import { GameContext } from '../contexts/gameContext';
import { createGameWithPreBuiltTeams } from '../api/teamAPI';
import { PreBuiltTeamsScreenNavigationProp } from '../types';

export const PreBuiltTeams: React.FC<{ navigation: PreBuiltTeamsScreenNavigationProp }> = ({ navigation }) => {
  const [selectedTeam, setSelectedTeam] = useState(null);
  const gameContext = useContext(GameContext);

  if (!gameContext) {
    throw new Error('GameContext is undefined');
  }
  const { setGame, setGameId } = gameContext;
  

  const teams = ["Mariners", "Giants", "Rainiers"];

  const selectTeam = async (teamName) => {
    if (selectedTeam === null) {
      setSelectedTeam(teamName);
    } else if (selectedTeam !== teamName) {
      try {
        const game = await createGameWithPreBuiltTeams(selectedTeam, teamName); // This would be a new API to create game with pre-built teams
        setGame(game);
        if (game.id) {
          setGameId(game.id); // Ensure gameId is set as soon as game is created
        }
        navigation.navigate('LineupSelect');
      } catch (error) {
        Alert.alert('Failed to create game');
      }
    } else {
      Alert.alert('Cannot select the same team for both Home and Away');
    }
  };

  const displayMessage = () => {
    if (selectedTeam === null) {
      return "Select the Away team";
    } else {
      return `Away team is ${selectedTeam}. Now select the Home team`;
    }
  };

  return (
    <View>
      <Text>{displayMessage()}</Text>
      {teams.map((team, i) => (
        <Button
          key={i}
          title={team}
          onPress={() => selectTeam(team)}
        />
      ))}
    </View>
  );
};
//END OF PreBuiltTeams.tsx