import React from 'react';
import { Button, View, Text } from 'react-native';
import { GameContext } from '../contexts/gameContext';
import { useContext } from 'react';

const AtBat = () => {
  const gameContext = useContext(GameContext);

  const advanceBases = () => {
    // Update game context to move players forward
    // Check if base is occupied and move player
    // If player is on 3rd base, increment score and remove player from base
    // Make sure to handle cases where bases are empty or player scores
  };

  const updateScore = () => {
    // Update game context to increment score
    // Handle logic for adding score to correct team
  };
  
  return (
    <View>
      <Button
        title="Out"
        onPress={() => {
          /* action to be defined */
        }}
      />
      <Text>   </Text>
      <Button
        title="Single"
        onPress={() => {
          advanceBases();
          updateScore();
          // Also, handle logic for changing the batter        
        }}
      />
    </View>
  );
};

export default AtBat;
