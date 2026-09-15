'use strict';

const crypto = require('crypto');
const firebaseAdmin = require('./firebaseAdmin');
const Challenge = require('../models/FirebasePhoneChallenge');
const { mobileCountryOf } = require('../utils/phoneCountries');
const ApiError = require('../utils/ApiError');

const CHALLENGE_TTL_MS = 10 * 60_000;
const MAX_PROOF_AGE_SECONDS = 5 * 60;
const GENERIC_ERROR = 'ফোন যাচাইয়ের সময় শেষ হয়েছে বা তথ্য সঠিক নয়। নতুন OTP নিয়ে আবার চেষ্টা করুন।';

function invalidProof() {
  return ApiError.unauthorized(GENERIC_ERROR, { code: 'firebase_phone_verification_failed' });
}

function getAuth() {
  // Emulator tokens are unsigned. Production must never trust them even if a
  // deployment accidentally carries a developer's emulator environment.
  if (process.env.NODE_ENV === 'production' && process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw ApiError.internal('ফোন যাচাই সঠিকভাবে কনফিগার করা নেই।', { code: 'firebase_auth_not_configured' });
  }
  const app = firebaseAdmin.init();
  if (!app) {
    throw ApiError.internal('ফোন যাচাই এখন চালু নেই। কিছুক্ষণ পরে চেষ্টা করুন।', { code: 'firebase_auth_not_configured' });
  }
  return app.auth();
}

function assertSupportedPhone(phone) {
  if (!mobileCountryOf(phone)) {
    throw ApiError.badRequest('তালিকার কোনো দেশের মোবাইল নম্বর দিন।', { code: 'phone_country_not_supported' });
  }
}

async function createChallenge({ phone, purpose, signup }) {
  assertSupportedPhone(phone);
  getAuth();
  // Wait for the unique replay-protection index on a freshly deployed model.
  await Challenge.init();
  const now = new Date();
  const challenge = await Challenge.create({
    _id: crypto.randomBytes(32).toString('hex'),
    phone,
    purpose,
    signup,
    createdAt: now,
    expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
    purgeAt: new Date(now.getTime() + 30 * 60_000),
  });
  return { provider: 'firebase', verificationId: challenge._id, expiresAt: challenge.expiresAt };
}

async function consumeChallenge({ phoneNumber, firebaseIdToken, verificationId, purpose }) {
  assertSupportedPhone(phoneNumber);
  const now = new Date();
  const filter = {
    _id: verificationId,
    phone: phoneNumber,
    purpose,
    consumedAt: null,
    expiresAt: { $gt: now },
  };
  const challenge = await Challenge.findOne(filter);
  if (!challenge) throw invalidProof();

  const auth = getAuth();
  let decoded;
  try {
    // Checks signature, project audience/issuer, expiry, disabled user and
    // revocation. Never decode an unverified JWT or trust a client phone claim.
    decoded = await auth.verifyIdToken(firebaseIdToken, true);
  } catch (_err) {
    throw invalidProof();
  }

  const nowSeconds = Math.floor(now.getTime() / 1000);
  const authTime = decoded.auth_time;
  if (
    decoded.firebase?.sign_in_provider !== 'phone' ||
    decoded.phone_number !== phoneNumber ||
    typeof decoded.uid !== 'string' || !decoded.uid ||
    !Number.isInteger(authTime) ||
    // Firebase timestamps use whole seconds; accept a sign-in in the same
    // second as preflight, but never an earlier login refreshed into a new JWT.
    authTime < Math.floor(challenge.createdAt.getTime() / 1000) ||
    nowSeconds - authTime > MAX_PROOF_AGE_SECONDS ||
    authTime > nowSeconds + 60
  ) throw invalidProof();

  const proofKey = crypto.createHash('sha256')
    .update(`${decoded.uid}:${authTime}`).digest('hex');
  let consumed;
  try {
    // Atomic claim prevents simultaneous double redemption. The unique key
    // also rejects this authentication event on a different challenge.
    consumed = await Challenge.findOneAndUpdate(filter, {
      $set: { consumedAt: now, proofKey },
    }, { new: true });
  } catch (err) {
    if (err.code === 11000) throw invalidProof();
    throw err;
  }
  if (!consumed) throw invalidProof();
  return consumed;
}

module.exports = { getAuth, createChallenge, consumeChallenge };
