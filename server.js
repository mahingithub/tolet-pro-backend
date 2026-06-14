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
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // server-to-server / curl
      if (env.corsOrigins.includes(origin)) return cb(null, true);
      // Allow Vercel preview deployments dynamically
      if (origin.endsWith('.vercel.app')) return cb(null, true);
      cb(new Error(`CORS: origin "${origin}" not allowed`));
    },
    credentials: true,
  })
);
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
app.use('/api/admin',      require('./routes/admin.routes'));
// MEDIUM limiter on messaging (spam-prone).
app.use('/api/conversations',  chatLimiter, require('./routes/chat.routes'));
app.use('/api/notifications',  require('./routes/notification.routes'));
// MEDIUM limiter on bookings (spam-prone).
app.use('/api/bookings',       writeLimiter, require('./routes/booking.routes'));
app.use('/api/receipts',       require('./routes/receipt.routes'));
app.use('/api/billing',        require('./routes/billing.routes'));
// MEDIUM limiter on support ticket creation (spam-prone).
app.use('/api/helpdesk',       writeLimiter, require('./routes/support.routes'));
app.use('/api/users/me',       require('./routes/privacy.routes')); // Phase 7
app.use('/api/calls',          require('./routes/calls.routes')); // Phase 8
app.use('/api/admin/helpdesk', require('./routes/admin.support.routes'));
app.use('/api/ai-guides',     require('./routes/aiGuideRoutes'));
app.use('/api/ai-chat',       require('./routes/aiChatRoutes'));
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
    
    // TEMPORARY FIX: Prune massive sessions arrays across the entire database to fix OOM / Event Loop blocking
    try {
      const User = require('./models/User');
      await User.updateMany(
        { 'sessions.10': { $exists: true } },
        { $push: { sessions: { $each: [], $slice: -9 } } }
      );
      console.log('[mongo] pruned bloated sessions arrays');
    } catch (e) {
      console.error('[mongo] array prune failed:', e.message);
    }
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