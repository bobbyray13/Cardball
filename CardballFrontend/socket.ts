// socket.ts
import { Game, Event } from './types';
import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function initSocket(gameUpdateHandler: (data: Game) => void, gameEventHandler: (data: Event) => void) {
  socket = io("http://192.168.4.46:5000");

  socket.on("GAME_UPDATE", (data: Game) => {
    console.log('Received GAME_UPDATE event with game state: socket.ts');
    gameUpdateHandler(data);
  });

  socket.on("game_event", (data: Event) => {
    console.log('Received game_event: socket.ts');
    gameEventHandler(data);
  });
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
  }
}
// END OF socket.ts
