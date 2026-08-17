/**
 * 2026-08-17-late-fee-opt-in.js
 * ─────────────────────────────────────────────────────────────────────────
 * Makes the late fee opt-in for leases that already exist.
 *
 * WHY: `Booking.lateFeeAmount` used to default to 500, and no UI ever exposed
 * the field — so every lease in the database carries a ৳500 late fee that its
 * landlord never asked for. The late-fee enforcer has been adding it to overdue
 * months, and the rent reminders now quote it to tenants. Neither should happen
 * unless the landlord set an amount themselves.
 *
 * WHAT IT DOES (default run):
 *   • lateFeeAmount === 500 (the old default)  →  0
 *     Nothing else is touched. Any other value is left alone: if it isn't the
 *     old default, someone chose it deliberately and we don't get to override
 *     that. Landlords who DO want a late fee set it on the lease from here on.
 *
 * WHAT IT DOES NOT DO (unless you ask):
 *   Fees that were ALREADY stamped onto ledger rows stay put, because a ledger
 *   entry is a financial record — clearing it silently changes what a tenant
 *   owes. Pass --clear-applied-fees to also strip `lateFee` from unpaid overdue
 *   rows and drop it back out of `balance`. Review the dry-run output first.
 *
 * Idempotent — safe to re-run. A second pass finds nothing to change.
 *
 * Usage:
 *   Dry run (no writes):   node migrations/2026-08-17-late-fee-opt-in.js --dry-run
 *   Apply:                 node migrations/2026-08-17-late-fee-opt-in.js
 *   Also refund applied:   node migrations/2026-08-17-late-fee-opt-in.js --clear-applied-fees
 *   Specific DB:           MONGO_URI=mongodb://host/tolet node migrations/2026-08-17-late-fee-opt-in.js
 */

'use strict';

const mongoose = require('mongoose');

const argv         = process.argv.slice(2);
const DRY_RUN      = argv.includes('--dry-run');
const CLEAR_APPLIED = argv.includes('--clear-applied-fees');
const MONGO_URI    = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/tolet';

// The value the schema used to default to. Only this exact amount is cleared.
const LEGACY_DEFAULT_FEE = 500;

const Booking = require('../models/Booking');

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 1 — clear the inherited default off the lease terms
// ═══════════════════════════════════════════════════════════════════════════
async function clearDefaultLateFee() {
  log(`▶ Phase 1 — lateFeeAmount ${LEGACY_DEFAULT_FEE} → 0 on lease terms`);

  const match = { lateFeeAmount: LEGACY_DEFAULT_FEE };
  const count = await Booking.countDocuments(match);
  log(`  ${count} lease(s) still carry the old ৳${LEGACY_DEFAULT_FEE} default`);

  if (!count) return { cleared: 0 };
  if (DRY_RUN) {
    const sample = await Booking.find(match).select('property tenant lateFeeAmount').limit(5).lean();
    sample.forEach((b) => log(`  [dry-run] would clear: ${b.property || '(no title)'} — ${b.tenant || '(no tenant)'}`));
    log(`  [dry-run] would clear ${count} lease(s)`);
    return { cleared: 0 };
  }

  const res = await Booking.updateMany(match, { $set: { lateFeeAmount: 0 } });
  log(`  ✓ cleared ${res.modifiedCount} lease(s)`);
  return { cleared: res.modifiedCount };
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 2 — OPTIONAL: back out fees already added to unpaid overdue rows
// ═══════════════════════════════════════════════════════════════════════════
// Only unpaid rows are touched. A PAID row is settled history — the money moved,
// and rewriting it would misstate what was collected.
async function clearAppliedFees() {
  log('▶ Phase 2 — strip applied late fees from UNPAID overdue rows');
  if (!CLEAR_APPLIED) {
    log('  skipped (pass --clear-applied-fees to run it)');
    return { rows: 0, bookings: 0 };
  }

  const cursor = Booking.find({}).cursor();
  let rows = 0;
  let touched = 0;

  // eslint-disable-next-line no-restricted-syntax
  for (let booking = await cursor.next(); booking != null; booking = await cursor.next()) {
    let dirty = false;

    const stripLedger = (ledger, ownerLabel) => {
      if (!ledger || typeof ledger.forEach !== 'function') return;
      const edits = [];
      ledger.forEach((entry, key) => {
        const e = (entry && typeof entry.toObject === 'function') ? entry.toObject() : entry;
        const fee = Number(e && e.lateFee) || 0;
        if (!e || e.paid || fee <= 0) return;
        edits.push([key, { ...e, lateFee: 0, balance: Math.max(0, (Number(e.balance) || 0) - fee) }]);
        log(`  ${DRY_RUN ? '[dry-run] would strip' : 'strip'} ৳${fee} from ${ownerLabel} ${key}`);
      });
      for (const [key, next] of edits) {
        if (!DRY_RUN) ledger.set(key, next);
        rows += 1;
        dirty = true;
      }
    };

    stripLedger(booking.ledger, `${booking.property || 'lease'} (${booking.tenant || 'tenant'})`);
    for (const m of (booking.members || [])) {
      stripLedger(m.ledger, `${booking.property || 'lease'} / ${m.name || 'member'}`);
    }

    if (dirty) {
      touched += 1;
      if (!DRY_RUN) {
        if (booking.members && booking.members.length) booking.markModified('members');
        // eslint-disable-next-line no-await-in-loop
        await booking.save();
      }
    }
  }

  log(`  ${DRY_RUN ? '[dry-run] ' : '✓ '}${rows} row(s) across ${touched} lease(s)`);
  return { rows, bookings: touched };
}

async function main() {
  const banner = DRY_RUN ? '🧪 DRY RUN' : '🚀 APPLY';
  log('═══════════════════════════════════════════════════');
  log(`  ${banner} — late fee becomes opt-in`);
  log('═══════════════════════════════════════════════════');

  await mongoose.connect(MONGO_URI, { autoIndex: false });
  log('Connected to', MONGO_URI.replace(/:\/\/[^@]+@/, '://****@'));

  try {
    await clearDefaultLateFee();
    await clearAppliedFees();
    log('───────────────────────────────────────────────────');
    log('✓ Migration complete.');
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

module.exports = { clearDefaultLateFee, clearAppliedFees, LEGACY_DEFAULT_FEE };
