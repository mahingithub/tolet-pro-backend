'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const SignupIntent = require('../models/SignupIntent');
const Otp = require('../models/Otp');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');
const smsService = require('./sms.service');
const tokenService = require('./token.service');

const GENERIC_LOGIN_ERROR = 'ফোন নম্বর বা পাসওয়ার্ড ভুল হয়েছে।';

// Hard cap on how many sessions we keep per user. This is THE root-cause fix
// for the historical "sessions array grows forever → OOM" bug: every place
// that adds a session goes through addSession(), which trims first. Because
// the cap lives here at the source, the boot-time prune script in server.js
// is no longer needed to hold back the flood.
const MAX_SESSIONS = 10;

/**
 * Append a new session to `user`, keeping only the most recent MAX_SESSIONS.
 * Trims BEFORE pushing so the array can never exceed the cap. Mutates `user`
 * in memory and returns the new sessionId — the caller is responsible for
 * `user.save()`.
 */
function addSession(user, { device = 'Unknown device', ipAddress = '0.0.0.0' } = {}) {
  if (!Array.isArray(user.sessions)) user.sessions = [];
  // Leave room for the one we're about to add: keep the newest (MAX-1).
  if (user.sessions.length >= MAX_SESSIONS) {
    user.sessions.splice(0, user.sessions.length - (MAX_SESSIONS - 1));
  }
  const sessionId = crypto.randomUUID();
  user.sessions.push({ sessionId, device, ipAddress });
  return sessionId;
}

/**
 * Generates a 6-digit, zero-padded numeric OTP (e.g. "004271").
 */
function generateOtp() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/**
 * Upserts the single active OTP for a phone number and (re)starts its
 * 5-minute TTL window by refreshing `createdAt`. Returns the plaintext code.
 */
async function issueOtp(phone) {
  const otp = generateOtp();
  await Otp.findOneAndUpdate(
    { phoneNumber: phone },
    { phoneNumber: phone, otp, createdAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return otp;
}

/**
 * Delivers an OTP to the user. Normally this texts the code via sms.net.bd.
 * When OTP_DEV_MODE=true it SKIPS the gateway and writes the code to the
 * server log instead — so the full signup/reset flow can be tested without SMS
 * credits or a verified gateway account. The code is never returned to the
 * client, only logged.
 */
async function deliverOtp(phone, otp) {
  if (env.otpDevMode) {
    console.warn(`[OTP_DEV_MODE] SMS skipped — OTP for ${phone} is ${otp}`);
    return;
  }
  await smsService.sendOtp(phone, otp);
}

/**
 * Step 1 of signup: persist (name, hashedPassword, role) as a SignupIntent
 * keyed by phone so we can finalize after the OTP is verified. We deliberately
 * do NOT create a real User yet — the user must prove control of the phone
 * first.
 *
 * Then generate a 6-digit OTP, store it in the Otp collection, and deliver it
 * via sms.net.bd. If SMS delivery fails we surface the error so the client can
 * retry (the SignupIntent + Otp are already saved and will simply be
 * overwritten / TTL-expire).
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

  // Generate + persist a fresh OTP, then deliver it (SMS, or console in dev).
  const otp = await issueOtp(phone);
  await deliverOtp(phone, otp);

  return { ok: true, expiresAt };
}

/**
 * Step 2 of signup: verify the OTP the user received via SMS, look up the
 * matching SignupIntent, create/finalize the User, mark phoneVerified, open a
 * session, and issue an access token. On success the SignupIntent and the Otp
 * document are both deleted.
 */
async function verifySignup({ phoneNumber, otp }) {
  const phone = phoneNumber;

  // 1. Verify the OTP. A missing record means it never existed or the 5-minute
  //    TTL already reaped it → treat both as "invalid/expired".
  const record = await Otp.findOne({ phoneNumber: phone });
  if (!record || record.otp !== String(otp)) {
    throw ApiError.badRequest('OTP ভুল অথবা মেয়াদ শেষ হয়েছে। আবার চেষ্টা করুন।', {
      code: 'otp_invalid',
    });
  }

  // 2. Find the pending signup details.
  const intent = await SignupIntent.findOne({ phone });
  if (!intent) {
    throw ApiError.badRequest('সাইনআপ সেশন মেয়াদ শেষ হয়েছে। আবার শুরু করুন।', {
      code: 'signup_intent_missing',
    });
  }

  let user = await User.findOne({ phone });
  if (user && user.phoneVerified) {
    // Edge case: account already exists. Bail rather than overwriting. Clean up
    // the temporary records and tell the client to log in.
    await SignupIntent.deleteOne({ phone });
    await Otp.deleteOne({ phoneNumber: phone });
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
      passwordChangedAt: new Date(),
    });
  } else {
    // User row existed but was never verified — finalize it.
    user.name = intent.name;
    user.password = intent.passwordHash;
    user.role = intent.role;
    user.phoneVerified = true;
    user.passwordChangedAt = new Date();
  }

  const sessionId = addSession(user, { device: 'New Device', ipAddress: '0.0.0.0' });

  await user.save();
  await SignupIntent.deleteOne({ phone });
  await Otp.deleteOne({ phoneNumber: phone });

  const token = tokenService.signAccessToken(user, sessionId);
  return { token, user };
}

/**
 * Password login. No OTP required. Locks the account after N consecutive
 * failures. Returns a generic error message for both "wrong phone" and
 * "wrong password" to prevent phone enumeration.
 */
async function login({ phone, password, device = 'Unknown device', ipAddress = '0.0.0.0' }) {
  // OOM guard: trim any legacy-bloated sessions array in the DB BEFORE we load
  // the document. A doc that accumulated thousands of sessions under the old
  // (pre-cap) code could otherwise blow up memory the moment findOne pulls it
  // into RAM. New growth is already bounded by addSession() below — this is
  // purely to keep the *read* safe for accounts that bloated before the fix.
  await User.updateOne(
    { phone },
    { $push: { sessions: { $each: [], $slice: -(MAX_SESSIONS - 1) } } }
  );

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

  const sessionId = addSession(user, { device, ipAddress });

  await user.save();

  const token = tokenService.signAccessToken(user, sessionId);
  return { token, user };
}

/**
 * Forgot password — step 1. If a verified account exists for this phone, we
 * issue a fresh OTP and deliver it via sms.net.bd. We ALWAYS resolve
 * successfully (and swallow SMS errors) so the endpoint can return a constant
 * response and never leak whether the account exists.
 */
async function forgotPassword({ phoneNumber }) {
  const phone = phoneNumber;
  const user = await User.findOne({ phone });

  if (user && user.phoneVerified) {
    const otp = await issueOtp(phone);
    try {
      await deliverOtp(phone, otp);
    } catch (err) {
      // Never surface delivery failures here — doing so would leak account
      // existence via error/timing. Log for ops visibility instead.
      console.error('[auth] forgot-password OTP delivery failed:', err.message);
    }
  }

  return { ok: true };
}

/**
 * Forgot password — step 2. Verify the OTP against the Otp collection, then
 * set the new password. Bumps `passwordChangedAt` (which invalidates any
 * previously-issued access tokens via the requireAuth check) and clears any
 * account lock. Deletes the Otp document on success.
 */
async function resetPassword({ phoneNumber, otp, newPassword }) {
  const phone = phoneNumber;

  const record = await Otp.findOne({ phoneNumber: phone });
  if (!record || record.otp !== String(otp)) {
    throw ApiError.badRequest('OTP ভুল অথবা মেয়াদ শেষ হয়েছে। আবার চেষ্টা করুন।', {
      code: 'otp_invalid',
    });
  }

  const user = await User.findOne({ phone }).select('+password');
  if (!user || !user.phoneVerified) {
    // The OTP matched a real record but the account is gone/unverified — an
    // edge case (e.g. account deleted mid-flow). Clean up and refuse.
    await Otp.deleteOne({ phoneNumber: phone });
    throw ApiError.notFound('এই নম্বরে অ্যাকাউন্ট পাওয়া যায়নি।', { code: 'user_not_found' });
  }

  user.password = await bcrypt.hash(newPassword, env.bcryptRounds);
  user.passwordChangedAt = new Date();
  user.loginAttempts = 0;
  user.lockUntil = null;
  await user.save();

  await Otp.deleteOne({ phoneNumber: phone });
  return { ok: true };
}

module.exports = {
  startSignup,
  verifySignup,
  login,
  forgotPassword,
  resetPassword,
};
