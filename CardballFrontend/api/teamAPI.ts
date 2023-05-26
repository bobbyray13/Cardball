// teamAPI.ts
import axios from 'axios';
import { Player } from '../types';

export const createTeam = async (id: number, name: string) => {
    const response = await fetch('http://192.168.4.46:5000/api/teams', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id, name }),
    });
    const team = await response.json();
    return team;
};

export const getLineup = async (teamId: number): Promise<any[]> => {
  try {
    const response = await axios.get(`http://192.168.4.46:5000/api/teams/${teamId}/get_lineup`);
    console.log("Received lineup from server: ", response.data);
    return response.data;
  } catch (error) {
    console.error('Failed to fetch lineup', error);
    throw error;
  }
};
  export const getBatters = async (teamId: number): Promise<Player[]> => {
    try {
        const response = await axios.get(`http://192.168.4.46:5000/api/teams/${teamId}/get_batters`);
        console.log("Received batters from server: ", response.data);
        return response.data;
    } catch (error) {
        console.error('Failed to fetch batters', error);
        throw error;
    }
  };

  export const getPitchers = async (teamId: number): Promise<Player[]> => {
    try {
        return await axios.get(`http://192.168.4.46:5000/api/teams/${teamId}/get_pitchers`)
            .then(response => {
                console.log("Received pitchers from server: ", response.data);
                return response.data;
            })
            .catch(error => {
                console.log("Axios error: ", error);
                throw error;
            });
    } catch (error) {
        console.error('Failed to fetch pitchers', error);
        throw error;
    }
  };
//END OF teamAPI.ts
