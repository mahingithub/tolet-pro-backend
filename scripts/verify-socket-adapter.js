'use strict';

/**
 * scripts/verify-socket-adapter.js — proves the Socket.IO Redis adapter works.
 *
 * The only meaningful test is cross-INSTANCE delivery, so this spawns TWO
 * separate server processes (a single process can't host two independent
 * `ioInstance`s) and checks that an emit issued on instance A reaches a client
 * connected to instance B.
 *
 * Without the adapter that emit finds an empty local room and vanishes — which
 * is exactly the bug that breaks call accept / hang-up after a scale-up. So:
 *   • run WITH REDIS_URL    → delivery must succeed
 *   • run WITHOUT REDIS_URL → delivery must fail (confirming the test is real
 *                             and not passing for some unrelated reason)
 *
 * Usage:
 *   REDIS_URL=redis://127.0.0.1:6399 node scripts/verify-socket-adapter.js
 */

const { fork } = require('child_process');
const path = require('path');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

const CHILD = path.join(__dirname, '_socket-instance.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

function check(label, condition, detail = '') {
  if (condition) console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`);
  else { failures += 1; console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); }
}

function token(userId) {
  return jwt.sign(
    { sub: userId, phone: '+8801700000000' },
    env.jwtSecret,
    { audience: 'tolet-pro', issuer: 'tolet-pro-backend', expiresIn: '10m' },
  );
}

/** Fork one server instance and wait for it to report its port. */
function startInstance(label, redisUrl) {
  return new Promise((resolve, reject) => {
    const child = fork(CHILD, [], {
      env: { ...process.env, REDIS_URL: redisUrl || '', INSTANCE_LABEL: label },
      silent: true,
    });
    let settled = false;
    child.stderr.on('data', (d) => {
      const s = String(d);
      if (/Error|error:/i.test(s)) process.stderr.write(`[${label}] ${s}`);
    });
    child.on('message', (msg) => {
      if (msg.type === 'ready' && !settled) {
        settled = true;
        resolve({ child, port: msg.port, adapter: msg.adapter });
      }
    });
    child.on('exit', (code) => {
      if (!settled) reject(new Error(`${label} exited early (code ${code})`));
    });
    setTimeout(() => { if (!settled) reject(new Error(`${label} start timeout`)); }, 15_000);
  });
}

/** Connect a Socket.IO client and resolve once connected. */
function connect(port, userId) {
  const { io } = require('socket.io-client');
  return new Promise((resolve, reject) => {
    const sock = io(`http://127.0.0.1:${port}`, {
      auth: { token: token(userId) },
      transports: ['websocket', 'polling'],
      reconnection: false,
    });
    sock.on('connect', () => resolve(sock));
    sock.on('connect_error', (e) => reject(new Error(`connect_error: ${e.message}`)));
    setTimeout(() => reject(new Error('socket connect timeout')), 10_000);
  });
}

/**
 * Core scenario: user A on instance 1, user B on instance 2. Instance 1 emits
 * to user B's room. Returns true if B actually received it.
 */
async function crossInstanceDelivery(redisUrl) {
  const a = await startInstance('inst-1', redisUrl);
  const b = await startInstance('inst-2', redisUrl);

  const userA = '507f1f77bcf86cd799430001';
  const userB = '507f1f77bcf86cd799430002';

  const sockA = await connect(a.port, userA);
  const sockB = await connect(b.port, userB);

  // Give the adapter's pub/sub subscriptions time to establish.
  await sleep(600);

  const received = new Promise((resolve) => {
    sockB.on('TEST_EVENT', (payload) => resolve(payload));
    setTimeout(() => resolve(null), 3000);
  });

  // Emit from instance 1 to a user who is connected ONLY to instance 2.
  a.child.send({ type: 'emit', userId: userB, event: 'TEST_EVENT', payload: { hello: 'from inst-1' } });

  const payload = await received;

  sockA.close();
  sockB.close();
  a.child.kill();
  b.child.kill();
  await sleep(200);

  return { delivered: payload !== null, payload, adapter: a.adapter };
}

(async () => {
  console.log('\n═══ Socket.IO Redis adapter verification ═══\n');

  const redisUrl = process.env.REDIS_URL || '';
  if (!redisUrl) {
    console.error('  ⚠️  REDIS_URL not set — run with REDIS_URL=redis://127.0.0.1:6399');
    process.exit(1);
  }

  console.log('1) WITH Redis adapter — cross-instance emit must arrive');
  const withRedis = await crossInstanceDelivery(redisUrl);
  check('instance reports adapter active', withRedis.adapter === true, String(withRedis.adapter));
  check('emit from instance 1 reached a client on instance 2',
    withRedis.delivered === true, JSON.stringify(withRedis.payload));

  console.log('\n2) WITHOUT Redis (control) — the same emit must be LOST');
  console.log('   (proves the test above is actually measuring the adapter)');
  const withoutRedis = await crossInstanceDelivery('');
  check('instance reports adapter INACTIVE', withoutRedis.adapter === false, String(withoutRedis.adapter));
  check('emit did NOT cross instances without Redis',
    withoutRedis.delivered === false,
    withoutRedis.delivered ? 'unexpectedly delivered' : 'lost, as expected');

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
