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
		// Where this guide is shown.
		//  'assistant' = the floating AI Assistant's suggestion list. This is
		//                the DEFAULT, so every guide that already exists keeps
		//                showing in the Assistant exactly as before — no data
		//                migration needed.
		//  'welcome'   = the post-login Welcome Robot popup.
		placement: {
			type: String,
			enum: ["assistant", "welcome"],
			default: "assistant",
		},
		// Who the guide targets. Used mainly by 'welcome' placement so the robot
		// can pick the right video per role. 'all' shows to both roles.
		audience: {
			type: String,
			enum: ["tenant", "landlord", "all"],
			default: "all",
		},
	},
	{
		timestamps: true,
	}
);

module.exports = mongoose.model("AIGuide", aiGuideSchema);