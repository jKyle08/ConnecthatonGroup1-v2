const { Server } = require('socket.io');

let io = null;

function initRealtime(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: true },
    path: '/socket.io',
  });

  io.on('connection', (socket) => {
    socket.join('ereferral');
    socket.emit('realtimeConnected', {
      ok: true,
      at: new Date().toISOString(),
    });
  });

  return io;
}

function broadcast(event, payload) {
  if (!io) return;
  io.to('ereferral').emit(event, payload);
}

function getConnectionCount() {
  if (!io) return 0;
  return io.of('/').sockets.size;
}

module.exports = {
  initRealtime,
  broadcast,
  getConnectionCount,
};
