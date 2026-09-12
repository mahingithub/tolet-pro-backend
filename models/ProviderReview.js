'use strict';

/**
 * ProviderReview — a tenant's rating of a shop.
 * ─────────────────────────────────────────────────────────────────────────────
 * Its OWN model, not models/Review.js. That one is tenant↔landlord: its
 * `revieweeId` refs User and its `revieweeRole` enum is ['landlord','tenant'].
 * A provider is a Provider document owned by a Merchant and is not a User at
 * all, so reusing it would mean widening a ref and an enum until neither
 * described anything — the same re-coupling the merchant separation exists to
 * avoid.
 *
 * ─── YOU MAY ONLY REVIEW SOMETHING THAT HAPPENED ─────────────────────────────
 * A review is gated on a record in the connection ledger, and the gate differs
 * by tier because the categories genuinely differ:
 *
 *   order / request   a COMPLETED ServiceRequest. Anything less is not an
 *                     opinion about the service, it is an opinion about
 *                     waiting.
 *   contact           a recorded `call_tel`. গৃহকর্মী, ইলেকট্রিশিয়ান, প্লাম্বার
 *                     and ইন্টারনেট have no order flow by design, so demanding
 *                     an order would mean the four categories where trust
 *                     matters MOST could never be reviewed — which is exactly
 *                     backwards. We cannot know a `tel:` call connected, only
 *                     that it was placed, so this gate is weaker on purpose and
 *                     `verifiedPurchase` records which kind it was.
 *
 * ─── THE SHOPKEEPER GETS TO ANSWER ───────────────────────────────────────────
 * `reply` is the most valuable field here. On a hyperlocal listing a calm reply
 * to a bad review does more for a shop than the review costs it, and a review
 * system with no right of reply is one shopkeepers campaign to have removed.
 * He can reply once and edit it; he can never edit or delete the review.
 */

const mongoose = require('mongoose');

// One person, one shop, one opinion — editable, not stackable. Without this a
// single annoyed customer can move a small shop's average at will, and on a
// hyperlocal directory "small" is every shop.
const ProviderReviewSchema = new mongoose.Schema(
  {
    providerId: {
      type: mongoose.Schema.Types.ObjectId, ref: 'Provider', required: true, index: true,
    },
    reviewerId: {
      type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true,
    },
    // Denormalised at write time so a list renders without a join. A reviewer
    // who later changes their display name does not retroactively rewrite the
    // name attached to an opinion they left a year ago.
    reviewerName: { type: String, trim: true, default: '', maxlength: 120 },

    // Snapshotted for the same reason a ContactEvent snapshots its category:
    // a provider who switches category must not relabel old reviews.
    category: { type: String, required: true, index: true },

    rating:  { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, default: '', maxlength: 1000 },

    // ─── What entitled this review ───────────────────────────────────────────
    // Kept so the gate's decision is auditable after the fact, and so a card
    // can mark the stronger kind.
    //   'order'   a completed ServiceRequest — the strong evidence
    //   'contact' a recorded call — the weak evidence contact-tier allows
    basis: { type: String, enum: ['order', 'contact'], required: true },
    requestId: {
      type: mongoose.Schema.Types.ObjectId, ref: 'ServiceRequest', default: null,
    },

    // ─── The shopkeeper's answer ─────────────────────────────────────────────
    reply: {
      text:   { type: String, trim: true, default: '', maxlength: 600 },
      at:     { type: Date, default: null },
      // The Merchant who wrote it. Recorded because a business can change
      // hands, and the reply should stay attributed to whoever actually said it.
      byMerchantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Merchant', default: null },
    },

    // Hidden by a moderator. NOT deleted: a removed review that leaves no row
    // behind lets the same person post again and looks, to them, like the
    // platform silently ate their opinion.
    hidden:       { type: Boolean, default: false },
    hiddenReason: { type: String, default: '', maxlength: 300 },
  },
  { timestamps: true },
);

// One review per person per shop. Enforced in the database, not just in the
// controller: the controller can be bypassed by a retry, a double tap, or the
// next endpoint somebody writes.
ProviderReviewSchema.index({ providerId: 1, reviewerId: 1 }, { unique: true });

// The provider's public review list: newest first, hidden ones excluded.
ProviderReviewSchema.index({ providerId: 1, hidden: 1, createdAt: -1 });

// "Have I reviewed this shop already?" on the tenant's own order screen.
ProviderReviewSchema.index({ reviewerId: 1, createdAt: -1 });

/**
 * Rebuild a provider's rating from its reviews.
 *
 * Recomputed from the rows rather than maintained incrementally, for the same
 * reason LedgerParty.recompute() exists: an edited review has to subtract its
 * OLD value, and a running average that ever drifts can never be reconciled
 * against anything. A shop's public score is exactly the mean of the visible
 * reviews or it is not a score.
 *
 * Hidden reviews are excluded from both halves — a moderated review must not
 * keep moving the average from behind a curtain.
 */
ProviderReviewSchema.statics.recomputeProvider = async function recomputeProvider(providerId) {
  const [agg] = await this.aggregate([
    { $match: { providerId: new mongoose.Types.ObjectId(String(providerId)), hidden: false } },
    { $group: { _id: null, avg: { $avg: '$rating' }, n: { $sum: 1 } } },
  ]);

  const ratingCount = agg ? agg.n : 0;
  // One decimal. A shop showing 4.3333333 looks like a spreadsheet, and the
  // extra digits carry no information a tenant can act on.
  const ratingAvg = agg ? Math.round(agg.avg * 10) / 10 : 0;

  await mongoose.model('Provider').updateOne(
    { _id: providerId },
    { $set: { ratingAvg, ratingCount } },
  );

  return { ratingAvg, ratingCount };
};

ProviderReviewSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    // The reviewer's id never goes to the wire. The name is shown because a
    // review nobody signed is worth nothing, but a shop does not get a handle
    // it can look the person up by.
    delete ret.reviewerId;
    delete ret.hiddenReason;
    return ret;
  },
});

module.exports = mongoose.models.ProviderReview
  || mongoose.model('ProviderReview', ProviderReviewSchema);
