'use strict';

/**
 * merchantAuth.service.js — sign-in for the provider app.
 * ─────────────────────────────────────────────────────────────────────────────
 * A shopkeeper's account, entirely separate from a tenant's. He never needs a
 * To-Let Pro rental account and one would not help him here: the two systems
 * share a database and a phone-number format, and nothing else.
 *
 * Reuses the OTP plumbing (Otp collection, sms.net.bd, OTP_DEV_MODE) because
 * proving control of a phone is the same problem on both sides — but the
 * SignupIntent path is deliberately NOT reused. A merchant signup must never
 * be able to land in the User collection by accident, so this file only ever
 * writes Merchants.
 *
 * ─── ONE PHONE, TWO SYSTEMS ──────────────────────────────────────────────────
 * The same number CAN exist as both a User and a Merchant — a landlord who
 * also runs the shop downstairs is a real person. They are two accounts with
 * two passwords and two sessions, and that is intended: the alternative is the
 * role-on-User model we deliberately moved away from.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const Merchant = require('../models/Merchant');
const Otp = require('../models/Otp');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const tokenService = require('./token.service');
const smsService = require('./sms.service');

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
  await Otp.findOneAndUpdate(
    { phoneNumber: phone },
    { phoneNumber: phone, otp, createdAt: new Date() },
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
  const merchant = await Merchant.findOne({ 'sessions.refreshHash': hash }).select('+sessions');
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
  const record = await Otp.findOne({ phoneNumber: phone });
  if (!record || record.otp !== String(otp || '').trim()) {
    throw ApiError.unauthorized('কোডটি সঠিক নয়।', { code: 'bad_otp' });
  }

  const merchant = await Merchant.findOne({ phone });
  if (!merchant) {
    throw ApiError.badRequest('আগে রেজিস্ট্রেশন শুরু করুন।', { code: 'no_signup_started' });
  }

  merchant.phoneVerified = true;
  const { sessionId, refreshToken } = addSession(merchant, { device, ipAddress });
  merchant.lastLoginAt = new Date();
  await merchant.save();

  // Single use — a code that still works after it has been used is a code that
  // can be replayed off a shared phone.
  await Otp.deleteOne({ phoneNumber: phone });

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
    .select('+password +loginAttempts +lockUntil +sessions');

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
// Logout — drop this device's session only
// ─────────────────────────────────────────────────────────────────────────────
async function logout(merchant, sessionId) {
  if (!sessionId) return;
  merchant.sessions = merchant.sessions.filter((s) => s.sessionId !== sessionId);
  await merchant.save();
}

module.exports = {
  startSignup,
  verifySignup,
  login,
  refresh,
  logout,
  MAX_SESSIONS,
  OTP_TTL_MIN,
  REFRESH_TTL_MS,
};
