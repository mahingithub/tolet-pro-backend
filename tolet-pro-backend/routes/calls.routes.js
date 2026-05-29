'use strict';

const express = require('express');
const ctl = require('../controllers/calls.controller');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

router.use(requireAuth);

router.post('/',          ctl.createCall);      // Initiate a call
router.get('/history',    ctl.getCallHistory);   // Call history
router.get('/active',     ctl.getActiveCall);    // Current active call (reconnect)
router.get('/:id',        ctl.getCall);          // Get specific call state

module.exports = router;
