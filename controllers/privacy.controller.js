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
// PREFERENCES
// ─────────────────────────────────────────────────────────────────────────────
exports.getPreferences = asyncH(async (req, res) => {
  res.json({ preferences: req.user.preferences || {} });
});

exports.setPreferences = asyncH(async (req, res) => {
  const patch = req.body;
  if (!req.user.preferences) req.user.preferences = {};
  
  if (patch.aiLearningOptIn !== undefined) req.user.preferences.aiLearningOptIn = patch.aiLearningOptIn;
  if (patch.marketingEmails !== undefined) req.user.preferences.marketingEmails = patch.marketingEmails;
  if (patch.smsAlerts !== undefined) req.user.preferences.smsAlerts = patch.smsAlerts;
  if (patch.theme !== undefined) req.user.preferences.theme = patch.theme;
  if (patch.language !== undefined) req.user.preferences.language = patch.language;
  
  await req.user.save();
  res.json({ preferences: req.user.preferences });
});
