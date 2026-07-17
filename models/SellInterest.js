'use strict';

/**
 * SellInterest model — lightweight demand-gauge lead.
 * ──────────────────────────────────────────────────────────────────────────
 * Self-service buying/selling is currently OFF (see the frontend
 * SALE_INTENT_ENABLED flag) — it's handled by the support team / agency. While
 * it's "Coming Soon", the Add Property screen shows an "I am interested in
 * selling my property" button. Each tap records ONE of these documents so the
 * admin panel can see how many people want to sell (raw demand), and the agency
 * has a follow-up list.
 *
 * No form / PII is collected: for a logged-in user we copy their existing
 * account name + phone (so the agency can reach out); guests are recorded
 * anonymously as a raw count.
 */

const mongoose = require('mongoose');

const SellInterestSchema = new mongoose.Schema(
  {
    // Null for guests (not logged in). One doc per (userId, kind) for logged-in
    // users — repeat taps bump `clickCount` instead of inflating the head count.
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },

    // Denormalized from the user's account at click time so the agency can
    // follow up without a JOIN. Empty for guests.
    name:  { type: String, trim: true, default: '', maxlength: 120 },
    phone: { type: String, trim: true, default: '', maxlength: 20 },

    // Which side of the transaction the person is interested in. Only 'sell' is
    // wired to a button today; 'buy' is reserved so the same collection can gauge
    // buyer demand later without a migration.
    kind: { type: String, enum: ['sell', 'buy'], default: 'sell', index: true },

    // Where the click came from (e.g. 'add_property'), for future breakdowns.
    source: { type: String, trim: true, default: 'add_property', maxlength: 60 },

    // How many times this same person tapped the button (logged-in only).
    clickCount: { type: Number, default: 1, min: 1 },
  },
  { timestamps: true },
);

SellInterestSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('SellInterest', SellInterestSchema);
