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
					q:        { type: SchemaType.STRING, description: "Free-text keywords: specific area/neighbourhood/landmark names, or anything the other fields don't cover." },
					division: { type: SchemaType.STRING, enum: DIVISIONS, description: "Administrative division (major city region)." },
					type:     { type: SchemaType.STRING, enum: TYPES, description: "Property type." },
					category: { type: SchemaType.STRING, enum: CATEGORIES, description: "Who/what the listing is for (family, bachelor, student, corporate, etc.)." },
					intent:   { type: SchemaType.STRING, enum: INTENTS, description: "Listing intent: 'rent' to rent, 'sale' to buy, 'commercial' for commercial space." },
					minPrice: { type: SchemaType.NUMBER, description: "Minimum price in BDT (Taka)." },
					maxPrice: { type: SchemaType.NUMBER, description: "Maximum price in BDT (Taka)." },
					beds:     { type: SchemaType.NUMBER, description: "Minimum number of bedrooms." },
					baths:    { type: SchemaType.NUMBER, description: "Minimum number of bathrooms." },
				},
			},
		},
	],
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

const SYSTEM_INSTRUCTION = `You are the AI assistant for 'TO-LET PRO', a property rental & sale platform in Bangladesh.

CORE JOB: help users find properties. When a user describes what they want (area, budget, rooms, family/bachelor, rent/buy, etc.), call the search_properties tool to fetch REAL listings from the database, then briefly summarise what you found.

RULES:
- ALWAYS reply in the SAME language the user wrote in. Bengali in -> natural Bengali out; English in -> English out.
- NEVER invent or hallucinate listings, prices, or links. Only describe results returned by search_properties. The app renders the actual property cards below your message, so do NOT paste long lists of details — give a short, friendly summary (how many matches, the rough price range) and invite the user to tap a card.
- If a search returns 0 results, say so kindly and suggest loosening one filter (raise the budget, try a nearby area, fewer bedrooms).
- For non-property questions (how to use the app, how to list a property, general rental advice), just answer conversationally and concisely.
- If you genuinely cannot help, tell the user they can talk to a human teammate.
Keep responses concise and use simple markdown.`;

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

	const { text, history } = req.body;
	if (!text) throw ApiError.badRequest("Message text is required");

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

	try {
		const model = ai.getGenerativeModel({
			model: "gemini-2.5-flash",
			systemInstruction: SYSTEM_INSTRUCTION,
			tools: [searchPropertiesTool],
			generationConfig: { temperature: 0.6 },
		});

		const chat = model.startChat({ history: formattedHistory });
		let result = await chat.sendMessage(userText);

		// Tool-calling loop. Gemini may ask to run search_properties; we execute
		// it and feed the results back. Bounded to a few rounds for safety.
		let properties = [];
		let rounds = 0;
		while (rounds < 3) {
			const calls =
				typeof result.response.functionCalls === "function" ? result.response.functionCalls() : null;
			if (!calls || !calls.length) break;

			const call = calls[0];
			let fnResponse = { count: 0, results: [] };
			if (call.name === "search_properties") {
				const found = await runPropertySearch(call.args || {});
				properties = found; // remember the latest search's cards for the client
				fnResponse = {
					count: found.length,
					results: found.map((p) => ({
						title: p.title, price: p.price, beds: p.beds, baths: p.baths, location: p.location, type: p.type,
					})),
				};
			}
			result = await chat.sendMessage([{ functionResponse: { name: call.name, response: fnResponse } }]);
			rounds += 1;
		}

		const replyText = result.response.text() || "দুঃখিত, এই মুহূর্তে উত্তরটি দিতে পারছি না।";
		return res.status(200).json({ text: replyText, properties });
	} catch (error) {
		console.error("Gemini API Error:", error);
		return res.status(500).json({
			message: "Sorry, I am having trouble connecting to my brain right now. Please try again later.",
		});
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