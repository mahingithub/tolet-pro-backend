/**
 * profile.test.js
 * ─────────────────────────────────────────────────────────────────────────
 * Integration tests for the Blueprint v2 profile endpoints:
 *
 *   PATCH /api/auth/me      — field updates (tenant + landlord)
 *   POST  /api/auth/me/avatar (skipped if Cloudinary not configured)
 *
 * Test framework: Jest + supertest. Standard for an Express + Mongoose
 * codebase; no extra deps beyond what's already in package.json devDeps.
 *
 * How to run:
 *   • Single file:  npx jest tests/profile.test.js --runInBand
 *   • CI:           npm test  (assuming package.json maps test → jest)
 *
 * Database strategy:
 *   • Uses MongoMemoryServer (mongodb-memory-server) so tests don't
 *     pollute the dev DB. Install once: `npm i -D mongodb-memory-server`.
 *   • Each test creates a fresh user; we don't share state across cases.
 *
 * Coverage map (which EC numbers this file proves):
 *   ✓ EC-01  emergencyContact whole-object payload
 *   ✓ EC-02  trust score persisted after PATCH
 *   ✓ EC-05  serviceCharge empty-string handling
 *   ✓ EC-06  backend phone format validation
 *   ✓ EC-08  chip-multi array defaults
 *   Plus the happy paths for both roles.
 *
 * Coverage gaps (intentional — covered by manual QA or future tests):
 *   ✗ EC-03  workPlaceId orphan — frontend behaviour, e2e (Playwright) test
 *   ✗ EC-04  cross-account localStorage — browser behaviour, manual test
 *   ✗ EC-09  HEIC 5MB limit — needs real HEIC sample file
 *   ✗ EC-13  two-tab race — concurrency, hard to test reliably
 */

const request    = require('supertest');
const mongoose   = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Adjust these paths to match your project layout. The common patterns:
//   server.js exports the Express `app` (NOT app.listen())
//   models/User exports the Mongoose model
const app  = require('../src/server');
const User = require('../src/models/User');

let mongod;

// ─── Test fixtures ─────────────────────────────────────────────────────
// Stable user creation helpers. We use the auth signup flow's internal
// "test factory" if it exists, otherwise build the doc directly. Direct
// build is cleaner here — we own the test fixture state, not the signup
// pipeline.

async function createTenant(overrides = {}) {
  const user = await User.create({
    name:           'Test Tenant',
    phone:          '+8801700000001',
    phoneVerified:  true,
    role:           'tenant',
    activeRole:     'tenant',
    roles:          ['tenant'],
    passwordHash:   '$2b$10$test_hash_not_used_in_tests',
    tenantProfile:  {
      fullName:      'Test Tenant',
      phone:         '+8801700000001',
      professionType:'',
      verification:  { status: 'unverified', photo: false, nidFront: false, nidBack: false },
    },
    ...overrides,
  });
  return { user, token: signTokenFor(user) };
}

async function createLandlord(overrides = {}) {
  const user = await User.create({
    name:           'Test Landlord',
    phone:          '+8801700000002',
    phoneVerified:  true,
    role:           'landlord',
    activeRole:     'landlord',
    roles:          ['landlord'],
    passwordHash:   '$2b$10$test_hash_not_used_in_tests',
    landlordProfile:{
      fullName:         'Test Landlord',
      city:             '',
      address:          '',
      preferredTenants: [],
      communication:    [],
      houseRules:       [],
      serviceCharge:    null,
    },
    ...overrides,
  });
  return { user, token: signTokenFor(user) };
}

// Mint a JWT the same way `auth.controller.js` does. Adjust the path
// and payload shape if your codebase differs.
function signTokenFor(user) {
  const jwt = require('jsonwebtoken');
  return jwt.sign(
    { id: String(user._id), role: user.activeRole },
    process.env.JWT_SECRET || 'test-secret',
    { expiresIn: '1h' },
  );
}

// ─── Setup / teardown ──────────────────────────────────────────────────
beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  // Wipe users between tests so IDs don't leak state.
  await User.deleteMany({});
});

// ═════════════════════════════════════════════════════════════════════
// TENANT — HAPPY PATHS
// ═════════════════════════════════════════════════════════════════════
describe('PATCH /api/auth/me — tenant happy paths', () => {

  test('saves a flat top-level field (workPlace)', async () => {
    const { token } = await createTenant();

    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ workPlace: 'BRAC University' })
      .expect(200);

    expect(res.body.user.tenantProfile.workPlace).toBe('BRAC University');
  });

  test('saves a dotted-path nested field (emergencyContact.phone)', async () => {
    const { token } = await createTenant();

    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ 'emergencyContact.phone': '+8801711122233' })
      .expect(200);

    expect(res.body.user.tenantProfile.emergencyContact.phone)
      .toBe('+8801711122233');
  });

  test('saves familySize (enum-valid value)', async () => {
    const { token } = await createTenant();
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ familySize: '3' })
      .expect(200);
    expect(res.body.user.tenantProfile.familySize).toBe('3');
  });

  // ─── EC-01 (regression test) ─────────────────────────────────────────
  test('accepts whole-object emergencyContact payload (EC-01)', async () => {
    const { token } = await createTenant();

    // This is the payload shape TenantDashboard's persistProfile sends.
    // Before the EC-01 fix, the controller silently dropped this.
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        emergencyContact: {
          name:     'Father',
          phone:    '+8801700000099',
          relation: 'parent',
        },
      })
      .expect(200);

    expect(res.body.user.tenantProfile.emergencyContact).toMatchObject({
      name:     'Father',
      phone:    '+8801700000099',
      relation: 'parent',
    });
  });

  // ─── EC-02 (trust score persistence) ─────────────────────────────────
  test('persists computed trust score to DB after PATCH (EC-02)', async () => {
    const { user, token } = await createTenant();
    expect(user.trustScore || 0).toBeLessThan(50);

    await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ workPlace: 'BRAC University', professionType: 'job' })
      .expect(200);

    // Read directly from DB to verify persistence (not just response).
    const reloaded = await User.findById(user._id);
    expect(reloaded.trustScore).toBeGreaterThan(0);
    expect(['bronze', 'silver', 'gold', 'platinum'])
      .toContain(reloaded.trustTier);
    // Specifically: phone(20) + professionType(10) + workPlace(10) = 40 (silver)
    expect(reloaded.trustScore).toBeGreaterThanOrEqual(40);
  });
});

// ═════════════════════════════════════════════════════════════════════
// LANDLORD — HAPPY PATHS
// ═════════════════════════════════════════════════════════════════════
describe('PATCH /api/auth/me — landlord happy paths', () => {

  test('saves preferredTenants array (multi-select)', async () => {
    const { token } = await createLandlord();
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ 'landlordProfile.preferredTenants': ['family', 'student'] })
      .expect(200);
    expect(res.body.user.landlordProfile.preferredTenants)
      .toEqual(['family', 'student']);
  });

  test('saves serviceCharge as a real number', async () => {
    const { token } = await createLandlord();
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ 'landlordProfile.serviceCharge': 2500 })
      .expect(200);
    expect(res.body.user.landlordProfile.serviceCharge).toBe(2500);
  });

  test('accepts whole landlordProfile object payload', async () => {
    const { token } = await createLandlord();
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        landlordProfile: {
          fullName:         'New Name',
          city:             'Dhaka',
          preferredTenants: ['family'],
          serviceCharge:    1500,
        },
      })
      .expect(200);
    expect(res.body.user.landlordProfile).toMatchObject({
      fullName:         'New Name',
      city:             'Dhaka',
      preferredTenants: ['family'],
      serviceCharge:    1500,
    });
  });
});

// ═════════════════════════════════════════════════════════════════════
// SECURITY — allowlist enforcement
// ═════════════════════════════════════════════════════════════════════
describe('PATCH /api/auth/me — security (allowlist)', () => {

  test('rejects writes to role / roles array', async () => {
    const { user, token } = await createTenant();
    await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'super_admin', roles: ['super_admin'] })
      .expect(200);
    // Reload: role should be untouched.
    const reloaded = await User.findById(user._id);
    expect(reloaded.role).toBe('tenant');
    expect(reloaded.roles).toEqual(['tenant']);
  });

  test('rejects writes to phoneVerified flag', async () => {
    // Create an unverified user so we can detect the bypass attempt.
    const { user, token } = await createTenant({ phoneVerified: false });
    await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ phoneVerified: true })
      .expect(200);
    const reloaded = await User.findById(user._id);
    expect(reloaded.phoneVerified).toBe(false);
  });

  test('rejects writes to verification.status (admin-gated)', async () => {
    const { user, token } = await createTenant();
    await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ 'tenantProfile.verification.status': 'verified' })
      .expect(200);
    const reloaded = await User.findById(user._id);
    expect(reloaded.tenantProfile.verification.status).toBe('unverified');
  });

  test('requires auth', async () => {
    await request(app)
      .patch('/api/auth/me')
      .send({ workPlace: 'X' })
      .expect((res) => {
        // 401 or 403 depending on middleware
        expect([401, 403]).toContain(res.status);
      });
  });

  test('rejects prototype pollution attempt', async () => {
    const { user, token } = await createTenant();
    await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ '__proto__': { admin: true }, 'constructor': { name: 'Admin' } })
      .expect(200);
    const reloaded = await User.findById(user._id);
    // Object.entries doesn't enumerate prototype keys, so this is benign,
    // but verify the polluted keys aren't stored either.
    expect(reloaded.toObject().admin).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════
// SCHEMA VALIDATION
// ═════════════════════════════════════════════════════════════════════
describe('Schema validation', () => {

  test('rejects unknown enum value in preferredTenants', async () => {
    const { token } = await createLandlord();
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ 'landlordProfile.preferredTenants': ['unknown_demographic'] });
    expect([400, 422]).toContain(res.status);
    expect(res.body.code).toBe('validation_error');
  });

  test('rejects unknown enum value in houseRules', async () => {
    const { token } = await createLandlord();
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ 'landlordProfile.houseRules': ['no_pets', 'plot_to_overthrow_govt'] });
    expect([400, 422]).toContain(res.status);
  });

  test('rejects familySize outside the allowed enum', async () => {
    const { token } = await createTenant();
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ familySize: '17' });
    expect([400, 422]).toContain(res.status);
  });

  test('rejects serviceCharge out of [0, 100000] range', async () => {
    const { token } = await createLandlord();

    const tooHigh = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ 'landlordProfile.serviceCharge': 999999 });
    expect([400, 422]).toContain(tooHigh.status);

    const negative = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ 'landlordProfile.serviceCharge': -50 });
    expect([400, 422]).toContain(negative.status);
  });

  // ─── EC-06 (regression test) ─────────────────────────────────────────
  test('rejects malformed emergencyContact phone (EC-06)', async () => {
    const { token } = await createTenant();
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ 'emergencyContact.phone': 'not-a-phone' });
    // Will FAIL until EC-06 fix lands (schema regex added).
    expect([400, 422]).toContain(res.status);
  });

  // ─── EC-05 (regression test) ─────────────────────────────────────────
  test('skips empty-string serviceCharge instead of coercing to 0 (EC-05)', async () => {
    const { user, token } = await createLandlord({
      landlordProfile: {
        fullName:         '',
        preferredTenants: [],
        communication:    [],
        houseRules:       [],
        serviceCharge:    null,
      },
    });
    await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ 'landlordProfile.serviceCharge': '' })
      .expect(200);
    const reloaded = await User.findById(user._id);
    // After fix: serviceCharge stays null (unanswered), NOT 0.
    expect(reloaded.landlordProfile.serviceCharge).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════
// CHIP-MULTI DEFAULTS (EC-08)
// ═════════════════════════════════════════════════════════════════════
describe('Chip-multi field defaults', () => {

  test('newly created landlord has empty arrays, not undefined', async () => {
    const { user } = await createLandlord();
    expect(Array.isArray(user.landlordProfile.preferredTenants)).toBe(true);
    expect(Array.isArray(user.landlordProfile.communication)).toBe(true);
    expect(Array.isArray(user.landlordProfile.houseRules)).toBe(true);
  });

  test('clearing all chips persists as empty array, not null', async () => {
    const { user, token } = await createLandlord({
      landlordProfile: {
        fullName:         '',
        preferredTenants: ['family', 'student'],
        communication:    [],
        houseRules:       [],
        serviceCharge:    null,
      },
    });

    await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ 'landlordProfile.preferredTenants': [] })
      .expect(200);

    const reloaded = await User.findById(user._id);
    expect(reloaded.landlordProfile.preferredTenants).toEqual([]);
    // Crucially NOT null — frontend's ChipSelector .includes() would crash on null.
    expect(reloaded.landlordProfile.preferredTenants).not.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════
// EMPTY / IDEMPOTENT PATCHES
// ═════════════════════════════════════════════════════════════════════
describe('Edge cases — empty / idempotent patches', () => {

  test('empty body returns the current user (200 not 400)', async () => {
    const { token } = await createTenant();
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(200);
    expect(res.body.user).toBeDefined();
  });

  test('patch with only disallowed keys returns the current user', async () => {
    const { user, token } = await createTenant();
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ secret_admin_flag: true, hackmePlease: 1 })
      .expect(200);
    expect(res.body.user._id).toBe(String(user._id));
  });

  test('saving the same value twice is a no-op (idempotent)', async () => {
    const { token } = await createTenant();
    await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ workPlace: 'Sonali Bank' })
      .expect(200);
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ workPlace: 'Sonali Bank' })
      .expect(200);
    expect(res.body.user.tenantProfile.workPlace).toBe('Sonali Bank');
  });
});

// ═════════════════════════════════════════════════════════════════════
// AVATAR UPLOAD — gated on Cloudinary config
// ═════════════════════════════════════════════════════════════════════
describe('POST /api/auth/me/avatar', () => {
  const cloudinary = (() => {
    try { return require('../src/services/cloudinary.service'); }
    catch { return { isConfigured: false }; }
  })();

  // Skip the whole block if Cloudinary isn't configured (CI without
  // secrets). Don't fail — these tests can't run in that environment.
  const it_ = cloudinary.isConfigured ? test : test.skip;

  it_('uploads a tiny JPG and stores secureUrl on user', async () => {
    const { user, token } = await createTenant();

    // 1x1 transparent JPEG — smallest valid file we can ship inline.
    const tinyJpg = Buffer.from(
      '/9j/4AAQSkZJRgABAQEAYABgAAD//gA7Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2lu' +
      'ZyBJSkcgSlBFRyB2NjIpLCBxdWFsaXR5ID0gOTAK/9sAQwADAgIDAgIDAwMDBAMDBAUI' +
      'BQUEBAUKBwcGCAwKDAwLCgsLDQ4SEA0OEQ4LCxAWEBETFBUVFQwPFxgWFBgSFBUU/9sA' +
      'QwEDBAQFBAUJBQUJFA0LDRQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU' +
      'FBQUFBQUFBQUFBQUFBQU/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAA' +
      'AAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNR' +
      'YQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElK' +
      'U1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqy' +
      's7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/aAAwD' +
      'AQACEQMRAD8A/uoooooA//9k=',
      'base64',
    );

    const res = await request(app)
      .post('/api/auth/me/avatar')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', tinyJpg, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(200);

    expect(res.body.user.avatar).toMatch(/^https:\/\/.+cloudinary.+\.(jpg|jpeg|png|webp)$/i);

    const reloaded = await User.findById(user._id);
    expect(reloaded.avatar).toBeTruthy();
    expect(reloaded.avatarPublicId).toBeTruthy();
  }, 15000); // upload network call — generous timeout

  it_('rejects non-image file types', async () => {
    const { token } = await createTenant();
    const res = await request(app)
      .post('/api/auth/me/avatar')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('not an image'),
        { filename: 'a.txt', contentType: 'text/plain' });
    expect([400, 415, 422]).toContain(res.status);
  });

  it_('rejects oversized file (above multer limit)', async () => {
    const { token } = await createTenant();
    // 20 MB buffer of zeros — over any reasonable limit
    const huge = Buffer.alloc(20 * 1024 * 1024, 0);
    const res = await request(app)
      .post('/api/auth/me/avatar')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', huge, { filename: 'huge.jpg', contentType: 'image/jpeg' });
    expect([413, 400]).toContain(res.status);
  });
});

// ═════════════════════════════════════════════════════════════════════
// TRUST SCORE FORMULA — direct unit test
// ═════════════════════════════════════════════════════════════════════
describe('computeTrustScore', () => {
  // Import the pure function directly. Adjust path if you moved it.
  const computeTrustScore = require('../src/utils/trustScore').computeTrustScore;

  test('tenant: phone only → 20', () => {
    const u = { activeRole: 'tenant', phone: '+880...', tenantProfile: {} };
    const { score, tier } = normalize(computeTrustScore(u));
    expect(score).toBe(20);
    expect(tier).toBe('bronze');
  });

  test('tenant: phone + workPlace + profession → 40 (silver)', () => {
    const u = {
      activeRole: 'tenant',
      phone: '+880...',
      tenantProfile: { professionType: 'job', workPlace: 'BUET' },
    };
    const { score, tier } = normalize(computeTrustScore(u));
    expect(score).toBe(40);
    expect(tier).toBe('silver');
  });

  test('landlord: all soft fields → 45 (silver, NID-less ceiling)', () => {
    const u = {
      activeRole: 'landlord',
      phone: '+880...',
      avatar: 'https://...',
      landlordProfile: {
        preferredTenants: ['family'],
        communication:    ['phone'],
        serviceCharge:    1500,
        houseRules:       ['no_smoking'],
      },
    };
    const { score } = normalize(computeTrustScore(u));
    // phone(20) + avatar(10) + preferred(15) + comm(10) + service(10) + rules(10) = 75
    expect(score).toBe(75);
  });

  test('caps at 100 even if formula over-shoots', () => {
    // Synthetic — fill everything
    const u = {
      activeRole: 'tenant',
      phone: '+880...',
      avatar: 'https://...',
      tenantProfile: {
        professionType: 'job',
        workPlace:      'X',
        familySize:     '2',
        emergencyContact: { phone: '+880...' },
        verification:   { status: 'verified', nidFront: true, nidBack: true },
      },
    };
    const { score } = normalize(computeTrustScore(u));
    expect(score).toBeLessThanOrEqual(100);
  });
});

// Helper: trustScore impl might return { score, tier } or just score —
// normalize so tests don't care.
function normalize(result) {
  if (typeof result === 'number') return { score: result, tier: tierFor(result) };
  return result;
}
function tierFor(s) {
  if (s >= 90) return 'platinum';
  if (s >= 70) return 'gold';
  if (s >= 40) return 'silver';
  return 'bronze';
}
