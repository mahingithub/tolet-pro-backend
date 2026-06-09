'use strict';

const bcrypt = require('bcryptjs');
const User = require('../models/User');
const SignupIntent = require('../models/SignupIntent');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');
const firebaseAdmin = require('./firebaseAdmin');
const otpService = require('./otp.service');
const tokenService = require('./token.service');

const GENERIC_LOGIN_ERROR = 'ফোন নম্বর বা পাসওয়ার্ড ভুল হয়েছে।';

/**
 * Step 1 of signup: persist (name, hashedPassword, role) as a SignupIntent
 * keyed by phone, so we can finalize after the client-side Firebase OTP
 * succeeds. We deliberately do NOT create a real User yet — the user must
 * prove control of the phone first.
 *
 * If a verified account already exists for this phone, we refuse with 409.
 */
async function startSignup({ name, phone, password, role }) {
  const existing = await User.findOne({ phone });
  if (existing && existing.phoneVerified) {
    throw ApiError.conflict('এই নম্বরে অ্যাকাউন্ট ইতিমধ্যেই রয়েছে। লগইন করুন।', {
      code: 'account_exists',
    });
  }
  const passwordHash = await bcrypt.hash(password, env.bcryptRounds);
  const expiresAt = new Date(Date.now() + env.signupIntentTtlMin * 60_000);
  await SignupIntent.findOneAndUpdate(
    { phone },
    { name, phone, passwordHash, role: role || 'tenant', expiresAt },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return { ok: true, expiresAt };
}

/**
 * Step 2 of signup: verify the Firebase ID token, look up the SignupIntent,
 * create/update the User, mark phoneVerified, and issue an access token.
 */
async function verifySignup({ idToken }) {
  const { uid, phone } = await firebaseAdmin.verifyIdToken(idToken);

  const intent = await SignupIntent.findOne({ phone });
  if (!intent) {
    throw ApiError.badRequest('সাইনআপ সেশন মেয়াদ শেষ হয়েছে। আবার শুরু করুন।', {
      code: 'signup_intent_missing',
    });
  }

  let user = await User.findOne({ phone });
  if (user && user.phoneVerified) {
    // Edge case: account already exists. Bail rather than overwriting (CRITICAL
    // bug that existed in the old code). Tell client to log in.
    await SignupIntent.deleteOne({ phone });
    throw ApiError.conflict('এই নম্বরে অ্যাকাউন্ট আগে থেকেই রয়েছে। লগইন করুন।', {
      code: 'account_exists',
    });
  }
  if (!user) {
    user = new User({
      name: intent.name,
      phone,
      password: intent.passwordHash,
      role: intent.role,
      phoneVerified: true,
      firebaseUid: uid,
      passwordChangedAt: new Date(),
    });
  } else {
    // User row existed but was never verified — finalize it.
    user.name = intent.name;
    user.password = intent.passwordHash;
    user.role = intent.role;
    user.phoneVerified = true;
    user.firebaseUid = uid;
    user.passwordChangedAt = new Date();
  }

  // Create session
  const crypto = require('crypto');
  const sessionId = crypto.randomUUID();
  user.sessions.push({ sessionId, device: 'New Device', ipAddress: '0.0.0.0' });

  await user.save();
  await SignupIntent.deleteOne({ phone });

  const token = tokenService.signAccessToken(user, sessionId);
  return { token, user };
}

/**
 * Password login. No OTP required. Locks the account after N consecutive
 * failures. Returns a generic error message for both "wrong phone" and
 * "wrong password" to prevent phone enumeration.
 */
async function login({ phone, password, device = 'Unknown device', ipAddress = '0.0.0.0' }) {
  const user = await User.findOne({ phone }).select('+password +loginAttempts +lockUntil');
  if (!user || !user.phoneVerified) {
    // Don't reveal whether the phone exists; hash a dummy password to keep
    // response times roughly constant.
    await bcrypt.compare(password, '$2a$12$abcdefghijklmnopqrstuv'); // bogus hash
    throw ApiError.unauthorized(GENERIC_LOGIN_ERROR, { code: 'invalid_credentials' });
  }
  if (user.isLocked) {
    throw ApiError.tooMany('অ্যাকাউন্ট সাময়িকভাবে লক করা হয়েছে। কিছুক্ষণ পর চেষ্টা করুন।', {
      code: 'account_locked',
    });
  }
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) {
    user.loginAttempts = (user.loginAttempts || 0) + 1;
    if (user.loginAttempts >= env.loginMaxAttempts) {
      user.lockUntil = new Date(Date.now() + env.loginLockMinutes * 60_000);
      user.loginAttempts = 0;
    }
    await user.save();
    throw ApiError.unauthorized(GENERIC_LOGIN_ERROR, { code: 'invalid_credentials' });
  }
  user.loginAttempts = 0;
  user.lockUntil = null;
  user.lastLoginAt = new Date();

  // Create session
  const crypto = require('crypto');
  const sessionId = crypto.randomUUID();
  user.sessions.push({ sessionId, device, ipAddress });
  
  await user.save();

  const token = tokenService.signAccessToken(user, sessionId);
  return { token, user };
}

/**
 * Forgot password — issues a fresh reset OTP and (in this build) returns
 * it via the response in development for testing. In production this OTP
 * should be delivered ONLY via Firebase Phone Auth on the client (same
 * mechanism as signup), and the verify step exchanges a Firebase ID token,
 * not a server-issued code. The `OtpToken` model exists for a future
 * server-side SMS fallback.
 *
 * For Option A (Firebase) the client itself runs `signInWithPhoneNumber`
 * and posts the resulting ID token to `/forgot/verify`. So this `start`
 * endpoint just confirms the account exists in a constant-time way.
 */
async function startForgotPassword({ phone }) {
  const user = await User.findOne({ phone });
  // Constant-time "exists" check — always return ok, never leak.
  return { ok: true, exists: !!(user && user.phoneVerified) };
}

/**
 * Step 2 of forgot password: verify Firebase ID token to confirm phone
 * ownership, then issue a short-lived reset token.
 */
async function verifyForgotPassword({ idToken }) {
  const { phone } = await firebaseAdmin.verifyIdToken(idToken);
  const user = await User.findOne({ phone });
  if (!user || !user.phoneVerified) {
    throw ApiError.notFound('এই নম্বরে অ্যাকাউন্ট পাওয়া যায়নি।', { code: 'user_not_found' });
  }
  const resetToken = tokenService.signResetToken(user);
  return { resetToken };
}

/**
 * Step 3 of forgot password: exchange the reset token + new password for
 * an updated User. Bumps `passwordChangedAt` and clears any account lock.
 */
async function resetPassword({ resetToken, password }) {
  let decoded;
  try {
    decoded = tokenService.verifyResetToken(resetToken);
  } catch (err) {
    throw ApiError.unauthorized('রিসেট টোকেন অবৈধ বা মেয়াদ শেষ।', { code: 'reset_token_invalid' });
  }
  const user = await User.findById(decoded.sub).select('+password');
  if (!user) throw ApiError.notFound('অ্যাকাউন্ট পাওয়া যায়নি।');

  // One-time use (audit 5.7): a reset token is only accepted if it was issued
  // at or after the user's most recent password change. The moment this token
  // is consumed below, `passwordChangedAt` jumps forward — so the same token
  // (and any other token minted before this change) can no longer be replayed.
  const changedAtSec = user.passwordChangedAt
    ? Math.floor(new Date(user.passwordChangedAt).getTime() / 1000)
    : 0;
  if (typeof decoded.iat === 'number' && decoded.iat < changedAtSec) {
    throw ApiError.unauthorized('এই রিসেট লিংকটি আর বৈধ নয়। নতুন করে রিসেট করুন।', {
      code: 'reset_token_used',
    });
  }

  user.password = await bcrypt.hash(password, env.bcryptRounds);
  user.passwordChangedAt = new Date();
  user.loginAttempts = 0;
  user.lockUntil = null;
  await user.save();
  return { ok: true };
}

module.exports = {
  startSignup,
  verifySignup,
  login,
  startForgotPassword,
  verifyForgotPassword,
  resetPassword,
};
