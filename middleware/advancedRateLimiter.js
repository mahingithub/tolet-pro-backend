'use strict';

/**
 * middleware/advancedRateLimiter.js — Redis-backed rate limiting
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Replaces the in-memory express-rate-limit limiters for the routes it is
 * mounted on. The old files (middleware/rateLimit.js, middleware/rateLimiters.js)
 * are kept as reference AND as the automatic fallback when Redis is absent —
 * abuse protection must never simply vanish.
 * ── WHY REDIS AT ALL ─────────────────────────────────────────────────────
 * express-rate-limit's default store is per-process memory. That has two holes
 * this file closes:
 *   1. Every Render deploy/restart resets all counters, so an attacker just
 *      waits for a restart (or triggers one) to get a fresh budget.
 *   2. The moment there is more than one instance, each one keeps its own
 *      count — N instances means N× the intended limit.
 * Redis gives one shared, restart-surviving counter.
 *
 * ── WHY TWO ALGORITHMS ───────────────────────────────────────────────────
 * They fail in opposite directions, so we run BOTH and a request must pass
 * each one:
 *
 *   SLIDING WINDOW (sorted set)
 *     Counts actual request timestamps in the trailing window. Precise, and
 *     immune to the fixed-window boundary trick where a client sends `max` at
 *     11:59:59 and `max` again at 12:00:00 — 2× the limit in one second.
 *     What it does NOT do is care about shape: 100 requests spread evenly and
 *     100 requests in one burst both "pass" until the total is reached.
 *
 *   TOKEN BUCKET (Lua)
 *     Caps INSTANTANEOUS burst. Bucket holds `burst` tokens and refills at a
 *     steady rate; a scripted flood empties it in one round-trip and gets 429
 *     immediately, long before the sliding window's total is reached. It also
 *     lets a normal user who has been idle spend their saved-up tokens at once
 *     (open the app → several parallel requests) without being punished.
 *
 * Together: the bucket shapes the traffic, the window caps the volume.
 *
 * ── FAIL-OPEN ────────────────────────────────────────────────────────────
 * If Redis errors, we ALLOW the request and log it. This is a deliberate
 * availability-over-security trade-off for this app: a rate limiter that
 * fail-closed turns a Redis blip into a total outage for every user in
 * Bangladesh. The blast radius of failing open is bounded — auth still needs
 * valid credentials, account lockout in auth.service.js still applies, and
 * Helmet/CORS are untouched.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const env = require('./../config/env');
const cache = require('./../config/redis');
const legacy = require('./rateLimiters');

// ─── Lua: token bucket ──────────────────────────────────────────────────────
// Runs server-side so read → refill → consume → write is ATOMIC. Doing this in
// JS (GET, compute, SET) races under concurrency: two requests both read 1
// token left and both spend it, so the burst cap silently leaks.
//
// KEYS[1] bucket hash   ARGV[1] capacity  ARGV[2] refillTokens
// ARGV[3] refillMs      ARGV[4] now(ms)   ARGV[5] ttl(seconds)
// → { allowed(0|1), tokensLeft, retryAfterMs }
const TOKEN_BUCKET_LUA = `
local key        = KEYS[1]
local capacity   = tonumber(ARGV[1])
local refillQty  = tonumber(ARGV[2])
local refillMs   = tonumber(ARGV[3])
local now        = tonumber(ARGV[4])
local ttl        = tonumber(ARGV[5])

local data   = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts     = tonumber(data[2])

-- First sight of this identifier: hand them a full bucket.
if tokens == nil or ts == nil then
  tokens = capacity
  ts     = now
end

-- Lazy refill: add whatever accrued since the last request. No background
-- timer needed, and an idle client's bucket is correct on its next visit.
local elapsed = now - ts
if elapsed > 0 then
  local refills = math.floor(elapsed / refillMs)
  if refills > 0 then
    tokens = math.min(capacity, tokens + (refills * refillQty))
    ts = ts + (refills * refillMs)
  end
end

local allowed = 0
local retryAfterMs = 0

if tokens >= 1 then
  allowed = 1
  tokens = tokens - 1
else
  -- Time until the next single token drips in.
  retryAfterMs = refillMs - ((now - ts) % refillMs)
end

redis.call('HMSET', key, 'tokens', tokens, 'ts', ts)
redis.call('EXPIRE', key, ttl)

return { allowed, tokens, retryAfterMs }
`;

// ─── Lua: sliding window counter ────────────────────────────────────────────
// Also atomic: trim old entries, count, and conditionally add in one pass.
// A JS version would ZCARD then ZADD, letting concurrent requests both see
// `count = max - 1` and both get in.
//
// KEYS[1] zset key   ARGV[1] windowMs  ARGV[2] max
// ARGV[3] now(ms)    ARGV[4] member (unique id)
// → { allowed(0|1), count, oldestMs }
const SLIDING_WINDOW_LUA = `
local key      = KEYS[1]
local windowMs = tonumber(ARGV[1])
local max      = tonumber(ARGV[2])
local now      = tonumber(ARGV[3])
local member   = ARGV[4]

-- Drop everything that fell out of the trailing window.
redis.call('ZREMRANGEBYSCORE', key, 0, now - windowMs)

local count = redis.call('ZCARD', key)
local allowed = 0

if count < max then
  redis.call('ZADD', key, now, member)
  count = count + 1
  allowed = 1
end

-- TTL is refreshed every call, so an idle key expires on its own.
redis.call('PEXPIRE', key, windowMs + 1000)

-- Oldest surviving timestamp → tells the client when a slot frees up.
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local oldestMs = 0
if oldest[2] then oldestMs = tonumber(oldest[2]) end

return { allowed, count, oldestMs }
`;

// Registered SHA digests (EVALSHA is cheaper than shipping the script each
// ─── Lua: refund (for skipSuccessfulRequests) ───────────────────────────────
// Gives back the slot a request consumed, once we know it SUCCEEDED. Used by
// the auth limiter so the budget is spent only on FAILED attempts.
//
// This is not a nicety — it preserves behaviour the old limiter had and that
// production depends on. See the note on `skipSuccessfulRequests` below.
//
// KEYS[1] zset key  KEYS[2] bucket hash
// ARGV[1] member    ARGV[2] capacity
const REFUND_LUA = `
redis.call('ZREM', KEYS[1], ARGV[1])
local capacity = tonumber(ARGV[2])
local tokens = tonumber(redis.call('HGET', KEYS[2], 'tokens'))
if tokens ~= nil and tokens < capacity then
  redis.call('HSET', KEYS[2], 'tokens', math.min(capacity, tokens + 1))
end
return 1
`;

// Registered SHA digests (EVALSHA is cheaper than shipping the script each
// time). Lazily loaded once per process, per script.
let bucketSha = null;
let windowSha = null;
let refundSha = null;
let scriptLoadFailed = false;

async function loadScripts(client) {
  if ((bucketSha && windowSha && refundSha) || scriptLoadFailed) return;
  try {
    [bucketSha, windowSha, refundSha] = await Promise.all([
      client.script('LOAD', TOKEN_BUCKET_LUA),
      client.script('LOAD', SLIDING_WINDOW_LUA),
      client.script('LOAD', REFUND_LUA),
    ]);
  } catch (err) {
    scriptLoadFailed = true;
    console.warn('[ratelimit] Lua script load failed:', err.message);
  }
}
/**
 * Run a script by SHA, re-loading it if Redis has forgotten it.
 * NOSCRIPT happens for real: a Redis restart or SCRIPT FLUSH empties the
 * script cache while our SHA variable still looks valid.
 */
async function evalScript(client, sha, source, keys, args, kind) {
  try {
    return await client.evalsha(sha, keys.length, ...keys, ...args);
  } catch (err) {
    if (String(err.message || '').includes('NOSCRIPT')) {
      const fresh = await client.script('LOAD', source);
      if (kind === 'bucket') bucketSha = fresh;
      else if (kind === 'refund') refundSha = fresh;
      else windowSha = fresh;
      return client.evalsha(fresh, keys.length, ...keys, ...args);
    }
    throw err;
  }
}

/** Who are we limiting? Logged-in identity beats IP. */
function defaultIdentifier(req) {
  // Authenticated users get their own budget, so one abusive user can't spend
  // the shared budget of everyone behind the same carrier NAT. Bangladeshi
  // mobile networks put thousands of subscribers on one public IP — IP-only
  // keying is why the old refresh limiter kept logging real users out.
  return req.user?.id || req.user?._id || req.ip || 'unknown';
}

let lastFailOpenLog = 0;

/**
 * Build a rate-limit middleware.
 *
 * @param {object}   opts
 * @param {string}   opts.name          bucket namespace (keeps limiters separate)
 * @param {number}   opts.windowMs      sliding-window size
 * @param {number}   opts.max           max requests per window
 * @param {number}   [opts.burst]       token-bucket capacity (defaults to max/3)
 * @param {number}   [opts.refillMs]    ms per refill tick (default: windowMs/max)
 * @param {string}   [opts.message]     Bengali 429 body message
 * @param {Function} [opts.identifier]  (req) => string
 * @param {Function} [opts.skip]        (req) => boolean — bypass entirely
 * @param {Function} [opts.fallback]    middleware used when Redis is unavailable
 * @param {boolean}  [opts.skipSuccessfulRequests]  refund the slot on a 2xx/3xx
 *                   response, so only FAILED attempts consume budget.
 * @param {number}   [opts.guestMultiplier]  widen the limit for UNAUTHENTICATED
 *                   callers, who are keyed by IP and therefore share a bucket
 *                   with everyone behind the same carrier NAT. Default 1.
 */
function createRateLimiter(opts) {
  const {
    name,
    windowMs,
    max,
    burst = Math.max(1, Math.ceil(max / 3)),
    message = 'অনেক বেশি অনুরোধ। একটু পরে আবার চেষ্টা করুন।',
    identifier = defaultIdentifier,
    skip = null,
    fallback = null,
    skipSuccessfulRequests = false,
    guestMultiplier = 1,
  } = opts;

  if (!name) throw new Error('createRateLimiter: `name` is required');

  // Refill one token every (windowMs / max) ms → the bucket's long-run rate
  // matches the window's rate, so the two algorithms agree on sustained
  // traffic and only differ on burstiness.
  const refillMs = Math.max(1, Math.floor(opts.refillMs || windowMs / max));
  const windowSec = Math.ceil(windowMs / 1000);

  return async function advancedRateLimit(req, res, next) {
    if (skip && skip(req)) return next();

    // No Redis → hand off to the in-memory limiter so protection persists.
    if (!cache.isReady() || scriptLoadFailed) {
      if (fallback) return fallback(req, res, next);
      return next();
    }

    const client = cache.client;
    const id = String(identifier(req));
    const now = Date.now();

    // ── Carrier-NAT allowance ───────────────────────────────────────────────
    // An authenticated request is keyed by user id, so its budget belongs to
    // ONE person. An anonymous one is keyed by IP — and in Bangladesh a single
    // mobile-carrier IP can front thousands of subscribers, so the same number
    // would be divided among all of them. `guestMultiplier` widens the
    // anonymous bucket to compensate. Set it to 1 (the default) for anything
    // where per-IP abuse is the actual threat.
    const isGuest = !(req.user?.id || req.user?._id);
    const effMax   = isGuest ? Math.ceil(max * guestMultiplier)   : max;
    const effBurst = isGuest ? Math.ceil(burst * guestMultiplier) : burst;

    // NOTE: cache.client is created with keyPrefix 'toletpro:cache:', which
    // ioredis applies to these keys too. Harmless — but it does mean rate-limit
    // keys are wiped by cache.clearAll(). Kept in the same namespace on purpose
    // so one prefix scopes the whole app on a shared Redis.
    const windowKey = `rl:w:${name}:${id}`;
    const bucketKey = `rl:b:${name}:${id}`;

    // Unique per request so a refund can target exactly this entry.
    const member = `${now}-${Math.random().toString(36).slice(2, 10)}`;

    try {
      await loadScripts(client);
      if (!bucketSha || !windowSha) {
        if (fallback) return fallback(req, res, next);
        return next();
      }

      // Both checks in flight together — one round-trip of latency, not two.
      const [windowRes, bucketRes] = await Promise.all([
        evalScript(
          client, windowSha, SLIDING_WINDOW_LUA,
          [windowKey],
          [windowMs, effMax, now, member],
          'window',
        ),
        evalScript(
          client, bucketSha, TOKEN_BUCKET_LUA,
          [bucketKey],
          [effBurst, 1, refillMs, now, windowSec],
          'bucket',
        ),
      ]);

      const windowAllowed = Number(windowRes[0]) === 1;
      const windowCount   = Number(windowRes[1]) || 0;
      const oldestMs      = Number(windowRes[2]) || now;

      const bucketAllowed = Number(bucketRes[0]) === 1;
      const tokensLeft    = Number(bucketRes[1]) || 0;
      const bucketRetryMs = Number(bucketRes[2]) || refillMs;

      // Remaining is the TIGHTER of the two — that's what the client will
      // actually hit first, so reporting anything else is misleading.
      const remaining = Math.max(0, Math.min(effMax - windowCount, Math.floor(tokensLeft)));
      const resetMs = windowAllowed && bucketAllowed
        ? oldestMs + windowMs
        : (windowAllowed ? now + bucketRetryMs : oldestMs + windowMs);

      res.setHeader('X-RateLimit-Limit', String(effMax));
      res.setHeader('X-RateLimit-Remaining', String(remaining));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(resetMs / 1000))); // unix seconds

      // A request must satisfy BOTH algorithms.
      if (windowAllowed && bucketAllowed) {
        // Refund the slot once we know the request SUCCEEDED, so the budget is
        // spent on failures only. Registered before next() because the handler
        // may respond synchronously.
        if (skipSuccessfulRequests) {
          res.on('finish', () => {
            if (res.statusCode >= 400) return; // a real failure — let it count
            if (!refundSha || !cache.isReady()) return;
            evalScript(
              cache.client, refundSha, REFUND_LUA,
              [windowKey, bucketKey], [member, effBurst], 'refund',
            ).catch(() => { /* best-effort: a lost refund only costs 1 slot */ });
          });
        }
        return next();
      }

      const retryAfterSec = Math.max(
        1,
        Math.ceil((windowAllowed ? bucketRetryMs : Math.max(0, oldestMs + windowMs - now)) / 1000),
      );

      res.setHeader('Retry-After', String(retryAfterSec));
      // Which limiter tripped — invaluable when tuning from production logs.
      res.setHeader('X-RateLimit-Policy', windowAllowed ? 'burst' : 'window');

      console.warn(
        `[ratelimit] 429 ${name} (${windowAllowed ? 'burst' : 'window'}) ` +
        `id=${id} path=${req.originalUrl} count=${windowCount}/${effMax} tokens=${tokensLeft}`,
      );

      return res.status(429).json({
        message,
        code: 'too_many_requests',
        retryAfter: retryAfterSec,
        limit: effMax,
        remaining: 0,
      });
    } catch (err) {
      // ── FAIL-OPEN ───────────────────────────────────────────────────────
      // Redis is unhealthy. Allow the request rather than 429-ing every real
      // user; log at most once per 30s so an outage can't flood the log.
      if (now - lastFailOpenLog > 30_000) {
        lastFailOpenLog = now;
        console.warn(
          `[ratelimit] Redis error on "${name}" — FAILING OPEN (allowing traffic): ${err.message}`,
        );
      }
      if (fallback) return fallback(req, res, next);
      return next();
    }
  };
}

/**
 * Reset one identifier's counters. Used by tests and by an admin "unblock this
 * user" action. Clears BOTH algorithms — resetting one leaves the other
 * blocking, which looks like the reset silently didn't work.
 */
async function resetLimit(name, id) {
  if (!cache.isReady()) return false;
  try {
    await cache.client.del(`rl:w:${name}:${id}`, `rl:b:${name}:${id}`);
    return true;
  } catch {
    return false;
  }
}

/** Inspect current usage without consuming a slot (admin diagnostics). */
async function peekLimit(name, id, windowMs) {
  if (!cache.isReady()) return null;
  try {
    const key = `rl:w:${name}:${id}`;
    const now = Date.now();
    await cache.client.zremrangebyscore(key, 0, now - windowMs);
    return { used: await cache.client.zcard(key) };
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Pre-configured limiters
// ═══════════════════════════════════════════════════════════════════════════
//
// `fallback` points each one at the closest in-memory limiter from
// middleware/rateLimiters.js, so removing Redis downgrades the limits rather
// than removing them.
const rateLimiters = {
  /**
   * AUTH — login / OTP / signup / password reset. The tightest bucket here:
   * these are the endpoints worth brute-forcing, and OTP sends cost real money
   * through sms.net.bd.
   *
   * 10 FAILED attempts per 15 min, burst 5. A real user mistyping a password
   * or re-requesting an OTP a couple of times stays well under; a
   * credential-stuffing script empties the burst on its 6th attempt.
   *
   * ── WHY skipSuccessfulRequests IS MANDATORY HERE ────────────────────────
   * `/api/auth` is not just login. The same router serves POST /refresh,
   * GET /me, GET /sessions, POST /logout and GET /login-history — calls every
   * logged-in user makes routinely (a refresh fires every time the 15-minute
   * access token expires).
   *
   * Counting those would re-create a bug this codebase has already been burned
   * by, documented in middleware/rateLimit.js: the refresh limiter used to
   * count successful refreshes, and because Bangladeshi mobile carriers put
   * thousands of subscribers behind one NAT IP, a shared IP burned the whole
   * budget in minutes. Every user behind it got 429s, could not mint an access
   * token, and appeared logged out.
   *
   * Refunding successes keeps the 10/burst-5 numbers meaningful for attackers
   * (whose attempts fail by definition) while leaving legitimate traffic
   * untouched. The per-user keying in defaultIdentifier covers the authed
   * routes; this covers the unauthenticated ones.
   */
  auth: createRateLimiter({
    name: 'auth',
    windowMs: 15 * 60 * 1000,
    max: 10,
    burst: 5,
    skipSuccessfulRequests: true,
    message: 'অনেক বেশি লগইন চেষ্টা। ১৫ মিনিট পরে আবার চেষ্টা করুন।',
    fallback: legacy.authLimiter,
  }),

  /**
   * API — global backstop on ALL /api traffic. Deliberately the loosest: it
   * exists to stop resource exhaustion, not to police features (each feature
   * has its own limiter below).
   *
   * ── WHY 4500 / 15 min AND NOT 100 ───────────────────────────────────────
   * 100 per 15 min was the original plan, and it would have taken the app down.
   * This limiter sits in front of EVERY /api route, so it has to clear the
   * frontend's polling floor, not a single user action. ChatSystem.jsx alone
   * runs five intervals — messages every 5s, conversation list 15s, presence
   * 20s, plus two 30s refreshes — which is ~23 requests/min, or ~345 per 15
   * min, from a user who is only sitting in a chat window. A 100-request cap
   * would start returning 429 after roughly four minutes of normal use.
   *
   * 4500 per 15 min is the sustained rate the previous in-memory limiter
   * already ran in production (300/min), so nothing that works today breaks.
   * The upgrade here is not a tighter number — it is that the counter now
   * survives restarts, is shared across instances, and gains a 300-request
   * burst ceiling that the old fixed-window limiter never had.
   *
   * Tighten the per-FEATURE limiters below instead of this one; a global cap
   * low enough to shape one feature is always low enough to break another.
   */
  api: createRateLimiter({
    name: 'api',
    windowMs: 15 * 60 * 1000,
    max: 4500,
    burst: 300,
    message: 'সার্ভার ব্যস্ত। একটু পরে চেষ্টা করুন।',
    fallback: legacy.apiLimiter,
  }),

  /**
   * SEARCH — property browsing (GET /api/properties + /:id).
   *
   * 30/min per logged-in user, burst 10: covers rapid filter tweaking and a
   * detail page firing several parallel fetches, while blocking a scraper
   * walking the whole catalogue.
   *
   * guestMultiplier 4 → 120/min, burst 40 for anonymous callers. Browsing is
   * the top of the funnel and most of it is unauthenticated, so this bucket is
   * IP-keyed and therefore shared by everyone behind one carrier NAT. Four
   * concurrent guests on a single mobile IP is ordinary in Bangladesh; 429-ing
   * them costs real customers. A scraper is still capped at 120/min, which is
   * meaningful throttling versus the unlimited access it has today.
   *
   * Lower the multiplier if you start seeing scraping; raise it if real
   * visitors report errors while browsing.
   */
  search: createRateLimiter({
    name: 'search',
    windowMs: 60 * 1000,
    max: 30,
    burst: 10,
    guestMultiplier: 4,
    // GET only, per the cache/limit plan. Mounting this on the whole
    // /api/properties router would otherwise throttle listing CREATION with a
    // read-shaped budget; writes belong to the `write` limiter.
    skip: (req) => req.method !== 'GET',
    message: 'অনেক বেশি সার্চ অনুরোধ। একটু পরে চেষ্টা করুন।',
    fallback: legacy.apiLimiter,
  }),

  /**
   * UPLOAD — signed Cloudinary credentials (POST /api/upload/signature).
   * Each one authorises a real upload against your storage quota, so this stays
   * the strictest write limiter.
   *
   * 20 per hour, burst 6 — raised from a planned 10/burst-3 because the
   * frontend requests ONE signature PER FILE (services/cloudinaryUpload.js
   * getSignature), not one per session. Identity verification alone submits
   * three documents (NID front, NID back, selfie), so a burst of 3 left zero
   * room for a single retry on a flaky mobile connection, and a landlord who
   * also sets an avatar and a payout screenshot would exhaust 10/hour during
   * ordinary onboarding.
   *
   * Property photos do NOT count against this: services/Propertyservice.js
   * uploads them straight to Cloudinary with an unsigned preset and never
   * touches this route.
   */
  upload: createRateLimiter({
    name: 'upload',
    windowMs: 60 * 60 * 1000,
    max: 20,
    burst: 6,
    message: 'অনেক বেশি আপলোড অনুরোধ। এক ঘণ্টা পরে আবার চেষ্টা করুন।',
    fallback: legacy.writeLimiter,
  }),

  /**
   * MESSAGES — chat. 60 per min, burst 20.
   *
   * Keyed per USER (not per IP) via defaultIdentifier, which matters here: the
   * frontend polls messages every ~5s, so IP-keying would make everyone behind
   * one carrier NAT share a single chat budget.
   */
  messages: createRateLimiter({
    name: 'messages',
    windowMs: 60 * 1000,
    max: 60,
    burst: 20,
    message: 'অনেক বেশি মেসেজ অনুরোধ। একটু পরে চেষ্টা করুন।',
    fallback: legacy.chatLimiter,
  }),

  /**
   * AI — Gemini assistant. Not in the original table, but included because
   * every call spends real API budget (one question can trigger 2–3 Gemini
   * round-trips when the property-search tool fires), so it must not share the
   * generic write bucket.
   *
   * 30 per 15 min, burst 8 — deliberately the SAME sustained number as the
   * legacy aiLimiter that routes/aiChatRoutes.js already applies to /ask and
   * /transcribe. Matching it means /api/ai-chat's effective limit is unchanged;
   * the gain is that the counter is now Redis-backed (survives restarts, shared
   * across instances) instead of resetting on every deploy.
   */
  ai: createRateLimiter({
    name: 'ai',
    windowMs: 15 * 60 * 1000,
    max: 30,
    burst: 8,
    message: 'অনেক বেশি AI অনুরোধ। কিছুক্ষণ পরে আবার চেষ্টা করুন।',
    fallback: legacy.aiLimiter,
  }),

  /**
   * WRITE — generic spam-prone writes (inquiries, bookings, boosts, support
   * tickets, rent-payment claims). Replaces the old writeLimiter one-for-one.
   * 60 per 5 min, burst 20.
   */
  write: createRateLimiter({
    name: 'write',
    windowMs: 5 * 60 * 1000,
    max: 60,
    burst: 20,
    message: 'অনেক বেশি অনুরোধ। একটু পরে আবার চেষ্টা করুন।',
    fallback: legacy.writeLimiter,
  }),
};

module.exports = {
  rateLimiters,
  createRateLimiter,
  resetLimit,
  peekLimit,
  defaultIdentifier,
  // Exported for the verification script.
  _scripts: { TOKEN_BUCKET_LUA, SLIDING_WINDOW_LUA },
};
