'use strict';

/**
 * appClient.routes.js — mounted at /api/app.
 *
 * POST /api/app/opened   record that this account launched the app
 *
 * Authenticated: the whole point is to attribute the launch to a user, and an
 * anonymous launch tells the marketing console nothing it can act on.
 */

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const ctl = require('../controllers/appClient.controller');

const router = express.Router();

router.post('/opened', requireAuth, ctl.appOpened);

module.exports = router;
