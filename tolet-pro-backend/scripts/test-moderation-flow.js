/* eslint-disable no-console */
'use strict';

/**
 * scripts/test-moderation-flow.js
 * ──────────────────────────────────────────────────────────────────────────
 * Round 3 smoke test:
 *
 *   • GET  /api/admin/overview    returns real counts (A7)
 *   • GET  /api/admin/properties  returns the property list (A18)
 *   • POST /api/admin/properties/:id/moderate flips status + sticks
 *   • paused property is HIDDEN from /api/properties (A11)
 *   • banned user is BLOCKED on POST /api/inquiries (A9)
 *   • banned user CAN still GET /api/auth/me (read-only allowed)
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fetch = (...a) => import('node-fetch').then(({ default: f }) => f(...a));

const env = require('../config/env');
const User = require('../models/User');
const Property = require('../models/Property');
const { signAccessToken } = require('../services/token.service');

const API = process.env.SMOKE_API || 'http://localhost:5000/api';

const log = (label, data) => {
  console.log(`\n── ${label} ──`);
  console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
};
const assert = (cond, msg) => {
  if (!cond) { console.error(`✗ ${msg}`); process.exitCode = 1; throw new Error(msg); }
  console.log(`✓ ${msg}`);
};
async function call(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { _raw: text }; }
  return { status: res.status, data };
}
async function upsertUser(phone, name, role, extras = {}) {
  await User.deleteMany({ phone });
  return User.create({
    name, phone, password: 'NEVER_USED_smoke',
    role, roles: [role], phoneVerified: true,
    ...extras,
  });
}

async function main() {
  await mongoose.connect(env.mongoUri);

  const phones = ['+8801999000411', '+8801999000412', '+8801999000413'];
  await User.deleteMany({ phone: { $in: phones } });

  const admin    = await upsertUser('+8801999000411', 'Mod Admin',    'super_admin', { roles: ['tenant','super_admin'], role: 'super_admin' });
  const landlord = await upsertUser('+8801999000412', 'Mod Landlord', 'landlord');
  const banned   = await upsertUser('+8801999000413', 'Mod Banned',   'tenant',      { isBanned: true, banReason: 'spam' });

  const adminToken    = signAccessToken(admin);
  const landlordToken = signAccessToken(landlord);
  const bannedToken   = signAccessToken(banned);

  await Property.deleteMany({ ownerUserId: landlord._id });
  const prop = await Property.create({
    title: 'Mod Test Apartment ' + Date.now(),
    description: 'Mod test',
    price: 9999,
    division: 'dhaka',
    location: 'Dhaka',
    address: 'Test Lane Mod',
    ownerUserId: landlord._id,
    ownerName: landlord.name,
    ownerPhone: landlord.phone,
    status: 'active',
    type: 'apartment',
    beds: 1, baths: 1,
  });

  // 1. /admin/overview returns real numbers
  const ov = await call('GET', '/admin/overview', adminToken);
  log('GET /admin/overview', ov);
  assert(ov.status === 200, 'overview → 200');
  assert(typeof ov.data.stats?.totalUsers === 'number', 'overview returns totalUsers');
  assert(typeof ov.data.stats?.activeProperties === 'number', 'overview returns activeProperties');
  assert(ov.data.stats.activeProperties >= 1, 'overview activeProperties >= 1');

  // 2. /admin/properties returns the listing
  const list = await call('GET', `/admin/properties?status=active&search=${encodeURIComponent('Mod Test Apartment')}`, adminToken);
  log('GET /admin/properties', { status: list.status, count: list.data.properties?.length });
  assert(list.status === 200, 'admin properties → 200');
  assert((list.data.properties || []).some((p) => String(p._id) === String(prop._id)), 'admin sees the listing');

  // 3. Moderate it → 'remove'
  const mod = await call('POST', `/admin/properties/${prop._id}/moderate`, adminToken, { action: 'remove', reason: 'smoke test' });
  log('POST /admin/properties/:id/moderate', mod);
  assert(mod.status === 200, 'moderate → 200');
  assert(mod.data.property?.status === 'inactive', 'status flipped to inactive');

  // 4. Public listing endpoint must NOT include the moderated listing
  const pub = await call('GET', `/properties?q=${encodeURIComponent(prop.title)}`);
  log('GET /properties (public)', { status: pub.status, count: pub.data.items?.length });
  assert(pub.status === 200, 'public listing → 200');
  const found = (pub.data.items || []).some((p) => String(p._id || p.id) === String(prop._id));
  assert(!found, 'moderated listing NOT in public results');

  // 5. Banned user is blocked on a mutation
  const banMutate = await call('POST', '/inquiries', bannedToken, {
    propertyId: prop._id.toString(),
    message: 'should be blocked',
  });
  log('POST /inquiries (banned)', banMutate);
  assert(banMutate.status === 403, 'banned user → 403 on mutation');
  assert(banMutate.data.code === 'account_banned', 'banned user error code');

  // 6. Banned user can still read /auth/me
  const banRead = await call('GET', '/auth/me', bannedToken);
  log('GET /auth/me (banned)', { status: banRead.status });
  assert(banRead.status === 200, 'banned user can still read /auth/me');

  // 7. Cleanup
  await Property.deleteOne({ _id: prop._id });
  await User.deleteMany({ phone: { $in: phones } });
  await mongoose.disconnect();
  console.log('\n✓ ALL MODERATION-FLOW ASSERTIONS PASSED');
}

main().catch(async (err) => {
  console.error('\n✗ FAILED:', err);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
