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
