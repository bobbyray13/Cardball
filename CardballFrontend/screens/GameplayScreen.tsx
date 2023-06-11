//GameplayScreen.tsx
import React, { useContext, useEffect, useState } from 'react';
import { GameContext } from '../contexts/gameContext';
import { Game, Player, PlayerType, Event } from '../types';
import { Text, View, Button, StyleSheet } from 'react-native';
import GameBoard from '../GameBoard';
import GameEvents from '../GameEvents';
import PlayerAction from '../PlayerAction';
import { initSocket, disconnectSocket } from '../socket'; // Import functions from socket.ts
import { io, Socket } from 'socket.io-client'

// Websocket connection URL
const wsUrl = 'http://192.168.4.46:5000';

const GameplayScreen: React.FC = () => {
  const gameContext = useContext(GameContext);
  const { game = null, setGame, substitutePlayer, handleNextPitch } = gameContext || {};

  // Events state
  const [events, setEvents] = useState<Event[]>([]);

  // Initiate Socket.IO connection
  useEffect(() => {
    console.log("Initialising Socket.IO connection.");
    const gameUpdateHandler = (data: Game) => {
      console.log("Received GAME_UPDATE event:", data);
      if (setGame) {
        setGame(data);
      } else {
        console.error('setGame is not defined');
      }
    };

    initSocket(gameUpdateHandler);

    // Disconnect from socket when component is unmounted
    return () => {
      disconnectSocket();
    };
  }, []);

  const rollForNextPitch = async () => {
    console.log("Rolling for next pitch");
    if (handleNextPitch) {
      await handleNextPitch();
      console.log('Game state after next pitch:', game);
    } else {
      console.error('handleNextPitch function is not defined in the context');
    }
  };

  return (
    <View style={styles.container}>
      <Text>Gameplay Screen</Text>
      <GameBoard game={game} />
      <GameEvents events={events} /> 
      {/* TODO: Implement player substitution UI here */}
      <Button title="Roll for Next Pitch" onPress={rollForNextPitch} />
    </View>
  );
};

export default GameplayScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
//END OF GameplayScreen.tsx