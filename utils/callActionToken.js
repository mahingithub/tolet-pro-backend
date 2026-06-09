'use strict';

const crypto = require('crypto');
const env = require('../config/env');

const VERSION = 'v1';
const DEFAULT_TTL_SECONDS = 90;

function sign(payload) {
  return crypto
    .createHmac('sha256', env.jwtSecret)
    .update(payload)
    .digest('base64url');
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function createCallActionToken({ callId, receiverId, ttlSeconds = DEFAULT_TTL_SECONDS }) {
  if (!callId || !receiverId) throw new Error('callId and receiverId are required');

  const exp = Math.floor(Date.now() / 1000) + Number(ttlSeconds || DEFAULT_TTL_SECONDS);
  const body = [
    VERSION,
    encodeURIComponent(String(callId)),
    encodeURIComponent(String(receiverId)),
    String(exp),
  ].join('.');

  return `${body}.${sign(body)}`;
}

function verifyCallActionToken(token) {
  const value = String(token || '');
  const parts = value.split('.');
  if (parts.length !== 5 || parts[0] !== VERSION) {
    const err = new Error('Invalid call action token');
    err.code = 'invalid_token';
    throw err;
  }

  const body = parts.slice(0, 4).join('.');
  const expected = sign(body);
  if (!timingSafeEqual(parts[4], expected)) {
    const err = new Error('Invalid call action token');
    err.code = 'invalid_token';
    throw err;
  }

  const exp = Number(parts[3]);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    const err = new Error('Expired call action token');
    err.code = 'expired_token';
    throw err;
  }

  return {
    callId: decodeURIComponent(parts[1]),
    receiverId: decodeURIComponent(parts[2]),
    exp,
  };
}

module.exports = {
  createCallActionToken,
  verifyCallActionToken,
};
