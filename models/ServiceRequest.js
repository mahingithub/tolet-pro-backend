'use strict';

/**
 * ServiceRequest model — one order or callback between a tenant and a provider.
 * ─────────────────────────────────────────────────────────────────────────────
 * The tenant places it, the PROVIDER accepts or declines it, and the two of
 * them settle it between themselves. There is no admin in this path and no
 * platform money in it: To-Let Pro earns a registration fee, not a commission,
 * so nothing here is an escrow, a payout or a refund.
 *
 * ─── ONLY TWO TIERS REACH THIS MODEL ─────────────────────────────────────────
 * config/serviceCategories.js gives every category an `interaction` tier:
 *
 *   contact   → NO ServiceRequest is ever created. The tenant just calls.
 *               গৃহকর্মী, ইলেকট্রিশিয়ান, প্লাম্বার, ইন্টারনেট live here, and
 *               forcing a booking form on them would be inventing paperwork
 *               where a phone call already works.
 *   request   → a structured callback: "১২kg বসুন্ধরা, আজ". গ্যাস, পানির জার.
 *   order     → an itemised cart from the provider's price rows. মুদি, হোটেল.
 *
 * So `kind` mirrors the category's tier, and a contact-tier category is
 * refused at validation. That refusal is the point: it keeps the clean
 * "just ring him" path from silently growing a transaction system.
 *
 * ─── PRICES ARE FROZEN AT PLACEMENT ──────────────────────────────────────────
 * `items[].unitPrice` is copied from the provider's price rows when the order
 * is placed and never re-read. A provider who raises his চাল price tomorrow
 * must not retroactively change what a tenant agreed to yesterday — the same
 * rule that stops a settled rent ledger being rewritten.
 */

const crypto = require('crypto');

const mongoose = require('mongoose');
const { getCategory } = require('../config/serviceCategories');
const { dhakaDayKey } = require('../utils/dhakaDay');

// ─── LIFECYCLE ───────────────────────────────────────────────────────────────
//   placed      tenant submitted; the provider has not answered yet
//   accepted    provider confirmed. For `request` this means "I'll ring you"
//   on_the_way  optional — provider marked it out for delivery
//   completed   delivered / done
//   declined    provider can't take it (out of stock, too far, closed)
//   cancelled   called off by either side; `cancelledBy` says who
//   expired     nobody answered inside the response window (set by cron)
//
// `declined` and `expired` are deliberately separate. An honest decline is
// fine behaviour; silence is not, and only the second should count against a
// provider. Collapsing them would punish the provider who answers properly.
const STATUSES = [
  'placed', 'accepted', 'on_the_way', 'completed',
  'declined', 'cancelled', 'expired',
];

const OPEN_STATUSES   = ['placed', 'accepted', 'on_the_way'];
const CLOSED_STATUSES = ['completed', 'declined', 'cancelled', 'expired'];

// Which transitions are legal. Enforced by canTransition() so the rule lives
// in one place instead of being re-derived in every controller.
const TRANSITIONS = {
  placed:     ['accepted', 'declined', 'cancelled', 'expired'],
  accepted:   ['on_the_way', 'completed', 'cancelled'],
  on_the_way: ['completed', 'cancelled'],
  completed:  [],
  declined:   [],
  cancelled:  [],
  expired:    [],
};

// How long a provider has to answer before the cron expires it and tells the
// tenant. Short enough that nobody waits on a silent shop all evening.
const RESPOND_WINDOW_MIN = 30;

// ─── Sub-schemas ─────────────────────────────────────────────────────────────

const ItemSchema = new mongoose.Schema(
  {
    // Which price row this came from, e.g. 'kg_12' or 'rice_miniket'. Keys are
    // permanent in serviceCategories.js, so an old order still resolves to a
    // real label years later.
    rowKey: { type: String, required: true, trim: true, maxlength: 60 },
    field:  { type: String, required: true, trim: true, maxlength: 60 },
    // The label AS SHOWN at the time, so the order reads correctly even if the
    // category's wording is later rewritten.
    label:  { type: String, default: '', trim: true, maxlength: 120 },
    qty:    { type: Number, default: 1, min: 1, max: 999 },
    unit:   { type: String, default: '', trim: true, maxlength: 20 },
    // Frozen at placement. See the header note.
    unitPrice: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

// WHERE it goes. Snapshotted, never re-resolved from the booking.
//
// A tenant who moves out must not have last month's orders silently re-point
// at their new flat — the same reason a receipt is bound to the tenancy that
// issued it rather than to a property title. The ids are kept for analytics
// (building density is a real advantage here), but the ADDRESS that was agreed
// is the text captured at the moment of the order.
const DeliverToSchema = new mongoose.Schema(
  {
    label:       { type: String, default: '', trim: true, maxlength: 80 },   // 'বাসা' / 'অফিস'
    addressText: { type: String, default: '', trim: true, maxlength: 400 },
    phone:       { type: String, default: '', trim: true, maxlength: 20 },
    note:        { type: String, default: '', trim: true, maxlength: 300 },  // '৩য় তলা, বাম পাশে'
    lat:         { type: Number, default: null },
    lng:         { type: Number, default: null },
    thana:       { type: String, default: '', trim: true, maxlength: 100 },
    area:        { type: String, default: '', trim: true, maxlength: 120 },
    buildingId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Building', default: null },
    unitId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Unit',     default: null },
    propertyId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Property', default: null },
  },
  { _id: false },
);

const ServiceRequestSchema = new mongoose.Schema(
  {
    // A short human code. A shopkeeper on the phone says "অর্ডার ৪৭২১" — he is
    // never going to read out an ObjectId.
    //
    // Four digits is 9,000 values, so the SCOPE it has to be unique in decides
    // whether the format survives. Globally and forever, 9,000 is a hard
    // ceiling on the number of orders the platform may ever take, and it
    // degrades long before that — at 4,500 lifetime orders every second insert
    // collides. Scoped to one provider's own day it never saturates: even a
    // shop taking 200 orders a day fills 2% of the space, and that is the only
    // scope the code is ever spoken in anyway — "অর্ডার ৪৭২১" means today, in
    // this shop. It is deliberately NOT a lookup key anywhere; it is read out
    // loud and printed in the merchant's inbox, and nothing resolves an order
    // from it.
    code: { type: String, default: '' },

    // 'YYYY-MM-DD' in Asia/Dhaka — the other half of the code's uniqueness
    // scope, and Dhaka rather than UTC because a UTC day would roll at 6pm,
    // mid-shift, handing a shopkeeper two code spaces in one evening.
    codeDay: { type: String, default: '' },

    kind:     { type: String, enum: ['request', 'order'], required: true },
    category: { type: String, required: true, index: true },

    providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider', required: true, index: true },
    tenantId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User',     required: true, index: true },

    // Denormalised so neither side's list needs a JOIN to render — the same
    // reason RentPaymentSubmission snapshots its tenant and property.
    providerName:  { type: String, default: '', trim: true, maxlength: 120 },
    providerPhone: { type: String, default: '', trim: true, maxlength: 20 },
    tenantName:    { type: String, default: '', trim: true, maxlength: 120 },
    tenantPhone:   { type: String, default: '', trim: true, maxlength: 20 },

    status: { type: String, enum: STATUSES, default: 'placed', index: true },

    items:     { type: [ItemSchema], default: [] },
    deliverTo: { type: DeliverToSchema, default: () => ({}) },
    note:      { type: String, default: '', trim: true, maxlength: 500 },

    // ─── Money ───────────────────────────────────────────────────────────────
    // `quotedTotal` is what the app showed, computed from the provider's listed
    // prices at placement. `finalTotal` is what actually changed hands, set at
    // completion — and it is nullable because for a `request` the real number
    // is agreed on the phone.
    //
    // The GAP between the two is worth watching: a provider whose final totals
    // routinely exceed his quotes has listed prices that are fiction, which is
    // the same problem the freshness ladder exists to catch.
    quotedTotal:  { type: Number, default: 0, min: 0 },
    deliveryFee:  { type: Number, default: 0, min: 0 },
    finalTotal:   { type: Number, default: null },

    // No gateway, no escrow, no commission. The platform never touches this
    // money; the field records how the two of them settled it.
    paymentMode: {
      type: String,
      enum: ['cash_on_delivery', 'pay_provider_direct', 'bkash', 'nagad', 'other'],
      default: 'cash_on_delivery',
    },

    // ─── Timing ──────────────────────────────────────────────────────────────
    // When the provider's silence stops being acceptable. The expiry cron
    // sweeps `status: 'placed'` past this.
    respondBy:   { type: Date, default: null, index: true },
    acceptedAt:  { type: Date, default: null },
    completedAt: { type: Date, default: null },
    closedAt:    { type: Date, default: null },

    // Who called it off, and why — surfaced to the other side verbatim so
    // nobody is left guessing.
    cancelledBy:     { type: String, enum: ['', 'tenant', 'provider', 'system'], default: '' },
    cancelReason:    { type: String, default: '', trim: true, maxlength: 300 },

    // Append-only audit. Every status change lands here with an actor, so a
    // dispute can be read back without reconstructing it from timestamps.
    timeline: [{
      status: { type: String, enum: STATUSES },
      at:     { type: Date, default: Date.now },
      by:     { type: mongoose.Schema.Types.ObjectId, default: null },
      byRole: { type: String, enum: ['tenant', 'provider', 'system'], default: 'system' },
      reason: { type: String, default: '', maxlength: 300 },
      _id: false,
    }],

    // ─── Rating ──────────────────────────────────────────────────────────────
    // Only a COMPLETED request may be rated. An unverifiable review is worth
    // nothing, and with no admin in the transaction path ratings are a large
    // part of what keeps quality up.
    ratedAt:  { type: Date, default: null },
    // ProviderReview, NOT Review. models/Review.js is the tenant↔landlord
    // model — its revieweeId refs User and its role enum is
    // ['landlord','tenant'] — and a provider is not a User at all. This said
    // 'Review' before ProviderReview existed, which would have populated
    // against the wrong collection and quietly resolved to nothing.
    reviewId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProviderReview', default: null },
    // The score, denormalised so a tenant's order list can show "আপনি ৪★
    // দিয়েছেন" without a join. ProviderReview remains the source of truth;
    // this is a copy, and ProviderReview.recomputeProvider never reads it.
    rating:   { type: Number, default: null, min: 1, max: 5 },

    // The connection this order produced, so provider stats and the admin's
    // platform counts read one ledger rather than two.
    contactEventId: { type: mongoose.Schema.Types.ObjectId, ref: 'ContactEvent', default: null },

    // ─── Idempotency ─────────────────────────────────────────────────────────
    // A double tap on "অর্ডার করুন" over a flaky mobile connection must not
    // produce two orders — and on these networks the retry is the NORMAL case,
    // not the edge case. The client sends a generated id; the partial unique
    // index below makes the second write a no-op. Same shape as the opId
    // dedupe the offline write queues already use.
    clientRequestId: { type: String, default: null, maxlength: 64 },
  },
  { timestamps: true },
);

// ─── Indexes ─────────────────────────────────────────────────────────────────

// The provider's inbox — open jobs first, newest first. His home screen.
ServiceRequestSchema.index({ providerId: 1, status: 1, createdAt: -1 });

// The tenant's "my orders".
ServiceRequestSchema.index({ tenantId: 1, createdAt: -1 });

// Admin breakdowns by category over a window.
ServiceRequestSchema.index({ category: 1, status: 1, createdAt: -1 });

// Building density — the analytics that justify a provider's route.
ServiceRequestSchema.index({ 'deliverTo.buildingId': 1, createdAt: -1 });

// The spoken code's uniqueness scope: one shop, one Dhaka day. Existing rows
// predate `codeDay` and index as null, which is safe precisely because the
// codes they carry were globally unique under the old rule.
ServiceRequestSchema.index({ providerId: 1, codeDay: 1, code: 1 }, { unique: true });

// Idempotency. Partial, because `clientRequestId` is null for anything not
// submitted through the retrying client — and a plain unique index would treat
// every one of those nulls as the same value and allow exactly one such order
// to exist, platform-wide.
ServiceRequestSchema.index(
  { tenantId: 1, clientRequestId: 1 },
  { unique: true, partialFilterExpression: { clientRequestId: { $type: 'string' } } },
);

// ─── The spoken code ─────────────────────────────────────────────────────────

// How many times to redraw before giving up. Five consecutive collisions needs
// the shop's day to be dense enough that the format itself has stopped working,
// which is worth failing loudly over rather than looping.
const CODE_ATTEMPTS = 5;

/** One draw: 1000–9999, never a leading zero, so it reads as four spoken digits. */
function drawCode() {
  return String(crypto.randomInt(1000, 10000));
}

/**
 * Was this 11000 the spoken code colliding, or the idempotency key?
 *
 * The two mean opposite things. A duplicate `code` is a coincidence and the
 * right answer is to draw again; a duplicate `clientRequestId` is the same tap
 * arriving twice and the right answer is to hand back the original order.
 * Retrying the second would create the duplicate order the index exists to
 * prevent, so they must never be confused.
 */
function isDuplicateCodeError(err) {
  if (!err || err.code !== 11000) return false;
  const keys = Object.keys(err.keyPattern || err.keyValue || {});
  // Older drivers omit keyPattern; the index name in the message carries it.
  if (!keys.length) return /code/.test(String(err.message || ''));
  return keys.includes('code');
}

/**
 * Create an order, redrawing the spoken code if that shop already used it today.
 *
 * At four digits a collision is an ORDINARY event, not an astronomical one, so
 * this loop is the difference between a code the shopkeeper can read out and a
 * tenant whose order fails for a coincidence. Unretried, the 11000 reaches the
 * error handler and the tenant is told "এই তথ্য আগে থেকেই রয়েছে।" — a 409 about
 * an order nobody has placed before.
 *
 * The unique index is what makes the redraw correct; without the index,
 * retrying would just be guessing.
 *
 * An explicitly supplied `code` is never redrawn — a caller that picked one
 * wants that one, and silently substituting another would be worse than the
 * error.
 */
ServiceRequestSchema.statics.createWithCode = async function createWithCode(payload) {
  const drawn = !payload.code;
  let lastErr;

  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
    try {
      return await this.create({ ...payload });
    } catch (err) {
      if (!drawn || !isDuplicateCodeError(err)) throw err;   // not ours to retry
      lastErr = err;
    }
  }

  console.error(`[serviceRequest] ${CODE_ATTEMPTS} code collisions in a row for provider ${payload.providerId}`);
  throw lastErr;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Is this a legal move? One table, consulted everywhere. */
ServiceRequestSchema.statics.canTransition = function canTransition(from, to) {
  return Boolean(TRANSITIONS[from] && TRANSITIONS[from].includes(to));
};

/**
 * Move the request on, appending to the timeline. Refuses an illegal jump
 * rather than quietly allowing it — a `completed` order that goes back to
 * `placed` is a bug that would otherwise only surface as a disputed receipt.
 */
ServiceRequestSchema.methods.transition = function transition(to, { by = null, byRole = 'system', reason = '' } = {}) {
  if (!ServiceRequestSchema.statics.canTransition(this.status, to)) {
    const err = new Error(`Illegal transition: ${this.status} → ${to}`);
    err.code = 'illegal_transition';
    throw err;
  }

  this.status = to;
  this.timeline.push({ status: to, at: new Date(), by, byRole, reason });

  if (to === 'accepted') this.acceptedAt = new Date();
  if (to === 'completed') this.completedAt = new Date();
  if (CLOSED_STATUSES.includes(to)) this.closedAt = new Date();
  if (to === 'cancelled') {
    this.cancelledBy = byRole;
    this.cancelReason = reason;
  }
  if (to === 'declined') this.cancelReason = reason;

  return this;
};

/** Sum of the frozen line prices, plus delivery. */
ServiceRequestSchema.methods.computeQuotedTotal = function computeQuotedTotal() {
  const items = (this.items || []).reduce((sum, i) => sum + (i.unitPrice || 0) * (i.qty || 0), 0);
  return items + (this.deliveryFee || 0);
};

/** A completed request that hasn't been rated yet — the review prompt's gate. */
ServiceRequestSchema.virtual('canBeRated').get(function canBeRated() {
  return this.status === 'completed' && !this.ratedAt;
});

ServiceRequestSchema.virtual('isOpen').get(function isOpen() {
  return OPEN_STATUSES.includes(this.status);
});

/**
 * Does this count against the provider's auto-suspension counters?
 *
 * Declining honestly does not — a shop that is out of stock and says so is
 * behaving well, and penalising it would teach providers to accept everything
 * and cancel later, which is strictly worse for the tenant. Only silence
 * (`expired`) and cancelling AFTER accepting do.
 */
ServiceRequestSchema.methods.countsAgainstProvider = function countsAgainstProvider() {
  if (this.status === 'expired') return 'noShow';
  if (this.status === 'cancelled' && this.cancelledBy === 'provider' && this.acceptedAt) return 'cancel';
  return null;
};

// ─── Pre-validate ────────────────────────────────────────────────────────────
ServiceRequestSchema.pre('validate', function normalise(next) {
  const cat = getCategory(this.category);
  if (!cat) return next(new Error(`Unknown service category: ${this.category}`));

  // The guard that keeps the "just ring him" path clean. A গৃহকর্মী or a
  // plumber has no booking flow by design; creating one here would be the
  // first crack in that decision.
  if (cat.interaction === 'contact') {
    return next(new Error(`Category "${this.category}" is contact-only — no request is created.`));
  }
  if (this.kind !== cat.interaction) {
    return next(new Error(`kind "${this.kind}" does not match category tier "${cat.interaction}".`));
  }

  if (this.isNew) {
    // The day half of the code's scope has to be fixed BEFORE the code is
    // drawn, or the draw would be checked against the wrong day's space.
    if (!this.codeDay) this.codeDay = dhakaDayKey();
    if (!this.code) {
      // Short and spoken-aloud friendly, unique within this shop's day, and
      // enforced by the compound index. A collision here is ordinary and is
      // redrawn by createWithCode() — which is the only way this model should
      // be inserted.
      this.code = this.constructor.drawCode();
    }
    if (!this.respondBy) {
      this.respondBy = new Date(Date.now() + RESPOND_WINDOW_MIN * 60_000);
    }
    if (!this.timeline.length) {
      this.timeline.push({ status: this.status, at: new Date(), byRole: 'tenant' });
    }
    this.quotedTotal = this.computeQuotedTotal();
  }

  return next();
});

ServiceRequestSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
});

// A static so the pre-validate hook reaches it through `this.constructor`,
// which is also the seam a test uses to force a collision.
ServiceRequestSchema.statics.drawCode = drawCode;
ServiceRequestSchema.statics.CODE_ATTEMPTS = CODE_ATTEMPTS;

ServiceRequestSchema.statics.STATUSES = STATUSES;
ServiceRequestSchema.statics.OPEN_STATUSES = OPEN_STATUSES;
ServiceRequestSchema.statics.CLOSED_STATUSES = CLOSED_STATUSES;
ServiceRequestSchema.statics.TRANSITIONS = TRANSITIONS;
ServiceRequestSchema.statics.RESPOND_WINDOW_MIN = RESPOND_WINDOW_MIN;

module.exports = mongoose.model('ServiceRequest', ServiceRequestSchema);
module.exports.STATUSES = STATUSES;
module.exports.OPEN_STATUSES = OPEN_STATUSES;
module.exports.CLOSED_STATUSES = CLOSED_STATUSES;
module.exports.RESPOND_WINDOW_MIN = RESPOND_WINDOW_MIN;
