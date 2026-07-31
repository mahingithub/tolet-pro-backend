'use strict';

/**
 * rateLimit.js — Endpoint-Specific Rate Limiting (Layer 3)
 * ═══════════════════════════════════════════════════════════════════════════
 * FINE-GRAINED PROTECTION FOR CRITICAL OPERATIONS
 * 
 * This file provides the MOST SPECIFIC rate limiting layer - per-endpoint
 * limits applied to individual high-risk operations like login, OTP, etc.
 * 
 * LAYERING WITH rateLimiters.js:
 * 1. Global limiter (rateLimiters.js) → ALL /api requests (DDoS protection)
 * 2. Category limiter (rateLimiters.js) → Auth routes (brute force protection)
 * 3. Endpoint limiter (THIS FILE) → Specific operation (targeted protection)
 * 
 * Example: POST /api/auth/login passes through:
 * - apiLimiter (300/min) → ensures server can handle the request
 * - authLimiter (20/15min) → prevents auth endpoint flooding
 * - login limiter (10/15min) → prevents login-specific brute force
 * 
 * All three run, all three must pass. Each catches different attack patterns.
 * 
 * WHY SEPARATE FILES:
 * - rateLimiters.js: Infrastructure/category protection (system-wide)
 * - This file: Business logic protection (operation-specific)
 * ═══════════════════════════════════════════════════════════════════════════
 */

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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * OTP ENDPOINTS — Most critical for abuse prevention
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * OTP requests cost money (SMS charges) and can be used for:
 * - SMS bombing attacks (harassment)
 * - Phone number enumeration
 * - Resource exhaustion
 * 
 * Defense layers:
 * 1. This IP-based limiter (below)
 * 2. Phone-based tracking (TODO: Task #4 - OTP abuse protection system)
 * 3. Device fingerprinting (TODO: Task #7 - Device tracking)
 * 4. CAPTCHA trigger after repeated abuse (TODO: Task #4)
 */

/**
 * 5 OTP-send requests per phone per 10 minutes.
 * 
 * Defense in depth — Firebase/SMS gateway already throttles at their layer;
 * this guards our own endpoints and prevents SMS cost attacks.
 * 
 * NOTE: Currently IP-based only. Task #4 will add phone + device tracking.
 */
const sendOtp = make({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5,
  message: 'অনেক বার OTP চেয়েছেন। ১০ মিনিট পরে আবার চেষ্টা করুন।',
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LOGIN ENDPOINTS — Credential stuffing prevention
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * 10 login attempts per IP per 15 minutes.
 * 
 * Works WITH:
 * - Account-level lockout (in auth.service.js: loginAttempts / lockUntil)
 * - Category authLimiter (20/15min across ALL auth endpoints)
 * 
 * All three protections run:
 * - This stops IP-based brute force
 * - Account lockout stops credential stuffing even across IPs
 * - Category limiter stops auth endpoint flooding
 */
const login = make({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: 'অনেক বেশি লগইন চেষ্টা। কিছুক্ষণ অপেক্ষা করুন।',
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SIGNUP ENDPOINTS — Account creation abuse prevention
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * 10 signup attempts per IP per hour.
 * 
 * Prevents:
 * - Mass account creation (spam, bot networks)
 * - Phone number enumeration
 * - OTP cost attacks via signup flow
 */
const signup = make({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: 'অনেক বেশি সাইনআপ চেষ্টা। কিছুক্ষণ পর চেষ্টা করুন।',
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PASSWORD RESET ENDPOINTS — Account takeover prevention
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * 10 password reset attempts per IP per 15 minutes.
 * 
 * Prevents:
 * - Account lockout attacks (DoS via password reset)
 * - Phone number enumeration via forgot-password
 * - OTP cost attacks via reset flow
 */
const reset = make({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: 'অনেক বেশি অনুরোধ। কিছুক্ষণ পর চেষ্টা করুন।',
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * REFRESH ENDPOINTS — Token rotation abuse prevention
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * 20 token refresh attempts per IP per 15 minutes.
 */
const refresh = make({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: 'অনেক বেশি রিফ্রেশ অনুরোধ। কিছুক্ষণ পর চেষ্টা করুন।',
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EXPORTS & USAGE
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Applied in routes/auth.routes.js:
 * - POST /signup/start    → signup + sendOtp
 * - POST /signup/verify   → signup
 * - POST /login           → login
 * - POST /forgot-password → sendOtp + reset
 * - POST /reset-password  → reset
 * 
 * Each combines with category authLimiter and global apiLimiter for defense
 * in depth.
 */
module.exports = { sendOtp, login, signup, reset, refresh };
