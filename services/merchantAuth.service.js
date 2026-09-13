'use strict';

/**
 * merchantAuth.service.js — sign-in for the provider app.
 * ─────────────────────────────────────────────────────────────────────────────
 * A shopkeeper's account, entirely separate from a tenant's. He never needs a
 * To-Let Pro rental account and one would not help him here: the two systems
 * share a database and a phone-number format, and nothing else.
 *
 * Reuses the OTP DELIVERY plumbing (sms.net.bd, OTP_DEV_MODE) because proving
 * control of a phone is the same problem on both sides, but nothing that
 * stores state: codes go to MerchantOtp, and the SignupIntent path is
 * deliberately not reused either. A merchant signup must never be able to land
 * in the User collection by accident, so this file only ever writes Merchants.
 *
 * ─── ONE PHONE, TWO SYSTEMS ──────────────────────────────────────────────────
 * The same number CAN exist as both a User and a Merchant — a landlord who
 * also runs the shop downstairs is a real person. They are two accounts with
 * two passwords and two sessions, and that is intended: the alternative is the
 * role-on-User model we deliberately moved away from.
 *
 * That premise is also why the codes live in their OWN collection. The rental
 * `Otp` is unique per number, so sharing it let one man's two systems overwrite
 * each other's codes — see models/MerchantOtp.js for the full reasoning.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const Merchant = require('../models/Merchant');
// NOT models/Otp — that one belongs to the rental app. See MerchantOtp's header.
const MerchantOtp = require('../models/MerchantOtp');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const tokenService = require('./token.service');
const smsService = require('./sms.service');
// Per-PHONE cap, shared with the rental app on purpose — one handset, one SMS
// bill. See models/OtpQuota.js.
const otpQuota = require('./otpQuota.service');

const OTP_TTL_MIN = 5;
// 30 days, matching the rental app's refresh cookie. A shopkeeper should not be
// asked to log in again because he did not open the app for a fortnight.
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 5;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

function generateOtp() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

async function issueOtp(phone) {
  const otp = generateOtp();
  // `createdAt` is re-stamped on purpose: it drives the TTL index, so a
  // re-issued code gets a full fresh 5 minutes rather than inheriting what was
  // left of the previous one's.
  await MerchantOtp.findOneAndUpdate(
    { phone },
    { phone, otp, createdAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return otp;
}

async function deliverOtp(phone, otp) {
  if (env.otpDevMode) {
    console.warn(`[OTP_DEV_MODE] merchant SMS skipped — OTP for ${phone} is ${otp}`);
    return;
  }
  await smsService.sendOtp(phone, otp);
}

/** Only the hash is ever stored, so a database read yields no usable token. */
const hashToken = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

/**
 * Register a device session so revocation and "sign out everywhere" work, and
 * mint the refresh token that belongs to it.
 *
 * Returns { sessionId, refreshToken } — the RAW token, which is handed to the
 * client once as an httpOnly cookie and never stored anywhere in plaintext.
 */
function addSession(merchant, { device = 'Unknown device', ipAddress = '0.0.0.0' } = {}) {
  const sessionId = crypto.randomUUID();
  const refreshToken = crypto.randomBytes(48).toString('base64url');

  if (!Array.isArray(merchant.sessions)) merchant.sessions = [];
  merchant.sessions.push({
    sessionId,
    device,
    ip: ipAddress,
    refreshHash: hashToken(refreshToken),
    refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS),
  });
  // Keep the newest N. A shopkeeper reinstalling the app repeatedly must not
  // accumulate an unbounded session list on his document.
  if (merchant.sessions.length > MAX_SESSIONS) {
    merchant.sessions = merchant.sessions.slice(-MAX_SESSIONS);
  }
  return { sessionId, refreshToken };
}

/**
 * Exchange a refresh token for a new access token, ROTATING the refresh token
 * in the same step.
 *
 * Rotation matters here: the provider app runs on shared and second-hand
 * phones, so a token that stayed valid after use would keep working for
 * whoever read it out of a backup.
 */
async function refresh(rawToken, { device, ipAddress } = {}) {
  if (!rawToken) {
    throw ApiError.unauthorized('Refresh token নেই।', { code: 'missing_refresh_token' });
  }

  const hash = hashToken(rawToken);
  // BOTH parts of the select are required. `sessions` is select:false on the
  // schema AND `refreshHash` is select:false inside the subdocument, so
  // `.select('+sessions')` alone loads the array with every `refreshHash`
  // undefined — the find() below then matches nothing and this endpoint
  // answers 401 for every token it ever issued. The query above still finds
  // the right document, which is what made the bug look like a bad token
  // rather than a bad projection.
  const merchant = await Merchant.findOne({ 'sessions.refreshHash': hash })
    .select('+sessions +sessions.refreshHash');
  if (!merchant) {
    throw ApiError.unauthorized('Refresh token অবৈধ।', { code: 'invalid_refresh_token' });
  }

  const session = merchant.sessions.find((s) => s.refreshHash === hash);
  if (!session || !session.refreshExpiresAt || session.refreshExpiresAt < new Date()) {
    throw ApiError.unauthorized('Refresh token-এর মেয়াদ শেষ।', { code: 'invalid_refresh_token' });
  }
  if (merchant.isBanned) {
    throw ApiError.forbidden(merchant.banReason || 'আপনার অ্যাকাউন্ট স্থগিত।', {
      code: 'account_banned',
    });
  }

  const next = crypto.randomBytes(48).toString('base64url');
  session.refreshHash = hashToken(next);
  session.refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  session.lastSeenAt = new Date();
  if (device) session.device = device;
  if (ipAddress) session.ip = ipAddress;
  await merchant.save();

  return {
    token: tokenService.signMerchantToken(merchant, session.sessionId),
    refreshToken: next,
    merchant: merchant.toJSON(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Signup — step 1: send the code
// ─────────────────────────────────────────────────────────────────────────────
async function startSignup({ name, phone, password }) {
  if (!name || String(name).trim().length < 2) {
    throw ApiError.badRequest('আপনার নাম দিন।', { code: 'name_required' });
  }
  if (!/^\+\d{8,15}$/.test(String(phone || ''))) {
    throw ApiError.badRequest('সঠিক মোবাইল নম্বর দিন।', { code: 'bad_phone' });
  }
  if (!password || String(password).length < 8) {
    throw ApiError.badRequest('পাসওয়ার্ড অন্তত ৮ অক্ষরের দিন।', { code: 'weak_password' });
  }

  // After format validation, before anything that touches an account: this is
  // what caps how many messages one number can be made to receive, whoever is
  // asking and from however many addresses.
  await otpQuota.consume(phone);

  const existing = await Merchant.findOne({ phone });
  if (existing && existing.phoneVerified) {
    throw ApiError.badRequest('এই নম্বরে ইতিমধ্যে অ্যাকাউন্ট আছে। লগইন করুন।', {
      code: 'already_registered',
    });
  }

  const passwordHash = await bcrypt.hash(password, env.bcryptRounds);

  // Written straight to Merchant as UNVERIFIED rather than to a separate
  // intent collection. An unverified merchant cannot log in (see login()) and
  // cannot own a Provider, so the row is inert until the code is confirmed —
  // and re-running signup simply overwrites it, which is what a shopkeeper who
  // mistyped his number will do.
  await Merchant.findOneAndUpdate(
    { phone },
    {
      phone,
      name: String(name).trim(),
      password: passwordHash,
      phoneVerified: false,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const otp = await issueOtp(phone);
  await deliverOtp(phone, otp);

  return { sent: true, expiresInMinutes: OTP_TTL_MIN };
}

// ─────────────────────────────────────────────────────────────────────────────
// Signup — step 2: confirm the code and open the session
// ─────────────────────────────────────────────────────────────────────────────
async function verifySignup({ phone, otp }, { device, ipAddress } = {}) {
  const record = await MerchantOtp.findOne({ phone });
  if (!record || record.otp !== String(otp || '').trim()) {
    throw ApiError.unauthorized('কোডটি সঠিক নয়।', { code: 'bad_otp' });
  }

  // `+sessions.refreshHash` for the same reason as in refresh(): addSession
  // can rewrite the whole array, and an array rewritten from a projection that
  // omitted the hashes would silently reset every other device's token to ''.
  const merchant = await Merchant.findOne({ phone }).select('+sessions +sessions.refreshHash');
  if (!merchant) {
    throw ApiError.badRequest('আগে রেজিস্ট্রেশন শুরু করুন।', { code: 'no_signup_started' });
  }

  merchant.phoneVerified = true;
  const { sessionId, refreshToken } = addSession(merchant, { device, ipAddress });
  merchant.lastLoginAt = new Date();
  await merchant.save();

  // Single use — a code that still works after it has been used is a code that
  // can be replayed off a shared phone.
  await MerchantOtp.deleteOne({ phone });

  return {
    token: tokenService.signMerchantToken(merchant, sessionId),
    refreshToken,
    merchant: merchant.toJSON(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Login
// ─────────────────────────────────────────────────────────────────────────────
async function login({ phone, password, device, ipAddress }) {
  const merchant = await Merchant.findOne({ phone })
    .select('+password +loginAttempts +lockUntil +sessions +sessions.refreshHash');

  // Constant-ish timing: hash against a dummy so "no such account" and "wrong
  // password" cannot be told apart by how long the answer takes.
  if (!merchant || !merchant.phoneVerified) {
    await bcrypt.compare(String(password || ''), '$2a$12$abcdefghijklmnopqrstuv');
    throw ApiError.unauthorized(
      merchant ? 'নম্বরটি যাচাই করা হয়নি।' : 'এই নম্বরে কোনো অ্যাকাউন্ট নেই।',
      { code: merchant ? 'not_verified' : 'merchant_not_found' },
    );
  }

  if (merchant.isLocked()) {
    throw ApiError.unauthorized('অনেকবার ভুল হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।', {
      code: 'account_locked',
    });
  }

  const ok = await bcrypt.compare(String(password || ''), merchant.password);
  if (!ok) {
    merchant.loginAttempts = (merchant.loginAttempts || 0) + 1;
    if (merchant.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
      merchant.lockUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
      merchant.loginAttempts = 0;
    }
    await merchant.save();
    throw ApiError.unauthorized('পাসওয়ার্ড সঠিক নয়।', { code: 'bad_credentials' });
  }

  if (merchant.isBanned) {
    throw ApiError.forbidden(merchant.banReason || 'আপনার অ্যাকাউন্ট স্থগিত।', {
      code: 'account_banned',
    });
  }

  merchant.loginAttempts = 0;
  merchant.lockUntil = null;
  const { sessionId, refreshToken } = addSession(merchant, { device, ipAddress });
  merchant.lastLoginAt = new Date();
  await merchant.save();

  return {
    token: tokenService.signMerchantToken(merchant, sessionId),
    refreshToken,
    merchant: merchant.toJSON(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Forgot password — step 1: send the code
// ─────────────────────────────────────────────────────────────────────────────
/**
 * ALWAYS resolves the same way, whether or not the number has an account.
 *
 * This is the one place in this file that deliberately does NOT answer
 * honestly. login() will happily tell you a number is unregistered, because
 * someone mistyping his own number needs to hear that — but this endpoint
 * takes an arbitrary number from an anonymous caller, and answering it would
 * turn the reset form into a tool for asking "is this shopkeeper on To-Let
 * Pro?" about any number in the country. SMS delivery failures are swallowed
 * for the same reason: an error here would leak existence by timing alone.
 *
 * The trade is real — a shopkeeper who mistypes his number waits for an SMS
 * that was never going to arrive. The reset screen answers that by naming the
 * number it sent to and offering to change it.
 */
async function forgotPassword({ phone }) {
  // Format only. This rejects gibberish without consulting the database, so it
  // still tells the caller nothing about who exists.
  if (!/^\+\d{8,15}$/.test(String(phone || ''))) {
    throw ApiError.badRequest('সঠিক মোবাইল নম্বর দিন।', { code: 'bad_phone' });
  }

  // BEFORE the lookup below, and that ordering is the whole point. This
  // endpoint answers a registered and an unregistered number identically; a
  // quota consumed only on a real send would start returning 429 for exactly
  // the numbers that have accounts, which is the question this endpoint exists
  // to refuse. Counting every request keeps both cases indistinguishable.
  await otpQuota.consume(phone);

  const merchant = await Merchant.findOne({ phone });
  // An unverified row is a half-finished signup, not an account. Sending a
  // reset code for one would hand back a password that login() still refuses.
  if (merchant && merchant.phoneVerified) {
    const otp = await issueOtp(phone);
    try {
      await deliverOtp(phone, otp);
    } catch (err) {
      console.error('[merchantAuth] reset OTP delivery failed:', err.message);
    }
  }

  return { ok: true, expiresInMinutes: OTP_TTL_MIN };
}

// ─────────────────────────────────────────────────────────────────────────────
// Forgot password — step 2: confirm the code and set the new password
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Deliberately does NOT open a session. Every device is signed out instead,
 * including the one doing the reset, and the shopkeeper logs in again with the
 * password he just chose.
 *
 * That is the whole point of a reset: the likeliest reason someone needs one is
 * that the phone holding those sessions is no longer his. Handing this flow a
 * fresh session while clearing the others would also be self-contradictory —
 * it would add back the very thing the clear exists to remove.
 */
async function resetPassword({ phone, otp, password }) {
  if (!password || String(password).length < 8) {
    throw ApiError.badRequest('পাসওয়ার্ড অন্তত ৮ অক্ষরের দিন।', { code: 'weak_password' });
  }

  const record = await MerchantOtp.findOne({ phone });
  if (!record || record.otp !== String(otp || '').trim()) {
    throw ApiError.unauthorized('কোডটি সঠিক নয়।', { code: 'bad_otp' });
  }

  // `+sessions` WITHOUT `+sessions.refreshHash`, which is safe here only
  // because the array is being emptied. Everywhere else in this file that
  // rewrites `sessions` needs the hashes too, or it writes the surviving
  // sessions back with blank ones and signs every other device out by
  // accident. There are no survivors here, by design.
  const merchant = await Merchant.findOne({ phone })
    .select('+password +loginAttempts +lockUntil +sessions');

  if (!merchant || !merchant.phoneVerified) {
    // The code matched but the account is gone or was never verified — burn
    // the code rather than leaving a valid one lying around for a row that
    // might yet be created on this number.
    await MerchantOtp.deleteOne({ phone });
    throw ApiError.badRequest('এই নম্বরে কোনো অ্যাকাউন্ট নেই।', { code: 'merchant_not_found' });
  }

  merchant.password = await bcrypt.hash(String(password), env.bcryptRounds);
  // Access tokens already in the wild go stale on this timestamp
  // (requireMerchantAuth → isTokenStaleAfterPasswordChange); clearing sessions
  // kills the refresh tokens that would otherwise mint new ones. Both are
  // needed — either alone leaves a way back in.
  merchant.passwordChangedAt = new Date();
  merchant.sessions = [];
  // A locked-out account is exactly the one whose owner is here resetting.
  // Leaving the lock on would make a successful reset look like a failure.
  merchant.loginAttempts = 0;
  merchant.lockUntil = null;
  await merchant.save();

  await MerchantOtp.deleteOne({ phone });
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Logout — drop this device's session only
// ─────────────────────────────────────────────────────────────────────────────
async function logout(merchant, sessionId) {
  if (!sessionId) return;
  // An atomic `$pull`, NOT filter-then-save. `req.merchant` comes from
  // requireMerchantAuth, which loads `sessions` without the select:false
  // `refreshHash` inside it — so reassigning the whole array and saving it
  // would write every REMAINING session back with an empty hash and silently
  // sign the shopkeeper out of all his other devices.
  await Merchant.updateOne({ _id: merchant._id }, { $pull: { sessions: { sessionId } } });
}

module.exports = {
  startSignup,
  verifySignup,
  login,
  forgotPassword,
  resetPassword,
  refresh,
  logout,
  MAX_SESSIONS,
  OTP_TTL_MIN,
  REFRESH_TTL_MS,
};
