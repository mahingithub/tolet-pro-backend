const express = require("express");
const router = express.Router();
const requireAuth = require("../middleware/requireAuth");
const requireAdmin = require("../middleware/requireAdmin");

const {
	getAIGuides,
	getWelcomeGuides,
	getGuidesByPlacement,
	getAllAIGuidesForAdmin,
	createAIGuide,
	updateAIGuide,
	deleteAIGuide,
} = require("../controllers/aiGuideController");

// Public route for users fetching active guides (AI Assistant)
router.get("/", getAIGuides);

// Public route for the post-login Welcome Robot to fetch its video(s).
// Declared before any "/:id" route so the literal path always wins.
router.get("/welcome", getWelcomeGuides);

// Public route for page sections (How it Works / Support) to fetch their
// videos. Literal "/section" segment, declared before the "/:id" routes.
router.get("/section/:placement", getGuidesByPlacement);

// Admin routes for managing guides
router.get("/admin", requireAuth, requireAdmin, getAllAIGuidesForAdmin);
router.post("/", requireAuth, requireAdmin, createAIGuide);
router.put("/:id", requireAuth, requireAdmin, updateAIGuide);
router.delete("/:id", requireAuth, requireAdmin, deleteAIGuide);

module.exports = router;