/**
 * Smoke test for the v2.1 sprint:
 *   1. Property creation w/ `type: 'flat'`, `floorNumber: 3`, `videoUrl: …`
 *   2. Backward-compat: `type: 'apartment'` still accepted, auto-normalised to 'flat'
 *   3. Role-switch route POST /api/auth/me/active-role exists and persists
 *   4. Public GET /api/properties surfaces the freshly-created property
 *
 * Boots an in-memory Mongo + the real Express app (no network calls).
 *
 * Run with:
 *   node scripts/smoke-v21.js
 */
'use strict';

process.env.MONGO_URI  = 'mongodb://placeholder';
process.env.JWT_SECRET = 'devin-smoke-test-secret-which-is-at-least-32-chars-long';
process.env.NODE_ENV   = 'test';
process.env.CORS_ORIGINS = 'http://localhost:5173';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose  = require('mongoose');
const express   = require('express');
const jwt       = require('jsonwebtoken');

(async () => {
  const mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri('toletpro-smoke'));

  // Build a real express app w/ the same wiring as server.js, but without
  // helmet/sanitize/hpp to keep the smoke flow simple. We just want the
  // routers + middleware + models on top of the real DB.
  const app = express();
  app.use(express.json({ limit: '15mb' }));
  app.use('/api/auth',       require('../routes/auth.routes'));
  app.use('/api/properties', require('../routes/property.routes'));
  app.use(require('../middleware/errorHandler'));

  const server = app.listen(0);
  const port   = server.address().port;
  const base   = `http://127.0.0.1:${port}`;

  // ── Seed a host user manually & mint a JWT so we don't need OTP/SMS. ──
  const User = require('../models/User');
  const host = await User.create({
    name: 'Smoke Host',
    phone: '+8801700000001',
    password: 'x'.repeat(60),
    roles: ['landlord', 'tenant'],
    role: 'landlord',
  });
  const token = jwt.sign(
    { sub: host._id.toString(), role: host.role, phone: host.phone },
    process.env.JWT_SECRET,
    { expiresIn: '7d', audience: 'tolet-pro', issuer: 'tolet-pro-backend' },
  );
  const auth = { Authorization: `Bearer ${token}` };

  // ── 1) POST /api/properties with `type: 'flat'` + `floorNumber: 3` ──
  const r1 = await fetch(`${base}/api/properties`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({
      title: 'Smoke v2.1 flat in Gulshan',
      intent: 'rent',
      type: 'flat',
      category: 'family',
      division: 'Dhaka',
      district: 'Dhaka',
      location: 'Gulshan',
      beds: 3,
      baths: 2,
      sqft: 1500,
      floorNumber: 3,
      furnishing: 'Semi-Furnished',
      description: 'A v2.1 smoke-test flat. This description is comfortably more than thirty characters long.',
      amenities: ['wifi', 'parking'],
      videoUrl: 'https://example.com/walkthrough.mp4',
      price: 35000,
      status: 'active',
    }),
  });
  const b1 = await r1.json();
  if (!r1.ok) throw new Error(`POST /properties (flat) failed: ${r1.status} ${JSON.stringify(b1)}`);
  if (b1.property.type !== 'flat') throw new Error(`expected type=flat, got ${b1.property.type}`);
  if (b1.property.floorNumber !== 3) throw new Error(`expected floorNumber=3, got ${b1.property.floorNumber}`);
  if (b1.property.floor !== 3)      throw new Error(`expected floor=3 (mirror), got ${b1.property.floor}`);
  if (b1.property.videoUrl !== 'https://example.com/walkthrough.mp4')
    throw new Error(`expected videoUrl preserved, got ${b1.property.videoUrl}`);
  console.log('[1/4] POST /properties with type=flat + floorNumber + videoUrl → ok');

  // ── 2) Backward-compat: `type: 'apartment'` auto-normalises to 'flat' ──
  const r2 = await fetch(`${base}/api/properties`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({
      title: 'Legacy apartment payload',
      intent: 'rent',
      type: 'apartment',
      category: 'family',
      division: 'Dhaka',
      location: 'Banani',
      beds: 2,
      baths: 1,
      furnishing: 'Unfurnished',
      description: 'Backward-compat smoke. Description padded to clear the thirty-character minimum.',
      amenities: [],
      price: 18000,
      status: 'active',
    }),
  });
  const b2 = await r2.json();
  if (!r2.ok) throw new Error(`POST /properties (apartment) failed: ${r2.status} ${JSON.stringify(b2)}`);
  if (b2.property.type !== 'flat') throw new Error(`apartment should normalize to flat, got ${b2.property.type}`);
  console.log('[2/4] POST /properties with type=apartment → auto-normalised to flat');

  // ── 3) Role switch: POST /api/auth/me/active-role ──
  const r3 = await fetch(`${base}/api/auth/me/active-role`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ role: 'tenant' }),
  });
  const b3 = await r3.json();
  if (!r3.ok) throw new Error(`role switch failed: ${r3.status} ${JSON.stringify(b3)}`);
  if (b3.user.role !== 'tenant') throw new Error(`expected role=tenant, got ${b3.user.role}`);
  console.log('[3/4] POST /api/auth/me/active-role → role flipped to tenant');

  // ── 4) Public GET surfaces the new properties ──
  const r4 = await fetch(`${base}/api/properties`);
  const b4 = await r4.json();
  if (!r4.ok) throw new Error(`public GET failed: ${r4.status}`);
  const titles = (b4.properties || b4 || []).map((p) => p.title);
  const ok = titles.includes('Smoke v2.1 flat in Gulshan') && titles.includes('Legacy apartment payload');
  if (!ok) throw new Error(`new properties missing from public feed: titles=${JSON.stringify(titles)}`);
  console.log('[4/4] GET /api/properties surfaces both new listings → listing sync OK');

  server.close();
  await mongoose.disconnect();
  await mem.stop();
  console.log('\n✅ All v2.1 smoke checks passed');
})().catch((err) => {
  console.error('\n❌ smoke failed:', err);
  process.exit(1);
});
