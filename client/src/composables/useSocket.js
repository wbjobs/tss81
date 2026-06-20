import { io } from 'socket.io-client';

const socket = io({
  transports: ['websocket', 'polling']
});

export function useSocket() {
  return socket;
}

export function createRoom() {
  return new Promise((resolve) => {
    socket.emit('create-room', (response) => {
      resolve(response);
    });
  });
}

export function joinRoom(roomId) {
  return new Promise((resolve) => {
    socket.emit('join-room', roomId, (response) => {
      resolve(response);
    });
  });
}

export function sendSignal(to, data) {
  socket.emit('signal', { to, data });
}

export function notifyMessageDestroyed(messageId) {
  socket.emit('message-destroyed', { messageId });
}
