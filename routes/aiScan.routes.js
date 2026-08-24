'use strict';

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { scanLedger } = require('../controllers/aiScanController');

const router = express.Router();

// POST /api/ai/scan-ledger
// Accepts a base64 image of a handwritten rent ledger and returns structured
// tenant data extracted by Gemini Vision.
router.post('/scan-ledger', requireAuth, scanLedger);

// Temp debug route: GET /api/ai/test-models
router.get('/test-models', async (req, res) => {
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
    const data = await response.json();
    return res.json({ models: data.models?.map(m => m.name) || data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
