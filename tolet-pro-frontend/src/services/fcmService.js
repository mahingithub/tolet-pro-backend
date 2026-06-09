// fcmService.js — Firebase Cloud Messaging client. [Phase Call-6]
// ───────────────────────────────────────────────────────────────────────────
// Requests notification permission, gets the FCM device token, and registers
// it with our backend so the user can receive incoming-call pushes when the
// PWA is closed/backgrounded.
//
// Self-contained: it initialises its own Firebase app instance from the
// VITE_FIREBASE_* env vars so it doesn't depend on how the rest of the app
// sets up Firebase (phone auth). Safe to call repeatedly.
//
// ► REQUIRES these env vars (Vercel + .env.local):
//     VITE_FIREBASE_API_KEY
//     VITE_FIREBASE_AUTH_DOMAIN
//     VITE_FIREBASE_PROJECT_ID
//     VITE_FIREBASE_MESSAGING_SENDER_ID
//     VITE_FIREBASE_APP_ID
//     VITE_FIREBASE_VAPID_KEY   ← the Web Push certificate key pair
//
// ► Foreground messages (tab open) are handled here via onMessage; background
//   messages and notification action clicks are handled by /service-worker.js.

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';
import { getCurrentToken } from './authService';

const API_BASE = import.meta.env.VITE_API_BASE_URL
  ? `${import.meta.env.VITE_API_BASE_URL.replace(/\/$/, '')}/notifications`
  : 'http://localhost:5000/api/notifications';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;

let _messaging = null;
let _onMessageBound = false;
let _swRegistrationPromise = null;

// Get (or lazily create) a Messaging instance, but only if the browser
// supports it (e.g. not old iOS, not some in-app webviews).
async function getMessagingSafe() {
  try {
    if (!(await isSupported())) return null;
    if (!firebaseConfig.apiKey || !VAPID_KEY) {
      console.warn('[fcm] Firebase/VAPID env vars missing — push disabled.');
      return null;
    }
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    if (!_messaging) _messaging = getMessaging(app);
    return _messaging;
  } catch (err) {
    console.warn('[fcm] messaging unavailable:', err?.message);
    return null;
  }
}

async function ensureNotificationPermission({ prompt = true } = {}) {
  if (typeof Notification === 'undefined') return 'unsupported';

  let permission = Notification.permission;
  if (permission === 'default' && prompt) {
    try { permission = await Notification.requestPermission(); } catch { return Notification.permission; }
  }
  return permission;
}

async function getCallServiceWorkerRegistration() {
  if (!('serviceWorker' in navigator)) return null;

  if (!_swRegistrationPromise) {
    _swRegistrationPromise = (async () => {
      const existing = await navigator.serviceWorker.getRegistration('/');
      if (existing) return existing;

      return navigator.serviceWorker.register('/service-worker.js', {
        scope: '/',
      });
    })();
  }

  return _swRegistrationPromise;
}

async function postToBackend(path, body) {
  const auth = getCurrentToken();
  if (!auth) return null;
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` },
      body: JSON.stringify(body),
    });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

/**
 * Ask for notification permission, get a token, and register it.
 * Call this AFTER login (when you have an auth token). No-ops safely if the
 * user denies permission or the browser can't do push.
 *
 * @returns {Promise<string|null>} the FCM token, or null
 */
export async function enableCallNotifications({ prompt = true } = {}) {
  // Must be served over HTTPS (or localhost) and have Notification API.
  const permission = await ensureNotificationPermission({ prompt });
  if (permission !== 'granted') return null;

  try {
    // Register the ROOT PWA worker as the FCM worker. That gives notification
    // clicks root-scope control over /messages and keeps installed PWA launches
    // on the same service worker as push delivery.
    const swReg = await getCallServiceWorkerRegistration();
    if (!swReg) return null;

    const messaging = await getMessagingSafe();
    if (!messaging) return null;

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg,
    });
    if (!token) return null;

    await postToBackend('/register-device', { token, platform: 'web' });
    bindForegroundHandler(messaging);
    return token;
  } catch (err) {
    console.warn('[fcm] enableCallNotifications failed:', err?.message);
    return null;
  }
}

// Show a notification for messages that arrive while the tab is in the
// FOREGROUND (background ones are handled by the SW). Bound once.
function bindForegroundHandler(messaging) {
  if (_onMessageBound) return;
  _onMessageBound = true;
  onMessage(messaging, (payload) => {
    const data = payload.data || {};
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    // Only auto-show if the tab is actually hidden; if it's visible the in-app
    // call UI (CALL_RINGING over socket) already handles it.
    if (document.visibilityState === 'visible') return;
    (async () => {
      const callerName = data.callerName || 'Someone';
      const isVideo = data.type === 'video';
      const isMissed = data.kind === 'missed_call' || data.click_action === 'MISSED_CALL';
      const title = isMissed ? `Missed call from ${callerName}` : `${callerName} is calling`;
      const options = {
        body: isMissed
          ? (isVideo ? 'You missed a video call' : 'You missed a voice call')
          : (isVideo ? 'Incoming video call' : 'Incoming voice call'),
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        timestamp: Date.now(),
        vibrate: isMissed ? [160, 80, 160] : [250, 100, 250, 100, 250],
        silent: false,
        tag: data.callId ? `incoming-call-${data.callId}` : 'incoming-call',
        data,
        requireInteraction: !isMissed,
        actions: isMissed ? [] : [
          { action: 'accept', title: 'Receive' },
          { action: 'decline', title: 'Reject' },
        ],
      };

      try {
        const swReg = await getCallServiceWorkerRegistration();
        if (swReg?.showNotification) {
          await swReg.showNotification(title, options);
          return;
        }
        new Notification(title, options);
      } catch { /* ignore */ }
    })();
  });
}

/** Turn off push for this device (e.g. on logout). */
export async function disableCallNotifications() {
  try {
    const messaging = await getMessagingSafe();
    if (!messaging) return;
    const swReg = await getCallServiceWorkerRegistration();
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg || undefined,
    }).catch(() => null);
    if (token) await postToBackend('/unregister-device', { token });
  } catch { /* ignore */ }
}

export function enableCallNotificationsOnNextUserGesture() {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return () => {};
  if (Notification.permission !== 'default') {
    enableCallNotifications({ prompt: false }).catch(() => {});
    return () => {};
  }

  let done = false;
  const cleanup = () => {
    window.removeEventListener('pointerdown', onGesture, true);
    window.removeEventListener('keydown', onGesture, true);
  };
  const onGesture = () => {
    if (done) return;
    done = true;
    cleanup();
    enableCallNotifications({ prompt: true }).catch(() => {});
  };

  window.addEventListener('pointerdown', onGesture, { once: true, capture: true });
  window.addEventListener('keydown', onGesture, { once: true, capture: true });
  return cleanup;
}

/** Toggle the server-side call-notification preference. */
export async function setCallNotificationPref(enabled) {
  return postToBackend('/call-pref', { enabled: !!enabled });
}

export default {
  enableCallNotifications,
  enableCallNotificationsOnNextUserGesture,
  disableCallNotifications,
  setCallNotificationPref,
};
