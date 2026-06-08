'use strict';

const svc = require('../services/notification.service');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

exports.list = asyncH(async (req, res) => {
  const unreadOnly = String(req.query.unread || '').toLowerCase() === 'true';
  const items = await svc.listForUser({ user: req.user, unreadOnly, limit: req.query.limit });
  const unread = await svc.countUnread({ user: req.user });
  res.json({
    notifications: items.map((d) => d.toJSON()),
    unread,
  });
});

exports.unreadCount = asyncH(async (req, res) => {
  const unread = await svc.countUnread({ user: req.user });
  res.json({ unread });
});

exports.markRead = asyncH(async (req, res) => {
  const doc = await svc.markRead({ id: req.params.id, user: req.user });
  res.json({ notification: doc.toJSON() });
});

exports.markAllRead = asyncH(async (req, res) => {
  const r = await svc.markAllRead({ user: req.user });
  res.json(r);
});

// ─── Phase Call-6: FCM device-token management ──────────────────────────────
const User = require('../models/User');

/**
 * POST /api/notifications/register-device   Body: { token, platform? }
 * Upserts an FCM device token onto the current user (deduped). Idempotent.
 */
exports.registerDevice = asyncH(async (req, res) => {
  const { token, platform } = req.body || {};
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ message: 'token is required', code: 'token_required' });
  }
  // Pull any existing copy first (dedupe), then push fresh — atomic-ish and
  // avoids duplicate tokens piling up across logins on the same device.
  await User.updateOne({ _id: req.user._id }, { $pull: { deviceTokens: { token } } });
  await User.updateOne(
    { _id: req.user._id },
    { $push: { deviceTokens: { token, platform: platform || 'web', addedAt: new Date() } } },
  );
  res.json({ registered: true });
});

/**
 * POST /api/notifications/unregister-device   Body: { token }
 * Removes a token (e.g. on logout or when permission is revoked).
 */
exports.unregisterDevice = asyncH(async (req, res) => {
  const { token } = req.body || {};
  if (!token) {
    return res.status(400).json({ message: 'token is required', code: 'token_required' });
  }
  await User.updateOne({ _id: req.user._id }, { $pull: { deviceTokens: { token } } });
  res.json({ unregistered: true });
});

/**
 * POST /api/notifications/call-pref   Body: { enabled: boolean }
 * Toggles the user's incoming-call push notifications.
 */
exports.setCallNotifications = asyncH(async (req, res) => {
  const enabled = !!(req.body && req.body.enabled);
  await User.updateOne(
    { _id: req.user._id },
    { $set: { 'preferences.callNotifications': enabled } },
  );
  res.json({ callNotifications: enabled });
});
