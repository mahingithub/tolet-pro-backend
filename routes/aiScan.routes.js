'use strict';

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { scanLedger } = require('../controllers/aiScanController');

const router = express.Router();

// POST /api/ai/scan-ledger
// Accepts a base64 image of a handwritten rent ledger and returns structured
// tenant data extracted by Gemini Vision.
router.post('/scan-ledger', requireAuth, scanLedger);

module.exports = router;
