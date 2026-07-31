'use strict';

/**
 * AuditLog Model - Immutable audit logs for security-sensitive admin actions
 * 
 * Purpose:
 * - Track all privileged admin operations for security investigations
 * - Provide forensic evidence for compliance and incident response
 * - Detect suspicious patterns (e.g., mass deletions, privilege escalations)
 * 
 * Security Properties:
 * - Immutable: Once written, logs cannot be modified or deleted
 * - Comprehensive: Captures who, what, when, where, why, and result
 * - Indexed: Fast querying for security investigations
 * - Retained: Long retention period for compliance
 * 
 * Logged Actions:
 * - User management: create, update, delete, ban, unban, role changes
 * - Property moderation: approve, reject, delete, feature
 * - Admin team: create admin, update role, delete admin, enable/disable 2FA
 * - System config: rate limit changes, feature flags, maintenance mode
 * - Security events: failed login attempts, permission denials, suspicious activity
 */

const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    // ─── Who ────────────────────────────────────────────────────────────────
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false, // False allows system/anonymous events like failed logins
      index: true,
    },
    adminName: {
      type: String,
      required: true,
    },
    adminPhone: {
      type: String,
      required: true,
    },
    adminRole: {
      type: String,
      required: true,
    },

    // ─── What ───────────────────────────────────────────────────────────────
    action: {
      type: String,
      required: true,
      enum: [
        // User Management
        'user.create',
        'user.update',
        'user.delete',
        'user.ban',
        'user.unban',
        'user.verify',
        'user.role.change',
        
        // Property Management
        'property.approve',
        'property.reject',
        'property.delete',
        'property.feature',
        'property.unfeature',
        'property.update',
        
        // Admin Team Management
        'admin.create',
        'admin.update',
        'admin.delete',
        'admin.role.change',
        'admin.2fa.enable',
        'admin.2fa.disable',
        'admin.password.reset',
        
        // Content Moderation
        'content.approve',
        'content.reject',
        'content.delete',
        'content.flag',
        
        // System Configuration
        'config.update',
        'config.feature.toggle',
        'config.ratelimit.change',
        'config.maintenance.toggle',
        
        // Security Events
        'security.login.failed',
        'security.permission.denied',
        'security.token.revoked',
        'security.suspicious.activity',
        
        // AI & Support
        'ai.guide.create',
        'ai.guide.update',
        'ai.guide.delete',
        'support.ticket.resolve',
        'support.ticket.escalate',
      ],
      index: true,
    },

    // ─── Target ─────────────────────────────────────────────────────────────
    targetType: {
      type: String,
      enum: ['user', 'property', 'admin', 'config', 'content', 'ai-guide', 'support-ticket', 'system'],
      index: true,
    },
    targetId: {
      type: String, // Can be ObjectId or config key
      index: true,
    },
    targetName: {
      type: String, // Human-readable identifier
    },

    // ─── Context ────────────────────────────────────────────────────────────
    description: {
      type: String,
      required: true,
    },
    changes: {
      type: mongoose.Schema.Types.Mixed, // Before/after values for updates
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed, // Additional context (reason, notes, etc.)
    },

    // ─── Result ─────────────────────────────────────────────────────────────
    status: {
      type: String,
      required: true,
      enum: ['success', 'failure', 'partial'],
      default: 'success',
    },
    errorMessage: {
      type: String, // If status is failure
    },

    // ─── Forensics ──────────────────────────────────────────────────────────
    ipAddress: {
      type: String,
      required: true,
    },
    userAgent: {
      type: String,
    },
    device: {
      type: String,
    },
    sessionId: {
      type: String,
      index: true,
    },

    // ─── Timestamps ─────────────────────────────────────────────────────────
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: false, // We use custom timestamp field
    strict: true,
  }
);

// ─── Indexes for Fast Querying ──────────────────────────────────────────────
auditLogSchema.index({ timestamp: -1 }); // Recent logs first
auditLogSchema.index({ adminId: 1, timestamp: -1 }); // Admin's history
auditLogSchema.index({ action: 1, timestamp: -1 }); // Action-specific logs
auditLogSchema.index({ targetType: 1, targetId: 1, timestamp: -1 }); // Target's history
auditLogSchema.index({ status: 1, timestamp: -1 }); // Failed actions

// Compound index for security investigations
auditLogSchema.index({ adminId: 1, action: 1, timestamp: -1 });

// ─── Immutability ───────────────────────────────────────────────────────────
// Prevent updates and deletes - logs are write-once
auditLogSchema.pre('updateOne', function () {
  throw new Error('AuditLog records are immutable and cannot be updated');
});

auditLogSchema.pre('findOneAndUpdate', function () {
  throw new Error('AuditLog records are immutable and cannot be updated');
});

auditLogSchema.pre('findOneAndDelete', function () {
  throw new Error('AuditLog records are immutable and cannot be deleted');
});

auditLogSchema.pre('deleteOne', function () {
  throw new Error('AuditLog records are immutable and cannot be deleted');
});

auditLogSchema.pre('deleteMany', function () {
  throw new Error('AuditLog records are immutable and cannot be deleted');
});

auditLogSchema.pre('updateMany', function () {
  throw new Error('AuditLog records are immutable and cannot be updated');
});

// ─── Static Methods ─────────────────────────────────────────────────────────

/**
 * Log an admin action
 * @param {Object} data - Log data
 * @returns {Promise<AuditLog>}
 */
auditLogSchema.statics.log = async function (data) {
  const log = new this(data);
  await log.save();
  return log;
};

/**
 * Get recent logs for an admin
 * @param {String} adminId - Admin's user ID
 * @param {Number} limit - Number of logs to return
 * @returns {Promise<Array>}
 */
auditLogSchema.statics.getAdminHistory = async function (adminId, limit = 50) {
  return this.find({ adminId })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
};

/**
 * Get logs for a specific target (e.g., all actions on a user)
 * @param {String} targetType - Type of target
 * @param {String} targetId - Target ID
 * @param {Number} limit - Number of logs to return
 * @returns {Promise<Array>}
 */
auditLogSchema.statics.getTargetHistory = async function (targetType, targetId, limit = 50) {
  return this.find({ targetType, targetId })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
};

/**
 * Get failed actions for security monitoring
 * @param {Date} since - Get failures since this date
 * @param {Number} limit - Number of logs to return
 * @returns {Promise<Array>}
 */
auditLogSchema.statics.getFailedActions = async function (since, limit = 100) {
  const query = { status: 'failure' };
  if (since) {
    query.timestamp = { $gte: since };
  }
  return this.find(query)
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
};

/**
 * Search logs with filters
 * @param {Object} filters - Search filters
 * @param {Number} page - Page number (1-indexed)
 * @param {Number} pageSize - Items per page
 * @returns {Promise<Object>} - { logs, total, page, pageSize }
 */
auditLogSchema.statics.search = async function (filters = {}, page = 1, pageSize = 50) {
  const query = {};
  
  if (filters.adminId) query.adminId = filters.adminId;
  if (filters.action) query.action = filters.action;
  if (filters.targetType) query.targetType = filters.targetType;
  if (filters.targetId) query.targetId = filters.targetId;
  if (filters.status) query.status = filters.status;
  
  if (filters.startDate || filters.endDate) {
    query.timestamp = {};
    if (filters.startDate) query.timestamp.$gte = new Date(filters.startDate);
    if (filters.endDate) query.timestamp.$lte = new Date(filters.endDate);
  }
  
  const skip = (page - 1) * pageSize;
  
  const [logs, total] = await Promise.all([
    this.find(query)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean(),
    this.countDocuments(query),
  ]);
  
  return {
    logs,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
};

/**
 * Get suspicious activity patterns
 * @param {Number} hours - Look back this many hours
 * @returns {Promise<Object>} - Suspicious patterns detected
 */
auditLogSchema.statics.getSuspiciousActivity = async function (hours = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  // Detect patterns like:
  // - Multiple failed login attempts
  // - Mass deletions
  // - Unusual role changes
  // - After-hours activity
  
  const [failedLogins, massDeletions, roleChanges] = await Promise.all([
    this.aggregate([
      {
        $match: {
          timestamp: { $gte: since },
          action: 'security.login.failed',
        },
      },
      {
        $group: {
          _id: '$adminId',
          count: { $sum: 1 },
          attempts: { $push: { timestamp: '$timestamp', ip: '$ipAddress' } },
        },
      },
      { $match: { count: { $gte: 5 } } }, // 5+ failed attempts
    ]),
    
    this.aggregate([
      {
        $match: {
          timestamp: { $gte: since },
          action: { $in: ['user.delete', 'property.delete', 'content.delete'] },
        },
      },
      {
        $group: {
          _id: { adminId: '$adminId', action: '$action' },
          count: { $sum: 1 },
          adminName: { $first: '$adminName' },
        },
      },
      { $match: { count: { $gte: 10 } } }, // 10+ deletions
    ]),
    
    this.aggregate([
      {
        $match: {
          timestamp: { $gte: since },
          action: { $in: ['user.role.change', 'admin.role.change'] },
        },
      },
      {
        $group: {
          _id: '$adminId',
          count: { $sum: 1 },
          changes: { $push: { targetId: '$targetId', changes: '$changes' } },
        },
      },
      { $match: { count: { $gte: 5 } } }, // 5+ role changes
    ]),
  ]);
  
  return {
    failedLogins,
    massDeletions,
    roleChanges,
  };
};

module.exports = mongoose.model('AuditLog', auditLogSchema);
