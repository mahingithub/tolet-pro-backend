'use strict';

/**
 * PaymentSms — a bKash / Nagad "money received" message, forwarded by the
 * phone that holds our wallet SIM (POST /api/billing/payments/sms).
 *
 * Kept once per wallet + TrxID. `paymentId` is set when a SubscriptionPayment
 * is accepted on it, so one message can never pay for two plans.
 */

const mongoose = require('mongoose');

const PaymentSmsSchema = new mongoose.Schema(
  {
    method:    { type: String, required: true, enum: ['bkash', 'nagad'] },
    trxId:     { type: String, required: true, trim: true },
    amount:    { type: Number, required: true, min: 0 },
    // '01XXXXXXXXX', or an agent / merchant code when paid through one.
    sender:    { type: String, trim: true, default: '' },
    text:      { type: String, default: '', maxlength: 1000 },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionPayment', default: null },
  },
  { timestamps: true },
);

PaymentSmsSchema.index({ method: 1, trxId: 1 }, { unique: true });

module.exports = mongoose.model('PaymentSms', PaymentSmsSchema);
