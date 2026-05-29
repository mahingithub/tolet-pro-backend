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
  require('../server');
})();
