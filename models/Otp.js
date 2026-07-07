'use strict';

const mongoose = require('mongoose');

/**
 * Otp — short-lived one-time codes for phone verification, delivered via SMS
 * (sms.net.bd). This replaces Firebase Phone Auth for BOTH flows:
 *
 *   • Signup          POST /api/auth/signup/start  → POST /api/auth/signup/verify
 *   • Forgot password POST /api/auth/forgot-password → POST /api/auth/reset-password
 *
 * Design notes:
 *   • ONE active code per phone. `phoneNumber` is unique, so re-requesting an
 *     OTP upserts the same document with a fresh `otp` AND a fresh `createdAt`,
 *     which restarts the 5-minute expiry window.
 *   • The code is stored as a plain String (per spec). Brute-forcing it is
 *     bounded by the per-endpoint rate limiters (see middleware/rateLimit.js)
 *     plus the 5-minute TTL, and the login lockout still guards the account
 *     itself.
 *   • TTL index: MongoDB's background monitor deletes the document 300s
 *     (5 minutes) after `createdAt`, so expired/abandoned codes clean
 *     themselves up — no cron needed.
 */
const OtpSchema = new mongoose.Schema(
  {
    phoneNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    otp: {
      type: String,
      required: true,
    },
    // TTL: this document auto-deletes 300 seconds (5 min) after createdAt.
    // We reset createdAt on every re-issue so the newest code always gets a
    // full, fresh 5-minute window.
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 300,
    },
  },
  { versionKey: false }
);

module.exports = mongoose.model('Otp', OtpSchema);
