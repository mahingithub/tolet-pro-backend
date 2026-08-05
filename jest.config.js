'use strict';

/**
 * Jest config — Express + Mongoose backend.
 *
 * Integration tests spin up mongodb-memory-server, which needs a generous
 * timeout on a cold start (the binary is downloaded once, then cached), and
 * must run serially: they share a single in-memory MongoDB, so parallel
 * workers would stomp on each other's collections.
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  // mongodb-memory-server's first boot can take a while.
  testTimeout: 60_000,
  // One worker: the in-memory Mongo instance is shared state.
  maxWorkers: 1,
  // Surface open handles (unclosed mongoose connections, live cron timers)
  // instead of hanging the run forever.
  forceExit: true,
  detectOpenHandles: true,
  setupFiles: ['<rootDir>/tests/setupEnv.js'],
  // node_modules is huge here; don't waste time crawling it.
  testPathIgnorePatterns: ['/node_modules/'],
  collectCoverageFrom: [
    'services/**/*.js',
    'controllers/**/*.js',
    'utils/**/*.js',
    'models/**/*.js',
  ],
};
