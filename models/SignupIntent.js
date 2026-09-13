'use strict';

const mongoose = require('mongoose');

/**
 * SignupIntent captures the (name, hashed password, role) the user submitted
 * on the RENTAL app's signup form, keyed by phone, so that none of it has to be
 * re-typed after the code is confirmed.
 *
 * The flow is entirely server-side (services/auth.service.js):
 *   POST /api/auth/signup/start   → saves this row + texts a code via models/Otp
 *   POST /api/auth/signup/verify  → checks the code, finalizes the User, drops both
 *
 * This header used to describe a Firebase Phone Auth handshake — the client
 * getting an ID token and the backend verifying it with firebase-admin. That
 * has not been true since models/Otp.js replaced Firebase for both signup and
 * password reset. firebase-admin is still a dependency, but only for FCM push
 * (services/firebaseAdmin.js); it has no part in authentication any more.
 *
 * The provider app does NOT use this model. A merchant signup writes straight
 * to an unverified Merchant row instead — see services/merchantAuth.service.js
 * for why that path is deliberately not shared.
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
