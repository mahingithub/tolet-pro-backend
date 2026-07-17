'use strict';

const express = require('express');
const ctrl = require('../controllers/sellInterest.controller');
const optionalAuth = require('../middleware/optionalAuth');

const router = express.Router();

// Public: anyone (guest or logged-in) can register interest in selling. Guests
// count toward raw demand; logged-in users get their name/phone attached for
// agency follow-up. The parent mount adds the writeLimiter (spam protection).
router.post('/', optionalAuth, ctrl.recordInterest);

module.exports = router;
