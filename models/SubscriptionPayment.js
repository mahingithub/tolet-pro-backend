'use strict';

/**
 * SubscriptionPayment — a host's "I have paid for Plus/Pro" claim.
 * ──────────────────────────────────────────────────────────────────────────
 * There is no payment gateway. The host pays into one of our accounts
 * (bKash / Nagad / Rocket / bank — BillingSettings.methods) and submits the
 * TrxID, who paid and (optionally) a screenshot.
 * services/subscriptionPayment.service.js then accepts it — on a matching
 * forwarded wallet SMS, or an admin's approval — and only an approval turns
 * the claim into a plan.
 *
 *   pending → approved (verifiedBy 'sms' | 'admin')
 *           → rejected (rejectionReason shown to the host, who may send again)
 */

const mongoose = require('mongoose');

const SubscriptionPaymentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Snapshot so the admin list renders without a join.
    userName:  { type: String, trim: true, default: '', maxlength: 120 },
    userPhone: { type: String, trim: true, default: '', maxlength: 20 },

    planId: { type: String, required: true, enum: ['plus_monthly', 'plus_yearly', 'pro_monthly', 'pro_yearly'] },
    // The plan price when submitted — what the wallet SMS has to cover.
    amount: { type: Number, required: true, min: 0 },

    method: { type: String, required: true, enum: ['bkash', 'nagad', 'rocket', 'bank'] },
    // Which of our payment methods, and a copy of its account ("bKash 017…",
    // "Dutch-Bangla Bank 123…") so the claim still reads right after an edit.
    methodId: { type: mongoose.Schema.Types.ObjectId, default: null },
    paidTo:   { type: String, trim: true, default: '', maxlength: 160 },
    // Wallet TrxID, or a bank transfer's reference.
    trxId:  { type: String, required: true, trim: true, maxlength: 40 },
    // Wallets: '01XXXXXXXXX' paid from. Bank: the sending account's name or number.
    sender: { type: String, required: true, trim: true, maxlength: 80 },

    // Private (Cloudinary 'authenticated'): it shows phone numbers and balances.
    screenshotUrl:      { type: String, trim: true, default: '' },
    screenshotPublicId: { type: String, trim: true, default: '' },

    // Sending the details again corrects the open claim instead of queueing a
    // second one; this counts how often, to cap it.
    submissions: { type: Number, default: 1 },

    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },

    // Why the automatic check didn't accept it. '' while no matching SMS has arrived.
    issue: {
      type: String,
      enum: ['', 'already_used', 'method_mismatch', 'too_old', 'amount_short', 'sender_mismatch'],
      default: '',
    },
    smsId: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentSms', default: null },

    verifiedBy:      { type: String, enum: ['', 'sms', 'admin'], default: '' },
    reviewedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt:      { type: Date, default: null },
    rejectionReason: { type: String, trim: true, default: '', maxlength: 300 },
  },
  { timestamps: true },
);

SubscriptionPaymentSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
});

SubscriptionPaymentSchema.index({ status: 1, createdAt: -1 });
SubscriptionPaymentSchema.index({ trxId: 1, status: 1 });

module.exports = mongoose.model('SubscriptionPayment', SubscriptionPaymentSchema);
