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
const cache = require('../config/redis');
const invalidate = require('./cacheInvalidation');

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
    
    // Drop the cached unread badge BEFORE announcing the notification. The
    // socket event below makes the client refetch its count almost instantly,
    // and if that refetch won the race it would re-cache the pre-create value
    // for a full TTL — the badge would visibly fail to increment.
    //
    // This is also the ONLY Notification.create in the codebase, so hooking
    // here covers every producer: all ~40 emit call sites, emitToAdmins, and
    // the cron jobs (invoices, late fees, rent + lease reminders) that create
    // notifications with no HTTP request to hang an invalidation off.
    await invalidate.onUnreadChanged(userId);

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

/**
 * Unread badge count — CACHE-ASIDE, 1 min TTL.
 *
 * The query itself is cheap, but the frontend POLLS it (NotificationContext,
 * the navbar bell, both dashboards), so it is one of the highest-CALL-VOLUME
 * queries in the app. Caching it is about cutting request count against a free
 * M0 Atlas tier, not about a slow query.
 *
 * The TTL stays at 1 minute because this number is visible in the UI at all
 * times: it is invalidated explicitly on every path that can change it (see
 * below), and the short TTL only backstops the paths that fan out too widely to
 * enumerate.
 *
 * Invalidated by:
 *   • emit()                    — creation chokepoint, covers all ~40 fan-out
 *                                 call sites and every cron notification
 *   • markRead / markAllRead    — read-state changes
 *   • remove()                  — deleting an UNREAD item changes the count
 *   • purgePropertyCascade      — bulk delete, arbitrary users
 *     (services/property.service.js collects the affected userIds first)
 */
async function countUnread({ user }) {
  const userId = String(user._id);
  return cache.getOrSet(
    cache.KEY.unread(userId),
    cache.TTL.UNREAD,
    () => Notification.countDocuments({ userId: user._id, read: false }),
  );
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
    // Only invalidate when the count actually moved. Re-reading an already-read
    // notification is a no-op, and flushing the cache for it would drop the
    // badge every time the user reopens a notification they've seen.
    await invalidate.onUnreadChanged(user._id);
  }
  return doc;
}

async function markAllRead({ user }) {
  const res = await Notification.updateMany(
    { userId: user._id, read: false },
    { $set: { read: true, readAt: new Date() } },
  );
  // Always invalidate, even when modifiedCount is 0: the cached value could
  // still be a stale non-zero from before some other path marked them read.
  await invalidate.onUnreadChanged(user._id);
  return { modified: res.modifiedCount || 0 };
}

async function remove({ id, user }) {
  const doc = await Notification.findById(id);
  if (!doc) throw ApiError.notFound('Notification পাওয়া যায়নি।', { code: 'notif_not_found' });
  if (String(doc.userId) !== String(user._id)) {
    throw ApiError.forbidden('আপনার নোটিফিকেশন নয়।', { code: 'not_owner' });
  }
  const wasUnread = !doc.read;
  await Notification.deleteOne({ _id: id });
  // Deleting an UNREAD notification lowers the badge; deleting a read one
  // doesn't. Checked before the delete, while the document is still in hand.
  if (wasUnread) await invalidate.onUnreadChanged(user._id);
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