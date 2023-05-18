// gameAPI.ts
export const createGame = async (homeTeamName: string, awayTeamName: string) => {
    console.log(`Creating game with home team: ${homeTeamName}, away team: ${awayTeamName}`);  // Add this line

    const response = await fetch('http://192.168.4.46:5000/api/games', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ home_team_name: homeTeamName, away_team_name: awayTeamName }),
    });
    const game = await response.json();

    console.log(`Game created: ${JSON.stringify(game)}`); // Add this line to log the created game

    return game;
};

export const playInningHalf = async (gameId: number) => {
    const response = await fetch(`http://192.168.4.46:5000/api/games/${gameId}/play_inning_half`, {
        method: 'POST',
    });
    const game = await response.json();
    return game;
};

export const endHalfInning = async (gameId: number) => {
    const response = await fetch(`http://192.168.4.46:5000/api/games/${gameId}/end_half_inning`, {
        method: 'POST',
    });
    const game = await response.json();
    return game;
};

export const incrementOuts = async (gameId: number) => {
    const response = await fetch(`http://192.168.4.46:5000/api/games/${gameId}/increment_outs`, {
        method: 'POST',
    });
    const game = await response.json();
    return game;
};

//END OF gameAPI.ts