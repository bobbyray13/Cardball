// socket.ts
import { Game } from './types';
import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function initSocket(gameUpdateHandler: (data: Game) => void) {
  socket = io("http://192.168.4.46:5000");

  socket.on("GAME_UPDATE", (data: Game) => {
    console.log('Received GAME_UPDATE event with game state:', data);
    gameUpdateHandler(data);
  });
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
  }
}
// END OF socket.ts
