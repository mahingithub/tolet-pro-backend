'use strict';

/**
 * scripts/verify-cache-wiring.js — proves the controller/service caching works
 * AND that every invalidation path clears what it must.
 *
 * The caching half is easy to get right; the half that causes production bugs
 * is a missing invalidation, which fails silently — no error, just a listing or
 * a badge that is quietly wrong. So most of this file is invalidation tests:
 * write through the real service, then assert the cached read reflects it.
 *
 * Runs against a real Redis and a throwaway in-memory MongoDB. Nothing here
 * touches the production cluster.
 *
 * Usage:
 *   REDIS_URL=redis://127.0.0.1:6399 node scripts/verify-cache-wiring.js
 */

process.env.NODE_ENV = 'development';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

function check(label, condition, detail = '') {
  if (condition) console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`);
  else { failures += 1; console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); }
}

(async () => {
  console.log('\n═══ Controller / service cache wiring verification ═══\n');
  console.log('  ⏳ starting in-memory MongoDB…');
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('toletpro_cachewire'));

  const cache = require('../config/redis');
  const propertyService = require('../services/property.service');
  const notifService = require('../services/notification.service');
  const invalidate = require('../services/cacheInvalidation');
  const Property = require('../models/Property');
  const Notification = require('../models/Notification');

  for (let i = 0; i < 20 && !cache.isReady(); i += 1) await sleep(100);
  check('Redis ready (required)', cache.isReady());
  if (!cache.isReady()) process.exit(1);
  await cache.clearAll();

  // The free tier caps a host at ONE listing (assertWithinTierLimits), so each
  // property in this script gets its own owner.
  const newOwner = () => ({ _id: new mongoose.Types.ObjectId() });
  const owner = newOwner();

  const baseBody = {
    // ASCII title on purpose: models/Property.js slugify() strips every
    // non-ASCII character, so a purely Bengali title collapses to an empty slug
    // base and the model falls back to an id-derived suffix that never changes.
    // A real slug is needed to exercise the "title edit orphans the old slug
    // cache key" path in step 3. Bengali text is verified separately below.
    title: 'Dhanmondi 2 Bedroom Flat',
    division: 'dhaka',
    district: 'Dhaka',
    area: 'ধানমন্ডি',
    location: 'Road 5, Dhanmondi',
    type: 'flat',
    category: 'family',
    intent: 'rent',
    beds: 2,
    baths: 2,
    price: 25000,
    status: 'active',
  };

  // ── 1. Search cache-aside ────────────────────────────────────────────────
  console.log('\n1) listProperties — cache-aside (2 min TTL)');
  const created = await propertyService.createProperty({ body: baseBody, user: owner });
  const propId = String(created._id);
  const propSlug = created.slug;
  check('property created', Boolean(propId), `id=${propId} slug=${propSlug}`);

  cache.resetStats();
  const q = { page: 1, limit: 50, sort: 'newest' };
  const first = await propertyService.listProperties(q);
  const afterFirst = { ...cache.getStats() };
  const second = await propertyService.listProperties(q);
  const afterSecond = { ...cache.getStats() };

  check('1st search = MISS', afterFirst.misses === 1 && afterFirst.hits === 0,
    `hits=${afterFirst.hits} misses=${afterFirst.misses}`);
  check('2nd search = HIT', afterSecond.hits === 1,
    `hits=${afterSecond.hits} misses=${afterSecond.misses}`);
  check('both return the same result', first.total === second.total && second.total === 1,
    `total=${second.total}`);

  // Key normalisation: zod defaults mean these must all be ONE key.
  const h1 = invalidate.hashQuery({ page: 1, limit: 50, sort: 'newest' });
  const h2 = invalidate.hashQuery({ sort: 'newest', limit: 50, page: 1 });
  check('query hash is order-independent', h1 === h2, `${h1} === ${h2}`);
  check('different filters produce different keys',
    invalidate.hashQuery({ ...q, division: 'dhaka' }) !== h1);

  // ── 2. Detail cache-aside, id AND slug ───────────────────────────────────
  console.log('\n2) getPropertyById — cache-aside under BOTH id and slug');
  // The controller owns this cache, so exercise it the same way it does.
  const readDetail = (idOrSlug) => cache.getOrSet(
    cache.KEY.property(idOrSlug),
    cache.TTL.PROPERTY,
    async () => (await propertyService.getPropertyById(idOrSlug)).toJSON(),
  );

  cache.resetStats();
  const d1 = await readDetail(propId);
  const d2 = await readDetail(propId);
  check('1st detail read = MISS, 2nd = HIT',
    cache.getStats().misses === 1 && cache.getStats().hits === 1,
    `hits=${cache.getStats().hits} misses=${cache.getStats().misses}`);
  check('detail payload carries id + slug (needed for invalidation)',
    d2.id === propId && d2.slug === propSlug, `id=${d2.id} slug=${d2.slug}`);
  check('title survives the round-trip', d2.title === baseBody.title, d2.title);
  check('Bengali text survives the round-trip (area/location fields)',
    d2.area === 'ধানমন্ডি', d2.area);

  await readDetail(propSlug); // populate the slug-keyed entry too
  check('slug and id are separate cache entries (both must be invalidated)',
    (await cache.get(cache.KEY.property(propId))) !== null &&
    (await cache.get(cache.KEY.property(propSlug))) !== null);

  // ── 3. Update invalidates id + slug + search ─────────────────────────────
  console.log('\n3) updateProperty invalidates detail (id, old slug, new slug) + search');
  await propertyService.listProperties(q);            // warm search
  check('search warm before update', (await cache.get(cache.KEY.search(h1))) !== null);

  const updated = await propertyService.updateProperty({
    idOrSlug: propId,
    body: { title: 'Gulshan 3 Bedroom Duplex', price: 55000 },
    user: owner,
  });
  // Slugs are STABLE by design: models/Property.js builds one only when the
  // field is empty (`if (!this.slug)`), so renaming a listing keeps its original
  // URL. That means the slug-keyed cache entry must still be cleared on every
  // edit — it just never becomes an *orphaned* key.
  check('slug is stable across a title change (URLs stay valid)',
    updated.slug === propSlug, `${propSlug} → ${updated.slug}`);

  check('detail entry cleared (id)', (await cache.get(cache.KEY.property(propId))) === null);
  check('detail entry cleared (slug — the easy one to miss)',
    (await cache.get(cache.KEY.property(propSlug))) === null);
  check('search namespace cleared', (await cache.get(cache.KEY.search(h1))) === null);

  // And the re-read must show the new data, not the old.
  const afterUpdate = await readDetail(propId);
  check('re-read serves UPDATED price', afterUpdate.price === 55000, String(afterUpdate.price));
  const searchAfter = await propertyService.listProperties(q);
  check('search re-read serves UPDATED title',
    searchAfter.items[0].title === 'Gulshan 3 Bedroom Duplex', searchAfter.items[0].title);

  // ── 4. Status change must drop it from public search ─────────────────────
  console.log('\n4) status → paused removes the listing from cached search');
  await propertyService.listProperties(q); // warm
  await propertyService.updateProperty({
    idOrSlug: propId, body: { status: 'paused' }, user: owner,
  });
  const pausedSearch = await propertyService.listProperties(q);
  check('paused listing is gone from search immediately', pausedSearch.total === 0,
    `total=${pausedSearch.total}`);

  await propertyService.updateProperty({
    idOrSlug: propId, body: { status: 'active' }, user: owner,
  });
  const reactivated = await propertyService.listProperties(q);
  check('reactivated listing is back', reactivated.total === 1, `total=${reactivated.total}`);

  // ── 5. Unread count cache + invalidation ─────────────────────────────────
  console.log('\n5) countUnread — cache-aside (1 min TTL) + invalidation on emit/read');
  const userId = new mongoose.Types.ObjectId();
  const user = { _id: userId };

  cache.resetStats();
  const u0 = await notifService.countUnread({ user });
  const u0cached = await notifService.countUnread({ user });
  check('count starts at 0, 2nd call is a HIT',
    u0 === 0 && u0cached === 0 && cache.getStats().hits === 1,
    `hits=${cache.getStats().hits}`);

  await notifService.emit({
    userId, type: 'system', title: 'নতুন বার্তা', body: 'পরীক্ষা', skipPush: true,
  });
  const u1 = await notifService.countUnread({ user });
  check('emit() invalidated the badge → now 1', u1 === 1, String(u1));

  await notifService.emit({
    userId, type: 'system', title: 'দ্বিতীয়', body: 'পরীক্ষা', skipPush: true,
  });
  const u2 = await notifService.countUnread({ user });
  check('second emit → 2', u2 === 2, String(u2));

  await notifService.markAllRead({ user });
  const u3 = await notifService.countUnread({ user });
  check('markAllRead invalidated the badge → 0', u3 === 0, String(u3));

  // remove() of an UNREAD item must lower the count
  const fresh = await notifService.emit({
    userId, type: 'system', title: 'তৃতীয়', body: 'পরীক্ষা', skipPush: true,
  });
  check('badge back to 1 before delete', (await notifService.countUnread({ user })) === 1);
  await notifService.remove({ id: fresh._id, user });
  check('remove() of an unread item invalidated → 0',
    (await notifService.countUnread({ user })) === 0);

  // markRead on a single item
  const one = await notifService.emit({
    userId, type: 'system', title: 'চতুর্থ', body: 'পরীক্ষা', skipPush: true,
  });
  await notifService.countUnread({ user }); // cache it as 1
  await notifService.markRead({ id: one._id, user });
  check('markRead invalidated → 0', (await notifService.countUnread({ user })) === 0);

  // ── 6. Cascade delete clears OTHER users' badges ─────────────────────────
  console.log("\n6) purgePropertyCascade clears the unread badge of AFFECTED users");
  const tenantA = new mongoose.Types.ObjectId();
  const tenantB = new mongoose.Types.ObjectId();

  // Notifications that deep-link to the property, owned by two OTHER users.
  await Notification.create([
    { userId: tenantA, type: 'system', title: 'ক', body: '', data: { propertyId: created._id } },
    { userId: tenantB, type: 'system', title: 'খ', body: '', data: { propertyId: created._id } },
  ]);
  // Cache both badges as 1.
  check('tenantA badge cached as 1',
    (await notifService.countUnread({ user: { _id: tenantA } })) === 1);
  check('tenantB badge cached as 1',
    (await notifService.countUnread({ user: { _id: tenantB } })) === 1);

  const doc = await Property.findById(created._id);
  await propertyService.purgePropertyCascade(doc);

  check('tenantA badge invalidated by the cascade → 0',
    (await notifService.countUnread({ user: { _id: tenantA } })) === 0);
  check('tenantB badge invalidated by the cascade → 0',
    (await notifService.countUnread({ user: { _id: tenantB } })) === 0);
  check('deleted property gone from cached search',
    (await propertyService.listProperties(q)).total === 0);
  check('deleted property detail entry cleared',
    (await cache.get(cache.KEY.property(propId))) === null);

  // ── 7. Admin overview cache ──────────────────────────────────────────────
  console.log('\n7) admin overview — cache-aside (15 min TTL) + invalidation');
  const adminCtl = require('../controllers/admin.controller');
  const runOverview = () => new Promise((resolve, reject) => {
    adminCtl.getOverview(
      { user: { _id: new mongoose.Types.ObjectId() } },
      { json: (b) => resolve(b) },
      (e) => reject(e),
    );
  });

  cache.resetStats();
  const o1 = await runOverview();
  const o2 = await runOverview();
  check('1st overview = MISS, 2nd = HIT',
    cache.getStats().misses === 1 && cache.getStats().hits === 1,
    `hits=${cache.getStats().hits} misses=${cache.getStats().misses}`);
  check('overview returns the stats shape',
    o2.stats && typeof o2.stats.totalUsers === 'number' && 'monthlyRevenueFormatted' in o2.stats,
    JSON.stringify(o2.stats).slice(0, 90) + '…');
  const countBefore = o2.stats.totalProperties;

  // A new property must move the number after invalidation.
  await propertyService.createProperty({ body: baseBody, user: newOwner() });
  const o3 = await runOverview();
  check('createProperty invalidated the overview counts',
    o3.stats.totalProperties === countBefore + 1,
    `${countBefore} → ${o3.stats.totalProperties}`);

  await invalidate.onAdminStatsChanged();
  check('onAdminStatsChanged clears the key',
    (await cache.get(cache.KEY.adminStats('default'))) === null);

  // ── 8. View counter write-back → flushToDB ───────────────────────────────
  console.log('\n8) view counter — write-back, then flushed by server.js flushToDB');
  const viewOwner = newOwner();
  const viewProp = await propertyService.createProperty({ body: baseBody, user: viewOwner });
  const viewId = String(viewProp._id);
  await cache.incrementWriteBack(cache.KEY.viewCount(viewId), cache.TTL.VIEW_COUNT);
  await cache.incrementWriteBack(cache.KEY.viewCount(viewId), cache.TTL.VIEW_COUNT);
  const total = await cache.incrementWriteBack(cache.KEY.viewCount(viewId), cache.TTL.VIEW_COUNT);
  check('3 views counted atomically in Redis', total === 3, String(total));
  check('key marked dirty', (await cache.dirtyCount()) >= 1);

  // Use the REAL flushToDB from server.js, not a copy.
  const { flushToDB } = require('../server');
  check('server.js exports flushToDB', typeof flushToDB === 'function');
  const flushRes = await cache.flushDirtyKeys(flushToDB);
  check('flush persisted the counter', flushRes.flushed >= 1, JSON.stringify(flushRes));

  const persisted = await Property.findById(viewId).lean();
  check('viewCount written to MongoDB via $inc', persisted.viewCount === 3,
    `viewCount=${persisted.viewCount}`);
  check('dirty set drained', (await cache.dirtyCount()) === 0);

  // ── REGRESSION GUARD: the flush must DRAIN the counter ──────────────────
  // If a flush leaves the value in Redis, the next flush re-applies the whole
  // running total on top of what was already written and view counts inflate
  // without bound (3 → 8 → 21 …). These three checks pin that down.
  check('counter key was DRAINED by the flush (not left in Redis)',
    (await cache.get(cache.KEY.viewCount(viewId))) === null);

  await cache.incrementWriteBack(cache.KEY.viewCount(viewId), cache.TTL.VIEW_COUNT, 2);
  await cache.flushDirtyKeys(flushToDB);
  const persisted2 = await Property.findById(viewId).lean();
  check('second flush ADDS a delta, not the running total (3 + 2 = 5)',
    persisted2.viewCount === 5, `viewCount=${persisted2.viewCount}`);

  // A flush with nothing pending must be a no-op, not a re-apply.
  await cache.flushDirtyKeys(flushToDB);
  const persisted3 = await Property.findById(viewId).lean();
  check('an empty flush does not double-count', persisted3.viewCount === 5,
    `viewCount=${persisted3.viewCount}`);

  // ── Drain + failure: the delta must be restored, not lost ───────────────
  console.log('\n8b) a failing flush must PUT BACK the drained value');
  await cache.incrementWriteBack(cache.KEY.viewCount(viewId), cache.TTL.VIEW_COUNT, 7);
  const failed = await cache.flushDirtyKeys(async () => { throw new Error('mongo down'); });
  check('flush reported the failure', failed.failed === 1, JSON.stringify(failed));
  check('drained value was restored to Redis',
    (await cache.get(cache.KEY.viewCount(viewId))) === 7,
    String(await cache.get(cache.KEY.viewCount(viewId))));
  check('key is dirty again for the next tick', (await cache.dirtyCount()) >= 1);

  // The retry must then persist it exactly once.
  await cache.flushDirtyKeys(flushToDB);
  const persisted4 = await Property.findById(viewId).lean();
  check('retry persisted the restored delta exactly once (5 + 7 = 12)',
    persisted4.viewCount === 12, `viewCount=${persisted4.viewCount}`);

  // ── 9. Redis down → reads still work ─────────────────────────────────────
  console.log('\n9) Redis down → every cached read falls back to MongoDB');
  const realClient = cache.client;
  cache.client = null;
  const degradedSearch = await propertyService.listProperties(q);
  check('listProperties works without Redis', degradedSearch.total >= 1,
    `total=${degradedSearch.total}`);
  const degradedDetail = await propertyService.getPropertyById(viewId);
  check('getPropertyById works without Redis', String(degradedDetail._id) === viewId);
  const degradedUnread = await notifService.countUnread({ user });
  check('countUnread works without Redis', degradedUnread === 0, String(degradedUnread));
  const degradedOverview = await runOverview();
  check('admin overview works without Redis',
    typeof degradedOverview.stats.totalUsers === 'number');
  // Writes must not throw when invalidation can't reach Redis.
  const okWrite = await propertyService.updateProperty({
    idOrSlug: viewId, body: { price: 31000 }, user: viewOwner,
  });
  check('a write + its invalidation succeed with Redis down', okWrite.price === 31000);
  cache.client = realClient;

  // ── Cleanup ──────────────────────────────────────────────────────────────
  await cache.clearAll();
  await cache.disconnect();
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
