'use strict';

const OtpAttempt = require('../models/OtpAttempt');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');

/**
 * OTP Abuse Protection Service
 * ═══════════════════════════════════════════════════════════════════════════
 * Multi-dimensional abuse detection and enforcement for OTP operations.
 * 
 * THRESHOLDS (per 10-minute window, counted per IP+PHONE pair):
 * - Warning: 2
 * - Delay:   3  (2-second delay; 5 seconds once past the CAPTCHA mark)
 * - CAPTCHA: 4  (dormant unless OTP_CAPTCHA_ENABLED — see config/env.js)
 * - Block:   5  (hard block for 30 minutes)
 *
 * Counted against `pressure` = requests + failed verifications, so guessing at
 * codes escalates on the same ladder as asking for them.
 *
 * DIMENSIONS TRACKED:
 * 1. IP Address - primary defense
 * 2. Phone Number - victim protection
 * 3. Device Fingerprint - sophisticated attack detection
 *
 * PROGRESSIVE ENFORCEMENT:
 * Level 0 (none) → Level 1 (warning) → Level 2 (delay) → Level 3 (CAPTCHA) → Level 4 (blocked)
 *
 * ─── HOW THIS RELATES TO services/otpQuota.service.js ────────────────────────
 * That one caps OTP requests per PHONE NUMBER (5 per 15 minutes) and ignores
 * the requester entirely, because SMS bombing and the SMS bill are properties
 * of the number rather than of whoever asked. It is the harder limit and it
 * runs FIRST in both rental callers.
 *
 * The two are sized so that THIS ladder bites first. Every rung sits inside the
 * quota's budget of 5, so a single requester working one number meets the
 * graduated response — warn, slow, stop — and the quota only speaks when this
 * ladder structurally cannot: when the same victim is hit from many addresses
 * at once, which is exactly the case a per-(ip, phone) counter cannot see.
 *
 * They also measure different things, which is why both stay. This one counts
 * failed verifications as pressure; the quota counts only requests. This one
 * blocks a requester; the quota protects a number.
 *
 * ─── WHY THE IP AND DEVICE DIMENSIONS ONLY FLAG ──────────────────────────────
 * `sameIpCount` / `sameDeviceCount` below set `flaggedForReview` and never
 * refuse anything, and that restraint is deliberate — do not "finish" it into a
 * block. Mobile Bangladesh sits behind carrier-grade NAT: one address can front
 * an entire city. An IP seen requesting codes for a dozen different numbers in
 * ten minutes is the normal appearance of a busy carrier, not an attacker, and
 * blocking on it would take out every real user sharing that address.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Thresholds for enforcement escalation.
 *
 * ─── SIZED TO BITE BEFORE services/otpQuota.service.js ───────────────────────
 * These used to be 3 / 5 / 7 / 10, which put the top two rungs out of reach:
 * the per-phone quota caps a number at 5 requests per 15 minutes and runs
 * first, so nothing ever counted past 5 and both CAPTCHA and BLOCK were
 * decorative.
 *
 * The whole ladder now fits inside that budget, so a single requester hitting
 * one number meets the graduated response — warn, slow down, stop — instead of
 * sailing to the quota's flat refusal. The quota stays as the backstop it was
 * meant to be: it is keyed on the NUMBER and ignores the requester, so it still
 * catches what this ladder structurally cannot — the same victim being hit from
 * many addresses at once.
 *
 * The cost, stated so it is not discovered in a support message: a shopkeeper
 * in a bad-signal area now gets four codes rather than five before he is shut
 * out, and the shut-out is this ladder's 30 minutes rather than the quota's 15.
 * COOLDOWNS.BLOCK is the knob for that.
 */
const THRESHOLDS = {
  WARNING: 2,
  DELAY: 3,
  CAPTCHA: 4,
  BLOCK: 5,
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
    // `blockedUntil` is an absolute instant and depends on the caller's clock
    // being right; `retryAfterSeconds` is a duration and does not. It is also
    // what middleware/errorHandler.js reads to set the `Retry-After` header on
    // a 429, which is the form every generic HTTP client understands.
    const retryAfterSeconds = Math.max(1, Math.ceil((attempt.blockedUntil - now) / 1000));
    throw ApiError.tooMany(
      `অনেক বেশি চেষ্টা। ${minutesLeft} মিনিট পরে আবার চেষ্টা করুন।`,
      {
        code: 'otp_blocked',
        // UNDER `details`. ApiError's constructor destructures exactly
        // `{ code, details }` (utils/ApiError.js) and errorHandler forwards
        // exactly those two — anything passed as a sibling of `code` is
        // accepted without complaint and then never reaches the client. These
        // three throws had carried `blockedUntil` and `enforcementLevel` as
        // siblings since they were written, so the "enforcement status
        // returned to the client for UX adaptation" this file's header
        // promises has never actually left the building.
        details: {
          blockedUntil: attempt.blockedUntil,
          enforcementLevel: 'blocked',
          retryAfterSeconds,
        },
      }
    );
  }

  // ═══ COUNT FIRST, GATE AFTERWARDS ══════════════════════════════════════════
  //
  // The increment used to sit BELOW the CAPTCHA gate, and that single ordering
  // was what made the top of this ladder unreachable. Once `requiresCaptcha`
  // was set at seven, every later request threw on the way IN and never
  // counted, so `requestCount` froze three short of BLOCK and the hard block
  // was dead code — along with the active-block branch above, which reads a
  // `blockedUntil` that nothing was left to write.
  //
  // A refused request still has to count. Somebody being turned away is still
  // somebody knocking, and free retries are precisely what escalation exists to
  // take away. Everything below therefore persists the row before it throws.
  attempt.requestCount += 1;
  attempt.lastRequestAt = now;

  // Bad codes push on the SAME ladder as requests. Spraying OTP requests and
  // guessing at the codes they produce are one problem wearing two hats, and
  // scoring them apart let either one sit forever just under the other's
  // threshold. This is also what keeps `recordFailedVerification` meaningful
  // now that the tier is derived from a count rather than from a stored flag.
  const pressure = attempt.requestCount + (attempt.failedVerifications || 0);

  let enforcementLevel = 'none';
  let delayMs = 0;
  let requiresCaptcha = false;
  let message = null;

  // ─── LEVEL 4: HARD BLOCK ──────────────────────────────────────────────────
  if (pressure >= THRESHOLDS.BLOCK) {
    enforcementLevel = 'blocked';
    attempt.enforcementLevel = 'blocked';
    attempt.blockedUntil = new Date(now.getTime() + COOLDOWNS.BLOCK);
    // The challenge is moot once the door is shut; leaving it set would send
    // the next request to `captcha_required` instead of to the block.
    attempt.requiresCaptcha = false;
    attempt.flaggedForReview = true;
    attempt.abusePattern = detectAbusePattern(attempt);
    await attempt.save();

    throw ApiError.tooMany(
      'অনেক বেশি চেষ্টা। ৩০ মিনিট পরে আবার চেষ্টা করুন।',
      {
        code: 'otp_blocked',
        details: {
          blockedUntil: attempt.blockedUntil,
          enforcementLevel: 'blocked',
          retryAfterSeconds: COOLDOWNS.BLOCK / 1000,
        },
      }
    );
  }

  // ─── LEVEL 3: CAPTCHA ─────────────────────────────────────────────────────
  // Dormant unless OTP_CAPTCHA_ENABLED is on. Nothing in this repo can answer
  // a challenge yet — no frontend sends a token and `verifyCaptcha` is a stub —
  // so demanding one would be a wall rather than a rung. See config/env.js.
  if (pressure >= THRESHOLDS.CAPTCHA && env.otpCaptchaEnabled) {
    enforcementLevel = 'captcha';
    requiresCaptcha = true;
    delayMs = COOLDOWNS.CAPTCHA;
    message = 'CAPTCHA যাচাই প্রয়োজন।';
    attempt.enforcementLevel = 'captcha';
    attempt.requiresCaptcha = true;

    if (!captchaToken) {
      await attempt.save();
      throw ApiError.badRequest('CAPTCHA যাচাই প্রয়োজন।', {
        code: 'captcha_required',
        details: { enforcementLevel: 'captcha' },
      });
    }

    if (!await verifyCaptcha(captchaToken, ipAddress)) {
      await attempt.save();
      throw ApiError.badRequest('CAPTCHA যাচাই ব্যর্থ হয়েছে।', {
        code: 'captcha_invalid',
        details: { enforcementLevel: 'captcha' },
      });
    }

    // Solved — and it buys exactly ONE request through, not a fresh budget.
    //
    // This used to set `requestCount = 0`, which handed anyone who could answer
    // a challenge an unlimited supply of OTPs: solve, spend the whole allowance,
    // solve again. With a stub that accepts any string it was not even a
    // challenge, just a reset button. The count now survives the solve, so the
    // ceiling at BLOCK is real no matter how many challenges are answered.
    requiresCaptcha = false;
    attempt.requiresCaptcha = false;

  // ─── LEVEL 2: DELAY ───────────────────────────────────────────────────────
  // The CAPTCHA band falls through to here while the rung is dormant, and gets
  // the longer of the two waits. Slowing a script down is worth having even
  // when there is nothing to make it prove it is human.
  } else if (pressure >= THRESHOLDS.DELAY) {
    enforcementLevel = 'delay';
    delayMs = pressure >= THRESHOLDS.CAPTCHA ? COOLDOWNS.CAPTCHA : COOLDOWNS.DELAY;
    message = 'একটু অপেক্ষা করুন...';
    attempt.enforcementLevel = 'delay';

  // ─── LEVEL 1: WARNING ─────────────────────────────────────────────────────
  } else if (pressure >= THRESHOLDS.WARNING) {
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
    // Counted off the same `pressure` the ladder is tiered on, not off
    // `requestCount` alone — otherwise a caller who had burned most of the
    // budget on bad codes was told it still had room right up until the block.
    remainingAttempts: Math.max(0, THRESHOLDS.BLOCK - pressure),
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

    // Counting IS the contribution. This used to set `requiresCaptcha` and an
    // `enforcementLevel` of its own, which is no longer meaningful: the level
    // is derived in checkOtpRequest from `pressure` — requests plus failed
    // verifications — so a tier written here would be recomputed on the next
    // call anyway, and a stored challenge flag would name a rung the ladder no
    // longer reads. The increment above is what actually escalates now, and it
    // escalates all the way to the block rather than stopping at a CAPTCHA.
    if (attempt.failedVerifications >= 3) {
      attempt.flaggedForReview = true;
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
