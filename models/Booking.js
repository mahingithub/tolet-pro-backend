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

// ─── Tenant profile sub-schema — who the person is ──────────────────────────
// Everything about an occupant EXCEPT their name, phone and move-in date (those
// live on the booking / member itself, because the rest of the app reads them).
//
// EVERY FIELD HERE IS OPTIONAL, AND THAT IS THE POINT. A tenant may have no
// NID, no student ID, no trade licence — plenty of people in this market don't,
// and a landlord who cannot record them without one goes back to the paper
// খাতা. The `*Status` fields hold the আছে / নেই answer; a number is only ever
// expected when the answer was 'has', and that check is enforced at the form,
// not by making the column required here.
const TenantProfileSchema = new mongoose.Schema(
  {
    fatherName:       { type: String, trim: true, default: '', maxlength: 100 },
    // Stored as the 'YYYY-MM-DD' the form produced. Deliberately NOT a Date:
    // a birth date has no time and no timezone, and converting it to one only
    // ever shifted it a day backwards for tenants east of UTC.
    dob:              { type: String, trim: true, default: '', maxlength: 10 },
    maritalStatus:    { type: String, enum: ['', 'single', 'married', 'divorced', 'widowed'], default: '' },
    permanentAddress: { type: String, trim: true, default: '', maxlength: 300 },

    // Profession. NOT a student flag — a flat or a hostel can hold a student, an
    // employee, a shopkeeper or a freelancer, so the tenant's own answer decides
    // which professional fields apply, never the property category.
    tenantType:       { type: String, enum: ['', 'student', 'employee', 'business', 'freelancer', 'other'], default: '' },
    tenantTypeOther:  { type: String, trim: true, default: '', maxlength: 80 },
    organization:     { type: String, trim: true, default: '', maxlength: 160 },
    department:       { type: String, trim: true, default: '', maxlength: 100 },
    // Student ID / employee ID / trade licence — whichever the profession implies.
    professionalIdStatus: { type: String, enum: ['', 'has', 'none'], default: '' },
    professionalIdNumber: { type: String, trim: true, default: '', maxlength: 60 },

    // NID / passport. Never globally required; gated entirely on the answer.
    govtIdStatus:     { type: String, enum: ['', 'has', 'none'], default: '' },
    govtIdType:       { type: String, enum: ['', 'nid', 'passport'], default: '' },
    govtIdNumber:     { type: String, trim: true, default: '', maxlength: 60 },

    emergencyName:     { type: String, trim: true, default: '', maxlength: 100 },
    emergencyRelation: { type: String, trim: true, default: '', maxlength: 60 },
    emergencyAddress:  { type: String, trim: true, default: '', maxlength: 300 },
    emergencyPhone:    { type: String, trim: true, default: '', maxlength: 20 },

    // The landlord's own snapshot of the tenant, taken at intake. TEMPORARY BY
    // DESIGN: the moment this person joins with the booking's invite code, their
    // real account exists, so joinByInvite clears this and their own profile
    // picture is shown instead. The landlord never keeps a private copy of a
    // photo of someone who is now on the platform themselves.
    //
    // Uploaded as Cloudinary type:'authenticated', like NID scans — the stored
    // URL is NOT loadable on its own. Reads go through cloud.signedViewUrlFor()
    // so only the landlord who owns this booking gets a working link, and
    // `photoPublicId` is what makes that signature possible.
    photoUrl:         { type: String, default: '', maxlength: 512 },
    photoPublicId:    { type: String, default: '', maxlength: 256 },
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

    // How many seats in the room this member occupies.
    // 1 = normal single-seat booking (default).
    // > 1 = the member is taking the whole room (full-room booking in a seat
    // building). The capacity check in placeTenantInUnit sums this field across
    // all active members so a full-room booking correctly fills the room.
    seatsBooked: { type: Number, default: 1, min: 1, max: 60 },

    // Per-member money terms. Default from the booking's monthlyRent when omitted.
    monthlyRent:     { type: Number, default: 0, min: 0 },
    serviceCharge:   { type: Number, default: 0, min: 0 },
    securityDeposit: { type: Number, default: 0, min: 0 },

    // The up-front money THIS person handed over when they moved in, and the
    // rail it came through. Per-member rather than per-booking because a seat
    // room is one booking with many occupants who each pay their own advance
    // on their own day — writing it at booking level would let the second
    // tenant's advance overwrite the first one's.
    advancePayment: { type: Number, default: 0, min: 0 },
    paymentMethod:  { type: String, trim: true, default: '', maxlength: 30 },

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

    // Who this seat's occupant is, beyond a name and a number. Per-member so a
    // hostel room holds four different people with four different profiles.
    tenantProfile: { type: TenantProfileSchema, default: () => ({}) },
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

    // ── Building → Unit → (seat) ────────────────────────────────────────────
    // THE fix for the vanishing-lease bug. A booking used to be tied to its
    // building by the `property` NAME string, compared with `===`, so a lease
    // saved under a name that didn't match a building exactly was filtered out
    // of every host screen — a real, persisted row that looked like a failed
    // save. These ids are the relationship now; `property` below is a display
    // label and a fallback for legacy rows only.
    //
    // Null on pre-restructure bookings until the migration backfills them.
    buildingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Building', default: null, index: true },
    unitId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Unit',     default: null, index: true },

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
    // The primary tenant's details. For a hostel room the per-seat copies on
    // members[] are what matter; this is the single-tenant (flat / room) home.
    tenantProfile: { type: TenantProfileSchema, default: () => ({}) },

    // Lease terms
    leaseStart:       { type: Date, required: true },
    // OPEN-ENDED BY DEFAULT (null = no expiry). A Bangladeshi tenancy has no
    // renewal ritual: the tenant moves in, pays monthly, and stays for years
    // without anyone signing a new paper. Forcing an end date made the lease
    // "expire" on its own and told the landlord to re-create the SAME tenant —
    // busywork for something that never happened in real life. The tenancy now
    // runs until the host hands the unit over (tenant change closes it out and
    // stamps the real move-out date here) or types a term on purpose, which is
    // what a commercial deal with a fixed tenure does.
    leaseEnd:         { type: Date, default: null },
    monthlyRent:      { type: Number, required: true, min: 0 },
    // One-time advance / booking money collected up front, plus the channel it
    // was collected through (bKash | Nagad | Rocket | Bank Transfer | Cash).
    advancePayment:   { type: Number, default: 0, min: 0 },
    paymentMethod:    { type: String, trim: true, default: '', maxlength: 40 },
    rentDueDay:       { type: Number, default: 5, min: 1, max: 28 },
    // Days after the due date before the rent counts as late.
    gracePeriodDays:  { type: Number, default: 5, min: 0, max: 28 },
    // Late fee — OPT-IN, so it defaults to 0 (none). A landlord who wants one
    // sets the amount on the lease; only then is a fee added to an overdue month
    // and only then does the rent reminder mention it. Charging money the
    // landlord never asked for (this used to default to ৳500) is not a default
    // we get to pick on their behalf.
    lateFeeAmount:    { type: Number, default: 0, min: 0 },
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

    // Lease-expiry reminder de-dupe. Stores the milestone already sent for the
    // CURRENT leaseEnd, as `<ISO leaseEnd date>@<days>` (e.g. '2026-09-01@7'),
    // so the daily sweep fires at most once per milestone — and automatically
    // re-arms if the host extends the lease (a new leaseEnd ⇒ a new key).
    lastLeaseExpiryReminderKey: { type: String, default: '' },

    // Rent-reminder de-dupe for SINGLE-TENANT bookings (flat / single room /
    // commercial — anything with an empty members[]). Same `<monthKey>@<day>`
    // shape as MemberSchema.lastReminderKey: at most one nudge per tenant per
    // day, repeating on later days until the rent is paid.
    lastReminderKey: { type: String, default: '' },
    lastReminderAt:  { type: Date, default: null },

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

// Shared with TenantOnboarding, which stages a tenant's self-submitted details
// until the landlord approves them and they become a member here. Exported
// rather than copied for the same reason buildMemberFromInput is: a second
// definition of "what we know about an occupant" would drift from this one, and
// the fields where that hurts most are the ID and photo fields that decide what
// a landlord is allowed to see.
module.exports.TenantProfileSchema = TenantProfileSchema;