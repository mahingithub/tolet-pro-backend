'use strict';

/**
 * config/redis.js — CacheManager (Redis) for ToLet Pro
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A single shared Redis connection plus three caching strategies. Exported as
 * a SINGLETON (`module.exports = new CacheManager()`), so every route,
 * controller and service shares one connection pool — Render's Redis Starter
 * plan has a connection cap, and one client per module would burn through it.
 *
 * ── THE GOLDEN RULE ──────────────────────────────────────────────────────
 *   A CACHE FAILURE MUST NEVER BREAK A REQUEST.
 *
 * Every public method is wrapped so that a Redis timeout, a dropped socket, a
 * maxmemory error or a missing REDIS_URL all end up in the same place: we log
 * once, count it as a miss, and fall through to MongoDB. The app gets slower,
 * never broken. That is why `getOrSet()` takes the DB loader as an argument
 * instead of returning null and making 40 call sites remember to handle it.
 *
 * ── THE THREE STRATEGIES ─────────────────────────────────────────────────
 *
 *  1. CACHE-ASIDE (reads) — `getOrSet(key, ttl, dbLoader)`
 *     Redis first. HIT → return it. MISS → run dbLoader, store the result,
 *     return it. This is the right default for reads: the cache only ever
 *     holds data that was actually asked for, and an eviction is harmless.
 *
 *  2. WRITE-THROUGH (writes, consistency-first) — `writeThrough(key, ttl, fn)`
 *     Mongo FIRST, then the cache is refreshed with whatever Mongo returned.
 *     Slightly slower on write, but the cache can never hold a value the DB
 *     doesn't have. Use for anything a user sees immediately after saving
 *     (profile edits) or anything money/legal-adjacent.
 *
 *  3. WRITE-BACK (writes, speed-first) — `writeBack(key, ttl, value)`
 *     Redis only; the key is added to a "dirty" set and flushed to Mongo later
 *     by `flushDirtyKeys()` (server.js runs it every 10 min + on shutdown).
 *     Use ONLY for data you can afford to lose a few minutes of — view
 *     counters being the canonical example. Never for money, bookings or auth.
 *
 * ── EVICTION ─────────────────────────────────────────────────────────────
 * Redis itself is configured `allkeys-lfu` in the Render dashboard, so Redis
 * decides what to drop when memory fills. We ALSO keep our own LFU frequency
 * counters in a sorted set so `getHotKeys()` can answer "what is actually
 * worth caching?" — that's observability for tuning TTLs, not eviction logic.
 * The sorted set is trimmed so the bookkeeping can't outgrow the cache.
 *
 * ── TTL ──────────────────────────────────────────────────────────────────
 * Every key gets an expiry via SETEX. There are no immortal keys: a bug in an
 * invalidation path then costs one TTL window of staleness, not forever.
 * Presets live in `CacheManager.TTL` / `cache.TTL`.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const env = require('./env');

// ─── TTL presets (seconds) ──────────────────────────────────────────────────
// Named so call sites read as intent, not magic numbers. Values mirror the
// agreed cache plan; tune here in one place.
const TTL = Object.freeze({
  SEARCH:        2 * 60,   // GET /api/properties (search)         — 2 min
  PROPERTY:     10 * 60,   // GET /api/properties/:id              — 10 min
  FEATURED:     30 * 60,   // GET /api/properties?featured=true    — 30 min
  ME:           15 * 60,   // GET/PATCH /api/auth/me               — 15 min
  VIEW_COUNT:   10 * 60,   // property view counter (write-back)   — 10 min
  ADMIN_STATS:  15 * 60,   // GET /api/admin/overview              — 15 min
  UNREAD:            60,   // GET /api/notifications/unread-count  — 1 min
  SHORT:             30,
  DEFAULT:       5 * 60,
});

// ─── Key namespaces ─────────────────────────────────────────────────────────
// Structured `ns:subject` keys are what make pattern invalidation possible:
// editing property X can wipe `search:*` without knowing which searches
// happened to include it. Keep every key building here — hand-rolled strings
// at call sites are how invalidation silently rots.
const KEY = Object.freeze({
  search:      (hash)  => `search:${hash}`,
  property:    (id)    => `property:${id}`,
  featured:    (hash)  => `featured:${hash || 'all'}`,
  me:          (uid)   => `me:${uid}`,
  viewCount:   (id)    => `views:${id}`,
  adminStats:  (scope) => `admin:overview:${scope || 'default'}`,
  unread:      (uid)   => `unread:${uid}`,
});

// Internal bookkeeping keys (not user data).
const FREQ_ZSET   = '__lfu:freq';   // sorted set: key → access count
const DIRTY_SET   = '__wb:dirty';   // set of write-back keys pending a DB flush
const FREQ_MAX    = 5000;           // cap the frequency index size
const OP_TIMEOUT  = 1500;           // ms — a slow cache must not slow the request

class CacheManager {
  constructor() {
    /** @type {import('ioredis').Redis|null} */
    this.client = null;
    this.connected = false;
    this.enabled = env.useRedis;

    // Observability. `errors` counts cache failures that fell back to Mongo —
    // if this climbs in production, Redis is unhealthy even though /healthz
    // may still ping fine.
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      writeThrough: 0,
      writeBack: 0,
      flushed: 0,
      invalidations: 0,
      errors: 0,
      startedAt: new Date(),
    };

    // Log noisy connection errors at most once every 30s so a Redis outage
    // can't flood the Render log (and the log-based billing with it).
    this._lastErrorLog = 0;
    // …but let the FIRST connection failure through unconditionally — see
    // _logError(). That one carries the diagnosis.
    this._loggedFirstConnError = false;
    /** @type {{label:string,code:string|null,message:string,at:string}|null} */
    this.lastError = null;

    this.TTL = TTL;
    this.KEY = KEY;

    if (this.enabled) this.connect();
  }

  // ───────────────────────────────────────────────────────────────────────
  //  Connection
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Open the shared connection. Safe to call twice (no-ops if a client
   * exists). Never throws: a bad URL is a degraded cache, not a dead server.
   */
  connect() {
    if (!this.enabled || this.client) return this.client;

    let Redis;
    try {
      Redis = require('ioredis');
    } catch {
      console.warn('[cache] ioredis not installed — caching disabled.');
      this.enabled = false;
      return null;
    }

    try {
      this.client = new Redis(env.redisUrl, {
        keyPrefix: `${env.redisKeyPrefix}:cache:`,

        // Bounded retry. Render's Redis occasionally blips during a deploy; we
        // want a few quick reconnects, then a slow steady beat rather than a
        // tight loop hammering a dead host.
        retryStrategy: (times) => Math.min(times * 200, 5000),

        // Cap queued commands while disconnected. Without this, a long outage
        // buffers every request's cache call in memory until the dyno OOMs.
        maxRetriesPerRequest: 2,
        enableOfflineQueue: false,

        connectTimeout: 10_000,
        // Keep the TCP connection warm — Render idles out silent sockets.
        keepAlive: 30_000,

        // rediss:// (TLS) is what Render hands out for external URLs.
        ...(env.redisUrl.startsWith('rediss://') ? { tls: {} } : {}),
      });

      this.client.on('connect', () => {
        this.connected = true;
        console.log('[cache] Redis connected');
      });
      this.client.on('ready', () => { this.connected = true; });
      this.client.on('end', () => {
        this.connected = false;
        console.warn('[cache] Redis connection closed — falling back to DB reads.');
      });
      this.client.on('error', (err) => {
        this.connected = false;
        this._logError('connection', err);
      });
    } catch (err) {
      this.enabled = false;
      this.client = null;
      console.warn('[cache] Redis init failed, caching disabled:', err.message);
    }

    return this.client;
  }

  /** True when a command has a real chance of succeeding. */
  isReady() {
    return Boolean(
      this.enabled && this.client && (this.client.status === 'ready' || this.connected)
    );
  }

  /**
   * Close the connection (graceful shutdown). Flushes nothing — call
   * `flushDirtyKeys()` first if you care about pending write-back data.
   */
  async disconnect() {
    if (!this.client) return;
    try {
      await this.client.quit();
      console.log('[cache] Redis disconnected cleanly');
    } catch {
      try { this.client.disconnect(); } catch { /* already gone */ }
    } finally {
      this.client = null;
      this.connected = false;
    }
  }

  /** PING for /healthz. Returns 'connected' | 'disconnected' | 'disabled'. */
  async ping() {
    if (!this.enabled) return 'disabled';
    if (!this.client) return 'disconnected';
    try {
      const pong = await this._withTimeout(this.client.ping(), 'ping');
      return pong === 'PONG' ? 'connected' : 'disconnected';
    } catch {
      return 'disconnected';
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  //  Strategy 1 — CACHE-ASIDE (reads)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Read-through helper. THE method to use for GET endpoints.
   *
   *   const data = await cache.getOrSet(
   *     cache.KEY.property(id),
   *     cache.TTL.PROPERTY,
   *     () => Property.findById(id).lean(),
   *   );
   *
   * @param {string}   key      cache key (build it with `cache.KEY.*`)
   * @param {number}   ttl      seconds until expiry
   * @param {Function} dbLoader async () => value — runs only on a MISS
   * @returns {Promise<*>} cached value, or the loader's result
   */
  async getOrSet(key, ttl, dbLoader) {
    if (typeof dbLoader !== 'function') {
      throw new TypeError('cache.getOrSet: dbLoader must be a function');
    }

    const cached = await this.get(key);
    if (cached !== undefined && cached !== null) return cached;

    // MISS (or cache unavailable) → the DB is the source of truth. An error
    // here is a REAL error and propagates: the caller asked for data we can't
    // produce.
    const fresh = await dbLoader();

    // Don't cache empty results — a 404 shouldn't be sticky for 10 minutes,
    // and caching `null` makes "was it a miss or a cached null?" ambiguous.
    if (fresh !== undefined && fresh !== null) {
      await this.set(key, fresh, ttl);
    }
    return fresh;
  }

  /**
   * Raw GET. Returns `null` on miss OR on any cache failure — callers that
   * need to distinguish should use `getOrSet`.
   */
  async get(key) {
    if (!this.isReady()) {
      this.stats.misses += 1;
      return null;
    }
    try {
      const raw = await this._withTimeout(this.client.get(key), `get ${key}`);
      if (raw === null || raw === undefined) {
        this.stats.misses += 1;
        return null;
      }
      this.stats.hits += 1;
      this._trackFrequency(key); // fire-and-forget LFU bookkeeping
      return this._deserialize(raw);
    } catch (err) {
      this.stats.misses += 1;
      this.stats.errors += 1;
      this._logError(`get ${key}`, err);
      return null;
    }
  }

  /**
   * Raw SET with a mandatory TTL (SETEX). Returns true when stored.
   * A failure is swallowed — an uncached write is a performance problem, not a
   * correctness one.
   */
  async set(key, value, ttl = TTL.DEFAULT) {
    if (!this.isReady()) return false;
    try {
      const payload = this._serialize(value);
      // Guard against a single pathological document filling the 25 MB plan.
      if (payload.length > 1_000_000) {
        console.warn(`[cache] skip ${key} — payload ${payload.length}B exceeds 1MB cap`);
        return false;
      }
      const seconds = Math.max(1, Math.floor(Number(ttl) || TTL.DEFAULT));
      await this._withTimeout(this.client.setex(key, seconds, payload), `set ${key}`);
      this.stats.sets += 1;
      this._trackFrequency(key);
      return true;
    } catch (err) {
      this.stats.errors += 1;
      this._logError(`set ${key}`, err);
      return false;
    }
  }

  /**
   * Fetch many keys at once (MGET). Returns an array aligned with `keys`,
   * `null` where a key missed. Useful for list endpoints that hydrate N ids.
   */
  async mget(keys = []) {
    if (!this.isReady() || keys.length === 0) {
      this.stats.misses += keys.length;
      return keys.map(() => null);
    }
    try {
      const raws = await this._withTimeout(this.client.mget(keys), 'mget');
      return raws.map((raw, i) => {
        if (raw === null || raw === undefined) {
          this.stats.misses += 1;
          return null;
        }
        this.stats.hits += 1;
        this._trackFrequency(keys[i]);
        return this._deserialize(raw);
      });
    } catch (err) {
      this.stats.misses += keys.length;
      this.stats.errors += 1;
      this._logError('mget', err);
      return keys.map(() => null);
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  //  Strategy 2 — WRITE-THROUGH (consistency first)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * DB first, cache second.
   *
   *   const user = await cache.writeThrough(
   *     cache.KEY.me(userId),
   *     cache.TTL.ME,
   *     () => User.findByIdAndUpdate(userId, patch, { new: true }).lean(),
   *   );
   *
   * If `dbWriter` throws, the error propagates untouched (the write genuinely
   * failed) and the cache is left alone. If the DB write succeeds but the
   * cache update fails, we DELETE the key rather than leave a stale value —
   * a miss is always safer than a lie.
   *
   * @param {string}   key
   * @param {number}   ttl      seconds
   * @param {Function} dbWriter async () => freshValue (should return the saved doc)
   */
  async writeThrough(key, ttl, dbWriter) {
    if (typeof dbWriter !== 'function') {
      throw new TypeError('cache.writeThrough: dbWriter must be a function');
    }

    // 1. Source of truth first. Never caught — a failed write must surface.
    const fresh = await dbWriter();

    // 2. Then bring the cache in line with what the DB now holds.
    this.stats.writeThrough += 1;
    if (fresh === undefined || fresh === null) {
      await this.del(key); // writer returned nothing → don't guess, invalidate
      return fresh;
    }
    const ok = await this.set(key, fresh, ttl);
    if (!ok) await this.del(key); // couldn't refresh → make sure it's not stale

    return fresh;
  }

  // ───────────────────────────────────────────────────────────────────────
  //  Strategy 3 — WRITE-BACK (speed first, eventual consistency)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Cache-only write; Mongo catches up on the next flush.
   *
   * The request pays one Redis round-trip instead of a Mongo write, which is
   * the whole point for hot counters. The trade-off is explicit: if Redis dies
   * between two flushes, that window of increments is gone. Only use where
   * losing a few minutes of data is acceptable.
   *
   * @param {string} key
   * @param {number} ttl   seconds — must outlive the flush interval, or the
   *                       value can expire before it is ever persisted.
   * @param {*}      value
   */
  async writeBack(key, ttl, value) {
    if (!this.isReady()) return false;
    try {
      const seconds = Math.max(1, Math.floor(Number(ttl) || TTL.DEFAULT));
      await this._withTimeout(
        this.client
          .multi()
          .setex(key, seconds, this._serialize(value))
          .sadd(DIRTY_SET, key)
          .exec(),
        `writeBack ${key}`,
      );
      this.stats.writeBack += 1;
      this._trackFrequency(key);
      return true;
    } catch (err) {
      this.stats.errors += 1;
      this._logError(`writeBack ${key}`, err);
      return false;
    }
  }

  /**
   * Atomic counter for the view-count case: INCRBY in Redis, mark dirty, and
   * (re)arm the TTL. Returns the running total, or null when Redis is down so
   * the caller can decide whether to write straight to Mongo.
   *
   * Atomicity matters here — two concurrent viewers doing get→+1→set would
   * lose an increment; INCRBY cannot.
   */
  async incrementWriteBack(key, ttl = TTL.VIEW_COUNT, by = 1) {
    if (!this.isReady()) return null;
    try {
      const results = await this._withTimeout(
        this.client
          .multi()
          .incrby(key, by)
          .expire(key, Math.max(1, Math.floor(Number(ttl) || TTL.VIEW_COUNT)))
          .sadd(DIRTY_SET, key)
          .exec(),
        `incr ${key}`,
      );
      this.stats.writeBack += 1;
      // ioredis multi → [[err, value], ...]
      const total = results && results[0] ? Number(results[0][1]) : null;
      return Number.isFinite(total) ? total : null;
    } catch (err) {
      this.stats.errors += 1;
      this._logError(`incrementWriteBack ${key}`, err);
      return null;
    }
  }

  /**
   * Persist every pending write-back key to MongoDB, DRAINING each one.
   *
   * Called on an interval from server.js and once during graceful shutdown.
   *
   * ── WHY DRAIN (GET + DEL, ATOMICALLY) ───────────────────────────────────
   * Write-back keys are ACCUMULATORS: `incrementWriteBack` counts how much has
   * happened SINCE THE LAST FLUSH, and `flushToDB` applies it with `$inc`. If a
   * flush left the value in place, the next flush would re-apply the whole
   * running total on top of what was already written — 3 views became 3, then
   * 3+5=8, then 8+13… inflating without bound every 10 minutes. So taking the
   * value and clearing the key must be one atomic step, or increments landing
   * between the read and the clear are silently dropped.
   *
   * ── AT-LEAST-ONCE, PRESERVED ────────────────────────────────────────────
   * Draining before the DB write means a `writeFn` failure would lose the value,
   * so on failure it is PUT BACK (re-incremented and re-marked dirty) for the
   * next tick to retry. Net effect: on success, exactly-once; on failure, the
   * delta survives and is retried. The only loss window is a hard process kill
   * between the drain and the restore.
   *
   * @param {Function} writeFn async (key, value) => void — persists ONE key.
   * @returns {Promise<{flushed:number, failed:number, skipped:number}>}
   */
  async flushDirtyKeys(writeFn) {
    const result = { flushed: 0, failed: 0, skipped: 0 };
    if (!this.isReady() || typeof writeFn !== 'function') return result;

    let keys;
    try {
      keys = await this._withTimeout(this.client.smembers(DIRTY_SET), 'smembers dirty');
    } catch (err) {
      this.stats.errors += 1;
      this._logError('flushDirtyKeys/smembers', err);
      return result;
    }
    if (!keys || keys.length === 0) return result;

    for (const key of keys) {
      let value;
      let ttlLeft = TTL.VIEW_COUNT;
      try {
        // ── Drain: take the value and clear the key in ONE atomic step ─────
        // TTL is captured first so a restore can re-arm a comparable expiry.
        const res = await this._withTimeout(
          this.client.multi().ttl(key).get(key).del(key).srem(DIRTY_SET, key).exec(),
          `flush drain ${key}`,
        );
        // ioredis multi → [[err, value], ...] in command order.
        const rawTtl = res && res[0] ? Number(res[0][1]) : -1;
        if (rawTtl > 0) ttlLeft = rawTtl;
        const raw = res && res[1] ? res[1][1] : null;

        if (raw === null || raw === undefined) {
          // Expired or evicted before we reached it. Nothing to persist, and
          // it is already out of the dirty set — keeping it would retry forever.
          result.skipped += 1;
          continue;
        }
        value = this._deserialize(raw);

        await writeFn(key, value);

        result.flushed += 1;
        this.stats.flushed += 1;
      } catch (err) {
        result.failed += 1;
        this.stats.errors += 1;
        console.warn(`[cache] flush failed for ${key}: ${err.message}`);

        // ── Restore, so the delta isn't lost ──────────────────────────────
        // The key was already drained above, so without this the value is gone.
        // INCRBY (not SET) for numbers, because increments may have landed on
        // the now-recreated key while writeFn was running — adding the drained
        // amount back preserves those too.
        if (value !== undefined && value !== null) {
          try {
            const isNumber = typeof value === 'number' && Number.isFinite(value);
            const restore = this.client.multi();
            if (isNumber) {
              restore.incrby(key, value).expire(key, ttlLeft);
            } else {
              restore.setex(key, ttlLeft, this._serialize(value));
            }
            await restore.sadd(DIRTY_SET, key).exec();
          } catch (restoreErr) {
            // Nothing further we can do; the delta is lost. Log loudly — this
            // is the one path in the cache layer that loses data.
            console.error(
              `[cache] CRITICAL: could not restore drained key ${key} after a ` +
              `failed flush — ${String(value)} lost: ${restoreErr.message}`,
            );
          }
        }
      }
    }

    if (result.flushed || result.failed) {
      console.log(
        `[cache] write-back flush → ${result.flushed} written, ` +
        `${result.failed} failed, ${result.skipped} expired`
      );
    }
    return result;
  }

  /** How many write-back keys are waiting to be persisted (for /healthz). */
  async dirtyCount() {
    if (!this.isReady()) return 0;
    try {
      return await this._withTimeout(this.client.scard(DIRTY_SET), 'scard dirty');
    } catch {
      return 0;
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  //  Invalidation
  // ───────────────────────────────────────────────────────────────────────

  /** Delete one or more exact keys. */
  async del(...keys) {
    const flat = keys.flat().filter(Boolean);
    if (!this.isReady() || flat.length === 0) return 0;
    try {
      const n = await this._withTimeout(this.client.del(...flat), 'del');
      this.stats.invalidations += n;
      if (flat.length) this.client.zrem(FREQ_ZSET, ...flat).catch(() => {});
      return n;
    } catch (err) {
      this.stats.errors += 1;
      this._logError('del', err);
      return 0;
    }
  }

  /**
   * Pattern invalidation, e.g. `invalidate('search:*')` after a listing edit.
   *
   * Uses SCAN, not KEYS. KEYS is O(N) over the entire keyspace and blocks the
   * single-threaded Redis server for the whole scan — on a shared instance
   * that stalls every other request, including the rate limiter. SCAN walks in
   * cursor-sized chunks and yields between them.
   *
   * NOTE: `pattern` is relative to the configured keyPrefix, so callers write
   * `search:*`, not `toletpro:cache:search:*`.
   */
  async invalidate(pattern) {
    if (!this.isReady() || !pattern) return 0;

    const prefix = `${env.redisKeyPrefix}:cache:`;
    const match = pattern.startsWith(prefix) ? pattern : `${prefix}${pattern}`;
    let cursor = '0';
    let removed = 0;

    try {
      do {
        // SCAN returns FULL keys (prefix included) — ioredis does not strip the
        // keyPrefix on replies. DEL, however, re-applies the prefix, so the
        // raw keys must be unprefixed again before deleting. Getting this
        // backwards silently deletes nothing, which is why it's spelled out.
        const [next, found] = await this._withTimeout(
          this.client.scan(cursor, 'MATCH', match, 'COUNT', 200),
          'scan',
        );
        cursor = next;

        if (found && found.length) {
          const bare = found.map((k) => (k.startsWith(prefix) ? k.slice(prefix.length) : k));
          removed += await this.client.del(...bare);
          this.client.zrem(FREQ_ZSET, ...bare).catch(() => {});
        }
      } while (cursor !== '0');

      this.stats.invalidations += removed;
      if (removed) console.log(`[cache] invalidated ${removed} key(s) matching "${pattern}"`);
      return removed;
    } catch (err) {
      this.stats.errors += 1;
      this._logError(`invalidate ${pattern}`, err);
      return removed;
    }
  }

  /**
   * Convenience: wipe everything derived from one property. Called after
   * create / update / delete / status change so a stale listing can't linger.
   * Search + featured lists are pattern-wiped because we can't know which
   * query results happened to include this id.
   */
  async invalidateProperty(propertyId) {
    const jobs = [this.invalidate('search:*'), this.invalidate('featured:*')];
    if (propertyId) jobs.push(this.del(KEY.property(propertyId)));
    const counts = await Promise.all(jobs);
    return counts.reduce((a, b) => a + b, 0);
  }

  /** Convenience: wipe a user's own cached surfaces (profile + unread badge). */
  async invalidateUser(userId) {
    if (!userId) return 0;
    return this.del(KEY.me(userId), KEY.unread(userId));
  }

  /**
   * Drop every key this app owns (prefix-scoped). Deliberately NOT `FLUSHALL`
   * — on a shared Redis that would nuke other environments' data too.
   */
  async clearAll() {
    return this.invalidate('*');
  }

  // ───────────────────────────────────────────────────────────────────────
  //  LFU frequency tracking + stats
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Bump a key's access counter. Fire-and-forget: this is bookkeeping, so it
   * must never add latency to (or fail) the request that triggered it.
   *
   * Redis handles actual eviction (`allkeys-lfu`); this sorted set exists so we
   * can SEE the access distribution and tune TTLs from real traffic.
   */
  _trackFrequency(key) {
    if (!this.isReady()) return;
    this.client
      .zincrby(FREQ_ZSET, 1, key)
      .then(() => {
        // Trim occasionally (~1% of writes) so the index stays bounded without
        // paying for a ZREMRANGEBYRANK on every single access.
        if (Math.random() < 0.01) {
          return this.client.zremrangebyrank(FREQ_ZSET, 0, -(FREQ_MAX + 1));
        }
      })
      .catch(() => { /* bookkeeping only — swallow */ });
  }

  /** Most-accessed keys, hottest first. Tuning aid for TTLs. */
  async getHotKeys(limit = 20) {
    if (!this.isReady()) return [];
    try {
      const rows = await this._withTimeout(
        this.client.zrevrange(FREQ_ZSET, 0, Math.max(0, limit - 1), 'WITHSCORES'),
        'zrevrange',
      );
      const out = [];
      for (let i = 0; i < rows.length; i += 2) {
        out.push({ key: rows[i], hits: Number(rows[i + 1]) });
      }
      return out;
    } catch {
      return [];
    }
  }

  /**
   * Cache counters + derived hit rate. Cheap and synchronous — safe to call
   * from /healthz on every probe.
   */
  getStats() {
    const { hits, misses } = this.stats;
    const total = hits + misses;
    return {
      ...this.stats,
      total,
      hitRate: total === 0 ? '0.00%' : `${((hits / total) * 100).toFixed(2)}%`,
      hitRateRaw: total === 0 ? 0 : Number((hits / total).toFixed(4)),
      enabled: this.enabled,
      connected: this.isReady(),
    };
  }

  /** Zero the counters (e.g. after a deploy) without touching cached data. */
  resetStats() {
    this.stats.hits = 0;
    this.stats.misses = 0;
    this.stats.sets = 0;
    this.stats.writeThrough = 0;
    this.stats.writeBack = 0;
    this.stats.flushed = 0;
    this.stats.invalidations = 0;
    this.stats.errors = 0;
    this.stats.startedAt = new Date();
  }

  /** Redis INFO memory/keyspace, for an admin diagnostics screen. */
  async getInfo() {
    if (!this.isReady()) return { available: false };
    try {
      const info = await this._withTimeout(this.client.info('memory'), 'info');
      const pick = (field) => {
        const m = info.match(new RegExp(`${field}:(.+)`));
        return m ? m[1].trim() : null;
      };
      return {
        available: true,
        usedMemory: pick('used_memory_human'),
        peakMemory: pick('used_memory_peak_human'),
        maxMemory: pick('maxmemory_human'),
        evictionPolicy: pick('maxmemory_policy'),
        dirtyKeys: await this.dirtyCount(),
      };
    } catch {
      return { available: false };
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  //  Internals
  // ───────────────────────────────────────────────────────────────────────

  _serialize(value) {
    return JSON.stringify(value);
  }

  /**
   * Parse a cached payload. Plain integers come back from INCRBY as bare
   * strings (not JSON), so fall back to the raw string instead of throwing.
   */
  _deserialize(raw) {
    try {
      return JSON.parse(raw);
    } catch {
      const n = Number(raw);
      return Number.isFinite(n) && raw.trim() !== '' ? n : raw;
    }
  }

  /**
   * Race a Redis command against a deadline.
   *
   * Without this, a half-open socket (common when a mobile-facing dyno's
   * network path flaps) leaves the promise pending and the HTTP request hangs
   * until the client gives up — strictly worse than not caching at all.
   */
  _withTimeout(promise, label, ms = OP_TIMEOUT) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`redis timeout (${label})`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  /** Rate-limited error logging so an outage can't flood the logs. */
  _logError(label, err) {
    // Always REMEMBER the most recent failure, even when we don't log it.
    // The rate limit below exists to protect the log bill, but it was also
    // hiding the cause: a Redis that never connects logs once, thirty seconds
    // into a deploy, and then goes quiet forever while /healthz reports a bare
    // "disconnected" with no reason. Keeping the last error costs nothing and
    // is what `diagnose()` reports.
    this.lastError = {
      label,
      code: err.code || err.errno || null,
      message: err.message,
      at: new Date().toISOString(),
    };

    // The FIRST connection failure is logged unconditionally, with the
    // actionable hint, because that is the one that explains the other
    // thousand. Subsequent ones stay rate-limited.
    if (label === 'connection' && !this._loggedFirstConnError) {
      this._loggedFirstConnError = true;
      const d = this.diagnose();
      console.error(
        `[cache] REDIS UNREACHABLE — cache is bypassed, every read goes to MongoDB.\n` +
        `        target : ${d.target}\n` +
        `        error  : ${d.code || 'unknown'} — ${err.message}\n` +
        `        likely : ${d.hint}`,
      );
      return;
    }

    const now = Date.now();
    if (now - this._lastErrorLog < 30_000) return;
    this._lastErrorLog = now;
    console.warn(`[cache] ${label} failed: ${err.message} (falling back to DB)`);
  }

  /**
   * Why is the cache down? Safe to expose on /healthz.
   *
   * Returns the error CODE and a plain-language hint, never the URL's
   * credentials — /healthz is unauthenticated, so the password and the full
   * internal hostname must not appear in it. The host is redacted to its first
   * and last few characters, which is enough to tell two Redis instances apart
   * without publishing the address of either.
   */
  diagnose() {
    const code = this.lastError?.code || null;

    // Each of these is a different fix, and telling them apart by hand means
    // reading ioredis stack traces. Map them once, here.
    const HINTS = {
      ENOTFOUND:
        'hostname does not resolve. On Render an INTERNAL Key Value hostname '
        + '(red-xxxx, no domain) only resolves from the SAME REGION — check that the '
        + 'web service and the Key Value instance are both in the same one, or switch '
        + 'REDIS_URL to the External URL (rediss://…render.com:6379).',
      EAI_AGAIN: 'DNS lookup failed temporarily — usually the same region mismatch as ENOTFOUND.',
      ECONNREFUSED: 'host resolves but nothing is listening on that port — check the port in REDIS_URL.',
      ETIMEDOUT: 'connection timed out — usually a firewall or a cross-region internal URL.',
      ECONNRESET: 'connection dropped by the server — often a plain redis:// URL against a TLS-only endpoint (try rediss://).',
      NOAUTH: 'server wants a password and REDIS_URL has none.',
      WRONGPASS: 'password in REDIS_URL is wrong (it rotates when the instance is recreated).',
      ERR_SSL_WRONG_VERSION_NUMBER: 'TLS mismatch — the endpoint expects rediss:// (TLS), or expects plain redis:// and got TLS.',
    };

    return {
      enabled: this.enabled,
      status: this.isReady() ? 'connected' : (this.enabled ? 'disconnected' : 'disabled'),
      target: this._redactedTarget(),
      code,
      at: this.lastError?.at || null,
      hint: code ? (HINTS[code] || 'see the backend logs for the full error') : null,
    };
  }

  /** `rediss://red-da1***tsg:6379` — enough to identify, nothing to leak. */
  _redactedTarget() {
    if (!env.redisUrl) return 'not set';
    try {
      const u = new URL(env.redisUrl);
      const h = u.hostname;
      const short = h.length > 12 ? `${h.slice(0, 6)}***${h.slice(-3)}` : '***';
      return `${u.protocol}//${short}:${u.port || '6379'}`;
    } catch {
      return 'unparseable REDIS_URL';
    }
  }
}

// Expose the presets on the class too, so `require('./config/redis').TTL`
// works without an instance.
CacheManager.TTL = TTL;
CacheManager.KEY = KEY;

// ─── Singleton ──────────────────────────────────────────────────────────────
// One connection per process. `module.exports.CacheManager` is there for tests
// that want an isolated instance.
const cache = new CacheManager();
module.exports = cache;
module.exports.CacheManager = CacheManager;
