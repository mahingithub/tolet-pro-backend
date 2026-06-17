'use strict';

const admin = require('firebase-admin');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

let app = null;

function init() {
  if (app) return app;
  if (!env.firebaseServiceAccountBase64) {
    console.warn(
      '[firebase-admin] FIREBASE_SERVICE_ACCOUNT_BASE64 is not set. ' +
        'Signup OTP verification + forgot-password OTP verification will fail. ' +
        'See .env.example for setup steps.'
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
 * Verifies a Firebase ID token from the client (returned by signInWithPhoneNumber
 * after the user enters the OTP). Throws an ApiError if invalid.
 *
 * @param {string} idToken
 * @returns {Promise<{ uid: string, phone: string }>}
 */
async function verifyIdToken(idToken) {
  const a = init();
  if (!a) {
    throw ApiError.internal('OTP যাচাই সম্ভব হয়নি। সার্ভার কনফিগারেশনে সমস্যা।');
  }
  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken, /* checkRevoked */ true);
  } catch (err) {
    throw ApiError.unauthorized('OTP যাচাইকরণ ব্যর্থ হয়েছে। আবার চেষ্টা করুন।', {
      code: 'firebase_id_token_invalid',
      details: err.code || err.message,
    });
  }
  if (env.firebaseProjectId && decoded.aud !== env.firebaseProjectId) {
    throw ApiError.unauthorized('OTP যাচাইকরণ ব্যর্থ হয়েছে।', { code: 'firebase_wrong_project' });
  }
  const phone = decoded.phone_number;
  if (!phone) {
    throw ApiError.unauthorized('Firebase টোকেনে ফোন নম্বর পাওয়া যায়নি।', {
      code: 'firebase_no_phone',
    });
  }
  return { uid: decoded.uid, phone };
}

/**
 * Sends a push notification to ALL of a user's registered FCM device tokens.
 * Fire-and-forget by contract: NEVER throws — a push failure must not break
 * the caller (creating an inquiry, sending a receipt, etc.). Dead/invalid
 * tokens are pruned from the user automatically (matches the call-flow behaviour).
 *
 * Requires FIREBASE_SERVICE_ACCOUNT_BASE64 (already set for OTP). No-op if absent.
 *
 * @param {string|ObjectId} userId
 * @param {{ title?: string, body?: string, data?: object }} payload
 * @returns {Promise<{ sent: number, pruned: number }>}
 */
async function sendToUser(userId, { title = '', body = '', data = {} } = {}) {
  try {
    const a = init();
    if (!a || !userId) return { sent: 0, pruned: 0 };

    // Lazy require avoids any model/boot-order coupling.
    const User = require('../models/User');
    const user = await User.findById(userId).select('deviceTokens').lean();
    const tokens = (user?.deviceTokens || []).map((d) => d && d.token).filter(Boolean);
    if (tokens.length === 0) return { sent: 0, pruned: 0 };

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

    return { sent: resp.successCount, pruned };
  } catch (err) {
    console.warn('[firebase-admin] sendToUser failed:', err.message);
    return { sent: 0, pruned: 0 };
  }
}

module.exports = { init, verifyIdToken, sendToUser };