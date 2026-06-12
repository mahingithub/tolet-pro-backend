'use strict';

/**
 * notification.service.js
 *
 * Thin emitter on top of the Notification model. All creation paths log and
 * swallow errors — a downstream notification failure must NEVER block the
 * primary business action (creating an inquiry, sending a message, etc.).
 */

const Notification = require('../models/Notification');
const ApiError     = require('../utils/ApiError');

async function emit({ userId, type, title, body, data }) {
  if (!userId) return null;
  try {
    const doc = await Notification.create({
      userId,
      type,
      title: title || '',
      body:  body  || '',
      data:  data  || {},
    });
    
    // Broadcast real-time to the user's active sockets
    const { getIo, emitToUser } = require('../socket');
    const io = getIo();
    if (io) {
      emitToUser(io, userId, 'new_notification', {
        id: doc._id,
        userId: doc.userId,
        type: doc.type,
        title: doc.title,
        body: doc.body,
        data: doc.data,
        read: doc.read,
        createdAt: doc.createdAt
      });
    }
    
    return doc;
  } catch (err) {
    console.warn('[notif] emit failed:', err.message);
    return null;
  }
}

async function listForUser({ user, unreadOnly, limit }) {
  const filter = { userId: user._id };
  if (unreadOnly) filter.read = false;
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return Notification.find(filter).sort({ createdAt: -1, _id: -1 }).limit(cap);
}

async function countUnread({ user }) {
  return Notification.countDocuments({ userId: user._id, read: false });
}

async function markRead({ id, user }) {
  const doc = await Notification.findById(id);
  if (!doc) throw ApiError.notFound('Notification পাওয়া যায়নি।', { code: 'notif_not_found' });
  if (String(doc.userId) !== String(user._id)) {
    throw ApiError.forbidden('আপনার নোটিফিকেশন নয়।', { code: 'not_owner' });
  }
  if (!doc.read) {
    doc.read = true;
    doc.readAt = new Date();
    await doc.save();
  }
  return doc;
}

async function markAllRead({ user }) {
  const res = await Notification.updateMany(
    { userId: user._id, read: false },
    { $set: { read: true, readAt: new Date() } },
  );
  return { modified: res.modifiedCount || 0 };
}

module.exports = {
  emit,
  listForUser,
  countUnread,
  markRead,
  markAllRead,
};
