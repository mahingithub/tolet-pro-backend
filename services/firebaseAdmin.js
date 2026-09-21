'use strict';

// Shared trusted Firebase project for Phone Authentication and FCM delivery.
// Phone token validation lives in firebasePhoneAuth.service.js.
const admin = require('firebase-admin');
const env = require('../config/env');

let app = null;

function init() {
  if (app) return app;
  if (!env.firebaseServiceAccountBase64) {
    console.warn(
      '[firebase-admin] FIREBASE_SERVICE_ACCOUNT_BASE64 is not set. ' +
        'Firebase phone sign-in and FCM push notifications are unavailable.'
    );
    return null;
  }
  let serviceAccount;
  try {
    const json = Buffer.from(env.firebaseServiceAccountBase64, 'base64').toString('utf8');
    serviceAccount = JSON.parse(json);
  } catch (err) {
    console.error('[firebase-admin] FIREBASE_SERVICE_ACCOUNT_BASE64 is not valid base64-JSON:', err.message);
    process.exit(1);
  }
  if (env.firebaseProjectId && serviceAccount.project_id !== env.firebaseProjectId) {
    throw new Error('Firebase service account project does not match FIREBASE_PROJECT_ID.');
  }
  app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: env.firebaseProjectId || serviceAccount.project_id,
  });
  return app;
}

/**
 * Sends a push notification to ALL of a user's registered FCM device tokens.
 * Fire-and-forget by contract: NEVER throws — a push failure must not break
 * the caller (creating an inquiry, sending a receipt, etc.). Dead/invalid
 * tokens are pruned from the user automatically (matches the call-flow behaviour).
 *
 * Requires FIREBASE_SERVICE_ACCOUNT_BASE64 (already set for OTP). No-op if absent.
 *
 * Because this never throws, a rejected promise tells the caller nothing — the
 * outcome lives entirely in the return value. `sent: 0` alone is ambiguous, so
 * `skipped`/`reason` say WHY nothing went out: FCM isn't configured in this
 * environment, or the user simply has no registered device. Callers that report
 * delivery to a human (the admin marketing console) need that distinction;
 * without it an unconfigured gateway is indistinguishable from a successful send.
 *
 * `type` is the Notification type. It is what selects the Android channel and
 * what the user's per-topic switches are checked against (services/notifyPolicy
 * .js). Omitting it still delivers, on the default channel with only the push
 * master switch applied — the safe direction to fail in, but pass it.
 *
 * `bypassPolicy` exists for the ONE case that must not consult preferences: a
 * ringing call, which the user governs through `preferences.callNotifications`
 * on its own path and which is worthless if it arrives silently.
 *
 * @param {string|ObjectId} userId
 * @param {{ title?: string, body?: string, data?: object, type?: string,
 *           collapseKey?: string, bypassPolicy?: boolean }} payload
 * `silent` on the result means the push WAS delivered but on the low-importance
 * quiet channel (the user's DND window) — no sound, no banner, shade only. It is
 * a successful send that the recipient will not notice until they look, which is
 * a distinction any caller reporting delivery to a human has to make.
 *
 * @returns {Promise<{ sent: number, failed: number, pruned: number, tokens: number,
 *                     silent?: boolean, policyReason?: string,
 *                     skipped?: boolean, reason?: 'not_configured'|'no_token'|'error'|string }>}
 */
async function sendToUser(
  userId,
  { title = '', body = '', data = {}, type = '', collapseKey = '', image = '', bypassPolicy = false } = {},
) {
  const base = { sent: 0, failed: 0, pruned: 0, tokens: 0 };
  try {
    const a = init();
    if (!a) return { ...base, skipped: true, reason: 'not_configured' };
    if (!userId) return { ...base, skipped: true, reason: 'no_token' };

    // Lazy require avoids any model/boot-order coupling.
    const User = require('../models/User');
    // `preferences` rides along on the lookup this function already performs.
    // Deciding policy here rather than in the caller is what keeps honouring
    // the user's settings free: emit() would otherwise need its own round trip
    // to Atlas for every single notification.
    const user = await User.findById(userId).select('deviceTokens preferences').lean();
    const tokens = (user?.deviceTokens || []).map((d) => d && d.token).filter(Boolean);
    if (tokens.length === 0) return { ...base, skipped: true, reason: 'no_token' };
    base.tokens = tokens.length;

    const policy = bypassPolicy
      ? { push: true, channelId: 'toletpro_calls', silent: false }
      : require('./notifyPolicy').decide(user, type);

    // The user asked not to be pushed for this. The in-app row was already
    // written by emit(), so nothing is lost — it is waiting in the bell.
    if (!policy.push) {
      return { ...base, skipped: true, reason: policy.reason || 'muted' };
    }

    // FCM `data` must be a flat map of string → string.
    const stringData = {};
    for (const [k, v] of Object.entries(data || {})) {
      if (v === undefined || v === null) continue;
      stringData[k] = typeof v === 'string'
        ? v
        : (typeof v === 'object' ? JSON.stringify(v) : String(v));
    }

    // `type` travels in the data dict as well as governing the channel: it is
    // what the client's tap handler routes on (services/nativePush.js), and FCM
    // forwards only `data` to the app — the notification envelope above is
    // consumed by the OS.
    if (type && !stringData.type) stringData.type = String(type);

    // A poster on the notification, for the feature tour and any campaign that
    // wants one. HTTPS ONLY, and silently dropped otherwise: the image is
    // fetched by GOOGLE'S servers, not by the phone, so a plain-http or
    // unreachable URL fails somewhere we never see — the push still arrives,
    // just mysteriously without its picture. Refusing to attach a URL that
    // cannot work is the difference between "no image" and "no image, and no
    // idea why".
    const picture = /^https:\/\/\S+$/i.test(String(image || '')) ? String(image) : '';

    const message = {
      tokens,
      notification: {
        title: title || '',
        body: body || '',
        // Top level covers iOS and is the documented cross-platform field;
        // android.notification.imageUrl below is what Android actually reads.
        ...(picture ? { imageUrl: picture } : {}),
      },
      data: stringData,
      android: {
        // Kept for pre-Oreo devices, where priority still decides heads-up. On
        // Android 8+ it is the channel below that decides, which is why a
        // channelId the app has actually created is not optional.
        priority: policy.silent ? 'normal' : 'high',
        notification: {
          channelId: policy.channelId,
          // Replaces the previous notification about the same subject instead
          // of stacking a second one beside it. Twelve separate "rent is due"
          // entries for the same month is how a useful alert becomes noise the
          // user swipes away without reading.
          ...(collapseKey ? { tag: collapseKey } : {}),
          // The big picture Android shows when the notification is expanded.
          // Collapsed, it stays a normal one-line row — so a poster costs the
          // user nothing until they choose to look at it.
          ...(picture ? { imageUrl: picture } : {}),
        },
        ...(collapseKey ? { collapseKey } : {}),
      },
      webpush: {
        headers: {
          Urgency: policy.silent ? 'low' : 'high',
          // Web Push's own collapse mechanism. The spec constrains Topic to at
          // most 32 URL-safe-base64 characters, and a push service REJECTS the
          // whole request for a malformed one — so a key that doesn't qualify
          // is dropped rather than risking the delivery it was meant to tidy.
          ...(/^[A-Za-z0-9\-_]{1,32}$/.test(collapseKey) ? { Topic: collapseKey } : {}),
        },
      },
    };

    const resp = await admin.messaging().sendEachForMulticast(message);

    // Prune tokens FCM reports as permanently dead.
    const dead = [];
    resp.responses.forEach((r, i) => {
      if (r.success) return;
      const code = (r.error && r.error.code) || '';
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/invalid-argument'
      ) {
        dead.push(tokens[i]);
      }
    });

    let pruned = 0;
    if (dead.length) {
      await User.updateOne(
        { _id: userId },
        { $pull: { deviceTokens: { token: { $in: dead } } } },
      ).catch(() => {});
      pruned = dead.length;
    }

    return {
      ...base,
      sent: resp.successCount,
      failed: resp.failureCount,
      pruned,
      // DELIVERED, BUT ON THE SILENT CHANNEL. Inside a Do-Not-Disturb window
      // notifyPolicy routes the push to toletpro_quiet (IMPORTANCE_LOW), which
      // on Android means no sound, no vibration and no heads-up banner — it
      // appears in the shade and nowhere else, so the user sees it only if they
      // pull the shade down on their own.
      //
      // That is the correct behaviour and it is NOT a failure, but reporting it
      // as an ordinary `sent` is how "I sent 10 pushes and nobody heard
      // anything" becomes an unexplainable bug report. Callers that show
      // delivery to a human (the admin marketing console) render this
      // separately; everyone else can ignore it.
      silent: !!policy.silent,
      ...(policy.reason ? { policyReason: policy.reason } : {}),
    };
  } catch (err) {
    console.warn('[firebase-admin] sendToUser failed:', err.message);
    return { ...base, reason: 'error', error: err.message };
  }
}

/**
 * Push to ONE raw FCM token, with no user behind it.
 *
 * WHY THIS BYPASSES sendToUser
 * Everything else here starts from a userId: it loads the user to find their
 * tokens AND to read the preferences notifyPolicy decides on. A guest device
 * has neither. There is no account to look up, no marketingPush switch to
 * honour, and no quiet-hours window on file — so the caller has to supply the
 * channel itself and take responsibility for when it fires.
 *
 * That makes this function narrower than it looks, and it should stay that way:
 * the ONLY caller is the guest feature tour, which sends four notifications to
 * a device that has not signed up. Anything addressed to a real account must go
 * through sendToUser(), or it will silently ignore settings that user has set.
 *
 * Never throws, same contract as sendToUser. `dead: true` means FCM reported
 * the token as permanently invalid — the caller should stop using it (an
 * uninstall, or cleared app data).
 *
 * @returns {Promise<{sent:number, dead?:boolean, skipped?:boolean, reason?:string}>}
 */
async function sendToToken(token, { title = '', body = '', data = {}, channelId = '', image = '' } = {}) {
  try {
    const a = init();
    if (!a) return { sent: 0, skipped: true, reason: 'not_configured' };
    if (!token || typeof token !== 'string') return { sent: 0, skipped: true, reason: 'no_token' };

    const stringData = {};
    for (const [k, v] of Object.entries(data || {})) {
      if (v === undefined || v === null) continue;
      stringData[k] = typeof v === 'string'
        ? v
        : (typeof v === 'object' ? JSON.stringify(v) : String(v));
    }

    const picture = /^https:\/\/\S+$/i.test(String(image || '')) ? String(image) : '';

    await admin.messaging().send({
      token,
      notification: {
        title: title || '',
        body: body || '',
        ...(picture ? { imageUrl: picture } : {}),
      },
      data: stringData,
      android: {
        priority: 'high',
        notification: {
          ...(channelId ? { channelId } : {}),
          ...(picture ? { imageUrl: picture } : {}),
        },
      },
      webpush: { headers: { Urgency: 'high' } },
    });

    return { sent: 1 };
  } catch (err) {
    const code = err?.code || err?.errorInfo?.code || '';
    const dead =
      code === 'messaging/registration-token-not-registered' ||
      code === 'messaging/invalid-registration-token' ||
      code === 'messaging/invalid-argument';
    // Not warned for a dead token: an uninstall is routine churn, and logging
    // one line per departed device turns a normal sweep into a wall of noise.
    if (!dead) console.warn('[firebase-admin] sendToToken failed:', err?.message);
    return { sent: 0, dead, reason: dead ? 'dead_token' : 'error' };
  }
}

module.exports = { init, sendToUser, sendToToken };
