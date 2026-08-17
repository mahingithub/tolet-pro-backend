'use strict';

/**
 * services/cacheInvalidation.js — every cache-invalidation rule, in one file.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Caching is the easy half. The half that causes production bugs is
 * remembering to clear a key when the data behind it changes, and the failure
 * is silent: nothing errors, users just see a number or a listing that is
 * quietly wrong.
 *
 * So all of it lives here instead of being sprinkled across controllers. When
 * you add a cached read, add its invalidation rule to this file and call the
 * rule from the write path. That gives one place to audit the question "can
 * anything serve stale data?".
 *
 * ── RULES ────────────────────────────────────────────────────────────────
 * 1. Every function here is FIRE-AND-FORGET safe: it swallows its own errors.
 *    A failed invalidation must never fail the write that triggered it — the
 *    write already succeeded in Mongo, and rejecting the HTTP response would
 *    tell the user their edit failed when it didn't. The TTL is the safety net.
 * 2. Invalidation runs AFTER the DB write commits. Clearing first leaves a
 *    window where a concurrent read re-populates the cache from pre-write data.
 * 3. Prefer deleting a key over rewriting it. A delete is idempotent and a
 *    subsequent miss re-reads the truth; a rewrite can race another writer.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const crypto = require('crypto');
const cache = require('../config/redis');

/**
 * Stable short hash of a validated query object, used as the search cache key.
 *
 * Keys are SORTED before hashing so `?type=flat&division=dhaka` and
 * `?division=dhaka&type=flat` collapse to one entry instead of caching the
 * same result set twice.
 *
 * Hash the POST-validation object (zod `parsed.data`), never `req.query`: zod
 * applies defaults (page=1, limit=50, sort='newest') and strips unknown keys,
 * so `?`, `?page=1`, and `?featured=true` all normalise to the same shape —
 * and therefore the same key, which is what makes the hit rate worth having.
 */
function hashQuery(obj) {
  const sorted = {};
  for (const k of Object.keys(obj || {}).sort()) {
    if (obj[k] !== undefined) sorted[k] = obj[k];
  }
  return crypto.createHash('sha1').update(JSON.stringify(sorted)).digest('hex').slice(0, 16);
}

/** Swallow + log. Invalidation is best-effort by design (rule 1 above). */
async function safely(label, fn) {
  try {
    await fn();
  } catch (err) {
    console.warn(`[cache-invalidate] ${label} failed: ${err.message}`);
  }
}

/**
 * A property was created or edited.
 *
 * Clears the detail entry under EVERY identifier it is reachable by, because
 * GET /api/properties/:id resolves an ObjectId OR a slug
 * (services/property.service.js findIdOrSlug), so one property occupies two
 * cache keys.
 *
 * `prevSlug` is defensive. Slugs are currently STABLE: the model's
 * pre('validate') hook builds one only `if (!this.slug)` (models/Property.js),
 * so renaming a listing keeps its original slug and there is nothing to orphan.
 * The parameter exists so that if slug regeneration is ever switched on, the
 * old key is already being cleared instead of serving a stale listing until its
 * TTL runs out.
 *
 * @param {object} p
 * @param {string} p.id        the property's _id
 * @param {string} [p.slug]    its current slug
 * @param {string} [p.prevSlug] its slug BEFORE this edit, if it changed
 * @param {boolean} [p.affectsCounts] true when a create/delete/status change
 *                  moved one of the admin overview's Property buckets
 */
async function onPropertyChanged({ id, slug, prevSlug, affectsCounts = false } = {}) {
  await safely('onPropertyChanged', async () => {
    const keys = [id, slug, prevSlug]
      .filter(Boolean)
      .map((k) => cache.KEY.property(String(k)));

    await Promise.all([
      keys.length ? cache.del(keys) : Promise.resolve(0),
      // Any listing edit can change what a search page returns (price, status,
      // title, photos are all on the list card) and we cannot know which cached
      // query pages included this id — so the whole namespace goes.
      cache.invalidate('search:*'),
      affectsCounts ? onAdminStatsChanged() : Promise.resolve(0),
    ]);
  });
}

/**
 * A property was deleted (host delete, admin delete, or the rented-cleanup
 * cron). Same as onPropertyChanged plus the unread badges of everyone whose
 * notifications were cascade-deleted with it.
 *
 * @param {string[]} [affectedUserIds] users who lost notifications in the
 *        cascade. Collect these BEFORE the delete — afterwards the rows are
 *        gone and there is no way to work out who was affected.
 */
async function onPropertyDeleted({ id, slug, affectedUserIds = [] } = {}) {
  await Promise.all([
    onPropertyChanged({ id, slug, affectsCounts: true }),
    onUnreadChangedMany(affectedUserIds),
  ]);
}

/** One user's unread notification count changed. */
async function onUnreadChanged(userId) {
  if (!userId) return;
  await safely('onUnreadChanged', () => cache.del(cache.KEY.unread(String(userId))));
}

/**
 * Several users' unread counts changed (admin fan-out, cascade delete,
 * marketing blast).
 *
 * Above ~50 users, one pattern wipe beats 50 round-trips — and the notification
 * blast in services/marketing.service.js can target every user on the platform,
 * where building that key list would be slower than clearing the namespace.
 */
async function onUnreadChangedMany(userIds = []) {
  const unique = [...new Set(userIds.filter(Boolean).map(String))];
  if (unique.length === 0) return;

  await safely('onUnreadChangedMany', async () => {
    if (unique.length > 50) {
      await cache.invalidate('unread:*');
      return;
    }
    await cache.del(unique.map((id) => cache.KEY.unread(id)));
  });
}

/**
 * The admin dashboard's numbers moved.
 *
 * Called from the LOW-frequency, HIGH-visibility writes only — admin approve /
 * reject / ban / role change / delete, and property create/delete/status. The
 * counts are also moved by anonymous SellInterest posts and by cron jobs, and
 * chasing those is not worth it: the 15-minute TTL bounds that drift, while
 * these explicit calls make the dashboard update instantly for the actions an
 * admin just performed and is looking straight at.
 */
async function onAdminStatsChanged() {
  await safely('onAdminStatsChanged', () => cache.invalidate('admin:overview:*'));
}

/**
 * A user document changed. Currently a no-op for the profile cache because
 * GET /api/auth/me is deliberately NOT cached — middleware/requireAuth.js
 * already loads the full user document on every authenticated request, so
 * caching the response would add a Redis round-trip without removing the Mongo
 * read, and caching the requireAuth lookup itself would break ban enforcement
 * and session revocation.
 *
 * Kept as the designated hook so that if a `me:` cache is ever introduced,
 * there is one obvious place to wire it rather than 40 scattered call sites.
 * It DOES clear the user's unread badge, which is cached.
 */
async function onUserChanged(userId, { affectsCounts = false } = {}) {
  if (!userId) return;
  await safely('onUserChanged', async () => {
    await Promise.all([
      cache.invalidateUser(String(userId)),
      affectsCounts ? onAdminStatsChanged() : Promise.resolve(0),
    ]);
  });
}

module.exports = {
  hashQuery,
  onPropertyChanged,
  onPropertyDeleted,
  onUnreadChanged,
  onUnreadChangedMany,
  onAdminStatsChanged,
  onUserChanged,
};
