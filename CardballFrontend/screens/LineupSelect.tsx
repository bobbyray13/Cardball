// LineupSelect.tsx
import React from 'react';
import { Button, Text, View, StyleSheet } from 'react-native';
import { GameContext } from '../contexts/gameContext';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types';

type LineupSelectScreenNavigationProp = StackNavigationProp<
  RootStackParamList,
  'LineupSelect'
>;

interface Props {
    navigation: LineupSelectScreenNavigationProp;
  }

export const LineupSelect: React.FC<{ navigation: any }> = ({ navigation }) => {
  return (
    <View style={styles.container}>
      <Text>Lineup Building Functionality goes here</Text>
      <Button
        title="Start Game"
        onPress={() => navigation.navigate('PlayBall')}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
