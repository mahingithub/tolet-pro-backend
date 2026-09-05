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
		//  'free_trial_mode' = the Free Pro Trial task popup (listing wizard +
		//                   host dashboard). The video explains the share task
		//                   that unlocks the trial, so admins can swap it
		//                   without a redeploy.
		placement: {
			type: String,
			enum: ["assistant", "welcome", "how_it_works", "support", "subscription", "checkout", "free_trial_mode"],
			default: "assistant",
		},
		// Who the guide targets. Used by 'welcome' and 'how_it_works' placements
		// so the right video shows per role. 'all' shows to both roles.
		audience: {
			type: String,
			enum: ["tenant", "landlord", "all"],
			default: "all",
		},
		// Target device category (mobile, desktop, tablet, desktop_tablet, or all)
		deviceCategory: {
			type: String,
			enum: ["mobile", "desktop", "tablet", "desktop_tablet", "all"],
			default: "all",
		},
	},
	{
		timestamps: true,
	}
);

// ─── Indexes ────────────────────────────────────────────────────────────────
// This collection had none at all. Every guide lookup — and the public one runs
// on page load for anonymous visitors, so it is the query least protected by a
// logged-in user's patience — read the whole collection and sorted it in
// memory. The three read paths all filter on isActive + placement and order by
// `order`, so one index covers them: equality fields first, sort key last.
aiGuideSchema.index({ isActive: 1, placement: 1, order: 1 });
// getGuidesByPlacement additionally narrows by audience.
aiGuideSchema.index({ isActive: 1, placement: 1, audience: 1, order: 1 });

module.exports = mongoose.model("AIGuide", aiGuideSchema);