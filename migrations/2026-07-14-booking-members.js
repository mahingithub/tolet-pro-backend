/**
 * 2026-07-14-booking-members.js
 * ─────────────────────────────────────────────────────────────────────────
 * Migrates the single-tenant Booking model to the multi-member model:
 *
 *   1. Receipt index swap — drops the old unique index {bookingId, monthKey}
 *      and builds the new {bookingId, memberId, monthKey}. This MUST happen
 *      before per-member receipts can be written, otherwise two members'
 *      receipts for the same booking+month collide on the old index.
 *
 *   2. Legacy tenant → members[0] — every booking that has a tenant but no
 *      members yet gets a members[0] seeded from its tenant fields, with the
 *      legacy ledger copied across so no rent history is lost. An inviteCode
 *      is generated for bookings that don't have one.
 *
 * Idempotent — safe to re-run. Bookings that already have members are skipped.
 *
 * Usage:
 *   Dry run (no writes):  node migrations/2026-07-14-booking-members.js --dry-run
 *   Apply:                node migrations/2026-07-14-booking-members.js
 *   Specific DB:          MONGO_URI=mongodb://host/tolet node migrations/2026-07-14-booking-members.js
 */

'use strict';

const mongoose = require('mongoose');

const argv    = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/tolet';

const Booking = require('../models/Booking');
const Receipt = require('../models/Receipt');

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

// Short invite code (mirrors the controller's generator).
function genInviteCode(len = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
async function uniqueInviteCode() {
  for (let i = 0; i < 8; i += 1) {
    const code = genInviteCode();
    // eslint-disable-next-line no-await-in-loop
    if (!(await Booking.exists({ inviteCode: code }))) return code;
  }
  return genInviteCode(9);
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 1 — Receipt index swap
// ═══════════════════════════════════════════════════════════════════════════
async function swapReceiptIndex() {
  log('▶ Phase 1 — Receipt index swap');
  try {
    await Receipt.collection.dropIndex('bookingId_1_monthKey_1');
    log('  ✓ dropped legacy unique index bookingId_1_monthKey_1');
  } catch (err) {
    log('  (legacy index absent — ok):', err.codeName || err.message);
  }
  if (DRY_RUN) {
    log('  [dry-run] would sync Receipt indexes to {bookingId, memberId, monthKey}');
    return;
  }
  await Receipt.syncIndexes();
  log('  ✓ Receipt indexes synced (new unique {bookingId, memberId, monthKey})');
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 2 — Legacy tenant → members[0]
// ═══════════════════════════════════════════════════════════════════════════
async function seedMembers() {
  log('▶ Phase 2 — seed members[0] from legacy tenant');

  // Bookings with no members yet (empty array or missing).
  const cursor = Booking.find({ 'members.0': { $exists: false } }).cursor();

  let scanned = 0;
  let seeded = 0;
  let skipped = 0;

  // eslint-disable-next-line no-restricted-syntax
  for (let booking = await cursor.next(); booking != null; booking = await cursor.next()) {
    scanned += 1;

    // Idempotency guard (in case a concurrent write added members).
    if (Array.isArray(booking.members) && booking.members.length) { skipped += 1; continue; }

    const hasTenant = booking.tenantId || (booking.tenant && booking.tenant.trim()) || (booking.tenantPhone && booking.tenantPhone.trim());

    // Copy the legacy ledger (a Map) into a plain object for the member.
    const ledgerObj = {};
    if (booking.ledger && typeof booking.ledger.forEach === 'function') {
      booking.ledger.forEach((v, k) => { ledgerObj[k] = (v && typeof v.toObject === 'function') ? v.toObject() : v; });
    }

    if (hasTenant) {
      booking.members.push({
        userId:          booking.tenantId || null,
        name:            booking.tenant || '',
        phone:           booking.tenantPhone || '',
        rentType:        'flat',
        monthlyRent:     Number(booking.monthlyRent) || 0,
        serviceCharge:   Number(booking.serviceCharge) || 0,
        securityDeposit: Number(booking.securityDeposit) || 0,
        joinDate:        booking.leaseStart || booking.createdAt || new Date(),
        status:          'active',
        ledger:          ledgerObj,
      });
      seeded += 1;
    } else {
      skipped += 1;
    }

    if (!booking.inviteCode) {
      // eslint-disable-next-line no-await-in-loop
      booking.inviteCode = await uniqueInviteCode();
    }

    if (!DRY_RUN) {
      // eslint-disable-next-line no-await-in-loop
      await booking.save();
    }
  }

  log(`  scanned=${scanned} seeded=${seeded} skipped=${skipped}${DRY_RUN ? ' [dry-run — no writes]' : ''}`);
  return { scanned, seeded, skipped };
}

async function main() {
  const banner = DRY_RUN ? '🧪 DRY RUN' : '🚀 APPLY';
  log('═══════════════════════════════════════════════════');
  log(`  ${banner} — booking multi-member migration`);
  log('═══════════════════════════════════════════════════');

  await mongoose.connect(MONGO_URI, { autoIndex: false });
  log('Connected to', MONGO_URI.replace(/:\/\/[^@]+@/, '://****@'));

  try {
    await swapReceiptIndex();
    await seedMembers();
    log('───────────────────────────────────────────────────');
    log('✓ Migration complete.');
  } catch (err) {
    log('❌ Migration failed:', err.message);
    log(err.stack);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    log('Disconnected.');
  }
}

// Only auto-run when invoked directly (so tests can require the phases).
if (require.main === module) {
  main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
}

module.exports = { swapReceiptIndex, seedMembers };
