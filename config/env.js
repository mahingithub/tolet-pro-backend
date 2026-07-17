/**
 * Validates required environment variables at startup.
 * Fails fast with a clear error before the server starts listening.
 */
'use strict';

require('dotenv').config();

const required = ['MONGO_URI', 'JWT_SECRET'];
const missing = required.filter((k) => !process.env[k] || !process.env[k].trim());
if (missing.length) {
  console.error(`[env] Missing required vars: ${missing.join(', ')}`);
  process.exit(1);
}

if (process.env.JWT_SECRET.length < 32) {
  console.error('[env] JWT_SECRET must be at least 32 characters. Generate one with: openssl rand -hex 64');
  process.exit(1);
}

const weakSecrets = ['my_super_secret_key_12345', 'secret', 'changeme', 'default'];
if (weakSecrets.includes(process.env.JWT_SECRET)) {
  console.error('[env] JWT_SECRET is a known-weak value. Rotate it.');
  process.exit(1);
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 5000),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Origins for the SEPARATE admin console (its own subdomain, e.g.
  // https://admin.tolet-pro.com). Kept in its own env var so the admin
  // surface can be locked down independently of the public site. Defaults to
  // the admin dev server on :5174.
  adminCorsOrigins: (process.env.ADMIN_CORS_ORIGINS || 'http://localhost:5174')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  mongoUri: process.env.MONGO_URI,

  jwtSecret: process.env.JWT_SECRET,
  // User sessions are long-lived (1 year) so a freshly signed-up user stays
  // signed in and isn't bounced back to the login screen. Sessions can still
  // end explicitly (logout) or be revoked server-side (sessions[] entry
  // removed / password change) — see middleware/requireAuth.js. Keep this in
  // sync with the frontend website cap (SESSION_TTL_MS in authService.js).
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '365d',
  // Admin sessions are short-lived by default — admin power is high-value, so
  // a leaked token has a small blast-radius window.
  jwtAdminExpiresIn: process.env.JWT_ADMIN_EXPIRES_IN || '12h',
  resetTokenExpiresIn: process.env.RESET_TOKEN_EXPIRES_IN || '15m',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 12),

  // Firebase Admin is NO LONGER used for auth (phone OTP migrated to
  // sms.net.bd). These are retained ONLY for FCM push notifications
  // (see services/firebaseAdmin.js -> sendToUser, used by chat/notifications).
  firebaseServiceAccountBase64: process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || '',
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || '',

  // sms.net.bd SMS gateway — used to deliver signup + password-reset OTPs.
  smsApiKey: process.env.SMS_API_KEY || '',

  // ─── WhatsApp reminders ──────────────────────────────────────────────────
  // Used by services/whatsapp.service.js to deliver rent + visit reminders
  // straight to the user's WhatsApp number. Provider-agnostic: set
  // WHATSAPP_PROVIDER to 'meta' (WhatsApp Business Cloud API — default) or
  // 'twilio'. When the required keys for the chosen provider are missing the
  // service no-ops (logs a warning) so the app runs fine without WhatsApp
  // configured. Fill these in .env once you have your API credentials.
  whatsapp: {
    provider: (process.env.WHATSAPP_PROVIDER || 'meta').toLowerCase(),

    // Meta WhatsApp Business Cloud API (graph.facebook.com).
    apiVersion:    process.env.WHATSAPP_API_VERSION || 'v21.0',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    accessToken:   process.env.WHATSAPP_ACCESS_TOKEN || '',

    // Twilio WhatsApp (api.twilio.com). `twilioFrom` is the WhatsApp-enabled
    // sender, e.g. '+14155238886' (the sandbox) or your approved number.
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
    twilioAuthToken:  process.env.TWILIO_AUTH_TOKEN || '',
    twilioFrom:       process.env.TWILIO_WHATSAPP_FROM || '',

    // Default template language code (used only for template messages).
    defaultLang: process.env.WHATSAPP_DEFAULT_LANG || 'bn',

    // ── Inbound webhook (Meta) ───────────────────────────────────────────
    // verifyToken: the SAME string you type into Meta's "Verify token" field
    //   in the App Dashboard. Meta sends it back on the GET handshake so we
    //   can confirm the request is from your configured webhook. MUST match
    //   exactly (set WHATSAPP_VERIFY_TOKEN in the environment).
    // appSecret: your Meta App Secret. When set, every inbound POST is checked
    //   against the X-Hub-Signature-256 header (HMAC-SHA256 over the raw body)
    //   so nobody can spoof events. Leave empty to accept unsigned posts
    //   (works, but less secure — set it once things are running).
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '',
    appSecret:   process.env.WHATSAPP_APP_SECRET || '',
  },

  // ─── Facebook Page auto-post + token auto-refresh ────────────────────────
  // Used by services/facebook.service.js (posts new listings to a Page) and
  // services/facebookToken.service.js (the background job that regenerates the
  // long-lived token before its ~60-day expiry).
  //
  // Facebook long-lived tokens last ~60 days. The refresh job re-exchanges the
  // current token for a fresh one via the Graph API, so it must run — and hit
  // the API — at an interval WELL under 60 days. It does this by checking on a
  // schedule (refreshCron) and refreshing once the token is within
  // `refreshBeforeDays` of expiry (≈ every 50 days, with buffer to spare).
  //
  // appId + appSecret are REQUIRED for the auto-refresh (they authenticate the
  // fb_exchange_token call). Without them the job no-ops and posting simply
  // keeps using whatever token was last stored/seeded. When none of these are
  // set the whole feature stays dormant — existing behaviour is unaffected.
  facebook: {
    appId:       process.env.FACEBOOK_APP_ID || '',
    appSecret:   process.env.FACEBOOK_APP_SECRET || '',
    pageId:      process.env.FACEBOOK_PAGE_ID || '',

    // Seed token used ONLY the first time (to populate the DB row). Prefer a
    // long-lived USER token so it can be re-exchanged; a Page token also works
    // as a seed. After the first run the DB row is the source of truth.
    seedToken:   process.env.FACEBOOK_PAGE_ACCESS_TOKEN
              || process.env.FACEBOOK_LONG_LIVED_TOKEN
              || '',

    // 'page' → derive + store a Page token for auto-posting; 'user' → track a
    // user token only.
    tokenType:   (process.env.FACEBOOK_TOKEN_TYPE || 'page').toLowerCase(),

    apiVersion:  process.env.FACEBOOK_API_VERSION || 'v21.0',

    // Refresh once the token is within this many days of expiry. Default 10 →
    // with a 60-day token the real refresh fires ~every 50 days.
    refreshBeforeDays: Number(process.env.FACEBOOK_TOKEN_REFRESH_BEFORE_DAYS || 10),

    // Cron expression for the refresh CHECK (cheap; only calls the API when the
    // token is near expiry or missing). Default: daily at 03:30.
    refreshCron: process.env.FACEBOOK_TOKEN_REFRESH_CRON || '30 3 * * *',
  },

  // Testing escape hatch: when true, OTPs are LOGGED to the server console
  // and NOT sent via SMS. Lets you exercise the full signup/reset flow without
  // SMS credits or a verified gateway account. MUST be false for real users.
  otpDevMode: process.env.OTP_DEV_MODE === 'true',

  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY || '',
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET || '',

  signupIntentTtlMin: Number(process.env.SIGNUP_INTENT_TTL_MIN || 15),
  resetOtpTtlMin: Number(process.env.RESET_OTP_TTL_MIN || 10),
  loginMaxAttempts: Number(process.env.LOGIN_MAX_ATTEMPTS || 5),
  loginLockMinutes: Number(process.env.LOGIN_LOCK_MINUTES || 15),
};

env.isProd = env.nodeEnv === 'production';

if (env.otpDevMode) {
  console.warn(
    '[env] ⚠️  OTP_DEV_MODE is ON — OTP codes are written to the server log and ' +
    'NOT sent via SMS. Turn this OFF before real users sign up.'
  );
}

module.exports = env;
