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
const cookieParser = require('cookie-parser');

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
// Phase Call-7: request rate limiting (brute-force + spam protection).
// The in-memory limiters are still imported: middleware/advancedRateLimiter.js
// uses them as its automatic fallback when Redis is unavailable, so protection
// degrades rather than disappearing. See that file's header.
const { authLimiter, writeLimiter, chatLimiter, apiLimiter } = require('./middleware/rateLimiters');

// ─── Redis cache + Redis-backed rate limiting ───────────────────────────────
// Both no-op safely when REDIS_URL is unset (config/env.js -> env.useRedis).
const cache = require('./config/redis');
const { rateLimiters } = require('./middleware/advancedRateLimiter');

const app = express();

// Behind a reverse proxy (Vercel, fly.io, Render) so rate-limit + req.ip work.
app.set('trust proxy', 1);

// ─── Security middleware ────────────────────────────────────────────────────
// Configure Helmet with comprehensive security headers
// 🔒 Security Headers Implemented:
//   • CSP: Prevents XSS by controlling resource loading
//   • HSTS: Forces HTTPS for 1 year (including subdomains)
//   • X-Frame-Options: Prevents clickjacking
//   • X-Content-Type-Options: Prevents MIME sniffing
//   • Referrer-Policy: Controls referrer information leakage
//   • Permissions-Policy: Restricts browser features
//   • X-XSS-Protection: Legacy XSS filter for old browsers
app.use(
  helmet({
    // Content Security Policy - Prevents XSS attacks
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'", // Required for some inline scripts (consider removing in production)
          'https://maps.googleapis.com',
          'https://www.google.com',
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'", // Required for styled-components and inline styles
          'https://fonts.googleapis.com',
        ],
        imgSrc: [
          "'self'",
          'data:', // For base64 images
          'blob:', // For file uploads preview
          'https:', // Allow images from any HTTPS source (Cloudinary, etc.)
        ],
        fontSrc: [
          "'self'",
          'data:',
          'https://fonts.gstatic.com',
        ],
        connectSrc: [
          "'self'",
          'https://maps.googleapis.com',
          'https://firestore.googleapis.com',
          'https://fcm.googleapis.com',
          'https://*.google.com',
        ],
        frameSrc: [
          "'self'",
          'https://www.google.com', // For reCAPTCHA
        ],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [], // Force HTTPS
      },
    },

    // HTTP Strict Transport Security - Force HTTPS for 1 year
    hsts: {
      maxAge: 31536000, // 1 year in seconds
      includeSubDomains: true,
      preload: true,
    },

    // X-Frame-Options - Prevent clickjacking
    frameguard: {
      action: 'deny', // Don't allow embedding in iframes
    },

    // X-Content-Type-Options - Prevent MIME sniffing
    noSniff: true,

    // Referrer-Policy - Control referrer information
    referrerPolicy: {
      policy: 'strict-origin-when-cross-origin',
    },

    // Permissions-Policy - Restrict browser features
    permissionsPolicy: {
      features: {
        geolocation: ['self'], // Allow geolocation for property location
        camera: ['self'], // Allow camera for photo uploads
        microphone: ['none'], // Disable microphone
        payment: ['none'], // Disable payment API
        usb: ['none'], // Disable USB API
        bluetooth: ['none'], // Disable Bluetooth API
      },
    },

    // X-DNS-Prefetch-Control - Control DNS prefetching
    dnsPrefetchControl: {
      allow: false,
    },

    // X-Download-Options - Prevent IE from executing downloads
    ieNoOpen: true,

    // Hide X-Powered-By header
    hidePoweredBy: true,
  })
);

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

// ─── Cookie Parser ──────────────────────────────────────────────────────────
// Parse cookies for httpOnly refresh tokens
app.use(cookieParser());

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
// Render polls this as the service's health check (see render.yaml
// healthCheckPath), so the contract matters: `ok` must reflect only what makes
// the app UNABLE TO SERVE. Mongo down means every route fails, so that flips
// `ok` to false. Redis down does NOT — the cache falls back to Mongo and the
// rate limiter falls back to in-memory, which is degraded, not broken. Failing
// the health check on a Redis blip would make Render restart (or refuse to
// route traffic to) a server that is working fine.
app.get('/healthz', async (_req, res) => {
  // A readyState of 1 only says the driver THINKS it's connected. An actual
  // ping catches the case where the socket is up but the cluster isn't
  // answering — the failure mode that matters to a user mid-request.
  let db = 'disconnected';
  if (mongoose.connection.readyState === 1) {
    try {
      await mongoose.connection.db.admin().command({ ping: 1 });
      db = 'connected';
    } catch {
      db = 'unreachable';
    }
  }

  const redis = await cache.ping(); // 'connected' | 'disconnected' | 'disabled'
  const stats = cache.getStats();

  const ok = db === 'connected';
  res.status(ok ? 200 : 503).json({
    ok,
    db,
    redis,
    cacheStats: {
      hits: stats.hits,
      misses: stats.misses,
      hitRate: stats.hitRate,
      sets: stats.sets,
      writeThrough: stats.writeThrough,
      writeBack: stats.writeBack,
      flushed: stats.flushed,
      invalidations: stats.invalidations,
      errors: stats.errors,
    },
    // Cross-instance Socket.IO delivery. False on a single instance is normal.
    socketAdapter: require('./socket').isRedisAdapterActive(),
    uptime: process.uptime(),
  });
});

// ─── Routes ─────────────────────────────────────────────────────────────────
// Registration ORDER below is unchanged — several mounts depend on it (most
// importantly /api/admin/auth before /api/admin). Only the limiters were
// swapped for their Redis-backed equivalents.
//
// Phase Call-7: light global limiter as a backstop on ALL api traffic.
app.use('/api', rateLimiters.api);

// STRICT limiter on auth — stops login/OTP brute-force. Only FAILED attempts
// count (skipSuccessfulRequests), so routine POST /refresh + GET /me traffic
// from real users can't exhaust the budget.
app.use('/api/auth',       rateLimiters.auth, authRoutes);
// SEARCH limiter is GET-only (it skips non-GET internally), so creating or
// editing a listing still falls to the global limiter rather than a read budget.
app.use('/api/properties', rateLimiters.search, propertyRoutes);
// Server-side Overpass (OpenStreetMap) proxy for property "Nearby places" —
// browser can't call Overpass directly (CORS + 406). Global apiLimiter covers it.
app.use('/api/geo',        require('./routes/geo.routes'));
// MEDIUM limiter on inquiry creation (spam-prone).
app.use('/api/inquiries',  rateLimiters.write, inquiryRoutes);
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
app.use('/api/admin/auth', rateLimiters.auth, require('./routes/admin.auth.routes'));
app.use('/api/admin',      require('./routes/admin.routes'));
// MEDIUM limiter on messaging (spam-prone).
app.use('/api/conversations',  rateLimiters.messages, require('./routes/chat.routes'));
app.use('/api/notifications',  require('./routes/notification.routes'));
// MEDIUM limiter on bookings (spam-prone).
app.use('/api/bookings',       rateLimiters.write, require('./routes/booking.routes'));
// Building → Unit (room) structure. Rooms are created once, independently of
// any tenant, and bookings join to them by id — see models/Building.js for why
// the old name-matching had to go.
app.use('/api/buildings',      rateLimiters.write, require('./routes/building.routes'));
app.use('/api/units',          rateLimiters.write, require('./routes/building.routes').unitRouter);
// Tenant self-onboarding by QR / link: the landlord shares a token, the tenant
// fills in their own NID, photo and emergency contact, the landlord approves.
// Carries ONE public route (/resolve/:token) so a shared link previews before
// signup — see routes/invite.routes.js.
app.use('/api/invite',         rateLimiters.write, require('./routes/invite.routes'));
// Demand gauge: "interested in selling" clicks while self-service selling is
// Coming Soon. Public (guests count too) + spam-prone, so it sits behind the
// writeLimiter like inquiries/bookings. Admin reads the totals under /api/admin.
app.use('/api/sell-interest',  rateLimiters.write, require('./routes/sellInterest.routes'));
app.use('/api/receipts',       require('./routes/receipt.routes'));
// V1 manual rent payments — landlord payout accounts + tenant "I have paid" claims.
app.use('/api/payment-methods', require('./routes/paymentMethod.routes'));
app.use('/api/rent-payments',   rateLimiters.write, require('./routes/rentPayment.routes'));
app.use('/api/documents',      require('./routes/document.routes'));
app.use('/api/billing',        require('./routes/billing.routes'));
app.use('/api/boost',          rateLimiters.write, require('./routes/boost.routes'));
// Connected "Roommate Wallet" — shared household ledger (Living tab).
app.use('/api/living',         require('./routes/living.routes'));
// MEDIUM limiter on support ticket creation (spam-prone).
app.use('/api/helpdesk',       rateLimiters.write, require('./routes/support.routes'));
app.use('/api/users/me',       require('./routes/privacy.routes')); // Phase 7
app.use('/api/calls',          require('./routes/calls.routes')); // Phase 8
app.use('/api/admin/helpdesk', require('./routes/admin.support.routes'));
app.use('/api/ai-guides',     require('./routes/aiGuideRoutes'));
app.use('/api/ai-chat',       rateLimiters.ai, require('./routes/aiChatRoutes'));
// AI Ledger Scanner — Gemini Vision reads a photo of a rent khata (খাতা) and
// returns structured tenant data for the host to review before batch-saving.
app.use('/api/ai',            rateLimiters.ai, require('./routes/aiScan.routes'));
app.use('/api/push',          require('./routes/push.routes'));
// UPLOAD limiter — new. This route mints signed Cloudinary credentials, so an
// unthrottled caller could burn storage/bandwidth quota; it previously relied
// on the global limiter alone.
app.use('/api/upload',        rateLimiters.upload, require('./routes/upload.routes'));

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
const { initSocket, shutdownSocketRedis } = require('./socket');

/**
 * Persist one write-back cache key to MongoDB.
 *
 * Passed to cache.flushDirtyKeys(), which DRAINS each key (atomic get+delete)
 * before calling this, and puts the value back if this throws — so a failure
 * here is retried on the next tick rather than lost. Because the key is drained,
 * the value received is the delta accumulated SINCE THE LAST FLUSH.
 *
 * Dispatch is by key NAMESPACE, matching the builders in config/redis.js KEY.*.
 * An unknown namespace throws on purpose: silently discarding it would hide the
 * fact that something is writing to the write-back cache with no way to persist.
 *
 * @param {string} key   e.g. 'views:665f...'
 * @param {*}      value the cached value (a number, for counters)
 */
async function flushToDB(key, value) {
  const [namespace, id] = String(key).split(':');

  switch (namespace) {
    // Property view counter. `$inc` (not `$set`) because the Redis key holds
    // the count accumulated SINCE the last flush — the key is deleted after a
    // successful flush, so setting an absolute value would throw away every
    // view recorded before it.
    case 'views': {
      const n = Number(value);
      if (!id || !Number.isFinite(n) || n <= 0) return;

      const Property = require('./models/Property');
      await Property.updateOne(
        { _id: id },
        // `$inc` pairs with the drain in flushDirtyKeys: the Redis key held only
        // the views since the previous flush, so this adds a delta. `$set` here
        // would discard every view recorded before this window.
        { $inc: { viewCount: n } },
        // `strict: false` because viewCount is not declared in the Property
        // schema; without it Mongoose silently strips the operator and the
        // write becomes a no-op that still reports success. Add the field to
        // models/Property.js if you later want to query or sort on it.
        { strict: false, timestamps: false },
      );

      // The cached read of this property now has a stale count.
      await cache.del(cache.KEY.property(id));
      return;
    }

    default:
      throw new Error(`flushToDB: no handler for cache namespace "${namespace}" (key: ${key})`);
  }
}

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
    console.log(`[server] cache: ${env.useRedis ? 'Redis enabled' : 'DISABLED (no REDIS_URL)'}`);
  });

  // ─── Write-back cache flush ──────────────────────────────────────────────
  // Drains cache.writeBack() / incrementWriteBack() keys into MongoDB every 10
  // minutes. Only counters use write-back today (property views), so the
  // exposure is bounded: a hard crash between two ticks loses at most 10
  // minutes of view counts, and nothing else.
  //
  // The interval is unref()'d so it can never hold the process open during
  // shutdown; the SIGTERM/SIGINT handlers below run one final flush explicitly,
  // which is what actually protects the last window of data on a Render deploy.
  if (env.useRedis) {
    const flushTimer = setInterval(() => {
      cache.flushDirtyKeys(flushToDB)
        .catch((e) => console.warn('[cache] scheduled flush failed:', e.message));
    }, 10 * 60 * 1000);
    flushTimer.unref();
  }

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

  // ─── Scheduled billing + reminder jobs ───────────────────────────────────
  // Monthly invoice generation (1st @ 00:00), late-fee enforcement (daily @
  // 00:00), per-member rent reminders (daily @ 09:00) and lease-expiry
  // reminders (daily @ 09:30) — all Asia/Dhaka. Started AFTER the mongoose
  // connect above, because every job queries on its first tick.
  //
  // This call was missing entirely, so invoices and late fees never ran in
  // production. Rent reminders used to be driven by a separate 12-hour
  // setInterval here; that duplicate has been removed now that the cron owns
  // the schedule (the per-member de-dupe key made the overlap harmless, but it
  // was doing the same sweep twice a day for no reason).
  const { startCronJobs } = require('./services/cron.service');
  startCronJobs();

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

// Only boot when this file IS the process entry point. Under Jest the module
// is `require`d to get the Express `app` for supertest, and booting would then
// open a real Mongo connection, bind a port and start every cron — none of
// which a test wants (and all of which leave open handles behind).
if (require.main === module) {
  start();
}

// Export the configured Express app for integration tests (supertest drives it
// directly, with its own mongodb-memory-server connection).
module.exports = app;
module.exports.start = start;
// Exported so the write-back flush can be verified against the REAL writer
// (scripts/verify-cache-wiring.js) instead of a copy that could drift from it.
module.exports.flushToDB = flushToDB;

// ─── Graceful shutdown ──────────────────────────────────────────────────────
// Render sends SIGTERM on every deploy, so this path runs routinely, not just
// in emergencies. ORDER MATTERS:
//   1. Flush write-back keys to Mongo — this is the last chance to persist
//      them, and it must happen while Mongo is STILL connected.
//   2. Close the Socket.IO pub/sub clients.
//   3. Close the cache connection.
//   4. Disconnect Mongo last, so step 1 can complete.
//
// Everything is wrapped: a shutdown must terminate even if a cleanup step
// fails, and the whole sequence is capped by a timeout because Render SIGKILLs
// after ~30s. Hanging here would turn a clean deploy into a hard kill and lose
// exactly the data step 1 exists to save.
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return; // a second Ctrl-C shouldn't re-enter this
  shuttingDown = true;
  console.log(`[server] ${signal} received — shutting down gracefully`);

  const deadline = setTimeout(() => {
    console.warn('[server] shutdown timed out after 15s — forcing exit');
    process.exit(1);
  }, 15_000);
  deadline.unref();

  try {
    if (env.useRedis) {
      const result = await cache.flushDirtyKeys(flushToDB);
      if (result.flushed) console.log(`[server] flushed ${result.flushed} write-back key(s) on exit`);
    }
  } catch (e) {
    console.warn('[server] final cache flush failed:', e.message);
  }

  try { await shutdownSocketRedis(); } catch (e) {
    console.warn('[server] socket.io redis shutdown failed:', e.message);
  }

  try { await cache.disconnect(); } catch (e) {
    console.warn('[server] cache disconnect failed:', e.message);
  }

  try { await mongoose.disconnect(); } catch (e) {
    console.warn('[server] mongo disconnect failed:', e.message);
  }

  clearTimeout(deadline);
  console.log('[server] shutdown complete');
  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));