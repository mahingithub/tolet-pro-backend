/**
 * aiGuidePlacements.js — where an admin-managed video guide can appear.
 * ─────────────────────────────────────────────────────────────────────────────
 * One list, read by the AIGuide model (enum), the public section endpoint
 * (allowlist) and the AI Assistant feed (exclusion). They used to be three
 * hand-copied literals, and a placement added to one but not the others
 * either failed validation or leaked page videos into the chat's suggestions.
 *
 * FEATURE_PLACEMENTS are the explainer videos — one per feature, shown on
 * every screen that explains that feature (homepage card, its landing page,
 * /to-let for search). The screens keep text to one line; the video explains.
 */

const FEATURE_PLACEMENTS = [
	"feature_search",          // homepage card, /to-let
	"feature_mess",            // homepage card, /meal-manager
	"feature_rent_book",       // homepage card, /tenant-manager
	"feature_roommate_wallet", // /roommate-wallet
	"feature_house_manager",   // /house-manager
	"feature_home_services",   // /home-services
];

/** Fetchable by anyone through GET /api/ai-guides/section/:placement. */
const SECTION_PLACEMENTS = [
	"how_it_works", "support", "subscription", "checkout", "free_trial_mode",
	...FEATURE_PLACEMENTS,
];

const ALL_PLACEMENTS = ["assistant", "welcome", ...SECTION_PLACEMENTS];

module.exports = { FEATURE_PLACEMENTS, SECTION_PLACEMENTS, ALL_PLACEMENTS };
