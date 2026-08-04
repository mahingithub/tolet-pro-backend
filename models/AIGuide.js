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
		// Admin-set match keywords (e.g. "বাসা ছাড়া, leave house, notice").
		// The AI chat matches the user's question against these (plus the
		// title/suggestionText) to attach the right walkthrough video.
		keywords: {
			type: [String],
			default: [],
		},
		// Where this guide is shown.
		//  'assistant'    = the floating AI Assistant's suggestion list. This is
		//                   the DEFAULT, so every guide that already exists keeps
		//                   showing in the Assistant exactly as before — no data
		//                   migration needed.
		//  'welcome'      = the post-login Welcome Robot popup.
		//  'how_it_works' = the public "How it Works" page. Combined with
		//                   `audience`, admins build separate tenant / landlord
		//                   video sections (e.g. "How to rent a house").
		//  'support'      = the public "Help & Support" page (e.g. a "How to use
		//                   support" walkthrough video).
		placement: {
			type: String,
			enum: ["assistant", "welcome", "how_it_works", "support", "subscription", "checkout"],
			default: "assistant",
		},
		// Who the guide targets. Used by 'welcome' and 'how_it_works' placements
		// so the right video shows per role. 'all' shows to both roles.
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