//GameplayScreen.tsx
import React, { useContext } from 'react';
import { Button, Text, View, StyleSheet } from 'react-native';
import { GameContext } from '../contexts/gameContext';
import { rollForNextPitch } from '../api/gamePlayAPI'

export const GameplayScreen: React.FC = () => {
  const gameContext = useContext(GameContext);

  console.log('gameContext:', gameContext);  // Add this line
  console.log('gameContext.game:', gameContext?.game);  // Add this line
  console.log('gameContext.game.currentHalf:', gameContext?.game?.currentHalf);  // Add this line
  console.log('gameContext.game.homeTeam:', gameContext?.game?.homeTeam);  // Add this line
  console.log('gameContext.game.awayTeam:', gameContext?.game?.awayTeam);  // Add this line

  // This if statement ensures that the necessary context is available.
  if (!gameContext || !gameContext.game || !gameContext.game.currentHalf || !gameContext.game.homeTeam || !gameContext.game.awayTeam) {
    return <Text>Loading game context...</Text>;
  }
  
  // const game = gameContext.game;
  const { gameId } = gameContext;
    // const { homeTeam, awayTeam } = game;

  // // Determine which team is on offense and which is on defense
  // const offensiveTeam = homeTeam.role === 'onOffense' ? homeTeam : awayTeam;
  // const defensiveTeam = homeTeam.role === 'onDefense' ? homeTeam : awayTeam;

  // // Ensure offensiveTeam and defensiveTeam have necessary properties defined
  // if (!offensiveTeam.lineup || !defensiveTeam.fieldPositions || !offensiveTeam.players || !defensiveTeam.players) {
  //   return <Text>Loading Lineups...</Text>;
  // }

  // // Get the player in the lineup position 1 for the team on offense
  // const offensivePlayerId = offensiveTeam.lineup[0];
  // const offensivePlayer = offensiveTeam.players.find(player => player.id === offensivePlayerId);

  // // Get the player in the 'P' field position for the team on defense
  // const defensivePlayerId = defensiveTeam.fieldPositions['P'];
  // const defensivePlayer = defensiveTeam.players.find(player => player.id === Number(defensivePlayerId));

  // // Extract player names, defaulting to 'Unknown' if not found
  // const offensivePlayerName = offensivePlayer ? offensivePlayer.name : 'Unknown';
  // const defensivePlayerName = defensivePlayer ? defensivePlayer.name : 'Unknown';

  // // Add logs to access required info
  // console.log(`Offensive lineup: ${JSON.stringify(offensiveTeam.lineup.map(id => offensiveTeam.players.find(player => player.id === id)?.name || 'Unknown'))}`);
  // console.log(`Defensive field positions: ${JSON.stringify(defensiveTeam.fieldPositions)}`);
  // console.log(`Defensive active pitcher: ${defensivePlayerName}`);

  // console.log(`Offensive player: ${JSON.stringify(offensivePlayer)}`);
  // console.log(`Defensive team field positions: ${JSON.stringify(defensiveTeam.fieldPositions)}`);

  // // Mapping base number to base name
  // const baseNames = ['1st Base', '2nd Base', '3rd Base'];

  // // Bases text
  // let basesText = '';
  // if (game.bases) {
  //   basesText = game.bases.map(base => {
  //     const baseName = baseNames[base.baseNumber - 1];
  //     const playerName = base.player ? base.player.name : '-';
  //     return `${baseName}: ${playerName}`;
  //   }).join(' ');
  // }

  // let currentHalfText = '';
  // if (game.currentHalf) {
  //   currentHalfText = game.currentHalf.charAt(0).toUpperCase() + game.currentHalf.slice(1);
  // }

  // // Ensure offensiveTeam and defensiveTeam have necessary properties defined
  // if (!offensiveTeam.lineup || !defensiveTeam.fieldPositions) {
  //   return <Text>Loading Lineups...</Text>;
  // }

  const handleRollForNextPitch = async () => {
    if (gameId) {
      try {
        console.log(`Rolling for next pitch in game ${gameId}...`);
        const updatedGameState = await rollForNextPitch(gameId);
        console.log(`Updated game state: ${JSON.stringify(updatedGameState)}`);
        gameContext.setGame(updatedGameState);
      } catch (error) {
        console.error(error);
      }
    }
  };  

  return (
    <View style={styles.container}>
      {/* <Text style={styles.textStyle}>
        {currentHalfText} of {game.currentInning} - Outs: {game.currentOuts || 0}      </Text>
      <Text style={styles.textStyle}>
        {basesText}
      </Text>
      <Text style={styles.textStyle}>
        {homeTeam ? `${homeTeam.name} - ${game.home_team_score || 0}` : 'Loading home team...'} 
        {awayTeam ? `${awayTeam.name} - ${game.away_team_score || 0}` : 'Loading away team...'}
      </Text>
      <Text style={styles.textStyle}>
        Batter: {offensivePlayerName} Pitcher: {defensivePlayerName}
      </Text> */}
      <Button title="Roll for Next Pitch" onPress={handleRollForNextPitch} />
    </View>
  );
};


const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  // buttonContainer: {
  //   position: 'absolute',
  //   bottom: 0,
  //   width: '100%',
  //   padding: 20,
  // },
  // textStyle: {
  //   fontSize: 16,
  //   marginBottom: 20,
  // },
});
//END OF GameplayScreen.tsx