'use strict';

/**
 * Loaded by jest.config.js BEFORE any test file or app module.
 *
 * config/env.js validates required secrets at require-time and throws if they
 * are missing, so tests need deterministic dummy values in place first. These
 * are never real credentials — they exist only to get past validation.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-'.padEnd(48, 'x');
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-'.padEnd(48, 'y');

// Keep third-party integrations dark during tests: no SMS, no WhatsApp, no
// Facebook posting, no cron. Each service no-ops when its key is absent.
process.env.SMS_API_KEY = '';
process.env.WHATSAPP_ACCESS_TOKEN = '';
process.env.WHATSAPP_PHONE_NUMBER_ID = '';
process.env.FACEBOOK_PAGE_ACCESS_TOKEN = '';
process.env.FACEBOOK_PAGE_ID = '';
process.env.CRON_TEST = '';
