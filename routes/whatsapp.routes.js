'use strict';

const express = require('express');
const router = express.Router();
const { verifyWebhook, receiveWebhook } = require('../controllers/whatsapp.controller');

// Parse JSON for the POST body AND stash the exact raw bytes on req.rawBody so
// the controller can verify Meta's X-Hub-Signature-256 HMAC (which is computed
// over the raw payload — reparsing/serialising would change the bytes). Scoped
// to THIS router only; the app's global express.json() does not capture raw.
const jsonWithRaw = express.json({
	limit: '1mb', // WhatsApp webhook payloads are a few KB; 1mb is ample.
	verify: (req, _res, buf) => {
		req.rawBody = buf;
	},
});

// GET  → Meta verification handshake (query params only, no body parser needed).
router.get('/webhook', verifyWebhook);

// POST → live events (incoming messages + delivery/read statuses).
router.post('/webhook', jsonWithRaw, receiveWebhook);

module.exports = router;
