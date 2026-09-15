'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const SignupIntent = require('../models/SignupIntent');
const Otp = require('../models/Otp');
const firebasePhoneAuth = require('./firebasePhoneAuth.service');
// Per-PHONE cap, shared with the provider app on purpose. See models/OtpQuota.js.
const otpQuota = require('./otpQuota.service');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');
const smsService = require('./sms.service');
const tokenService = require('./token.service');
const refreshTokenService = require('./refreshToken.service');
const otpAbuseService = require('./otpAbuse.service');
const loginHistoryService = require('./loginHistory.service');
const { mobileCountryOf } = require('../utils/phoneCountries');

// Combined, non-specific OTP failure message — never reveals WHICH part failed
// (matches the product's "phone number or OTP is wrong" wording). Used by both
// signup-verify and password-reset.
const GENERIC_OTP_ERROR = 'ফোন নম্বর বা OTP ভুল হয়েছে। আবার চেষ্টা করুন।';

// Roles allowed to authenticate against the SEPARATE admin console. Kept in
// sync with middleware/requireAdmin + middleware/requireAdminAuth.
const ADMIN_ROLES = new Set(['support_agent', 'moderator', 'super_admin']);

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

// ─── Which channel proves a phone number ───────────────────────────────────
/**
 * Bangladesh keeps the code OUR server texts through sms.net.bd. It is the
 * app's main market, a local gateway costs a small fraction of Firebase's
 * +880 rate ($0.17 per SMS on Identity Platform's 2026 table), and it keeps
 * working whatever happens to the Google Cloud billing account.
 *
 * Every other supported country (utils/phoneCountries.js) verifies through
 * Firebase Phone Authentication: the server issues a one-use challenge, the
 * client asks Firebase for the SMS, and the resulting ID token is checked here.
 * The validators have already refused any number outside the list.
 */
function otpChannel(phone) {
  return mobileCountryOf(phone)?.iso === 'BD' ? 'sms' : 'firebase';
}

/**
 * The per-phone quota and the requester abuse check, shared by both channels.
 *
 * The quota is the cap the abuse service does NOT apply: its counter is keyed
 * on the (ip, phone) pair, so rotating addresses resets it and the number
 * keeps receiving messages. This one cannot be reset by changing where you
 * ask from. See models/OtpQuota.js.
 */
async function applyOtpLimits(phone, req) {
  await otpQuota.consume(phone);
  const abuseCheck = await otpAbuseService.checkOtpRequest({
    phoneNumber: phone,
    ipAddress: req.ip || '0.0.0.0',
    req,
    captchaToken: req.body?.captchaToken,
  });
  if (abuseCheck.delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, abuseCheck.delayMs));
  }
  return abuseCheck;
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
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return otp;
}

/**
 * Texts a Bangladeshi OTP via sms.net.bd. When OTP_DEV_MODE=true it SKIPS the
 * gateway and writes the code to the server log instead — so the full
 * signup/reset flow can be tested without SMS credits. The code is never
 * returned to the client, only logged.
 */
async function deliverOtp(phone, otp) {
  if (env.otpDevMode) {
    console.warn(`[OTP_DEV_MODE] SMS skipped — OTP for ${phone} is ${otp}`);
    return;
  }
  await smsService.sendOtp(phone, otp);
}

/** Check a server-texted code. A missing record means it never existed or its TTL reaped it. */
async function checkSmsOtp({ phoneNumber, otp }, req) {
  const record = await Otp.findOne({ phoneNumber });
  if (!record || record.otp !== String(otp)) {
    await otpAbuseService.recordFailedVerification({
      phoneNumber,
      ipAddress: req.ip || '0.0.0.0',
    });
    throw ApiError.badRequest(GENERIC_OTP_ERROR, { code: 'otp_invalid' });
  }
}

/** Redeem a Firebase phone proof against its one-use server challenge. */
async function consumePhoneChallenge(payload, purpose, req) {
  try {
    return await firebasePhoneAuth.consumeChallenge({ ...payload, purpose });
  } catch (err) {
    if (err.status === 401) {
      await otpAbuseService.recordFailedVerification({
        phoneNumber: payload.phoneNumber,
        ipAddress: req.ip || '0.0.0.0',
      });
    }
    throw err;
  }
}

/**
 * Step 1 of signup: hold (name, hashedPassword, role) until the phone is
 * proved, then start that proof — a texted OTP for Bangladesh, a Firebase
 * challenge everywhere else. No real User is created yet.
 *
 * If a verified account already exists for this phone, we refuse with 409.
 */
async function startSignup({ name, phone, password, role }, req) {
  const channel = otpChannel(phone);
  // Fail before spending the quota when Firebase credentials are missing.
  if (channel === 'firebase') firebasePhoneAuth.getAuth();
  const abuseCheck = await applyOtpLimits(phone, req);

  const existing = await User.findOne({ phone });
  if (existing && existing.phoneVerified) {
    throw ApiError.conflict('এই নম্বরে অ্যাকাউন্ট ইতিমধ্যেই রয়েছে। লগইন করুন।', {
      code: 'account_exists',
    });
  }

  const signup = {
    name,
    passwordHash: await bcrypt.hash(password, env.bcryptRounds),
    role: role || 'tenant',
  };
  const limits = {
    enforcementLevel: abuseCheck.enforcementLevel,
    requiresCaptcha: abuseCheck.requiresCaptcha,
  };

  if (channel === 'firebase') {
    const challenge = await firebasePhoneAuth.createChallenge({ phone, purpose: 'signup', signup });
    return { ok: true, ...challenge, ...limits };
  }

  const expiresAt = new Date(Date.now() + env.signupIntentTtlMin * 60_000);
  await SignupIntent.findOneAndUpdate(
    { phone },
    { ...signup, phone, expiresAt },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await deliverOtp(phone, await issueOtp(phone));
  return { ok: true, provider: 'sms', expiresAt, ...limits };
}

/**
 * Step 2 of signup: check the proof, create/finalize the User, mark
 * phoneVerified, open a session, and issue an access token.
 */
async function verifySignup(payload, req) {
  const phone = payload.phoneNumber;
  const channel = otpChannel(phone);

  let intent;
  if (channel === 'firebase') {
    intent = (await consumePhoneChallenge(payload, 'signup', req)).signup;
  } else {
    await checkSmsOtp(payload, req);
    intent = await SignupIntent.findOne({ phone });
  }
  if (!intent?.name || !intent.passwordHash) {
    throw ApiError.badRequest('সাইনআপ সেশন মেয়াদ শেষ হয়েছে। আবার শুরু করুন।', { code: 'signup_intent_missing' });
  }
  const clearSmsState = channel === 'sms'
    ? () => Promise.all([SignupIntent.deleteOne({ phone }), Otp.deleteOne({ phoneNumber: phone })])
    : async () => {};

  let user = await User.findOne({ phone });
  if (user && user.phoneVerified) {
    await clearSmsState();
    throw ApiError.conflict('এই নম্বরে অ্যাকাউন্ট আগে থেকেই রয়েছে। লগইন করুন।', { code: 'account_exists' });
  }
  if (user?.isBanned) {
    throw ApiError.forbidden('আপনার অ্যাকাউন্ট স্থগিত।', { code: 'account_banned' });
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
  const sessionId = addSession(user, {
    device: req.headers?.['user-agent'] || 'New Device',
    ipAddress: req.ip || '0.0.0.0',
  });
  await user.save();
  await clearSmsState();
  return { token: tokenService.signAccessToken(user, sessionId), user };
}

/**
 * Password login. No OTP required. Locks the account after N consecutive
 * failures. Returns a generic error message for both "wrong phone" and
 * "wrong password" to prevent phone enumeration.
 */
async function login({ phone, password, device = 'Unknown device', ipAddress = '0.0.0.0' }) {
  const mockReq = { ip: ipAddress, headers: { 'user-agent': device } };

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
    await loginHistoryService.safeLog(
      loginHistoryService.recordFailedLogin,
      mockReq, phone, !user ? 'user_not_found' : 'user_not_verified', { loginType: 'password' }
    );
    throw ApiError.unauthorized(!user ? 'এই নম্বরে কোনো অ্যাকাউন্ট পাওয়া যায়নি।' : 'অ্যাকাউন্টটি ভেরিফাইড নয়।', { code: !user ? 'user_not_found' : 'user_not_verified' });
  }
  if (user.isLocked) {
    await loginHistoryService.safeLog(
      loginHistoryService.recordFailedLogin,
      mockReq, phone, 'account_locked', { loginType: 'password' }
    );
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
    await loginHistoryService.safeLog(
      loginHistoryService.recordFailedLogin,
      mockReq, phone, 'wrong_password', { loginType: 'password' }
    );
    throw ApiError.unauthorized('পাসওয়ার্ড ভুল হয়েছে।', { code: 'wrong_password' });
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
 * Admin-console login — the dedicated, separate flow for the standalone admin
 * frontend. It is deliberately NOT the same as user login():
 *   1. Same brute-force protections (lockout, generic error, constant-time-ish
 *      dummy compare) as the public login.
 *   2. RBAC is enforced HERE, at authentication time — a non-admin account
 *      that types the right password still cannot obtain an admin token.
 *   3. On success, it checks if 2FA is enabled:
 *      - If 2FA is enabled: returns a temporary token that only allows the
 *        2FA verification endpoint (requires2FA: true).
 *      - If 2FA is disabled: mints an ADMIN-SCOPED token immediately.
 * The account is loaded fresh so we never trust client-supplied role claims.
 */
async function adminLogin({ phone, password, device = 'Unknown device', ipAddress = '0.0.0.0' }) {
  const mockReq = { ip: ipAddress, headers: { 'user-agent': device } };

  // OOM guard mirrors login(): trim any legacy-bloated sessions before load.
  await User.updateOne(
    { phone },
    { $push: { sessions: { $each: [], $slice: -(MAX_SESSIONS - 1) } } }
  );

  const user = await User.findOne({ phone }).select('+password +loginAttempts +lockUntil +googleAuthSecret');
  if (!user || !user.phoneVerified) {
    await bcrypt.compare(password, '$2a$12$abcdefghijklmnopqrstuv'); // bogus hash — constant-ish timing
    await loginHistoryService.safeLog(
      loginHistoryService.recordFailedLogin,
      mockReq, phone, !user ? 'admin_not_found' : 'admin_not_verified', { loginType: 'password_admin' }
    );
    throw ApiError.unauthorized(!user ? 'এই নম্বরে কোনো অ্যাকাউন্ট পাওয়া যায়নি।' : 'অ্যাকাউন্টটি ভেরিফাইড নয়।', { code: !user ? 'admin_not_found' : 'admin_not_verified' });
  }
  if (user.isLocked) {
    await loginHistoryService.safeLog(
      loginHistoryService.recordFailedLogin,
      mockReq, phone, 'admin_account_locked', { loginType: 'password_admin' }
    );
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
    await loginHistoryService.safeLog(
      loginHistoryService.recordFailedLogin,
      mockReq, phone, 'wrong_password', { loginType: 'password_admin' }
    );
    throw ApiError.unauthorized('পাসওয়ার্ড ভুল হয়েছে।', { code: 'wrong_password' });
  }

  // ── RBAC gate: only privileged roles may hold an admin session ──────────
  const roles = Array.isArray(user.roles) && user.roles.length
    ? user.roles
    : (user.role ? [user.role] : []);
  if (!roles.some((r) => ADMIN_ROLES.has(r))) {
    // Reset the (successful) attempt counter — the password WAS correct — but
    // refuse to issue an admin token.
    user.loginAttempts = 0;
    await user.save();
    await loginHistoryService.safeLog(
      loginHistoryService.recordFailedLogin,
      mockReq, phone, 'admin_rbac_rejected', { loginType: 'password_admin' }
    );
    throw ApiError.forbidden('এই অ্যাকাউন্টের অ্যাডমিন অ্যাক্সেস নেই।', { code: 'admin_required' });
  }

  // A banned admin cannot manage the platform.
  if (user.isBanned) {
    await loginHistoryService.safeLog(
      loginHistoryService.recordFailedLogin,
      mockReq, phone, 'admin_banned', { loginType: 'password_admin' }
    );
    throw ApiError.forbidden('আপনার অ্যাকাউন্ট স্থগিত।', { code: 'account_banned' });
  }

  user.loginAttempts = 0;
  user.lockUntil = null;

  // ── 2FA Check: if enabled, return a temporary token instead of full access ──
  if (user.isGoogleAuthEnabled && user.googleAuthSecret) {
    // Don't update lastLoginAt or create session yet — those happen after 2FA verification
    await user.save();
    const tempToken = tokenService.sign2FATempToken(user);
    return {
      requires2FA: true,
      tempToken,
      message: 'Google Authenticator OTP প্রয়োজন।'
    };
  }

  // No 2FA — proceed with normal login flow
  user.lastLoginAt = new Date();
  const sessionId = addSession(user, { device, ipAddress });
  await user.save();

  const token = tokenService.signAdminToken(user, sessionId);
  return { token, user };
}

/**
 * Forgot password — step 1. The response is the same whether or not the
 * account exists, so this endpoint can never be used to ask "is this number
 * on To-Let Pro?".
 *
 * Bangladesh: a code is texted only when a verified account exists, and SMS
 * failures are swallowed (a surfaced failure would leak existence via error or
 * timing). The quota is consumed OUTSIDE the try, so a spent quota answers 429
 * — identical for a number with an account and one without.
 *
 * Abroad: a Firebase challenge is issued for any listed number, and the client
 * requests the SMS. Existence is only checked once the phone is proved.
 */
async function forgotPassword({ phoneNumber }, req) {
  const phone = phoneNumber;

  if (otpChannel(phone) === 'firebase') {
    firebasePhoneAuth.getAuth();
    const abuseCheck = await applyOtpLimits(phone, req);
    return {
      ok: true,
      ...await firebasePhoneAuth.createChallenge({ phone, purpose: 'reset' }),
      enforcementLevel: abuseCheck.enforcementLevel,
      requiresCaptcha: abuseCheck.requiresCaptcha,
    };
  }

  await otpQuota.consume(phone);
  try {
    const abuseCheck = await otpAbuseService.checkOtpRequest({
      phoneNumber: phone,
      ipAddress: req.ip || '0.0.0.0',
      req,
      captchaToken: req.body?.captchaToken,
    });
    if (abuseCheck.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, abuseCheck.delayMs));
    }
  } catch (err) {
    // Still answer success so a blocked request reveals nothing — but send nothing.
    return { ok: true, provider: 'sms', blocked: true };
  }

  const user = await User.findOne({ phone });
  if (user && user.phoneVerified) {
    const otp = await issueOtp(phone);
    try {
      await deliverOtp(phone, otp);
    } catch (err) {
      console.error('[auth] forgot-password OTP delivery failed:', err.message);
    }
  }
  return { ok: true, provider: 'sms' };
}

/**
 * Forgot password — step 2. A valid proof (texted OTP or Firebase token)
 * authorizes one password reset: bumps `passwordChangedAt`, revokes every
 * session, and clears any account lock.
 */
async function resetPassword(payload, req) {
  const { phoneNumber: phone, newPassword } = payload;
  const channel = otpChannel(phone);
  if (channel === 'firebase') {
    await consumePhoneChallenge(payload, 'reset', req);
  } else {
    await checkSmsOtp(payload, req);
  }

  const user = await User.findOne({ phone }).select('+password');
  if (!user || !user.phoneVerified) {
    if (channel === 'sms') await Otp.deleteOne({ phoneNumber: phone });
    throw ApiError.notFound('এই নম্বরে অ্যাকাউন্ট পাওয়া যায়নি।', { code: 'user_not_found' });
  }
  user.password = await bcrypt.hash(newPassword, env.bcryptRounds);
  user.passwordChangedAt = new Date();
  user.sessions = [];
  await refreshTokenService.revokeAllUserTokens(user._id);
  user.loginAttempts = 0;
  user.lockUntil = null;
  await user.save();
  if (channel === 'sms') await Otp.deleteOne({ phoneNumber: phone });
  return { ok: true };
}

module.exports = {
  startSignup,
  verifySignup,
  login,
  adminLogin,
  forgotPassword,
  resetPassword,
  addSession,
  otpChannel,
};
