'use strict';

/**
 * Merchant model — a shopkeeper's account. NOT a To-Let Pro user.
 * ─────────────────────────────────────────────────────────────────────────────
 * The service-provider platform is a SEPARATE SYSTEM from the rental platform.
 * A গ্যাস সাপ্লায়ার or a মুদি দোকানদার has no reason to hold a tenancy account,
 * and To-Let Pro's roles stay what they always were: tenant ↔ landlord.
 *
 *   Merchant (own phone/OTP identity)  ──owns──▶  Provider (the business)
 *   User     (tenant / landlord)       ──────────▶ rents flats
 *
 * They are separated cryptographically as well as logically: merchant tokens
 * carry the audience 'tolet-pro-provider' and `scope: 'merchant'`, so a
 * tenant's token cannot reach a shop's data and a merchant's cannot reach a
 * tenancy — the same isolation the admin console already relies on, applied a
 * third time.
 *
 * ─── WHAT IS DELIBERATELY ABSENT ─────────────────────────────────────────────
 * No `roles`, no tenantProfile, no landlordProfile, no trust score, no
 * verification sub-document. A merchant is a login and a phone number; the
 * identity that gets CHECKED belongs to the business (Provider.verification),
 * because it is the shop a tenant is trusting, not the account.
 *
 * ─── ONE PERSON, MANY SHOPS ──────────────────────────────────────────────────
 * A merchant may own several Providers (the man with a মুদি দোকান and a gas
 * agency). Provider.ownerMerchantId is the link; nothing here caps it.
 */

const mongoose = require('mongoose');

// A device session, so "log out everywhere" and revocation work the same way
// they do for users. Deliberately a slim copy rather than a shared sub-schema:
// the two systems must be able to diverge without one dragging the other.
const MerchantSessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true },
    device:    { type: String, default: '', maxlength: 200 },
    ip:        { type: String, default: '', maxlength: 60 },
    createdAt: { type: Date, default: Date.now },
    lastSeenAt:{ type: Date, default: Date.now },

    // ─── Refresh token, kept ON the session ──────────────────────────────
    // The rental system's RefreshToken collection refs User and cannot hold a
    // merchant, and bolting an `ownerType` onto that shared model would
    // re-couple the two systems we just separated. A merchant already has a
    // session row, so the token lives here: only its HASH is stored, so a
    // database read never yields a usable credential.
    refreshHash:      { type: String, default: '', select: false },
    refreshExpiresAt: { type: Date, default: null },
  },
  { _id: false },
);

const MerchantSchema = new mongoose.Schema(
  {
    // E.164, matching the User model's format so one phone-normalising helper
    // serves both. This is the login identity and the only required one —
    // asking a shopkeeper for an email address is asking for a field he will
    // make up.
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      match: [/^\+\d{8,15}$/, 'Invalid phone format'],
    },
    phoneVerified: { type: Boolean, default: false },

    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },

    // `select: false` — a password must never ride along on an ordinary read.
    password: { type: String, required: true, select: false, minlength: 8 },
    passwordChangedAt: { type: Date, default: null },

    // Lockout after repeated failures, mirroring the user login path.
    loginAttempts: { type: Number, default: 0, select: false },
    lockUntil:     { type: Date, default: null, select: false },

    // `select: false` — a merchant document read for any other purpose must
    // not drag refresh hashes along with it.
    sessions: { type: [MerchantSessionSchema], default: [], select: false },

    language: { type: String, enum: ['bn', 'en'], default: 'bn' },

    // Push tokens for the order ping. The notification ladder (push → socket →
    // call/SMS) is what actually saves an order, so this is not optional
    // plumbing.
    pushTokens: { type: [String], default: [] },

    isBanned:  { type: Boolean, default: false },
    banReason: { type: String, default: '', maxlength: 300 },

    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Phone is the login identity; `unique: true` above already indexes it.
MerchantSchema.index({ createdAt: -1 });

/** Is this account temporarily locked out after failed logins? */
MerchantSchema.methods.isLocked = function isLocked() {
  return Boolean(this.lockUntil && this.lockUntil > new Date());
};

MerchantSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    // Belt and braces alongside `select: false` — a merchant document must
    // never carry credentials or session ids onto the wire.
    delete ret.password;
    delete ret.loginAttempts;
    delete ret.lockUntil;
    delete ret.sessions;
    delete ret.pushTokens;
    return ret;
  },
});

module.exports = mongoose.model('Merchant', MerchantSchema);
