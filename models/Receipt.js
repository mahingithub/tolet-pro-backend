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
    bookingId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
    landlordId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tenantId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    propertyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', required: true },

    propertyTitle: { type: String, trim: true, default: '' },
    propertyImage: { type: String, trim: true, default: '' },
    tenantPhone:   { type: String, trim: true, default: '' },

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

// One receipt per booking per month — upsert pattern prevents duplicates.
ReceiptSchema.index({ bookingId: 1, monthKey: 1 }, { unique: true });

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