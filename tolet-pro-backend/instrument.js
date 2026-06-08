'use strict';

/**
 * instrument.js — Sentry initialisation. [Phase Call-7 / monitoring]
 * ───────────────────────────────────────────────────────────────────────────
 * MUST be required at the VERY TOP of server.js, before any other imports, so
 * Sentry can instrument everything (Express, http, etc.).
 *
 * The DSN comes from the SENTRY_DSN env var (set it on Render). If it's not
 * set, Sentry simply stays disabled — the app runs normally without error
 * reporting. This keeps local/dev runs clean and avoids a hard dependency.
 *
 * ► RENDER ENV: add SENTRY_DSN = (your backend DSN from sentry.io)
 *   e.g. https://xxxx@o123.ingest.us.sentry.io/456
 */

const Sentry = require('@sentry/node');

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Tag events with the environment so prod/dev errors are separable.
    environment: process.env.NODE_ENV || 'development',
    // Send basic PII (e.g. client IP) — helpful for debugging, no sensitive
    // app data. Flip to false if you'd rather not.
    sendDefaultPii: true,
    // Performance tracing sample rate. 0.1 = 10% of requests traced — plenty
    // for a beta, and keeps you well within the free tier. Raise toward 1.0
    // if you want more detail (costs more events).
    tracesSampleRate: 0.1,
  });
  console.log('[sentry] initialised');
} else {
  console.log('[sentry] SENTRY_DSN not set — error reporting disabled');
}

module.exports = Sentry;
