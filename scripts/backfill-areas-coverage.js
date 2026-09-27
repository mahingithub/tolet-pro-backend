'use strict';

/**
 * ─── ONE-TIME BACKFILL: areas-mode providers with no coverage area ──────────
 *
 * Until the provider app's coverage step could pick thanas, a category on
 * `defaultCoverage: { mode: 'areas' }` — ইন্টারনেট and গৃহকর্মী — saved every
 * registration with `coverage.thanas: []`.
 *
 * An empty list is not "serves everywhere". serviceBrowse matches an areas
 * provider with `$in: [thana, '$coverage.thanas']`, which is FALSE against an
 * empty array for every tenant whose thana is known — that is every tenant who
 * used the location picker. Those providers are active, have paid the
 * registration fee, and cannot be found by anybody.
 *
 * This gives each of them the one area we can defend: their OWN thana, the
 * place they pinned and registered from. It is a floor, not a guess at their
 * real coverage — a গৃহকর্মী almost certainly works the next thana over too —
 * so it makes them findable where they definitely are and leaves the rest to
 * them (Profile → যে এলাকাগুলোতে সেবা দেন).
 *
 * ─── WHAT IT CANNOT DO, STATED PLAINLY ──────────────────────────────────────
 * `Provider.thana` is written by the admin console and by the API, but NOT by
 * the provider app's registration wizard, which sends only a lat/lng pin. So a
 * provider registered entirely through the app has no thana either, and there
 * is nothing here to copy from — we hold a point and no polygons to resolve it
 * against. Those rows are COUNTED AND NAMED at the end rather than guessed at:
 * inventing a coverage area from a district centroid would put a shop in a
 * neighbourhood it does not serve, and a wrong answer is worse than a missing
 * one for the tenant standing there waiting.
 *
 * Reach them the other way instead — the provider app now shows an explicit
 * "ভাড়াটিয়ারা আপনাকে খুঁজে পাচ্ছেন না" warning on the Profile screen with the
 * picker underneath it.
 *
 * SAFE TO RE-RUN: only matches areas-mode providers whose list is still empty.
 *
 * Usage (from the backend repo root). ALWAYS dry-run first, and make sure the
 * connection string points at PRODUCTION — not a local/empty dev DB:
 *
 *     MONGODB_URI="<prod-uri>" node scripts/backfill-areas-coverage.js --dry
 *     MONGODB_URI="<prod-uri>" node scripts/backfill-areas-coverage.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Provider = require('../models/Provider');
const { canonicalThana } = require('../utils/thanaNames');

const MONGO_URI =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  process.env.MONGO_URL ||
  process.env.DATABASE_URL;

const DRY = process.argv.includes('--dry');

async function main() {
  if (!MONGO_URI) {
    console.error('No MONGODB_URI in the environment. Refusing to guess a connection string.');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log(`connected · ${DRY ? 'DRY RUN — nothing will be written' : 'LIVE'}`);

  // Every status, not just `active`. A draft or a pending_review row fixed
  // here is one that never becomes an invisible listing in the first place,
  // and an expired provider who renews should come back findable.
  const rows = await Provider.find({
    'coverage.mode': 'areas',
    $or: [
      { 'coverage.thanas': { $size: 0 } },
      { 'coverage.thanas': { $exists: false } },
    ],
  })
    .select('name category status thana coverage')
    .lean();

  console.log(`${rows.length} areas-mode providers with no coverage area`);

  const fixable = [];
  const stranded = [];
  for (const p of rows) {
    const thana = canonicalThana(p.thana);
    if (thana) fixable.push({ ...p, thana });
    else stranded.push(p);
  }

  if (!DRY && fixable.length) {
    const ops = fixable.map((p) => ({
      updateOne: {
        filter: { _id: p._id },
        // Only the one field. A $set of the whole coverage object would
        // overwrite a radiusKm some of these rows still carry from a category
        // change, and that is not this script's business.
        update: { $set: { 'coverage.thanas': [p.thana] } },
      },
    }));
    const res = await Provider.bulkWrite(ops, { ordered: false });
    console.log(`updated ${res.modifiedCount}`);
  } else if (DRY) {
    for (const p of fixable) {
      console.log(`  would set ${p.category}/${p.name} (${p.status}) → ["${p.thana}"]`);
    }
  }

  if (stranded.length) {
    console.log('');
    console.log(`${stranded.length} could NOT be backfilled — no thana on the record:`);
    for (const p of stranded) {
      console.log(`  ${String(p._id)}  ${p.category}/${p.name}  (${p.status})`);
    }
    console.log('');
    console.log('These registered through the app, which records a pin and no thana name.');
    console.log('They stay unfindable until they pick their areas in the provider app');
    console.log('(Profile → যে এলাকাগুলোতে সেবা দেন), where the screen now warns them.');
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try { await mongoose.disconnect(); } catch { /* already down */ }
  process.exit(1);
});
