'use strict';

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { scanLedger } = require('../controllers/aiScanController');

const router = express.Router();

// POST /api/ai/scan-ledger
// Accepts a base64 image of a handwritten rent ledger and returns structured
// tenant data extracted by Gemini Vision.
router.post('/scan-ledger', requireAuth, scanLedger);

// There used to be an unauthenticated GET /test-models here that listed the
// models the AI Studio key could reach, with GEMINI_API_KEY in the query
// string. It is gone: it was public, it leaked the key into any log or proxy
// trace along the way, and since the scanner and the assistant both run on
// Vertex (config/vertex.js) it only ever exercised the fallback backend, not
// the live one. Which backend is actually serving requests is already reported
// at boot by the `[ai-chat] assistant backend:` line in aiChatController.js.

module.exports = router;
