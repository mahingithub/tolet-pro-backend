'use strict';

const RefreshToken = require('../models/RefreshToken');
const User = require('../models/User');
const tokenService = require('./token.service');
const ApiError = require('../utils/ApiError');
const refreshCookie = require('../utils/refreshCookie');

/**
 * Refresh Token Service
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Secure refresh token management with automatic rotation and reuse detection.
 * 
 * FLOW:
 * 1. Issue refresh token + access token on login
 * 2. Client uses access token for API calls
 * 3. When access token expires, client presents refresh token
 * 4. Server validates refresh token and rotates it
 * 5. Server issues new access token + new refresh token
 * 6. Old refresh token is marked as used
 * 
 * SECURITY:
 * - Refresh tokens stored as hashes (never plaintext)
 * - Automatic rotation invalidates old tokens
 * - Reuse detection → revoke all tokens + log security event
 * - Token families track rotation lineage
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

// Refresh-token lifetime. Tied to the cookie that carries it so the two can
// never drift: a DB row that outlives its cookie (or vice-versa) shows up as a
// session that dies for no visible reason. Still 30 days.
const REFRESH_TOKEN_TTL_MS = refreshCookie.REFRESH_COOKIE_MAX_AGE_MS;

// How long after a token was rotated we still accept it as the SAME logical
// refresh rather than a replay.
//
// Rotation is not atomic end-to-end: we stamp `usedAt`, then mint the successor,
// then the browser has to commit a Set-Cookie. A second request that presents
// the same token inside that window is virtually always benign — a second tab, a
// retried request, a Set-Cookie the browser dropped — not an attacker. Treating
// it as reuse revoked the entire token family AND every session on every device,
// which is precisely the "suddenly logged out everywhere" symptom. Outside the
// window, a used token really is suspicious and still burns everything.
const ROTATION_GRACE_MS = 60 * 1000;

// Must stay in sync with MAX_SESSIONS in services/auth.service.js. Duplicated
// rather than imported because auth.service requires this module (cycle).
const MAX_SESSIONS = 10;

// Roles allowed on the admin console. Mirrors services/auth.service ADMIN_ROLES
// and middleware/requireAdminAuth.
const ADMIN_ROLES = new Set(['support_agent', 'moderator', 'super_admin']);

const hasAdminRole = (user) => {
  const roles = Array.isArray(user.roles) && user.roles.length
    ? user.roles
    : (user.role ? [user.role] : []);
  return roles.some((r) => ADMIN_ROLES.has(r));
};

/**
 * Error codes that mean "this session is genuinely over — stop retrying and send
 * the user to the login screen". Anything NOT in this set (a DB blip, a 5xx, a
 * rate limit) is transient and must leave the session intact; callers use this
 * to decide whether to clear the refresh cookie.
 *
 * `missing_refresh_token` is deliberately absent: an absent cookie is ambiguous
 * (most often the browser declined to send it cross-site) and there is nothing
 * to revoke in that case anyway.
 */
const TERMINAL_REFRESH_CODES = new Set([
  'invalid_refresh_token',
  'token_reuse_detected',
  'user_not_found',
  'account_banned',
  'admin_required',
]);

const isTerminalRefreshError = (err) => TERMINAL_REFRESH_CODES.has(err?.code);

/**
 * Re-attach `sessionId` to `user.sessions` if it has gone missing.
 *
 * Every deliberate way a session ends — logout, logout-all, password change,
 * reuse detection — ALSO revokes the session's refresh tokens, so those never
 * reach this function. The one remaining way a sessionId disappears while its
 * refresh token stays valid is the MAX_SESSIONS LRU trim: an 11th login on
 * another device silently evicts the oldest session. requireAuth then answers
 * 401 `session_revoked` on every request, and refresh cannot repair it because
 * rotation reuses this same sessionId — a permanent logout the user never asked
 * for. A valid, unrevoked refresh token is proof the session is legitimate, so
 * we put it back.
 *
 * @returns {Promise<boolean>} true if the session had to be restored
 */
async function ensureSessionAttached(user, sessionId, { ipAddress, userAgent } = {}) {
  if (!sessionId) return false;
  if (!Array.isArray(user.sessions)) user.sessions = [];

  const existing = user.sessions.find((s) => s.sessionId === sessionId);
  if (existing) {
    existing.lastSeenAt = new Date();
    await user.save();
    return false;
  }

  // Leave room for the one we're about to add: keep the newest (MAX - 1).
  if (user.sessions.length >= MAX_SESSIONS) {
    user.sessions.splice(0, user.sessions.length - (MAX_SESSIONS - 1));
  }
  user.sessions.push({
    sessionId,
    device: userAgent || 'Unknown device',
    ipAddress: ipAddress || '0.0.0.0',
  });
  await user.save();
  return true;
}

/**
 * Stamp `usedAt` on the presented token and return the document to rotate from.
 *
 * Resolution order:
 *   1. Atomic claim succeeds          → rotate from it (the normal path).
 *   2. Token unknown/revoked/expired  → 401 invalid_refresh_token (terminal).
 *   3. Already used, inside grace     → rotate from it anyway (benign retry).
 *   4. Already used, outside grace    → genuine replay: revoke everything.
 */
async function claimForRotation(oldToken, { ipAddress = null } = {}) {
  const tokenHash = RefreshToken.hashToken(oldToken);
  const now = new Date();

  // The conditional update is the whole point: `usedAt: null` in the filter
  // means only ONE concurrent caller can win the claim. Read-then-save let both
  // win, and the loser looked like an attacker on its next attempt.
  const claimed = await RefreshToken.findOneAndUpdate(
    { tokenHash, usedAt: null, isRevoked: false, expiresAt: { $gt: now } },
    { $set: { usedAt: now, lastUsedAt: now } },
    { new: true }
  );
  if (claimed) return claimed;

  const existing = await RefreshToken.findOne({ tokenHash });
  if (!existing || existing.isRevoked || existing.expiresAt <= now) {
    throw ApiError.unauthorized('Refresh token অবৈধ বা মেয়াদ শেষ।', {
      code: 'invalid_refresh_token',
    });
  }

  // `usedAt` is always set at this point — the claim can only fail because a
  // concurrent request won it. If it somehow isn't, treat it as a just-now
  // rotation: failing open on a benign race beats revoking a live session.
  const usedAt = existing.usedAt || now;
  const usedAgoMs = now.getTime() - usedAt.getTime();

  if (usedAgoMs <= ROTATION_GRACE_MS) {
    existing.usedAt = usedAt; // never leave it unclaimed
    existing.lastUsedAt = now;
    await existing.save();
    return existing;
  }

  console.error('[SECURITY] Refresh token reuse detected:', {
    userId: existing.userId,
    familyId: existing.familyId,
    sessionId: existing.sessionId,
    usedAgoMs,
    ipAddress,
  });

  // IMMEDIATE SECURITY RESPONSE
  await handleTokenReuse(existing);

  throw ApiError.forbidden('নিরাপত্তা সতর্কতা: সন্দেহজনক কার্যকলাপ শনাক্ত হয়েছে। আবার লগইন করুন।', {
    code: 'token_reuse_detected',
    securityEvent: true,
  });
}

/**
 * Issue a new refresh token for a user session
 * 
 * @param {Object} params
 * @param {ObjectId} params.userId - User ID
 * @param {string} params.sessionId - Session ID
 * @param {string} [params.ipAddress] - Client IP
 * @param {string} [params.userAgent] - Client user agent
 * @param {string} [params.deviceFingerprint] - Device fingerprint
 * @returns {Promise<string>} Plaintext refresh token
 */
async function issueRefreshToken({
  userId,
  sessionId,
  ipAddress = null,
  userAgent = null,
  deviceFingerprint = null,
}) {
  const { token } = await RefreshToken.createToken({
    userId,
    sessionId,
    expiresIn: REFRESH_TOKEN_TTL_MS,
    ipAddress,
    userAgent,
    deviceFingerprint,
  });
  
  return token;
}

/**
 * Rotate a refresh token
 * 
 * Atomically claims the old token, then issues a new refresh token in the same
 * family plus a new access token. A token re-presented within ROTATION_GRACE_MS
 * is served as the same logical refresh (concurrent tabs / retries); a genuine
 * replay after that revokes the entire family and all user sessions.
 * 
 * @param {string} oldToken - Current refresh token (plaintext)
 * @param {Object} context - Request context
 * @param {string} [context.ipAddress]
 * @param {string} [context.userAgent]
 * @param {string} [context.deviceFingerprint]
 * @param {'user'|'admin'} [context.scope='user'] - Which access-token audience
 *        to mint. 'admin' additionally re-checks the account's admin role.
 * @returns {Promise<Object>} { accessToken, refreshToken, user }
 * @throws {ApiError} If token is invalid or reuse detected
 */
async function rotateRefreshToken(oldToken, context = {}) {
  const {
    ipAddress = null,
    userAgent = null,
    deviceFingerprint = null,
    // 'user' (public app) or 'admin' (console). Only decides which access-token
    // audience gets minted; the refresh token itself is scope-agnostic.
    scope = 'user',
  } = context;
  
  // ═══ VALIDATE + CLAIM THE OLD TOKEN ════════════════════════════════════
  // Validation and the `usedAt` stamp happen in ONE atomic update (see
  // claimForRotation). They used to be separate steps, so two refreshes racing
  // each other both passed validation and the loser was then misread as a
  // stolen-token replay — which revoked the whole family and every session on
  // every device.
  const oldTokenDoc = await claimForRotation(oldToken, { ipAddress });
  
  // ═══ LOAD USER ═════════════════════════════════════════════════════════
  const user = await User.findById(oldTokenDoc.userId);
  if (!user) {
    throw ApiError.unauthorized('ব্যবহারকারী পাওয়া যায়নি।', { code: 'user_not_found' });
  }
  
  // Check if user account is still valid
  if (user.isBanned) {
    throw ApiError.forbidden('আপনার অ্যাকাউন্ট স্থগিত।', { code: 'account_banned' });
  }

  // The admin console rotates through this same path, so re-check the role — a
  // demoted admin must not be handed a fresh admin-scoped token.
  if (scope === 'admin' && !hasAdminRole(user)) {
    throw ApiError.forbidden('অ্যাডমিন অনুমতি নেই।', { code: 'admin_required' });
  }

  // ═══ KEEP THE SESSION ALIVE ════════════════════════════════════════════
  // Restores a sessionId evicted by the MAX_SESSIONS LRU trim. Without this,
  // an 11th login on another device permanently 401s the oldest session with
  // `session_revoked` and refresh can never repair it.
  await ensureSessionAttached(user, oldTokenDoc.sessionId, { ipAddress, userAgent });
  
  // ═══ ISSUE NEW TOKENS ══════════════════════════════════════════════════
  
  // New refresh token (rotated, in same family). Rotation slides the 30-day
  // window forward, so an active session never ages out while an idle one still
  // does.
  const { token: newRefreshToken } = await RefreshToken.createToken({
    userId: oldTokenDoc.userId,
    sessionId: oldTokenDoc.sessionId,
    familyId: oldTokenDoc.familyId, // Same family
    parentHash: oldTokenDoc.tokenHash, // Track lineage
    expiresIn: REFRESH_TOKEN_TTL_MS,
    ipAddress,
    userAgent,
    deviceFingerprint,
  });
  
  // New access token (short-lived). The admin console needs the admin audience.
  const newAccessToken = scope === 'admin'
    ? tokenService.signAdminToken(user, oldTokenDoc.sessionId)
    : tokenService.signAccessToken(user, oldTokenDoc.sessionId);
  
  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    user,
  };
}

/**
 * Handle token reuse detection (security incident)
 * 
 * When a used token is presented again, it means:
 * - Token was stolen/intercepted
 * - Attacker is trying to use it
 * 
 * Response:
 * 1. Revoke entire token family (all rotated tokens)
 * 2. Revoke all user sessions (force re-login everywhere)
 * 3. Log security event
 * 
 * @param {Object} tokenDoc - Token document that was reused
 */
async function handleTokenReuse(tokenDoc) {
  try {
    // 1. Revoke entire token family
    await RefreshToken.revokeFamily(tokenDoc.familyId, 'reuse_detected');
    
    // 2. Revoke all user sessions (force re-login)
    const user = await User.findById(tokenDoc.userId);
    if (user) {
      user.sessions = []; // Clear all sessions
      await user.save();
    }
    
    // 3. Also revoke all refresh tokens for user (belt and suspenders)
    await RefreshToken.revokeAllForUser(tokenDoc.userId, 'reuse_detected');
    
    // 4. Log security event (TODO: integrate with audit logging)
    console.error('[SECURITY EVENT] Token reuse - all sessions revoked', {
      userId: tokenDoc.userId,
      familyId: tokenDoc.familyId,
      sessionId: tokenDoc.sessionId,
      timestamp: new Date().toISOString(),
    });
    
    // TODO: Send security notification to user
    // TODO: Log to AuditLog model when implemented
    
  } catch (err) {
    console.error('[SECURITY] Error handling token reuse:', err);
    // Don't throw - we already detected the security issue
  }
}

/**
 * Revoke a refresh token (e.g., on logout)
 * 
 * @param {string} token - Refresh token to revoke
 * @returns {Promise<boolean>} Success
 */
async function revokeRefreshToken(token) {
  const tokenHash = RefreshToken.hashToken(token);
  
  const result = await RefreshToken.updateOne(
    { tokenHash, isRevoked: false },
    {
      $set: {
        isRevoked: true,
        revokedReason: 'user_logout',
        revokedAt: new Date(),
      },
    }
  );
  
  return result.modifiedCount > 0;
}

/**
 * Revoke all refresh tokens for a session
 * 
 * @param {string} sessionId - Session ID
 * @returns {Promise<number>} Number of tokens revoked
 */
async function revokeSessionTokens(sessionId) {
  const result = await RefreshToken.revokeSession(sessionId, 'user_logout');
  return result.modifiedCount;
}

/**
 * Revoke all refresh tokens for a user (logout all devices)
 * 
 * @param {ObjectId} userId - User ID
 * @returns {Promise<number>} Number of tokens revoked
 */
async function revokeAllUserTokens(userId) {
  const result = await RefreshToken.revokeAllForUser(userId, 'user_logout');
  return result.modifiedCount;
}

/**
 * Get active sessions for a user (for session management UI)
 * 
 * Groups refresh tokens by session to show active logins.
 * 
 * @param {ObjectId} userId - User ID
 * @returns {Promise<Array>} Active sessions with metadata
 */
async function getActiveSessions(userId) {
  const tokens = await RefreshToken.getActiveTokens(userId);
  
  // Group by sessionId
  const sessionMap = new Map();
  
  for (const token of tokens) {
    const sessionId = token.sessionId;
    
    if (!sessionMap.has(sessionId)) {
      sessionMap.set(sessionId, {
        sessionId,
        ipAddress: token.ipAddress,
        userAgent: token.userAgent,
        deviceFingerprint: token.deviceFingerprint,
        firstSeen: token.createdAt,
        lastActive: token.lastUsedAt || token.createdAt,
        tokenCount: 0,
      });
    }
    
    const session = sessionMap.get(sessionId);
    session.tokenCount += 1;
    
    // Update lastActive if this token is newer
    if (token.lastUsedAt && token.lastUsedAt > session.lastActive) {
      session.lastActive = token.lastUsedAt;
    }
  }
  
  return Array.from(sessionMap.values()).sort((a, b) => b.lastActive - a.lastActive);
}

/**
 * Cleanup expired tokens (maintenance job)
 * 
 * MongoDB TTL index handles this automatically, but this can be called
 * for immediate cleanup if needed.
 * 
 * @returns {Promise<number>} Number of tokens deleted
 */
async function cleanupExpiredTokens() {
  const result = await RefreshToken.deleteMany({
    expiresAt: { $lt: new Date() },
  });
  
  return result.deletedCount;
}

module.exports = {
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeSessionTokens,
  revokeAllUserTokens,
  getActiveSessions,
  cleanupExpiredTokens,
  // Lets route handlers tell "the session is over" apart from "something went
  // wrong just now", so a transient failure never clears the refresh cookie.
  isTerminalRefreshError,
  TERMINAL_REFRESH_CODES,
  REFRESH_TOKEN_TTL_MS,
  ROTATION_GRACE_MS,
};
