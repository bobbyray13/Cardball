import React, { createContext, useState } from 'react';
import { Game, GameContextProps, GameProviderProps } from '../types';
import { Team, Player,PlayerType } from '../types'

export const GameContext = createContext<GameContextProps | undefined>(undefined);

export const GameProvider: React.FC<GameProviderProps> = ({ children }) => {
    const [game, setGame] = useState<Game | null>(null);

    const substitutePlayer = async (team: Team, playerOut: Player, playerIn: Player, playerType: PlayerType): Promise<void> => {
        // Choose the array to substitute player based on player type
        const playerArray = playerType === PlayerType.Pitcher ? team.pitchers : team.batters;
    
        // Swap out the player from the lineup or pitchers list
        const newLineupOrPitchers = playerArray.map(player => player.id === playerOut.id ? playerIn : player);
    
        // Swap out the player from the bench
        const newBenchPlayers = team.benchPlayers.map(player => player.id === playerIn.id ? playerOut : player);
    
        // Update the team
        if (playerType === PlayerType.Pitcher) {
            team.pitchers = newLineupOrPitchers;
        } else {
            team.batters = newLineupOrPitchers;
        }
        team.benchPlayers = newBenchPlayers;
    
        // Return a resolved Promise
        return Promise.resolve();
    };

    return (
        <GameContext.Provider value={{ 
            game, 
            setGame, 
            substitutePlayer,
        }}>
            {children}
        </GameContext.Provider>
    );
};
//END OF gameContext.tsx