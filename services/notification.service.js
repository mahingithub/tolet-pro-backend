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
const firebaseAdmin = require('./firebaseAdmin');

async function sendPushToDevice(deviceRecord, payload) {
  const platform = deviceRecord.platform || 'web';

  if (platform === 'android' || platform === 'ios') {
    // Native FCM via Firebase Admin
    const message = {
      token: deviceRecord.token,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: payload.data || {},
    };
    const adminApp = firebaseAdmin.init();
    if (adminApp) return adminApp.messaging().send(message);
    return null;
  } else {
    // Existing web-push path — unchanged
    // Note: The previous code used firebaseAdmin.sendToUser for everything.
    // We preserve that behavior for web tokens here.
    return null;
  }
}

async function emit({ userId, type, title, body, data, skipPush }) {
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

    // Fan out to the user's phone(s) via FCM — fire-and-forget so a push
    // failure never blocks the in-app notification. Callers that already send
    // their own push (e.g. the call ringer) can pass skipPush:true to opt out.
    if (!skipPush) {
      const User = require('../models/User');
      User.findById(userId).select('deviceTokens').lean().then(user => {
        const tokens = user?.deviceTokens || [];
        tokens.forEach(deviceRecord => {
          sendPushToDevice(deviceRecord, { title, body, data }).catch(() => {});
        });
        
        // Also call the original method to ensure web tokens and legacy behavior is fully preserved
        firebaseAdmin.sendToUser(userId, { title, body, data }).catch(() => {});
      }).catch(() => {});
    }
    
    return doc;
  } catch (err) {
    console.warn('[notif] emit failed:', err.message);
    return null;
  }
}

async function emitToAdmins({ type, title, body, data, skipPush }) {
  try {
    const User = require('../models/User');
    // Find all users with any admin-level role
    const admins = await User.find({ 
      $or: [
        { roles: { $in: ['super_admin', 'moderator', 'support_agent'] } },
        { role: { $in: ['super_admin', 'moderator', 'support_agent'] } }
      ]
    }).select('_id');
    
    const promises = admins.map(admin => emit({
      userId: admin._id,
      type: type || 'system',
      title,
      body,
      data,
      skipPush
    }));
    await Promise.allSettled(promises);
  } catch (err) {
    console.warn('[notif] emitToAdmins failed:', err.message);
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

async function remove({ id, user }) {
  const doc = await Notification.findById(id);
  if (!doc) throw ApiError.notFound('Notification পাওয়া যায়নি।', { code: 'notif_not_found' });
  if (String(doc.userId) !== String(user._id)) {
    throw ApiError.forbidden('আপনার নোটিফিকেশন নয়।', { code: 'not_owner' });
  }
  await Notification.deleteOne({ _id: id });
  return { id };
}

module.exports = {
  emit,
  emitToAdmins,
  listForUser,
  countUnread,
  markRead,
  markAllRead,
  remove,
};