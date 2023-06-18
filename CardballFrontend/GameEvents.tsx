//GameEvents.tsx:

import React from 'react';
import { ScrollView, Text } from 'react-native';
import { Event } from './types';

interface GameEventsProps {
  events: Event[];
}

const GameEvents: React.FC<GameEventsProps> = ({ events }) => {
  return (
    <ScrollView>
      {events.map((event, index) => (
        <Text key={index}>{event.description}</Text>
      ))}
    </ScrollView>
  );
};

export default GameEvents;

//END OF GameEvents.tsx
