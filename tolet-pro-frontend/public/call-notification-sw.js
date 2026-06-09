/* Shared incoming-call notification handling for TO-LET PRO service workers.
 *
 * Imported by:
 *   - /service-worker.js          root PWA + FCM worker for new tokens
 *   - /firebase-messaging-sw.js  legacy Firebase worker for old tokens
 */

(() => {
  if (self.__TOLET_CALL_NOTIFICATIONS_BOUND__) return;
  self.__TOLET_CALL_NOTIFICATIONS_BOUND__ = true;

  const FIREBASE_SDK_VERSION = '11.0.2';
  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyBHArOG7EPDBVVbtnt9J8YKdkb5MN9SV08',
    authDomain: 'to-let-pro-14e09.firebaseapp.com',
    projectId: 'to-let-pro-14e09',
    storageBucket: 'to-let-pro-14e09.firebasestorage.app',
    messagingSenderId: '100291826945',
    appId: '1:100291826945:web:78671cae8a8eb831a27700',
  };

  const FALLBACK_CALL_ACTION_URL =
    'https://tolet-pro-backend.onrender.com/api/calls/push-action';

  function asString(value, fallback = '') {
    return value === undefined || value === null ? fallback : String(value);
  }

  function isIncomingCallData(data) {
    data = payloadData(data);
    if (!data) return false;
    return (
      data.kind === 'incoming_call' ||
      data.click_action === 'INCOMING_CALL' ||
      (!!data.callId && !!data.roomId && (data.type === 'voice' || data.type === 'video'))
    );
  }

  function isMissedCallData(data) {
    data = payloadData(data);
    if (!data) return false;
    return data.kind === 'missed_call' || data.click_action === 'MISSED_CALL';
  }

  function isCallData(data) {
    return isIncomingCallData(data) || isMissedCallData(data);
  }

  function payloadData(raw) {
    if (raw && raw.FCM_MSG && raw.FCM_MSG.data) return raw.FCM_MSG.data;
    return raw || {};
  }

  function normalizeCallData(raw) {
    const data = payloadData(raw);
    return {
      kind: asString(data.kind, 'incoming_call'),
      callId: asString(data.callId),
      callerId: asString(data.callerId),
      callerName: asString(data.callerName, 'Someone'),
      callerAvatar: asString(data.callerAvatar),
      type: asString(data.type, 'voice') === 'video' ? 'video' : 'voice',
      roomId: asString(data.roomId),
      callActionToken: asString(data.callActionToken),
      callActionUrl: asString(data.callActionUrl),
      apiBaseUrl: asString(data.apiBaseUrl),
      sentAt: asString(data.sentAt),
    };
  }

  function notificationTitle(call) {
    return `${call.callerName || 'Someone'} is calling`;
  }

  function notificationBody(call) {
    return call.type === 'video' ? 'Incoming video call' : 'Incoming voice call';
  }

  function showIncomingCallNotification(rawData) {
    const call = normalizeCallData(rawData);
    if (!call.callId) return Promise.resolve();

    return self.registration.showNotification(notificationTitle(call), {
      body: notificationBody(call),
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      timestamp: Date.now(),
      vibrate: [250, 100, 250, 100, 250],
      silent: false,
      requireInteraction: true,
      renotify: true,
      tag: `incoming-call-${call.callId}`,
      data: call,
      actions: [
        { action: 'accept', title: 'Receive' },
        { action: 'decline', title: 'Reject' },
      ],
    });
  }

  function showMissedCallNotification(rawData) {
    const call = normalizeCallData(rawData);
    if (!call.callId) return Promise.resolve();

    return self.registration.showNotification(`Missed call from ${call.callerName || 'Someone'}`, {
      body: call.type === 'video' ? 'You missed a video call' : 'You missed a voice call',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      timestamp: Date.now(),
      vibrate: [160, 80, 160],
      silent: false,
      requireInteraction: false,
      renotify: true,
      tag: `incoming-call-${call.callId}`,
      data: { ...call, kind: 'missed_call' },
    });
  }

  function buildLaunchUrl(action, call) {
    const params = new URLSearchParams({
      incomingCall: '1',
      callAction: action || 'open',
      action: action || 'open',
      callId: call.callId,
      callerId: call.callerId,
      callerName: call.callerName,
      callerAvatar: call.callerAvatar,
      type: call.type,
      roomId: call.roomId,
    });
    return new URL(`/messages?${params.toString()}`, self.location.origin).href;
  }

  function sameOriginClient(client) {
    try {
      return new URL(client.url).origin === self.location.origin;
    } catch (_) {
      return false;
    }
  }

  async function notifyOpenClients(action, call) {
    const clientList = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });

    for (const client of clientList) {
      if (!sameOriginClient(client)) continue;
      try {
        client.postMessage({
          type: 'TOLET_INCOMING_CALL_NOTIFICATION_CLICK',
          action,
          call,
        });
      } catch (_) {
        // Ignore clients that cannot receive the message.
      }
    }

    return clientList.filter(sameOriginClient);
  }

  async function focusOrOpenApp(action, call) {
    const url = buildLaunchUrl(action, call);
    const clients = await notifyOpenClients(action, call);

    for (const client of clients) {
      if ('navigate' in client) {
        try {
          await client.navigate(url);
        } catch (_) {
          // Focus the current URL if navigation is not available.
        }
      }
      if ('focus' in client) return client.focus();
    }

    if (self.clients.openWindow) return self.clients.openWindow(url);
    return undefined;
  }

  function declineUrlFor(call) {
    if (call.callActionUrl) return call.callActionUrl;
    if (call.apiBaseUrl) return `${call.apiBaseUrl.replace(/\/$/, '')}/calls/push-action`;
    return FALLBACK_CALL_ACTION_URL;
  }

  async function declineFromNotification(call) {
    await notifyOpenClients('decline', call);

    if (!call.callActionToken || !call.callId) return;

    try {
      await fetch(declineUrlFor(call), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'decline',
          callId: call.callId,
          token: call.callActionToken,
        }),
      });
    } catch (err) {
      console.warn('[call-sw] decline action failed:', err && err.message);
    }
  }

  function initFirebaseMessaging() {
    try {
      if (!self.firebase) {
        importScripts(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app-compat.js`);
        importScripts(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-messaging-compat.js`);
      }

      if (!self.firebase || !firebase.messaging) return;
      if (!firebase.apps || firebase.apps.length === 0) {
        firebase.initializeApp(FIREBASE_CONFIG);
      }

      const messaging = firebase.messaging();
      messaging.onBackgroundMessage((payload) => {
        const data = (payload && payload.data) || {};
        if (payload && payload.notification && isCallData(data)) {
          console.log('[call-sw] browser-displayed call push received:', data.callId);
          return Promise.resolve();
        }
        if (isMissedCallData(data)) {
          console.log('[call-sw] missed call push received:', data.callId);
          return showMissedCallNotification(data);
        }
        if (!isIncomingCallData(data)) return Promise.resolve();
        console.log('[call-sw] incoming call push received:', data.callId);
        return showIncomingCallNotification(data);
      });
    } catch (err) {
      console.warn('[call-sw] Firebase Messaging init failed:', err && err.message);
    }
  }

  self.addEventListener('notificationclick', (event) => {
    const call = normalizeCallData(event.notification && event.notification.data);
    if (!isCallData(call)) return;

    event.notification.close();

    if (isMissedCallData(event.notification && event.notification.data)) {
      event.waitUntil(focusOrOpenApp('missed', call));
      return;
    }

    const action = event.action || 'open';
    if (action === 'decline') {
      event.waitUntil(declineFromNotification(call));
      return;
    }

    event.waitUntil(focusOrOpenApp(action === 'accept' ? 'accept' : 'open', call));
  });

  self.toletShowIncomingCallNotification = showIncomingCallNotification;
  initFirebaseMessaging();
})();
