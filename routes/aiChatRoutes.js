const express = require("express");
const multer = require("multer");
const router = express.Router();
const { askGemini, transcribeAudio } = require("../controllers/aiChatController");
const { aiLimiter } = require("../middleware/rateLimiters");
const optionalAuth = require("../middleware/optionalAuth");

// Voice clips are tiny; keep them in memory and cap size as a safety net.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// The assistant answers everyone, signed in or not — someone looking for a flat
// before they have an account is exactly who it is for. Neither handler reads
// req.user, so a login wall bought nothing but a "please sign in" reply.
// optionalAuth still attaches a valid token's user; an expired or forged token
// is treated as a guest rather than refused.
//
// Cost control is the rate limiting, not the login: rateLimiters.ai in server.js
// and aiLimiter here, both per-IP for guests.

// @route   POST /api/ai-chat/ask
// @desc    Ask the AI assistant (can search live listings via tool-calling)
// @access  Public (rate limited — AI calls cost money, so its own tight bucket)
router.post("/ask", optionalAuth, aiLimiter, askGemini);

// @route   POST /api/ai-chat/transcribe
// @desc    Bengali speech-to-text for the assistant mic (browsers without Web Speech API)
// @access  Public (rate limited; multipart field "audio")
router.post("/transcribe", optionalAuth, aiLimiter, upload.single("audio"), transcribeAudio);

module.exports = router;
