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

    // When the launch trial ends. `planId` stays 'free' during a trial (nothing
    // was purchased), so the tier the trial GRANTS is recorded separately here
    // rather than inferred — see utils/subscriptionTier.js → tierOf().
    trialEndsAt: { type: Date, required: true },
    trialTier: { type: String, enum: ['free', 'plus', 'pro'], default: 'pro' },

    // For paid subscriptions
    currentPeriodEnd: { type: Date, default: null },
    autoRenew: { type: Boolean, default: true },

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
