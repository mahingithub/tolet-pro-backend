'use strict';

// Sentry MUST be initialised before anything else (Phase 7).
// This require runs instrument.js, which calls Sentry.init().
require('./instrument');

const env = require('./config/env');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const mongoose = require('mongoose');

const authRoutes     = require('./routes/auth.routes');
const propertyRoutes = require('./routes/property.routes');
const inquiryRoutes  = require('./routes/inquiry.routes');
const visitScheduleRoutes = require('./routes/visitSchedule.routes');
const hostRoutes     = require('./routes/host.routes');
// 🟢 Public landlord + tenant profile routes — added by roadmap-v2 / tenant roadmap.
const landlordRoutes = require('./routes/landlord.routes');
const tenantRoutes   = require('./routes/tenant.routes');
const errorHandler   = require('./middleware/errorHandler');
const firebaseAdmin  = require('./services/firebaseAdmin');
// Phase Call-7: request rate limiting (brute-force + spam protection)
const { authLimiter, writeLimiter, chatLimiter, apiLimiter } = require('./middleware/rateLimiters');

const app = express();

// Behind a reverse proxy (Vercel, fly.io, Render) so rate-limit + req.ip work.
app.set('trust proxy', 1);

// ─── Security middleware ────────────────────────────────────────────────────
app.use(helmet());
// Fix for ERR_QUIC_PROTOCOL_ERROR on Render
app.use((req, res, next) => {
  res.setHeader('Alt-Svc', 'clear');
  next();
});
// Native app origins (Capacitor WebView). These are fixed values baked into
// the app binary and can't be spoofed by a phishing site the way a web origin
// can, so they're always allowed. Android (Capacitor 5+) serves from
// https://localhost; iOS uses capacitor://localhost.
const NATIVE_APP_ORIGINS = new Set([
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
  'https://localhost',
]);

// Allowed browser origins = public site (CORS_ORIGINS) + admin console
// (ADMIN_CORS_ORIGINS). Both are credentialed. Keeping them in separate env
// vars means the admin subdomain is allow-listed explicitly and can be
// rotated/locked down without touching the public site config.
const ALLOWED_WEB_ORIGINS = new Set([...env.corsOrigins, ...env.adminCorsOrigins]);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // server-to-server / curl / native fetch
      if (NATIVE_APP_ORIGINS.has(origin)) return cb(null, true);
      if (ALLOWED_WEB_ORIGINS.has(origin)) return cb(null, true);
      // The old `.vercel.app` wildcard was removed — it let ANY site on
      // *.vercel.app (including an attacker's) make credentialed requests.
      // Put your exact production URL(s) in CORS_ORIGINS (public site) and
      // ADMIN_CORS_ORIGINS (admin subdomain) instead.
      return cb(new Error(`CORS: origin "${origin}" not allowed`));
    },
    credentials: true,
  })
);

// ─── WhatsApp inbound webhook (Meta) ─────────────────────────────────────────
// Mounted BEFORE the global JSON parser and the /api rate limiter ON PURPOSE:
//   • it needs the RAW request body to verify Meta's X-Hub-Signature-256 — the
//     router attaches its own JSON parser that stashes req.rawBody; the global
//     express.json() below would consume the body without keeping the raw bytes.
//   • Meta's webhook traffic must NOT be rate-limited — a 429 makes Meta retry
//     and eventually disable the webhook subscription.
// Helmet + CORS above still apply. See routes/whatsapp.routes.js.
app.use('/api/whatsapp', require('./routes/whatsapp.routes'));

// Auth payloads are tiny but property uploads embed base64 cover + room
// photos (and occasionally a video preview frame). 50 MB gives plenty of
// headroom for multi-photo listings without bouncing the request. Mongo
// will still cap individual documents at 16 MB — anything larger should
// be uploaded as binary to Cloudinary first and stored as a URL/ID.
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(mongoSanitize());
app.use(hpp());

// ─── Health ─────────────────────────────────────────────────────────────────
app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptime: process.uptime(),
  });
});

// ─── Routes ─────────────────────────────────────────────────────────────────
// Phase Call-7: light global limiter as a backstop on ALL api traffic.
app.use('/api', apiLimiter);

// STRICT limiter on auth — stops login/OTP brute-force.
app.use('/api/auth',       authLimiter, authRoutes);
app.use('/api/properties', propertyRoutes);
// Server-side Overpass (OpenStreetMap) proxy for property "Nearby places" —
// browser can't call Overpass directly (CORS + 406). Global apiLimiter covers it.
app.use('/api/geo',        require('./routes/geo.routes'));
// MEDIUM limiter on inquiry creation (spam-prone).
app.use('/api/inquiries',  writeLimiter, inquiryRoutes);
app.use('/api/visit-schedule', visitScheduleRoutes);
app.use('/api/host',       hostRoutes);
app.use('/api/host-stats', require('./routes/hostStats.routes')); // real host performance metrics
app.use('/api/landlords',  landlordRoutes);
app.use('/api/tenants',    tenantRoutes);
// Person-to-person reviews (landlord <-> tenant reputation on profiles).
app.use('/api/reviews',    require('./routes/review.routes'));
// Dedicated admin-console auth (separate login flow, admin-scoped tokens).
// MUST be registered BEFORE '/api/admin' so its public /login endpoint isn't
// captured by the admin router's requireAdminAuth gate.
app.use('/api/admin/auth', authLimiter, require('./routes/admin.auth.routes'));
app.use('/api/admin',      require('./routes/admin.routes'));
// MEDIUM limiter on messaging (spam-prone).
app.use('/api/conversations',  chatLimiter, require('./routes/chat.routes'));
app.use('/api/notifications',  require('./routes/notification.routes'));
// MEDIUM limiter on bookings (spam-prone).
app.use('/api/bookings',       writeLimiter, require('./routes/booking.routes'));
// Demand gauge: "interested in selling" clicks while self-service selling is
// Coming Soon. Public (guests count too) + spam-prone, so it sits behind the
// writeLimiter like inquiries/bookings. Admin reads the totals under /api/admin.
app.use('/api/sell-interest',  writeLimiter, require('./routes/sellInterest.routes'));
app.use('/api/receipts',       require('./routes/receipt.routes'));
// V1 manual rent payments — landlord payout accounts + tenant "I have paid" claims.
app.use('/api/payment-methods', require('./routes/paymentMethod.routes'));
app.use('/api/rent-payments',   writeLimiter, require('./routes/rentPayment.routes'));
app.use('/api/documents',      require('./routes/document.routes'));
app.use('/api/billing',        require('./routes/billing.routes'));
// Connected "Roommate Wallet" — shared household ledger (Living tab).
app.use('/api/living',         require('./routes/living.routes'));
// MEDIUM limiter on support ticket creation (spam-prone).
app.use('/api/helpdesk',       writeLimiter, require('./routes/support.routes'));
app.use('/api/users/me',       require('./routes/privacy.routes')); // Phase 7
app.use('/api/calls',          require('./routes/calls.routes')); // Phase 8
app.use('/api/admin/helpdesk', require('./routes/admin.support.routes'));
app.use('/api/ai-guides',     require('./routes/aiGuideRoutes'));
app.use('/api/ai-chat',       chatLimiter, require('./routes/aiChatRoutes'));
app.use('/api/push',          require('./routes/push.routes'));

// 404
app.use((req, res) => {
  res.status(404).json({ message: 'পথ পাওয়া যায়নি।', code: 'not_found', path: req.originalUrl });
});

// Phase 7: Sentry must capture errors BEFORE our own handler formats them.
// (No-op if SENTRY_DSN isn't set — safe either way.)
const Sentry = require('@sentry/node');
Sentry.setupExpressErrorHandler(app);

app.use(errorHandler);

// ─── Boot ───────────────────────────────────────────────────────────────────
const http = require('http');
const { initSocket } = require('./socket');

async function start() {
  // Try to init firebase-admin eagerly so we fail fast if the service-account
  // env var is malformed. A missing one is logged as a warning, not fatal —
  // signup/forgot routes will return a clear 500 if invoked.
  firebaseAdmin.init();

  try {
    await mongoose.connect(env.mongoUri);
    console.log('[mongo] connected');
  } catch (err) {
    console.error('[mongo] connection failed:', err.message);
    process.exit(1);
  }

  // Create an HTTP server from the Express app so we can attach Socket.IO.
  const server = http.createServer(app);

  // Attach Socket.IO signaling server.
  const io = initSocket(server);
  console.log('[socket.io] signaling server attached');

  server.listen(env.port, () => {
    console.log(`[server] listening on :${env.port} (${env.nodeEnv})`);
    console.log(`[server] CORS origins: ${env.corsOrigins.join(', ')}`);
  });

  // ─── Visit reminders ───────────────────────────────────────────────────
  // Always-on server (Render Starter+) runs this in-process — no external
  // cron / GitHub Action needed. Every 15 min it reminds BOTH the tenant and
  // the landlord ~2 hours before an accepted visit. NOTE: on the free tier the
  // server sleeps after 15 min idle, so the window can be missed — upgrade to
  // an always-on instance for this to be reliable.
  const { runVisitReminders } = require('./services/visitReminder.service');
  setTimeout(function bootVisitReminders() {
    runVisitReminders().catch((e) => console.warn('[visit-reminder] first run failed:', e.message));
    setInterval(() => {
      runVisitReminders().catch((e) => console.warn('[visit-reminder] run failed:', e.message));
    }, 15 * 60 * 1000);
  }, 15 * 1000);

  // ─── Per-member rent reminders ───────────────────────────────────────────
  // Daily nudge to each ACTIVE member whose next unpaid month is within its
  // reminder lead-days (in-app for linked accounts, SMS for phone-only). Runs
  // in-process like the visit reminders above. member.lastReminderKey de-dupes,
  // so the interval firing more than once a day still sends at most one nudge
  // per member+month per day. (The fuller invoice + late-fee automation lives
  // in services/cron.service.js → startCronJobs(); wire that in too if you also
  // want auto monthly invoice rows and late-fee enforcement.)
  const { runRentReminders } = require('./services/rentReminder.service');
  setTimeout(function bootRentReminders() {
    runRentReminders().catch((e) => console.warn('[rent-reminder] first run failed:', e.message));
    setInterval(() => {
      runRentReminders().catch((e) => console.warn('[rent-reminder] run failed:', e.message));
    }, 12 * 60 * 60 * 1000);
  }, 20 * 1000);

  // ─── Rented-listing cleanup ──────────────────────────────────────────────
  // A listing flips to 'rented' when its booking is created. We keep it visible
  // (badged "rented", with a countdown) for RENTED_RETENTION_DAYS so the host
  // can review it / create the lease, then permanently delete it and every
  // child document. Runs in-process hourly — the window is in days, so an
  // occasional missed tick on a sleeping instance just catches up next run.
  const { runRentedCleanup } = require('./services/rentedCleanup.service');
  setTimeout(function bootRentedCleanup() {
    runRentedCleanup().catch((e) => console.warn('[rented-cleanup] first run failed:', e.message));
    setInterval(() => {
      runRentedCleanup().catch((e) => console.warn('[rented-cleanup] run failed:', e.message));
    }, 60 * 60 * 1000);
  }, 30 * 1000);

  // ─── Facebook token auto-refresh ─────────────────────────────────────────
  // Facebook long-lived access tokens expire after ~60 days. This job keeps
  // the token used for Page auto-posting fresh: it checks daily and re-mints
  // the token via the Graph API once it's within a few days of expiring (so
  // the real API call lands every ~50 days — well under the 60-day limit). The
  // refreshed token is persisted to Mongo (models/FacebookToken.js) so it
  // survives restarts. No-ops cleanly if FACEBOOK_APP_ID/SECRET aren't set.
  const { startFacebookTokenRefreshJob } = require('./services/facebookToken.service');
  startFacebookTokenRefreshJob();
}

start();

// Graceful shutdown so Mongo flushes pending writes.
process.on('SIGINT', async () => {
  await mongoose.disconnect();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await mongoose.disconnect();
  process.exit(0);
});