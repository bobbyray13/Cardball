// gamePlayAPI.ts

import axios from 'axios';

export const rollForNextPitch = async (gameId: number) => {
  try {
    const response = await axios.post(`http://127.0.0.1:5000/api/games/${gameId}/next_pitch`);
    return response.data;
  } catch (error) {
    console.error(error);
    throw error;
  }
};
