'use strict';

/**
 * refreshCookie — one place that decides how the `refreshToken` cookie is
 * written and cleared.
 *
 * Why this exists: the cookie was hard-coded to `sameSite: 'strict'`, which a
 * browser refuses to attach to a cross-site request. Any deployment where the
 * app and the API aren't the same site — the Capacitor WebView
 * (`capacitor://localhost` → api host), a Vercel/Netlify frontend against a
 * separately hosted API — therefore never sent the cookie, so POST
 * /auth/refresh always answered 401 `missing_refresh_token` and the session
 * died the moment the 15-minute access token expired.
 *
 * Cross-site cookies require `SameSite=None` AND `Secure`, so setting
 * COOKIE_SAMESITE=none forces `secure: true` regardless of NODE_ENV.
 */

const env = require('../config/env');

const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function baseOptions() {
  const sameSite = env.cookieSameSite;
  return {
    httpOnly: true,
    // 'none' is meaningless (and rejected by browsers) without Secure.
    secure: sameSite === 'none' ? true : env.nodeEnv === 'production',
    sameSite,
    ...(env.cookieDomain ? { domain: env.cookieDomain } : {}),
    path: '/',
  };
}

/** Options for `res.cookie('refreshToken', ...)`. */
const setOptions = () => ({ ...baseOptions(), maxAge: REFRESH_COOKIE_MAX_AGE_MS });

/**
 * Options for `res.clearCookie('refreshToken', ...)`. Must match the set
 * options (minus maxAge) or the browser keeps the original cookie.
 */
const clearOptions = () => baseOptions();

module.exports = { setOptions, clearOptions, REFRESH_COOKIE_MAX_AGE_MS };
