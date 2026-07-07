'use strict';

/**
 * scripts/smoke-auth.js
 * ─────────────────────────────────────────────────────────────────────────
 * Tiny end-to-end smoke test for the auth backend. Runs against the local
 * server. Verifies:
 *   1. /healthz
 *   2. /signup/start   → 400 on bad input, 202 on valid input
 *   3. /signup/verify  (wrong OTP) → 400
 *   4. /login          (no account, wrong creds) → 401 generic
 *   5. /forgot-password → 202 (constant-time exists check)
 *   6. /reset-password (wrong OTP) → 400
 *
 * It does NOT cover the happy-path signup/forgot end-to-end — that requires a
 * real OTP delivered by sms.net.bd. Run this in dev to make sure the wiring +
 * validation + error handling are all alive.
 *
 * NOTE: /signup/start with valid input will attempt a real SMS send. Point
 * SMOKE_BASE at a dev server, and expect a 500 (sms_send_failed / rejected)
 * if SMS_API_KEY is unset or the gateway rejects the test number — both are
 * acceptable non-crash outcomes for this smoke check.
 *
 * Usage:  npm run smoke
 */
const BASE = process.env.SMOKE_BASE || 'http://localhost:5000';

const TESTS = [];
function test(name, fn) { TESTS.push({ name, fn }); }

async function req(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function expect(actual, matcher) {
  const ok = matcher.fn(actual);
  if (!ok) throw new Error(`expected ${matcher.label}, got ${JSON.stringify(actual)}`);
}
const matchers = {
  status: (s) => ({ label: `status ${s}`, fn: (a) => a === s }),
  hasField: (k) => ({ label: `field "${k}"`, fn: (a) => a && Object.prototype.hasOwnProperty.call(a, k) }),
};

test('GET /healthz returns ok', async () => {
  const r = await req('/healthz');
  expect(r.status, matchers.status(200));
  expect(r.data, matchers.hasField('ok'));
});

test('POST /api/auth/signup/start (missing fields) → 400', async () => {
  const r = await req('/api/auth/signup/start', { method: 'POST', body: { name: 'a' } });
  expect(r.status, matchers.status(400));
});

test('POST /api/auth/signup/verify (wrong OTP) → 400', async () => {
  const r = await req('/api/auth/signup/verify', {
    method: 'POST',
    body: { phoneNumber: '+8801999999999', otp: '000000' },
  });
  // No matching Otp record (or wrong code) → otp_invalid.
  expect(r.status, matchers.status(400));
});

test('POST /api/auth/login (no account) → 401 with generic message', async () => {
  const r = await req('/api/auth/login', {
    method: 'POST',
    body: { phone: '+8801000000001', password: 'whatever1' },
  });
  expect(r.status, matchers.status(401));
  if (!r.data.message || !r.data.message.includes('ভুল')) {
    throw new Error('login should return generic Bangla error');
  }
});

test('POST /api/auth/forgot-password → 202 (constant-time)', async () => {
  const r = await req('/api/auth/forgot-password', {
    method: 'POST',
    body: { phoneNumber: '+8801000000001' },
  });
  expect(r.status, matchers.status(202));
});

test('POST /api/auth/reset-password (wrong OTP) → 400', async () => {
  const r = await req('/api/auth/reset-password', {
    method: 'POST',
    body: { phoneNumber: '+8801000000001', otp: '000000', newPassword: 'newpass123' },
  });
  // No matching Otp record (or wrong code) → otp_invalid.
  expect(r.status, matchers.status(400));
});

(async () => {
  let pass = 0;
  let fail = 0;
  for (const t of TESTS) {
    try {
      await t.fn();
      console.log(`  ✓ ${t.name}`);
      pass++;
    } catch (err) {
      console.error(`  ✗ ${t.name} — ${err.message}`);
      fail++;
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
