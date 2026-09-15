'use strict';

const mongoose = require('mongoose');

// A server-side intent for one Firebase phone verification — only numbers
// outside Bangladesh use Firebase (see auth.service otpChannel). Signup
// credentials are bound to this random id, so a second signup for the same
// phone cannot change the password/name that the first person is about to confirm.
const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  phone: { type: String, required: true },
  purpose: { type: String, enum: ['signup', 'reset'], required: true },
  signup: {
    name: String,
    passwordHash: String,
    role: { type: String, enum: ['tenant', 'landlord'] },
  },
  createdAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
  consumedAt: { type: Date, default: null },
  // Sparse unique index makes a Firebase authentication event one-use across
  // all challenges/purposes, even if its ID token is refreshed or requests race.
  proofKey: { type: String, unique: true, sparse: true },
  // Keep replay records longer than the maximum accepted proof age. Mongo's
  // TTL monitor is just cleanup; authorization checks expiresAt explicitly.
  purgeAt: { type: Date, required: true },
}, { versionKey: false });

schema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('FirebasePhoneChallenge', schema);
