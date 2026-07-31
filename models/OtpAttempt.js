'use strict';

const mongoose = require('mongoose');

/**
 * OtpAttempt — Multi-dimensional OTP abuse tracking
 * ═══════════════════════════════════════════════════════════════════════════
 * Tracks OTP requests across three dimensions to prevent abuse:
 * 
 * 1. IP Address - Stops single-source attacks
 * 2. Phone Number - Stops SMS bombing of specific victims
 * 3. Device Fingerprint - Stops sophisticated attackers rotating IPs
 * 
 * ABUSE DETECTION STRATEGY:
 * - Track attempts separately per dimension
 * - Escalate enforcement: warn → delay → CAPTCHA → block
 * - Reset counters after cooldown period
 * - Log suspicious patterns for monitoring
 * 
 * TTL: Documents auto-delete after 24 hours to prevent unbounded growth
 * ═══════════════════════════════════════════════════════════════════════════
 */
const OtpAttemptSchema = new mongoose.Schema(
  {
    // ═══ TRACKING DIMENSIONS ═══════════════════════════════════════════════
    
    // IP address - primary defense
    ipAddress: {
      type: String,
      required: true,
      index: true,
    },
    
    // Phone number - protects victims from SMS bombing
    phoneNumber: {
      type: String,
      required: true,
      index: true,
    },
    
    // Device fingerprint - catches sophisticated attackers
    // Generated from User-Agent + Accept-Language + screen dimensions + timezone
    deviceFingerprint: {
      type: String,
      default: null,
      index: true,
    },
    
    // ═══ ATTEMPT TRACKING ══════════════════════════════════════════════════
    
    // Number of OTP requests in current window
    requestCount: {
      type: Number,
      default: 1,
      min: 0,
    },
    
    // Number of failed OTP verifications
    failedVerifications: {
      type: Number,
      default: 0,
      min: 0,
    },
    
    // Last request timestamp - for rate calculation
    lastRequestAt: {
      type: Date,
      default: Date.now,
    },
    
    // ═══ ENFORCEMENT STATE ═════════════════════════════════════════════════
    
    // Current enforcement level: none, warning, delay, captcha, blocked
    enforcementLevel: {
      type: String,
      enum: ['none', 'warning', 'delay', 'captcha', 'blocked'],
      default: 'none',
    },
    
    // When the current block/cooldown expires
    blockedUntil: {
      type: Date,
      default: null,
    },
    
    // CAPTCHA required flag
    requiresCaptcha: {
      type: Boolean,
      default: false,
    },
    
    // ═══ ABUSE INDICATORS ══════════════════════════════════════════════════
    
    // Pattern detected (for monitoring/alerting)
    abusePattern: {
      type: String,
      enum: [null, 'rapid_fire', 'phone_enumeration', 'sms_bombing', 'distributed_attack'],
      default: null,
    },
    
    // Suspicious activity flag (triggers monitoring alert)
    flaggedForReview: {
      type: Boolean,
      default: false,
    },
    
    // Additional context for forensics
    metadata: {
      userAgent: { type: String, default: null, maxlength: 500 },
      country: { type: String, default: null, maxlength: 2 },
      city: { type: String, default: null, maxlength: 100 },
    },
    
    // TTL: auto-delete after 24 hours to prevent unbounded growth
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 86400, // 24 hours
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// ═══ COMPOUND INDEXES FOR EFFICIENT LOOKUPS ═══════════════════════════════

// Find by IP + phone (most common query)
OtpAttemptSchema.index({ ipAddress: 1, phoneNumber: 1 });

// Find flagged records for monitoring
OtpAttemptSchema.index({ flaggedForReview: 1, createdAt: -1 });

// Find blocked IPs/phones
OtpAttemptSchema.index({ enforcementLevel: 1, blockedUntil: 1 });

module.exports = mongoose.model('OtpAttempt', OtpAttemptSchema);
