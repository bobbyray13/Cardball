// PlayerAction.tsx
import React, { useContext } from 'react';
import { Button } from 'react-native';
import { GameContext } from './contexts/gameContext';
import { Player, Team, PlayerType } from './types';

interface PlayerActionProps {
  team: Team;
  playerOut: Player;
  playerIn: Player;
  playerType: PlayerType;
}

const PlayerAction: React.FC<PlayerActionProps> = ({ team, playerOut, playerIn, playerType }) => {
  const gameContext = useContext(GameContext);
  const { substitutePlayer } = gameContext || {};

  return (
    <Button title="Substitute Player" onPress={() => substitutePlayer && substitutePlayer(team, playerOut, playerIn, playerType)} />
  );
};

export default PlayerAction;
// END OF PlayerAction.tsx