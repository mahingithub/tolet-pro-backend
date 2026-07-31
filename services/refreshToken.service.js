'use strict';

const RefreshToken = require('../models/RefreshToken');
const User = require('../models/User');
const tokenService = require('./token.service');
const ApiError = require('../utils/ApiError');

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
    expiresIn: 30 * 24 * 60 * 60 * 1000, // 30 days
    ipAddress,
    userAgent,
    deviceFingerprint,
  });
  
  return token;
}

/**
 * Rotate a refresh token
 * 
 * Validates the old token, marks it as used, and issues a new token in the same family.
 * If reuse is detected, revokes entire family and all user sessions.
 * 
 * @param {string} oldToken - Current refresh token (plaintext)
 * @param {Object} context - Request context
 * @returns {Promise<Object>} { accessToken, refreshToken, user }
 * @throws {ApiError} If token is invalid or reuse detected
 */
async function rotateRefreshToken(oldToken, context = {}) {
  const { ipAddress = null, userAgent = null, deviceFingerprint = null } = context;
  
  // ═══ VALIDATE OLD TOKEN ════════════════════════════════════════════════
  const { valid, document: oldTokenDoc, reuseDetected } = await RefreshToken.validateToken(oldToken);
  
  if (!valid && !reuseDetected) {
    throw ApiError.unauthorized('Refresh token অবৈধ বা মেয়াদ শেষ।', {
      code: 'invalid_refresh_token',
    });
  }
  
  // ═══ REUSE DETECTION ═══════════════════════════════════════════════════
  if (reuseDetected) {
    console.error('[SECURITY] Refresh token reuse detected:', {
      userId: oldTokenDoc.userId,
      familyId: oldTokenDoc.familyId,
      sessionId: oldTokenDoc.sessionId,
      ipAddress,
    });
    
    // IMMEDIATE SECURITY RESPONSE
    await handleTokenReuse(oldTokenDoc);
    
    throw ApiError.forbidden('নিরাপত্তা সতর্কতা: সন্দেহজনক কার্যকলাপ শনাক্ত হয়েছে। আবার লগইন করুন।', {
      code: 'token_reuse_detected',
      securityEvent: true,
    });
  }
  
  // ═══ MARK OLD TOKEN AS USED ════════════════════════════════════════════
  oldTokenDoc.usedAt = new Date();
  oldTokenDoc.lastUsedAt = new Date();
  await oldTokenDoc.save();
  
  // ═══ LOAD USER ═════════════════════════════════════════════════════════
  const user = await User.findById(oldTokenDoc.userId);
  if (!user) {
    throw ApiError.unauthorized('ব্যবহারকারী পাওয়া যায়নি।', { code: 'user_not_found' });
  }
  
  // Check if user account is still valid
  if (user.isBanned) {
    throw ApiError.forbidden('আপনার অ্যাকাউন্ট স্থগিত।', { code: 'account_banned' });
  }
  
  // ═══ ISSUE NEW TOKENS ══════════════════════════════════════════════════
  
  // New refresh token (rotated, in same family)
  const { token: newRefreshToken } = await RefreshToken.createToken({
    userId: oldTokenDoc.userId,
    sessionId: oldTokenDoc.sessionId,
    familyId: oldTokenDoc.familyId, // Same family
    parentHash: oldTokenDoc.tokenHash, // Track lineage
    expiresIn: 30 * 24 * 60 * 60 * 1000, // 30 days
    ipAddress,
    userAgent,
    deviceFingerprint,
  });
  
  // New access token (short-lived)
  const newAccessToken = tokenService.signAccessToken(user, oldTokenDoc.sessionId);
  
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
};
