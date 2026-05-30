'use strict';

const express = require('express');
const ctl = require('../controllers/calls.controller');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

router.use(requireAuth);

router.post('/',           ctl.createCall);      // Initiate a call
router.post('/zego-token', ctl.zegoToken);       // Phase Call-3: media token
router.post('/mark-seen',  ctl.markSeen);        // Phase Call-4: clear missed badge
router.get('/history',     ctl.getCallHistory);  // Call history
router.get('/active',      ctl.getActiveCall);    // Current active call (reconnect)
router.get('/:id',         ctl.getCall);          // Get specific call state (keep last)
router.delete('/:id',      ctl.deleteCall);       // Phase Call-4: per-user soft delete

module.exports = router;
