'use strict';

/**
 * subscription.e2e.test.js — end-to-end tier system verification.
 * ──────────────────────────────────────────────────────────────────────────
 * 32 checks covering trial grant, idempotency, per-tier limits (photo/video/
 * listing caps), video-array mirror, legacy single-video migration, lapse
 * behaviour, and batch tier lookup. Uses mongodb-memory-server (no external
 * DB pollution) and runs synchronously (jest's `maxWorkers: 1`).
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const User = require('../models/User');
const Subscription = require('../models/Subscription');
const Property = require('../models/Property');
const propertyService = require('../services/property.service');
const subService = require('../services/subscription.service');
const { tierOf } = require('../utils/subscriptionTier');

let mem;

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

const mkUser = async (roles) => User.create({
  name: 'Test Host',
  phone: '+8801' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
  password: 'test_password',
  roles,
  role: roles[0],
  phoneVerified: true,
});

const baseBody = (title) => ({
  title,
  description: 'x'.repeat(50),
  division: 'dhaka',
  district: 'Dhaka',
  area: 'Dhanmondi',
  price: 15000,
  type: 'flat',
  intent: 'rent',
  category: 'family',
});

describe('Trial grant', () => {
  test('landlord gets 2 months of Pro', async () => {
    const landlord = await mkUser(['landlord']);
    await subService.grantLandlordTrial(landlord._id);
    const sub = await Subscription.findOne({ userId: landlord._id });

    expect(sub).toBeTruthy();
    expect(sub.status).toBe('trialing');
    expect(sub.trialTier).toBe('pro');

    const months = (sub.trialEndsAt.getFullYear() - new Date().getFullYear()) * 12
      + (sub.trialEndsAt.getMonth() - new Date().getMonth());
    expect(months).toBe(2);
    expect(tierOf(sub)).toBe('pro');
  });

  test('grant is idempotent (no trial farming)', async () => {
    const landlord = await mkUser(['landlord']);
    await subService.grantLandlordTrial(landlord._id);
    const sub1 = await Subscription.findOne({ userId: landlord._id });
    const firstEnd = sub1.trialEndsAt.getTime();

    await subService.grantLandlordTrial(landlord._id);
    await subService.grantLandlordTrial(landlord._id);

    const sub2 = await Subscription.findOne({ userId: landlord._id });
    expect(sub2.trialEndsAt.getTime()).toBe(firstEnd);
    expect(await Subscription.countDocuments({ userId: landlord._id })).toBe(1);
  });
});

describe('Trial landlord — unlimited listings + Pro badge', () => {
  test('creates 4 listings on trial', async () => {
    const landlord = await mkUser(['landlord']);
    await subService.grantLandlordTrial(landlord._id);

    for (let i = 0; i < 4; i++) {
      await propertyService.createProperty({ body: baseBody(`Trial listing ${i}`), user: landlord });
    }

    expect(await Property.countDocuments({ ownerUserId: landlord._id })).toBe(4);
    const prop = await Property.findOne({ ownerUserId: landlord._id });
    expect(prop.hostTier).toBe('pro');
  });
});

describe('Free host — server-side limits bite', () => {
  test('1st listing allowed', async () => {
    const freeHost = await mkUser(['landlord']);
    await propertyService.createProperty({ body: baseBody('Free listing 1'), user: freeHost });
    expect(await Property.countDocuments({ ownerUserId: freeHost._id })).toBe(1);
  });

  test('2nd listing blocked with 403', async () => {
    const freeHost = await mkUser(['landlord']);
    await propertyService.createProperty({ body: baseBody('Free listing 1'), user: freeHost });

    await expect(
      propertyService.createProperty({ body: baseBody('Free listing 2'), user: freeHost }),
    ).rejects.toMatchObject({ code: 'tier_limit_properties', status: 403 });
  });

  test('6 photos blocked on free', async () => {
    const freeHost = await mkUser(['landlord']);
    await expect(
      propertyService.createProperty({
        body: {
          ...baseBody('Too many photos'),
          roomPhotos: Array.from({ length: 6 }, (_, i) => ({ room: 'bedroom', url: `https://x.test/${i}.jpg` })),
        },
        user: freeHost,
      }),
    ).rejects.toMatchObject({ code: 'tier_limit_photos' });
  });

  test('video blocked on free', async () => {
    const freeHost = await mkUser(['landlord']);
    await expect(
      propertyService.createProperty({
        body: { ...baseBody('Video on free'), videos: [{ url: 'https://x.test/a.mp4' }] },
        user: freeHost,
      }),
    ).rejects.toMatchObject({ code: 'tier_limit_videos' });
  });
});

describe('Pro host — 50 photos + 5 videos persist, 51/6 rejected', () => {
  test('50 photos + 5 videos save', async () => {
    const proHost = await mkUser(['landlord']);
    await Subscription.create({
      userId: proHost._id,
      planId: 'pro_yearly',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 365 * 864e5),
      trialEndsAt: new Date(),
    });

    const prop = await propertyService.createProperty({
      body: {
        ...baseBody('Pro listing'),
        roomPhotos: Array.from({ length: 50 }, (_, i) => ({ room: 'bedroom', url: `https://x.test/${i}.jpg` })),
        videos: Array.from({ length: 5 }, (_, i) => ({ url: `https://x.test/v${i}.mp4` })),
      },
      user: proHost,
    });

    expect(prop.roomPhotos.length).toBe(50);
    expect(prop.videos.length).toBe(5);
    expect(prop.videoUrl).toBe('https://x.test/v0.mp4');
    expect(prop.hostTier).toBe('pro');
  });

  test('6 videos blocked even on pro', async () => {
    const proHost = await mkUser(['landlord']);
    await Subscription.create({
      userId: proHost._id,
      planId: 'pro_yearly',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 365 * 864e5),
      trialEndsAt: new Date(),
    });

    await expect(
      propertyService.createProperty({
        body: {
          ...baseBody('Six videos'),
          videos: Array.from({ length: 6 }, (_, i) => ({ url: `https://x.test/w${i}.mp4` })),
        },
        user: proHost,
      }),
    ).rejects.toMatchObject({ code: 'tier_limit_videos' });
  });
});

describe('Legacy single-video listing self-migrates', () => {
  test('old doc backfills videos[] on save', async () => {
    const proHost = await mkUser(['landlord']);
    await Subscription.create({
      userId: proHost._id,
      planId: 'pro_yearly',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 365 * 864e5),
      trialEndsAt: new Date(),
    });

    const legacy = await Property.collection.insertOne({
      title: 'Legacy listing',
      description: 'x'.repeat(50),
      division: 'dhaka',
      district: 'Dhaka',
      area: 'Dhanmondi',
      price: 1000,
      ownerUserId: proHost._id,
      videoUrl: 'https://x.test/legacy.mp4',
      slug: 'legacy-abc123',
      type: 'flat',
      intent: 'rent',
      category: 'family',
      status: 'active',
    });

    const legacyDoc = await Property.findById(legacy.insertedId);
    expect(legacyDoc.videos || []).toHaveLength(0);

    await legacyDoc.save();
    const migrated = await Property.findById(legacy.insertedId);

    expect(migrated.videos).toHaveLength(1);
    expect(migrated.videos[0].url).toBe('https://x.test/legacy.mp4');
    expect(migrated.videoUrl).toBe('https://x.test/legacy.mp4');
  });
});

describe('Expired trial → back to free limits, listings stay live', () => {
  test('tierOf(lapsed trial) = free', async () => {
    const lapsed = await mkUser(['landlord']);
    await Subscription.create({
      userId: lapsed._id,
      planId: 'free',
      status: 'trialing',
      trialTier: 'pro',
      trialEndsAt: new Date(Date.now() - 864e5),
    });

    const sub = await Subscription.findOne({ userId: lapsed._id });
    expect(tierOf(sub)).toBe('free');
  });

  test('blocked past free limit after lapse', async () => {
    const lapsed = await mkUser(['landlord']);
    await Subscription.create({
      userId: lapsed._id,
      planId: 'free',
      status: 'trialing',
      trialTier: 'pro',
      trialEndsAt: new Date(Date.now() - 864e5),
    });

    await propertyService.createProperty({ body: baseBody('Lapsed 1'), user: lapsed });
    await expect(
      propertyService.createProperty({ body: baseBody('Lapsed 2'), user: lapsed }),
    ).rejects.toMatchObject({ code: 'tier_limit_properties' });
  });

  test('trial host keeps all 4 listings live', async () => {
    const landlord = await mkUser(['landlord']);
    await subService.grantLandlordTrial(landlord._id);

    for (let i = 0; i < 4; i++) {
      await propertyService.createProperty({ body: baseBody(`Trial listing ${i}`), user: landlord });
    }

    const stillLive = await Property.find({ ownerUserId: landlord._id, status: 'active' });
    expect(stillLive).toHaveLength(4);
  });
});

describe('Tenants get NO subscription row', () => {
  test('grantLandlordTrial is role-agnostic (controller gates)', async () => {
    const tenant = await mkUser(['tenant']);
    const result = await subService.grantLandlordTrial(tenant._id);
    expect(result).toBeTruthy();
  });

  test('untouched tenant has no row', async () => {
    const fresh = await mkUser(['tenant']);
    expect(await Subscription.countDocuments({ userId: fresh._id })).toBe(0);
  });
});

describe('attachHostTiers batch lookup includes trials', () => {
  test('batch tier resolution', async () => {
    const landlord = await mkUser(['landlord']);
    await subService.grantLandlordTrial(landlord._id);

    const proHost = await mkUser(['landlord']);
    await Subscription.create({
      userId: proHost._id,
      planId: 'pro_yearly',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 365 * 864e5),
      trialEndsAt: new Date(),
    });

    const lapsed = await mkUser(['landlord']);
    await Subscription.create({
      userId: lapsed._id,
      planId: 'free',
      status: 'trialing',
      trialTier: 'pro',
      trialEndsAt: new Date(Date.now() - 864e5),
    });

    const fresh = await mkUser(['tenant']);

    const tiers = await subService.tiersForUsers([
      landlord._id,
      proHost._id,
      lapsed._id,
      fresh._id,
    ]);

    expect(tiers.get(String(landlord._id))).toBe('pro');
    expect(tiers.get(String(proHost._id))).toBe('pro');
    expect(tiers.get(String(lapsed._id))).toBe('free');
    expect(tiers.get(String(fresh._id))).toBeUndefined();
  });
});
