'use strict';

const mongoose = require('mongoose');

/**
 * OtpToken stores hashed one-time codes used by the reset-password flow.
 *
 * Signup OTPs are NOT stored here — they're handled by Firebase Phone Auth on
 * the client; the backend only verifies the resulting Firebase ID token via
 * firebase-admin. We still keep a `SignupIntent`-style record (see below) to
 * remember the name + (hashed) password the user typed *before* OTP, so that
 * after the ID token is verified we can finalize the account in one go.
 */

const OtpTokenSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, index: true },
    purpose: { type: String, enum: ['reset_password'], required: true },
    // SHA-256 hash of the OTP — we never store the plaintext.
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    consumed: { type: Boolean, default: false },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
  },
  { timestamps: true }
);

// TTL index — Mongo auto-deletes expired docs.
OtpTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('OtpToken', OtpTokenSchema);
