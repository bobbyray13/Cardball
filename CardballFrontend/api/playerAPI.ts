//playerAPI.ts:
import Constants from 'expo-constants';
import { Game } from '../types';
import axios from 'axios';
import { LineupData } from '../types';

export const updateLineup = async (teamId: number, lineupData: {lineup: number[], fieldPositions: Record<number, string>, activePitcher: number | null}): Promise<void> => {
  console.log("Sending lineupData to server: ", lineupData);
  try {
    await axios.put(`http://127.0.0.1:5000/api/teams/${teamId}/lineup`, lineupData);
  } catch (error) {
    console.error('Failed to update lineup playerAPI.ts', error);
    throw error;
  }
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
    throw error;
  }
};

export const getPlayers = async () => {
    const response = await fetch('http://127.0.0.1:5000/api/players');
    const players = await response.json();
    return players;
};

export const loadPlayers = async () => {
  const response = await fetch('http://127.0.0.1:5000/api/load_players', {
      method: 'POST',
  });

  if (!response.ok) {
      const errorMessage = await response.text();
      throw new Error('Failed to load players' + errorMessage);
  }

  const result = await response.json();
  return result.message;
};

export const draftPlayer = async (teamId: number, playerId: number): Promise<any> => {
  const baseUrl = Constants.expoConfig?.extra?.BASE_URL;
  if (!baseUrl) {
    console.error('BASE_URL is not set in the app configuration');
    return;
  }

  try {
    const response = await fetch(`http://127.0.0.1:5000/api/draft`, {
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
    throw error;
  }
};
//END OF playerAPI.ts