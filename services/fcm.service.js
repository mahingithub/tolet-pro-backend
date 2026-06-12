'use strict';

/**
 * fcm.service.js — Firebase Cloud Messaging (push notifications). [Phase Call-6]
 * ───────────────────────────────────────────────────────────────────────────
 * Sends "incoming call" push notifications so a user is alerted even when the
 * PWA is closed/backgrounded. Reuses the SAME Firebase service account already
 * configured for phone auth (FIREBASE_SERVICE_ACCOUNT_BASE64) — no new creds.
 *
 * IMPORTANT — modern API:
 *   The old `admin.messaging().sendToDevice()` is DEPRECATED and removed in
 *   recent firebase-admin. We use `sendEachForMulticast()` which takes an array
 *   of tokens and returns per-token success/failure so we can prune dead tokens.
 *
 * Safe-by-default: if Firebase isn't configured, every function no-ops quietly
 * (logs a warning once) so calling code never crashes. Push is an enhancement,
 * not a hard dependency of the call flow.
 */

let admin = null;
let messagingReady = false;
let warnedOnce = false;

const { createCallActionToken } = require('../utils/callActionToken');

function publicApiBaseUrl() {
  return (
    process.env.PUBLIC_API_BASE_URL ||
    process.env.API_BASE_URL ||
    process.env.VITE_API_BASE_URL ||
    'https://tolet-pro-backend.onrender.com/api'
  ).replace(/\/$/, '');
}

function publicAppBaseUrl() {
  return (
    process.env.PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.FRONTEND_URL ||
    'https://tolet-pro.vercel.app'
  ).replace(/\/$/, '');
}

function callLaunchUrl(action, call = {}) {
  const params = new URLSearchParams({
    incomingCall: '1',
    callAction: action || 'open',
    action: action || 'open',
    callId: String(call.callId || ''),
    callerId: String(call.callerId || ''),
    callerName: String(call.callerName || ''),
    callerAvatar: String(call.callerAvatar || ''),
    type: String(call.type || 'voice'),
    roomId: String(call.roomId || ''),
  });
  return `${publicAppBaseUrl()}/messages?${params.toString()}`;
}

// Lazy-init the Admin SDK. Reuses an existing initialised app if another part
// of the backend (e.g. phone auth) already called initializeApp.
function getMessaging() {
  if (messagingReady && admin) return admin.messaging();
  try {
    admin = require('firebase-admin');

    if (!admin.apps || admin.apps.length === 0) {
      // Decode the base64 service account (same env var as auth).
      const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
      if (!b64) {
        if (!warnedOnce) {
          console.warn('[fcm] FIREBASE_SERVICE_ACCOUNT_BASE64 not set — push disabled.');
          warnedOnce = true;
        }
        return null;
      }
      const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      admin.initializeApp({ credential: admin.credential.cert(json) });
    }
    messagingReady = true;
    return admin.messaging();
  } catch (err) {
    if (!warnedOnce) {
      console.warn('[fcm] init failed — push disabled:', err.message);
      warnedOnce = true;
    }
    return null;
  }
}

/**
 * Send an incoming-call push to a set of device tokens.
 *
 * @param {string[]} tokens   FCM device tokens (a user's registered devices)
 * @param {object}   call     { callId, callerId, callerName, callerAvatar, type, roomId, receiverId }
 * @returns {Promise<{ sent:number, failed:number, invalidTokens:string[] }>}
 *
 * `invalidTokens` lists tokens FCM rejected as unregistered/invalid so the
 * caller can pull them out of User.deviceTokens (keeps the array clean).
 */
async function sendIncomingCall(tokens, call) {
  const messaging = getMessaging();
  const list = (tokens || []).filter(Boolean);
  if (!messaging || list.length === 0) {
    return { sent: 0, failed: 0, invalidTokens: [] };
  }

  const { callId, callerId, callerName, callerAvatar, type, roomId, receiverId } = call;
  const title = `📞 ${callerName} কল করছেন`;
  const body = type === 'video' ? 'To Let Pro — ইনকামিং ভিডিও কল' : 'To Let Pro — ইনকামিং কল';
  const apiBaseUrl = publicApiBaseUrl();
  const callActionToken = callId && receiverId
    ? createCallActionToken({ callId, receiverId, ttlSeconds: 90 })
    : '';

  const notificationData = {
    kind: 'incoming_call',
    callId: String(callId || ''),
    callerId: String(callerId || ''),
    callerName: String(callerName || ''),
    callerAvatar: String(callerAvatar || ''),
    type: String(type || 'voice'),
    roomId: String(roomId || ''),
    title,
    body,
    click_action: 'INCOMING_CALL',
    callActionToken: String(callActionToken || ''),
    callActionUrl: `${apiBaseUrl}/calls/push-action`,
    apiBaseUrl,
    sentAt: String(Date.now()),
  };

  // NOTE: all `data` values MUST be strings (FCM requirement). We keep the
  // data payload for our custom service worker and also include webpush
  // notification metadata so browser-rendered push notifications can show
  // Receive/Reject actions when the platform supports them.
  const message = {
    tokens: list,
    data: notificationData,
    android: { priority: 'high' },
    // Web push: high urgency + short TTL because ringing calls expire quickly.
    webpush: {
      headers: { Urgency: 'high', TTL: '60' },
      notification: {
        title,
        body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: `incoming-call-${callId || receiverId || Date.now()}`,
        requireInteraction: true,
        renotify: true,
        vibrate: [250, 100, 250, 100, 250],
        actions: [
          { action: 'accept', title: '✅ রিসিভ করুন' },
          { action: 'decline', title: '❌ কাটুন' },
        ],
        data: notificationData,
      },
      fcmOptions: {
        link: callLaunchUrl('open', call),
      },
    },
  };

  try {
    const resp = await messaging.sendEachForMulticast(message);
    const invalidTokens = [];
    resp.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error?.code || '';
        // These mean the token is dead — safe to remove from the user.
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/invalid-argument'
        ) {
          invalidTokens.push(list[i]);
        }
      }
    });
    return { sent: resp.successCount, failed: resp.failureCount, invalidTokens };
  } catch (err) {
    console.warn('[fcm] sendIncomingCall failed:', err.message);
    return { sent: 0, failed: list.length, invalidTokens: [] };
  }
}

async function sendMissedCall(tokens, call) {
  const messaging = getMessaging();
  const list = (tokens || []).filter(Boolean);
  if (!messaging || list.length === 0) {
    return { sent: 0, failed: 0, invalidTokens: [] };
  }

  const { callId, callerId, callerName, callerAvatar, type, roomId, receiverId } = call;
  const title = `${callerName} থেকে মিসড কল`;
  const body = type === 'video' ? 'আপনি একটি ভিডিও কল মিস করেছেন' : 'আপনি একটি ভয়েস কল মিস করেছেন';
  const apiBaseUrl = publicApiBaseUrl();
  const notificationData = {
    kind: 'missed_call',
    callId: String(callId || ''),
    callerId: String(callerId || ''),
    callerName: String(callerName || ''),
    callerAvatar: String(callerAvatar || ''),
    receiverId: String(receiverId || ''),
    type: String(type || 'voice'),
    roomId: String(roomId || ''),
    title,
    body,
    click_action: 'MISSED_CALL',
    apiBaseUrl,
    sentAt: String(Date.now()),
  };

  const message = {
    tokens: list,
    data: notificationData,
    android: { priority: 'high' },
    webpush: {
      headers: { Urgency: 'high', TTL: '300' },
      notification: {
        title,
        body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: `incoming-call-${callId || receiverId || Date.now()}`,
        requireInteraction: false,
        renotify: true,
        vibrate: [160, 80, 160],
        data: notificationData,
      },
      fcmOptions: {
        link: callLaunchUrl('missed', call),
      },
    },
  };

  try {
    const resp = await messaging.sendEachForMulticast(message);
    const invalidTokens = [];
    resp.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error?.code || '';
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/invalid-argument'
        ) {
          invalidTokens.push(list[i]);
        }
      }
    });
    return { sent: resp.successCount, failed: resp.failureCount, invalidTokens };
  } catch (err) {
    console.warn('[fcm] sendMissedCall failed:', err.message);
    return { sent: 0, failed: list.length, invalidTokens: [] };
  }
}

module.exports = { sendIncomingCall, sendMissedCall, getMessaging };
