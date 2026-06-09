/* eslint-disable no-console */
'use strict';

/**
 * scripts/test-inquiry-flow.js
 * ──────────────────────────────────────────────────────────────────────────
 * End-to-end smoke test for the inquiry pipeline.
 *
 *   1. Insert/reuse a tenant + a landlord directly in Mongo (bypassing the
 *      Firebase phone-OTP signup, which we can't fake offline).
 *   2. Mint a JWT for each user with token.service.signAccessToken.
 *   3. POST a property as the landlord  (or reuse an existing one).
 *   4. POST an inquiry as the tenant.
 *   5. GET /api/host/inquiries          (landlord) — must show the new row.
 *   6. GET /api/inquiries/mine          (tenant)   — must show the new row.
 *   7. PATCH the inquiry status         (landlord) — must succeed.
 *   8. Clean up everything we created.
 *
 * Run with the backend already up (node server.js) and a connected Mongo.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fetch = (...a) => import('node-fetch').then(({ default: f }) => f(...a));

const env = require('../config/env');
const User = require('../models/User');
const Property = require('../models/Property');
const Inquiry = require('../models/Inquiry');
const { signAccessToken } = require('../services/token.service');

const API = process.env.SMOKE_API || 'http://localhost:5000/api';

const TENANT_PHONE   = '+8801999000111';
const LANDLORD_PHONE = '+8801999000222';

const log = (label, data) => {
  console.log(`\n── ${label} ──`);
  console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
};

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`✗ ASSERT FAILED: ${msg}`);
    process.exitCode = 1;
    throw new Error(msg);
  }
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

async function upsertUser(phone, name, role) {
  const existing = await User.findOne({ phone });
  if (existing) return existing;
  // Bypass the bcrypt requirement by writing a dummy password. We never
  // use it — auth happens via the JWT minted directly below.
  return User.create({
    name,
    phone,
    password: 'NEVER_USED_smoke_test',
    role,
    roles: [role],
    phoneVerified: true,
  });
}

async function main() {
  console.log(`[smoke] API base = ${API}`);
  await mongoose.connect(env.mongoUri);
  console.log('[smoke] mongo connected');

  // 1. Seed users
  const tenant   = await upsertUser(TENANT_PHONE,   'Smoke Tenant',   'tenant');
  const landlord = await upsertUser(LANDLORD_PHONE, 'Smoke Landlord', 'landlord');
  log('seed users', { tenant: tenant._id.toString(), landlord: landlord._id.toString() });

  const tenantToken   = signAccessToken(tenant);
  const landlordToken = signAccessToken(landlord);

  // 2. Find or create a property owned by the landlord
  let property = await Property.findOne({ ownerUserId: landlord._id, title: 'Smoke Test Apartment' });
  if (!property) {
    property = await Property.create({
      title: 'Smoke Test Apartment',
      description: 'For automated smoke testing only.',
      price: 12345,
      division: 'dhaka',
      location: 'Dhaka',
      address: 'Test Lane 1',
      ownerUserId: landlord._id,
      ownerName: landlord.name,
      ownerPhone: landlord.phone,
      status: 'active',
      type: 'apartment',
      beds: 2,
      baths: 1,
    });
  }
  log('property', { id: property._id.toString(), title: property.title, status: property.status });

  // Wipe stale smoke inquiries so each run is clean
  await Inquiry.deleteMany({
    inquirerUserId: tenant._id,
    propertyOwnerId: landlord._id,
  });

  // 3. Tenant POSTs an inquiry
  const createRes = await call('POST', '/inquiries', tenantToken, {
    propertyId: property._id.toString(),
    message: 'Hello, is this still available? — smoke test',
  });
  log('POST /inquiries', createRes);
  assert(createRes.status === 201 || createRes.status === 200, 'create inquiry → 200/201');
  const inquiry = createRes.data.inquiry;
  assert(!!inquiry?.id || !!inquiry?._id, 'inquiry has id');
  const inquiryId = inquiry.id || inquiry._id;
  assert(inquiry.status === 'new', 'new inquiry status === "new"');
  assert(String(inquiry.inquirerUserId) === String(tenant._id), 'inquirerUserId === tenant._id');
  assert(String(inquiry.propertyOwnerId) === String(landlord._id), 'propertyOwnerId === landlord._id');

  // 4. Landlord lists host inquiries
  const hostListRes = await call('GET', '/host/inquiries', landlordToken);
  log('GET /host/inquiries', hostListRes);
  assert(hostListRes.status === 200, 'host list → 200');
  const rows = Array.isArray(hostListRes.data.inquiries) ? hostListRes.data.inquiries : [];
  assert(rows.some((r) => String(r.id || r._id) === String(inquiryId)), 'host sees the new inquiry');

  // 5. Tenant lists their own inquiries
  const tenantListRes = await call('GET', '/inquiries/mine', tenantToken);
  log('GET /inquiries/mine', tenantListRes);
  assert(tenantListRes.status === 200, 'tenant list → 200');
  const myRows = Array.isArray(tenantListRes.data.inquiries) ? tenantListRes.data.inquiries : [];
  assert(myRows.some((r) => String(r.id || r._id) === String(inquiryId)), 'tenant sees their inquiry');

  // 6. Landlord moves it to active
  const patchRes = await call('PATCH', `/inquiries/${inquiryId}/status`, landlordToken, { status: 'active' });
  log('PATCH /inquiries/:id/status', patchRes);
  assert(patchRes.status === 200, 'status patch → 200');
  assert(patchRes.data.inquiry?.status === 'active', 'status now "active"');

  // 7. Self-inquiry should be rejected
  const selfRes = await call('POST', '/inquiries', landlordToken, {
    propertyId: property._id.toString(),
    message: 'self inquiry must fail',
  });
  log('POST /inquiries (self)', selfRes);
  assert(selfRes.status >= 400, 'self-inquiry blocked');

  // 8. Cleanup
  await Inquiry.deleteMany({ propertyOwnerId: landlord._id });
  await Property.deleteOne({ _id: property._id });
  await User.deleteMany({ phone: { $in: [TENANT_PHONE, LANDLORD_PHONE] } });
  console.log('\n[smoke] cleanup done');

  await mongoose.disconnect();
  console.log('\n✓ ALL ASSERTIONS PASSED');
}

main().catch(async (err) => {
  console.error('\n✗ SMOKE FAILED:', err);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
