'use strict';

const OtpAttempt = require('../models/OtpAttempt');
const ApiError = require('../utils/ApiError');

/**
 * OTP Abuse Protection Service
 * ═══════════════════════════════════════════════════════════════════════════
 * Multi-dimensional abuse detection and enforcement for OTP operations.
 * 
 * THRESHOLDS (per 10-minute window):
 * - Warning: 3 requests
 * - Delay: 5 requests (add 2-second delay)
 * - CAPTCHA: 7 requests (require CAPTCHA verification)
 * - Block: 10 requests (hard block for 30 minutes)
 * 
 * DIMENSIONS TRACKED:
 * 1. IP Address - primary defense
 * 2. Phone Number - victim protection
 * 3. Device Fingerprint - sophisticated attack detection
 * 
 * PROGRESSIVE ENFORCEMENT:
 * Level 0 (none) → Level 1 (warning) → Level 2 (delay) → Level 3 (CAPTCHA) → Level 4 (blocked)
 * ═══════════════════════════════════════════════════════════════════════════
 */

// Thresholds for enforcement escalation
const THRESHOLDS = {
  WARNING: 3,
  DELAY: 5,
  CAPTCHA: 7,
  BLOCK: 10,
};

// Cooldown periods (milliseconds)
const COOLDOWNS = {
  DELAY: 2000,        // 2 seconds
  CAPTCHA: 5000,      // 5 seconds
  BLOCK: 30 * 60 * 1000, // 30 minutes
};

// Window for attempt counting (milliseconds)
const ATTEMPT_WINDOW = 10 * 60 * 1000; // 10 minutes

/**
 * Generate a device fingerprint from request headers
 * Not cryptographically secure, but good enough for tracking
 */
function generateDeviceFingerprint(req) {
  const ua = req.headers['user-agent'] || '';
  const lang = req.headers['accept-language'] || '';
  const encoding = req.headers['accept-encoding'] || '';
  
  // Simple hash (good enough for grouping, not security)
  const parts = [ua, lang, encoding].join('|');
  let hash = 0;
  for (let i = 0; i < parts.length; i++) {
    const char = parts.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(36);
}

/**
 * Check if request should be allowed, delayed, CAPTCHA-challenged, or blocked
 * 
 * @param {Object} params
 * @param {string} params.phoneNumber - Target phone number
 * @param {string} params.ipAddress - Requester IP
 * @param {Object} params.req - Express request object
 * @param {string} [params.captchaToken] - Optional CAPTCHA verification token
 * @returns {Object} { allowed, enforcementLevel, requiresCaptcha, delayMs, message }
 */
async function checkOtpRequest({ phoneNumber, ipAddress, req, captchaToken }) {
  const deviceFingerprint = generateDeviceFingerprint(req);
  const now = new Date();
  const windowStart = new Date(now - ATTEMPT_WINDOW);
  
  // ═══ FIND OR CREATE TRACKING RECORD ═══════════════════════════════════════
  
  let attempt = await OtpAttempt.findOne({
    ipAddress,
    phoneNumber,
    createdAt: { $gte: windowStart },
  });
  
  if (!attempt) {
    // First request in window - create new tracking record
    attempt = new OtpAttempt({
      ipAddress,
      phoneNumber,
      deviceFingerprint,
      requestCount: 0,
      metadata: {
        userAgent: req.headers['user-agent']?.slice(0, 500),
        // TODO: Add GeoIP lookup for country/city
      },
    });
  }
  
  // ═══ CHECK FOR ACTIVE BLOCKS ═══════════════════════════════════════════════
  
  if (attempt.blockedUntil && attempt.blockedUntil > now) {
    const minutesLeft = Math.ceil((attempt.blockedUntil - now) / 60000);
    throw ApiError.tooMany(
      `অনেক বেশি চেষ্টা। ${minutesLeft} মিনিট পরে আবার চেষ্টা করুন।`,
      {
        code: 'otp_blocked',
        blockedUntil: attempt.blockedUntil,
        enforcementLevel: 'blocked',
      }
    );
  }
  
  // ═══ VERIFY CAPTCHA IF REQUIRED ════════════════════════════════════════════
  
  if (attempt.requiresCaptcha && !captchaToken) {
    throw ApiError.badRequest('CAPTCHA যাচাই প্রয়োজন।', {
      code: 'captcha_required',
      enforcementLevel: 'captcha',
    });
  }
  
  if (attempt.requiresCaptcha && captchaToken) {
    const captchaValid = await verifyCaptcha(captchaToken, ipAddress);
    if (!captchaValid) {
      throw ApiError.badRequest('CAPTCHA যাচাই ব্যর্থ হয়েছে।', {
        code: 'captcha_invalid',
      });
    }
    // CAPTCHA passed - reset enforcement level
    attempt.enforcementLevel = 'none';
    attempt.requiresCaptcha = false;
    attempt.requestCount = 0;
  }
  
  // ═══ INCREMENT COUNTER AND DETERMINE ENFORCEMENT ═══════════════════════════
  
  attempt.requestCount += 1;
  attempt.lastRequestAt = now;
  
  let enforcementLevel = 'none';
  let delayMs = 0;
  let requiresCaptcha = false;
  let message = null;
  
  if (attempt.requestCount >= THRESHOLDS.BLOCK) {
    // LEVEL 4: HARD BLOCK
    enforcementLevel = 'blocked';
    attempt.enforcementLevel = 'blocked';
    attempt.blockedUntil = new Date(now.getTime() + COOLDOWNS.BLOCK);
    attempt.flaggedForReview = true;
    attempt.abusePattern = detectAbusePattern(attempt);
    await attempt.save();
    
    throw ApiError.tooMany(
      'অনেক বেশি চেষ্টা। ৩০ মিনিট পরে আবার চেষ্টা করুন।',
      {
        code: 'otp_blocked',
        blockedUntil: attempt.blockedUntil,
        enforcementLevel: 'blocked',
      }
    );
    
  } else if (attempt.requestCount >= THRESHOLDS.CAPTCHA) {
    // LEVEL 3: REQUIRE CAPTCHA
    enforcementLevel = 'captcha';
    requiresCaptcha = true;
    delayMs = COOLDOWNS.CAPTCHA;
    message = 'CAPTCHA যাচাই প্রয়োজন।';
    attempt.enforcementLevel = 'captcha';
    attempt.requiresCaptcha = true;
    
  } else if (attempt.requestCount >= THRESHOLDS.DELAY) {
    // LEVEL 2: ADD DELAY
    enforcementLevel = 'delay';
    delayMs = COOLDOWNS.DELAY;
    message = 'একটু অপেক্ষা করুন...';
    attempt.enforcementLevel = 'delay';
    
  } else if (attempt.requestCount >= THRESHOLDS.WARNING) {
    // LEVEL 1: WARNING
    enforcementLevel = 'warning';
    message = 'অনেক বার OTP চেয়েছেন।';
    attempt.enforcementLevel = 'warning';
  }
  
  // ═══ CROSS-DIMENSIONAL ABUSE DETECTION ═════════════════════════════════════
  
  // Check if same IP is targeting multiple phones (phone enumeration)
  const sameIpCount = await OtpAttempt.countDocuments({
    ipAddress,
    createdAt: { $gte: windowStart },
  });
  
  if (sameIpCount > 5) {
    attempt.abusePattern = 'phone_enumeration';
    attempt.flaggedForReview = true;
  }
  
  // Check if same phone is being hit from multiple IPs (SMS bombing)
  const samePhoneCount = await OtpAttempt.countDocuments({
    phoneNumber,
    createdAt: { $gte: windowStart },
  });
  
  if (samePhoneCount > 10) {
    attempt.abusePattern = 'sms_bombing';
    attempt.flaggedForReview = true;
  }
  
  // Check if same device is rotating IPs (distributed attack)
  if (deviceFingerprint) {
    const sameDeviceCount = await OtpAttempt.countDocuments({
      deviceFingerprint,
      createdAt: { $gte: windowStart },
    });
    
    if (sameDeviceCount > 8) {
      attempt.abusePattern = 'distributed_attack';
      attempt.flaggedForReview = true;
    }
  }
  
  await attempt.save();
  
  // ═══ RETURN ENFORCEMENT DECISION ═══════════════════════════════════════════
  
  return {
    allowed: true,
    enforcementLevel,
    requiresCaptcha,
    delayMs,
    message,
    remainingAttempts: Math.max(0, THRESHOLDS.BLOCK - attempt.requestCount),
  };
}

/**
 * Record a failed OTP verification attempt
 */
async function recordFailedVerification({ phoneNumber, ipAddress }) {
  const windowStart = new Date(Date.now() - ATTEMPT_WINDOW);
  
  const attempt = await OtpAttempt.findOne({
    ipAddress,
    phoneNumber,
    createdAt: { $gte: windowStart },
  });
  
  if (attempt) {
    attempt.failedVerifications += 1;
    
    // Too many failed verifications → trigger CAPTCHA
    if (attempt.failedVerifications >= 3) {
      attempt.requiresCaptcha = true;
      attempt.enforcementLevel = 'captcha';
    }
    
    await attempt.save();
  }
}

/**
 * Detect abuse pattern based on attempt characteristics
 */
function detectAbusePattern(attempt) {
  const { requestCount, failedVerifications } = attempt;
  
  // Rapid-fire requests with few failures → automated script
  if (requestCount > 8 && failedVerifications < 2) {
    return 'rapid_fire';
  }
  
  // Default pattern
  return attempt.abusePattern || null;
}

/**
 * Verify CAPTCHA token (placeholder for actual implementation)
 * 
 * IMPLEMENTATION OPTIONS:
 * 1. Google reCAPTCHA v2/v3
 * 2. hCaptcha
 * 3. Cloudflare Turnstile
 * 4. Custom challenge-response
 * 
 * For now, returns true if token is provided (integrate real verification later)
 */
async function verifyCaptcha(token, ipAddress) {
  // TODO: Implement actual CAPTCHA verification
  // Example with Google reCAPTCHA:
  // const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
  //   method: 'POST',
  //   body: `secret=${RECAPTCHA_SECRET}&response=${token}&remoteip=${ipAddress}`,
  //   headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  // });
  // const result = await response.json();
  // return result.success;
  
  // Placeholder: accept any non-empty token
  return !!token && token.length > 10;
}

/**
 * Get abuse statistics for monitoring dashboard
 */
async function getAbuseStats(since = new Date(Date.now() - 24 * 60 * 60 * 1000)) {
  const [totalAttempts, flaggedAttempts, blockedIps, patterns] = await Promise.all([
    OtpAttempt.countDocuments({ createdAt: { $gte: since } }),
    OtpAttempt.countDocuments({ flaggedForReview: true, createdAt: { $gte: since } }),
    OtpAttempt.countDocuments({ enforcementLevel: 'blocked', createdAt: { $gte: since } }),
    OtpAttempt.aggregate([
      { $match: { abusePattern: { $ne: null }, createdAt: { $gte: since } } },
      { $group: { _id: '$abusePattern', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ]);
  
  return {
    totalAttempts,
    flaggedAttempts,
    blockedIps,
    patterns: patterns.reduce((acc, p) => {
      acc[p._id] = p.count;
      return acc;
    }, {}),
  };
}

module.exports = {
  checkOtpRequest,
  recordFailedVerification,
  getAbuseStats,
  THRESHOLDS,
  COOLDOWNS,
};
