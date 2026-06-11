const AIGuide = require("../models/AIGuide");
const ApiError = require("../utils/ApiError");

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// @desc    Get all active AI Guides
// @route   GET /api/ai-guides
// @access  Public
exports.getAIGuides = asyncH(async (req, res) => {
	// Public route, fetch only active guides sorted by order
	const guides = await AIGuide.find({ isActive: true }).sort({ order: 1 });
	res.status(200).json(guides);
});

// @desc    Get all AI Guides (for admin)
// @route   GET /api/ai-guides/admin
// @access  Private/Admin
exports.getAllAIGuidesForAdmin = asyncH(async (req, res) => {
	const guides = await AIGuide.find().sort({ order: 1, createdAt: -1 });
	res.status(200).json(guides);
});

// @desc    Create a new AI Guide
// @route   POST /api/ai-guides
// @access  Private/Admin
exports.createAIGuide = asyncH(async (req, res) => {
	const { title, suggestionText, videoUrl, isActive, order } = req.body;

	const newGuide = new AIGuide({
		title,
		suggestionText,
		videoUrl,
		isActive,
		order,
	});

	const savedGuide = await newGuide.save();
	res.status(201).json(savedGuide);
});

// @desc    Update an AI Guide
// @route   PUT /api/ai-guides/:id
// @access  Private/Admin
exports.updateAIGuide = asyncH(async (req, res) => {
	const { title, suggestionText, videoUrl, isActive, order } = req.body;

	const guide = await AIGuide.findById(req.params.id);
	if (!guide) {
		throw ApiError.notFound("AI Guide not found");
	}

	if (title !== undefined) guide.title = title;
	if (suggestionText !== undefined) guide.suggestionText = suggestionText;
	if (videoUrl !== undefined) guide.videoUrl = videoUrl;
	if (isActive !== undefined) guide.isActive = isActive;
	if (order !== undefined) guide.order = order;

	const updatedGuide = await guide.save();
	res.status(200).json(updatedGuide);
});

// @desc    Delete an AI Guide
// @route   DELETE /api/ai-guides/:id
// @access  Private/Admin
exports.deleteAIGuide = asyncH(async (req, res) => {
	const deletedGuide = await AIGuide.findByIdAndDelete(req.params.id);
	if (!deletedGuide) {
		throw ApiError.notFound("AI Guide not found");
	}
	res.status(200).json({ message: "AI Guide removed" });
});
