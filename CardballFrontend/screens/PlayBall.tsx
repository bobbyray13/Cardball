// PlayBall.tsx
import React from 'react';
import { Button, Text, View, StyleSheet } from 'react-native';

export const PlayBall: React.FC = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.textStyle}>
        Top of 1st - 0 Out - 0 Runners on Base
      </Text>
      <Text style={styles.textStyle}>
        Home Team - 0 (*)Away Team - 0
      </Text>
      <Text style={styles.textStyle}>
        Batter: I. Suzuki Pitcher: R. Johnson
      </Text>
      <View style={styles.buttonContainer}>
        <Button
          title="Next Pitch"
          onPress={() => console.log('Next Pitch clicked')}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  buttonContainer: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    padding: 20,
  },
  textStyle: {
    fontSize: 16,
    marginBottom: 20,
  },
});
