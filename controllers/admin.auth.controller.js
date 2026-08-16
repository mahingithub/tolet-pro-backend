'use strict';

/**
 * admin.auth.controller — endpoints backing the standalone admin console's
 * dedicated login flow (mounted at /api/admin/auth). These are intentionally
 * separate from the public auth controller so the admin surface can evolve its
 * own policy (shorter sessions, stricter RBAC, audit hooks) without touching
 * the consumer app's auth.
 */

const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const authService = require('../services/auth.service');
const tokenService = require('../services/token.service');
const refreshTokenService = require('../services/refreshToken.service');
const refreshCookie = require('../utils/refreshCookie');
const auditLog = require('../services/auditLog.service');
const loginHistory = require('../services/loginHistory.service');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Shape the admin object sent to the client — never leak password/session
// internals or brute-force counters.
function toAdminDTO(user) {
  const roles = Array.isArray(user.roles) && user.roles.length
    ? user.roles
    : (user.role ? [user.role] : []);
  return {
    id: user._id.toString(),
    name: user.name,
    phone: user.phone,
    email: user.email || '',
    avatar: user.avatar || '',
    role: user.role,
    roles,
    isGoogleAuthEnabled: user.isGoogleAuthEnabled || false,
  };
}

// POST /api/admin/auth/login  { phone, password }
exports.login = asyncH(async (req, res) => {
  const result = await authService.adminLogin({
    phone: req.body.phone,
    password: req.body.password,
    device: req.headers['user-agent'] || 'Unknown device',
    ipAddress: req.ip || '0.0.0.0',
  });

  // 2FA is enabled — return the temporary token, not a full session.
  if (result.requires2FA) {
    return res.json({
      requires2FA: true,
      tempToken: result.tempToken,
      message: result.message,
    });
  }

  // No 2FA or 2FA verification succeeded - issue refresh token
  const sessionId = result.user.sessions && result.user.sessions.length > 0 
    ? result.user.sessions[result.user.sessions.length - 1].sessionId 
    : null;
  
  if (sessionId) {
    const refreshToken = await refreshTokenService.issueRefreshToken({
      userId: result.user._id,
      sessionId,
      ipAddress: req.ip || '0.0.0.0',
      userAgent: req.headers['user-agent'],
    });

    // httpOnly cookie, NOT the JSON body. The body copy was dead weight — the
    // console never stored it, and there was no admin refresh route to spend it
    // on — so the session simply ended when the 12h access token expired.
    res.cookie(refreshCookie.ADMIN_COOKIE, refreshToken, refreshCookie.setOptions(req));
    
    // Record login in history
    await loginHistory.safeLog(
      loginHistory.recordSuccessfulLogin,
      req, result.user, sessionId, { loginType: 'password_admin' }
    );
  }

  res.json({ 
    token: result.token, // Short-lived admin access token (12h)
    admin: toAdminDTO(result.user) 
  });
});

// GET /api/admin/auth/me  (requireAdminAuth) — validate token + hydrate admin.
exports.me = asyncH(async (req, res) => {
  res.json({ admin: toAdminDTO(req.user) });
});

// POST /api/admin/auth/refresh — rotate the admin refresh cookie and mint a
// fresh admin-scoped access token.
//
// Deliberately NOT behind requireAdminAuth: the entire point is to be callable
// once the access token has already expired. Authority comes from the httpOnly
// cookie, and rotateRefreshToken({ scope: 'admin' }) re-checks the account's
// admin role before signing anything.
//
// This endpoint did not exist. Admin login minted a refresh token, returned it
// in a JSON body nothing read, and the console had no way to renew a session —
// so every admin was thrown back to the login screen once the 12h token
// expired, and the client's 401 handler (which posted to a URL that did not
// resolve, then cleared the session) turned any single 401 into a logout.
exports.refresh = asyncH(async (req, res, next) => {
  const cookieName = refreshCookie.ADMIN_COOKIE;
  const refreshToken = req.cookies?.[cookieName];

  if (!refreshToken) {
    return res.status(401).json({
      code: 'missing_refresh_token',
      message: 'Refresh token not found. Please log in again.',
    });
  }

  try {
    const result = await refreshTokenService.rotateRefreshToken(refreshToken, {
      ipAddress: req.ip || '0.0.0.0',
      userAgent: req.headers['user-agent'],
      scope: 'admin',
    });

    res.cookie(cookieName, result.refreshToken, refreshCookie.setOptions(req));

    res.json({
      token: result.accessToken,
      admin: toAdminDTO(result.user),
    });
  } catch (err) {
    // Only abandon the session when it is genuinely over. A transient failure
    // must leave the cookie intact so the next attempt can still succeed.
    if (refreshTokenService.isTerminalRefreshError(err)) {
      res.clearCookie(cookieName, refreshCookie.clearOptions(req));
    }
    next(err);
  }
});

// POST /api/admin/auth/logout (requireAdminAuth) — revoke THIS session so the
// token can't be replayed after logout (session check in requireAdminAuth).
exports.logout = asyncH(async (req, res) => {
  if (req.sessionId && Array.isArray(req.user.sessions)) {
    req.user.sessions = req.user.sessions.filter((s) => s.sessionId !== req.sessionId);
    await req.user.save();
    
    // Also revoke any refresh tokens for this session
    await refreshTokenService.revokeSessionTokens(req.sessionId);
    
    // Record logout in history
    await loginHistory.safeLog(loginHistory.recordLogout, req.sessionId);
  }

  // An explicit logout IS the one place the refresh cookie must go.
  res.clearCookie(refreshCookie.ADMIN_COOKIE, refreshCookie.clearOptions(req));

  res.json({ ok: true });
});

// PATCH /api/admin/auth/me (requireAdminAuth) — update the admin's own profile.
// Only name + email are editable here (phone/role are managed elsewhere).
exports.updateMe = asyncH(async (req, res) => {
  const { name, email } = req.body || {};
  const user = req.user;

  if (typeof name === 'string') {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      throw ApiError.badRequest('নাম কমপক্ষে ২ অক্ষরের হতে হবে।', { code: 'invalid_name' });
    }
    user.name = trimmed.slice(0, 80);
  }

  if (typeof email === 'string') {
    const e = email.trim().toLowerCase();
    if (e && !/^.+@.+\..+$/.test(e)) {
      throw ApiError.badRequest('ইমেইল সঠিক নয়।', { code: 'invalid_email' });
    }
    user.email = e.slice(0, 254);
  }

  await user.save();
  res.json({ admin: toAdminDTO(user) });
});

// POST /api/admin/auth/change-password (requireAdminAuth)
// { currentPassword, newPassword }. Verifies the current password, sets the
// new one, bumps passwordChangedAt, and revokes ALL sessions — so every
// existing token (including this one) dies and the admin must log in again.
exports.changePassword = asyncH(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    throw ApiError.badRequest('বর্তমান ও নতুন পাসওয়ার্ড দুটোই প্রয়োজন।', { code: 'missing_fields' });
  }
  if (String(newPassword).length < 8) {
    throw ApiError.badRequest('নতুন পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।', { code: 'weak_password' });
  }

  // req.user was loaded without the password (select:false) — reload with it.
  const user = await User.findById(req.user._id).select('+password');
  if (!user) throw ApiError.unauthorized('অ্যাকাউন্ট পাওয়া যায়নি।', { code: 'user_missing' });

  const ok = await bcrypt.compare(currentPassword, user.password);
  if (!ok) {
    throw ApiError.badRequest('বর্তমান পাসওয়ার্ড ভুল।', { code: 'wrong_password' });
  }

  user.password = await bcrypt.hash(newPassword, env.bcryptRounds);
  user.passwordChangedAt = new Date();
  const sessionIds = (user.sessions || []).map(s => s.sessionId);
  user.sessions = []; // sign out everywhere for safety
  await user.save();
  
  // Also revoke all refresh tokens for this user
  await refreshTokenService.revokeAllUserTokens(user._id);

  // Record logout in history for all active sessions
  await Promise.all(
    sessionIds.map(sid => loginHistory.safeLog(loginHistory.recordLogout, sid))
  );

  // Audit log
  await auditLog.safeLog(auditLog.logAdminAction, req, {
    action: 'admin.password.reset',
    targetId: user._id.toString(),
    targetName: user.name,
    description: `Admin ${user.name} changed their password`,
    metadata: { allSessionsRevoked: true },
  });

  // Every refresh token was just revoked, so the cookie is dead weight.
  res.clearCookie(refreshCookie.ADMIN_COOKIE, refreshCookie.clearOptions(req));

  res.json({ ok: true, code: 'password_changed' });
});

// ─── 2FA Login Verification ─────────────────────────────────────────────────

// POST /api/admin/auth/verify-2fa-login { tempToken, token }
// Verifies the TOTP token for a pending admin login. The tempToken was issued
// by adminLogin() after password verification. If the OTP is valid, this
// endpoint finalizes the login by creating a session and issuing the real
// admin access token.
exports.verify2FALogin = asyncH(async (req, res) => {
  const { tempToken, token } = req.body || {};
  
  if (!tempToken || !token) {
    throw ApiError.badRequest('Temp token এবং OTP উভয়ই প্রয়োজন।', { code: 'missing_fields' });
  }

  // Verify and decode the temporary token
  let decoded;
  try {
    decoded = tokenService.verify2FATempToken(tempToken);
  } catch (err) {
    throw ApiError.unauthorized('সেশন মেয়াদ শেষ হয়েছে। আবার লগইন করুন।', { 
      code: 'temp_token_expired' 
    });
  }

  // Load the user with their 2FA secret
  const user = await User.findById(decoded.sub).select('+googleAuthSecret +loginAttempts +lockUntil');
  if (!user || !user.phoneVerified) {
    throw ApiError.notFound('ব্যবহারকারী পাওয়া যায়নি।', { code: 'user_not_found' });
  }

  if (user.isLocked) {
    throw ApiError.tooMany('অ্যাকাউন্ট সাময়িকভাবে লক করা হয়েছে। কিছুক্ষণ পর চেষ্টা করুন।', {
      code: 'account_locked',
    });
  }

  if (!user.isGoogleAuthEnabled || !user.googleAuthSecret) {
    throw ApiError.badRequest('2FA সক্রিয় নেই।', { code: '2fa_not_enabled' });
  }

  // Verify the TOTP token
  const verified = speakeasy.totp.verify({
    secret: user.googleAuthSecret,
    encoding: 'base32',
    token: String(token),
    window: 2, // Allow 2 time-steps of tolerance (±1 minute)
  });

  if (!verified) {
    // Failed 2FA attempt — increment login attempts
    user.loginAttempts = (user.loginAttempts || 0) + 1;
    if (user.loginAttempts >= env.loginMaxAttempts) {
      user.lockUntil = new Date(Date.now() + env.loginLockMinutes * 60_000);
      user.loginAttempts = 0;
    }
    await user.save();
    throw ApiError.badRequest('OTP কোড সঠিক নয়। আবার চেষ্টা করুন।', { code: 'invalid_otp' });
  }

  // Success! Reset attempts and finalize login
  user.loginAttempts = 0;
  user.lockUntil = null;
  user.lastLoginAt = new Date();

  // Create session via the shared helper exported from auth.service
  const device = req.headers['user-agent'] || 'Unknown device';
  const ipAddress = req.ip || '0.0.0.0';
  const sessionId = authService.addSession(user, { device, ipAddress });
  
  await user.save();

  // Issue the real admin access token
  const accessToken = tokenService.signAdminToken(user, sessionId);
  
  // Issue refresh token for the session
  const refreshToken = await refreshTokenService.issueRefreshToken({
    userId: user._id,
    sessionId,
    ipAddress,
    userAgent: device,
  });

  // httpOnly cookie so POST /api/admin/auth/refresh can rotate it. Same
  // treatment as the non-2FA login path above.
  res.cookie(refreshCookie.ADMIN_COOKIE, refreshToken, refreshCookie.setOptions(req));

  // Record login in history
  await loginHistory.safeLog(
    loginHistory.recordSuccessfulLogin,
    req, user, sessionId, { loginType: '2fa_admin' }
  );

  res.json({ 
    token: accessToken, 
    admin: toAdminDTO(user),
    message: 'লগইন সফল হয়েছে।'
  });
});

// ─── 2FA / Google Authenticator Setup ───────────────────────────────────────

// POST /api/admin/auth/2fa/generate (requireAdminAuth)
// Generates a new TOTP secret and returns a QR code data URL for the admin
// to scan with their Google Authenticator app. The secret is NOT saved yet —
// the admin must verify it by submitting a valid token via the /enable endpoint.
exports.generate2FASecret = asyncH(async (req, res) => {
  const secret = speakeasy.generateSecret({
    name: `ToletPro Admin (${req.user.phone})`,
    issuer: 'ToletPro',
    length: 32,
  });

  // Generate QR code as data URL
  const qrCodeDataUrl = await QRCode.toDataURL(secret.otpauth_url);

  res.json({
    secret: secret.base32, // Send base32-encoded secret to frontend for backup
    qrCode: qrCodeDataUrl,
  });
});

// POST /api/admin/auth/2fa/enable (requireAdminAuth)
// { secret, token }
// Verifies the TOTP token against the provided secret. If valid, saves the
// secret to the database and enables 2FA for this admin account.
exports.enable2FA = asyncH(async (req, res) => {
  const { secret, token } = req.body || {};
  
  if (!secret || !token) {
    throw ApiError.badRequest('Secret এবং token উভয়ই প্রয়োজন।', { code: 'missing_fields' });
  }

  // Verify the token against the secret
  const verified = speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: String(token),
    window: 2, // Allow 2 time-steps of tolerance (±1 minute)
  });

  if (!verified) {
    throw ApiError.badRequest('OTP কোড সঠিক নয়। আবার চেষ্টা করুন।', { code: 'invalid_token' });
  }

  // Reload user with the secret field
  const user = await User.findById(req.user._id).select('+googleAuthSecret');
  if (!user) {
    throw ApiError.notFound('ব্যবহারকারী পাওয়া যায়নি।', { code: 'user_not_found' });
  }

  user.googleAuthSecret = secret;
  user.isGoogleAuthEnabled = true;
  await user.save();

  res.json({ 
    ok: true, 
    message: 'Google Authenticator সফলভাবে সক্রিয় হয়েছে।',
    isGoogleAuthEnabled: true,
  });
});

// POST /api/admin/auth/2fa/disable (requireAdminAuth)
// { password }
// Disables 2FA for the admin account after verifying their password for security.
exports.disable2FA = asyncH(async (req, res) => {
  const { password } = req.body || {};
  
  if (!password) {
    throw ApiError.badRequest('পাসওয়ার্ড প্রয়োজন।', { code: 'missing_password' });
  }

  // Reload user with password to verify
  const user = await User.findById(req.user._id).select('+password +googleAuthSecret');
  if (!user) {
    throw ApiError.notFound('ব্যবহারকারী পাওয়া যায়নি।', { code: 'user_not_found' });
  }

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) {
    throw ApiError.badRequest('পাসওয়ার্ড ভুল।', { code: 'wrong_password' });
  }

  user.googleAuthSecret = null;
  user.isGoogleAuthEnabled = false;
  await user.save();

  res.json({ 
    ok: true, 
    message: 'Google Authenticator নিষ্ক্রিয় করা হয়েছে।',
    isGoogleAuthEnabled: false,
  });
});
