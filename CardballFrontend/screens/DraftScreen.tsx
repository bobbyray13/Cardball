// DraftScreen.tsx:
import React, { useState, useContext, useEffect, useCallback } from 'react';
import { View, Text, Button, FlatList, StyleSheet } from 'react-native';
import { DraftScreenNavigationProp, PlayerType } from '../types';
import { Player, PlayerPosition, Team as TeamType, PlayerRole, Game } from '../types';
import { getPlayers } from '../api/playerAPI';
//import { isDatabaseEmpty } from '../api/playerAPI';'
import { GameContext, } from '../contexts/gameContext';
import { draftPlayer as apiDraftPlayer } from '../api/playerAPI';
import { getGameState } from '../api/playerAPI';
import { loadPlayers } from '../api/playerAPI';

type Props = {
  navigation: DraftScreenNavigationProp;
};

export const DraftScreen: React.FC<Props> = ({ navigation }) => {
  const gameContext = useContext(GameContext);
  const [availablePlayers, setAvailablePlayers] = useState<Player[]>([]);
  const [draftTurn, setDraftTurn] = useState<'Home' | 'Away'>('Away');

  if (!gameContext) {
    // handle the case where the context is not inside a provider
    throw new Error("GameContext must be used within a GameProvider");
  }

  const { game, setGame, gameId } = gameContext;

  const [playersDrafted, setPlayersDrafted] = useState(0);

  const [isDrafting, setIsDrafting] = useState(false);

  useEffect(() => {
    console.log('Current game state:', JSON.stringify(game, null, 2));
  }, [playersDrafted]);

  useEffect(() => {
    const initializeDraft = async () => {
        try {
            console.log('Resetting players...');
            await fetch('http://192.168.4.46:5000/api/reset_players', {
                method: 'POST',
            });
            // Check if database is empty
            // const dbEmpty = await isDatabaseEmpty();
            // console.log('Database empty:', dbEmpty);
            // if (dbEmpty) {
            console.log('Loading players...');
            const loadMessage = await loadPlayers();
            console.log(loadMessage);
            // }

            const players = await getPlayers();
            console.log("Fetched players: ", players.map((player: Player) => player.name));
            setAvailablePlayers(players);
        } catch (err) {
            console.error('Failed to fetch players:', err);
        }
    };

    initializeDraft();
}, []);

  const handleDraftPlayer = useCallback(async (player: Player) => {
    console.log('Drafting player:', player);
    setIsDrafting(true);
    let shouldUpdateState = false;

    // Determine the team that's currently drafting
    const draftingTeam = draftTurn === 'Away' ? 'awayTeam' : 'homeTeam';
  
    console.log(draftingTeam);
  
    if (game && game[draftingTeam]) {
      console.log('Attempting to draft player for team ID:', game[draftingTeam].id);
      console.log('Attempting to draft player with player ID:', player.id);
      console.log('Attempting to draft player with game ID', gameId)

      // Attempt to draft player via the API
      try {
        await apiDraftPlayer(game[draftingTeam].id, player.id);
        console.log('Successfully drafted player:', player.name);

        // Fetch updated game state from backend
        if (gameId) {
          const updatedGameState = await getGameState(gameId);
          setGame(updatedGameState);
        } else {
          console.error('Game ID not set in context');
        }

        shouldUpdateState = true;
      } catch (err) {
        console.error('Failed to draft player:', err);
      }
    } else {
      console.error('Game or drafting team is not available:', game);
    }
  
    // Remove the player from the available players
    if (shouldUpdateState) {
      setAvailablePlayers((prevPlayers) => {
        const updatedPlayers = prevPlayers.filter((p) => p.id !== player.id);

        console.log("Current game state: ", JSON.stringify(game, null, 2));
        console.log('Updated available players:', updatedPlayers.map(player => player.name));
        
        return updatedPlayers;
      });

      // Increment the number of players drafted
      setPlayersDrafted(prevCount => {
        const updatedCount = prevCount + 1;
        
        console.log('number of players drafted:', updatedCount)

        return updatedCount;
      });

      // Alternate the draft turn
      setDraftTurn((prevTurn) => (prevTurn === 'Away' ? 'Home' : 'Away'));
    }  

    setIsDrafting(false);
  }, [game, setGame, gameId, draftTurn, navigation]);;
  
  useEffect(() => {
    if (playersDrafted >= 20) {
      navigation.navigate('PostDraft');
    }
  }, [playersDrafted, navigation]);

  return (
    <View style={styles.container}>
      <Text>Draft for {draftTurn} team</Text>
      <FlatList
        data={availablePlayers}
        keyExtractor={(item) => `${item.name}-${item.position}-${item.year}`}
        renderItem={({ item }) => (
          <View>
            <Text>{item.name} - {item.position}</Text>
            <Button
              title={isDrafting ? "Drafting..." : "Draft Player"}
              onPress={() => handleDraftPlayer(item)}
              disabled={isDrafting}
            />
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
})
//END OF DraftScreen.tsx:
