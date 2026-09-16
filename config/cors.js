'use strict';

const env = require('./env');

/**
 * Who is allowed to call this API from a browser-ish client — ONE rule, used by
 * both the HTTP layer (server.js) and Socket.IO (socket.js).
 *
 * It lived in server.js only, and socket.io was configured separately with
 * `env.corsOrigins` — the WEBSITE's origin list. The installed app is not a
 * website: a Capacitor WebView reports a fixed scheme-origin of its own, so the
 * app was refused on every socket.io handshake ("No 'Access-Control-Allow-Origin'
 * header ... origin 'https://localhost'") while its ordinary REST calls, which
 * went through the list below, kept working. Chat, calls and live Living sync
 * therefore never connected in the app, with nothing failing loudly enough to
 * notice. Both layers now share this module so they cannot drift apart again.
 */

// Fixed origins reported by the installed app's WebView. Not domains we own or
// can rotate: Android serves the bundle from https://localhost, older/iOS
// Capacitor shells use the capacitor:// and ionic:// schemes.
const NATIVE_APP_ORIGINS = new Set([
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
  'https://localhost',
]);

// Allowed browser origins = public site (CORS_ORIGINS) + admin console
// (ADMIN_CORS_ORIGINS) + provider app (PROVIDER_CORS_ORIGINS). All three are
// credentialed. Keeping them in separate env vars means each surface is
// allow-listed explicitly and can be rotated/locked down without touching the
// others' config. Built once: env is read at require-time.
const ALLOWED_WEB_ORIGINS = new Set([
  ...env.corsOrigins,
  ...env.adminCorsOrigins,
  ...env.providerCorsOrigins,
]);

/**
 * @param {string|undefined} origin  the browser's Origin header
 * @returns {boolean}
 */
function isAllowedOrigin(origin) {
  if (!origin) return true; // server-to-server / curl / native fetch
  if (NATIVE_APP_ORIGINS.has(origin)) return true;
  // Exact match only. The old `.vercel.app` wildcard was removed — it let ANY
  // site on *.vercel.app (including an attacker's) make credentialed requests.
  return ALLOWED_WEB_ORIGINS.has(origin);
}

// Shape accepted by both `cors()` middleware and Socket.IO's `cors` option
// (Socket.IO uses the same `cors` package underneath).
const corsOptions = {
  origin: (origin, cb) => (
    isAllowedOrigin(origin)
      ? cb(null, true)
      : cb(new Error(`CORS: origin "${origin}" not allowed`))
  ),
  credentials: true,
};

module.exports = { NATIVE_APP_ORIGINS, ALLOWED_WEB_ORIGINS, isAllowedOrigin, corsOptions };
