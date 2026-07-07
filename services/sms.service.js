'use strict';

const axios = require('axios');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

// sms.net.bd send endpoint. Docs / API portal: https://www.sms.net.bd/api
const SMS_SEND_URL = 'https://api.sms.net.bd/sendsms';

/**
 * Normalise a phone number for the sms.net.bd gateway.
 *
 * Our app stores numbers in E.164 (e.g. "+8801712345678"). The gateway
 * expects the international form WITHOUT the leading "+", so we strip it
 * (and any stray whitespace). "+8801712345678" -> "8801712345678".
 */
function normalizeMsisdn(phone) {
  return String(phone || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/^\+/, '');
}

/**
 * Low-level SMS send. POSTs form-urlencoded params to sms.net.bd.
 *
 * Success is signalled by `error === 0` in the JSON response
 * ({ error, msg, data: { request_id } }). Any transport failure or a
 * non-zero `error` throws an ApiError so the caller can react.
 *
 * @param {string} to  recipient phone (E.164 or local — normalised here)
 * @param {string} msg message body
 * @returns {Promise<{ requestId: (number|null), raw: object }>}
 */
async function sendSms(to, msg) {
  if (!env.smsApiKey) {
    // Misconfiguration — fail loudly rather than emit a confusing gateway error.
    throw ApiError.internal('SMS সার্ভিস কনফিগার করা হয়নি (SMS_API_KEY missing)।', {
      code: 'sms_not_configured',
    });
  }

  const body = new URLSearchParams({
    api_key: env.smsApiKey,
    msg,
    to: normalizeMsisdn(to),
  });

  let data;
  try {
    const resp = await axios.post(SMS_SEND_URL, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15_000,
    });
    data = resp.data;
  } catch (err) {
    // Network error, timeout, or non-2xx HTTP status from the gateway.
    throw ApiError.internal('OTP পাঠানো যায়নি। কিছুক্ষণ পর আবার চেষ্টা করুন।', {
      code: 'sms_send_failed',
      details: err.response?.data || err.message,
    });
  }

  // sms.net.bd: { error: 0, msg: 'Request successfully submitted', data: { request_id } }
  // Non-zero `error` = message NOT accepted (e.g. 417 insufficient balance,
  // 413 invalid sender id, 416 no valid recipient, ...).
  if (!data || Number(data.error) !== 0) {
    // Log the REAL gateway reason for ops (e.g. insufficient balance, or
    // "registered number only" on an unverified account) — but do NOT leak
    // billing/account details to end users; they get a clean retry message.
    console.error('[sms] gateway rejected send:', { error: data?.error, msg: data?.msg });
    throw ApiError.internal('OTP পাঠানো যায়নি। একটু পরে আবার চেষ্টা করুন।', {
      code: 'sms_rejected',
      details: data,
    });
  }

  return { requestId: data?.data?.request_id ?? null, raw: data };
}

/**
 * Sends a Tolet Pro OTP code. Single source of truth for the message
 * template so signup + forgot-password stay consistent.
 *
 * @param {string} to  recipient phone
 * @param {string} otp 6-digit code
 */
async function sendOtp(to, otp) {
  const msg = `Your Tolet Pro OTP Code is ${otp}`;
  return sendSms(to, msg);
}

module.exports = { sendSms, sendOtp, normalizeMsisdn };
