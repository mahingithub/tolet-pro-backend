'use strict';

const mongoose = require('mongoose');

/**
 * SignupIntent captures the (name, hashed password, role) the user submitted
 * on the signup form, keyed by phone. After Firebase OTP succeeds on the
 * client, the frontend posts the Firebase ID token to /signup/verify; we
 * verify the token with firebase-admin, look up the matching SignupIntent
 * by phone, and finalize the User document.
 *
 * Entries auto-expire via TTL so abandoned signups don't pile up.
 */

const SignupIntentSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, index: true, unique: true },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['tenant', 'landlord'], default: 'tenant' },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

SignupIntentSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('SignupIntent', SignupIntentSchema);
