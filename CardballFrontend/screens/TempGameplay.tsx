// TempGameplay.tsx
import React, { useContext } from 'react';
import { View, Button, StyleSheet } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { GameContext } from '../contexts/gameContext';
import { RootStackParamList } from '../types';

type TempGameplayScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'TempGameplay'>;

type Props = {
  navigation: TempGameplayScreenNavigationProp;
};

const TempGameplay: React.FC<Props> = ({ navigation }) => {
  const gameContext = useContext(GameContext);

  const handleNextPitch = async () => {
    if (gameContext?.handleNextPitch) {
      await gameContext.handleNextPitch();
      console.log('Game state after next pitch:', gameContext?.game);
    } else {
      console.error('handleNextPitch function is not defined in the context');
    }
  };

  return (
    <View style={styles.container}>
      <Button title="Roll for Next Pitch" onPress={handleNextPitch} />
    </View>
  );
};

export default TempGameplay;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
