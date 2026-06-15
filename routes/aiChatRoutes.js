const express = require("express");
const multer = require("multer");
const router = express.Router();
const { askGemini, transcribeAudio } = require("../controllers/aiChatController");
const { aiLimiter } = require("../middleware/rateLimiters");

// Voice clips are tiny; keep them in memory and cap size as a safety net.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// @route   POST /api/ai-chat/ask
// @desc    Ask the AI assistant (can search live listings via tool-calling)
// @access  Public (rate limited — AI calls cost money, so its own tight bucket)
router.post("/ask", aiLimiter, askGemini);

// @route   POST /api/ai-chat/transcribe
// @desc    Bengali speech-to-text for the assistant mic (browsers without Web Speech API)
// @access  Public (rate limited; multipart field "audio")
router.post("/transcribe", aiLimiter, upload.single("audio"), transcribeAudio);

module.exports = router;