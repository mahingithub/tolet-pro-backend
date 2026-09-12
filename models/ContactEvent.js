'use strict';

/**
 * ContactEvent model — one connection between a user and a provider.
 * ─────────────────────────────────────────────────────────────────────────────
 * This is the ledger behind "কতজন প্রোভাইডার কতজন ইউজারের সাথে যুক্ত হয়েছে".
 * One row per meaningful interaction, and THREE different audiences read the
 * same rows at three different scopes:
 *
 *   ADMIN     across everyone — how many providers, how many users, how many
 *             connections, split by category and area, over time. The only
 *             view that spans the whole platform.
 *
 *   PROVIDER  his OWN rows only — "এই মাসে ৩১ জন দেখেছে · ১৪ জন কল করেছে ·
 *             ৯ জন এই বিল্ডিং থেকে". This is the entire return-on-investment
 *             proof for the registration fee, and for `contact`-tier
 *             categories it is the ONLY metric that exists, since there are no
 *             orders to count. It is not an admin-only number.
 *
 *   TENANT    their own history ("আপনি এই দোকানে ৩ বার অর্ডার করেছেন"), plus
 *             anonymous social proof on a card ("এই এলাকার ১২ জন ব্যবহার
 *             করেন") — a count, never a list of names.
 *
 * ─── PRIVACY BOUNDARY ────────────────────────────────────────────────────────
 * A provider learns WHO a tenant is only when the tenant reaches out — a call,
 * a request, an order. A `view` is never attributable to him: browsing is not
 * consent to be identified, and a directory where looking at a shop hands that
 * shop your name and phone number is a directory nobody browses twice.
 *
 * So `kind: 'view'` rows carry a userId for OUR counting (distinct viewers,
 * dedupe, admin funnel) but the provider-facing API must aggregate them and
 * never return the identities. That is enforced in the controller, not here —
 * see `providerVisibleKinds` below for the list this model considers safe.
 */

const mongoose = require('mongoose');

// ─── KINDS ───────────────────────────────────────────────────────────────────
//   view         opened the provider's card. Deduped to once per day.
//   call_tel     tapped ফোন করুন (a `tel:` dial-out). We cannot know whether
//                it connected — only that intent was expressed. Counted as a
//                lead, never reported as a completed call.
//   call_inapp   placed an in-app WebRTC call (models/Call.js). Outcome IS
//                known, and `callId` links to it.
//   request      submitted a `request`-tier structured callback (gas, water)
//   order        placed an `order`-tier itemised order (grocery, eatery)
const KINDS = ['view', 'call_tel', 'call_inapp', 'request', 'order'];

// What counts as "connected" rather than merely "looked". This is the number
// that answers the admin's question, and the number a provider is shown.
const CONNECTING_KINDS = ['call_tel', 'call_inapp', 'request', 'order'];

const ContactEventSchema = new mongoose.Schema(
  {
    providerId: {
      type: mongoose.Schema.Types.ObjectId, ref: 'Provider', required: true, index: true,
    },
    // Null for a logged-out visitor. Guests still count as demand, they just
    // cannot be deduped or followed up.
    userId: {
      type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true,
    },

    kind:     { type: String, enum: KINDS, required: true },
    // Denormalised so every breakdown the admin console asks for is a single
    // $group, with no lookup into Provider.
    category: { type: String, required: true, index: true },

    // ─── Where the user was ──────────────────────────────────────────────────
    // Snapshotted, never re-resolved. A tenant who moves out must not have last
    // month's connections silently re-point at their new flat — the same rule
    // that keeps a receipt attached to the tenancy it was issued under.
    thana:      { type: String, trim: true, default: '', maxlength: 100 },
    area:       { type: String, trim: true, default: '', maxlength: 120 },
    buildingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Building', default: null },
    // How far apart they were at the moment of contact. The single most useful
    // number for tuning coverage radii later: if nobody ever contacts a
    // provider beyond 1.2 km, a 5 km default radius is a lie.
    distanceKm: { type: Number, default: null },

    // For kind:'call_inapp' — the Call doc carries ringing/accepted/missed and
    // duration, so outcome is never guessed here.
    callId: { type: mongoose.Schema.Types.ObjectId, ref: 'Call', default: null },

    // 'YYYY-MM-DD' in Asia/Dhaka. Part of the view dedupe key, and what every
    // daily rollup groups on without needing a date-truncation stage.
    dayKey: { type: String, required: true, index: true },
  },
  { timestamps: true },
);

// ─── Indexes ─────────────────────────────────────────────────────────────────

// One view per (user, provider, day). Without this, a tenant scrolling back and
// forth inflates a provider's view count into a number he will not believe —
// and a metric a shopkeeper does not believe is worse than no metric.
//
// Partial, for the same reason SellInterest's key is partial: a plain unique
// index treats every guest's null userId as one value, so the FIRST anonymous
// viewer would be the only one ever recorded. Restricting the index to rows
// carrying a real ObjectId leaves guests unindexed and uncapped.
ContactEventSchema.index(
  { providerId: 1, userId: 1, kind: 1, dayKey: 1 },
  {
    unique: true,
    partialFilterExpression: { kind: 'view', userId: { $type: 'objectId' } },
  },
);

// The provider's own stats screen: his rows, newest first.
ContactEventSchema.index({ providerId: 1, createdAt: -1 });

// Admin breakdowns: connections per category over a window, per area.
ContactEventSchema.index({ category: 1, kind: 1, dayKey: -1 });
ContactEventSchema.index({ thana: 1, kind: 1, dayKey: -1 });

// A tenant's own order/contact history.
ContactEventSchema.index({ userId: 1, createdAt: -1 });

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** 'YYYY-MM-DD' in Asia/Dhaka — the day boundary users actually live in. */
function dhakaDayKey(at = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at);
}

/**
 * Record one connection. Idempotent for views (the unique index absorbs a
 * repeat tap on the same day); every other kind is a genuine separate event
 * and is always inserted.
 *
 * Never throws on a duplicate view — a analytics write must not be able to
 * fail a tenant's page load.
 */
ContactEventSchema.statics.record = async function record(evt) {
  const doc = { ...evt, dayKey: evt.dayKey || dhakaDayKey() };
  try {
    return await this.create(doc);
  } catch (err) {
    if (err && err.code === 11000) return null;   // same viewer, same day
    throw err;
  }
};

/**
 * Which kinds a PROVIDER may see attributed to a named user. `view` is absent
 * on purpose — he sees his view COUNT, never who the viewers were.
 */
ContactEventSchema.statics.providerVisibleKinds = function providerVisibleKinds() {
  return [...CONNECTING_KINDS];
};

ContactEventSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
});

ContactEventSchema.statics.KINDS = KINDS;
ContactEventSchema.statics.CONNECTING_KINDS = CONNECTING_KINDS;
ContactEventSchema.statics.dhakaDayKey = dhakaDayKey;

module.exports = mongoose.model('ContactEvent', ContactEventSchema);
module.exports.KINDS = KINDS;
module.exports.CONNECTING_KINDS = CONNECTING_KINDS;
module.exports.dhakaDayKey = dhakaDayKey;
