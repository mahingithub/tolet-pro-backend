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
 * @param {object}   call     { callId, callerId, callerName, callerAvatar, type, roomId }
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

  const { callId, callerId, callerName, callerAvatar, type, roomId } = call;

  // NOTE: all `data` values MUST be strings (FCM requirement).
  const message = {
    tokens: list,
    notification: {
      title: `${callerName || 'Someone'} is calling`,
      body: type === 'video' ? 'Incoming video call' : 'Incoming voice call',
    },
    data: {
      callId: String(callId || ''),
      callerId: String(callerId || ''),
      callerName: String(callerName || ''),
      callerAvatar: String(callerAvatar || ''),
      type: String(type || 'voice'),
      roomId: String(roomId || ''),
      click_action: 'INCOMING_CALL',
    },
    // Android: high priority so it wakes the device; tag collapses dupes.
    android: {
      priority: 'high',
      notification: { sound: 'default', tag: String(callId || 'call'), channelId: 'calls' },
    },
    // Web push: give it a high-urgency header + the app icon.
    webpush: {
      headers: { Urgency: 'high', TTL: '60' },
      notification: {
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        vibrate: [200, 100, 200],
        requireInteraction: true,
      },
      fcmOptions: { link: '/messages' },
    },
    apns: {
      headers: { 'apns-priority': '10' },
      payload: { aps: { sound: 'default' } },
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

module.exports = { sendIncomingCall, getMessaging };
