/**
 * Validates required environment variables at startup.
 * Fails fast with a clear error before the server starts listening.
 */
'use strict';

require('dotenv').config();

const required = ['MONGO_URI', 'JWT_SECRET'];
const missing = required.filter((k) => !process.env[k] || !process.env[k].trim());
if (missing.length) {
  console.error(`[env] Missing required vars: ${missing.join(', ')}`);
  process.exit(1);
}

if (process.env.JWT_SECRET.length < 32) {
  console.error('[env] JWT_SECRET must be at least 32 characters. Generate one with: openssl rand -hex 64');
  process.exit(1);
}

const weakSecrets = ['my_super_secret_key_12345', 'secret', 'changeme', 'default'];
if (weakSecrets.includes(process.env.JWT_SECRET)) {
  console.error('[env] JWT_SECRET is a known-weak value. Rotate it.');
  process.exit(1);
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 5000),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  mongoUri: process.env.MONGO_URI,

  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  resetTokenExpiresIn: process.env.RESET_TOKEN_EXPIRES_IN || '15m',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 12),

  firebaseServiceAccountBase64: process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || '',
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || '',

  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY || '',
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET || '',

  signupIntentTtlMin: Number(process.env.SIGNUP_INTENT_TTL_MIN || 15),
  resetOtpTtlMin: Number(process.env.RESET_OTP_TTL_MIN || 10),
  loginMaxAttempts: Number(process.env.LOGIN_MAX_ATTEMPTS || 5),
  loginLockMinutes: Number(process.env.LOGIN_LOCK_MINUTES || 15),
};

env.isProd = env.nodeEnv === 'production';

module.exports = env;