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

// Pulled off the schema rather than hardcoded so the two can never drift.
const MAX_TITLE = Notification.schema.path('title')?.options?.maxlength || 160;
const MAX_BODY  = Notification.schema.path('body')?.options?.maxlength  || 600;

// Grapheme segmentation so a cut never lands inside a user-perceived character.
// This app's copy is Bengali, where a naive slice can separate a vowel sign or
// hasant from its base consonant and render as a broken glyph. Built once —
// constructing a Segmenter per notification would be wasteful.
const graphemes = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('bn', { granularity: 'grapheme' })
  : null;

/**
 * Clamp copy to the schema's maxlength.
 *
 * Without this, an over-long title/body raises a Mongoose ValidationError that
 * emit()'s catch swallows — the notification vanishes with only a console
 * warning. That is a real failure mode for any caller that personalises copy
 * AFTER length-checking it (the admin marketing blast expands {{name}}/{{tier}}
 * into an already-600-char body), so we truncate instead of dropping: a
 * slightly shortened notification beats no notification at all.
 *
 * `maxlength` counts UTF-16 code units, so the budget is measured in those, but
 * the cut is made on grapheme boundaries — slicing at an arbitrary unit can
 * leave an unpaired surrogate (half an emoji), which is not valid UTF-8 and can
 * get the payload rejected downstream, reintroducing the very delivery failure
 * this guard exists to prevent. One unit is reserved for an ellipsis so the
 * truncation is visible to the reader instead of silently altering the copy.
 */
function clamp(text, max) {
  const s = String(text == null ? '' : text);
  if (s.length <= max) return s;

  const budget = Math.max(0, max - 1);
  const units = graphemes
    ? Array.from(graphemes.segment(s), (seg) => seg.segment)
    : Array.from(s); // code points — still surrogate-safe, just not grapheme-aware

  let out = '';
  for (const g of units) {
    if (out.length + g.length > budget) break;
    out += g;
  }
  return `${out}…`;
}

async function emit({ userId, type, title, body, data, skipPush }) {
  if (!userId) return null;

  let doc;
  try {
    doc = await Notification.create({
      userId,
      type,
      title: clamp(title, MAX_TITLE),
      body:  clamp(body,  MAX_BODY),
      data:  data  || {},
    });
  } catch (err) {
    // The row was never written — this is the only genuine emit failure, and
    // the only case where returning null is truthful. An unknown `type` lands
    // here (the enum in models/Notification.js is the source of truth), so name
    // it explicitly: this used to be near-impossible to spot in the logs.
    console.warn(`[notif] emit failed (type=${type}):`, err.message);
    return null;
  }

  // ── Post-create side effects ────────────────────────────────────────────
  // Deliberately OUTSIDE the try above. These are best-effort delivery
  // concerns; the notification is already durably stored and WILL be picked up
  // by the client's next poll/refetch. Sharing a try block with the create made
  // emit() return null for notifications that genuinely existed, which lied to
  // callers that check the return value (the marketing blast reports those as
  // 'emit_failed' and shows the admin a failure for a delivered message).
  try {
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
  } catch (err) {
    console.warn('[notif] unread cache invalidation failed:', err.message);
  }

  // Broadcast real-time to the user's active sockets
  try {
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
  } catch (err) {
    console.warn('[notif] socket broadcast failed:', err.message);
  }

  // Fan out to the user's phone(s) via FCM — fire-and-forget so a push failure
  // never blocks the in-app notification. Callers that already send their own
  // push (e.g. the call ringer, the marketing blast's separate push channel)
  // can pass skipPush:true to opt out.
  //
  // sendToUser() multicasts to EVERY registered token (native + web) and prunes
  // the dead ones, so it is the single fan-out path. An earlier version also
  // looped the tokens and sent to each android/ios one individually before
  // calling this, which delivered every notification TWICE on native devices.
  if (!skipPush) {
    firebaseAdmin
      .sendToUser(userId, { title: doc.title, body: doc.body, data })
      .catch(() => {});
  }

  return doc;
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
  // Pure helper, exported for tests: its boundary behaviour is the difference
  // between a truncated notification and a silently dropped one.
  clamp,
  MAX_TITLE,
  MAX_BODY,
};