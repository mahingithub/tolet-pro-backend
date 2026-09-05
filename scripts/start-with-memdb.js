'use strict';

/**
 * Boots an in-memory MongoDB and starts the server against it.
 * For smoke-testing only — never use in production.
 */
const { MongoMemoryServer } = require('mongodb-memory-server');

(async () => {
  const mem = await MongoMemoryServer.create();
  process.env.MONGO_URI = mem.getUri('tolet-smoke');
  process.env.PORT = process.env.PORT || '5001';
  console.log(`[memdb] booted at ${process.env.MONGO_URI}`);

  // CALL start() EXPLICITLY. server.js only self-starts under
  // `if (require.main === module)`, and when this script requires it the main
  // module is THIS file — so a bare `require('../server')` loaded the whole app
  // and then started nothing. The process stayed alive (the SIGINT/SIGTERM
  // handlers keep the event loop busy) and listened on no port, which looks
  // exactly like a server that hung during boot.
  const { start } = require('../server');
  await start();
})().catch((err) => {
  console.error('[memdb] failed to start:', err);
  process.exit(1);
});
