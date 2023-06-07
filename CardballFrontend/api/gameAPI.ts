// gameAPI.ts
import { getGameState  } from "./playerAPI";

export const createGame = async (homeTeamName: string, awayTeamName: string) => {
    console.log(`Creating game with home team: ${homeTeamName}, away team: ${awayTeamName}`);

    try {
        const response = await fetch('http://192.168.4.46:5000/api/games', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ home_team_name: homeTeamName, away_team_name: awayTeamName }),
        });

        if (!response.ok) {
            console.error(`HTTP error! status: ${response.status}`);
            const errorText = await response.text();
            console.error(`HTTP response text: ${errorText}`);
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const game = await response.json();
        console.log(`Game created: ${JSON.stringify(game)}`);
        return game;
    } catch (error) {
        console.error(`Fetch Error: ${error}`);
    }
};

export const playInningHalf = async (gameId: number) => {
    const response = await fetch(`http://192.168.4.46:5000/api/games/${gameId}/play_inning_half`, {
        method: 'POST',
    });
    const game = await response.json();

    // Once half-inning ends, get the updated game state
    const updatedGameState = await getGameState(gameId);

    return updatedGameState;
};

export const incrementOuts = async (gameId: number) => {
    const response = await fetch(`http://192.168.4.46:5000/api/games/${gameId}/increment_outs`, {
        method: 'POST',
    });
    const game = await response.json();
    return game;
};

//END OF gameAPI.ts