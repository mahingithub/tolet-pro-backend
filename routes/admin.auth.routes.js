'use strict';

/**
 * Dedicated auth routes for the standalone admin console.
 *
 * Mounted in server.js at:
 *   app.use('/api/admin/auth', require('./routes/admin.auth.routes'));
 * IMPORTANT: this MUST be registered BEFORE `app.use('/api/admin', ...)` so
 * the public /login endpoint isn't swallowed by the admin router's
 * requireAdminAuth gate.
 *
 * - POST /login   public, rate-limited; issues an admin-scoped token
 * - POST /refresh public; rotates the adminRefreshToken cookie into a new
 *                 admin-scoped access token (must work AFTER the old one
 *                 expired, so it cannot sit behind requireAdminAuth)
 * - GET  /me      requires a valid admin token; hydrates the console
 * - POST /logout  requires a valid admin token; revokes the session
 */

const express = require('express');
const ctl = require('../controllers/admin.auth.controller');
const requireAdminAuth = require('../middleware/requireAdminAuth');
const { authLimiter } = require('../middleware/rateLimiters');
const rl = require('../middleware/rateLimit');

const router = express.Router();

router.post('/login', authLimiter, ctl.login);
router.post('/verify-2fa-login', authLimiter, ctl.verify2FALogin);
router.post('/refresh', rl.refresh, ctl.refresh);
router.get('/me', requireAdminAuth, ctl.me);
router.post('/logout', requireAdminAuth, ctl.logout);

// Account settings — the admin manages their own profile + password.
router.patch('/me', requireAdminAuth, ctl.updateMe);
router.post('/change-password', requireAdminAuth, authLimiter, ctl.changePassword);

// 2FA / Google Authenticator setup endpoints
router.post('/2fa/generate', requireAdminAuth, ctl.generate2FASecret);
router.post('/2fa/enable', requireAdminAuth, ctl.enable2FA);
router.post('/2fa/disable', requireAdminAuth, authLimiter, ctl.disable2FA);

module.exports = router;
