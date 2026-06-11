const mongoose = require("mongoose");

const aiGuideSchema = new mongoose.Schema(
	{
		title: {
			type: String,
			required: [true, "Title is required"],
			trim: true,
		},
		suggestionText: {
			type: String,
			required: [true, "Suggestion text is required"],
			trim: true,
		},
		videoUrl: {
			type: String,
			required: [true, "Video URL is required"],
			trim: true,
		},
		isActive: {
			type: Boolean,
			default: true,
		},
		order: {
			type: Number,
			default: 0,
		},
	},
	{
		timestamps: true,
	}
);

module.exports = mongoose.model("AIGuide", aiGuideSchema);
