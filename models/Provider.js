'use strict';

/**
 * Provider model — one registered local business or tradesperson.
 * ─────────────────────────────────────────────────────────────────────────────
 * A Provider is a business owned by a MERCHANT — an account in a system
 * separate from To-Let Pro entirely:
 *
 *   Merchant (own phone/OTP login)  ──owns──▶  Provider  ──has──▶ fields
 *
 * A shopkeeper is NOT a tenant and needs no rental account; To-Let Pro's roles
 * stay tenant ↔ landlord. The two sides share a database and a phone-number
 * format and nothing else — merchant tokens carry their own audience, so a
 * tenant's token cannot reach a shop and a shop's cannot reach a tenancy.
 *
 * The business is also kept apart from its owner's account because it has its
 * own lifecycle — verified, suspended, expired — none of which should touch
 * the person's login.
 *
 * ─── WHERE THE SHAPE COMES FROM ──────────────────────────────────────────────
 * `fields` is deliberately schemaless to mongoose. Its real schema lives in
 * config/serviceCategories.js, which drives the registration form, the listing
 * editor, the tenant card AND validation from one definition. Putting a rigid
 * sub-schema here would fork that definition in two and guarantee a "the form
 * asked for a field the API rejects" bug. Nothing writes `fields` except
 * `validateProviderFields()`'s cleaned output — enforce that at the controller,
 * never by hand.
 *
 * ─── ADMIN IS A GATE, NOT A BROKER ───────────────────────────────────────────
 * Admin approves a provider once and then leaves. There is no admin in the
 * transaction path: a tenant calls or orders, the provider answers. The only
 * admin-owned fields here are `verification`, `status` and `registration`.
 */

const mongoose = require('mongoose');
const { getCategory, freshnessState } = require('../config/serviceCategories');

// ─── LIFECYCLE ───────────────────────────────────────────────────────────────
//   draft             filling in the registration; visible only to the owner
//   pending_review    submitted, sitting in the admin queue
//   rejected          admin declined; `verification.rejectionReason` says why
//   awaiting_payment  admin APPROVED, registration fee not yet confirmed
//   active            live and searchable
//   suspended         pulled by admin, or auto-suspended on behaviour
//   expired           registration lapsed (see registration.expiresAt)
//
// `awaiting_payment` exists because the fee is collected AFTER approval. Asking
// a sceptical shopkeeper for money before he has seen his own live listing is
// where this kind of product usually dies.
const STATUSES = [
  'draft', 'pending_review', 'rejected', 'awaiting_payment',
  'active', 'suspended', 'expired',
];

// Only these are visible to a tenant. Everything else is the owner's own view.
const PUBLIC_STATUSES = ['active'];

// ─── Verification ────────────────────────────────────────────────────────────
// Mirrors User.VerificationSchema's shape on purpose — same Cloudinary
// url/publicId pairing, same status enum, same reviewer fields — so the admin
// console's existing KYC queue UI works here with almost no new code.
//
// `tier` records WHAT WAS APPROVED, which is what drives the সবুজ ভেরিফাইড
// badge. A provider approved at 'basic' is listed and callable but unbadged and
// ranked below verified peers; 'full' earns the badge. See the KYC TIERS note
// in config/serviceCategories.js for why verification is a badge, not a gate.
const ProviderVerificationSchema = new mongoose.Schema(
  {
    tier: { type: String, enum: ['basic', 'full'], default: 'basic' },

    // basic — every provider submits these
    photoUrl:            { type: String, default: '', maxlength: 600 },
    photoPublicId:       { type: String, default: '', maxlength: 200 },

    // full — NID + proof the person is really at the pin they dropped
    nidFrontUrl:         { type: String, default: '', maxlength: 600 },
    nidFrontPublicId:    { type: String, default: '', maxlength: 200 },
    nidBackUrl:          { type: String, default: '', maxlength: 600 },
    nidBackPublicId:     { type: String, default: '', maxlength: 200 },
    // A selfie taken AT the pinned location, with the capture coordinates
    // stamped on it. Cheap to collect and it kills most fake pins.
    selfieUrl:           { type: String, default: '', maxlength: 600 },
    selfiePublicId:      { type: String, default: '', maxlength: 200 },
    selfieLat:           { type: Number, default: null },
    selfieLng:           { type: Number, default: null },
    // Optional even at 'full' — a গৃহকর্মী or a রিকশা-ভ্যান gas seller has no
    // trade licence, and demanding one would exclude exactly the people this
    // platform exists to bring online.
    tradeLicenceUrl:     { type: String, default: '', maxlength: 600 },
    tradeLicencePublicId:{ type: String, default: '', maxlength: 200 },

    submittedForReview: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['unverified', 'pending', 'verified', 'rejected'],
      default: 'unverified',
    },
    reviewedAt:      { type: Date, default: null },
    reviewedBy:      { type: mongoose.Schema.Types.ObjectId, default: null },
    rejectionReason: { type: String, default: '', maxlength: 500 },
  },
  { _id: false },
);

// ─── Registration fee ────────────────────────────────────────────────────────
// No payment gateway exists (billing is simulated, rent is manual proof — see
// RentPaymentSubmission). The provider sends the fee and submits the TrxID;
// admin confirms it in the same review pass as the identity check.
//
// `expiresAt` is non-negotiable and must be set the day the fee is confirmed.
// A one-time fee with a permanent listing becomes a graveyard of disconnected
// phone numbers within a year, and backfilling an expiry across live providers
// afterwards is painful.
const RegistrationSchema = new mongoose.Schema(
  {
    amount:      { type: Number, default: 0, min: 0 },
    method:      { type: String, default: '', maxlength: 40 },   // bkash | nagad | cash …
    trxId:       { type: String, default: '', trim: true, maxlength: 60 },
    paidAt:      { type: Date, default: null },
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    expiresAt:   { type: Date, default: null },
  },
  { _id: false },
);

// ─── Coverage ────────────────────────────────────────────────────────────────
// How far this provider will actually travel. Two modes because the two
// answers are genuinely different shapes:
//
//   radius  "৩ কিমি পর্যন্ত যাই"     — a gas delivery van, a plumber
//   areas   "এই থানাগুলোতে সেবা দিই" — an ISP selling by covered area
//
// The category's `defaultCoverage` seeds this at registration so the provider
// answers one chip question instead of understanding the concept.
const CoverageSchema = new mongoose.Schema(
  {
    mode:     { type: String, enum: ['radius', 'areas'], default: 'radius' },
    radiusKm: { type: Number, default: 2, min: 0.5, max: 50 },
    thanas:   { type: [String], default: [] },
    areas:    { type: [String], default: [] },
  },
  { _id: false },
);

const ProviderSchema = new mongoose.Schema(
  {
    // ─── Ownership ───────────────────────────────────────────────────────────
    ownerMerchantId: {
      type: mongoose.Schema.Types.ObjectId, ref: 'Merchant', required: true, index: true,
    },
    // Denormalised so a provider card renders without a JOIN. Refreshed on
    // save; the Merchant doc stays the source of truth.
    ownerName:  { type: String, trim: true, default: '', maxlength: 120 },
    phone:      { type: String, trim: true, default: '', maxlength: 20 },
    // An optional second number — a shop landline, or the son who answers.
    altPhone:   { type: String, trim: true, default: '', maxlength: 20 },

    // ─── Identity ────────────────────────────────────────────────────────────
    // The label for this question is per-category (`nameLabel`): "দোকানের নাম"
    // only for a genuine storefront, "প্রোভাইডারের নাম" for everyone else,
    // because a গৃহকর্মী or a plumber has no shop and no signboard.
    name:    { type: String, required: true, trim: true, maxlength: 120 },
    about:   { type: String, trim: true, default: '', maxlength: 500 },

    category: { type: String, required: true, index: true },   // serviceCategories id

    // Category-specific answers. Shape owned by config/serviceCategories.js —
    // see the header note. Always the output of validateProviderFields().
    fields: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },

    photoUrl:      { type: String, default: '', maxlength: 600 },
    photoPublicId: { type: String, default: '', maxlength: 200 },
    gallery: [{
      url:      { type: String, default: '', maxlength: 600 },
      publicId: { type: String, default: '', maxlength: 200 },
      _id: false,
    }],

    // ─── Location ────────────────────────────────────────────────────────────
    // GeoJSON, and the FIRST 2dsphere index in this codebase.
    //
    // ⚠ COORDINATE ORDER IS [longitude, latitude] — the opposite of how every
    // other part of this app spells a point (Property.gps is {lat, lng}; the
    // Leaflet and Google Maps components both take (lat, lng)). Swapping them
    // does not throw: Dhaka at [90.4, 23.8] silently becomes a point in
    // Somalia, every distance is wrong, and nothing looks broken until a
    // tenant asks why the nearest grocer is 4,000 km away. Use the
    // `setPoint()` helper below rather than assigning the array by hand.
    geo: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator: (v) => Array.isArray(v) && v.length === 2
            && v[0] >= -180 && v[0] <= 180      // lng
            && v[1] >= -90  && v[1] <= 90,      // lat
          message: 'geo.coordinates must be [lng, lat] within valid ranges.',
        },
      },
    },

    // Text location, mirroring Property's field names so the same pickers,
    // aliases and bdGeo dataset work unchanged. `thana` is the level tenants
    // actually search by, and the fallback when a tenant's home has no GPS.
    division:    { type: String, lowercase: true, trim: true, default: '', maxlength: 40, index: true },
    district:    { type: String, trim: true, default: '', maxlength: 80 },
    thana:       { type: String, trim: true, default: '', maxlength: 100, index: true },
    area:        { type: String, trim: true, default: '', maxlength: 120 },
    addressText: { type: String, trim: true, default: '', maxlength: 400 },

    coverage: { type: CoverageSchema, default: () => ({}) },

    // ─── Availability ────────────────────────────────────────────────────────
    // The single most important control in the provider app. A shopkeeper who
    // cannot mark himself closed starts declining requests and then uninstalls.
    openNow: { type: Boolean, default: true },
    hours:   { type: String, trim: true, default: '', maxlength: 120 },

    // ─── Lifecycle ───────────────────────────────────────────────────────────
    status:       { type: String, enum: STATUSES, default: 'draft', index: true },
    verification: { type: ProviderVerificationSchema, default: () => ({}) },
    registration: { type: RegistrationSchema, default: () => ({}) },

    // ─── Prices ──────────────────────────────────────────────────────────────
    // Stamped whenever a price_rows field changes — NOT on every save, or an
    // unrelated edit to `hours` would launder a stale price as fresh.
    // config/serviceCategories.js → freshnessState() turns this into the
    // fresh/aging/stale/expired ladder, on a per-category clock (grocery 7d,
    // gas 35d, internet 180d, a plumber's visit charge never).
    pricesUpdatedAt: { type: Date, default: null },

    // Rows found ABOVE a published government ceiling (BERC for LPG, BTRC for
    // broadband entry tiers). A cap is a MAXIMUM, not a price — shops sell
    // below it legitimately — so this never rewrites the provider's number. It
    // flags the row for review and nudges him, nothing more.
    priceCompliance: {
      checkedAt:   { type: Date, default: null },
      overCapRows: [{
        field: String, row: String, price: Number, cap: Number,
        _id: false,
      }],
    },

    // ─── Denormalised counters ───────────────────────────────────────────────
    // The provider's own ROI screen reads these; ContactEvent is the ledger
    // they are rolled up from. Denormalised because "১৪ জন কল করেছে" renders on
    // every card and must not cost an aggregation.
    stats: {
      views:    { type: Number, default: 0 },
      contacts: { type: Number, default: 0 },
      requests: { type: Number, default: 0 },
      orders:   { type: Number, default: 0 },
    },
    ratingAvg:    { type: Number, default: 0, min: 0, max: 5 },
    ratingCount:  { type: Number, default: 0 },

    // Drives the "you've been quiet for 14 days" nudge and the dormancy sweep.
    lastActiveAt: { type: Date, default: Date.now },

    // Auto-suspension inputs. A provider who repeatedly accepts and then
    // cancels is worse than one who declines honestly, so they are counted
    // apart. These replace the human broker: with no admin in the transaction
    // path, behaviour has to be what enforces quality.
    declineCount: { type: Number, default: 0 },
    cancelCount:  { type: Number, default: 0 },
    noShowCount:  { type: Number, default: 0 },
    suspendedReason: { type: String, default: '', maxlength: 300 },
  },
  {
    timestamps: true,
    // `minimize: false` is load-bearing, not a style choice.
    //
    // Mongoose strips empty objects before saving by default, so clearing
    // `fields` — which is exactly what a category change does — persisted as
    // ABSENT rather than as `{}`. The document then came back with
    // `fields: undefined`, and every client reading `provider.fields.sizes`
    // threw on a perfectly ordinary edit.
    //
    // An empty `fields` is meaningful here: it means "this category's answers
    // have been cleared", which is a different statement from "this document
    // predates the field". Same for `coverage` and `priceCompliance`.
    minimize: false,
  },
);

// ─── Indexes ─────────────────────────────────────────────────────────────────

// The primary browse query: nearest ACTIVE providers in a category.
// $geoNear must be the first aggregation stage and uses this index; the
// category/status keys let its `query` filter narrow without a second pass.
ProviderSchema.index({ geo: '2dsphere', category: 1, status: 1 });

// The coverage:'areas' path — an ISP that sells by thana rather than radius,
// and the fallback for a tenant whose home has no usable coordinates.
ProviderSchema.index({ category: 1, thana: 1, status: 1 });

// The admin verification queue.
ProviderSchema.index({ status: 1, 'verification.status': 1, createdAt: -1 });

// "My businesses" in the provider app.
ProviderSchema.index({ ownerMerchantId: 1, createdAt: -1 });

// Cron sweeps: registrations about to lapse, and prices going stale.
ProviderSchema.index({ 'registration.expiresAt': 1, status: 1 });
ProviderSchema.index({ category: 1, pricesUpdatedAt: 1, status: 1 });

// Name search within a category, for the secondary search box.
ProviderSchema.index({ name: 'text', area: 'text' });

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * The ONLY sanctioned way to set a location. Takes (lat, lng) — the order
 * every other part of this app uses — and writes GeoJSON's [lng, lat].
 * Assigning `geo.coordinates` by hand is how a Dhaka shop ends up in Somalia.
 */
ProviderSchema.methods.setPoint = function setPoint(lat, lng) {
  this.geo = { type: 'Point', coordinates: [Number(lng), Number(lat)] };
  return this;
};

/** Readable (lat, lng) back out, for clients that speak the app's dialect. */
ProviderSchema.virtual('latLng').get(function latLng() {
  const c = this.geo && this.geo.coordinates;
  if (!Array.isArray(c) || c.length !== 2) return null;
  return { lat: c[1], lng: c[0] };
});

/**
 * The সবুজ ভেরিফাইড badge. Both halves are required: admin approved it AND
 * what they approved was full KYC. A provider approved at 'basic' is a real,
 * listed, callable provider — just an unbadged one.
 */
ProviderSchema.virtual('isVerified').get(function isVerified() {
  return this.verification
    && this.verification.status === 'verified'
    && this.verification.tier === 'full';
});

/** fresh | aging | stale | expired, on this category's own clock. */
ProviderSchema.methods.priceFreshness = function priceFreshness() {
  return freshnessState(this.category, this.pricesUpdatedAt);
};

/**
 * Ranking weight. Verified first, then open, then fresh prices — distance is
 * applied by the query, not here. Deliberately blunt: a score a shopkeeper can
 * be told in one sentence ("ভেরিফাই করুন, উপরে উঠবেন") is a score that changes
 * behaviour.
 */
ProviderSchema.methods.rankBoost = function rankBoost() {
  let boost = 0;
  if (this.isVerified) boost += 100;
  if (this.openNow) boost += 20;
  const { state } = this.priceFreshness();
  if (state === 'fresh') boost += 10;
  else if (state === 'stale') boost -= 10;
  else if (state === 'expired') boost -= 25;
  if (this.ratingCount > 0) boost += Math.round(this.ratingAvg * 4);
  return boost;
};

ProviderSchema.pre('validate', function normalise(next) {
  // An unknown category would sail through as a plain string and produce a
  // listing no screen can render, because nothing would know what `fields`
  // means. Fail at the door instead.
  if (this.category && !getCategory(this.category)) {
    return next(new Error(`Unknown service category: ${this.category}`));
  }
  return next();
});

// ─── JSON ────────────────────────────────────────────────────────────────────
// Two things must never reach a tenant: the owner's identity documents, and
// the fee/TrxID. `toJSON` strips both, so a route that forgets to `.select()`
// leaks nothing. Admin routes that genuinely need them read the raw doc.
ProviderSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    if (ret.geo && Array.isArray(ret.geo.coordinates)) {
      ret.lat = ret.geo.coordinates[1];
      ret.lng = ret.geo.coordinates[0];
    }
    // Belt and braces alongside `minimize: false`: a lean() query bypasses
    // this transform, but anything that does go through it is guaranteed an
    // object, so a client never has to null-check before reading an answer.
    if (!ret.fields) ret.fields = {};
    if (ret.verification) {
      ret.verification = {
        tier:   ret.verification.tier,
        status: ret.verification.status,
        rejectionReason: ret.verification.rejectionReason || '',
      };
    }
    delete ret.registration;
    delete ret._id;
    return ret;
  },
});

ProviderSchema.statics.STATUSES = STATUSES;
ProviderSchema.statics.PUBLIC_STATUSES = PUBLIC_STATUSES;

module.exports = mongoose.model('Provider', ProviderSchema);
module.exports.STATUSES = STATUSES;
module.exports.PUBLIC_STATUSES = PUBLIC_STATUSES;
