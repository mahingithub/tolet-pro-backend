'use strict';

/**
 * Subscription model
 * ──────────────────────────────────────────────────────────────────────────
 * Stores the billing state for landlords (hosts).
 * Status enum matches typical billing pipelines (trialing, active, past_due, canceled).
 */

const mongoose = require('mongoose');

const SubscriptionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    planId: { type: String, enum: ['free', 'plus_monthly', 'plus_yearly', 'pro_monthly', 'pro_yearly'], default: 'free' },
    status: { type: String, enum: ['trialing', 'active', 'past_due', 'canceled'], default: 'trialing' },

    // When a Pro trial ends, or null when this account never had one.
    //
    // Nullable because there is no automatic trial: a row created by checkout
    // belongs to someone who went straight to paying, and stamping a synthetic
    // trial date on it would misreport history. Only the share-task claim
    // (controllers/billing.controller.js → claimShareTrial) sets this.
    //
    // `planId` stays 'free' during a trial (nothing was purchased), so the tier
    // a trial GRANTS is recorded separately in `trialTier` rather than inferred
    // — see utils/subscriptionTier.js → tierOf(), which treats a null
    // trialEndsAt as "not on a trial".
    trialEndsAt: { type: Date, default: null },
    trialTier: { type: String, enum: ['free', 'plus', 'pro'], default: 'pro' },

    // For paid subscriptions
    currentPeriodEnd: { type: Date, default: null },
    autoRenew: { type: Boolean, default: true },

    // When the host completed the "share the app" task to earn a free Pro
    // trial. Set once and never cleared — it is what makes the grant a
    // one-time reward rather than a renewable one, and it's what hides the
    // "Get Free Pro Trial" CTA in the dashboard/wizard afterwards.
    shareTrialClaimedAt: { type: Date, default: null },

    // Last simulated payment info
    lastPaymentMethod: { type: String, default: '' },
    lastTransactionId: { type: String, default: '' },
  },
  { timestamps: true },
);

SubscriptionSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('Subscription', SubscriptionSchema);
