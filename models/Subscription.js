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
    planId: { type: String, enum: ['free', 'pro_monthly', 'pro_yearly'], default: 'free' },
    status: { type: String, enum: ['trialing', 'active', 'past_due', 'canceled'], default: 'trialing' },
    
    // The timestamp when the 3-month trial ends
    trialEndsAt: { type: Date, required: true },
    
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
