/**
 * 2026-08-30-member-scoped-rent.js
 * ─────────────────────────────────────────────────────────────────────────
 * Repairs the rent records the member-blind manual-rent path left behind, and
 * backfills the unit (floor / room / seat) onto receipts.
 *
 * WHAT WENT WRONG
 * A booking is either one tenancy or a shared unit whose occupants each carry
 * their own rent + ledger on `members[]`. The manual "I have paid" flow never
 * knew about the second case:
 *
 *   • rentPayment.controller.approveSubmission read the month's obligation off
 *     `booking.monthlyRent + booking.serviceCharge`, so a ৳6,000 seat in a
 *     ৳45,000 flat was approved against ৳45,600. The Receipt was written with
 *     `totalDue: 45600`, `balance: 39600`, `status: 'partial'` and
 *     `memberId: null`;
 *   • the ledger entry landed on `booking.ledger` instead of the occupant's,
 *     so the tenant's own dashboard — which reads their member row — kept
 *     showing the month as unpaid at ৳6,000.
 *
 * One tenant, two screens, two numbers. The code paths are fixed; this
 * migration fixes the rows they already wrote.
 *
 * WHAT IT DOES
 *   Phase 1  RentPaymentSubmission → stamp memberId + memberName + unit.
 *   Phase 2  Receipt → re-point whole-unit receipts at the occupant they were
 *            really for, recompute totalDue/balance/status from THAT
 *            occupant's rent, and move the stranded booking-level ledger entry
 *            onto the member's ledger.
 *   Phase 3  Receipt → backfill floorNumber / roomNumber / seatLabel.
 *
 * SAFETY
 *   • Idempotent — re-running changes nothing once applied.
 *   • Only touches receipts on bookings that HAVE members, whose `memberId` is
 *     null, and where exactly ONE member matches the receipt's tenant. Any
 *     ambiguity is skipped and reported; a wrong guess here rewrites somebody's
 *     payment history, so "leave it and tell a human" is the correct answer.
 *   • `totalPaid` is NEVER changed. That number is money that actually moved.
 *     Only the OBLIGATION it was measured against is corrected.
 *
 * Usage:
 *   node migrations/2026-08-30-member-scoped-rent.js --dry-run
 *   node migrations/2026-08-30-member-scoped-rent.js
 *   MONGO_URI=mongodb://host/tolet node migrations/2026-08-30-member-scoped-rent.js
 *
 * Pre-deploy checklist:
 *   1. mongodump first. This rewrites financial records.
 *   2. Run --dry-run and read the per-receipt lines it prints.
 *   3. Apply, then spot-check one affected tenant's Payments tab against their
 *      overview — the two must now agree.
 */

'use strict';

const mongoose = require('mongoose');

const argv    = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const VERBOSE = argv.includes('--verbose') || argv.includes('-v');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/tolet';

const Booking    = require('../models/Booking');
const Receipt    = require('../models/Receipt');
const Submission = require('../models/RentPaymentSubmission');

const log = (...a) => console.log(...a);
const vlog = (...a) => { if (VERBOSE) console.log(...a); };

function phoneCore(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

/** Money terms for an occupant, applying the same "blank means the unit's" rule the app uses. */
function termsFor(booking, member) {
  const rent = member
    ? (Number(member.monthlyRent) || Number(booking.monthlyRent) || 0)
    : (Number(booking.monthlyRent) || 0);
  const service = member
    ? (member.serviceCharge != null && member.serviceCharge !== 0
        ? Number(member.serviceCharge) || 0
        : Number(booking.serviceCharge) || 0)
    : (Number(booking.serviceCharge) || 0);
  return { rent, service, totalDue: rent + service };
}

function unitFor(booking, member) {
  return {
    floorNumber: String((member && member.floor)     || booking.floorNumber || '').trim(),
    roomNumber:  String((member && member.roomLabel) || booking.roomNumber  || '').trim(),
    seatLabel:   String((member && member.seatLabel) || '').trim(),
  };
}

/**
 * The single member a record belongs to — matched on the linked account first,
 * then on phone. Returns null when there is no match OR more than one, because
 * a guess here rewrites the wrong person's money.
 */
function soleMatchingMember(booking, { tenantId, tenantPhone }) {
  const members = booking.members || [];
  if (!members.length) return null;

  const byId = tenantId
    ? members.filter((m) => m.userId && String(m.userId) === String(tenantId))
    : [];
  if (byId.length === 1) return byId[0];
  if (byId.length > 1) return null;

  const core = phoneCore(tenantPhone);
  if (!core) return null;
  const byPhone = members.filter((m) => phoneCore(m.phone) === core);
  return byPhone.length === 1 ? byPhone[0] : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 1 — submissions get the occupant they were filed by
// ═══════════════════════════════════════════════════════════════════════════
async function backfillSubmissions() {
  log('▶ Phase 1 — RentPaymentSubmission.memberId + unit');

  const rows = await Submission.find({
    $or: [{ memberId: null }, { memberId: { $exists: false } }],
  }).lean();
  log(`  ${rows.length} submission(s) without an occupant`);

  let stamped = 0;
  let skipped = 0;

  for (const s of rows) {
    // eslint-disable-next-line no-await-in-loop
    const booking = await Booking.findById(s.bookingId).lean();
    if (!booking) { skipped += 1; continue; }

    const member = soleMatchingMember(booking, { tenantId: s.tenantId, tenantPhone: s.tenantPhone });
    const unit = unitFor(booking, member);
    const set = { ...unit };
    if (member) {
      set.memberId = member._id;
      set.memberName = member.name || '';
    }
    // Nothing to write for a single-tenant lease with no unit labels.
    if (!member && !unit.floorNumber && !unit.roomNumber) { skipped += 1; continue; }

    vlog(`  ${DRY_RUN ? '[dry-run] ' : ''}${s.monthKey} ${booking.property || 'lease'} → ${member ? (member.name || member._id) : 'whole unit'}`);
    if (!DRY_RUN) {
      // eslint-disable-next-line no-await-in-loop
      await Submission.updateOne({ _id: s._id }, { $set: set });
    }
    stamped += 1;
  }

  log(`  ${DRY_RUN ? '[dry-run] would stamp' : '✓ stamped'} ${stamped}, skipped ${skipped}`);
  return { stamped, skipped };
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 2 — receipts written against the unit, re-pointed at the occupant
// ═══════════════════════════════════════════════════════════════════════════
async function repairWholeUnitReceipts() {
  log('▶ Phase 2 — re-point whole-unit receipts at their occupant');

  const rows = await Receipt.find({
    $or: [{ memberId: null }, { memberId: { $exists: false } }],
  }).lean();

  let repaired = 0;
  let ambiguous = 0;
  let untouched = 0;

  for (const r of rows) {
    // eslint-disable-next-line no-await-in-loop
    const booking = await Booking.findById(r.bookingId);
    if (!booking || !(booking.members || []).length) { untouched += 1; continue; }

    const member = soleMatchingMember(booking, { tenantId: r.tenantId, tenantPhone: r.tenantPhone });
    if (!member) {
      ambiguous += 1;
      log(`  ⚠ ambiguous — receipt ${r._id} (${r.monthKey}, ${booking.property || 'lease'}) matches 0 or >1 occupants; left alone`);
      continue;
    }

    const { rent, service, totalDue } = termsFor(booking, member);
    const unit = unitFor(booking, member);
    // totalPaid is money that moved — never rewritten. Only the obligation it
    // was measured against, and the status derived from the two, are corrected.
    const totalPaid = Number(r.totalPaid) || 0;
    const balance = Math.max(0, totalDue - totalPaid);
    const status = balance <= 0 ? 'full' : 'partial';

    const changed =
      String(r.monthlyRent) !== String(rent) ||
      String(r.serviceCharge) !== String(service) ||
      String(r.totalDue) !== String(totalDue) ||
      String(r.balance) !== String(balance) ||
      r.status !== status;

    log(`  ${DRY_RUN ? '[dry-run] ' : ''}${r.monthKey} ${booking.property || 'lease'} / ${member.name || member._id}: ` +
        `due ৳${r.totalDue} → ৳${totalDue}, balance ৳${r.balance} → ৳${balance}, ${r.status} → ${status}` +
        `${changed ? '' : ' (amounts already correct — only re-pointing)'}`);

    if (!DRY_RUN) {
      // A member receipt for this month may already exist (the tenant re-paid
      // after the fix). Keep that one — it was written by the corrected path —
      // and drop this stale duplicate rather than colliding on the unique index.
      // eslint-disable-next-line no-await-in-loop
      const existing = await Receipt.findOne({
        bookingId: booking._id, memberId: member._id, monthKey: r.monthKey,
      }).lean();
      if (existing) {
        // eslint-disable-next-line no-await-in-loop
        await Receipt.deleteOne({ _id: r._id });
        log(`    ↳ a member receipt already exists for this month; removed the stale whole-unit duplicate`);
      } else {
        // eslint-disable-next-line no-await-in-loop
        await Receipt.updateOne({ _id: r._id }, {
          $set: {
            memberId: member._id,
            memberName: member.name || '',
            tenantId: member.userId || r.tenantId || null,
            tenantPhone: member.phone || r.tenantPhone || '',
            monthlyRent: rent,
            serviceCharge: service,
            totalDue,
            balance,
            status,
            ...unit,
          },
        });
      }

      // Move the stranded ledger entry onto the occupant's own ledger — that is
      // the row the tenant's dashboard reads, and it is why their month still
      // looked unpaid after the landlord had approved it.
      const bookingEntry = booking.ledger.get(r.monthKey);
      if (bookingEntry && !member.ledger.get(r.monthKey)) {
        const e = typeof bookingEntry.toObject === 'function' ? bookingEntry.toObject() : bookingEntry;
        member.ledger.set(r.monthKey, {
          ...e,
          amount: totalPaid,
          balance,
          status,
          paid: true,
        });
        booking.ledger.delete(r.monthKey);
        booking.markModified('members');
        // eslint-disable-next-line no-await-in-loop
        await booking.save();
        log('    ↳ moved the ledger entry onto the occupant');
      }
    }
    repaired += 1;
  }

  log(`  ${DRY_RUN ? '[dry-run] would repair' : '✓ repaired'} ${repaired}, ambiguous ${ambiguous}, not applicable ${untouched}`);
  return { repaired, ambiguous, untouched };
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3 — every receipt learns which unit it is for
// ═══════════════════════════════════════════════════════════════════════════
async function backfillReceiptUnits() {
  log('▶ Phase 3 — Receipt floor / room / seat');

  const rows = await Receipt.find({
    $or: [
      { floorNumber: { $in: [null, ''] } },
      { roomNumber: { $in: [null, ''] } },
      { floorNumber: { $exists: false } },
      { roomNumber: { $exists: false } },
    ],
  }).lean();

  let filled = 0;
  let nothingToSay = 0;

  for (const r of rows) {
    // eslint-disable-next-line no-await-in-loop
    const booking = await Booking.findById(r.bookingId).lean();
    if (!booking) { nothingToSay += 1; continue; }

    const member = r.memberId
      ? (booking.members || []).find((m) => String(m._id) === String(r.memberId))
      : null;
    const unit = unitFor(booking, member);
    if (!unit.floorNumber && !unit.roomNumber && !unit.seatLabel) { nothingToSay += 1; continue; }

    vlog(`  ${DRY_RUN ? '[dry-run] ' : ''}${r.monthKey} ${booking.property || 'lease'} → ${[unit.floorNumber, unit.roomNumber, unit.seatLabel].filter(Boolean).join(' · ')}`);
    if (!DRY_RUN) {
      // eslint-disable-next-line no-await-in-loop
      await Receipt.updateOne({ _id: r._id }, { $set: unit });
    }
    filled += 1;
  }

  log(`  ${DRY_RUN ? '[dry-run] would fill' : '✓ filled'} ${filled}, no labels available for ${nothingToSay}`);
  return { filled, nothingToSay };
}

async function main() {
  log('═══════════════════════════════════════════════════');
  log(`  ${DRY_RUN ? '🧪 DRY RUN' : '🚀 APPLY'} — member-scoped rent records`);
  log('═══════════════════════════════════════════════════');

  await mongoose.connect(MONGO_URI, { autoIndex: false });
  log('Connected to', MONGO_URI.replace(/:\/\/[^@]+@/, '://****@'));

  try {
    await backfillSubmissions();
    await repairWholeUnitReceipts();
    await backfillReceiptUnits();
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

module.exports = { backfillSubmissions, repairWholeUnitReceipts, backfillReceiptUnits };
