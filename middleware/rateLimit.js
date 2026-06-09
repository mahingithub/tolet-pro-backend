'use strict';

const rateLimit = require('express-rate-limit');

/**
 * Generic rate limiter factory. Keys by IP. For phone-scoped limiting we
 * compose with a custom `keyGenerator` per route.
 */
function make({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message },
  });
}

// 5 OTP-send requests per phone per 10 minutes (defense in depth — Firebase
// already throttles SMS at their layer; this guards our own endpoints).
const sendOtp = make({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: 'অনেক বার OTP চেয়েছেন। ১০ মিনিট পরে আবার চেষ্টা করুন।',
});

// 10 login attempts per IP per 15 minutes. Account-level lockout lives in
// auth.service.js (loginAttempts / lockUntil).
const login = make({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'অনেক বেশি লগইন চেষ্টা। কিছুক্ষণ অপেক্ষা করুন।',
});

const signup = make({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'অনেক বেশি সাইনআপ চেষ্টা। কিছুক্ষণ পর চেষ্টা করুন।',
});

const reset = make({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'অনেক বেশি অনুরোধ। কিছুক্ষণ পর চেষ্টা করুন।',
});

module.exports = { sendOtp, login, signup, reset };
