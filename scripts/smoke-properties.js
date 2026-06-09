'use strict';

/**
 * scripts/smoke-properties.js
 * ─────────────────────────────────────────────────────────────────────────
 * End-to-end smoke test for the property + inquiry backend.
 *
 * Spins up an in-memory MongoDB, mounts the real Express app, signs JWTs
 * for two fake users (host + tenant), then walks through:
 *
 *   1. POST /api/properties  (create as host)
 *   2. GET  /api/properties  (public listing returns the new property)
 *   3. GET  /api/properties/:id  (by id and by slug)
 *   4. GET  /api/properties?q=…  (search across the haystack)
 *   5. GET  /api/host/properties (scoped to the logged-in host)
 *   6. PATCH /api/properties/:id (owner can edit, non-owner can't)
 *   7. POST /api/inquiries (tenant sends inquiry, can't self-inquiry)
 *   8. GET  /api/host/inquiries (host sees the lead)
 *   9. PATCH /api/inquiries/:id/status (host updates status)
 *  10. DELETE /api/properties/:id (owner can delete, non-owner can't)
 *
 * Run with `npm run smoke:properties`.
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

(async () => {
  const mem = await MongoMemoryServer.create();
  process.env.MONGO_URI = mem.getUri('tolet-properties-smoke');
  process.env.JWT_SECRET = process.env.JWT_SECRET
    || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.NODE_ENV = 'test';
  process.env.PORT = '0'; // ask the kernel for any free port

  const env = require('../config/env');
  await mongoose.connect(env.mongoUri);

  const User = require('../models/User');
  const tokenService = require('../services/token.service');

  // ─── Test fixtures ──────────────────────────────────────────────────────
  // `passwordChangedAt` must be safely earlier than the JWT `iat` claim,
  // otherwise requireAuth will reject the token as "password changed". JWT
  // `iat` is truncated to seconds so a same-instant create + sign races; we
  // backdate by 5s to give ourselves headroom.
  const passwordChangedAt = new Date(Date.now() - 5000);
  const host = await User.create({
    name: 'Host Hanna', phone: '+8801710000001', password: 'placeholder12',
    role: 'landlord', phoneVerified: true, passwordChangedAt,
  });
  const tenant = await User.create({
    name: 'Tenant Tara', phone: '+8801710000002', password: 'placeholder34',
    role: 'tenant', phoneVerified: true, passwordChangedAt,
  });
  const stranger = await User.create({
    name: 'Stranger Sam', phone: '+8801710000003', password: 'placeholder56',
    role: 'landlord', phoneVerified: true, passwordChangedAt,
  });
  const hostJwt     = tokenService.signAccessToken(host);
  const tenantJwt   = tokenService.signAccessToken(tenant);
  const strangerJwt = tokenService.signAccessToken(stranger);

  // We deliberately do NOT require ../server.js — it auto-calls start() and
  // would try to listen on env.port. We reconstruct the same middleware
  // pipeline locally so we can run on an ephemeral port and tear it down at
  // the end of the test.
  const express = require('express');
  const cors = require('cors');
  const helmet = require('helmet');
  const mongoSanitize = require('express-mongo-sanitize');
  const hpp = require('hpp');
  const authRoutes     = require('../routes/auth.routes');
  const propertyRoutes = require('../routes/property.routes');
  const inquiryRoutes  = require('../routes/inquiry.routes');
  const hostRoutes     = require('../routes/host.routes');
  const errorHandler   = require('../middleware/errorHandler');

  const testApp = express();
  testApp.set('trust proxy', 1);
  testApp.use(helmet());
  testApp.use(cors());
  testApp.use(express.json({ limit: '15mb' }));
  testApp.use(mongoSanitize());
  testApp.use(hpp());
  testApp.get('/healthz', (_req, res) => res.json({ ok: true }));
  testApp.use('/api/auth',       authRoutes);
  testApp.use('/api/properties', propertyRoutes);
  testApp.use('/api/inquiries',  inquiryRoutes);
  testApp.use('/api/host',       hostRoutes);
  testApp.use(errorHandler);

  const server = testApp.listen(0);
  const port = server.address().port;
  const BASE = `http://127.0.0.1:${port}`;

  async function req(path, { method = 'GET', body, jwt } = {}) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  const TESTS = [];
  function test(name, fn) { TESTS.push({ name, fn }); }

  // ─── 1. CRUD ────────────────────────────────────────────────────────────
  let createdId = null;
  let createdSlug = null;

  test('POST /api/properties (no auth) → 401', async () => {
    const r = await req('/api/properties', { method: 'POST', body: { title: 'x' } });
    if (r.status !== 401) throw new Error(`status ${r.status}`);
  });

  test('POST /api/properties (missing required fields) → 400', async () => {
    const r = await req('/api/properties', {
      method: 'POST',
      jwt: hostJwt,
      body: { title: 'Y' },
    });
    if (r.status !== 400) throw new Error(`status ${r.status}`);
  });

  test('POST /api/properties (valid host payload) → 201 + slug + haystack', async () => {
    const r = await req('/api/properties', {
      method: 'POST',
      jwt: hostJwt,
      body: {
        title: 'Cozy 3-bed flat in Dhanmondi 12',
        description: 'Spacious family apartment near Lake Park.',
        intent: 'rent',
        type: 'apartment',
        category: 'family',
        division: 'dhaka',
        district: 'dhaka',
        area: 'Dhanmondi 12',
        location: 'Dhanmondi-12, Road 4, Block A',
        beds: 3,
        baths: 2,
        sqft: 1450,
        floor: 5,
        furnishing: 'Semi-Furnished',
        amenities: ['Lift', 'Parking', 'Generator'],
        price: 32000,
        coverPhoto: 'https://example.com/cover.jpg',
        roomPhotos: [
          { room: 'bedroom', url: 'https://example.com/bed.jpg' },
          { room: 'kitchen', preview: 'https://example.com/kit.jpg' },
        ],
      },
    });
    if (r.status !== 201) throw new Error(`status ${r.status} body=${JSON.stringify(r.data)}`);
    if (!r.data.property?.id) throw new Error('missing property.id');
    if (!r.data.property?.slug) throw new Error('missing slug');
    if (r.data.property.landlordName !== 'Host Hanna') throw new Error('landlordName not snapshotted');
    if (r.data.property.searchHaystack) throw new Error('searchHaystack should be stripped from JSON');
    if (r.data.property.roomPhotos.length !== 2) throw new Error('roomPhotos.preview not normalised to url');
    createdId = r.data.property.id;
    createdSlug = r.data.property.slug;
  });

  // ─── 2. List + search ───────────────────────────────────────────────────
  test('GET /api/properties → returns the new listing', async () => {
    const r = await req('/api/properties');
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (!Array.isArray(r.data.properties) || r.data.properties.length < 1) {
      throw new Error('no properties returned');
    }
  });

  test('GET /api/properties?q=dhanmondi → matches', async () => {
    const r = await req('/api/properties?q=dhanmondi');
    if (r.data.properties.length !== 1) throw new Error(`expected 1, got ${r.data.properties.length}`);
  });

  test('GET /api/properties?q=dhanmondi+12 → matches (two-token search)', async () => {
    const r = await req('/api/properties?q=dhanmondi%2012');
    if (r.data.properties.length !== 1) throw new Error(`expected 1, got ${r.data.properties.length}`);
  });

  test('GET /api/properties?q=dhaka+flat → matches (alias-driven)', async () => {
    const r = await req('/api/properties?q=dhaka%20flat');
    if (r.data.properties.length !== 1) throw new Error(`expected 1, got ${r.data.properties.length}`);
  });

  test('GET /api/properties?q=family+apartment → matches', async () => {
    const r = await req('/api/properties?q=family%20apartment');
    if (r.data.properties.length !== 1) throw new Error(`expected 1, got ${r.data.properties.length}`);
  });

  test('GET /api/properties?q=mongolia → empty', async () => {
    const r = await req('/api/properties?q=mongolia');
    if (r.data.properties.length !== 0) throw new Error('false positive');
  });

  test('GET /api/properties?division=chittagong → empty (filter works)', async () => {
    const r = await req('/api/properties?division=chittagong');
    if (r.data.properties.length !== 0) throw new Error('division filter broken');
  });

  test('GET /api/properties?division=dhaka → matches', async () => {
    const r = await req('/api/properties?division=dhaka');
    if (r.data.properties.length !== 1) throw new Error('division filter dropped match');
  });

  test('GET /api/properties?minPrice=50000 → empty (price filter)', async () => {
    const r = await req('/api/properties?minPrice=50000');
    if (r.data.properties.length !== 0) throw new Error('price filter broken');
  });

  // ─── 3. Read-by-id / by-slug ────────────────────────────────────────────
  test('GET /api/properties/:id → resolves', async () => {
    const r = await req(`/api/properties/${createdId}`);
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (r.data.property.id !== createdId) throw new Error('id mismatch');
  });

  test('GET /api/properties/:slug → resolves by slug', async () => {
    const r = await req(`/api/properties/${createdSlug}`);
    if (r.status !== 200) throw new Error(`slug lookup status ${r.status}`);
  });

  test('GET /api/properties/missing-id → 404', async () => {
    const r = await req('/api/properties/000000000000000000000000');
    if (r.status !== 404) throw new Error(`status ${r.status}`);
  });

  // ─── 4. Host scope ──────────────────────────────────────────────────────
  test('GET /api/host/properties (no auth) → 401', async () => {
    const r = await req('/api/host/properties');
    if (r.status !== 401) throw new Error(`status ${r.status}`);
  });

  test('GET /api/host/properties (host) → 1 listing', async () => {
    const r = await req('/api/host/properties', { jwt: hostJwt });
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (r.data.properties.length !== 1) throw new Error(`expected 1 own listing, got ${r.data.properties.length}`);
  });

  test('GET /api/host/properties (stranger) → 0 listings', async () => {
    const r = await req('/api/host/properties', { jwt: strangerJwt });
    if (r.data.properties.length !== 0) throw new Error(`stranger sees host's listing`);
  });

  // ─── 5. Update ──────────────────────────────────────────────────────────
  test('PATCH /api/properties/:id (non-owner) → 403', async () => {
    const r = await req(`/api/properties/${createdId}`, {
      method: 'PATCH',
      jwt: strangerJwt,
      body: { price: 99999 },
    });
    if (r.status !== 403) throw new Error(`status ${r.status}`);
  });

  test('PATCH /api/properties/:id (owner) → 200 + haystack reflects change', async () => {
    const r = await req(`/api/properties/${createdId}`, {
      method: 'PATCH',
      jwt: hostJwt,
      body: { price: 35000, area: 'Bashundhara R/A' },
    });
    if (r.status !== 200) throw new Error(`status ${r.status} ${JSON.stringify(r.data)}`);
    if (r.data.property.price !== 35000) throw new Error('price not updated');
    if (r.data.property.area !== 'Bashundhara R/A') throw new Error('area not updated');

    // Verify the haystack reflects the new area — search for it.
    const after = await req('/api/properties?q=bashundhara');
    if (after.data.properties.length !== 1) throw new Error('haystack not recomputed on update');
  });

  // ─── 6. Inquiry ─────────────────────────────────────────────────────────
  let inquiryId = null;

  test('POST /api/inquiries (no auth) → 401', async () => {
    const r = await req('/api/inquiries', { method: 'POST', body: { propertyId: createdId, message: 'hi' } });
    if (r.status !== 401) throw new Error(`status ${r.status}`);
  });

  test('POST /api/inquiries (host inquires on own listing) → 400 self_inquiry', async () => {
    const r = await req('/api/inquiries', {
      method: 'POST',
      jwt: hostJwt,
      body: { propertyId: createdId, message: 'self' },
    });
    if (r.status !== 400) throw new Error(`status ${r.status}`);
    if (r.data.code !== 'self_inquiry') throw new Error(`code ${r.data.code}`);
  });

  test('POST /api/inquiries (tenant) → 201', async () => {
    const r = await req('/api/inquiries', {
      method: 'POST',
      jwt: tenantJwt,
      body: { propertyId: createdId, message: 'Is this available for July move-in?' },
    });
    if (r.status !== 201) throw new Error(`status ${r.status} body=${JSON.stringify(r.data)}`);
    if (r.data.inquiry.tenantName !== 'Tenant Tara') throw new Error('tenant snapshot missing');
    if (r.data.inquiry.landlordName !== 'Host Hanna') throw new Error('landlord snapshot missing');
    inquiryId = r.data.inquiry.id;
  });

  test('GET /api/host/inquiries (host) → sees the inquiry', async () => {
    const r = await req('/api/host/inquiries', { jwt: hostJwt });
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (r.data.inquiries.length !== 1) throw new Error(`expected 1, got ${r.data.inquiries.length}`);
  });

  test('GET /api/host/inquiries (stranger) → 0', async () => {
    const r = await req('/api/host/inquiries', { jwt: strangerJwt });
    if (r.data.inquiries.length !== 0) throw new Error('cross-host inquiry leak');
  });

  test('PATCH /api/inquiries/:id/status (non-owner) → 403', async () => {
    const r = await req(`/api/inquiries/${inquiryId}/status`, {
      method: 'PATCH', jwt: strangerJwt, body: { status: 'closed' },
    });
    if (r.status !== 403) throw new Error(`status ${r.status}`);
  });

  test('PATCH /api/inquiries/:id/status (host) → 200', async () => {
    const r = await req(`/api/inquiries/${inquiryId}/status`, {
      method: 'PATCH', jwt: hostJwt, body: { status: 'replied' },
    });
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (r.data.inquiry.status !== 'replied') throw new Error('status not updated');
  });

  // ─── 7. Delete ──────────────────────────────────────────────────────────
  test('DELETE /api/properties/:id (non-owner) → 403', async () => {
    const r = await req(`/api/properties/${createdId}`, { method: 'DELETE', jwt: strangerJwt });
    if (r.status !== 403) throw new Error(`status ${r.status}`);
  });

  test('DELETE /api/properties/:id (owner) → 200', async () => {
    const r = await req(`/api/properties/${createdId}`, { method: 'DELETE', jwt: hostJwt });
    if (r.status !== 200) throw new Error(`status ${r.status}`);
  });

  test('GET /api/properties/:id (after delete) → 404', async () => {
    const r = await req(`/api/properties/${createdId}`);
    if (r.status !== 404) throw new Error(`status ${r.status}`);
  });

  // ─── Run ────────────────────────────────────────────────────────────────
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
  server.close();
  await mongoose.disconnect();
  await mem.stop();
  process.exit(fail ? 1 : 0);
})();
