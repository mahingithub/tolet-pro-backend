'use strict';

/**
 * facebookToken.service.js
 * ──────────────────────────────────────────────────────────────────────────
 * Keeps the Facebook Graph API long-lived access token fresh.
 *
 * The problem
 *   Facebook long-lived tokens expire after ~60 days. Once expired, the Page
 *   auto-post feature (services/facebook.service.js) silently stops working.
 *
 * The fix — an in-process background job
 *   On a schedule (default: daily) it checks how close the stored token is to
 *   expiry and, once inside a safety window (default: 10 days before expiry),
 *   re-exchanges it for a brand-new long-lived token via the Graph API:
 *
 *     GET /{version}/oauth/access_token
 *         ?grant_type=fb_exchange_token
 *         &client_id={app-id}
 *         &client_secret={app-secret}
 *         &fb_exchange_token={current-long-lived-token}
 *
 *   Each successful exchange resets the ~60-day clock, so the real API call
 *   lands roughly every 50 days — comfortably UNDER the 60-day limit while
 *   staying resilient to the odd missed tick on a sleeping free-tier instance.
 *
 *   When tokenType='page' and a Page ID is configured, the fresh USER token is
 *   then used to derive the PAGE token that facebook.service actually posts
 *   with:
 *
 *     GET /{version}/{page-id}?fields=access_token&access_token={user-token}
 *
 * Persistence
 *   The token lives in MongoDB (models/FacebookToken.js), NOT just process
 *   memory, so the refreshed value survives restarts/redeploys. The env var
 *   FACEBOOK_PAGE_ACCESS_TOKEN only SEEDS the row the first time.
 *
 * Safety
 *   Every public function is fire-and-forget safe — it NEVER throws. Failures
 *   are logged and recorded on the row (lastError/lastRefreshStatus) so a bad
 *   token or a Facebook outage can't crash the server or a cron tick.
 */

const cron = require('node-cron');
const axios = require('axios');
const env = require('../config/env');
const FacebookToken = require('../models/FacebookToken');

const cfg = env.facebook || {};
const TZ = process.env.CRON_TZ || 'Asia/Dhaka';
const KEY = 'facebook';

const DAY_MS = 24 * 60 * 60 * 1000;
// Assumed lifetime of a long-lived token when Facebook doesn't return an
// explicit expires_in (some non-expiring tokens report 0). Used to schedule
// the NEXT refresh conservatively so we still cycle under 60 days.
const ASSUMED_LIFETIME_DAYS = 60;

// ─── In-memory cache ─────────────────────────────────────────────────────────
// facebook.service.js reads the live token from here on every post, so a
// refresh takes effect immediately without a restart.
let cache = {
  loaded: false,
  pageAccessToken: '',
  userAccessToken: '',
  pageId: '',
};

function primeCacheFrom(doc) {
  cache = {
    loaded: true,
    pageAccessToken: doc.pageAccessToken || '',
    userAccessToken: doc.userAccessToken || '',
    pageId: doc.pageId || cfg.pageId || '',
  };
}

// ─── Config helpers ──────────────────────────────────────────────────────────

/** True when we have the app credentials needed to CALL the refresh endpoint. */
function canRefresh() {
  return Boolean(cfg.appId && cfg.appSecret);
}

/** The token facebook.service should post with (page → user → seed fallback). */
function getCachedPageToken() {
  return cache.pageAccessToken || cache.userAccessToken || cfg.seedToken || '';
}

function getCachedPageId() {
  return cache.pageId || cfg.pageId || '';
}

// ─── DB row bootstrap ────────────────────────────────────────────────────────

/**
 * Load the singleton token row, creating + seeding it from the env var on the
 * very first run. Always primes the in-memory cache. Returns the doc (or null
 * if the DB isn't reachable — callers treat null as "not configured").
 */
async function loadTokenDoc() {
  try {
    let doc = await FacebookToken.findOne({ key: KEY });

    if (!doc) {
      // First boot: seed from the env var so posting keeps working immediately
      // and we have something to re-exchange on the next refresh.
      const seed = cfg.seedToken || '';
      doc = await FacebookToken.create({
        key: KEY,
        tokenType: cfg.tokenType === 'user' ? 'user' : 'page',
        // Treat the seed as a user token (re-exchangeable). If it's actually a
        // Page token it can still be exchanged in most setups; if not, the
        // first refresh logs a clear error and we keep using the seed.
        userAccessToken: seed,
        pageAccessToken: cfg.tokenType === 'page' ? seed : '',
        pageId: cfg.pageId || '',
        expiresAt: null,
        lastRefreshStatus: seed ? 'seeded' : 'skipped',
      });
      if (seed) {
        console.log('[fb-token] seeded token row from FACEBOOK_PAGE_ACCESS_TOKEN env var');
      }
    }

    primeCacheFrom(doc);
    return doc;
  } catch (err) {
    console.warn('[fb-token] could not load token row:', err.message);
    return null;
  }
}

/** Ensure the cache is populated at least once. */
async function ensureLoaded() {
  if (!cache.loaded) await loadTokenDoc();
}

/** Async accessor used by facebook.service.js before posting. */
async function getPageAccessToken() {
  await ensureLoaded();
  return getCachedPageToken();
}

// ─── Refresh scheduling logic ────────────────────────────────────────────────

/**
 * When is the next refresh due?
 *   • known expiry  → refresh `refreshBeforeDays` before it.
 *   • unknown expiry→ refresh `ASSUMED_LIFETIME_DAYS - refreshBeforeDays` after
 *                     the last refresh (or creation), so we still cycle < 60d.
 */
function refreshDueAt(doc) {
  const buffer = Math.max(0, Number(cfg.refreshBeforeDays) || 10) * DAY_MS;
  if (doc.expiresAt) {
    return new Date(new Date(doc.expiresAt).getTime() - buffer);
  }
  const anchor = doc.lastRefreshedAt || doc.updatedAt || doc.createdAt || new Date(0);
  const intervalMs = Math.max(1, ASSUMED_LIFETIME_DAYS - (Number(cfg.refreshBeforeDays) || 10)) * DAY_MS;
  return new Date(new Date(anchor).getTime() + intervalMs);
}

function isRefreshDue(doc) {
  return Date.now() >= refreshDueAt(doc).getTime();
}

// ─── Graph API calls ─────────────────────────────────────────────────────────

/**
 * Exchange the current long-lived token for a fresh one. Returns the new token
 * and its lifetime in seconds (0/undefined when Facebook omits it).
 */
async function exchangeLongLivedToken(currentToken) {
  const url = `https://graph.facebook.com/${cfg.apiVersion}/oauth/access_token`;
  const resp = await axios.get(url, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: cfg.appId,
      client_secret: cfg.appSecret,
      fb_exchange_token: currentToken,
    },
    timeout: 15_000,
  });
  return {
    token: resp.data?.access_token || '',
    expiresIn: Number(resp.data?.expires_in) || 0, // seconds
  };
}

/**
 * Derive the Page access token from a (fresh) user token. A Page token minted
 * from a long-lived user token does not itself expire, but we re-derive it on
 * every refresh so a rotated user token always yields a matching Page token.
 */
async function derivePageToken(userToken, pageId) {
  const url = `https://graph.facebook.com/${cfg.apiVersion}/${pageId}`;
  const resp = await axios.get(url, {
    params: { fields: 'access_token', access_token: userToken },
    timeout: 15_000,
  });
  return resp.data?.access_token || '';
}

function extractGraphError(err) {
  const fb = err.response?.data?.error;
  if (fb) return `${fb.message || 'graph error'} (code ${fb.code}${fb.error_subcode ? '/' + fb.error_subcode : ''})`;
  return err.message;
}

// ─── The refresh operation ───────────────────────────────────────────────────

/**
 * Regenerate the token and persist it. NEVER throws.
 *
 * @param {object}  [opts]
 * @param {boolean} [opts.force=false]  refresh even if it isn't due yet.
 * @returns {Promise<{success:boolean, skipped?:boolean, reason?:string, expiresAt?:Date, error?:string}>}
 */
async function refreshAccessToken({ force = false } = {}) {
  const doc = await loadTokenDoc();
  if (!doc) return { success: false, skipped: true, reason: 'db_unavailable' };

  if (!canRefresh()) {
    console.warn('[fb-token] auto-refresh disabled — set FACEBOOK_APP_ID + FACEBOOK_APP_SECRET to enable');
    return { success: false, skipped: true, reason: 'not_configured' };
  }

  const inputToken = doc.userAccessToken || doc.pageAccessToken || cfg.seedToken || '';
  if (!inputToken) {
    console.warn('[fb-token] no token to refresh — seed one via FACEBOOK_PAGE_ACCESS_TOKEN first');
    return { success: false, skipped: true, reason: 'no_seed_token' };
  }

  if (!force && !isRefreshDue(doc)) {
    const due = refreshDueAt(doc);
    console.log(`[fb-token] not due yet — next refresh ~${due.toISOString().slice(0, 10)}`);
    return { success: false, skipped: true, reason: 'not_due' };
  }

  try {
    // 1) Fresh long-lived (user) token — resets the ~60-day clock.
    const { token: newUserToken, expiresIn } = await exchangeLongLivedToken(inputToken);
    if (!newUserToken) throw new Error('Facebook returned an empty access_token');

    const expiresAt = expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000)
      : new Date(Date.now() + ASSUMED_LIFETIME_DAYS * DAY_MS);

    // 2) Derive the Page token used for posting (best-effort; keep the old one
    //    if derivation fails so posting isn't broken by a transient hiccup).
    let pageToken = doc.pageAccessToken || '';
    const pageId = cfg.pageId || doc.pageId || '';
    if (doc.tokenType === 'page' && pageId) {
      try {
        const derived = await derivePageToken(newUserToken, pageId);
        if (derived) pageToken = derived;
      } catch (derr) {
        console.warn('[fb-token] page-token derivation failed (keeping previous page token):', extractGraphError(derr));
      }
    }

    // 3) Persist + refresh the in-memory cache.
    doc.userAccessToken = newUserToken;
    doc.pageAccessToken = pageToken;
    doc.pageId = pageId;
    doc.expiresAt = expiresAt;
    doc.lastRefreshedAt = new Date();
    doc.lastRefreshStatus = 'ok';
    doc.lastError = '';
    doc.refreshCount = (doc.refreshCount || 0) + 1;
    await doc.save();
    primeCacheFrom(doc);

    console.log(`[fb-token] refreshed ok — expires ${expiresAt.toISOString().slice(0, 10)} (refresh #${doc.refreshCount})`);
    return { success: true, expiresAt };
  } catch (err) {
    const detail = extractGraphError(err);
    console.error('[fb-token] refresh failed:', detail);
    // Record the failure but don't wipe the working token.
    try {
      doc.lastRefreshStatus = 'error';
      doc.lastError = detail;
      await doc.save();
    } catch (_) { /* best-effort */ }
    return { success: false, error: detail };
  }
}

/** Refresh only if the token is near expiry / overdue. Fire-and-forget safe. */
async function maybeRefresh() {
  return refreshAccessToken({ force: false });
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

/**
 * Start the in-process refresh job. Called once from server.js at boot.
 *
 * - Always primes the cache so posting uses the stored/seed token.
 * - If app credentials are present, runs one catch-up check shortly after boot
 *   (covers a server that was down past a refresh window) and then a light
 *   daily check on `cfg.refreshCron`.
 *
 * NOTE (free tier): a sleeping instance won't run cron while idle. The wide
 * refresh window (weeks) absorbs the odd missed tick, but for a listing site
 * that's regularly hit this stays reliable. Upgrade to an always-on instance
 * if you want hard guarantees.
 */
function startFacebookTokenRefreshJob() {
  // Prime cache regardless of whether auto-refresh is configured.
  loadTokenDoc().catch((e) => console.warn('[fb-token] initial load failed:', e.message));

  if (!canRefresh()) {
    console.log('[fb-token] auto-refresh not configured (no FACEBOOK_APP_ID/SECRET) — posting will use the stored/seed token as-is');
    return;
  }

  const schedule = cfg.refreshCron || '30 3 * * *';
  if (!cron.validate(schedule)) {
    console.warn(`[fb-token] invalid FACEBOOK_TOKEN_REFRESH_CRON "${schedule}" — falling back to daily 03:30`);
  }
  const effective = cron.validate(schedule) ? schedule : '30 3 * * *';

  // Catch-up check ~25s after boot (staggered after the other boot jobs).
  setTimeout(() => {
    maybeRefresh().catch((e) => console.warn('[fb-token] boot refresh failed:', e.message));
  }, 25 * 1000);

  cron.schedule(effective, () => {
    maybeRefresh().catch((e) => console.warn('[fb-token] scheduled refresh failed:', e.message));
  }, { timezone: TZ });

  console.log(`[fb-token] auto-refresh started — check "${effective}" (TZ: ${TZ}), refresh ${cfg.refreshBeforeDays} day(s) before expiry`);
}

module.exports = {
  startFacebookTokenRefreshJob,
  refreshAccessToken,
  maybeRefresh,
  getPageAccessToken,
  getCachedPageToken,
  getCachedPageId,
  loadTokenDoc,
  isRefreshDue,
};
