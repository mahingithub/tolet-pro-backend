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
 * - GET  /me      requires a valid admin token; hydrates the console
 * - POST /logout  requires a valid admin token; revokes the session
 */

const express = require('express');
const ctl = require('../controllers/admin.auth.controller');
const requireAdminAuth = require('../middleware/requireAdminAuth');
const { authLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

router.post('/login', authLimiter, ctl.login);
router.get('/me', requireAdminAuth, ctl.me);
router.post('/logout', requireAdminAuth, ctl.logout);

module.exports = router;
