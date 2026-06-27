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

exports.remove = asyncH(async (req, res) => {
  const r = await svc.remove({ id: req.params.id, user: req.user });
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

  const now = new Date();
  const userAgent = (req.headers && req.headers['user-agent'])
    ? String(req.headers['user-agent']).slice(0, 256)
    : undefined;

  // 1) Detach this token from EVERY user that currently holds it (including
  //    this one). On a shared browser, or after logging in as a different
  //    account on the same device, the same FCM token can otherwise stay
  //    attached to an old user and misroute their calls/notifications to
  //    whoever is using the device now. Clearing it everywhere first
  //    guarantees single ownership (audit 6.4).
  await User.updateMany(
    { 'deviceTokens.token': token },
    { $pull: { deviceTokens: { token } } },
  );

  // 2) Attach it fresh to the current user, with metadata for later cleanup.
  const entry = { token, platform: platform || 'web', addedAt: now, lastSeenAt: now };
  if (userAgent) entry.userAgent = userAgent;
  await User.updateOne(
    { _id: req.user._id },
    { $push: { deviceTokens: entry } },
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