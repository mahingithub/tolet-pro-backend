'use strict';

/**
 * BillingSettings — the one settings row for plan payments.
 * ──────────────────────────────────────────────────────────────────────────
 * Plan prices, the payment methods hosts can pay with (bKash / Nagad /
 * Rocket / bank accounts), and the hash of the key the wallet phone's SMS
 * forwarder sends. Edited by super admins in the admin console (Subscriptions
 * → Plan payments → Settings); read by services/subscriptionPayment.service.js.
 *
 * Only a hash of the forwarder key is kept: the key is shown once, when made.
 */

const mongoose = require('mongoose');

// One account hosts can pay into. Added with "Add Payment System".
const PaymentMethodSchema = new mongoose.Schema({
  type: { type: String, required: true, enum: ['bkash', 'nagad', 'rocket', 'bank'] },
  // Wallets: the mobile number. Bank: the account number.
  accountNumber: { type: String, required: true, trim: true, maxlength: 34 },
  // The name the host will see the money going to (wallet or bank account holder).
  accountName: { type: String, trim: true, default: '', maxlength: 120 },
  // Wallets only: personal → Send Money, merchant → Payment.
  accountType: { type: String, enum: ['', 'personal', 'merchant'], default: '' },
  bankName: { type: String, trim: true, default: '', maxlength: 120 },
  branchName: { type: String, trim: true, default: '', maxlength: 120 },
  routingNumber: { type: String, trim: true, default: '', maxlength: 20 },
  // Anything else the host should know ("write your phone number as reference").
  instructions: { type: String, trim: true, default: '', maxlength: 300 },
  enabled: { type: Boolean, default: true },
});

const BillingSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'billing' },
    methods: { type: [PaymentMethodSchema], default: [] },
    // ৳ per month. Unset = the default in subscriptionPayment.service → DEFAULT_PLANS.
    prices: {
      plus_monthly: { type: Number, min: 1 },
      pro_monthly:  { type: Number, min: 1 },
    },
    // % off 12 months when paying yearly. Yearly prices are always derived
    // from this, so a year can never cost more than twelve months.
    yearlyDiscount: { type: Number, min: 0, max: 50 },
    smsKeyHash: { type: String, default: '' },
    smsKeyCreatedAt: { type: Date, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model('BillingSettings', BillingSettingsSchema);
