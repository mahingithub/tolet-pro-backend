'use strict';

/**
 * Audit Log Service
 * 
 * Centralizes audit logging logic for admin actions. Provides helper methods
 * to log common admin operations with consistent formatting and context.
 * 
 * Usage:
 *   const auditLog = require('../services/auditLog.service');
 *   
 *   await auditLog.logUserAction(req, {
 *     action: 'user.ban',
 *     targetId: userId,
 *     targetName: user.name,
 *     description: 'Banned user for spam',
 *     metadata: { reason: 'Multiple spam reports' }
 *   });
 */

const AuditLog = require('../models/AuditLog');

/**
 * Extract admin context from request
 * @param {Object} req - Express request
 * @returns {Object} - Admin context
 */
function extractAdminContext(req) {
  const admin = req.user;
  if (!admin) {
    throw new Error('Admin user not found in request. Ensure requireAdminAuth middleware is used.');
  }
  
  return {
    adminId: admin._id,
    adminName: admin.name || 'Unknown',
    adminPhone: admin.phone || 'Unknown',
    adminRole: admin.role || 'admin',
    ipAddress: req.ip || req.connection?.remoteAddress || '0.0.0.0',
    userAgent: req.headers['user-agent'] || 'Unknown',
    device: req.headers['user-agent'] || 'Unknown',
    sessionId: req.sessionId || null,
  };
}

/**
 * Log a generic admin action
 * @param {Object} req - Express request
 * @param {Object} data - Log data
 * @returns {Promise<AuditLog>}
 */
async function log(req, data) {
  const context = extractAdminContext(req);
  
  const logData = {
    ...context,
    action: data.action,
    targetType: data.targetType || null,
    targetId: data.targetId || null,
    targetName: data.targetName || null,
    description: data.description,
    changes: data.changes || null,
    metadata: data.metadata || null,
    status: data.status || 'success',
    errorMessage: data.errorMessage || null,
    timestamp: new Date(),
  };
  
  return AuditLog.log(logData);
}

/**
 * Log a user management action
 * @param {Object} req - Express request
 * @param {Object} data - Log data
 */
async function logUserAction(req, data) {
  return log(req, {
    ...data,
    targetType: 'user',
  });
}

/**
 * Log a property management action
 * @param {Object} req - Express request
 * @param {Object} data - Log data
 */
async function logPropertyAction(req, data) {
  return log(req, {
    ...data,
    targetType: 'property',
  });
}

/**
 * Log an admin team management action
 * @param {Object} req - Express request
 * @param {Object} data - Log data
 */
async function logAdminAction(req, data) {
  return log(req, {
    ...data,
    targetType: 'admin',
  });
}

/**
 * Log a system configuration action
 * @param {Object} req - Express request
 * @param {Object} data - Log data
 */
async function logConfigAction(req, data) {
  return log(req, {
    ...data,
    targetType: 'config',
  });
}

/**
 * Log a content moderation action
 * @param {Object} req - Express request
 * @param {Object} data - Log data
 */
async function logContentAction(req, data) {
  return log(req, {
    ...data,
    targetType: 'content',
  });
}

/**
 * Log an AI/support action
 * @param {Object} req - Express request
 * @param {Object} data - Log data
 */
async function logAIAction(req, data) {
  return log(req, {
    ...data,
    targetType: 'ai-guide',
  });
}

/**
 * Log a security event
 * @param {Object} req - Express request (can be null for system events)
 * @param {Object} data - Log data
 */
async function logSecurityEvent(req, data) {
  if (!req || !req.user) {
    // System-generated security event (e.g., failed login)
    const logData = {
      adminId: data.adminId || null,
      adminName: data.adminName || 'System',
      adminPhone: data.adminPhone || 'System',
      adminRole: data.adminRole || 'system',
      ipAddress: data.ipAddress || '0.0.0.0',
      userAgent: data.userAgent || 'System',
      device: data.device || 'System',
      sessionId: data.sessionId || null,
      action: data.action,
      targetType: 'system',
      targetId: data.targetId || null,
      targetName: data.targetName || null,
      description: data.description,
      changes: data.changes || null,
      metadata: data.metadata || null,
      status: data.status || 'failure',
      errorMessage: data.errorMessage || null,
      timestamp: new Date(),
    };
    
    return AuditLog.log(logData);
  }
  
  return log(req, {
    ...data,
    targetType: 'system',
  });
}

/**
 * Helper: Log failed login attempt
 * @param {Object} data - { phone, ipAddress, userAgent, reason }
 */
async function logFailedLogin(data) {
  return AuditLog.log({
    adminId: null,
    adminName: 'Anonymous',
    adminPhone: data.phone || 'Unknown',
    adminRole: 'none',
    ipAddress: data.ipAddress || '0.0.0.0',
    userAgent: data.userAgent || 'Unknown',
    device: data.userAgent || 'Unknown',
    sessionId: null,
    action: 'security.login.failed',
    targetType: 'system',
    targetId: null,
    targetName: null,
    description: `Failed login attempt for ${data.phone || 'unknown phone'}`,
    metadata: { reason: data.reason || 'Invalid credentials' },
    status: 'failure',
    errorMessage: data.reason || 'Invalid credentials',
    timestamp: new Date(),
  });
}

/**
 * Helper: Log permission denied
 * @param {Object} req - Express request
 * @param {Object} data - { action, resource, reason }
 */
async function logPermissionDenied(req, data) {
  return logSecurityEvent(req, {
    action: 'security.permission.denied',
    description: `Permission denied: ${data.action} on ${data.resource}`,
    metadata: {
      attemptedAction: data.action,
      resource: data.resource,
      reason: data.reason || 'Insufficient privileges',
    },
    status: 'failure',
    errorMessage: data.reason || 'Insufficient privileges',
  });
}

/**
 * Helper: Log suspicious activity
 * @param {Object} req - Express request
 * @param {Object} data - { activity, severity, details }
 */
async function logSuspiciousActivity(req, data) {
  return logSecurityEvent(req, {
    action: 'security.suspicious.activity',
    description: `Suspicious activity detected: ${data.activity}`,
    metadata: {
      activity: data.activity,
      severity: data.severity || 'medium',
      details: data.details || {},
    },
    status: 'failure',
  });
}

/**
 * Get audit logs for a specific admin (for dashboard display)
 * @param {String} adminId - Admin's user ID
 * @param {Number} limit - Number of logs to return
 * @returns {Promise<Array>}
 */
async function getAdminHistory(adminId, limit = 50) {
  return AuditLog.getAdminHistory(adminId, limit);
}

/**
 * Get audit logs for a specific target
 * @param {String} targetType - Type of target
 * @param {String} targetId - Target ID
 * @param {Number} limit - Number of logs to return
 * @returns {Promise<Array>}
 */
async function getTargetHistory(targetType, targetId, limit = 50) {
  return AuditLog.getTargetHistory(targetType, targetId, limit);
}

/**
 * Search audit logs with filters
 * @param {Object} filters - Search filters
 * @param {Number} page - Page number
 * @param {Number} pageSize - Items per page
 * @returns {Promise<Object>}
 */
async function searchLogs(filters, page = 1, pageSize = 50) {
  return AuditLog.search(filters, page, pageSize);
}

/**
 * Get failed actions for security monitoring
 * @param {Date} since - Get failures since this date
 * @param {Number} limit - Number of logs to return
 * @returns {Promise<Array>}
 */
async function getFailedActions(since, limit = 100) {
  return AuditLog.getFailedActions(since, limit);
}

/**
 * Get suspicious activity patterns
 * @param {Number} hours - Look back this many hours
 * @returns {Promise<Object>}
 */
async function getSuspiciousActivity(hours = 24) {
  return AuditLog.getSuspiciousActivity(hours);
}

/**
 * Wrapper function for logging with error handling
 * Logs the action but doesn't throw if logging fails (fail-safe)
 * @param {Function} logFn - Logging function to call
 * @param {Array} args - Arguments to pass to logging function
 */
async function safeLog(logFn, ...args) {
  try {
    await logFn(...args);
  } catch (err) {
    // This function's entire contract is "never throws" — callers await it in
    // the middle of request handlers, so anything escaping here takes down an
    // operation that has ALREADY happened.
    //
    // It used to do `JSON.stringify(args, null, 2)` here. args[0] is the Express
    // `req`, which is circular (req.res.req), so that threw
    // "Converting circular structure to JSON" from inside this catch block —
    // where nothing catches it. A rejected audit write therefore became a 500
    // for the caller. That is exactly how a successful admin offer blast (push
    // already delivered to every device) still returned "সার্ভারে সমস্যা হয়েছে।"
    //
    // So: log only scalar fields we know are safe, and wrap even that.
    try {
      const data = args.length > 1 ? args[args.length - 1] : null;
      console.error('[AuditLog] Failed to write audit log:', err?.message || err);
      console.error(
        '[AuditLog] action=%s targetType=%s targetId=%s',
        data?.action ?? '(none)',
        data?.targetType ?? '(none)',
        data?.targetId ?? '(none)',
      );
      // A bad `action` is the most likely cause (the field is a hard enum in
      // models/AuditLog.js), so name that explicitly rather than making the
      // next person diff the enum by hand.
      if (err?.name === 'ValidationError' && err.errors?.action) {
        console.error('[AuditLog] → `action` is not in the AuditLog enum:', data?.action);
      }
    } catch {
      // Deliberately empty: a failure to LOG a failure must never propagate.
    }
  }
}

module.exports = {
  // Core logging functions
  log,
  logUserAction,
  logPropertyAction,
  logAdminAction,
  logConfigAction,
  logContentAction,
  logAIAction,
  logSecurityEvent,
  
  // Security-specific helpers
  logFailedLogin,
  logPermissionDenied,
  logSuspiciousActivity,
  
  // Query functions
  getAdminHistory,
  getTargetHistory,
  searchLogs,
  getFailedActions,
  getSuspiciousActivity,
  
  // Utility
  safeLog,
  extractAdminContext,
};
