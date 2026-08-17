'use strict';

// NOTE: Firebase is NO LONGER used for authentication. Phone OTP (signup +
// password reset) has been migrated to sms.net.bd (see services/sms.service.js
// and services/auth.service.js). This module now exists SOLELY to deliver FCM
// push notifications (sendToUser), used by chat.service.js and
// notification.service.js. Do not reintroduce ID-token verification here.
const admin = require('firebase-admin');
const env = require('../config/env');

let app = null;

function init() {
  if (app) return app;
  if (!env.firebaseServiceAccountBase64) {
    console.warn(
      '[firebase-admin] FIREBASE_SERVICE_ACCOUNT_BASE64 is not set. ' +
        'FCM push notifications (chat + in-app alerts) will be disabled. ' +
        'Auth (OTP) is unaffected — it uses sms.net.bd.'
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
  app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
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
 * @param {string|ObjectId} userId
 * @param {{ title?: string, body?: string, data?: object }} payload
 * @returns {Promise<{ sent: number, failed: number, pruned: number, tokens: number,
 *                     skipped?: boolean, reason?: 'not_configured'|'no_token'|'error' }>}
 */
async function sendToUser(userId, { title = '', body = '', data = {} } = {}) {
  const base = { sent: 0, failed: 0, pruned: 0, tokens: 0 };
  try {
    const a = init();
    if (!a) return { ...base, skipped: true, reason: 'not_configured' };
    if (!userId) return { ...base, skipped: true, reason: 'no_token' };

    // Lazy require avoids any model/boot-order coupling.
    const User = require('../models/User');
    const user = await User.findById(userId).select('deviceTokens').lean();
    const tokens = (user?.deviceTokens || []).map((d) => d && d.token).filter(Boolean);
    if (tokens.length === 0) return { ...base, skipped: true, reason: 'no_token' };
    base.tokens = tokens.length;

    // FCM `data` must be a flat map of string → string.
    const stringData = {};
    for (const [k, v] of Object.entries(data || {})) {
      if (v === undefined || v === null) continue;
      stringData[k] = typeof v === 'string'
        ? v
        : (typeof v === 'object' ? JSON.stringify(v) : String(v));
    }

    const message = {
      tokens,
      notification: { title: title || '', body: body || '' },
      data: stringData,
      android: { priority: 'high' },
      webpush: { headers: { Urgency: 'high' } },
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
    };
  } catch (err) {
    console.warn('[firebase-admin] sendToUser failed:', err.message);
    return { ...base, reason: 'error', error: err.message };
  }
}

module.exports = { init, sendToUser };