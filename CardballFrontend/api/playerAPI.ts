//playerAPI.ts:
import Constants from 'expo-constants';

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

export const draftPlayer = async (teamId: number, playerId: number): Promise<void> => {
  const baseUrl = Constants.expoConfig?.extra?.BASE_URL;
  if (!baseUrl) {
    console.error('BASE_URL is not set in the app configuration');
    return;
  }

  try {
    const response = await fetch(`${baseUrl}/draft`, {
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
      throw new Error('Failed to draft player.');
    }
  } catch (error) {
    console.error('Failed to draft player:', error);
  }
};
//END OF playerAPI.ts