const ApiError = require("../utils/ApiError");
const Property = require("../models/Property");
const AIGuide = require("../models/AIGuide");
const aiPropertySearch = require("../services/aiPropertySearch");

// Which Google backend is live (Vertex AI or AI Studio), the SDK differences
// between them, and the client itself — all decided in one place, from the
// environment, for every AI feature in the app. See services/aiProvider.js.
const {
	AI_PROVIDER, USE_VERTEX, AI_MODEL, SchemaType, UNAVAILABLE_REASON,
	getClient, responseText, toolCallsOf,
} = require("../services/aiProvider");

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ── Property-search tool ────────────────────────────────────────────────────
// The enums come STRAIGHT from the model. They used to be hand-copied here with
// a comment promising they mirrored it exactly, and they had drifted: the copy
// was missing student_male, student_female, working_professional, co_ed,
// wholesale, fast_food, brand_outlet and a dozen more. Gemini can only emit a
// value that is in the declared enum, so every listing filed under one of those
// categories was unreachable by category — including most of the live hostels
// and shops. Importing removes the class of bug rather than re-fixing the copy.
const DIVISIONS  = Property.ENUMS.DIVISIONS;
const TYPES      = Property.ENUMS.PROPERTY_TYPES.filter((t) => t !== 'apartment'); // legacy alias, normalised to 'flat' on write
const CATEGORIES = Property.ENUMS.CATEGORIES;
const INTENTS    = ['rent', 'sale', 'commercial']; // canonical three; the model's enum also carries legacy write-time aliases

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
				"Omit any field you are unsure about instead of guessing — an extra filter can only HIDE listings. " +
				"The search widens by itself when the exact combination has nothing, and reports in matchQuality/dropped " +
				"what it had to ignore, so never call it a second time just to retry a looser version of the same question.",
			parameters: {
				type: SchemaType.OBJECT,
				properties: {
					q:        { type: SchemaType.STRING, description: "ONLY the place: the area / neighbourhood / landmark / road the user named (e.g. 'Dhanmondi', 'Uttara Sector 12', 'Mirpur 10'). NEVER put property words in here — 'flat', 'bachelor', 'family', 'room', 'hostel', 'বাসা', 'ভাড়া' and the like belong in type/category/intent; inside q they only hide listings, because every word in q has to appear literally in the listing's own text. Map spelling variants to one canonical area name (Dhanmondi/ধানমন্ডি/Dhanmondi 27, Mirpur/মিরপুর/Mirpur 10, Uttara/উত্তরা, Mohammadpur/মোহাম্মদপুর, Bashundhara/বসুন্ধরা, Gulshan/গুলশান, Banani/বনানী). Omit entirely if the user named no place." },
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

// The search itself — including the relaxation ladder that keeps a slightly
// over-specified question from coming back as "nothing found" — lives in
// services/aiPropertySearch.js. See the header there for why.

// ── Greeting hygiene ────────────────────────────────────────────────────────
// Told to greet with "আসসালামু আলাইকুম", the model greets with it in EVERY
// reply, so a five-message conversation opens with salaam five times. The
// system instruction now says to greet once; this is the guarantee, because a
// prompt rule about what NOT to say is exactly the kind a model drifts off.
// A greeting the user themselves opened with still gets answered in kind.
const LEADING_GREETING_RE =
	/^[\s"'`]*(?:আসসালামু\s*আলাইকুম(?:\s*ওয়া\s*রাহমাতুল্লাহ\S*)?|ওয়ালাইকুম\s*আসসালাম|আস[\s-]*সালাম|assalamu?\s*'?alaikum|as-?salamu?\s*alaykum|walaikum\s*assalam|নমস্কার|আদাব|হ্যালো|হাই|hello|hey|hi)(?=$|[\s!,.।—–…?])[\s!,.।—–…?]*/iu;

const USER_GREETED_RE =
	/(আসসালামু\s*আলাইকুম|ওয়ালাইকুম|সালাম|নমস্কার|আদাব|হ্যালো|assalam|salam|\bhello\b|\bhi\b|\bhey\b)/iu;

function stripRepeatGreeting(reply, { isFirstReply, userText }) {
	if (isFirstReply) return reply;                       // the one reply that may greet
	if (USER_GREETED_RE.test(String(userText || ""))) return reply; // they greeted us; greet back
	const stripped = String(reply).replace(LEADING_GREETING_RE, "");
	// Never strip a reply down to nothing — a bare "হ্যালো!" answer stays as is.
	return stripped.trim() ? stripped : reply;
}
exports.stripRepeatGreeting = stripRepeatGreeting; // exported for tests

const SYSTEM_INSTRUCTION = `You are the TO-LET PRO Assistant — a personal property-search helper for people renting or listing property in Bangladesh through the TO-LET PRO app. Act like a sharp, helpful human assistant, not a generic chatbot.

LANGUAGE & TONE

- ALWAYS reply in natural, conversational Bengali (বাংলা) by DEFAULT — even when the user writes to you in English, Banglish, or any other language. Bengali is the default for every user. A user typing "hello" or "show me flats in Dhanmondi" still gets a Bengali answer.

- GREET EXACTLY ONCE PER CONVERSATION. If there is ANY earlier turn of yours in this conversation, you have already greeted: open the reply with the answer itself and nothing else. No "আসসালামু আলাইকুম", no "হ্যালো", no "আবার স্বাগতম" — not even a short one. Greeting someone you are already mid-conversation with is the single most robotic thing you can do, and it is what people complain about most.

- When you DO greet — only in your very first reply, or when the user greets you first — use "আসসালামু আলাইকুম" (Assalamu Alaikum), never "নমস্কার" (Namaskar).

- The ONLY exception: if the user EXPLICITLY asks you to reply in a specific language ("reply in English", "ইংরেজিতে বলো", "answer me in Hindi", "speak English please"), then switch to that language and keep using it for the rest of the conversation until they ask you to switch again. Merely writing to you in English is NOT an explicit request — keep replying in Bengali.

- Keep property names, area names, and English technical terms as-is when that's how people actually say them (e.g. "Dhanmondi", "flat", "booking") — don't force awkward translations.

- Be warm but brief. No "As an AI..." disclaimers, no filler like "Sure, I'd be happy to help!" — get to the useful part in the first sentence.

GROUNDING RULES (never break these)

1. Never invent a property, price, address, owner name, or amenity. Every specific detail about a listing must come from an actual search_properties tool result earlier in this conversation.

2. Never answer from "typical prices in this area" or general real-estate knowledge as if it were live data. If you haven't called the tool, you have no listings to describe.

3. For general platform/legal questions you're not fully certain about (deposit rules, rental law, how to verify an owner, refund policy), say so plainly and point the user to TO-LET PRO support or the Help section — do not guess at policy details.

4. If a message looks like a voice-transcription with a likely error (an odd, out-of-context word breaking an otherwise clear sentence), don't treat that word as a literal area/price — ask a quick one-line confirmation instead of guessing.

SEARCH FLOW (follow in order)

0. NEVER say you are searching, looking, or checking without calling search_properties in that SAME turn. "দেখছি…" / "খুঁজছি…" as a standalone message that ends your turn is a broken promise — the user waits for results that are never coming. Either call the tool now, or ask your clarifying question. Nothing in between.

1. Extract what you can: area, budget (min/max), property type, tenant category, bedrooms.

2. Ask ONE short clarifying question before searching ONLY when you have NOTHING usable at all — no area, no budget, no property type ("কিছু একটা দেখান", "বাসা লাগবে"). Example: "কোন এলাকায় খুঁজছেন, আর বাজেট কত?" If the user named an area, OR a budget, OR a type — search FIRST with what you have. A search with one filter is far more useful than a question, because the search widens by itself and will still come back with something to talk about.

3. If the user skips the clarifying question ("just show me", "jaw ache dekhao"), proceed with a best-effort search on whatever filters you have, and mention the results may be broad.

4. Set only the filters the user actually expressed. Every extra filter you guess at narrows the search. In particular: do not invent a category — if they said "bachelor" and meant nothing more precise, "bachelor_male" is a guess about gender, so prefer to leave category out. Put ONLY the place name in 'q'.

5. Call search_properties with normalized filters (see NORMALIZATION below). Call it ONCE per question: it descends its own ladder of looser searches internally, so calling it again with fewer filters just repeats work it already did.

6. On results, read matchQuality and dropped[] from the tool response and be honest about which one you got:

   - "exact" — everything they asked for. One short natural sentence, then let the property cards render. Don't restate fields already visible on the cards.

   - "relaxed" — the exact combination had nothing, so the listed dropped[] filters were ignored. SAY WHICH ONES in plain language BEFORE the cards: "উত্তরায় ঠিক ব্যাচেলর ফ্ল্যাট এই মুহূর্তে নেই — তবে ব্যাচেলরদের জন্য এই হোস্টেলটি আছে।" Never present these as if they matched the request.

   - "nearby" — nothing in that exact area; these are from the wider city/division. Say that explicitly: "ঠিক এই এলাকায় পাইনি, কাছাকাছি এগুলো আছে।"

   - "other_areas" — nothing in their area at all; these are from completely different areas. Say so plainly and let them decide: "উত্তরায় এখন কিছু নেই। অন্য এলাকায় যা আছে দেখাচ্ছি — আগ্রহী হলে বলুন।"

   - budgetWidenedTo is a number — nothing inside their budget; you are showing slightly costlier listings. Name the real budget you ended up showing.

   - "none" — the catalogue genuinely has nothing. Only THEN say you found nothing. Offer to set a Smart Alert (smart_alerts) so they hear the moment something is listed, and suggest exactly ONE adjustment.

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
	const client = getClient();
	if (!client) {
		return res.status(503).json({
			message: `AI service is currently unavailable. (${UNAVAILABLE_REASON})`,
		});
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
The user's app interface is currently in ${isBnMode ? "BENGALI (বাংলা)" : "ENGLISH"} mode. This tells you ONLY which button labels the user is looking at — it does NOT change your reply language. Your reply language is governed by LANGUAGE & TONE above: Bengali by default, another language only when the user explicitly asks for one. When you name a button or page, use the label of the CURRENT interface mode — these are the real labels:
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
		const model = client.getGenerativeModel({
			model: AI_MODEL,
			systemInstruction,
			tools: [{ functionDeclarations }],
			generationConfig: { temperature: 0.6 },
		});

		const chat = model.startChat({ history: formattedHistory });
		let result = await chat.sendMessage(userText);

		// The answer is NOT always in the last turn. Gemini routinely writes its
		// whole reply in the SAME turn it asks for tools — a how-to answer comes
		// back as [text, suggest_video_guide], and the turns after it carry only
		// the remaining tool calls and then nothing at all. Reading text off the
		// final result alone threw that answer away and shipped the "উত্তরটি দিতে
		// পারছি না" placeholder with a perfectly good button sitting under it.
		// Keep the most recent turn that actually said something.
		let answerText = responseText(result);

		// Tool-calling loop. Gemini may ask to run search_properties; we execute
		// it and feed the results back. Bounded to a few rounds for safety.
		let properties = [];
		let searchOutcome = null;
		let suggestedGuideId = null;
		let suggestedActionIds = [];
		let rounds = 0;
		while (rounds < 3) {
			const calls = toolCallsOf(result);
			if (!calls.length) break;

			// Gemini can ask for more than one tool in a single turn (e.g. search
			// AND suggest a video). Run them all and feed every result back together.
			const toolResponses = [];
			for (const call of calls) {
				if (call.name === "search_properties") {
					const hit = await aiPropertySearch.searchListings(call.args || {});
					properties = hit.properties; // remember the latest search's cards for the client
					searchOutcome = hit;
					toolResponses.push({
						functionResponse: {
							name: call.name,
							response: {
								count: hit.properties.length,
								// How close this is to what was actually asked for. The
								// model is instructed to SAY which of these it got —
								// showing a hostel as if it were the requested bachelor
								// flat is worse than showing nothing.
								matchQuality:    hit.matchQuality,
								dropped:         hit.dropped,
								budgetWidenedTo: hit.budgetWidenedTo,
								searched:        hit.searched,
								results: hit.properties.map((p) => ({
									title: p.title, price: p.price, beds: p.beds, baths: p.baths,
									location: p.location, type: p.type, category: p.category,
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
			// A later turn supersedes an earlier one — after a search, the summary
			// written with the results in hand is the better answer — but an empty
			// turn never overwrites a real one.
			const turnText = responseText(result);
			if (turnText.trim()) answerText = turnText;
			rounds += 1;
		}

		// Drop the salaam the model opens every single turn with (see
		// stripRepeatGreeting) before anything else looks at the text.
		const isFirstReply = !formattedHistory.some((m) => m.role === "model");
		const replyText =
			stripRepeatGreeting(answerText, { isFirstReply, userText: text }).trim() ||
			"দুঃখিত, এই মুহূর্তে উত্তরটি দিতে পারছি না।";

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

		// A search that found nothing even at the bottom of the relaxation ladder
		// is the one dead end the assistant can't talk its way out of — so give
		// the user somewhere to go rather than an apology on its own. Deterministic
		// so it doesn't depend on the model remembering to attach the buttons.
		if (searchOutcome && !searchOutcome.properties.length && !suggestedActionIds.length) {
			suggestedActionIds = ["smart_alerts", "browse_properties"];
		}

		// Resolve action ids → { label, route } buttons, labelled in the user's
		// current UI language.
		const actions = suggestedActionIds.map((id) => ({
			label: isBnMode ? APP_ACTIONS[id].bn : APP_ACTIONS[id].en,
			route: APP_ACTIONS[id].route,
		}));

		return res.status(200).json({
			text: replyText,
			properties,
			videoGuide,
			actions,
			// How close the cards are to what was asked for ('exact' | 'relaxed' |
			// 'nearby' | 'other_areas' | 'none'). The reply text already says it;
			// this is the machine-readable copy for the widget and for debugging a
			// "why did it show me that?" report.
			search: searchOutcome
				? {
					matchQuality:    searchOutcome.matchQuality,
					dropped:         searchOutcome.dropped,
					budgetWidenedTo: searchOutcome.budgetWidenedTo,
					searched:        searchOutcome.searched,
				}
				: undefined,
		});
	} catch (error) {
		// Name the backend: the reply below is the same friendly "we're busy"
		// either way, so the log line is the only place that says whether it was
		// Vertex auth or an AI Studio key that actually failed.
		console.error(`[ai-chat] ${AI_PROVIDER} error:`, error);

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

		// The assistant answers in Bengali by default (see LANGUAGE & TONE), so the
		// degraded reply does too — regardless of the UI mode. Only an EXPLICIT
		// request for English in this message flips it.
		const wantsEnglish = /\b(in|reply|answer|speak|talk|write|say)\b[^.?!]{0,20}\benglish\b|\benglish\b[^.?!]{0,20}\b(please|e bolo|te bolo)\b|ইংরেজি(তে)?/i.test(q);

		const fallbackText = !wantsEnglish
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
// Safari, Firefox): the client records a short clip and uploads it here, and the
// text goes straight back into the same chat pipeline.
//
// This runs on Gemini through the SAME getClient() as the chat above, so the one
// AI_PROVIDER switch moves voice and chat together — Vertex today, AI Studio the
// day the Cloud credit runs out, with no second credential to remember. It
// replaced OpenAI Whisper, which was a third vendor and a third key for a
// feature both Gemini backends already do (and do in Bengali).

// Gemini validates the mimeType against an allowlist BEFORE it looks at the
// bytes, and rejects the whole request when the label isn't audio/* — the
// application/octet-stream a MediaRecorder blob with no type produces is a hard
// 400, not a bad transcript. The bytes themselves are content-sniffed, so the
// label only has to be honest enough to pass; sniffing the container ourselves
// is what makes it honest without transcoding (there is no ffmpeg on Render).
//
// Every label below is documented by BOTH backends, so the switch back to AI
// Studio can't quietly break voice on one browser.
function sniffAudioMime(buf, fallbackLabel = "") {
	const ascii = (start, len) => buf.slice(start, start + len).toString("ascii");

	if (buf.length >= 4) {
		// EBML — WebM/Matroska. Chrome and Firefox default to webm/opus.
		if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "audio/webm";
		if (ascii(0, 4) === "OggS") return "audio/ogg";   // Firefox ogg/opus
		if (ascii(0, 4) === "fLaC") return "audio/flac";
		if (ascii(0, 3) === "ID3") return "audio/mpeg";
		if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return "audio/mpeg"; // bare MP3 frame
	}
	if (buf.length >= 12) {
		if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return "audio/wav";
		if (ascii(0, 4) === "FORM" && ascii(8, 4).startsWith("AIF")) return "audio/aiff";
		// ISO base media (mp4/m4a) — 'ftyp' sits at offset 4. iOS Safari records
		// this one and reports it as audio/mp4; 'audio/m4a' is the spelling both
		// backends document.
		if (ascii(4, 4) === "ftyp") return "audio/m4a";
	}

	// Couldn't sniff it. Fall back to the browser's own label, minus any codec
	// parameter (`audio/webm;codecs=opus`), but only if it is actually audio.
	const base = String(fallbackLabel).split(";")[0].trim().toLowerCase();
	if (base.startsWith("audio/")) return base === "audio/mp4" ? "audio/m4a" : base;
	return "";
}

const TRANSCRIBE_PROMPT =
	"Transcribe the speech in this audio clip to text, exactly as it was spoken.\n\n" +
	"- The speaker is most likely speaking Bengali (বাংলা), and may mix in English words " +
	"(Banglish) the way people actually talk. Write Bengali in Bengali script and keep the " +
	"English words in English.\n" +
	"- Transcribe, do NOT translate, answer, summarise or comment on what was said.\n" +
	"- Return ONLY the transcript itself — no quotes, no labels, no explanation.\n" +
	"- If there is no intelligible speech at all, return an empty response.";

// @route   POST /api/ai-chat/transcribe   (multipart field: "audio")
// @access  Private (rate limited)
exports.transcribeAudio = asyncH(async (req, res) => {
	const client = getClient();
	if (!client) {
		return res.status(503).json({
			message: `Voice transcription is unavailable. (${UNAVAILABLE_REASON})`,
		});
	}
	if (!req.file || !req.file.buffer || !req.file.buffer.length) {
		throw ApiError.badRequest("Audio file is required");
	}

	const mimeType = sniffAudioMime(req.file.buffer, req.file.mimetype);
	if (!mimeType) {
		// Neither the bytes nor the label say "audio". Answering here beats
		// spending a model call to be told the same thing in a 400.
		return res.status(400).json({ message: "Unsupported audio format. Please try recording again." });
	}

	try {
		const model = client.getGenerativeModel({
			model: AI_MODEL,
			// Transcription is not a place for invention: take the likeliest words.
			generationConfig: { temperature: 0 },
		});

		const result = await model.generateContent({
			contents: [{
				role: "user",
				parts: [
					{ text: TRANSCRIBE_PROMPT },
					{ inlineData: { mimeType, data: req.file.buffer.toString("base64") } },
				],
			}],
		});

		// Strip the quotes the model sometimes wraps a transcript in, and cap the
		// length — this text is about to be sent as a chat message.
		const text = responseText(result).trim().replace(/^["“”'`]+|["“”'`]+$/g, "").slice(0, 1000);

		return res.status(200).json({ text });
	} catch (error) {
		console.error(`[ai-chat] ${AI_PROVIDER} transcription error:`, error);
		return res.status(502).json({ message: "Transcription failed. Please try again." });
	}
});