'use strict';

const mongoose = require('mongoose');

/**
 * OtpQuota — how many OTPs one PHONE NUMBER may be sent in a window.
 * ═══════════════════════════════════════════════════════════════════════════
 * One row per number, holding the window currently in progress.
 *
 * ─── WHY PER PHONE, WHEN WE ALREADY RATE-LIMIT PER IP ────────────────────────
 * Because the thing being protected is not the server. It is:
 *
 *   1. A REAL PERSON'S HANDSET. SMS bombing works by asking us to text someone
 *      else, over and over. The victim is not the one making the requests, so
 *      nothing keyed on the requester protects them.
 *   2. THE SMS BILL. Every code is a paid message through sms.net.bd.
 *
 * Both are attributes of the NUMBER, not of whoever asked. An attacker on a
 * phone connection in Bangladesh rotates through carrier-NAT addresses for
 * free, which makes a per-IP cap the wrong instrument twice over: too loose for
 * the attacker, and too tight for the many legitimate users who share one
 * carrier IP.
 *
 * models/OtpAttempt.js already tracks a phone dimension, but its enforcement
 * counter is keyed on the (ipAddress, phoneNumber) PAIR — so a fresh IP starts
 * a fresh count and the victim keeps receiving messages. Its `samePhoneCount`
 * check only sets `flaggedForReview`; nothing refuses the request. This
 * collection is the missing half: a counter that IP cannot reset.
 *
 * ─── WHY MONGO AND NOT THE REDIS LIMITER ─────────────────────────────────────
 * middleware/advancedRateLimiter.js is deliberately FAIL-OPEN — a Redis blip
 * must not lock every user in Bangladesh out of the app. That trade is right
 * for ordinary routes and wrong here: failing open on this limiter means an
 * attacker who can disturb Redis gets unmetered SMS at our expense, aimed at
 * somebody's real phone.
 *
 * Mongo inverts it for free. An OTP cannot be issued without writing the code
 * to Otp/MerchantOtp, so if Mongo is unreachable no message goes out anyway —
 * this limiter cannot fail open without the whole flow already being down.
 * It also survives restarts and is shared across instances, which per-process
 * memory is not.
 *
 * ─── WHY BOTH SYSTEMS SHARE ONE COLLECTION ───────────────────────────────────
 * This is the exact OPPOSITE of the call made in models/MerchantOtp.js, and
 * deliberately so. A CODE is a credential whose lifecycle belongs to one
 * system, and sharing that collection broke the landlord who also runs the shop
 * downstairs: his two accounts overwrote each other's codes.
 *
 * A QUOTA protects a resource that is shared in the real world. That man has
 * one handset and we have one SMS account. Five rental codes plus five merchant
 * codes is ten messages to one pocket, and the pocket does not care which app
 * sent them. Counting them together is not a leak between the systems; it is
 * the only count that describes what actually happened.
 *
 * The headroom is deliberate: the limit is per window, not per flow, and both
 * apps already impose a 60-second resend cooldown in their UI — so a real
 * person doing one signup and one reset on the same number in the same quarter
 * of an hour never comes close.
 * ═══════════════════════════════════════════════════════════════════════════
 */
const OtpQuotaSchema = new mongoose.Schema(
  {
    // E.164. UNIQUE is load-bearing, not decoration: two rows for one number
    // would split the counter and silently double the real limit.
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    // Requests counted so far inside the window that began at `windowStartedAt`.
    count: {
      type: Number,
      default: 0,
      min: 0,
    },

    // When the current window opened. This — NOT the TTL below — is what
    // decides whether a request belongs to the running window or opens a new
    // one, so the limiter stays exact regardless of when Mongo gets round to
    // deleting anything.
    windowStartedAt: {
      type: Date,
      default: Date.now,
    },

    // TTL index: housekeeping only. Mongo's background monitor sweeps roughly
    // once a minute, so a spent row can outlive its window by up to that long.
    // Harmless here precisely because expiry is decided by `windowStartedAt` —
    // a lingering row whose window has closed is simply reset in place on the
    // next request rather than blocking it.
    expiresAt: {
      type: Date,
      default: Date.now,
    },
  },
  { versionKey: false, timestamps: true },
);

OtpQuotaSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('OtpQuota', OtpQuotaSchema);
