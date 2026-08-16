'use strict';

/**
 * refreshCookie — the one place that decides how the refresh-token cookies are
 * written and cleared.
 *
 * Why this exists: the cookie was originally hard-coded to `sameSite: 'strict'`,
 * and a browser refuses to attach a Strict cookie to a cross-site request. Any
 * deployment where the app and the API aren't the same site — the Capacitor
 * WebView (`capacitor://localhost` → api host), a Vercel/Netlify frontend
 * against a separately hosted API — therefore never sent the cookie, so
 * POST /auth/refresh always answered 401 `missing_refresh_token` and the session
 * died the moment the 15-minute access token expired.
 *
 * Moving that decision into COOKIE_SAMESITE was not enough: the value lived in
 * .env, and one missing newline there (it got appended to a commented-out line)
 * silently reverted every deployment to Strict. That is exactly how the "keeps
 * logging me out" bug came back. So the default is now DERIVED FROM THE REQUEST
 * and cannot regress through a config typo:
 *
 *   same-site request (scheme + host match) → 'lax'
 *       Works over plain HTTP, so localhost and LAN dev keep working.
 *   cross-site request                      → 'none' + Secure
 *       The only combination a browser will send cross-site.
 *
 * COOKIE_SAMESITE still wins when explicitly set, for operators who need to pin
 * the behaviour.
 */

const env = require('../config/env');

const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// The public app and the admin console get separate cookies so signing out of
// one never takes the other's session with it.
const USER_COOKIE = 'refreshToken';
const ADMIN_COOKIE = 'adminRefreshToken';

/** First value of a possibly comma-joined proxy header. */
const firstHeader = (raw) => String(raw || '').split(',')[0].trim();

/**
 * Reduce a URL or Host header to `scheme//host`. Port is deliberately dropped:
 * "same site" is about scheme + registrable host, so :5173 → :5000 is same-site.
 */
function siteOf(value, fallbackScheme = 'http') {
  if (!value) return '';
  try {
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
    const url = new URL(hasScheme ? value : `${fallbackScheme}://${value}`);
    return `${url.protocol}//${url.hostname.toLowerCase()}`;
  } catch {
    return '';
  }
}

/** The scheme the *browser* used to reach us (honours the reverse proxy). */
function requestScheme(req) {
  return firstHeader(req.headers['x-forwarded-proto']) || req.protocol || 'http';
}

/** The host the *browser* used to reach us (honours the reverse proxy). */
function requestHost(req) {
  return firstHeader(req.headers['x-forwarded-host']) || req.headers.host || '';
}

/**
 * true  → definitely cross-site
 * false → definitely same-site
 * null  → undeterminable (no Origin header: a same-origin navigation, curl, or
 *         a native HTTP client that omits it)
 */
function isCrossSite(req) {
  const origin = req?.headers?.origin;
  if (!origin) return null;
  if (origin === 'null') return true; // opaque origin: sandboxed iframe, file://

  const originSite = siteOf(origin);
  if (!originSite) return true;

  const apiSite = siteOf(requestHost(req), requestScheme(req));
  if (!apiSite) return null;

  return originSite !== apiSite;
}

function resolveSameSite(req) {
  if (env.cookieSameSiteExplicit) return env.cookieSameSite;

  const crossSite = isCrossSite(req);
  if (crossSite === true) return 'none';
  if (crossSite === false) return 'lax';

  // Undeterminable. In production assume the split-domain deploy that this
  // whole file exists for; in development prefer 'lax' so a plain-HTTP LAN
  // setup isn't broken by the Secure requirement that 'none' drags in.
  return env.nodeEnv === 'production' ? 'none' : 'lax';
}

/** Browsers treat localhost as a secure context, so Secure cookies work there. */
function isLocalhost(req) {
  const host = requestHost(req).replace(/:\d+$/, '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

function isSecureRequest(req) {
  const proto = firstHeader(req.headers['x-forwarded-proto']);
  if (proto) return proto === 'https';
  return !!req.secure;
}

let warnedInsecureNone = false;

function baseOptions(req) {
  const sameSite = resolveSameSite(req);
  // 'none' is meaningless (and rejected by browsers) without Secure.
  const secure = sameSite === 'none' ? true : env.nodeEnv === 'production';

  // A Secure cookie sent over plain HTTP to a non-localhost host is silently
  // dropped by the browser, which puts us straight back in "logged out after
  // 15 minutes" territory. There is no cookie configuration that fixes this —
  // cross-site REQUIRES Secure — so say so loudly, once.
  if (secure && req && !isSecureRequest(req) && !isLocalhost(req) && !warnedInsecureNone) {
    warnedInsecureNone = true;
    console.warn(
      '[refreshCookie] Cross-site request over plain HTTP — the browser will DROP '
      + 'the Secure refresh cookie, so sessions will end when the access token '
      + 'expires. Serve the API over HTTPS, or host the app on the same site.'
    );
  }

  return {
    httpOnly: true,
    secure,
    sameSite,
    ...(env.cookieDomain ? { domain: env.cookieDomain } : {}),
    path: '/',
  };
}

/**
 * Options for `res.cookie(name, ...)`. Pass `req` so SameSite can be derived
 * from the caller; omitting it falls back to the NODE_ENV-based guess.
 */
const setOptions = (req) => ({ ...baseOptions(req), maxAge: REFRESH_COOKIE_MAX_AGE_MS });

/**
 * Options for `res.clearCookie(name, ...)`. Mirrors the set options (minus
 * maxAge) so the browser actually drops the cookie instead of keeping the
 * original.
 */
const clearOptions = (req) => baseOptions(req);

module.exports = {
  setOptions,
  clearOptions,
  REFRESH_COOKIE_MAX_AGE_MS,
  USER_COOKIE,
  ADMIN_COOKIE,
};
