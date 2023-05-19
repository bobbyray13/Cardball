//gameContext.tsx
import React, { createContext, useState, useEffect } from 'react';
import { Game, GameContextProps, GameProviderProps } from '../types';
import { Team, Player, PlayerType } from '../types'
import { getGameState } from '../api/playerAPI';

export const GameContext = createContext<GameContextProps & { gameId: number | null, setGameId: React.Dispatch<React.SetStateAction<number | null>> } | undefined>(undefined);

export const GameProvider: React.FC<GameProviderProps> = ({ children }) => {
  const [game, setGame] = useState<Game | null>(null);
  const [gameId, setGameId] = useState<number | null>(null);

  useEffect(() => {
    async function loadInitialGameState() {
      if (gameId !== null) {
        console.log('Current game ID:', gameId);
        const gameState = await getGameState(gameId);
        setGame(gameState);
      }
    }
    loadInitialGameState();
  }, [gameId]);

  const substitutePlayer = async (team: Team, playerOut: Player, playerIn: Player, playerType: PlayerType): Promise<void> => {
    if (game && game.id !== undefined) {
        try {
            const response = await fetch('http://192.168.4.46:5000/api/substitute_player', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    game_id: game.id,
                    team_id: team.id,
                    player_out_id: playerOut.id,
                    player_in_id: playerIn.id,
                    player_type: playerType,
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to substitute player.');
            }

            // Get the updated game state
            const updatedGameState = await getGameState(game.id);
            setGame(updatedGameState);
            
            return Promise.resolve();
        } catch (error) {
            console.error('Failed to substitute player:', error);
            throw error;
        }
    } else {
        console.error('Game or game.id is undefined');
    }
};

    return (
        <GameContext.Provider value={{ game, setGame, substitutePlayer, gameId, setGameId }}>
          {children}
        </GameContext.Provider>
    );
};
//END OF gameContext.tsx