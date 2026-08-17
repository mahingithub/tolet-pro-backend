'use strict';

/**
 * scripts/verify-rate-limiter.js — smoke test for middleware/advancedRateLimiter.js
 *
 * Drives the middleware through a real Express app + real Redis and asserts
 * BOTH algorithms independently:
 *   • token bucket   → burst is capped even when the window has room
 *   • sliding window → total is capped even when tokens refill
 * Plus headers, the Bengali 429 body, and fail-open behaviour.
 *
 * Usage:
 *   REDIS_URL=redis://127.0.0.1:6399 node scripts/verify-rate-limiter.js
 */

const express = require('express');
const http = require('http');
const cache = require('../config/redis');
const { createRateLimiter, rateLimiters, resetLimit } = require('../middleware/advancedRateLimiter');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

function check(label, condition, detail = '') {
  if (condition) console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`);
  else { failures += 1; console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); }
}

/** Minimal HTTP GET returning { status, headers, body }. */
function get(port, path, ip = '10.0.0.1') {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'GET', headers: { 'X-Forwarded-For': ip } },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let body = null;
          try { body = JSON.parse(data); } catch { body = data; }
          resolve({ status: res.statusCode, headers: res.headers, body });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  console.log('\n═══ middleware/advancedRateLimiter.js verification ═══\n');

  for (let i = 0; i < 20 && !cache.isReady(); i += 1) await sleep(100);
  check('Redis ready (required for this test)', cache.isReady());
  if (!cache.isReady()) process.exit(1);

  const app = express();
  app.set('trust proxy', 1);

  // Window has plenty of room (max 50) but the bucket is tiny (burst 3) →
  // isolates the TOKEN BUCKET.
  app.get('/burst', createRateLimiter({
    name: 'test-burst', windowMs: 60_000, max: 50, burst: 3, refillMs: 60_000,
  }), (_req, res) => res.json({ ok: true }));

  // Bucket has room (burst 20) but the window is tiny (max 4) →
  // isolates the SLIDING WINDOW.
  app.get('/window', createRateLimiter({
    name: 'test-window', windowMs: 60_000, max: 4, burst: 20,
  }), (_req, res) => res.json({ ok: true }));

  // Short window so we can watch it slide.
  app.get('/slide', createRateLimiter({
    name: 'test-slide', windowMs: 2_000, max: 3, burst: 20,
  }), (_req, res) => res.json({ ok: true }));

  // Mirrors the real /api/auth mount (10 per 15 min, burst 5).
  app.get('/auth', rateLimiters.auth, (_req, res) => res.json({ ok: true }));

  app.get('/skipped', createRateLimiter({
    name: 'test-skip', windowMs: 60_000, max: 1, burst: 1,
    skip: (req) => req.query.vip === '1',
  }), (_req, res) => res.json({ ok: true }));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;

  await Promise.all([
    resetLimit('test-burst', '10.0.0.1'), resetLimit('test-window', '10.0.0.1'),
    resetLimit('test-slide', '10.0.0.1'), resetLimit('auth', '10.0.0.1'),
    resetLimit('test-skip', '10.0.0.1'),
  ]);

  // ── Token bucket ─────────────────────────────────────────────────────────
  console.log('1) Token bucket (burst=3, window max=50 → window can NOT be the blocker)');
  const burstRes = [];
  for (let i = 0; i < 5; i += 1) burstRes.push(await get(port, '/burst'));
  const burstCodes = burstRes.map((r) => r.status);
  check('first 3 allowed', burstCodes.slice(0, 3).every((c) => c === 200), burstCodes.join(','));
  check('4th + 5th blocked by BURST', burstCodes[3] === 429 && burstCodes[4] === 429, burstCodes.join(','));
  check('429 attributed to burst policy',
    burstRes[3].headers['x-ratelimit-policy'] === 'burst',
    burstRes[3].headers['x-ratelimit-policy']);

  // ── Sliding window ───────────────────────────────────────────────────────
  console.log('\n2) Sliding window (max=4, burst=20 → burst can NOT be the blocker)');
  const winRes = [];
  for (let i = 0; i < 6; i += 1) winRes.push(await get(port, '/window'));
  const winCodes = winRes.map((r) => r.status);
  check('first 4 allowed', winCodes.slice(0, 4).every((c) => c === 200), winCodes.join(','));
  check('5th + 6th blocked by WINDOW', winCodes[4] === 429 && winCodes[5] === 429, winCodes.join(','));
  check('429 attributed to window policy',
    winRes[4].headers['x-ratelimit-policy'] === 'window',
    winRes[4].headers['x-ratelimit-policy']);

  // ── Headers ──────────────────────────────────────────────────────────────
  console.log('\n3) Response headers');
  const h = winRes[0].headers;
  check('X-RateLimit-Limit present', h['x-ratelimit-limit'] === '4', h['x-ratelimit-limit']);
  check('X-RateLimit-Remaining counts down',
    winRes[0].headers['x-ratelimit-remaining'] === '3' &&
    winRes[1].headers['x-ratelimit-remaining'] === '2',
    `${winRes[0].headers['x-ratelimit-remaining']} → ${winRes[1].headers['x-ratelimit-remaining']}`);
  check('X-RateLimit-Remaining is 0 when blocked',
    winRes[4].headers['x-ratelimit-remaining'] === '0');
  const reset = Number(h['x-ratelimit-reset']);
  const nowSec = Math.floor(Date.now() / 1000);
  check('X-RateLimit-Reset is a future unix timestamp',
    reset > nowSec && reset < nowSec + 3600, `${reset} (now=${nowSec})`);
  check('Retry-After set on 429', Number(winRes[4].headers['retry-after']) > 0,
    winRes[4].headers['retry-after']);

  // ── 429 body ─────────────────────────────────────────────────────────────
  console.log('\n4) 429 response body (Bengali)');
  const blocked = winRes[4].body;
  check('code = too_many_requests', blocked.code === 'too_many_requests');
  check('retryAfter present + numeric', typeof blocked.retryAfter === 'number' && blocked.retryAfter > 0,
    String(blocked.retryAfter));
  check('message is Bengali', /[\u0980-\u09FF]/.test(blocked.message || ''), blocked.message);

  // ── Window actually slides ───────────────────────────────────────────────
  console.log('\n5) Window slides (max=3 per 2s)');
  for (let i = 0; i < 3; i += 1) await get(port, '/slide');
  const blockedNow = await get(port, '/slide');
  check('4th request blocked inside the window', blockedNow.status === 429, String(blockedNow.status));
  await sleep(2200); // let the window roll past
  const afterSlide = await get(port, '/slide');
  check('allowed again after window passes', afterSlide.status === 200, String(afterSlide.status));

  // ── skipSuccessfulRequests (refund) ──────────────────────────────────────
  // This is the behaviour that stops /api/auth from 429-ing routine calls like
  // POST /refresh and GET /me. Only FAILED attempts may consume budget.
  console.log('\n6) skipSuccessfulRequests — successes must be refunded');
  app.get('/refundable', createRateLimiter({
    name: 'test-refund', windowMs: 60_000, max: 3, burst: 3,
    skipSuccessfulRequests: true,
  }), (req, res) => {
    if (req.query.fail === '1') return res.status(401).json({ message: 'nope' });
    return res.json({ ok: true });
  });
  await resetLimit('test-refund', '10.0.0.1');

  // 10 SUCCESSFUL calls against a limit of 3 — all must pass.
  const successCodes = [];
  for (let i = 0; i < 10; i += 1) {
    successCodes.push((await get(port, '/refundable')).status);
    await sleep(30); // let the 'finish' refund land
  }
  check('10 successes pass a limit of 3 (all refunded)',
    successCodes.every((c) => c === 200), successCodes.join(','));

  // Now failures — these must NOT be refunded, so the limit bites.
  const failCodes = [];
  for (let i = 0; i < 5; i += 1) {
    failCodes.push((await get(port, '/refundable?fail=1')).status);
    await sleep(30);
  }
  check('failures consume budget → 429 after 3',
    failCodes.slice(0, 3).every((c) => c === 401) && failCodes[3] === 429,
    failCodes.join(','));

  // ── Real auth limiter ────────────────────────────────────────────────────
  console.log('\n7) rateLimiters.auth — 15 FAILED logins (your test plan)');
  await resetLimit('auth', '10.0.0.1');
  // The route returns 401, mimicking a wrong password — the case the limiter
  // exists for.
  app.get('/auth-fail', rateLimiters.auth, (_req, res) => res.status(401).json({ m: 'bad creds' }));
  const authCodes = [];
  for (let i = 0; i < 15; i += 1) {
    authCodes.push((await get(port, '/auth-fail')).status);
    await sleep(20);
  }
  const bad401 = authCodes.filter((c) => c === 401).length;
  const ok429 = authCodes.filter((c) => c === 429).length;
  check('brute-force attempts get blocked', ok429 > 0, `401×${bad401}, 429×${ok429}`);
  check('burst (5) enforced — first 5 attempts, 6th blocked',
    authCodes.slice(0, 5).every((c) => c === 401) && authCodes[5] === 429,
    authCodes.join(','));

  // The same limiter must NOT block a user's routine successful auth traffic
  // (GET /me, POST /refresh) — the documented carrier-NAT logout bug.
  await resetLimit('auth', '10.0.0.1');
  const routine = [];
  for (let i = 0; i < 14; i += 1) {
    routine.push((await get(port, '/auth')).status);
    await sleep(30);
  }
  check('14 successful auth calls (refresh/me) all pass',
    routine.every((c) => c === 200), routine.join(','));

  // ── Identity isolation ───────────────────────────────────────────────────
  console.log("\n8) Per-identifier isolation");
  const otherIp = await get(port, '/auth', '10.0.0.99');
  check('a different IP has its own budget', otherIp.status === 200, String(otherIp.status));

  // ── reset + skip ─────────────────────────────────────────────────────────
  console.log("\n9) resetLimit() + skip()");
  await resetLimit('auth', '10.0.0.1');
  const afterReset = await get(port, '/auth');
  check('resetLimit clears BOTH algorithms', afterReset.status === 200, String(afterReset.status));

  await get(port, '/skipped');                       // consume the only slot
  const vip = await get(port, '/skipped?vip=1');
  check('skip() bypasses the limiter', vip.status === 200, String(vip.status));

  // ── Fail-open ────────────────────────────────────────────────────────────
  console.log("\n10) Fail-open when Redis is unavailable");
  const realClient = cache.client;
  cache.client = {
    status: 'ready',
    script: async () => { throw new Error('simulated redis outage'); },
    evalsha: async () => { throw new Error('simulated redis outage'); },
  };
  const duringOutage = [];
  for (let i = 0; i < 5; i += 1) duringOutage.push((await get(port, '/burst')).status);
  cache.client = realClient;
  check('traffic still served during Redis outage',
    duringOutage.every((c) => c === 200), duringOutage.join(','));

  // ── Cleanup ──────────────────────────────────────────────────────────────
  await Promise.all([
    resetLimit('test-burst', '10.0.0.1'), resetLimit('test-window', '10.0.0.1'),
    resetLimit('test-slide', '10.0.0.1'), resetLimit('auth', '10.0.0.1'),
    resetLimit('auth', '10.0.0.99'), resetLimit('test-skip', '10.0.0.1'),
    resetLimit('test-refund', '10.0.0.1'),
  ]);
  server.close();
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
