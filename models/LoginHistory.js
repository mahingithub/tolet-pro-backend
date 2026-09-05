'use strict';

/**
 * LoginHistory Model - Track all login attempts for users and admins
 * 
 * Purpose:
 * - Security monitoring and anomaly detection
 * - User awareness of account access
 * - Forensic investigation of unauthorized access
 * - Geographic and device-based pattern detection
 * 
 * Features:
 * - Records both successful and failed login attempts
 * - Captures device, IP, location, and browser information
 * - Tracks session lifecycle (login → logout time)
 * - Supports active session management
 * - TTL for automatic cleanup of old records
 */

const mongoose = require('mongoose');

const loginHistorySchema = new mongoose.Schema(
  {
    // ─── User Identity ──────────────────────────────────────────────────────
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false, // False allows failed logins for unknown phone numbers
      index: true,
    },
    userPhone: {
      type: String,
      required: true,
    },
    userName: {
      type: String,
      default: 'Unknown',
    },
    userRole: {
      type: String,
      enum: ['tenant', 'landlord', 'support_agent', 'moderator', 'super_admin'],
      default: 'tenant',
    },

    // ─── Login Attempt ──────────────────────────────────────────────────────
    loginType: {
      type: String,
      enum: ['password', 'otp', '2fa', 'refresh_token', 'password_admin', '2fa_admin'],
      default: 'password',
    },
    status: {
      type: String,
      enum: ['success', 'failed'],
      required: true,
      index: true,
    },
    failureReason: {
      type: String, // Invalid credentials, account locked, etc.
    },

    // ─── Session Information ────────────────────────────────────────────────
    sessionId: {
      type: String,
      index: true,
      sparse: true, // Only successful logins have sessions
    },
    isActive: {
      type: Boolean,
      default: false, // true if user hasn't logged out yet
      index: true,
    },
    loginAt: {
      type: Date,
      required: true,
      default: Date.now,
      // NO `index: true` HERE — deliberately. The TTL index at the bottom of
      // this file declares the SAME key ({ loginAt: 1 }) with
      // expireAfterSeconds. Declaring both made Mongo reject the second
      // createIndex with IndexOptionsConflict, and the one it rejected was the
      // TTL — so login history never expired and grew without bound. The plain
      // index is redundant anyway: the TTL index is a normal b-tree that any
      // loginAt query can use.
    },
    logoutAt: {
      type: Date,
      default: null,
    },
    lastActiveAt: {
      type: Date,
      default: Date.now,
    },

    // ─── Device & Browser ───────────────────────────────────────────────────
    device: {
      type: String,
      default: 'Unknown',
    },
    browser: {
      type: String,
      default: 'Unknown',
    },
    os: {
      type: String,
      default: 'Unknown',
    },
    deviceType: {
      type: String,
      enum: ['mobile', 'tablet', 'desktop', 'unknown'],
      default: 'unknown',
    },
    userAgent: {
      type: String,
    },

    // ─── Network & Location ─────────────────────────────────────────────────
    ipAddress: {
      type: String,
      required: true,
      index: true,
    },
    country: {
      type: String,
      default: 'Unknown',
    },
    city: {
      type: String,
      default: 'Unknown',
    },
    region: {
      type: String,
      default: 'Unknown',
    },
    isp: {
      type: String, // Internet Service Provider
    },
    
    // ─── Security Flags ─────────────────────────────────────────────────────
    isSuspicious: {
      type: Boolean,
      default: false,
      index: true,
    },
    suspiciousReasons: [String], // e.g., 'new_location', 'new_device', 'unusual_time'
    
    // ─── Metadata ───────────────────────────────────────────────────────────
    metadata: {
      type: mongoose.Schema.Types.Mixed, // Additional context
    },
  },
  {
    timestamps: true,
  }
);

// ─── Indexes ────────────────────────────────────────────────────────────────
loginHistorySchema.index({ userId: 1, loginAt: -1 }); // User's login history
loginHistorySchema.index({ userId: 1, isActive: 1 }); // Active sessions
loginHistorySchema.index({ ipAddress: 1, loginAt: -1 }); // IP-based queries
loginHistorySchema.index({ status: 1, loginAt: -1 }); // Failed login monitoring
loginHistorySchema.index({ isSuspicious: 1, loginAt: -1 }); // Security alerts

// TTL index - auto-delete records older than 90 days
loginHistorySchema.index({ loginAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

// ─── Static Methods ─────────────────────────────────────────────────────────

/**
 * Record a login attempt
 * @param {Object} data - Login data
 * @returns {Promise<LoginHistory>}
 */
loginHistorySchema.statics.recordLogin = async function (data) {
  const record = new this({
    userId: data.userId,
    userPhone: data.userPhone,
    userName: data.userName,
    userRole: data.userRole,
    loginType: data.loginType || 'password',
    status: data.status,
    failureReason: data.failureReason || null,
    sessionId: data.sessionId || null,
    isActive: data.status === 'success',
    loginAt: new Date(),
    device: data.device || 'Unknown',
    browser: data.browser || 'Unknown',
    os: data.os || 'Unknown',
    deviceType: data.deviceType || 'unknown',
    userAgent: data.userAgent,
    ipAddress: data.ipAddress,
    country: data.country || 'Unknown',
    city: data.city || 'Unknown',
    region: data.region || 'Unknown',
    isp: data.isp || null,
    isSuspicious: data.isSuspicious || false,
    suspiciousReasons: data.suspiciousReasons || [],
    metadata: data.metadata || {},
  });
  
  await record.save();
  return record;
};

/**
 * Get login history for a user
 * @param {String} userId - User ID
 * @param {Number} limit - Number of records to return
 * @returns {Promise<Array>}
 */
loginHistorySchema.statics.getUserHistory = async function (userId, limit = 50) {
  return this.find({ userId })
    .sort({ loginAt: -1 })
    .limit(limit)
    .lean();
};

/**
 * Get active sessions for a user
 * @param {String} userId - User ID
 * @returns {Promise<Array>}
 */
loginHistorySchema.statics.getActiveSessions = async function (userId) {
  return this.find({ userId, isActive: true })
    .sort({ loginAt: -1 })
    .lean();
};

/**
 * Mark a session as logged out
 * @param {String} sessionId - Session ID
 * @returns {Promise<Object>}
 */
loginHistorySchema.statics.recordLogout = async function (sessionId) {
  return this.updateOne(
    { sessionId, isActive: true },
    {
      $set: {
        isActive: false,
        logoutAt: new Date(),
      },
    }
  );
};

/**
 * Update last active time for a session
 * @param {String} sessionId - Session ID
 * @returns {Promise<Object>}
 */
loginHistorySchema.statics.updateActivity = async function (sessionId) {
  return this.updateOne(
    { sessionId, isActive: true },
    {
      $set: {
        lastActiveAt: new Date(),
      },
    }
  );
};

/**
 * Get failed login attempts in a time window
 * @param {String} userId - User ID
 * @param {Number} minutes - Time window in minutes
 * @returns {Promise<Number>}
 */
loginHistorySchema.statics.getFailedAttempts = async function (userId, minutes = 30) {
  const since = new Date(Date.now() - minutes * 60 * 1000);
  return this.countDocuments({
    userId,
    status: 'failed',
    loginAt: { $gte: since },
  });
};

/**
 * Get failed attempts from an IP address
 * @param {String} ipAddress - IP address
 * @param {Number} minutes - Time window in minutes
 * @returns {Promise<Number>}
 */
loginHistorySchema.statics.getFailedAttemptsFromIP = async function (ipAddress, minutes = 30) {
  const since = new Date(Date.now() - minutes * 60 * 1000);
  return this.countDocuments({
    ipAddress,
    status: 'failed',
    loginAt: { $gte: since },
  });
};

/**
 * Detect suspicious login patterns
 * @param {String} userId - User ID
 * @param {Object} currentLogin - Current login data
 * @returns {Promise<Object>} - { isSuspicious, reasons }
 */
loginHistorySchema.statics.detectSuspiciousLogin = async function (userId, currentLogin) {
  const reasons = [];
  
  // Get user's recent successful logins
  const recentLogins = await this.find({
    userId,
    status: 'success',
    loginAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // Last 30 days
  })
    .sort({ loginAt: -1 })
    .limit(10)
    .lean();
  
  if (recentLogins.length === 0) {
    // First login or no recent history
    return { isSuspicious: false, reasons: [] };
  }
  
  // Check for new location
  const knownCountries = new Set(recentLogins.map(l => l.country));
  if (currentLogin.country && !knownCountries.has(currentLogin.country)) {
    reasons.push('new_location');
  }
  
  // Check for new device
  const knownDevices = new Set(recentLogins.map(l => l.device));
  if (currentLogin.device && !knownDevices.has(currentLogin.device)) {
    reasons.push('new_device');
  }
  
  // Check for unusual time (e.g., 2 AM - 5 AM local time)
  const hour = new Date().getHours();
  if (hour >= 2 && hour <= 5) {
    const nightLogins = recentLogins.filter(l => {
      const h = new Date(l.loginAt).getHours();
      return h >= 2 && h <= 5;
    });
    if (nightLogins.length === 0) {
      reasons.push('unusual_time');
    }
  }
  
  // Check for rapid location change (impossible travel)
  const lastLogin = recentLogins[0];
  if (lastLogin) {
    const timeDiff = Date.now() - new Date(lastLogin.loginAt).getTime();
    const hoursDiff = timeDiff / (1000 * 60 * 60);
    
    if (hoursDiff < 1 && lastLogin.country !== currentLogin.country) {
      reasons.push('impossible_travel');
    }
  }
  
  return {
    isSuspicious: reasons.length > 0,
    reasons,
  };
};

/**
 * Get suspicious logins in time window
 * @param {Number} hours - Look back this many hours
 * @returns {Promise<Array>}
 */
loginHistorySchema.statics.getSuspiciousLogins = async function (hours = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  return this.find({
    isSuspicious: true,
    loginAt: { $gte: since },
  })
    .sort({ loginAt: -1 })
    .lean();
};

module.exports = mongoose.model('LoginHistory', loginHistorySchema);
