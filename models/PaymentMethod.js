'use strict';

/**
 * PaymentMethod model — a landlord's personal manual-payment accounts.
 * ──────────────────────────────────────────────────────────────────────────
 * TO-LET PRO Version 1 collects rent WITHOUT a payment gateway: tenants send
 * money straight to the landlord's personal bKash / Nagad / Rocket / Bank
 * account, then submit the transaction id for the landlord to verify.
 *
 * A landlord may register MULTIPLE accounts (one bKash + one bank, etc.) but
 * exactly one can be flagged `isDefault` — that is the account shown in rent
 * reminders and highlighted on the tenant's rent page. The controller keeps
 * the "single default" + "single active default" invariants.
 *
 * Scoped per landlord (landlordId) so one landlord can never read/edit
 * another's payout details.
 */

const mongoose = require('mongoose');

// The four rails TO-LET PRO supports in V1. `bank` carries the extra
// bankName/branchName fields; the mobile wallets just use accountNumber.
const PAYMENT_TYPES = ['bkash', 'nagad', 'rocket', 'bank'];

const PaymentMethodSchema = new mongoose.Schema(
  {
    landlordId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // Which rail this account belongs to.
    type: { type: String, enum: PAYMENT_TYPES, required: true },

    // Whose account this is (printed on the tenant's rent page).
    accountHolderName: { type: String, trim: true, required: true, maxlength: 120 },

    // Mobile-money number (bKash/Nagad/Rocket) OR bank account number.
    accountNumber: { type: String, trim: true, required: true, maxlength: 40 },

    // Bank-only extras (ignored for mobile wallets).
    bankName:   { type: String, trim: true, default: '', maxlength: 120 },
    branchName: { type: String, trim: true, default: '', maxlength: 120 },

    // Optional payment QR image (uploaded to Cloudinary).
    qrImageUrl:      { type: String, trim: true, default: '' },
    qrImagePublicId: { type: String, trim: true, default: '' },

    // Landlords can temporarily disable a method without deleting it.
    isActive:  { type: Boolean, default: true },
    // Exactly one method is the default across all of a landlord's methods.
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true },
);

PaymentMethodSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
});

// Default lookups filter by landlordId; the reminder reads the default.
PaymentMethodSchema.index({ landlordId: 1, isDefault: -1 });

module.exports = mongoose.model('PaymentMethod', PaymentMethodSchema);
module.exports.PAYMENT_TYPES = PAYMENT_TYPES;
