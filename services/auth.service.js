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
const refreshTokenService = require('./refreshToken.service');
const otpAbuseService = require('./otpAbuse.service');
const loginHistoryService = require('./loginHistory.service');
const subscriptionService = require('./subscription.service');

const GENERIC_LOGIN_ERROR = 'ফোন নম্বর বা পাসওয়ার্ড ভুল হয়েছে।';
// Combined, non-specific OTP failure message — mirrors GENERIC_LOGIN_ERROR so
// we never reveal WHICH part failed (matches the product's "phone number or
// OTP is wrong" wording). Used by both signup-verify and password-reset.
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
 * 
 * OTP ABUSE PROTECTION:
 * - Checks IP + phone + device fingerprint before sending
 * - Progressive enforcement: warning → delay → CAPTCHA → block
 * - Returns enforcement status to client for UX adaptation
 */
async function startSignup({ name, phone, password, role }, req) {
  // ═══ ABUSE PROTECTION CHECK ═══════════════════════════════════════════════
  const abuseCheck = await otpAbuseService.checkOtpRequest({
    phoneNumber: phone,
    ipAddress: req.ip || '0.0.0.0',
    req,
    captchaToken: req.body.captchaToken,
  });
  
  // Apply delay if required (rate limiting)
  if (abuseCheck.delayMs > 0) {
    await new Promise(resolve => setTimeout(resolve, abuseCheck.delayMs));
  }
  
  // ═══ EXISTING ACCOUNT CHECK ═══════════════════════════════════════════════
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

  return {
    ok: true,
    expiresAt,
    // Return abuse protection status to client for UX adaptation
    enforcementLevel: abuseCheck.enforcementLevel,
    requiresCaptcha: abuseCheck.requiresCaptcha,
    message: abuseCheck.message,
  };
}

/**
 * Step 2 of signup: verify the OTP the user received via SMS, look up the
 * matching SignupIntent, create/finalize the User, mark phoneVerified, open a
 * session, and issue an access token. On success the SignupIntent and the Otp
 * document are both deleted.
 * 
 * OTP ABUSE PROTECTION:
 * - Records failed verification attempts
 * - Triggers CAPTCHA requirement after repeated failures
 */
async function verifySignup({ phoneNumber, otp }, req) {
  const phone = phoneNumber;

  // 1. Verify the OTP. A missing record means it never existed or the 5-minute
  //    TTL already reaped it → treat both as "invalid/expired".
  const record = await Otp.findOne({ phoneNumber: phone });
  if (!record || record.otp !== String(otp)) {
    // Record failed verification for abuse tracking
    await otpAbuseService.recordFailedVerification({
      phoneNumber: phone,
      ipAddress: req.ip || '0.0.0.0',
    });
    
    throw ApiError.badRequest(GENERIC_OTP_ERROR, {
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

  // A brand-new landlord starts their 2-month Pro trial here, so the clock
  // begins at signup rather than whenever they first open the billing page.
  // Best-effort: a trial hiccup must never fail account creation.
  if (intent.role === 'landlord') {
    subscriptionService.grantLandlordTrialQuietly(user._id);
  }

  const token = tokenService.signAccessToken(user, sessionId);
  return { token, user };
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
    throw ApiError.unauthorized(!user ? 'এই নম্বরে কোনো অ্যাকাউন্ট পাওয়া যায়নি।' : 'অ্যাকাউন্টটি ভেরিফাইড নয়।', { code: !user ? 'user_not_found' : 'user_not_verified' });
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
    throw ApiError.unauthorized(!user ? 'এই নম্বরে কোনো অ্যাকাউন্ট পাওয়া যায়নি।' : 'অ্যাকাউন্টটি ভেরিফাইড নয়।', { code: !user ? 'admin_not_found' : 'admin_not_verified' });
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
 * Forgot password — step 1. If a verified account exists for this phone, we
 * issue a fresh OTP and deliver it via sms.net.bd. We ALWAYS resolve
 * successfully (and swallow SMS errors) so the endpoint can return a constant
 * response and never leak whether the account exists.
 * 
 * OTP ABUSE PROTECTION:
 * - Checks IP + phone + device fingerprint before sending
 * - Progressive enforcement: warning → delay → CAPTCHA → block
 */
async function forgotPassword({ phoneNumber }, req) {
  const phone = phoneNumber;
  
  // ═══ ABUSE PROTECTION CHECK ═══════════════════════════════════════════════
  // Check abuse even before verifying account exists (prevents enumeration)
  try {
    const abuseCheck = await otpAbuseService.checkOtpRequest({
      phoneNumber: phone,
      ipAddress: req.ip || '0.0.0.0',
      req,
      captchaToken: req.body.captchaToken,
    });
    
    // Apply delay if required (rate limiting)
    if (abuseCheck.delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, abuseCheck.delayMs));
    }
  } catch (err) {
    // If abuse check fails, still return success to prevent enumeration
    // But don't actually send OTP
    return { ok: true, blocked: true };
  }
  
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
 * 
 * OTP ABUSE PROTECTION:
 * - Records failed verification attempts
 */
async function resetPassword({ phoneNumber, otp, newPassword }, req) {
  const phone = phoneNumber;

  const record = await Otp.findOne({ phoneNumber: phone });
  if (!record || record.otp !== String(otp)) {
    // Record failed verification for abuse tracking
    await otpAbuseService.recordFailedVerification({
      phoneNumber: phone,
      ipAddress: req.ip || '0.0.0.0',
    });
    
    throw ApiError.badRequest(GENERIC_OTP_ERROR, {
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
  
  // Revoke ALL active sessions for this user (both old JWT sessions array and new refresh tokens)
  user.sessions = [];
  await refreshTokenService.revokeAllUserTokens(user._id);
  
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
  adminLogin,
  forgotPassword,
  resetPassword,
  addSession,
};
