'use strict';

/**
 * scripts/verify-redis-cache.js — smoke test for config/redis.js
 *
 * Exercises all three caching strategies against a REAL Redis (no Mongo
 * needed — the "DB" is a stub counter, so a HIT is provable: the loader
 * simply must not run a second time).
 *
 * Usage:
 *   REDIS_URL=redis://127.0.0.1:6399 node scripts/verify-redis-cache.js
 */

const assert = require('assert');
const cache = require('../config/redis');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures += 1;
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

(async () => {
  console.log('\n═══ config/redis.js verification ═══\n');

  // Give ioredis a moment to finish its handshake.
  for (let i = 0; i < 20 && !cache.isReady(); i += 1) await sleep(100);

  console.log('1) Connection');
  check('enabled', cache.enabled === true);
  check('isReady()', cache.isReady() === true);
  check('ping()', (await cache.ping()) === 'connected');

  await cache.clearAll();
  cache.resetStats();

  // ── Strategy 1: Cache-Aside ──────────────────────────────────────────────
  console.log('\n2) Cache-Aside (getOrSet)');
  let dbCalls = 0;
  const loader = async () => { dbCalls += 1; return { id: 'p1', title: 'ধানমন্ডি ফ্ল্যাট', rent: 25000 }; };

  const first  = await cache.getOrSet(cache.KEY.property('p1'), cache.TTL.PROPERTY, loader);
  const second = await cache.getOrSet(cache.KEY.property('p1'), cache.TTL.PROPERTY, loader);

  check('1st call = MISS, hits DB', dbCalls === 1, `dbCalls=${dbCalls}`);
  check('2nd call = HIT, DB untouched', dbCalls === 1, `dbCalls=${dbCalls}`);
  check('values identical', JSON.stringify(first) === JSON.stringify(second));
  check('Bengali text survives round-trip', second.title === 'ধানমন্ডি ফ্ল্যাট', second.title);
  check('stats show 1 hit / 1 miss',
    cache.stats.hits === 1 && cache.stats.misses === 1,
    `hits=${cache.stats.hits} misses=${cache.stats.misses}`);

  // TTL must actually be applied (no immortal keys).
  const ttlLeft = await cache.client.ttl(cache.KEY.property('p1'));
  check('TTL applied via SETEX', ttlLeft > 0 && ttlLeft <= cache.TTL.PROPERTY, `${ttlLeft}s left`);

  // Null results must NOT be cached.
  let nullCalls = 0;
  await cache.getOrSet('missing:1', 60, async () => { nullCalls += 1; return null; });
  await cache.getOrSet('missing:1', 60, async () => { nullCalls += 1; return null; });
  check('null results are not cached', nullCalls === 2, `loaderCalls=${nullCalls}`);

  // ── Strategy 2: Write-Through ────────────────────────────────────────────
  console.log('\n3) Write-Through');
  let dbState = { name: 'পুরানো নাম' };
  const written = await cache.writeThrough(cache.KEY.me('u1'), cache.TTL.ME, async () => {
    dbState = { name: 'নতুন নাম' };
    return dbState;
  });
  check('writer result returned', written.name === 'নতুন নাম');
  check('DB updated first', dbState.name === 'নতুন নাম');
  const cachedMe = await cache.get(cache.KEY.me('u1'));
  check('cache holds the DB value', cachedMe && cachedMe.name === 'নতুন নাম', JSON.stringify(cachedMe));

  // A failing DB write must propagate AND leave the cache untouched.
  await cache.set(cache.KEY.me('u2'), { name: 'অপরিবর্তিত' }, 60);
  let threw = false;
  try {
    await cache.writeThrough(cache.KEY.me('u2'), 60, async () => { throw new Error('mongo down'); });
  } catch (e) { threw = e.message === 'mongo down'; }
  const survived = await cache.get(cache.KEY.me('u2'));
  check('DB error propagates', threw);
  check('cache untouched on DB error', survived && survived.name === 'অপরিবর্তিত');

  // ── Strategy 3: Write-Back ───────────────────────────────────────────────
  console.log('\n4) Write-Back + flushDirtyKeys');
  const viewKey = cache.KEY.viewCount('p1');
  await cache.incrementWriteBack(viewKey, cache.TTL.VIEW_COUNT);
  await cache.incrementWriteBack(viewKey, cache.TTL.VIEW_COUNT);
  const total = await cache.incrementWriteBack(viewKey, cache.TTL.VIEW_COUNT);
  check('atomic INCRBY counts 3 views', total === 3, `total=${total}`);
  check('key marked dirty', (await cache.dirtyCount()) === 1, `dirty=${await cache.dirtyCount()}`);

  const persisted = [];
  const flush = await cache.flushDirtyKeys(async (key, value) => { persisted.push([key, value]); });
  check('flushed 1 key', flush.flushed === 1, JSON.stringify(flush));
  check('flush handed value to writeFn', persisted.length === 1 && persisted[0][1] === 3,
    JSON.stringify(persisted));
  check('dirty set cleared after flush', (await cache.dirtyCount()) === 0);

  // At-least-once: a failing writeFn must LEAVE the key dirty for a retry.
  await cache.incrementWriteBack(viewKey, cache.TTL.VIEW_COUNT);
  const failedFlush = await cache.flushDirtyKeys(async () => { throw new Error('write failed'); });
  check('failed flush reported', failedFlush.failed === 1, JSON.stringify(failedFlush));
  check('key STILL dirty after failure (retry next tick)', (await cache.dirtyCount()) === 1);
  await cache.flushDirtyKeys(async () => {}); // clean up

  // ── Invalidation ─────────────────────────────────────────────────────────
  console.log('\n5) Invalidation');
  await cache.set(cache.KEY.search('h1'), [1], 120);
  await cache.set(cache.KEY.search('h2'), [2], 120);
  await cache.set(cache.KEY.featured('f1'), [3], 120);
  const wiped = await cache.invalidate('search:*');
  check('pattern invalidate removed both search keys', wiped === 2, `removed=${wiped}`);
  check('search:h1 gone', (await cache.get(cache.KEY.search('h1'))) === null);
  check('featured:f1 kept (different namespace)', (await cache.get(cache.KEY.featured('f1'))) !== null);

  const propWipe = await cache.invalidateProperty('p1');
  check('invalidateProperty cleared property + featured', propWipe >= 2, `removed=${propWipe}`);
  check('single-key del works', (await cache.del('nope:1')) === 0);

  // ── LFU + stats ──────────────────────────────────────────────────────────
  console.log('\n6) LFU tracking + stats');
  await cache.set('hot:1', 'x', 60);
  for (let i = 0; i < 5; i += 1) await cache.get('hot:1');
  await sleep(150); // frequency tracking is fire-and-forget
  const hot = await cache.getHotKeys(5);
  check('hot keys reported', hot.length > 0, JSON.stringify(hot.slice(0, 3)));
  check('hot:1 has >= 5 accesses',
    (hot.find((h) => h.key === 'hot:1')?.hits || 0) >= 5,
    JSON.stringify(hot.find((h) => h.key === 'hot:1')));

  const stats = cache.getStats();
  check('hitRate is a percentage string', /%$/.test(stats.hitRate), stats.hitRate);
  // Exactly 1 — the deliberate "write failed" flush above. Anything more means
  // a real Redis command failed somewhere in this script.
  check('only the intentional failure was counted as an error',
    stats.errors === 1, `errors=${stats.errors}`);

  const info = await cache.getInfo();
  check('INFO reports eviction policy', info.evictionPolicy === 'allkeys-lfu', info.evictionPolicy);

  // ── Cleanup ──────────────────────────────────────────────────────────────
  await cache.clearAll();
  await cache.disconnect();

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
