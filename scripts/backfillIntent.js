'use strict';

/**
 * ─── ONE-TIME MIGRATION: normalise legacy listing-intent values ──────────────
 *
 * Brings existing property docs onto the canonical intent set introduced with
 * the Dynamic Tab Architecture:
 *
 *     'sell' | 'buy' | 'purchase'  →  'sale'
 *     missing | null | ''          →  'rent'   (this app began life as a
 *                                               "to-let" board — any
 *                                               intent-less legacy listing is a
 *                                               rental)
 *
 * Docs already holding 'rent' / 'sale' / 'commercial' are left untouched. For
 * every doc it DOES touch, the searchHaystack is rebuilt (via the model's
 * exported builder) so free-text search of the literal word ("sale") lines up
 * too — not just the intent-tab filter.
 *
 * Implementation notes:
 *   • Reads only the light fields needed to rebuild the haystack (projection) —
 *     never pulls the base64 cover/room/video blobs, so it can't OOM the way
 *     the old list queries did.
 *   • Writes via a single bulkWrite on the raw collection — no per-doc Mongoose
 *     validation or hook overhead.
 *   • SAFE TO RE-RUN: only matches docs that still hold a legacy/blank value.
 *
 * Usage (from the backend repo root). ALWAYS dry-run first, and make sure the
 * connection string points at PRODUCTION — not a local/empty dev DB:
 *
 *     MONGODB_URI="<prod-uri>" node scripts/backfillIntent.js --dry
 *     MONGODB_URI="<prod-uri>" node scripts/backfillIntent.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Property = require('../models/Property'); // for Property.buildSearchHaystack

const MONGO_URI =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  process.env.MONGO_URL ||
  process.env.DATABASE_URL;

const DRY = process.argv.includes('--dry');

const LEGACY_SALE = new Set(['sell', 'buy', 'purchase']);

function canonicalIntent(raw) {
  const v = String(raw || '').toLowerCase().trim();
  if (LEGACY_SALE.has(v)) return 'sale';
  return 'rent'; // missing / blank / anything else we deliberately touched
}

// Only the fields buildSearchHaystack reads — deliberately excludes the heavy
// base64 media fields so this stays memory-safe on a big collection.
const HAYSTACK_PROJECTION = {
  _id: 1, intent: 1,
  title: 1, description: 1, division: 1, district: 1, area: 1, location: 1,
  gps: 1, type: 1, category: 1, furnishing: 1, amenities: 1, ownerName: 1,
};

async function main() {
  if (!MONGO_URI) {
    console.error(
      '✗ No Mongo connection string found. Set MONGODB_URI ' +
      '(or MONGO_URI / MONGO_URL / DATABASE_URL). Aborting.'
    );
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  const col = mongoose.connection.collection('properties');

  // Docs that still hold a legacy or blank intent.
  const selector = {
    $or: [
      { intent: { $in: ['sell', 'buy', 'purchase'] } },
      { intent: { $exists: false } },
      { intent: null },
      { intent: '' },
    ],
  };

  const affected = await col.find(selector).project(HAYSTACK_PROJECTION).toArray();
  console.log(`→ ${affected.length} doc(s) with a legacy/blank intent.`);

  if (affected.length === 0) {
    console.log('Nothing to migrate. ✓');
    await mongoose.disconnect();
    process.exit(0);
  }

  const ops = affected.map((doc) => {
    const intent = canonicalIntent(doc.intent);
    const searchHaystack = Property.buildSearchHaystack({ ...doc, intent });
    return {
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { intent, searchHaystack } },
      },
    };
  });

  const toSale = ops.filter((o) => o.updateOne.update.$set.intent === 'sale').length;
  const toRent = ops.length - toSale;
  console.log(`   → sale: ${toSale}   → rent: ${toRent}`);

  if (DRY) {
    console.log('Dry run — no writes performed.');
    await mongoose.disconnect();
    process.exit(0);
  }

  const result = await col.bulkWrite(ops, { ordered: false });
  console.log(`✓ Migrated ${result.modifiedCount} doc(s).`);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('✗ Migration failed:', err);
  process.exit(1);
});
