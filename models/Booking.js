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
    // 'submitted' = tenant filed a manual "I have paid" claim that is awaiting
    // landlord verification (V1 manual rent flow). It is NOT a paid state —
    // paid flips to true only when the landlord approves (full/partial).
    status:        { type: String, enum: ['scheduled', 'pending', 'submitted', 'due', 'overdue', 'full', 'partial'], default: 'full' },
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

// ─── Member sub-schema — one occupant of the property ────────────────────────
// A booking can hold MANY members (a hostel / mess / room-share). Each member
// carries their OWN monthly rent ledger, so "who paid which month" is tracked
// per person, not per unit. Mirrors the Household.members[] pattern: a real
// linked app user (userId set) or a placeholder (userId:null) until they join
// via the booking's inviteCode / are matched by phone.
const MemberSchema = new mongoose.Schema(
  {
    userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    name:     { type: String, trim: true, default: '', maxlength: 100 },
    phone:    { type: String, trim: true, default: '', maxlength: 20 },
    avatar:   { type: String, default: '', maxlength: 512 },

    // What this person rents: whole flat / a room / a single seat (hostel).
    rentType: { type: String, enum: ['flat', 'room', 'seat'], default: 'flat' },
    // Optional space labels — floors "stay as they are", these are just labels
    // used to group + display the rent register (floor → room → seat).
    floor:     { type: String, trim: true, default: '', maxlength: 40 },
    roomLabel: { type: String, trim: true, default: '', maxlength: 40 },
    seatLabel: { type: String, trim: true, default: '', maxlength: 40 },

    // Per-member money terms. Default from the booking's monthlyRent when omitted.
    monthlyRent:     { type: Number, default: 0, min: 0 },
    serviceCharge:   { type: Number, default: 0, min: 0 },
    securityDeposit: { type: Number, default: 0, min: 0 },

    joinDate:    { type: Date, default: Date.now },
    moveOutDate: { type: Date, default: null },
    status:      { type: String, enum: ['active', 'moved-out'], default: 'active' },

    // This member's OWN monthly rent ledger — SAME shape as the booking-level
    // ledger, so every existing rent helper (getRentStatus, etc.) works on it.
    ledger: { type: Map, of: LedgerEntrySchema, default: {} },

    // Reminder de-dupe: the 'YYYY-MM' we last reminded this member about, so the
    // daily cron never double-sends for the same due month.
    lastReminderKey: { type: String, default: '' },
    lastReminderAt:  { type: Date, default: null },
  },
  { _id: true },
);

// Give members the same Map→object + id serialisation the booking uses, so the
// frontend reads `member.ledger['2026-05']` and `member.id` directly.
MemberSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    if (ret.ledger instanceof Map) {
      const plain = {};
      ret.ledger.forEach((v, k) => { plain[k] = v; });
      ret.ledger = plain;
    }
    return ret;
  },
});

const BookingSchema = new mongoose.Schema(
  {
    landlordId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tenantId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    // Optional: a booking is either linked to a listing (propertyId) OR created
    // manually with just a typed property name (propertyId null). Manual entry
    // lets a host add multiple bookings that aren't tied to a single listing.
    propertyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', default: null, index: true },
    inquiryId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Inquiry', default: null },

    // Denormalized display fields so dashboards don't need JOINs every render.
    property:    { type: String, trim: true, default: '', maxlength: 200 },
    // Property location, denormalized from the Property record at create time
    // so the booking + rent views can show it without an extra JOIN.
    location:    { type: String, trim: true, default: '', maxlength: 300 },
    // Property type (flat / sublet / hostel / …), denormalized so dashboards
    // can decide multi-member (HOSTEL only) vs classic single-tenant (everything
    // else) without a JOIN. Empty on legacy rows until the migration backfills it.
    propertyType: { type: String, trim: true, default: '', maxlength: 40 },
    // Residential rental vs commercial lease. Drives the distinct commercial
    // booking form + badges. Derived from the property's `intent` at create
    // time (commercial when intent==='commercial'); residential by default so
    // every legacy/manual booking keeps its current behaviour.
    dealType: {
      type: String,
      enum: ['residential', 'commercial'],
      default: 'residential',
      index: true,
    },
    // Unit location within the property. Floor for all formats; room number for
    // single-room + hostel bookings. Hostel seats live per-member (members[]).
    floorNumber: { type: String, trim: true, default: '', maxlength: 40 },
    roomNumber:  { type: String, trim: true, default: '', maxlength: 40 },
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

    // ─── Commercial lease terms (only populated when dealType==='commercial') ─
    // Commercial deals track the tenant's business/trade identity + a fixed
    // tenure instead of family occupants / hostel seats. monthlyRent,
    // advancePayment, securityDeposit and leaseStart/leaseEnd above are reused
    // by BOTH flows, so only the commercial-only extras live here.
    commercialTerms: {
      businessName:    { type: String, trim: true, default: '', maxlength: 160 },
      // Trade licence number — OPTIONAL.
      licenseNumber:   { type: String, trim: true, default: '', maxlength: 60 },
      // Fixed lease tenure in months (e.g. 24 = a 2-year lease).
      leaseTermMonths: { type: Number, default: 0, min: 0, max: 600 },
    },

    // Legacy chat thread reference — kept for ChatSystem backward compat.
    chatId: { type: String, default: '' },

    // Monthly rent ledger — Map of 'YYYY-MM' → LedgerEntry. This is the LEGACY
    // single-tenant ledger. Multi-member bookings keep each occupant's rent in
    // members[].ledger instead; this stays for backward compatibility.
    ledger: { type: Map, of: LedgerEntrySchema, default: {} },

    // ─── Multi-member occupancy + rent (house / room / seat) ─────────────────
    // Occupants of this property, each with their own rent terms + ledger.
    // Empty for legacy single-tenant bookings (the top-level tenant* fields +
    // the ledger above drive those). A migration seeds members[0] from the
    // legacy tenant so existing rent history is preserved.
    members: { type: [MemberSchema], default: [] },

    // Shareable code so occupants can self-join and see their own rent/receipts
    // (mirrors Household.inviteCode). Unset on legacy bookings — sparse+unique
    // so many bookings without a code don't collide.
    inviteCode: { type: String, uppercase: true, trim: true, index: true, unique: true, sparse: true },

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
// Member self-view: "which bookings am I an occupant of?" (listTenantBookings).
BookingSchema.index({ 'members.userId': 1 });

module.exports = mongoose.model('Booking', BookingSchema);