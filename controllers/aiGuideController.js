const AIGuide = require("../models/AIGuide");
const ApiError = require("../utils/ApiError");

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// @desc    Get all active AI Guides for the floating AI Assistant
// @route   GET /api/ai-guides
// @access  Public
exports.getAIGuides = asyncH(async (req, res) => {
	// Public route → only active guides, sorted by order.
	//
	// IMPORTANT: we must EXCLUDE Welcome-Robot guides here, otherwise the
	// welcome videos would leak into the Assistant's suggestion list.
	// We filter with { $ne: "welcome" } rather than { placement: "assistant" }
	// on purpose: guides created before this feature existed have NO placement
	// field at all in MongoDB (the schema default only applies on save, not to
	// old documents). `$ne: "welcome"` matches both "assistant" guides AND those
	// older field-less guides, so nothing disappears from the Assistant.
	const guides = await AIGuide.find({
		isActive: true,
		placement: { $ne: "welcome" },
	}).sort({ order: 1 });
	res.status(200).json(guides);
});

// @desc    Get active Welcome-Robot guides (shown in the post-login popup)
// @route   GET /api/ai-guides/welcome?audience=tenant|landlord
// @access  Public
exports.getWelcomeGuides = asyncH(async (req, res) => {
	const { audience } = req.query;
	const filter = { isActive: true, placement: "welcome" };

	// If a valid role is given, return guides for that role PLUS "all"-audience
	// guides. Anything else → return every active welcome guide.
	if (audience === "tenant" || audience === "landlord") {
		filter.audience = { $in: [audience, "all"] };
	}

	const guides = await AIGuide.find(filter).sort({ order: 1 });
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
	const { title, suggestionText, videoUrl, isActive, order, placement, audience } = req.body;

	const newGuide = new AIGuide({
		title,
		suggestionText,
		videoUrl,
		isActive,
		order,
		placement,
		audience,
	});

	const savedGuide = await newGuide.save();
	res.status(201).json(savedGuide);
});

// @desc    Update an AI Guide
// @route   PUT /api/ai-guides/:id
// @access  Private/Admin
exports.updateAIGuide = asyncH(async (req, res) => {
	const { title, suggestionText, videoUrl, isActive, order, placement, audience } = req.body;

	const guide = await AIGuide.findById(req.params.id);
	if (!guide) {
		throw ApiError.notFound("AI Guide not found");
	}

	if (title !== undefined) guide.title = title;
	if (suggestionText !== undefined) guide.suggestionText = suggestionText;
	if (videoUrl !== undefined) guide.videoUrl = videoUrl;
	if (isActive !== undefined) guide.isActive = isActive;
	if (order !== undefined) guide.order = order;
	if (placement !== undefined) guide.placement = placement;
	if (audience !== undefined) guide.audience = audience;

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