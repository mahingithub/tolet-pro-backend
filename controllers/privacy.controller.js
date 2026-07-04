'use strict';

/**
 * Privacy Controller
 * ──────────────────────────────────────────────────────────────────────────
 * Handles user-facing data-control surface (Privacy Center).
 */

const User = require('../models/User');
const SupportTicket = require('../models/SupportTicket');
const Booking = require('../models/Booking');
const ApiError = require('../utils/ApiError');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT DATA
// ─────────────────────────────────────────────────────────────────────────────
exports.exportMyData = asyncH(async (req, res) => {
  const user = req.user.toJSON();
  const tickets = await SupportTicket.find({ userId: req.user._id });
  const bookings = await Booking.find({
    $or: [{ tenantId: req.user._id }, { landlordId: req.user._id }]
  });

  const payload = {
    exportedAt: new Date().toISOString(),
    user,
    tickets,
    bookings,
    note: 'This is a complete snapshot of every record TO-LET PRO holds about your account at the time of export.'
  };

  // We return the raw JSON payload in memory. The frontend will wrap it in a Blob URL.
  // In a massive system, this would trigger an async job to upload to S3 and return a presigned URL.
  res.json({ payload });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE ACCOUNT
// ─────────────────────────────────────────────────────────────────────────────
const DELETION_GRACE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

exports.requestAccountDeletion = asyncH(async (req, res) => {
  const scheduledAt = new Date();
  const restoreDeadline = new Date(Date.now() + DELETION_GRACE_MS);

  req.user.pendingDeletion = { scheduledAt, restoreDeadline };
  await req.user.save();

  res.json({ pendingDeletion: req.user.pendingDeletion });
});

exports.cancelAccountDeletion = asyncH(async (req, res) => {
  req.user.pendingDeletion = { scheduledAt: null, restoreDeadline: null };
  await req.user.save();

  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// SESSIONS
// ─────────────────────────────────────────────────────────────────────────────
exports.listMySessions = asyncH(async (req, res) => {
  const sessions = req.user.sessions.map(s => {
    const raw = s.toJSON();
    raw.id = raw.sessionId;
    raw.current = raw.sessionId === req.sessionId;
    return raw;
  });
  res.json({ sessions });
});

exports.revokeSession = asyncH(async (req, res) => {
  const targetId = req.params.id;
  req.user.sessions = req.user.sessions.filter(s => s.sessionId !== targetId);
  await req.user.save();
  res.json({ ok: true });
});

exports.revokeAllOtherSessions = asyncH(async (req, res) => {
  const current = req.user.sessions.find(s => s.sessionId === req.sessionId);
  if (current) {
    req.user.sessions = [current];
    await req.user.save();
  }
  res.json({ ok: true, remaining: req.user.sessions.length });
});

// ─────────────────────────────────────────────────────────────────────────────
// PREFERENCES  (the global settings hub — App / Tenant / Landlord)
// ─────────────────────────────────────────────────────────────────────────────
//
// The frontend PATCHes a partial object shaped exactly like User.preferences:
//   {
//     theme, language, marketingEmails, smsAlerts, callNotifications, aiLearningOptIn,
//     notifications: { push, email, sound, frequency, dnd:{…}, messages, … },
//     app:      { currency, autoplayVideos, reduceMotion, defaultLandingRole },
//     tenant:   { profileVisibility, savedSearchAlerts, defaultCity, … },
//     landlord: { inquiryNotifications, autoReplyEnabled, quietHours:{…}, … },
//   }
// Only allow-listed keys are copied so a client can never write arbitrary
// fields onto the user document. Enum/type validation is enforced by the
// schema on save() (invalid values surface as a clean 400 via errorHandler).

// Cross-cutting flat fields the rest of the server reads directly.
const FLAT_KEYS     = ['aiLearningOptIn', 'marketingEmails', 'smsAlerts', 'callNotifications', 'theme', 'language'];
const NOTIF_KEYS    = ['push', 'email', 'sound', 'frequency', 'messages', 'bookings', 'payments', 'inquiries', 'visits', 'priceAlerts'];
const APP_KEYS      = ['currency', 'autoplayVideos', 'reduceMotion', 'defaultLandingRole'];
const TENANT_KEYS   = ['profileVisibility', 'showContactToLandlords', 'savedSearchAlerts', 'defaultCity', 'defaultArea', 'defaultBudgetMin', 'defaultBudgetMax', 'defaultPropertyType'];
const LANDLORD_KEYS = ['inquiryNotifications', 'autoReplyEnabled', 'autoReplyMessage', 'showPhoneOnListings', 'instantBooking', 'allowVisitRequests', 'defaultListingType'];
const WINDOW_KEYS   = ['enabled', 'from', 'until']; // shared by dnd + quietHours

function assignAllowed(target, patch, keys) {
  if (!patch || typeof patch !== 'object') return;
  for (const k of keys) {
    if (patch[k] !== undefined) target[k] = patch[k];
  }
}

exports.getPreferences = asyncH(async (req, res) => {
  const prefs = req.user.preferences ? req.user.preferences.toObject() : {};

  // Reconcile tenant privacy: tenantProfile.publicVisible is the authority
  // the public /api/tenants/:id gate reads, so surface its real value here
  // rather than the (possibly stale) settings default.
  if (req.user.tenantProfile) {
    prefs.tenant = prefs.tenant || {};
    prefs.tenant.profileVisibility =
      req.user.tenantProfile.publicVisible === false ? 'private' : 'public';
  }

  res.json({ preferences: prefs });
});

exports.setPreferences = asyncH(async (req, res) => {
  const patch = req.body || {};
  if (!req.user.preferences) req.user.preferences = {};
  const prefs = req.user.preferences;

  // Guard: ensure every nested group exists before we assign into it.
  // Existing docs get these via schema defaults on load; this is a
  // belt-and-suspenders pass so a direct sub-field assign never throws.
  prefs.notifications = prefs.notifications || {};
  prefs.notifications.dnd = prefs.notifications.dnd || {};
  prefs.app = prefs.app || {};
  prefs.tenant = prefs.tenant || {};
  prefs.landlord = prefs.landlord || {};
  prefs.landlord.quietHours = prefs.landlord.quietHours || {};

  // ── Flat legacy fields ────────────────────────────────────────────────
  assignAllowed(prefs, patch, FLAT_KEYS);

  // ── Notifications group ───────────────────────────────────────────────
  if (patch.notifications) {
    assignAllowed(prefs.notifications, patch.notifications, NOTIF_KEYS);
    assignAllowed(prefs.notifications.dnd, patch.notifications.dnd, WINDOW_KEYS);
  }

  // ── App / display group ───────────────────────────────────────────────
  if (patch.app) assignAllowed(prefs.app, patch.app, APP_KEYS);

  // ── Tenant scope ──────────────────────────────────────────────────────
  if (patch.tenant) {
    assignAllowed(prefs.tenant, patch.tenant, TENANT_KEYS);
    // Keep the legacy tenantProfile.publicVisible flag in lock-step so the
    // existing public-profile gate honours the new privacy toggle.
    if (patch.tenant.profileVisibility !== undefined) {
      req.user.tenantProfile = req.user.tenantProfile || {};
      req.user.tenantProfile.publicVisible = patch.tenant.profileVisibility !== 'private';
    }
  }

  // ── Landlord scope ────────────────────────────────────────────────────
  if (patch.landlord) {
    assignAllowed(prefs.landlord, patch.landlord, LANDLORD_KEYS);
    assignAllowed(prefs.landlord.quietHours, patch.landlord.quietHours, WINDOW_KEYS);
  }

  await req.user.save();

  // Echo back the same reconciled shape getPreferences returns.
  const out = req.user.preferences.toObject();
  if (req.user.tenantProfile) {
    out.tenant = out.tenant || {};
    out.tenant.profileVisibility =
      req.user.tenantProfile.publicVisible === false ? 'private' : 'public';
  }
  res.json({ preferences: out });
});
