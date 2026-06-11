const express = require("express");
const router = express.Router();
const requireAuth = require("../middleware/requireAuth");
const requireAdmin = require("../middleware/requireAdmin");

const {
	getAIGuides,
	getAllAIGuidesForAdmin,
	createAIGuide,
	updateAIGuide,
	deleteAIGuide,
} = require("../controllers/aiGuideController");

// Public route for users fetching active guides
router.get("/", getAIGuides);

// Admin routes for managing guides
router.get("/admin", requireAuth, requireAdmin, getAllAIGuidesForAdmin);
router.post("/", requireAuth, requireAdmin, createAIGuide);
router.put("/:id", requireAuth, requireAdmin, updateAIGuide);
router.delete("/:id", requireAuth, requireAdmin, deleteAIGuide);

module.exports = router;
