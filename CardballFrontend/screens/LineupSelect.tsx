// Lineupselect.tsx:
import React, { useState, useEffect, useContext } from 'react';
import { View, Button, Text, ScrollView } from 'react-native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Picker } from '@react-native-picker/picker';
import { RootStackParamList, Player, Team, LineupSelectScreenNavigationProp, } from '../types';
import { getGameState, updateLineup } from '..//api/playerAPI';
import { getBatters, getPitchers } from '../api/teamAPI';
import { Platform, LogBox } from 'react-native';
import { GameContext } from '../contexts/gameContext';

type LineupSelectProps = {
  navigation: StackNavigationProp<RootStackParamList, 'LineupSelect'>;
};

export const LineupSelect: React.FC<LineupSelectProps> = ({ navigation }) => {
  console.log('Rendering LineupSelect');
  const [batters, setBatters] = useState<Player[]>([]);
  const [pitchers, setPitchers] = useState<Player[]>([]);
  const [teamId, setTeamId] = useState<number | null>(null);
  const [lineup, setLineup] = useState<Record<number, number | null>>({});
  const [fieldPositions, setFieldPositions] = useState<Record<string, string>>({});

  const gameContext = useContext(GameContext);

  if (!gameContext) {
    throw new Error("GameContext must be used within a GameProvider");
  }

  const { gameId } = gameContext;

  useEffect(() => {
    let isMounted = true; // isMounted is true initially
    if (Platform.OS === 'android') {
      LogBox.ignoreLogs(['VirtualizedLists should never be nested']);
    }
  
    const fetchPlayers = async () => {
      console.log('Calling fetchPlayers');
      if (gameId !== null) {
        try {
          // Get the game state to find the away team's id
          const gameState = await getGameState(gameId);
          const awayTeamId = gameState.awayTeam.id;
          if (isMounted) {
            setTeamId(awayTeamId); // Set the team id
          }
          if (awayTeamId !== null) {
            // Fetch only the away team's batters
            const fetchedBatters = await getBatters(awayTeamId);
            const fetchedPitchers = await getPitchers(awayTeamId);
            if (isMounted) {
              setBatters(fetchedBatters);
              setPitchers(fetchedPitchers);
            }
          } else {
            console.error('Away team ID is null');
          }
          
        } catch (error) {
          console.error('Failed to fetch players', error);
        }
      } else {
        console.error('Game ID is null');
      }
    };

    fetchPlayers(); // Call fetchPlayers when the component mounts

    return () => {
      isMounted = false; // Change isMounted to false when the component unmounts
    }

  }, [gameId]);

  const [selectedPitcherId, setSelectedPitcherId] = useState<number | null>(null);

  const handleLineupChange = (playerId: number, lineupSlot: number | null) => {
    setLineup((prevLineup) => ({
      ...prevLineup,
      [playerId]: lineupSlot,
    }));
  };

  const handleFieldPositionChange = (fieldPositions: string, playerId: number | null) => {
    console.log('handleFieldPositionChange called with:', playerId, fieldPositions);
    setFieldPositions((prevFieldPositions) => {
      const updatedFieldPositions = {
        ...prevFieldPositions,
        [fieldPositions]: String(playerId), // Assign the playerId as the value for the fieldPosition key
      };
      
      // Find the player object from the list of players
      const player = batters.find((batter) => batter.id === playerId);
      
      // Log the player's name and the field position
      if (player) {
        console.log(`Player ${player.name} was set to ${fieldPositions}`);
      }

      return updatedFieldPositions;
    });
  };

const handleSubmit = async () => {
  if (teamId !== null && selectedPitcherId !== null) {
    try {
      const lineupEntries = Object.entries(lineup)
        .filter(([playerId, lineupSlot]) => lineupSlot !== null)
        .map(([playerId, lineupSlot]) => [Number(playerId), Number(lineupSlot)]);

      lineupEntries.sort((a, b) => a[1] - b[1]);

      const filteredLineup = lineupEntries.map(([playerId]) => playerId);

      // Include the selected pitcher in the fieldPositions and set their position to P
      const updatedFieldPositions = {
        ...fieldPositions,
        ["P"]: String(selectedPitcherId),
      };

      await updateLineup(teamId, {
        lineup: filteredLineup,
        fieldPositions: updatedFieldPositions,
        activePitcher: selectedPitcherId, // include the selectedPitcherId
      });

      console.log('Lineup and field positions updated successfully');
      // Navigate to 'LineupSelectHome' screen
      navigation.navigate('LineupSelectHome');
    } catch (error) {
      console.error('Error updating lineup and field positions: ', error);
    }
  } else {
    console.error('Team ID is null, cannot update lineup');
  }
};


  return (
    <ScrollView>
      {batters.map((player) => (
        <View key={player.id}>
          <Text>{player.name}</Text>
          <Picker selectedValue={lineup[player.id]} onValueChange={(lineupSlot) => handleLineupChange(player.id, lineupSlot)}>
            <Picker.Item label="Select lineup slot" value="" />
            {[...Array(9)].map((_, index) => (
              <Picker.Item key={player.id} label={String(index + 1)} value={index + 1} />
            ))}
          </Picker>
          <Picker 
            selectedValue={Object.keys(fieldPositions).find(key => fieldPositions[key] === String(player.id))}
            onValueChange={(fieldPosition) => {
                console.log('Picker value changed');
                handleFieldPositionChange(fieldPosition, player.id);
            }}
          >
            <Picker.Item label="Select field position" value="" />
            {['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'P', 'BN'].map((position) => (
              <Picker.Item key={position} label={position} value={position} />
            ))}
          </Picker>
        </View>
      ))}
      <Picker
          selectedValue={selectedPitcherId}
          onValueChange={(pitcherId) => setSelectedPitcherId(pitcherId)}
      >
          <Picker.Item label="Select pitcher" value="" />
          {pitchers.map((pitcher) => (
              <Picker.Item key={pitcher.id} label={pitcher.name} value={pitcher.id} />
          ))}
      </Picker>
      <Button onPress={handleSubmit} title="Save lineup" />
    </ScrollView>
  );
};

export default LineupSelect;
// END OF LineupSelect.tsx
