'use strict';

/**
 * appClient.routes.js — mounted at /api/app.
 *
 * POST /api/app/opened         record that this ACCOUNT launched the app  [auth]
 * POST /api/app/device         record that this INSTALL exists            [open]
 * GET  /api/app/tips/pending   a feature tip to show in-app               [open]
 *
 * TWO OF THESE ARE UNAUTHENTICATED, which is the whole point of them: they
 * exist to reach somebody who has installed the app and not signed up, and who
 * is therefore invisible to every other endpoint in this codebase. See
 * models/AnonDevice.js for what is stored (a random id, a push token, and which
 * tour steps have been delivered — nothing that identifies a person).
 *
 * Both are rate limited per IP. They accept a client-supplied `deviceId`, so
 * without a limiter a script could mint unlimited rows; the cap makes that
 * expensive without troubling a real device, which calls each of these at most
 * once per launch.
 */

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { createRateLimiter } = require('../middleware/advancedRateLimiter');
const ctl = require('../controllers/appClient.controller');

const router = express.Router();

// 60 per 15 min per IP. Generous for a real device (one call per launch) and
// still a hard ceiling on row-minting. Bangladeshi carriers put thousands of
// subscribers behind one NAT IP — see the note in advancedRateLimiter — so this
// is deliberately not tight enough to punish a shared address.
const deviceLimiter = createRateLimiter({
  name: 'anon-device',
  windowMs: 15 * 60 * 1000,
  max: 60,
  burst: 20,
  message: 'অনেক বেশি অনুরোধ। কিছুক্ষণ পরে আবার চেষ্টা করুন।',
});

router.post('/opened', requireAuth, ctl.appOpened);
router.post('/device', deviceLimiter, ctl.registerAnonDevice);
router.get('/tips/pending', deviceLimiter, ctl.pendingTip);

module.exports = router;
