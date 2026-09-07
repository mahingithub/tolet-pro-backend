'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const env = require('../config/env');

// Audience separates the two token domains cryptographically. A token minted
// for the public app ('tolet-pro') can NEVER satisfy an admin route's verify
// (which demands 'tolet-pro-admin'), and vice-versa — so a stolen/replayed
// user token is useless against the admin API even if that user is an admin.
const USER_AUDIENCE  = 'tolet-pro';
const ADMIN_AUDIENCE = 'tolet-pro-admin';
const ISSUER         = 'tolet-pro-backend';

/** Access token issued after successful login or signup verify. */
function signAccessToken(user, sessionId = null) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role, phone: user.phone, sessionId },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn, audience: USER_AUDIENCE, issuer: ISSUER }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.jwtSecret, { audience: USER_AUDIENCE, issuer: ISSUER });
}

/**
 * Admin access token — a DIFFERENT audience ('tolet-pro-admin') plus an
 * explicit `scope: 'admin'` claim. Only minted by the dedicated admin-login
 * flow (services/auth.service.adminLogin), which refuses non-admin accounts.
 * Verified exclusively by middleware/requireAdminAuth. Kept short-lived
 * (env.jwtAdminExpiresIn, default 12h) since admin power is high-value.
 * `roles` is embedded so the gate can double-check RBAC on every request.
 */
function signAdminToken(user, sessionId = null) {
  const roles = Array.isArray(user.roles) && user.roles.length
    ? user.roles
    : (user.role ? [user.role] : []);
  return jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role,
      roles,
      phone: user.phone,
      sessionId,
      scope: 'admin',
    },
    env.jwtSecret,
    { expiresIn: env.jwtAdminExpiresIn, audience: ADMIN_AUDIENCE, issuer: ISSUER }
  );
}

function verifyAdminToken(token) {
  const decoded = jwt.verify(token, env.jwtSecret, {
    audience: ADMIN_AUDIENCE,
    issuer: ISSUER,
  });
  // Defense in depth: even a correctly-audienced token must carry the admin
  // scope. Anything else is treated as a forged/misused token.
  if (decoded.scope !== 'admin') {
    const err = new Error('Not an admin token');
    err.name = 'JsonWebTokenError';
    throw err;
  }
  return decoded;
}

/**
 * True when `passwordChangedAt` post-dates the token, i.e. the password moved
 * after this token was minted and the token must be refused.
 *
 * Both sides are compared in WHOLE SECONDS because that is the only precision a
 * JWT has: `iat` is `Math.floor(Date.now() / 1000)`. `passwordChangedAt` is a
 * millisecond Date, so a naive `iat * 1000 < passwordChangedAt` reads the
 * discarded milliseconds as "the password changed after this token" — and calls
 * a token issued in the very same instant stale.
 *
 * That is not a theoretical race. Signup verification sets passwordChangedAt
 * and signs the access token in one breath, so unless the stamp landed exactly
 * on a whole second (~1 time in 1000) the brand-new account's very first
 * request came back 401 `password_changed` and the app had no option but to
 * send the user to the login screen — right after it had just verified their
 * OTP. scripts/smoke-properties.js works around the same truncation by
 * backdating its fixtures 5 seconds; this fixes it at the source instead.
 *
 * Comparing in seconds keeps the guarantee that matters: a password changed in
 * second N invalidates every token issued in second N-1 or earlier. Only
 * sub-second ordering is given up, and a JWT could never express that anyway.
 */
function isTokenStaleAfterPasswordChange(decoded, passwordChangedAt) {
  if (!passwordChangedAt) return false;
  if (typeof decoded?.iat !== 'number') return false;
  return Math.floor(passwordChangedAt.getTime() / 1000) > decoded.iat;
}

/**
 * Short-lived reset token issued AFTER forgot-password OTP is verified.
 * Encodes the userId + a one-shot nonce — we don't persist these server-side;
 * we trust the JWT signature + tight expiry instead.
 */
function signResetToken(user) {
  const jti = crypto.randomBytes(16).toString('hex');
  return jwt.sign(
    { sub: user._id.toString(), purpose: 'password_reset', jti },
    env.jwtSecret,
    { expiresIn: env.resetTokenExpiresIn, audience: 'tolet-pro', issuer: 'tolet-pro-backend' }
  );
}

function verifyResetToken(token) {
  const decoded = jwt.verify(token, env.jwtSecret, {
    audience: 'tolet-pro',
    issuer: 'tolet-pro-backend',
  });
  if (decoded.purpose !== 'password_reset') {
    const err = new Error('Wrong token purpose');
    err.name = 'JsonWebTokenError';
    throw err;
  }
  return decoded;
}

/**
 * Temporary 2FA token issued after password verification but before OTP check.
 * Short-lived (5 minutes) and only grants access to the 2FA verification endpoint.
 * Contains user ID but NO admin scope — cannot be used for actual API access.
 */
function sign2FATempToken(user) {
  const jti = crypto.randomBytes(16).toString('hex');
  return jwt.sign(
    { sub: user._id.toString(), purpose: '2fa_pending', jti },
    env.jwtSecret,
    { expiresIn: '5m', audience: ADMIN_AUDIENCE, issuer: ISSUER }
  );
}

function verify2FATempToken(token) {
  const decoded = jwt.verify(token, env.jwtSecret, {
    audience: ADMIN_AUDIENCE,
    issuer: ISSUER,
  });
  if (decoded.purpose !== '2fa_pending') {
    const err = new Error('Wrong token purpose');
    err.name = 'JsonWebTokenError';
    throw err;
  }
  return decoded;
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  signAdminToken,
  verifyAdminToken,
  signResetToken,
  verifyResetToken,
  sign2FATempToken,
  verify2FATempToken,
  isTokenStaleAfterPasswordChange,
  USER_AUDIENCE,
  ADMIN_AUDIENCE,
};
