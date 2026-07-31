'use strict';

/**
 * rateLimiters.js — Global & Category-Based Rate Limiting
 * ═══════════════════════════════════════════════════════════════════════════
 * LAYERED DEFENSE ARCHITECTURE:
 * 
 * 1. GLOBAL LIMITER (apiLimiter)
 *    Purpose: DDoS protection, prevents server resource exhaustion
 *    Scope: ALL /api/* requests
 *    Do NOT remove: This is the first line of defense against traffic floods
 * 
 * 2. CATEGORY LIMITERS (authLimiter, writeLimiter, etc.)
 *    Purpose: Application-level abuse prevention (brute force, spam)
 *    Scope: Specific route categories based on sensitivity
 *    Do NOT bypass: These prevent specific attack patterns per feature
 * 
 * 3. ENDPOINT LIMITERS (middleware/rateLimit.js)
 *    Purpose: Fine-grained protection per operation (login, OTP, etc.)
 *    Scope: Individual high-risk endpoints
 *    Most specific: Applied on top of category limiters for critical paths
 * 
 * WHY BOTH GLOBAL AND SPECIFIC LIMITERS:
 * - Global prevents infrastructure exhaustion (CPU, memory, connections)
 * - Specific prevents application abuse (credential stuffing, spam)
 * - Removing either creates a security gap
 * 
 * TUNING GUIDELINES:
 * - Increase limits if legitimate users hit them during normal usage
 * - Decrease limits if you observe abuse patterns in logs
 * - Never remove a limiter without understanding its protection scope
 * ═══════════════════════════════════════════════════════════════════════════
 */

const rateLimit = require('express-rate-limit');

// Shared response when a limit is hit. Bengali message to match the app's 404.
function limitHandler(req, res) {
  res.status(429).json({
    message: 'অনেক বেশি অনুরোধ। একটু পরে আবার চেষ্টা করুন।',
    code: 'too_many_requests',
  });
}

// Common options shared by all limiters.
const base = {
  standardHeaders: true,   // RateLimit-* headers (lets clients self-throttle)
  legacyHeaders: false,    // no old X-RateLimit-* headers
  handler: limitHandler,
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LAYER 1: GLOBAL PROTECTION (Infrastructure Defense)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * LIGHT — global backstop across the whole API. Catches anything not covered
 * by category limiters and protects the free-tier server from traffic floods.
 * 
 * 300 requests per minute per IP — very high; a real session (loading
 * listings, images metadata, polling chat) won't approach it.
 * 
 * DO NOT REMOVE: This is your DDoS protection. Without it, a flood of requests
 * can exhaust server resources (CPU, memory, database connections) even if
 * individual endpoints aren't abused.
 */
const apiLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000, // 1 minute
  max: 300,
  message: 'সার্ভার ব্যস্ত। একটু পরে চেষ্টা করুন।',
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LAYER 2: CATEGORY-BASED PROTECTION (Application Defense)
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * STRICT — auth endpoints (login, OTP send/verify, register, forgot-password).
 * 
 * 20 attempts per 15 min per IP. Enough for a fat-fingered real user (retype
 * password / re-request OTP a few times) but kills automated credential stuffing.
 * 
 * skipSuccessfulRequests: true means successful logins don't count toward the
 * limit — only failed/abusive attempts matter for brute-force detection.
 * 
 * CRITICAL: This works WITH endpoint-specific limiters (middleware/rateLimit.js),
 * not instead of them. Both layers are needed:
 * - This catches rapid auth attempts across different endpoints
 * - Endpoint limiters catch focused attacks on single operations
 */
const authLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  skipSuccessfulRequests: true,
  message: 'অনেক বেশি লগইন চেষ্টা। ১৫ মিনিট পরে আবার চেষ্টা করুন।',
});

/**
 * MEDIUM — write-heavy actions that could be spammed (send message, post
 * inquiry, create booking, open support ticket).
 * 
 * 60 writes per 5 min per IP. A normal user chatting actively stays well under;
 * a spam loop trips it fast.
 */
const writeLimiter = rateLimit({
  ...base,
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 60,
});

/**
 * CHAT — polling-based chat surface (/api/conversations).
 * 
 * The frontend polls messages every ~5s and the conversation list every ~15s,
 * so a single idle user generates ~80 requests / 5 min just sitting on the
 * chat page. writeLimiter (60/5min) would wrongly block that, so chat gets its
 * own generous limiter: still protects against true flooding, but never trips
 * during normal polling + sending. Keyed per IP.
 * 
 * 400 requests / 5 min ≈ comfortably above the ~80 from polling plus active
 * sending of text + the occasional image / voice upload.
 */
const chatLimiter = rateLimit({
  ...base,
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 400,
});

/**
 * AI — the Gemini assistant endpoint (/api/ai-chat/ask). UNLIKE every other
 * limiter here, each call costs REAL MONEY (an LLM request — and one user
 * message can trigger 2–3 Gemini round-trips when the property-search tool
 * fires). So this is deliberately TIGHTER than writeLimiter and sits on its own
 * bucket, so AI spend can't be run up by — and doesn't eat into — normal writes.
 * 
 * 30 requests / 15 min per IP ≈ ~2 questions/min sustained: comfortable for a
 * real person genuinely searching, but caps cost/abuse from a logged-out
 * visitor hammering it. Bump `max` DOWN to cut spend, UP if real users complain.
 * (For per-user / premium quotas, gate inside the controller once the route is
 * authed — IP keying is the right backstop for a public endpoint.)
 */
const aiLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EXPORTS & USAGE NOTES
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Applied in server.js:
 * 1. apiLimiter → ALL /api/* routes (global protection)
 * 2. authLimiter → /api/auth/* and /api/admin/auth/* (credential attacks)
 * 3. writeLimiter → /api/inquiries, /api/bookings, etc. (spam prevention)
 * 4. chatLimiter → /api/conversations (polling-friendly)
 * 5. aiLimiter → /api/ai-chat (cost control)
 * 
 * For per-endpoint limits, see middleware/rateLimit.js (login, OTP, etc.)
 */
module.exports = { authLimiter, writeLimiter, chatLimiter, apiLimiter, aiLimiter };
