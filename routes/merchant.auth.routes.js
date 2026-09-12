'use strict';

/**
 * merchant.auth.routes.js — mounted at /api/merchant/auth.
 *
 * The provider app's sign-in surface. Entirely separate from /api/auth (the
 * rental app) and /api/admin/auth (the console): three surfaces, three token
 * audiences, three identity collections.
 *
 *   POST /signup/start    { name, phone, password }  → sends an OTP
 *   POST /signup/verify   { phone, otp }             → creates the session
 *   POST /login           { phone, password }
 *   POST /refresh         rotates the httpOnly merchantRefreshToken cookie
 *   GET  /me
 *   POST /logout
 *
 * There is deliberately no password-reset here yet — it needs the same OTP
 * flow and is worth doing properly rather than as an afterthought.
 */

const express = require('express');

const svc = require('../services/merchantAuth.service');
const requireMerchantAuth = require('../middleware/requireMerchantAuth');
const refreshCookie = require('../utils/refreshCookie');

const router = express.Router();

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/** Best-effort device fingerprint for the session list. */
const ctx = (req) => ({
  device: String(req.headers['user-agent'] || 'Unknown device').slice(0, 200),
  ipAddress: req.ip || '0.0.0.0',
});

/**
 * Put the refresh token in an httpOnly cookie and keep it OUT of the JSON body.
 * A token the client's JavaScript can read is a token an injected script can
 * steal, and the access token in the body is already short-lived.
 */
function issue(res, req, out) {
  const { refreshToken, ...body } = out;
  if (refreshToken) {
    res.cookie(refreshCookie.MERCHANT_COOKIE, refreshToken, refreshCookie.setOptions(req));
  }
  return body;
}

router.post('/signup/start', asyncH(async (req, res) => {
  const out = await svc.startSignup(req.body || {});
  return res.status(201).json(out);
}));

router.post('/signup/verify', asyncH(async (req, res) => {
  const out = await svc.verifySignup(req.body || {}, ctx(req));
  return res.status(201).json(issue(res, req, out));
}));

router.post('/login', asyncH(async (req, res) => {
  const out = await svc.login({ ...(req.body || {}), ...ctx(req) });
  return res.json(issue(res, req, out));
}));

/**
 * POST /refresh
 *
 * Rotates on every use: the old token stops working the moment a new one is
 * issued. The provider app runs on shared and second-hand phones, where a
 * refresh token that stayed valid after use would keep working for whoever
 * read it out of a backup.
 */
router.post('/refresh', asyncH(async (req, res) => {
  const raw = req.cookies?.[refreshCookie.MERCHANT_COOKIE];
  const out = await svc.refresh(raw, ctx(req));
  return res.json(issue(res, req, out));
}));

router.get('/me', requireMerchantAuth, (req, res) => (
  res.json({ merchant: req.merchant.toJSON() })
));

router.post('/logout', requireMerchantAuth, asyncH(async (req, res) => {
  await svc.logout(req.merchant, req.sessionId);
  // Drop the cookie too, or the next /refresh would hand back a working
  // session for an account that just signed out.
  res.clearCookie(refreshCookie.MERCHANT_COOKIE, refreshCookie.clearOptions(req));
  return res.json({ ok: true });
}));

module.exports = router;
