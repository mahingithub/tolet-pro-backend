'use strict';

const mongoose = require('mongoose');

/**
 * MerchantOtp — one-time codes for the PROVIDER app, and nothing else.
 * ─────────────────────────────────────────────────────────────────────────────
 * A near-copy of models/Otp.js, deliberately separate rather than shared.
 *
 * ─── WHY NOT JUST USE Otp ────────────────────────────────────────────────────
 * `Otp.phoneNumber` is unique, so that collection holds exactly ONE live code
 * per number — across both systems. A landlord who also runs the shop
 * downstairs is a real person with two accounts on one number (that is the
 * whole premise of the Merchant/User split), and on the shared collection his
 * two systems fight over a single row: a rental signup code issued while his
 * merchant password reset is in flight silently overwrites it, and the code he
 * is holding stops working with no explanation on either side. Re-requesting
 * gives him the same collision again.
 *
 * Separating the collections makes the two systems independent here the way
 * they already are everywhere else — separate identity collection, separate
 * token audience, separate cookie name, and now separate codes.
 *
 *   Otp          → User, via /api/auth/*
 *   MerchantOtp  → Merchant, via /api/merchant/auth/*
 *
 * ─── FIELD NAME ──────────────────────────────────────────────────────────────
 * `phone`, not `phoneNumber`. It matches Merchant.phone and every signature in
 * merchantAuth.service.js, and it means a query copy-pasted from the rental
 * service reads wrong instead of looking right — these two collections should
 * not be accidentally interchangeable.
 *
 * ─── WHY THE CODE IS PLAINTEXT ───────────────────────────────────────────────
 * Same trade the rental Otp documents, kept deliberately rather than by
 * inheritance: guessing is bounded by the route's rate limiter
 * (server.js → rateLimiters.auth), the 5-minute TTL, and single use — the
 * service deletes the row the moment a code is spent. The login lockout still
 * guards the account itself. Hashing here would also cost the e2e suite its
 * ability to read the issued code out of the collection, which is how every
 * merchant auth test drives the OTP flow today.
 *
 * ─── MIGRATION ───────────────────────────────────────────────────────────────
 * None needed. Codes in the old shared collection expire on their own within
 * five minutes, so the worst case at deploy is one shopkeeper mid-signup
 * tapping "আবার কোড পাঠান".
 */
const MerchantOtpSchema = new mongoose.Schema(
  {
    // E.164, matching Merchant.phone. Unique for the same reason Otp is: ONE
    // active code per number, and re-requesting replaces it rather than
    // leaving two valid codes in flight.
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    otp: {
      type: String,
      required: true,
    },
    // TTL: MongoDB's background monitor deletes this document 300 seconds
    // (5 minutes) after `createdAt`. The service re-stamps `createdAt` on every
    // re-issue, so the newest code always gets a full, fresh window. Keep this
    // in step with OTP_TTL_MIN in services/merchantAuth.service.js — that value
    // is what the app promises the shopkeeper on screen.
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 300,
    },
  },
  { versionKey: false },
);

module.exports = mongoose.model('MerchantOtp', MerchantOtpSchema);
