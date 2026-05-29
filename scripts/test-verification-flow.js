/* eslint-disable no-console */
'use strict';

/**
 * scripts/test-verification-flow.js
 * ──────────────────────────────────────────────────────────────────────────
 * Smoke test for Round 2 changes:
 *
 *   • Tenant identity verification (admin approves)
 *       → tenantProfile.verification.status = 'verified'
 *       → landlord role is NOT granted automatically  ← A8
 *
 *   • Landlord-side verification (admin approves)
 *       → landlordProfile.verification.status = 'verified'
 *       → landlord role IS granted              ← admin.controller.verifyLandlord
 *       → public landlord profile shows verified=true   ← A5
 *       → public landlord profile's verification.idStatus reflects tenant verification ← A5
 *
 *   • Public tenant profile (GET /api/tenants/:id)
 *       → anonymous caller: no phone, no email exposed
 *       → tenant themselves (Bearer): phone + email unlocked            ← A6
 *       → landlord with active inquiry on this tenant: phone unlocked   ← A6
 *
 *   • addRole('landlord') refuses unless landlord-side verified         ← A8
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

const log = (label, data) => {
  console.log(`\n── ${label} ──`);
  console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
};
const assert = (cond, msg) => {
  if (!cond) {
    console.error(`✗ ${msg}`);
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

async function upsertUser(phone, name, role, extras = {}) {
  const existing = await User.findOne({ phone });
  if (existing) {
    Object.assign(existing, extras);
    await existing.save();
    return existing;
  }
  return User.create({
    name,
    phone,
    password: 'NEVER_USED_smoke_test',
    role,
    roles: [role],
    phoneVerified: true,
    ...extras,
  });
}

async function main() {
  await mongoose.connect(env.mongoUri);

  // Clean slate
  const phones = ['+8801999000311', '+8801999000312', '+8801999000313'];
  await User.deleteMany({ phone: { $in: phones } });

  // 1. Seed: a super_admin, a tenant, a landlord-candidate.
  const admin = await upsertUser('+8801999000311', 'Smoke Admin', 'super_admin', {
    roles: ['tenant', 'super_admin'],
    role:  'super_admin',
  });
  const tenant = await upsertUser('+8801999000312', 'Smoke Tenant', 'tenant', {
    email: 'tenant@example.test',
  });
  const candidate = await upsertUser('+8801999000313', 'Smoke Candidate', 'tenant', {
    roles: ['tenant'],
    role:  'tenant',
  });

  // Seed tenant-side verification submission for the candidate so admin
  // can flip it to 'verified'.
  candidate.tenantProfile = candidate.tenantProfile || {};
  candidate.tenantProfile.verification = {
    photo:              true,
    nidFront:           true,
    nidBack:            true,
    professionProof:    true,
    submittedForReview: true,
    status:             'pending',
  };
  // Same for landlord-side:
  candidate.landlordProfile = candidate.landlordProfile || {};
  candidate.landlordProfile.verification = {
    submittedForReview: true,
    status:             'pending',
  };
  await candidate.save();

  const adminToken     = signAccessToken(admin);
  const tenantToken    = signAccessToken(tenant);
  const candidateToken = signAccessToken(candidate);

  // 2. addRole('landlord') BEFORE admin verifies landlord-side → must be refused
  const preRoleRes = await call('POST', '/auth/me/roles', candidateToken, { role: 'landlord' });
  log('POST /auth/me/roles (pre-verify)', preRoleRes);
  assert(preRoleRes.status === 403, 'addRole landlord refused without verification');

  // 3. Admin approves tenant-side identity → role list must NOT include 'landlord'
  const verifyUserRes = await call('POST', `/admin/users/${candidate._id}/verify`, adminToken);
  log('POST /admin/users/:id/verify', verifyUserRes);
  assert(verifyUserRes.status === 200, 'admin verify-user → 200');
  const afterVerifyTenant = await User.findById(candidate._id);
  assert(afterVerifyTenant.tenantProfile.verification.status === 'verified',
         'tenantProfile.verification.status === "verified"');
  assert(!afterVerifyTenant.roles.includes('landlord'),
         'tenant verification did NOT auto-grant landlord role');

  // 4. addRole('landlord') STILL refused (landlord-side still pending)
  const midRoleRes = await call('POST', '/auth/me/roles', candidateToken, { role: 'landlord' });
  log('POST /auth/me/roles (mid)', midRoleRes);
  assert(midRoleRes.status === 403, 'addRole landlord still refused after tenant verify');

  // 5. Admin approves landlord-side → role granted
  const verifyLandlordRes = await call('POST', `/admin/users/${candidate._id}/verify-landlord`, adminToken);
  log('POST /admin/users/:id/verify-landlord', verifyLandlordRes);
  assert(verifyLandlordRes.status === 200, 'admin verify-landlord → 200');
  const afterVerifyLandlord = await User.findById(candidate._id);
  assert(afterVerifyLandlord.landlordProfile.verification.status === 'verified',
         'landlordProfile.verification.status === "verified"');
  assert(afterVerifyLandlord.roles.includes('landlord'),
         'landlord role granted after verify-landlord');

  // 6. Public landlord profile shows verified
  const pubLandlordRes = await call('GET', `/landlords/${candidate._id}`);
  log('GET /landlords/:id', pubLandlordRes);
  assert(pubLandlordRes.status === 200, 'public landlord profile → 200');
  assert(pubLandlordRes.data.landlord?.verified === true,
         'public landlord.verified === true after admin approval');
  assert(pubLandlordRes.data.landlord?.verification?.idStatus === 'verified',
         'public landlord.verification.idStatus === "verified"');
  assert(pubLandlordRes.data.landlord?.verification?.addressStatus === 'verified',
         'public landlord.verification.addressStatus === "verified"');

  // 7. Public tenant profile: anonymous caller → no phone/email leak
  const pubTenantAnonRes = await call('GET', `/tenants/${tenant._id}`);
  log('GET /tenants/:id (anonymous)', pubTenantAnonRes);
  assert(pubTenantAnonRes.status === 200, 'public tenant profile → 200');
  assert(!pubTenantAnonRes.data.tenant?.phone, 'anonymous: phone NOT exposed');
  assert(!pubTenantAnonRes.data.tenant?.email, 'anonymous: email NOT exposed');

  // 8. Public tenant profile: tenant themselves → phone/email unlocked
  const pubTenantSelfRes = await call('GET', `/tenants/${tenant._id}`, tenantToken);
  log('GET /tenants/:id (self)', pubTenantSelfRes);
  assert(!!pubTenantSelfRes.data.tenant?.phone, 'self: phone unlocked');

  // 9. Public tenant profile: landlord with an active inquiry → unlock
  //    First, the candidate (now a landlord) needs a property + the tenant
  //    needs an inquiry against it.
  let property = await Property.findOne({
    ownerUserId: candidate._id, title: 'Smoke Verification Apartment',
  });
  if (!property) {
    property = await Property.create({
      title: 'Smoke Verification Apartment',
      description: 'For verification smoke test only.',
      price: 11111,
      division: 'dhaka',
      location: 'Dhaka',
      address: 'Test Lane 2',
      ownerUserId: candidate._id,
      ownerName: candidate.name,
      ownerPhone: candidate.phone,
      status: 'active',
      type: 'apartment',
      beds: 2,
      baths: 1,
    });
  }
  await Inquiry.deleteMany({ inquirerUserId: tenant._id, propertyOwnerId: candidate._id });
  await call('POST', '/inquiries', tenantToken, {
    propertyId: property._id.toString(),
    message: 'Hi from smoke verification test.',
  });

  const pubTenantLandlordRes = await call('GET', `/tenants/${tenant._id}`, candidateToken);
  log('GET /tenants/:id (landlord-with-inquiry)', pubTenantLandlordRes);
  assert(!!pubTenantLandlordRes.data.tenant?.phone,
         'landlord-with-active-inquiry: phone unlocked');

  // 10. Cleanup
  await Inquiry.deleteMany({ propertyOwnerId: candidate._id });
  await Property.deleteOne({ _id: property._id });
  await User.deleteMany({ phone: { $in: phones } });
  console.log('\n[smoke] cleanup done');

  await mongoose.disconnect();
  console.log('\n✓ ALL VERIFICATION-FLOW ASSERTIONS PASSED');
}

main().catch(async (err) => {
  console.error('\n✗ FAILED:', err);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
