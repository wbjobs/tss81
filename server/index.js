const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());

const distPath = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(distPath));

app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

const ROOM_IDLE_TIMEOUT = 2 * 60 * 1000;

const rooms = new Map();

function generateRoomId() {
  let id;
  do {
    id = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms.has(id));
  return id;
}

function createRoom(roomId) {
  const room = {
    id: roomId,
    users: new Map(),
    lastActivity: Date.now(),
    createdAt: Date.now()
  };
  rooms.set(roomId, room);
  return room;
}

function touchRoom(roomId) {
  const room = rooms.get(roomId);
  if (room) {
    room.lastActivity = Date.now();
  }
}

function cleanupIdleRooms() {
  const now = Date.now();
  for (const [roomId, room] of rooms) {
    if (room.users.size === 0 && now - room.lastActivity > ROOM_IDLE_TIMEOUT) {
      rooms.delete(roomId);
      console.log(`[Cleanup] Room ${roomId} removed due to inactivity`);
    }
  }
}

setInterval(cleanupIdleRooms, 30 * 1000);

function getPeerSocketId(room, excludeSocketId) {
  for (const [socketId] of room.users) {
    if (socketId !== excludeSocketId) {
      return socketId;
    }
  }
  return null;
}

io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);
  let currentRoomId = null;

  socket.on('create-room', (callback) => {
    const roomId = generateRoomId();
    const room = createRoom(roomId);
    room.users.set(socket.id, { joinedAt: Date.now() });
    currentRoomId = roomId;
    socket.join(roomId);
    console.log(`[Room] Created room ${roomId} by ${socket.id}`);
    callback({ success: true, roomId });
  });

  socket.on('join-room', (roomId, callback) => {
    roomId = String(roomId).trim();
    const room = rooms.get(roomId);

    if (!room) {
      callback({ success: false, error: '房间不存在' });
      return;
    }

    if (room.users.size >= 2) {
      callback({ success: false, error: '房间已满' });
      return;
    }

    room.users.set(socket.id, { joinedAt: Date.now() });
    currentRoomId = roomId;
    socket.join(roomId);
    touchRoom(roomId);

    const peerId = getPeerSocketId(room, socket.id);
    console.log(`[Room] ${socket.id} joined room ${roomId}, peer: ${peerId}`);

    callback({ success: true, roomId });

    if (peerId) {
      socket.to(peerId).emit('peer-joined', { peerId: socket.id });
      socket.emit('peer-joined', { peerId });
    }
  });

  socket.on('signal', ({ to, data }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    if (!room.users.has(to)) return;

    touchRoom(currentRoomId);
    socket.to(to).emit('signal', { from: socket.id, data });
  });

  socket.on('message-destroyed', ({ messageId }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    const peerId = getPeerSocketId(room, socket.id);
    if (peerId) {
      socket.to(peerId).emit('message-destroyed', { messageId });
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
    if (currentRoomId) {
      const room = rooms.get(currentRoomId);
      if (room) {
        room.users.delete(socket.id);
        touchRoom(currentRoomId);
        const peerId = getPeerSocketId(room, socket.id);
        if (peerId) {
          socket.to(peerId).emit('peer-left', { peerId: socket.id });
        }
      }
      currentRoomId = null;
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
