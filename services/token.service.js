'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const env = require('../config/env');

/** Access token issued after successful login or signup verify. */
function signAccessToken(user, sessionId = null) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role, phone: user.phone, sessionId },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn, audience: 'tolet-pro', issuer: 'tolet-pro-backend' }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.jwtSecret, { audience: 'tolet-pro', issuer: 'tolet-pro-backend' });
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

module.exports = {
  signAccessToken,
  verifyAccessToken,
  signResetToken,
  verifyResetToken,
};
