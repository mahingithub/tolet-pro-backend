const express = require("express");
const router = express.Router();
const requireAdminAuth = require("../middleware/requireAdminAuth");

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

// Admin routes for managing guides — consumed by the standalone admin console,
// so they require an admin-scoped token (requireAdminAuth). The public GET
// routes above stay open for the consumer app.
router.get("/admin", requireAdminAuth, getAllAIGuidesForAdmin);
router.post("/", requireAdminAuth, createAIGuide);
router.put("/:id", requireAdminAuth, updateAIGuide);
router.delete("/:id", requireAdminAuth, deleteAIGuide);

module.exports = router;