'use strict';

/**
 * scripts/bench-cache.js — measures the actual cache speedup.
 *
 * IMPORTANT CAVEAT for reading the result: this runs against
 * mongodb-memory-server on the SAME machine, so the "cold" number has no
 * network latency in it. Production talks to MongoDB Atlas M0 in another
 * datacentre, where a query pays 20–60 ms of round-trip before it does any
 * work. The speedup measured here is therefore a LOWER BOUND on what the same
 * change is worth in production.
 *
 * Usage:
 *   REDIS_URL=redis://127.0.0.1:6399 node scripts/bench-cache.js
 */

process.env.NODE_ENV = 'development';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('\n═══ Cache benchmark ═══\n');
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('toletpro_bench'));

  const cache = require('../config/redis');
  const svc = require('../services/property.service');
  for (let i = 0; i < 25 && !cache.isReady(); i += 1) await sleep(100);
  if (!cache.isReady()) {
    console.error('Redis not reachable — set REDIS_URL to a running instance.');
    process.exit(1);
  }

  const SEED = 60;
  process.stdout.write(`  seeding ${SEED} listings… `);
  for (let i = 0; i < SEED; i += 1) {
    await svc.createProperty({
      body: {
        title: `Flat number ${i}`,
        division: 'dhaka', district: 'Dhaka', area: `Area ${i}`,
        location: `Road ${i}`, type: 'flat', category: 'family', intent: 'rent',
        beds: 2, baths: 2, price: 20000 + i * 100, status: 'active',
      },
      // Fresh owner each time: the free tier caps a host at one listing.
      user: { _id: new mongoose.Types.ObjectId() },
    });
  }
  console.log('done');

  const q = { page: 1, limit: 50, sort: 'newest' };
  const N = 40;

  const bench = async (label, before) => {
    let total = 0;
    let min = Infinity;
    let max = 0;
    for (let i = 0; i < N; i += 1) {
      if (before) await before();
      const t = process.hrtime.bigint();
      await svc.listProperties(q);
      const ms = Number(process.hrtime.bigint() - t) / 1e6;
      total += ms;
      min = Math.min(min, ms);
      max = Math.max(max, ms);
    }
    const avg = total / N;
    console.log(
      `  ${label.padEnd(22)} avg ${avg.toFixed(2)} ms   ` +
      `min ${min.toFixed(2)}   max ${max.toFixed(2)}`,
    );
    return avg;
  };

  console.log(`\n  GET /api/properties equivalent — ${N} iterations each\n`);
  // Cold: wipe the cache before every call so each one hits Mongo.
  const cold = await bench('cold (MongoDB)', () => cache.clearAll());
  await svc.listProperties(q); // warm the key
  const warm = await bench('warm (Redis HIT)', null);

  console.log(`\n  speedup: ${(cold / warm).toFixed(1)}x faster on a cache hit`);
  console.log(
    '  NOTE: measured against a LOCAL in-memory MongoDB, so this excludes the\n' +
    '        20-60ms Atlas network round-trip that production pays on every\n' +
    '        cold read. Treat it as a lower bound.\n',
  );

  await cache.clearAll();
  await cache.disconnect();
  await mongoose.disconnect();
  await mongod.stop();
  process.exit(0);
})().catch((err) => {
  console.error('benchmark failed:', err);
  process.exit(1);
});
