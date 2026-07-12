'use strict';

/**
 * Booking model — lease + rent-ledger persistence.
 * ──────────────────────────────────────────────────────────────────────────
 * Each booking represents a signed lease between a landlord and a tenant
 * for a specific property. The embedded `ledger` map tracks monthly rent
 * payments — each key is a 'YYYY-MM' string, each value is a payment
 * entry matching the shape HostDashboard.jsx already reads/writes.
 *
 * The frontend previously stored bookings in React state only (lost on
 * refresh). This model makes them persistent + queryable from both the
 * host and tenant dashboards, the admin panel, and future analytics.
 */

const mongoose = require('mongoose');

// Payment entry sub-schema — validates what goes into ledger.<monthKey>.
const LedgerEntrySchema = new mongoose.Schema(
  {
    paid:          { type: Boolean, default: false },
    status:        { type: String, enum: ['scheduled', 'pending', 'due', 'overdue', 'full', 'partial'], default: 'full' },
    paidOn:        { type: String, default: '' },
    method:        { type: String, default: '' },
    txnId:         { type: String, default: '' },
    amount:        { type: Number, default: 0 },
    balance:       { type: Number, default: 0 },
    lateFee:       { type: Number, default: 0 },
    dueNote:       { type: String, default: '' },
    expectedPayBy: { type: String, default: '' },
    // How this entry was settled — distinguishes auto gateway payments from
    // manual cash/host entries (HostDashboard shows a badge based on this).
    paymentSource: { type: String, enum: ['manual', 'gateway'], default: 'manual' },
  },
  { _id: false },
);

const BookingSchema = new mongoose.Schema(
  {
    landlordId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tenantId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    propertyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
    inquiryId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Inquiry', default: null },

    // Denormalized display fields so dashboards don't need JOINs every render.
    property:    { type: String, trim: true, default: '', maxlength: 200 },
    // Property location, denormalized from the Property record at create time
    // so the booking + rent views can show it without an extra JOIN.
    location:    { type: String, trim: true, default: '', maxlength: 300 },
    tenant:      { type: String, trim: true, default: '', maxlength: 100 },
    tenantPhone: { type: String, trim: true, default: '', maxlength: 20 },
    // How many people will live in the unit (prefilled from the tenant's
    // family-members count when the profile is linked).
    tenantsCount: { type: Number, default: 1, min: 1, max: 50 },

    // Lease terms
    leaseStart:       { type: Date, required: true },
    leaseEnd:         { type: Date, required: true },
    monthlyRent:      { type: Number, required: true, min: 0 },
    // One-time advance / booking money collected up front, plus the channel it
    // was collected through (bKash | Nagad | Rocket | Bank Transfer | Cash).
    advancePayment:   { type: Number, default: 0, min: 0 },
    paymentMethod:    { type: String, trim: true, default: '', maxlength: 40 },
    rentDueDay:       { type: Number, default: 5, min: 1, max: 28 },
    gracePeriodDays:  { type: Number, default: 5, min: 0, max: 28 },
    lateFeeAmount:    { type: Number, default: 500, min: 0 },
    reminderLeadDays: { type: Number, default: 3 },
    autoReminder:     { type: Boolean, default: true },
    serviceCharge:    { type: Number, default: 0 },
    securityDeposit:  { type: Number, default: 0 },
    notes:            { type: String, trim: true, default: '', maxlength: 2000 },

    // Legacy chat thread reference — kept for ChatSystem backward compat.
    chatId: { type: String, default: '' },

    // Monthly rent ledger — Map of 'YYYY-MM' → LedgerEntry.
    ledger: { type: Map, of: LedgerEntrySchema, default: {} },

    deletedAt:        { type: Date, default: null },

    status: {
      type: String,
      enum: ['draft', 'active', 'completed', 'cancelled'],
      default: 'active',
      index: true,
    },
  },
  { timestamps: true },
);

BookingSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    // Convert the Map to a plain object so the frontend can read it as
    // `booking.ledger['2026-05']` without Map semantics.
    if (ret.ledger instanceof Map) {
      const plain = {};
      ret.ledger.forEach((v, k) => { plain[k] = v; });
      ret.ledger = plain;
    }
    return ret;
  },
});

// ─── Compound indexes for AI Insights aggregations ─────────────────────────
// Revenue queries filter by landlordId + sort by createdAt descending.
BookingSchema.index({ landlordId: 1, createdAt: -1 });
// Occupancy / property-scoped queries filter by propertyId + status.
BookingSchema.index({ propertyId: 1, status: 1 });

module.exports = mongoose.model('Booking', BookingSchema);