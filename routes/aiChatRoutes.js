const express = require("express");
const router = express.Router();
const { askGemini } = require("../controllers/aiChatController");
const { writeLimiter } = require("../middleware/rateLimiters");

// @route   POST /api/ai-chat/ask
// @desc    Ask a question to Gemini AI
// @access  Public (Rate Limited to prevent spam)
router.post("/ask", writeLimiter, askGemini);

module.exports = router;
