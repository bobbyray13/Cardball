// gamePlayAPI.ts
import axios from 'axios';

export const rollForNextPitch = async (gameId: number) => {
  try {
    const url = `http://192.168.4.46:5000/api/games/${gameId}/next_pitch`;
    console.log(`Making request to: ${url}`);
    const response = await axios.post(url);
    return response.data;
  } catch (error) {
    console.error(error);
    throw error;
  }
};
//END OF gamePlayAPI.ts