'use strict';

/**
 * scripts/verify-integration.js — end-to-end check of the Redis integration.
 *
 * Boots the REAL Express app from server.js and drives it over HTTP, so
 * /healthz, the mounted rate limiters and the cache are all exercised through
 * the production code path.
 *
 * WHY NOT `npm run dev`: .env points MONGO_URI at the live Atlas cluster, and
 * start() schedules jobs that act on real data within seconds of boot —
 * runVisitReminders (sends SMS/WhatsApp to actual users) at +15s and
 * runRentedCleanup (PERMANENTLY DELETES expired listings) at +30s. Requiring
 * the app instead of calling start() gives the same middleware stack with none
 * of those side effects, against a throwaway in-memory MongoDB.
 *
 * Usage:
 *   REDIS_URL=redis://127.0.0.1:6399 node scripts/verify-integration.js
 */

process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

function check(label, condition, detail = '') {
  if (condition) console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`);
  else { failures += 1; console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); }
}

function request(port, method, path, ip = '203.0.113.7') {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method, headers: { 'X-Forwarded-For': ip } },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let body = data;
          try { body = JSON.parse(data); } catch { /* keep raw */ }
          resolve({ status: res.statusCode, headers: res.headers, body });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  console.log('\n═══ Integration verification (server.js + Redis) ═══\n');

  // In-memory Mongo so the /healthz db ping has something real to talk to.
  console.log('  ⏳ starting in-memory MongoDB…');
  const mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri('toletpro_verify');
  await mongoose.connect(process.env.MONGO_URI);

  // Requiring server.js does NOT call start() (it guards on require.main), so
  // no cron jobs and no Socket.IO are started here.
  const app = require('../server');
  const cache = require('../config/redis');
  const { resetLimit } = require('../middleware/advancedRateLimiter');

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  for (let i = 0; i < 20 && !cache.isReady(); i += 1) await sleep(100);

  // ── /healthz ─────────────────────────────────────────────────────────────
  console.log('\n1) GET /healthz');
  const health = await request(port, 'GET', '/healthz');
  check('returns 200', health.status === 200, String(health.status));
  check('ok = true', health.body.ok === true);
  check('db reports connected', health.body.db === 'connected', health.body.db);
  check('redis reports connected', health.body.redis === 'connected', health.body.redis);
  check('cacheStats present with hitRate',
    health.body.cacheStats && typeof health.body.cacheStats.hitRate === 'string',
    JSON.stringify(health.body.cacheStats));
  check('uptime present', typeof health.body.uptime === 'number', String(health.body.uptime));
  check('socketAdapter key present', 'socketAdapter' in health.body, String(health.body.socketAdapter));
  console.log(`     → ${JSON.stringify(health.body)}`);

  // ── Cache HIT / MISS through the manager ─────────────────────────────────
  console.log('\n2) Cache HIT / MISS (two identical reads)');
  await cache.clearAll();
  cache.resetStats();

  let dbHits = 0;
  const load = () => cache.getOrSet('itest:prop:1', 120, async () => {
    dbHits += 1;
    return { title: 'গুলশান অ্যাপার্টমেন্ট', rent: 45000 };
  });

  await load();
  const statsAfterFirst = cache.getStats();
  await load();
  const statsAfterSecond = cache.getStats();

  check('1st read = MISS', statsAfterFirst.misses === 1 && statsAfterFirst.hits === 0,
    `hits=${statsAfterFirst.hits} misses=${statsAfterFirst.misses}`);
  check('2nd read = HIT', statsAfterSecond.hits === 1,
    `hits=${statsAfterSecond.hits} misses=${statsAfterSecond.misses}`);
  check('DB loader ran exactly once', dbHits === 1, `dbHits=${dbHits}`);
  check('hitRate reflects 1/2', statsAfterSecond.hitRate === '50.00%', statsAfterSecond.hitRate);

  // The same numbers must be visible through the health endpoint.
  const health2 = await request(port, 'GET', '/healthz');
  check('/healthz surfaces the live cache stats',
    health2.body.cacheStats.hits === 1 && health2.body.cacheStats.misses === 1,
    JSON.stringify(health2.body.cacheStats));

  // ── Rate limiter on the real mounted route ───────────────────────────────
  console.log('\n3) Rate limiter on the mounted /api/auth route (15 login attempts)');
  await resetLimit('auth', '203.0.113.7');
  await resetLimit('api', '203.0.113.7');

  const codes = [];
  for (let i = 0; i < 15; i += 1) {
    // POST /api/auth/login with no body → validation failure (400/401), i.e. a
    // FAILED attempt, which is what the auth limiter is meant to count.
    const r = await request(port, 'POST', '/api/auth/login');
    codes.push(r.status);
    await sleep(20);
  }
  const blocked = codes.filter((c) => c === 429).length;
  check('429s appear within 15 attempts', blocked > 0, codes.join(','));
  check('first attempts were NOT rate-limited', codes[0] !== 429, String(codes[0]));

  const limited = await request(port, 'POST', '/api/auth/login');
  check('429 carries X-RateLimit-Limit', Boolean(limited.headers['x-ratelimit-limit']),
    limited.headers['x-ratelimit-limit']);
  check('429 carries X-RateLimit-Remaining', limited.headers['x-ratelimit-remaining'] === '0',
    limited.headers['x-ratelimit-remaining']);
  check('429 carries X-RateLimit-Reset', Boolean(limited.headers['x-ratelimit-reset']),
    limited.headers['x-ratelimit-reset']);
  check('429 body is Bengali with retryAfter',
    /[\u0980-\u09FF]/.test(limited.body.message || '') && typeof limited.body.retryAfter === 'number',
    JSON.stringify(limited.body));

  // ── Search limiter is GET-only ───────────────────────────────────────────
  console.log('\n4) Search limiter skips non-GET');
  await resetLimit('search', '203.0.113.9');
  const getRes = await request(port, 'GET', '/api/properties?limit=1', '203.0.113.9');
  check('GET /api/properties carries search headers (limit 120 for guests)',
    getRes.headers['x-ratelimit-limit'] === '120', getRes.headers['x-ratelimit-limit']);
  // A POST goes through the global api limiter instead, whose limit is 4500.
  const postRes = await request(port, 'POST', '/api/properties', '203.0.113.9');
  check('POST /api/properties falls to the global limiter, not search',
    postRes.headers['x-ratelimit-limit'] === '4500', postRes.headers['x-ratelimit-limit']);

  // ── Redis-down degradation ───────────────────────────────────────────────
  console.log('\n5) Redis down → app still serves (graceful degradation)');
  const realClient = cache.client;
  cache.client = null; // isReady() now false, exactly like a dropped connection
  const degraded = await request(port, 'GET', '/api/properties?limit=1', '203.0.113.11');
  check('property read still succeeds without Redis',
    degraded.status === 200, String(degraded.status));
  const degradedHealth = await request(port, 'GET', '/healthz');
  check('/healthz still 200 when Redis is down (Redis is not fatal)',
    degradedHealth.status === 200, String(degradedHealth.status));
  check('/healthz reports redis disconnected',
    degradedHealth.body.redis === 'disconnected', degradedHealth.body.redis);
  check('ok stays true — Mongo is what makes the app healthy',
    degradedHealth.body.ok === true);
  cache.client = realClient;

  // ── Cleanup ──────────────────────────────────────────────────────────────
  await cache.clearAll();
  await cache.disconnect();
  server.close();
  await mongoose.disconnect();
  await mongod.stop();

  console.log(
    failures === 0
      ? '\n═══ ✅ সব চেক পাস (all checks passed) ═══\n'
      : `\n═══ ❌ ${failures} check(s) failed ═══\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('\n💥 verification crashed:', err);
  process.exit(1);
});
