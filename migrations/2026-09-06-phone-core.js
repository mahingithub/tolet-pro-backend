/**
 * Backfill complete E.164 comparison keys in users and bookings.
 * Existing *Core names/indexes are retained, but country codes are preserved.
 * This older entry point updates keys only. For canonical raw phone storage
 * and a duplicate-account preflight, use 2026-09-14-foreign-phone-core.js.
 * Neither migration should run while old suffix-matching app versions write.
 * Usage: node migrations/2026-09-06-phone-core.js --dry-run
 * Add --apply to write keys. Omitting it is always a dry run.
 */

'use strict';

// Load .env FIRST. Without this the MONGO_URI below is undefined and the script
// silently falls through to the localhost default — connecting to whatever
// empty database happens to be running there, reporting "0 rows need
// backfilling", and exiting 0. That reads exactly like success. It is how this
// migration appeared to have run against production when it had not.
require('dotenv').config();

const mongoose = require('mongoose');

const argv    = process.argv.slice(2);
const DRY_RUN = !argv.includes('--apply') || argv.includes('--dry-run');

const FALLBACK_URI = 'mongodb://127.0.0.1:27017/tolet';
const MONGO_URI = process.env.MONGO_URI || FALLBACK_URI;
const USING_FALLBACK = !process.env.MONGO_URI;

/** Show which database this is about to touch, without leaking the password. */
function redactUri(u) {
  return String(u).replace(/\/\/[^@]*@/, '//***@');
}

const log = (...a) => console.log(...a);

/** Mongo aggregation equivalent of utils/phone.normalizePhone. */
function coreExpr(field) {
  const str = { $toString: { $ifNull: [field, ''] } };
  // The explicit whitespace set is ECMAScript \\s, including Unicode spaces.
  // Preserve letters and + instead of deleting arbitrary non-digits.
  const formatting = '\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff().-';
  const compact = {
    $reduce: {
      input: { $regexFindAll: { input: str, regex: `[^${formatting}]` } },
      initialValue: '',
      in: { $concat: ['$$value', '$$this.match'] },
    },
  };
  return {
    $let: {
      vars: { s: compact },
      in: {
        $switch: {
          branches: [
            { case: { $regexMatch: { input: '$$s', regex: '^\\+[1-9][0-9]{7,14}$' } }, then: '$$s' },
            { case: { $regexMatch: { input: '$$s', regex: '^8801[3-9][0-9]{8}$' } }, then: { $concat: ['+', '$$s'] } },
            { case: { $regexMatch: { input: '$$s', regex: '^01[3-9][0-9]{8}$' } }, then: { $concat: ['+880', { $substrCP: ['$$s', 1, 10] }] } },
            { case: { $regexMatch: { input: '$$s', regex: '^1[3-9][0-9]{8}$' } }, then: { $concat: ['+880', '$$s'] } },
          ],
          default: '',
        },
      },
    },
  };
}

async function backfillUsers(db, { dryRun = DRY_RUN } = {}) {
  const col = db.collection('users');
  const todo = await col.countDocuments({
    phone: { $nin: [null, ''] },
    $expr: { $ne: [{ $ifNull: ['$phoneCore', ''] }, coreExpr('$phone')] },
  });
  log(`users            : ${todo} row(s) need phoneCore`);
  if (dryRun || todo === 0) return 0;

  const res = await col.updateMany(
    { phone: { $nin: [null, ''] } },
    [{ $set: { phoneCore: coreExpr('$phone') } }],
  );
  log(`  → ${res.modifiedCount} updated`);
  return res.modifiedCount;
}

async function backfillBookings(db, { dryRun = DRY_RUN } = {}) {
  const col = db.collection('bookings');
  const todo = await col.countDocuments({
    $expr: { $or: [
      { $ne: [{ $ifNull: ['$tenantPhoneCore', ''] }, coreExpr('$tenantPhone')] },
      { $anyElementTrue: [{ $map: {
        input: { $ifNull: ['$members', []] },
        as: 'm',
        in: { $ne: [{ $ifNull: ['$$m.phoneCore', ''] }, coreExpr('$$m.phone')] },
      } }] },
    ] },
  });
  log(`bookings         : ${todo} row(s) need a phone core`);
  if (dryRun || todo === 0) return 0;

  const res = await col.updateMany({}, [
    {
      $set: {
        tenantPhoneCore: coreExpr('$tenantPhone'),
        // Rewrite members[] in place, adding phoneCore to each element and
        // leaving every other field of the subdocument exactly as it was.
        members: {
          $map: {
            input: { $ifNull: ['$members', []] },
            as: 'm',
            in: {
              $mergeObjects: ['$$m', { phoneCore: coreExpr('$$m.phone') }],
            },
          },
        },
      },
    },
  ]);
  log(`  → ${res.modifiedCount} updated`);
  return res.modifiedCount;
}

/** Prove the backfill agrees with the JS implementation on real rows. */
async function verify(db) {
  const { phoneCore } = require('../utils/phone');
  let checked = 0;
  let bad = 0;

  const users = await db.collection('users')
    .find({ phone: { $nin: [null, ''] } }).project({ phone: 1, phoneCore: 1 })
    .limit(500).toArray();
  for (const u of users) {
    checked += 1;
    if (u.phoneCore !== phoneCore(u.phone)) {
      bad += 1;
      if (bad <= 5) log(`  ✗ user ${u._id}: stored "${u.phoneCore}" ≠ expected "${phoneCore(u.phone)}"`);
    }
  }

  const bookings = await db.collection('bookings')
    .find({}).project({ tenantPhone: 1, tenantPhoneCore: 1, 'members.phone': 1, 'members.phoneCore': 1 })
    .limit(500).toArray();
  for (const b of bookings) {
    checked += 1;
    if ((b.tenantPhoneCore || '') !== phoneCore(b.tenantPhone)) {
      bad += 1;
      if (bad <= 5) log(`  ✗ booking ${b._id}: tenantPhoneCore mismatch`);
    }
    for (const m of b.members || []) {
      checked += 1;
      if ((m.phoneCore || '') !== phoneCore(m.phone)) {
        bad += 1;
        if (bad <= 5) log(`  ✗ booking ${b._id} member: "${m.phoneCore}" ≠ "${phoneCore(m.phone)}"`);
      }
    }
  }

  log(`verify           : ${checked} value(s) checked, ${bad} mismatch(es)`);
  return bad;
}

async function main() {
  log('───────────────────────────────────────────────────');
  log(DRY_RUN ? 'phone-core backfill — DRY RUN' : 'phone-core backfill');
  log('───────────────────────────────────────────────────');

  // Say out loud where this is going. A migration that reports "0 rows" is
  // either a no-op or a wrong-database connection, and those look identical
  // unless the target is printed.
  if (USING_FALLBACK) {
    log('⚠️  MONGO_URI is not set — falling back to the local default.');
    log(`   ${FALLBACK_URI}`);
    log('   If you meant to migrate production, stop and set MONGO_URI.\n');
  }

  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;
  log(`connected → ${mongoose.connection.name}  (${redactUri(MONGO_URI)})\n`);

  try {
    await backfillUsers(db);
    await backfillBookings(db);

    if (!DRY_RUN) {
      log('');
      const bad = await verify(db);
      if (bad > 0) {
        log('\n⚠️  Mismatches found. The app still works — its queries fall back to');
        log('   anchored complete-number matching, but report these mismatches.');
        process.exitCode = 1;
      }
    }

    log('\n✓ Done.');
    if (DRY_RUN) log('  (dry run — nothing was written)');
  } catch (err) {
    log('❌ Migration failed:', err.message);
    log(err.stack);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    log('Disconnected.');
  }
}

if (require.main === module) {
  main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
}

module.exports = { backfillUsers, backfillBookings, verify, coreExpr };
