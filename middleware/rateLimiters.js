'use strict';

/**
 * rateLimiters.js — request rate limiting. [Phase Call-7 / hardening]
 * ───────────────────────────────────────────────────────────────────────────
 * Protects the API from brute-force (login/OTP guessing), spam (mass messages /
 * inquiries), and general abuse that could exhaust the free-tier server.
 *
 * Three tiers, mounted in server.js:
 *   • authLimiter   — STRICT. Login / OTP / register. Stops password & OTP
 *                     guessing. Keyed per IP.
 *   • writeLimiter  — MEDIUM. Messages, inquiries, bookings, support. Stops
 *                     someone hammering "send" in a loop.
 *   • apiLimiter    — LIGHT global cap on all /api traffic as a backstop.
 *
 * NOTE on `trust proxy`: server.js already sets `app.set('trust proxy', 1)`,
 * so req.ip is the REAL client IP (not Render/Vercel's proxy). That's required
 * for these limiters to key correctly per user.
 *
 * ► TO TUNE: bump `max` up if real users ever hit a limit during normal use,
 *   or down if you see abuse. `windowMs` is the rolling time window.
 *   Numbers below are deliberately generous so a normal person never notices.
 */

const rateLimit = require('express-rate-limit');

// Shared response when a limit is hit. Bengali message to match the app's 404.
function limitHandler(req, res) {
  res.status(429).json({
    message: 'অনেক বেশি অনুরোধ। একটু পরে আবার চেষ্টা করুন।',
    code: 'too_many_requests',
  });
}

// Common options shared by all limiters.
const base = {
  standardHeaders: true,   // RateLimit-* headers (lets clients self-throttle)
  legacyHeaders: false,    // no old X-RateLimit-* headers
  handler: limitHandler,
};

/**
 * STRICT — auth endpoints (login, OTP send/verify, register, forgot-password).
 * 20 attempts per 15 min per IP. Enough for a fat-fingered real user (retype
 * password / re-request OTP a few times) but kills automated guessing.
 */
const authLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  // Don't count successful logins against the limit — only failed/abusive ones
  // matter for brute-force. (A success means it's a real user, let them be.)
  skipSuccessfulRequests: true,
});

/**
 * MEDIUM — write-heavy actions that could be spammed (send message, post
 * inquiry, create booking, open support ticket).
 * 60 writes per 5 min per IP. A normal user chatting actively stays well under;
 * a spam loop trips it fast.
 */
const writeLimiter = rateLimit({
  ...base,
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 60,
});

/**
 * CHAT — polling-based chat surface (/api/conversations).
 * The frontend polls messages every ~5s and the conversation list every ~15s,
 * so a single idle user generates ~80 requests / 5 min just sitting on the
 * chat page. writeLimiter (60/5min) would wrongly block that, so chat gets its
 * own generous limiter: still protects against true flooding, but never trips
 * during normal polling + sending. Keyed per IP.
 *
 * 400 requests / 5 min ≈ comfortably above the ~80 from polling plus active
 * sending of text + the occasional image / voice upload.
 */
const chatLimiter = rateLimit({
  ...base,
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 400,
});

/**
 * LIGHT — global backstop across the whole API. Catches anything not covered
 * above and protects the free-tier server from a flood.
 * 300 requests per minute per IP — very high; a real session (loading
 * listings, images metadata, polling chat) won't approach it.
 */
const apiLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000, // 1 minute
  max: 300,
});

module.exports = { authLimiter, writeLimiter, chatLimiter, apiLimiter };
