'use strict';

/**
 * Login History Service
 * 
 * Centralizes login history tracking with automatic device detection,
 * geographic parsing, and suspicious activity detection.
 * 
 * Usage:
 *   const loginHistory = require('../services/loginHistory.service');
 *   
 *   await loginHistory.recordSuccessfulLogin(req, user, sessionId);
 *   await loginHistory.recordFailedLogin(req, phone, reason);
 */

const LoginHistory = require('../models/LoginHistory');

/**
 * Parse user agent string to extract device, browser, OS info
 * @param {String} userAgent - User agent string
 * @returns {Object} - { device, browser, os, deviceType }
 */
function parseUserAgent(userAgent) {
  if (!userAgent) {
    return {
      device: 'Unknown',
      browser: 'Unknown',
      os: 'Unknown',
      deviceType: 'unknown',
    };
  }

  const ua = userAgent.toLowerCase();
  
  // Detect device type
  let deviceType = 'desktop';
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(userAgent)) {
    deviceType = 'tablet';
  } else if (/mobile|iphone|ipod|blackberry|opera mini|opera mobi|iemobile|wpdesktop/i.test(userAgent)) {
    deviceType = 'mobile';
  }
  
  // Detect OS
  let os = 'Unknown';
  if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('iphone') || ua.includes('ipad')) os = 'iOS';
  else if (ua.includes('mac')) os = 'macOS';
  else if (ua.includes('linux')) os = 'Linux';
  
  // Detect browser
  let browser = 'Unknown';
  if (ua.includes('edg/')) browser = 'Edge';
  else if (ua.includes('chrome')) browser = 'Chrome';
  else if (ua.includes('safari') && !ua.includes('chrome')) browser = 'Safari';
  else if (ua.includes('firefox')) browser = 'Firefox';
  else if (ua.includes('opera') || ua.includes('opr/')) browser = 'Opera';
  
  // Device name
  const device = `${browser} on ${os}`;
  
  return { device, browser, os, deviceType };
}

/**
 * Extract geographic info from IP (placeholder - would use GeoIP service)
 * @param {String} ipAddress - IP address
 * @returns {Promise<Object>} - { country, city, region, isp }
 */
async function getGeographicInfo(ipAddress) {
  // Placeholder - in production, use a GeoIP service like:
  // - MaxMind GeoIP2
  // - ipapi.co
  // - ip-api.com
  // 
  // For now, return Bangladesh as default
  if (!ipAddress || ipAddress === '::1' || ipAddress.startsWith('127.')) {
    return {
      country: 'Bangladesh',
      city: 'Dhaka',
      region: 'Dhaka Division',
      isp: 'Local',
    };
  }
  
  // TODO: Implement actual GeoIP lookup
  // Example:
  // const response = await axios.get(`https://ipapi.co/${ipAddress}/json/`);
  // return {
  //   country: response.data.country_name,
  //   city: response.data.city,
  //   region: response.data.region,
  //   isp: response.data.org,
  // };
  
  return {
    country: 'Bangladesh',
    city: 'Unknown',
    region: 'Unknown',
    isp: 'Unknown',
  };
}

/**
 * Record a successful login
 * @param {Object} req - Express request
 * @param {Object} user - User object
 * @param {String} sessionId - Session ID
 * @param {Object} options - Additional options
 * @returns {Promise<LoginHistory>}
 */
async function recordSuccessfulLogin(req, user, sessionId, options = {}) {
  const userAgent = req.headers['user-agent'] || 'Unknown';
  const ipAddress = req.ip || req.connection?.remoteAddress || '0.0.0.0';
  
  const deviceInfo = parseUserAgent(userAgent);
  const geoInfo = await getGeographicInfo(ipAddress);
  
  // Detect suspicious login
  const suspicionAnalysis = await LoginHistory.detectSuspiciousLogin(user._id, {
    country: geoInfo.country,
    device: deviceInfo.device,
  });
  
  const data = {
    userId: user._id,
    userPhone: user.phone,
    userName: user.name || 'Unknown',
    userRole: user.role || 'tenant',
    loginType: options.loginType || 'password',
    status: 'success',
    sessionId,
    device: deviceInfo.device,
    browser: deviceInfo.browser,
    os: deviceInfo.os,
    deviceType: deviceInfo.deviceType,
    userAgent,
    ipAddress,
    country: geoInfo.country,
    city: geoInfo.city,
    region: geoInfo.region,
    isp: geoInfo.isp,
    isSuspicious: suspicionAnalysis.isSuspicious,
    suspiciousReasons: suspicionAnalysis.reasons,
    metadata: options.metadata || {},
  };
  
  return LoginHistory.recordLogin(data);
}

/**
 * Record a failed login attempt
 * @param {Object} req - Express request
 * @param {String} phone - Phone number attempted
 * @param {String} reason - Failure reason
 * @param {Object} options - Additional options
 * @returns {Promise<LoginHistory>}
 */
async function recordFailedLogin(req, phone, reason, options = {}) {
  const userAgent = req.headers['user-agent'] || 'Unknown';
  const ipAddress = req.ip || req.connection?.remoteAddress || '0.0.0.0';
  
  const deviceInfo = parseUserAgent(userAgent);
  const geoInfo = await getGeographicInfo(ipAddress);
  
  // Try to find user by phone for history
  const User = require('../models/User');
  const user = await User.findOne({ phone }).select('_id name role');
  
  const data = {
    userId: user?._id || null,
    userPhone: phone,
    userName: user?.name || 'Unknown',
    userRole: user?.role || 'tenant',
    loginType: options.loginType || 'password',
    status: 'failed',
    failureReason: reason,
    device: deviceInfo.device,
    browser: deviceInfo.browser,
    os: deviceInfo.os,
    deviceType: deviceInfo.deviceType,
    userAgent,
    ipAddress,
    country: geoInfo.country,
    city: geoInfo.city,
    region: geoInfo.region,
    isp: geoInfo.isp,
    isSuspicious: false, // Failed logins are inherently suspicious
    metadata: options.metadata || {},
  };
  
  return LoginHistory.recordLogin(data);
}

/**
 * Record logout
 * @param {String} sessionId - Session ID
 * @returns {Promise<Object>}
 */
async function recordLogout(sessionId) {
  if (!sessionId) return { modifiedCount: 0 };
  return LoginHistory.recordLogout(sessionId);
}

/**
 * Update last active time
 * @param {String} sessionId - Session ID
 * @returns {Promise<Object>}
 */
async function updateActivity(sessionId) {
  if (!sessionId) return { modifiedCount: 0 };
  return LoginHistory.updateActivity(sessionId);
}

/**
 * Get login history for a user
 * @param {String} userId - User ID
 * @param {Number} limit - Number of records
 * @returns {Promise<Array>}
 */
async function getUserHistory(userId, limit = 50) {
  return LoginHistory.getUserHistory(userId, limit);
}

/**
 * Get active sessions for a user
 * @param {String} userId - User ID
 * @returns {Promise<Array>}
 */
async function getActiveSessions(userId) {
  return LoginHistory.getActiveSessions(userId);
}

/**
 * Get failed login attempts for a user
 * @param {String} userId - User ID
 * @param {Number} minutes - Time window
 * @returns {Promise<Number>}
 */
async function getFailedAttempts(userId, minutes = 30) {
  return LoginHistory.getFailedAttempts(userId, minutes);
}

/**
 * Get failed attempts from an IP
 * @param {String} ipAddress - IP address
 * @param {Number} minutes - Time window
 * @returns {Promise<Number>}
 */
async function getFailedAttemptsFromIP(ipAddress, minutes = 30) {
  return LoginHistory.getFailedAttemptsFromIP(ipAddress, minutes);
}

/**
 * Get suspicious logins
 * @param {Number} hours - Look back hours
 * @returns {Promise<Array>}
 */
async function getSuspiciousLogins(hours = 24) {
  return LoginHistory.getSuspiciousLogins(hours);
}

/**
 * Check if IP or user should be rate-limited based on failed attempts
 * @param {Object} req - Express request
 * @param {String} userId - User ID (optional)
 * @returns {Promise<Object>} - { shouldBlock, reason }
 */
async function checkRateLimit(req, userId = null) {
  const ipAddress = req.ip || req.connection?.remoteAddress || '0.0.0.0';
  
  // Check IP-based rate limit (5 failed attempts in 15 minutes)
  const ipFailures = await getFailedAttemptsFromIP(ipAddress, 15);
  if (ipFailures >= 5) {
    return {
      shouldBlock: true,
      reason: 'Too many failed login attempts from this IP address',
      retryAfter: 15, // minutes
    };
  }
  
  // Check user-based rate limit if userId provided (3 failed attempts in 10 minutes)
  if (userId) {
    const userFailures = await getFailedAttempts(userId, 10);
    if (userFailures >= 3) {
      return {
        shouldBlock: true,
        reason: 'Too many failed login attempts for this account',
        retryAfter: 10, // minutes
      };
    }
  }
  
  return { shouldBlock: false };
}

/**
 * Wrapper for safe logging (fail-safe)
 * @param {Function} logFn - Logging function
 * @param {Array} args - Arguments
 */
async function safeLog(logFn, ...args) {
  try {
    await logFn(...args);
  } catch (err) {
    console.error('[LoginHistory] Failed to write login history:', err.message);
    // Avoid JSON.stringify on args as they often contain circular Express req objects
  }
}

module.exports = {
  recordSuccessfulLogin,
  recordFailedLogin,
  recordLogout,
  updateActivity,
  getUserHistory,
  getActiveSessions,
  getFailedAttempts,
  getFailedAttemptsFromIP,
  getSuspiciousLogins,
  checkRateLimit,
  safeLog,
  parseUserAgent,
  getGeographicInfo,
};
