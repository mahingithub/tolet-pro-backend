/**
 * 2026-09-06-phone-core.js
 * ─────────────────────────────────────────────────────────────────────────
 * Backfills the normalised phone columns that turn a full index scan into an
 * equality seek.
 *
 * WHY
 * A phone number reaches this app in four different shapes (+8801712345678,
 * 01712345678, 8801712345678, 01712-345678) and they are all one person. With
 * nothing normalised, the only way to compare them was a SUFFIX REGEX:
 *
 *     User.findOne({ phone: new RegExp(`${core}$`) })
 *
 * An index is ordered by prefix, so a suffix pattern has nowhere to start:
 * Mongo reads EVERY key and tests each one. Measured on a 3,000-user seed that
 * is 3,001 keys examined to return 1 row — and it runs once per unlinked
 * booking on every host dashboard load, and on every tenant join.
 *
 * The models now write a `*Core` sibling (last 10 digits) on save, and the
 * queries match on it. This backfills the rows that already exist.
 *
 * WHAT IT WRITES
 *   users.phoneCore                 ← last 10 digits of phone
 *   bookings.tenantPhoneCore        ← last 10 digits of tenantPhone
 *   bookings.members[].phoneCore    ← last 10 digits of that member's phone
 *
 * SAFETY
 *   • ADDITIVE ONLY. No existing field is read destructively or overwritten;
 *     the source phone columns are not touched at all. The worst case of a bad
 *     run is a wrong value in a column nothing else depends on, and re-running
 *     fixes it.
 *   • Idempotent — running it twice changes nothing the second time.
 *   • Safe to run BEFORE or AFTER deploying the code. The queries use a
 *     "fast path, then legacy regex fallback" pattern, so they return correct
 *     results whether or not this has run; the migration only makes them fast.
 *   • Uses an aggregation-pipeline update, so the whole backfill is done by the
 *     server in one pass per collection — no documents cross the wire.
 *
 * Usage:
 *   node migrations/2026-09-06-phone-core.js --dry-run
 *   node migrations/2026-09-06-phone-core.js
 *   MONGO_URI='mongodb+srv://…' node migrations/2026-09-06-phone-core.js
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
const DRY_RUN = argv.includes('--dry-run');

const FALLBACK_URI = 'mongodb://127.0.0.1:27017/tolet';
const MONGO_URI = process.env.MONGO_URI || FALLBACK_URI;
const USING_FALLBACK = !process.env.MONGO_URI;

/** Show which database this is about to touch, without leaking the password. */
function redactUri(u) {
  return String(u).replace(/\/\/[^@]*@/, '//***@');
}

const log = (...a) => console.log(...a);

/**
 * The last-10-digits rule, expressed as a Mongo aggregation expression so the
 * server can apply it to every row without shipping documents to Node.
 *
 * MUST agree with utils/phone.js exactly. The JS side is `replace(/\D/g,'')`,
 * which KEEPS ONLY ASCII 0-9 — so this KEEPS matches of [0-9] rather than
 * stripping a list of known punctuation.
 *
 * That distinction is not academic, and a test caught it: an earlier version
 * here stripped `+ - space ( ) .` and took the last 10 CHARACTERS. Fed the
 * Bengali-numeral form of a number — ০১৭১২৩৪৫৬৭৮, which a landlord can
 * absolutely paste into the intake field, since only User.phone is format-
 * validated — it produced "১৭১২৩৪৫৬৭৮" while JS produced "". A stored core
 * that the application can never generate is a permanent phantom: it matches
 * nothing, and it makes verify() report a mismatch for the life of the row.
 * $regexFindAll over [0-9] removes the whole class of that bug.
 */
function coreExpr(field) {
  const digits = {
    $reduce: {
      input: {
        $regexFindAll: {
          input: { $toString: { $ifNull: [field, ''] } },
          regex: '[0-9]',
        },
      },
      initialValue: '',
      in: { $concat: ['$$value', '$$this.match'] },
    },
  };

  return {
    $let: {
      vars: { s: digits },
      in: {
        $cond: [
          { $gte: [{ $strLenCP: '$$s' }, 10] },
          { $substrCP: ['$$s', { $subtract: [{ $strLenCP: '$$s' }, 10] }, 10] },
          '',
        ],
      },
    },
  };
}

async function backfillUsers(db) {
  const col = db.collection('users');
  const todo = await col.countDocuments({
    phone: { $nin: [null, ''] },
    $or: [{ phoneCore: { $exists: false } }, { phoneCore: '' }],
  });
  log(`users            : ${todo} row(s) need phoneCore`);
  if (DRY_RUN || todo === 0) return 0;

  const res = await col.updateMany(
    { phone: { $nin: [null, ''] } },
    [{ $set: { phoneCore: coreExpr('$phone') } }],
  );
  log(`  → ${res.modifiedCount} updated`);
  return res.modifiedCount;
}

async function backfillBookings(db) {
  const col = db.collection('bookings');
  const todo = await col.countDocuments({
    $or: [
      { tenantPhone: { $nin: [null, ''] }, tenantPhoneCore: { $in: [null, ''] } },
      { 'members.phone': { $nin: [null, ''] }, 'members.phoneCore': { $in: [null, ''] } },
    ],
  });
  log(`bookings         : ${todo} row(s) need a phone core`);
  if (DRY_RUN || todo === 0) return 0;

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
        log('   the legacy regex when a core does not match — but report these.');
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
