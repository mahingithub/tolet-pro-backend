// Defensive import so this works across @google/generative-ai versions:
// newer SDKs export `SchemaType`, older ones `FunctionDeclarationSchemaType`.
// Both enums use the same lowercase string values, so the literal fallback is
// safe if neither is present.
const GenAI = require("@google/generative-ai");
const { GoogleGenerativeAI } = GenAI;
const SchemaType =
	GenAI.SchemaType ||
	GenAI.FunctionDeclarationSchemaType ||
	{ OBJECT: "object", STRING: "string", NUMBER: "number", INTEGER: "integer", BOOLEAN: "boolean", ARRAY: "array" };

const ApiError = require("../utils/ApiError");
const Property = require("../models/Property");
const AIGuide = require("../models/AIGuide");
const searchService = require("../services/searchService");

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Initialize Gemini client. It picks up GEMINI_API_KEY from the environment.
// If the key is missing, this fails gracefully when a request is made.
let ai = null;
try {
	if (process.env.GEMINI_API_KEY) {
		ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
	}
} catch (err) {
	console.error("Failed to initialize GoogleGenerativeAI. Is GEMINI_API_KEY set?", err);
}

// ── Property-search tool ────────────────────────────────────────────────────
// Enum values mirror models/Property.js EXACTLY so Gemini can only emit filters
// the database understands. Keep these in lockstep with the model if the enums
// ever change.
const DIVISIONS  = ['dhaka', 'chittagong', 'sylhet', 'rajshahi', 'khulna', 'barishal', 'rangpur', 'mymensingh'];
const TYPES      = ['flat', 'apartment', 'sublet', 'hostel', 'single_room', 'independent', 'house', 'duplex', 'studio', 'penthouse', 'land', 'building', 'office', 'shop', 'showroom', 'restaurant'];
const CATEGORIES = ['family', 'bachelor_male', 'bachelor_female', 'sublet', 'student', 'ready_flat', 'used', 'new_project', 'investment', 'corporate', 'startup', 'retail', 'warehouse'];
const INTENTS    = ['rent', 'sale', 'commercial'];

const searchPropertiesTool = {
	functionDeclarations: [
		{
			name: "search_properties",
			description:
				"Search TO-LET PRO's LIVE rental/sale property listings in Bangladesh. " +
				"Call this whenever the user is looking for a property — a flat, room, house, office, shop, etc. — " +
				"or asks what's available in some area or budget. " +
				"Translate Bengali terms to the English enum values (e.g. 'ঢাকা' -> 'dhaka', 'ফ্যামিলি' -> 'family', " +
				"'ব্যাচেলর' -> 'bachelor_male', 'ভাড়া' -> 'rent', 'বিক্রি' -> 'sale'). " +
				"Put specific neighbourhood/area/landmark names (e.g. Dhanmondi, Mirpur, Gulshan, Uttara) into 'q'. " +
				"Omit any field you are unsure about instead of guessing.",
			parameters: {
				type: SchemaType.OBJECT,
				properties: {
					q:        { type: SchemaType.STRING, description: "Free-text keywords: specific area/neighbourhood/landmark names, or anything the other fields don't cover. Map spelling variants to one canonical area name (e.g. Dhanmondi/ধানমন্ডি/Dhanmondi 27, Mirpur/মিরপুর/Mirpur 10, Uttara/উত্তরা, Mohammadpur/মোহাম্মদপুর, Bashundhara/বসুন্ধরা, Gulshan/গুলশান, Banani/বনানী)." },
					division: { type: SchemaType.STRING, enum: DIVISIONS, description: "Administrative division (major city region)." },
					type:     { type: SchemaType.STRING, enum: TYPES, description: "Property type." },
					category: { type: SchemaType.STRING, enum: CATEGORIES, description: "Who/what the listing is for (family, bachelor, student, corporate, etc.)." },
					intent:   { type: SchemaType.STRING, enum: INTENTS, description: "Listing intent: 'rent' to rent, 'sale' to buy, 'commercial' for commercial space." },
					minPrice: { type: SchemaType.NUMBER, description: "Minimum price in BDT (Taka). Normalize first: Bengali numerals (০-৯) and words (হাজার = thousand, লক্ষ/লাখ = lakh) to plain digits, and shorthand like '20k'/'২০k' -> 20000 or '1.5 lac' -> 150000." },
					maxPrice: { type: SchemaType.NUMBER, description: "Maximum price in BDT (Taka). Normalize the same way as minPrice (Bengali numerals/words and shorthand to plain digits). A single bare number with no range (e.g. 'around 15000') should be treated as maxPrice." },
					beds:     { type: SchemaType.NUMBER, description: "Minimum number of bedrooms (the 'bedrooms' count from the request). Convert Bengali numerals (০-৯) to plain digits first." },
					baths:    { type: SchemaType.NUMBER, description: "Minimum number of bathrooms." },
				},
			},
		},
	],
};

// ── Video-guide tool ─────────────────────────────────────────────────────────
// Lets Gemini attach ONE admin-published walkthrough video to its answer when
// the user asks how to do something the video covers (e.g. "how do I rent a
// house?"). The catalogue of available guides (id + title + suggestion) is
// injected into the system instruction per-request, so Gemini only ever has
// real ids to choose from. We still validate the returned id server-side.
const suggestVideoGuideDecl = {
	name: "suggest_video_guide",
	description:
		"Attach a published help/walkthrough video to your answer when it clearly helps the user learn how to do " +
		"something on TO-LET PRO (how to find/rent a home, how to list a property, how to pay rent, how to use a " +
		"feature, etc.). Use ONLY an id from the VIDEO GUIDES list in the system instruction. Attach at most one, " +
		"and only when it clearly matches what the user is trying to do.",
	parameters: {
		type: SchemaType.OBJECT,
		properties: {
			guideId: {
				type: SchemaType.STRING,
				description: "The id of the guide to attach — must be one of the ids listed under VIDEO GUIDES.",
			},
		},
		required: ["guideId"],
	},
};

// ── In-app action buttons ────────────────────────────────────────────────────
// Fixed catalogue of real app pages the assistant may attach as tap-to-go
// buttons under its answer (like a support agent sharing a direct link).
// Only these ids/routes ever reach the client — a hallucinated id is dropped.
const APP_ACTIONS = {
	list_property:     { route: "/list-property",               en: "Add Property",       bn: "বাড়ি যোগ করুন" },
	browse_properties: { route: "/properties/all",              en: "Browse Properties",  bn: "বাসা খুঁজুন" },
	tenant_dashboard:  { route: "/tenant-dashboard",            en: "Tenant Dashboard",   bn: "ভাড়াটিয়া ড্যাশবোর্ড" },
	host_dashboard:    { route: "/host-dashboard",              en: "Landlord Dashboard", bn: "বাড়িওয়ালা ড্যাশবোর্ড" },
	messages:          { route: "/messages",                    en: "Messages",           bn: "মেসেজ" },
	saved_properties:  { route: "/tenant-dashboard?tab=saved",  en: "Saved Properties",   bn: "সেভ করা বাড়ি" },
	smart_alerts:      { route: "/smart-alerts",                en: "My Alerts",          bn: "আমার অ্যালার্ট" },
	support:           { route: "/support",                     en: "Help & Support",     bn: "সহায়তা ও সাপোর্ট" },
	how_it_works:      { route: "/how-it-works",                en: "How it Works",       bn: "কীভাবে কাজ করে" },
};

const suggestAppActionsDecl = {
	name: "suggest_app_actions",
	description:
		"Attach up to 2 in-app navigation buttons under your answer so the user can jump straight to the page you " +
		"just told them about (like a support agent sharing a direct link). Use whenever your answer tells the user " +
		"to go somewhere or press something — e.g. a how-to answer about listing a property should attach " +
		"'list_property'. Only ids from the fixed list are valid.",
	parameters: {
		type: SchemaType.OBJECT,
		properties: {
			actionIds: {
				type: SchemaType.ARRAY,
				items: { type: SchemaType.STRING, enum: Object.keys(APP_ACTIONS) },
				description: "1–2 action ids, most relevant first.",
			},
		},
		required: ["actionIds"],
	},
};

// Execute the search the AI asked for, REUSING the same buildSearchFilter the
// rest of the app uses. OOM-safe: the aggregation collapses any legacy base64
// coverPhoto to '' inside Mongo, so it never loads into Node memory (matches the
// hardening already applied across property/inquiry services).
async function runPropertySearch(args = {}) {
	const filterInput = {};
	if (args.q)        filterInput.q        = String(args.q);
	if (args.division) filterInput.division = String(args.division).toLowerCase();
	if (args.type)     filterInput.type     = String(args.type);
	if (args.category) filterInput.category = String(args.category);
	if (args.intent)   filterInput.intent   = String(args.intent);
	if (args.minPrice != null) filterInput.minPrice = args.minPrice;
	if (args.maxPrice != null) filterInput.maxPrice = args.maxPrice;

	const filter = searchService.buildSearchFilter(filterInput);
	if (!filter.status) filter.status = "active"; // only surface live listings

	if (args.beds  != null && Number.isFinite(+args.beds))  filter.beds  = { $gte: +args.beds };
	if (args.baths != null && Number.isFinite(+args.baths)) filter.baths = { $gte: +args.baths };

	const sort = searchService.buildSortOptions("newest");

	const docs = await Property.aggregate([
		{ $match: filter },
		{ $sort: sort },
		{ $limit: 6 },
		{
			$project: {
				title: 1, price: 1, beds: 1, baths: 1, sqft: 1,
				type: 1, category: 1, intent: 1, division: 1,
				location: 1, area: 1, district: 1,
				coverPhoto: {
					$cond: [
						{ $regexMatch: { input: { $ifNull: ["$coverPhoto", ""] }, regex: /^https?:\/\//i } },
						"$coverPhoto",
						"",
					],
				},
			},
		},
	]);

	return docs.map((d) => ({
		id:         String(d._id),
		title:      d.title || "Property",
		price:      d.price ?? null,
		beds:       d.beds ?? null,
		baths:      d.baths ?? null,
		sqft:       d.sqft ?? null,
		type:       d.type || "",
		location:   [d.location, d.area, d.district].filter(Boolean)[0] || "",
		coverPhoto: d.coverPhoto || "",
	}));
}

const SYSTEM_INSTRUCTION = `You are the TO-LET PRO Assistant — a personal property-search helper for people renting or listing property in Bangladesh through the TO-LET PRO app. Act like a sharp, helpful human assistant, not a generic chatbot.

LANGUAGE & TONE

- Reply in the same language/register the user used. Bengali in → natural Bengali out. English in → English out. Mixed/Banglish → mirror it naturally.

- Be warm but brief. No "As an AI..." disclaimers, no filler like "Sure, I'd be happy to help!" — get to the useful part in the first sentence.

GROUNDING RULES (never break these)

1. Never invent a property, price, address, owner name, or amenity. Every specific detail about a listing must come from an actual search_properties tool result earlier in this conversation.

2. Never answer from "typical prices in this area" or general real-estate knowledge as if it were live data. If you haven't called the tool, you have no listings to describe.

3. For general platform/legal questions you're not fully certain about (deposit rules, rental law, how to verify an owner, refund policy), say so plainly and point the user to TO-LET PRO support or the Help section — do not guess at policy details.

4. If a message looks like a voice-transcription with a likely error (an odd, out-of-context word breaking an otherwise clear sentence), don't treat that word as a literal area/price — ask a quick one-line confirmation instead of guessing.

SEARCH FLOW (follow in order)

1. Extract what you can: area, budget (min/max), property type, tenant category, bedrooms.

2. If area AND budget are both missing or too vague ("cheap", "somewhere nice"), ask ONE short clarifying question before searching — don't guess. Example: "কোন এলাকায় খুঁজছেন, আর বাজেট কত?"

3. If the user skips the clarifying question ("just show me", "jaw ache dekhao"), proceed with a best-effort search on whatever filters you have, and mention the results may be broad.

4. Before calling the tool, confirm your understanding in one line: "Searching: Dhanmondi, ৳15,000–20,000, family flat, 2 bed"

5. Call search_properties with normalized filters (see NORMALIZATION below).

6. On results:

   - Found: one short natural sentence, then let the property cards render. Don't restate fields already visible on the cards.

   - Zero results: say so plainly, suggest exactly ONE adjustment (nearby area / wider budget / different type), and ask if they want you to try it.

   - matchQuality = "nearby": explicitly tell the user these are close matches, not exact-area matches.

NORMALIZATION (apply before calling the tool)

- Bengali numerals (০-৯) and words (হাজার = thousand, লক্ষ/লাখ = lakh) → plain digits.

- Shorthand: "20k"/"২০k" → 20000, "1.5 lac" → 150000.

- A single number with no range ("around 15000") → treat as maxPrice.

- Map spelling variants to one canonical area name (Dhanmondi/ধানমন্ডি/Dhanmondi 27, Mirpur/মিরপুর/Mirpur 10, Uttara/উত্তরা, Mohammadpur/মোহাম্মদপুর, Bashundhara/বসুন্ধরা, Gulshan/গুলশান, Banani/বনানী, etc.)

SPECIFIC-LISTING QUESTIONS

If asked about one property ("is this available", "call the owner for me"), only answer using data from a tool result already in this conversation. If it's not there, say you can't confirm that and point to the listing page or contact button.

HOW-TO / GUIDE QUESTIONS

When the user asks HOW to do something on TO-LET PRO (leave a house, rent a house, list a property, pay rent, contact an owner, use a feature), give a COMPLETE but compact answer:

1. Explain the actual steps as a short numbered list (up to 6 steps), in the user's language, naming the real buttons/pages in the app (e.g. 'যোগাযোগ করুন' button, বাড়ি যোগ করুন, ড্যাশবোর্ড).

2. If a matching walkthrough video exists in the VIDEO GUIDES list, ALWAYS attach it with the suggest_video_guide tool and end by inviting them to watch it.

This is the one case where you may exceed the usual length limit — a how-to answer must never be a vague one-liner.

OUTPUT LENGTH

2–4 sentences outside of the property cards and how-to answers. This is a chat window, not a report.`;

// @desc    Ask the AI assistant; it can search live listings via tool-calling
// @route   POST /api/ai-chat/ask
// @access  Public (rate limited)
exports.askGemini = asyncH(async (req, res) => {
	if (!ai) {
		// Lazy re-init in case the env var was set after boot.
		if (process.env.GEMINI_API_KEY) {
			ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
		} else {
			return res.status(503).json({ message: "AI service is currently unavailable. (Missing API Key)" });
		}
	}

	const { text, history, language } = req.body;
	if (!text) throw ApiError.badRequest("Message text is required");

	// UI language mode ('bn' | 'en') from the client — drives which button
	// labels the bot names in text AND which labels the action buttons carry.
	const isBnMode = String(language || "").toLowerCase().startsWith("bn") || language === "বাংলা";

	// ── Build sanitised, bounded history. Gemini needs roles that alternate,
	//    must start with 'user', and must NOT include the current message. We
	//    cap to the last 8 turns to bound token cost + memory (Render free tier).
	let formattedHistory = [];
	if (Array.isArray(history)) {
		const raw = history
			.filter((m) => m && m.text)
			.slice(-8)
			.map((m) => ({ role: m.sender === "ai" ? "model" : "user", parts: [{ text: String(m.text) }] }));

		let lastRole = null;
		for (const msg of raw) {
			if (msg.role === "model" && lastRole === null) continue; // drop leading model turns
			if (msg.role === lastRole) {
				formattedHistory[formattedHistory.length - 1].parts[0].text += "\n" + msg.parts[0].text;
			} else {
				formattedHistory.push(msg);
				lastRole = msg.role;
			}
		}
	}

	// startChat history should end on a 'model' turn. If a trailing 'user' turn
	// survived (rare), fold it into the message we're about to send.
	let userText = text;
	if (formattedHistory.length && formattedHistory[formattedHistory.length - 1].role === "user") {
		const trailing = formattedHistory.pop();
		userText = trailing.parts[0].text + "\n" + text;
	}

	// ── Video guides ─────────────────────────────────────────────────────────
	// Load the admin-published "Assistant" help videos — the SAME set shown as
	// the Assistant's suggestion chips (active, and not a welcome/how-it-works/
	// support-page video). We hand their titles to Gemini so it can attach the
	// right walkthrough to its answer when the user asks how to do something.
	// Best-effort: if this query fails, chat still works, just without a video.
	let guides = [];
	try {
		guides = await AIGuide.find({
			isActive: true,
			placement: { $nin: ["welcome", "how_it_works", "support"] },
		})
			.sort({ order: 1 })
			.limit(30)
			.lean();
	} catch (e) {
		console.warn("[ai-chat] failed to load video guides:", e.message);
		guides = [];
	}

	// Append the video-guide catalogue + rules to the base system instruction,
	// but only when there are guides to offer.
	let systemInstruction = SYSTEM_INSTRUCTION;

	// ── UI language mode + real button names ────────────────────────────────
	// The app is bilingual and every button is labelled differently per mode.
	// Telling the model which mode is active lets it name the EXACT button the
	// user is looking at ('যোগাযোগ করুন' vs 'Inquire').
	systemInstruction += `

UI LANGUAGE MODE
The user's app interface is currently in ${isBnMode ? "BENGALI (বাংলা)" : "ENGLISH"} mode. Default to replying in that language unless the user clearly writes in the other one. When you name a button or page, use the label of the CURRENT mode — these are the real labels:
- Contact the owner of a listing: ${isBnMode ? "'যোগাযোগ করুন' বাটন (লিস্টিং কার্ড ও প্রপার্টি পেজে)" : "the 'Inquire' button (on listing cards and the property page)"}
- View listing details: ${isBnMode ? "'বিস্তারিত'" : "'Details'"}
- Post/list a property: ${isBnMode ? "'বাড়ি যোগ করুন' / 'বাড়ি দিন'" : "'Add Property' / 'Post Property'"}
- Landlord dashboard: ${isBnMode ? "'বাড়িওয়ালা ড্যাশবোর্ড'" : "'Landlord Dashboard'"}
- Tenant dashboard: ${isBnMode ? "'ভাড়াটিয়া ড্যাশবোর্ড'" : "'Tenant Dashboard'"}
- Search/filter listings: ${isBnMode ? "'খুঁজুন' বাটন ও 'ফিল্টার'" : "the 'Search' button and 'Filters'"}
- Help center: ${isBnMode ? "'সহায়তা ও সাপোর্ট'" : "'Help & Support'"}

APP ACTION BUTTONS
After an answer that tells the user to go somewhere in the app, call "suggest_app_actions" with 1–2 of these ids so tappable buttons appear under your reply: ${Object.keys(APP_ACTIONS).join(", ")}. Example: "how do I list my house/hostel/restaurant?" → answer the steps, then attach ["list_property"]. Never write raw URLs or routes in your text — the buttons handle navigation.`;
	if (guides.length) {
		const catalogue = guides
			.map((g) => {
				const kw = Array.isArray(g.keywords) && g.keywords.length ? ` (keywords: ${g.keywords.join(", ")})` : "";
				return `- id="${g._id}" — ${g.title}: ${g.suggestionText}${kw}`;
			})
			.join("\n");
		systemInstruction += `

VIDEO GUIDES (walkthrough videos the admin has published)
When the user asks HOW to do something on TO-LET PRO that one of these videos covers (e.g. how to find/rent a home, how to list a property, how to pay rent, how to use a feature), attach that video by calling the "suggest_video_guide" tool with its id — IN ADDITION to writing your normal short text answer. Available videos:
${catalogue}

Video rules:
- Attach at most ONE video, and only when it clearly matches what the user is trying to do. If none fit, don't call the tool.
- Never write the id or the video URL in your text answer. Just call the tool, and in your text briefly invite them to watch the short guide shown below your reply.`;
	}

	// Gemini tools: property search + app-action buttons are always available;
	// the video-guide tool is added only when we actually have guides to suggest.
	const functionDeclarations = [searchPropertiesTool.functionDeclarations[0], suggestAppActionsDecl];
	if (guides.length) functionDeclarations.push(suggestVideoGuideDecl);

	try {
		const model = ai.getGenerativeModel({
			model: "gemini-2.5-flash",
			systemInstruction,
			tools: [{ functionDeclarations }],
			generationConfig: { temperature: 0.6 },
		});

		const chat = model.startChat({ history: formattedHistory });
		let result = await chat.sendMessage(userText);

		// Tool-calling loop. Gemini may ask to run search_properties; we execute
		// it and feed the results back. Bounded to a few rounds for safety.
		let properties = [];
		let suggestedGuideId = null;
		let suggestedActionIds = [];
		let rounds = 0;
		while (rounds < 3) {
			const calls =
				typeof result.response.functionCalls === "function" ? result.response.functionCalls() : null;
			if (!calls || !calls.length) break;

			// Gemini can ask for more than one tool in a single turn (e.g. search
			// AND suggest a video). Run them all and feed every result back together.
			const toolResponses = [];
			for (const call of calls) {
				if (call.name === "search_properties") {
					const found = await runPropertySearch(call.args || {});
					properties = found; // remember the latest search's cards for the client
					toolResponses.push({
						functionResponse: {
							name: call.name,
							response: {
								count: found.length,
								results: found.map((p) => ({
									title: p.title, price: p.price, beds: p.beds, baths: p.baths, location: p.location, type: p.type,
								})),
							},
						},
					});
				} else if (call.name === "suggest_app_actions") {
					// Validate against the fixed catalogue; keep at most 2.
					const ids = Array.isArray(call.args && call.args.actionIds) ? call.args.actionIds : [];
					suggestedActionIds = ids.map(String).filter((id) => APP_ACTIONS[id]).slice(0, 2);
					toolResponses.push({
						functionResponse: { name: call.name, response: { attached: suggestedActionIds } },
					});
				} else if (call.name === "suggest_video_guide") {
					// Only accept an id we actually published this request — never
					// trust a hallucinated one.
					const gid = call.args && call.args.guideId ? String(call.args.guideId) : null;
					const match = gid && guides.find((g) => String(g._id) === gid);
					if (match) suggestedGuideId = String(match._id);
					toolResponses.push({
						functionResponse: { name: call.name, response: { ok: !!match } },
					});
				} else {
					toolResponses.push({ functionResponse: { name: call.name, response: {} } });
				}
			}
			result = await chat.sendMessage(toolResponses);
			rounds += 1;
		}

		const replyText = result.response.text() || "দুঃখিত, এই মুহূর্তে উত্তরটি দিতে পারছি না।";

		// Deterministic fallback: if Gemini did NOT attach a guide, match the
		// admin-set keywords against the user's question ourselves. This is the
		// guarantee the admin asked for — "বাসা ছাড়া" in the question + that
		// keyword on a guide ⇒ that video ships with the answer, every time,
		// regardless of whether the model remembered to call the tool.
		if (!suggestedGuideId && guides.length) {
			const q = String(text).toLowerCase();
			const match = guides.find(
				(g) => Array.isArray(g.keywords) && g.keywords.some((kw) => kw && q.includes(kw)),
			);
			if (match) suggestedGuideId = String(match._id);
		}

		// Resolve the suggested guide (if any) into the compact shape the client
		// renders as a "Watch" button that opens the video modal.
		let videoGuide = null;
		if (suggestedGuideId) {
			const g = guides.find((x) => String(x._id) === suggestedGuideId);
			if (g) {
				videoGuide = {
					id: String(g._id),
					title: g.title,
					videoUrl: g.videoUrl,
					suggestionText: g.suggestionText,
				};
			}
		}

		// Resolve action ids → { label, route } buttons, labelled in the user's
		// current UI language.
		const actions = suggestedActionIds.map((id) => ({
			label: isBnMode ? APP_ACTIONS[id].bn : APP_ACTIONS[id].en,
			route: APP_ACTIONS[id].route,
		}));

		return res.status(200).json({ text: replyText, properties, videoGuide, actions });
	} catch (error) {
		console.error("Gemini API Error:", error);

		// ── Graceful degradation (free-tier quota, model outage, any Gemini
		// error). Instead of a 500 + generic "brain" apology, return a REAL
		// 200 reply: a polite high-volume note in the user's UI language, a
		// keyword-matched video guide when the admin has one for this question,
		// 1–2 relevant navigation buttons, and always a route to support.
		const q = String(text).toLowerCase();

		// Reuse the admin's tracked keywords to still answer with the right video.
		let videoGuide = null;
		const guideMatch = guides.find(
			(g) => Array.isArray(g.keywords) && g.keywords.some((kw) => kw && q.includes(kw)),
		);
		if (guideMatch) {
			videoGuide = {
				id: String(guideMatch._id),
				title: guideMatch.title,
				videoUrl: guideMatch.videoUrl,
				suggestionText: guideMatch.suggestionText,
			};
		}

		// Light keyword → page routing so the user can still get where they
		// were trying to go.
		const ACTION_KEYWORD_RULES = [
			{ id: "list_property",     kws: ["ভাড়া দেবো", "ভাড়া দিতে", "ভাড়া দিব", "বাড়ি যোগ", "লিস্ট", "বিজ্ঞাপন", "list", "post", "add property"] },
			{ id: "browse_properties", kws: ["ভাড়া নিতে", "ভাড়া নেবো", "বাসা খুঁজ", "খুঁজছি", "find", "looking for", "rent a", "বাসা ভাড়া", "অফিস ভাড়া", "হোস্টেল"] },
			{ id: "messages",          kws: ["মেসেজ", "চ্যাট", "message", "chat"] },
		];
		const actionIds = ACTION_KEYWORD_RULES
			.filter((r) => r.kws.some((kw) => q.includes(kw)))
			.map((r) => r.id)
			.slice(0, 2);
		if (!actionIds.includes("support")) actionIds.push("support"); // always offer the humans
		const actions = actionIds.map((id) => ({
			label: isBnMode ? APP_ACTIONS[id].bn : APP_ACTIONS[id].en,
			route: APP_ACTIONS[id].route,
		}));

		const fallbackText = isBnMode
			? "এই মুহূর্তে অনেক বেশি অনুরোধ আসায় AI অ্যাসিস্ট্যান্ট একটু ব্যস্ত। 🙏 অসুবিধার জন্য দুঃখিত!" +
			  (videoGuide ? " আপনার প্রশ্নের সাথে মিলে যাওয়া একটি ভিডিও গাইড নিচে দেওয়া হলো।" : "") +
			  " নিচের বাটনগুলো দিয়ে কাজটি এখনই সেরে নিতে পারেন, অথবা আমাদের সাপোর্ট টিমের সাথে কথা বলুন — তারা সবসময় প্রস্তুত।"
			: "Our AI assistant is a bit busy right now due to high volume — sorry about that! 🙏" +
			  (videoGuide ? " Here's a video guide that matches your question." : "") +
			  " You can use the buttons below to get it done right away, or reach our support team — they're always ready to help.";

		return res.status(200).json({ text: fallbackText, properties: [], videoGuide, actions, degraded: true });
	}
});

// ── Voice transcription (Bengali speech-to-text) ────────────────────────────
// Used by the assistant's mic on browsers WITHOUT the Web Speech API (iOS
// Safari, Firefox): the client records a short clip and uploads it here; we hand
// it to OpenAI Whisper, which accepts the formats browsers actually record
// (webm/opus from Chrome, mp4/aac from Safari) directly — no transcoding. Whisper
// has strong Bengali support. Requires OPENAI_API_KEY and Node 18+ (native
// fetch / FormData / Blob). If you'd rather stay all-Google, swap this for
// Google Cloud Speech-to-Text (needs a service-account credential instead).
//
// @route   POST /api/ai-chat/transcribe   (multipart field: "audio")
// @access  Public (rate limited)
exports.transcribeAudio = asyncH(async (req, res) => {
	if (!process.env.OPENAI_API_KEY) {
		return res.status(503).json({ message: "Voice transcription is unavailable. (Missing API key)" });
	}
	if (!req.file || !req.file.buffer || !req.file.buffer.length) {
		throw ApiError.badRequest("Audio file is required");
	}

	try {
		const form = new FormData();
		const blob = new Blob([req.file.buffer], { type: req.file.mimetype || "audio/webm" });
		form.append("file", blob, req.file.originalname || "voice.webm");
		form.append("model", "whisper-1");
		form.append("language", "bn"); // Bengali

		const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
			method: "POST",
			headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
			body: form,
		});

		if (!r.ok) {
			const errText = await r.text().catch(() => "");
			console.error("Whisper transcription error:", r.status, errText);
			return res.status(502).json({ message: "Transcription failed. Please try again." });
		}

		const data = await r.json();
		return res.status(200).json({ text: (data.text || "").trim() });
	} catch (error) {
		console.error("Transcription request failed:", error);
		return res.status(500).json({ message: "Transcription service error. Please try again later." });
	}
});