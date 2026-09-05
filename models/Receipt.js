'use strict';

/**
 * Receipt model — standalone rent receipt documents.
 * ──────────────────────────────────────────────────────────────────────────
 * Created automatically when a landlord marks a month as paid (full or
 * partial) in the HostDashboard. The tenant's dashboard, chat system,
 * and notification bell all read from this collection.
 *
 * Previously receipts lived only in localStorage (PAYMENT_RECEIPTS_KEY).
 * This model makes them persistent, queryable, and cross-device.
 *
 * Compound unique index on { bookingId, monthKey } ensures at most one
 * receipt per booking per month — the controller uses findOneAndUpdate
 * with upsert so re-marking a month replaces the old receipt atomically.
 *
 * RENTING-LIFECYCLE ADDITIONS: the receipt now snapshots the full money
 * breakdown (monthlyRent + serviceCharge) AND the landlord's profile
 * (landlordName / landlordPhone) so the tenant's receipt shows "everything
 * from property name to rent to landlord" without a JOIN. These are written
 * by bookingPayment.service.applyPayment.
 */

const mongoose = require('mongoose');

const ReceiptSchema = new mongoose.Schema(
  {
    // NOTE ON INDEXES: none of these four carry `index: true` any more. Each is
    // the leading field of a compound index declared at the bottom of the file,
    // and a compound index already answers every query its prefix could — so a
    // standalone copy bought nothing and cost a second b-tree to write on every
    // receipt issued. See the index block below.
    bookingId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true },
    landlordId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tenantId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Which member (occupant) this receipt belongs to. null = legacy
    // single-tenant / whole-unit receipt. Part of the unique key below so each
    // member gets their own one-receipt-per-month guarantee.
    memberId:   { type: mongoose.Schema.Types.ObjectId, default: null },
    memberName: { type: String, trim: true, default: '' },
    // Optional — manual (non-listed) bookings have no propertyId.
    propertyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', default: null },

    propertyTitle: { type: String, trim: true, default: '' },
    propertyImage: { type: String, trim: true, default: '' },
    tenantPhone:   { type: String, trim: true, default: '' },

    // WHICH UNIT this receipt is for, snapshotted at issue time. A receipt is
    // a document the tenant keeps and may show to somebody later, and
    // "White-house" alone does not identify what was rented when the building
    // holds twenty rooms. Member labels (seat/room) win over the booking's.
    floorNumber: { type: String, trim: true, default: '', maxlength: 40 },
    roomNumber:  { type: String, trim: true, default: '', maxlength: 40 },
    seatLabel:   { type: String, trim: true, default: '', maxlength: 40 },

    // Landlord profile snapshot (so the receipt is self-contained).
    landlordName:  { type: String, trim: true, default: '' },
    landlordPhone: { type: String, trim: true, default: '' },

    monthKey:   { type: String, required: true, trim: true },   // e.g. '2026-05'
    monthLabel: { type: String, trim: true, default: '' },       // e.g. 'May 2026'

    status:    { type: String, enum: ['full', 'partial'], required: true },

    // Money breakdown — base rent + service charge are snapshotted so the
    // receipt can show the full line items, not just the paid total.
    monthlyRent:   { type: Number, default: 0 },
    serviceCharge: { type: Number, default: 0 },
    totalDue:      { type: Number, required: true },
    totalPaid:     { type: Number, required: true },
    balance:       { type: Number, default: 0 },

    method: { type: String, trim: true, default: '' },
    txnId:  { type: String, trim: true, default: '' },
    paidOn: { type: String, default: '' },

    // 'manual' (host marked cash/manual) vs 'gateway' (auto online payment) —
    // HostDashboard renders a badge from this; written by bookingPayment.applyPayment.
    paymentSource: { type: String, enum: ['manual', 'gateway'], default: 'manual' },

    issuedAt: { type: Date, default: Date.now },
    read:     { type: Boolean, default: false },
  },
  { timestamps: true },
);

// One receipt per booking per MEMBER per month — upsert prevents duplicates.
// For legacy / whole-unit receipts memberId is null, so {bookingId, null,
// monthKey} stays unique per booking-month (the old one-per-month guarantee);
// per-member receipts differ by memberId so each occupant gets their own.
// NOTE: the OLD {bookingId, monthKey} unique index must be dropped in the
// database before this one takes effect — see scripts/migrateBookingMembers.js.
ReceiptSchema.index({ bookingId: 1, memberId: 1, monthKey: 1 }, { unique: true });

// ─── Read paths ─────────────────────────────────────────────────────────────
// Receipts are the fastest-growing collection in the app: one row per occupant
// per month, kept forever, because a receipt is a document the tenant is
// entitled to produce years later. That makes an unindexed sort here worse
// every month it runs, which is exactly what the two dashboard queries were
// doing — `landlordId` and `tenantId` had standalone indexes, but `issuedAt`
// had none, so Mongo fetched every one of a landlord's receipts and sorted
// them in memory on each dashboard load.
//
// Putting issuedAt in the index makes the sort disappear: Mongo walks the
// b-tree in issuedAt order and stops at the page boundary.

// GET /api/receipts/host — landlord's issued receipts, newest first.
ReceiptSchema.index({ landlordId: 1, issuedAt: -1 });

// GET /api/receipts/tenant — the tenant's own receipts. The controller matches
// `{ $or: [{ tenantId }, { tenantPhone }] }` because receipts issued before the
// occupant had an account carry only the phone. An $or is only as fast as its
// SLOWEST branch: with tenantPhone unindexed the whole thing fell back to a
// collection scan, so both branches are indexed here.
ReceiptSchema.index({ tenantId: 1, issuedAt: -1 });
ReceiptSchema.index({ tenantPhone: 1, issuedAt: -1 });

ReceiptSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('Receipt', ReceiptSchema);