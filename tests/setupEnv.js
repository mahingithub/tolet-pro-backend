'use strict';

/**
 * Loaded by jest.config.js BEFORE any test file or app module.
 *
 * config/env.js validates required secrets at require-time and throws if they
 * are missing, so tests need deterministic dummy values in place first. These
 * are never real credentials — they exist only to get past validation.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-'.padEnd(48, 'x');
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-'.padEnd(48, 'y');

// Keep third-party integrations dark during tests: no SMS, no WhatsApp, no
// Facebook posting, no cron. Each service no-ops when its key is absent.
process.env.SMS_API_KEY = '';
// OTP delivery is logged, never sent. config/env.js reads this at REQUIRE time,
// so a test file setting it in beforeAll is already too late — the value has to
// be in place before the first import, which is what this file is for.
process.env.OTP_DEV_MODE = 'true';
process.env.WHATSAPP_ACCESS_TOKEN = '';
process.env.WHATSAPP_PHONE_NUMBER_ID = '';
// ─── The OpenWA gateway, blanked for the same reason ─────────────────────────
// These were missed when the provider moved from Meta to a self-hosted OpenWA
// gateway, and only the Meta credentials above were being cleared. On a
// developer's own machine `.env` sets WHATSAPP_PROVIDER=openwa and
// OPENWA_API_URL defaults to http://localhost:2785 — so every reminder test was
// making a REAL HTTP call to the gateway running on that machine, waiting out a
// 15-second axios timeout or collecting a 409 "session not ready", and pacing
// itself against the send throttle's minimum gap between messages.
//
// That is why the suite was slow and intermittently blew its 60s per-test
// timeout on tests that do no network work of their own: the stall was left
// over from whichever reminder suite ran before them.
//
// Blanking the credentials makes isConfigured() false, so a send returns
// `{ success: false, skipped: true }` immediately. The OUTCOME every existing
// test asserts on is unchanged — the send still does not happen — it just stops
// costing fifteen seconds and stops depending on whether the developer happens
// to have WhatsApp running.
process.env.WHATSAPP_PROVIDER = 'meta';
process.env.OPENWA_API_URL = '';
process.env.OPENWA_API_KEY = '';
process.env.OPENWA_SESSION_ID = '';
process.env.FACEBOOK_PAGE_ACCESS_TOKEN = '';
process.env.FACEBOOK_PAGE_ID = '';
process.env.CRON_TEST = '';

// No Redis in tests. config/redis.js + middleware/advancedRateLimiter.js both
// degrade gracefully when REDIS_URL is empty (Mongo fallback for reads,
// in-memory limiters for abuse protection), so the suite exercises the same
// code paths without opening a real Redis socket that jest would flag as an
// open handle.
process.env.REDIS_URL = '';
