//App.tsx:
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Button, View, Text, StyleSheet } from 'react-native';
import { DraftScreen } from './screens/DraftScreen';
import { TeamSelect } from './screens/TeamSelect';
import { StatusBar } from 'expo-status-bar';
import { GameProvider } from './contexts/gameContext';
import { RootStackParamList, HomeComponentProps } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

const HomeComponent = ({ navigation }: HomeComponentProps) => (
  <View style={styles.container}>
    <Text>Welcome to Baseball Cardball!</Text>
    <Button
      title="Go to Team Select Screen"
      onPress={() => {
        navigation.navigate('TeamSelect');
      }}
    />
    <StatusBar style="auto" />
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function App() {
  return (
    <GameProvider>
      <NavigationContainer>
        <Stack.Navigator initialRouteName="Home">
          <Stack.Screen name="Home" component={HomeComponent} />
          <Stack.Screen name="Draft" component={DraftScreen} />
          <Stack.Screen name="TeamSelect" component={TeamSelect} />
        </Stack.Navigator>
      </NavigationContainer>
    </GameProvider>
  );
}
//END OF App.tsx