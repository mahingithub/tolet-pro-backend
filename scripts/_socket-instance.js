'use strict';

/**
 * scripts/_socket-instance.js — child process helper for verify-socket-adapter.js.
 *
 * One bare Socket.IO instance built through the REAL initSocket() from
 * socket.js, so the adapter wiring under test is the production path and not a
 * reimplementation. Listens for { type: 'emit' } from the parent and relays it
 * through emitToUser().
 */

const http = require('http');
const { initSocket, emitToUser, isRedisAdapterActive, shutdownSocketRedis } = require('../socket');

const server = http.createServer((_req, res) => { res.writeHead(200); res.end('ok'); });
const io = initSocket(server);

server.listen(0, () => {
  // Let the pub/sub clients finish connecting before declaring readiness, so
  // the parent doesn't emit into a not-yet-subscribed adapter.
  setTimeout(() => {
    process.send({ type: 'ready', port: server.address().port, adapter: isRedisAdapterActive() });
  }, 500);
});

process.on('message', (msg) => {
  if (msg && msg.type === 'emit') {
    emitToUser(io, msg.userId, msg.event, msg.payload);
  }
});

process.on('SIGTERM', async () => {
  await shutdownSocketRedis();
  process.exit(0);
});
