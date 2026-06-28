const express = require("express");
const multer = require("multer");
const router = express.Router();
const { askGemini, transcribeAudio } = require("../controllers/aiChatController");
const { aiLimiter } = require("../middleware/rateLimiters");
const { requireAuth } = require("../middleware/auth");

// Voice clips are tiny; keep them in memory and cap size as a safety net.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// @route   POST /api/ai-chat/ask
// @desc    Ask the AI assistant (can search live listings via tool-calling)
// @access  Private (rate limited — AI calls cost money, so its own tight bucket)
router.post("/ask", requireAuth, aiLimiter, askGemini);

// @route   POST /api/ai-chat/transcribe
// @desc    Bengali speech-to-text for the assistant mic (browsers without Web Speech API)
// @access  Private (rate limited; multipart field "audio")
router.post("/transcribe", requireAuth, aiLimiter, upload.single("audio"), transcribeAudio);

module.exports = router;