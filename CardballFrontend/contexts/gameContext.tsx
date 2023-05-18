import React, { createContext, useState } from 'react';
import { Game, GameContextProps, GameProviderProps } from '../types';
import { Team, Player,PlayerType } from '../types'

export const GameContext = createContext<GameContextProps | undefined>(undefined);

export const GameProvider: React.FC<GameProviderProps> = ({ children }) => {
    const [game, setGame] = useState<Game | null>(null);

    const playInningHalf = async (onOffense: Team, onDefense: Team) => {
        // Initialize the inning
        setGame(game => {
            if (game === null) {
                return null;
            }
    
            return {
                ...game,
                currentInningDetails: { 
                    number: game.currentInningDetails.number + 1, 
                    homeTeamScore: game.homeTeam.score,
                    awayTeamScore: game.awayTeam.score,
                    outs: 0, 
                    half: game.currentInningDetails.number % 2 === 0 ? 'bottom' : 'top'
                }
            };
        });
    }

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
    
    const endHalfInning = async () => {
        if (game !== null) {
            // Switch the inning half and reset outs
            const newHalf = game.currentInningDetails.half === 'top' ? 'bottom' : 'top';
            
            setGame(prevGame => {
                if (prevGame === null) return null;
    
                return {
                    ...prevGame,
                    currentInningDetails: { 
                        ...prevGame.currentInningDetails, 
                        outs: 0, 
                        half: newHalf
                    },
                    homeTeam: {
                        ...prevGame.homeTeam,
                        role: prevGame.homeTeam.role === 'onOffense' ? 'onDefense' : 'onOffense'
                    },
                    awayTeam: {
                        ...prevGame.awayTeam,
                        role: prevGame.awayTeam.role === 'onOffense' ? 'onDefense' : 'onOffense'
                    }
                };
            });
        }
        return Promise.resolve();
    };
    
    const incrementOuts = () => {
        if (game !== null) {
            // Increment the number of outs
            setGame({
                ...game,
                currentInningDetails: {
                    ...game.currentInningDetails,
                    outs: game.currentInningDetails.outs + 1
                }
            });
        }
    };

    return (
        <GameContext.Provider value={{ 
            game, 
            setGame, 
            playInningHalf,
            substitutePlayer,
            endHalfInning,
            incrementOuts
        }}>
            {children}
        </GameContext.Provider>
    );
};
//END OF gameContext.tsx