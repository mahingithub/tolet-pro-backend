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

module.exports = { init, verifyIdToken };
