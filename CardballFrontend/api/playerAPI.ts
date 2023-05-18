//playerAPI.ts:
import Constants from 'expo-constants';
import { Game } from '../types';

export const getPlayers = async () => {
    const response = await fetch('http://192.168.4.46:5000/api/players');
    const players = await response.json();
    return players;
};

export const loadPlayers = async () => {
  const response = await fetch('http://192.168.4.46:5000/api/load_players', {
      method: 'POST',
  });

  if (!response.ok) {
      throw new Error('Failed to load players');
  }

  const result = await response.json();
  return result.message;
};

export const getGameState = async (gameId: number): Promise<Game> => {
  const baseUrl = Constants.expoConfig?.extra?.BASE_URL;
  if (!baseUrl) {
    throw new Error('BASE_URL is not set in the app configuration');
  }
  try {
    const response = await fetch(`${baseUrl}/api/game_state/${gameId}`);

    if (!response.ok) {
      throw new Error('Failed to get game state.');
    }

    // Parse response as JSON and return it
    const data: Game = await response.json();
    return data;

  } catch (error) {
    console.error('Failed to get game state:', error);
    throw error; // Propagate the error so it can be handled by the caller
  }
};

export const draftPlayer = async (teamId: number, playerId: number): Promise<any> => {
  const baseUrl = Constants.expoConfig?.extra?.BASE_URL;
  if (!baseUrl) {
    console.error('BASE_URL is not set in the app configuration');
    return;
  }

  try {
    const response = await fetch(`http://192.168.4.46:5000/api/draft`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        team_id: teamId,
        player_id: playerId,
      }),
    });

    if (!response.ok) {
      throw new Error('number1 Failed to draft player.');
    }

    // Parse response as JSON and return it
    const data = await response.json();
    return data;

  } catch (error) {
    console.error('number2 Failed to draft player:', error);
    throw error; // Propagate the error so it can be handled by the caller
  }
};
//END OF playerAPI.ts