'use strict';

const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * RefreshToken — Secure refresh token storage with rotation and reuse detection
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * SECURITY DESIGN:
 * - Tokens stored as SHA-256 hashes (never plaintext)
 * - Automatic rotation on each use
 * - Family tracking for reuse detection
 * - Revocation cascade on suspicious activity
 * 
 * TOKEN FAMILY CONCEPT:
 * When a refresh token is used, we:
 * 1. Invalidate the old token
 * 2. Issue a new token in the same family
 * 3. Track the family lineage
 * 
 * REUSE DETECTION:
 * If an already-used token is presented again:
 * - It's either stolen or replayed
 * - Revoke entire family (all rotated tokens)
 * - Force user to re-login
 * - Log security incident
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */
const RefreshTokenSchema = new mongoose.Schema(
  {
    // ═══ TOKEN STORAGE ═════════════════════════════════════════════════════
    
    // SHA-256 hash of the refresh token (never store plaintext)
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    
    // ═══ OWNERSHIP ═════════════════════════════════════════════════════════
    
    // User who owns this token
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    
    // Session this token belongs to
    sessionId: {
      type: String,
      required: true,
      index: true,
    },
    
    // ═══ TOKEN FAMILY (for reuse detection) ═══════════════════════════════
    
    // Unique identifier for this token family
    // All rotated tokens share the same family ID
    familyId: {
      type: String,
      required: true,
      index: true,
    },
    
    // Parent token hash (if this is a rotated token)
    // Used to trace the rotation chain
    parentHash: {
      type: String,
      default: null,
    },
    
    // ═══ LIFECYCLE ═════════════════════════════════════════════════════════
    
    // When token is used and replaced (null = not yet used)
    usedAt: {
      type: Date,
      default: null,
      index: true,
    },
    
    // When token expires
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    
    // Whether token has been revoked (manual or due to security event)
    isRevoked: {
      type: Boolean,
      default: false,
      index: true,
    },
    
    // Why token was revoked
    revokedReason: {
      type: String,
      enum: [null, 'reuse_detected', 'user_logout', 'security_event', 'manual_revoke', 'family_revoke'],
      default: null,
    },
    
    // When token was revoked
    revokedAt: {
      type: Date,
      default: null,
    },
    
    // ═══ CONTEXT (forensics and monitoring) ═══════════════════════════════
    
    // IP address when token was issued
    ipAddress: {
      type: String,
      default: null,
      maxlength: 45, // IPv6
    },
    
    // User agent when token was issued
    userAgent: {
      type: String,
      default: null,
      maxlength: 500,
    },
    
    // Device fingerprint (if available)
    deviceFingerprint: {
      type: String,
      default: null,
      maxlength: 100,
    },
    
    // Last time token was validated (for activity tracking)
    lastUsedAt: {
      type: Date,
      default: null,
    },
    
    // Timestamps
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: false, // Using manual createdAt
    versionKey: false,
  }
);

// ═══ INDEXES ═══════════════════════════════════════════════════════════════

// Find valid tokens for a user
RefreshTokenSchema.index({ userId: 1, isRevoked: 1, expiresAt: 1 });

// Find tokens in a family (for cascade revocation)
RefreshTokenSchema.index({ familyId: 1, isRevoked: 1 });

// Cleanup expired tokens
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// ═══ STATIC METHODS ════════════════════════════════════════════════════════

/**
 * Hash a refresh token using SHA-256
 * @param {string} token - Plain text token
 * @returns {string} Hex-encoded hash
 */
RefreshTokenSchema.statics.hashToken = function(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
};

/**
 * Generate a cryptographically secure random token
 * @returns {string} Base64-URL encoded random token
 */
RefreshTokenSchema.statics.generateToken = function() {
  // 32 bytes = 256 bits of entropy
  return crypto.randomBytes(32).toString('base64url');
};

/**
 * Create a new refresh token
 * @param {Object} params
 * @returns {Object} { token (plaintext), document }
 */
RefreshTokenSchema.statics.createToken = async function({
  userId,
  sessionId,
  familyId = null,
  parentHash = null,
  expiresIn = 30 * 24 * 60 * 60 * 1000, // 30 days default
  ipAddress = null,
  userAgent = null,
  deviceFingerprint = null,
}) {
  const token = this.generateToken();
  const tokenHash = this.hashToken(token);
  
  // If no familyId provided, this is a new family (initial token)
  const actualFamilyId = familyId || crypto.randomUUID();
  
  const document = await this.create({
    tokenHash,
    userId,
    sessionId,
    familyId: actualFamilyId,
    parentHash,
    expiresAt: new Date(Date.now() + expiresIn),
    ipAddress,
    userAgent,
    deviceFingerprint,
  });
  
  // Return plaintext token (only time it's accessible) + document
  return { token, document };
};

/**
 * Validate a refresh token and check for reuse
 * @param {string} token - Plaintext token
 * @returns {Object} { valid, document, reuseDetected }
 */
RefreshTokenSchema.statics.validateToken = async function(token) {
  const tokenHash = this.hashToken(token);
  
  const document = await this.findOne({ tokenHash });
  
  if (!document) {
    return { valid: false, document: null, reuseDetected: false };
  }
  
  // Check if expired
  if (document.expiresAt < new Date()) {
    return { valid: false, document, reuseDetected: false };
  }
  
  // Check if revoked
  if (document.isRevoked) {
    return { valid: false, document, reuseDetected: false };
  }
  
  // ═══ REUSE DETECTION ═══════════════════════════════════════════════════
  // If token was already used (usedAt is set), this is a reuse attempt
  if (document.usedAt) {
    return { valid: false, document, reuseDetected: true };
  }
  
  return { valid: true, document, reuseDetected: false };
};

/**
 * Revoke entire token family (cascade revocation)
 * Used when reuse is detected
 */
RefreshTokenSchema.statics.revokeFamily = async function(familyId, reason = 'family_revoke') {
  const result = await this.updateMany(
    { familyId, isRevoked: false },
    {
      $set: {
        isRevoked: true,
        revokedReason: reason,
        revokedAt: new Date(),
      },
    }
  );
  
  return result;
};

/**
 * Revoke all tokens for a user (logout all devices)
 */
RefreshTokenSchema.statics.revokeAllForUser = async function(userId, reason = 'user_logout') {
  const result = await this.updateMany(
    { userId, isRevoked: false },
    {
      $set: {
        isRevoked: true,
        revokedReason: reason,
        revokedAt: new Date(),
      },
    }
  );
  
  return result;
};

/**
 * Revoke all tokens for a session
 */
RefreshTokenSchema.statics.revokeSession = async function(sessionId, reason = 'user_logout') {
  const result = await this.updateMany(
    { sessionId, isRevoked: false },
    {
      $set: {
        isRevoked: true,
        revokedReason: reason,
        revokedAt: new Date(),
      },
    }
  );
  
  return result;
};

/**
 * Get active tokens for a user (for session management UI)
 */
RefreshTokenSchema.statics.getActiveTokens = async function(userId) {
  return this.find({
    userId,
    isRevoked: false,
    expiresAt: { $gt: new Date() },
  })
    .select('sessionId ipAddress userAgent deviceFingerprint createdAt lastUsedAt')
    .sort({ createdAt: -1 });
};

module.exports = mongoose.model('RefreshToken', RefreshTokenSchema);
