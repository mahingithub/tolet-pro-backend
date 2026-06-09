'use strict';

const crypto = require('crypto');
const OtpToken = require('../models/OtpToken');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

function generateOtp() {
  // 6-digit zero-padded numeric OTP
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

/**
 * Issues a new OTP for `purpose='reset_password'`, voiding any prior unconsumed
 * codes for the same phone+purpose. Returns the plaintext code so the caller
 * can deliver it (SMS gateway, dev console, email, etc.).
 *
 * NOTE: For signup, we don't issue OTPs from here — that's Firebase's job.
 *       This service is for the password-reset flow.
 */
async function issueOtp({ phone, purpose }) {
  await OtpToken.deleteMany({ phone, purpose, consumed: false });
  const code = generateOtp();
  const expiresAt = new Date(Date.now() + env.resetOtpTtlMin * 60_000);
  await OtpToken.create({
    phone,
    purpose,
    codeHash: hashCode(code),
    expiresAt,
  });
  return { code, expiresAt };
}

/**
 * Verifies an OTP and marks it consumed. Increments attempts on bad codes,
 * invalidates after maxAttempts. Returns the OtpToken doc if successful.
 */
async function verifyOtp({ phone, purpose, code }) {
  const token = await OtpToken.findOne({ phone, purpose, consumed: false }).sort({ createdAt: -1 });
  if (!token) throw ApiError.badRequest('OTP মেয়াদ শেষ হয়েছে বা পাওয়া যায়নি। আবার পাঠান।', { code: 'otp_not_found' });
  if (token.expiresAt < new Date()) {
    throw ApiError.badRequest('OTP মেয়াদ শেষ হয়েছে। আবার পাঠান।', { code: 'otp_expired' });
  }
  if (token.attempts >= token.maxAttempts) {
    throw ApiError.tooMany('অনেক বার ভুল OTP দিয়েছেন। নতুন OTP নিন।', { code: 'otp_too_many_attempts' });
  }
  if (hashCode(String(code)) !== token.codeHash) {
    token.attempts += 1;
    await token.save();
    throw ApiError.badRequest('OTP ভুল হয়েছে।', { code: 'otp_invalid' });
  }
  token.consumed = true;
  await token.save();
  return token;
}

module.exports = { issueOtp, verifyOtp };
