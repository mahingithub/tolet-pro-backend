const { GoogleGenerativeAI } = require("@google/generative-ai");
const ApiError = require("../utils/ApiError");

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Initialize Gemini client. It automatically picks up GEMINI_API_KEY from environment variables.
// If the key is missing, this will fail gracefully when a request is made.
let ai = null;
try {
	if (process.env.GEMINI_API_KEY) {
		ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
	}
} catch (err) {
	console.error("Failed to initialize GoogleGenerativeAI. Is GEMINI_API_KEY set?", err);
}

// @desc    Ask a question to Gemini AI
// @route   POST /api/ai-chat/ask
// @access  Public (Rate Limited)
exports.askGemini = asyncH(async (req, res) => {
	if (!ai) {
		// Attempt lazy initialization if env was set late
		if (process.env.GEMINI_API_KEY) {
			ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
		} else {
			return res.status(503).json({
				message: "AI service is currently unavailable. (Missing API Key)",
			});
		}
	}

	const { text, history } = req.body;

	if (!text) {
		throw ApiError.badRequest("Message text is required");
	}

	// Build the conversation history for Gemini
	// The new @google/genai SDK uses 'user' and 'model' roles.
	let formattedHistory = [];
	
	if (Array.isArray(history)) {
		const rawHistory = history
			.filter(msg => msg.text) // Ensure message has text
			.map(msg => ({
				role: msg.sender === 'ai' ? 'model' : 'user',
				parts: [{ text: msg.text }]
			}));

		// Sanitize history: must start with 'user' and roles must alternate
		let lastRole = null;
		for (const msg of rawHistory) {
			if (msg.role === 'model' && lastRole === null) {
				continue; // Skip leading model messages
			}
			if (msg.role === lastRole) {
				// Combine consecutive messages from the same role
				formattedHistory[formattedHistory.length - 1].parts[0].text += '\n' + msg.parts[0].text;
			} else {
				formattedHistory.push(msg);
				lastRole = msg.role;
			}
		}
	}

	// Make sure we are appending a 'user' message, if the last role was 'user' then combine
	if (formattedHistory.length > 0 && formattedHistory[formattedHistory.length - 1].role === 'user') {
		formattedHistory[formattedHistory.length - 1].parts[0].text += '\n' + text;
	} else {
		formattedHistory.push({
			role: 'user',
			parts: [{ text }]
		});
	}

	const systemInstruction = `You are a helpful, professional, and friendly AI assistant for 'TO-LET PRO', a premier real-estate and property rental platform in Bangladesh.
	Your job is to assist users with finding properties, understanding how to use the dashboard, knowing how to list properties, and answering general real-estate questions.
	Be concise, polite, and use a conversational tone. If you don't know something, tell the user they can speak to a human teammate.
	Please format your responses in plain text or simple markdown.`;

	try {
		const model = ai.getGenerativeModel({
			model: 'gemini-2.5-flash',
			systemInstruction: systemInstruction,
			generationConfig: {
				temperature: 0.7,
			}
		});

		const result = await model.generateContent({
			contents: formattedHistory
		});

		const replyText = result.response.text() || "I'm sorry, I couldn't process that request.";

		res.status(200).json({
			text: replyText
		});

	} catch (error) {
		console.error("Gemini API Error:", error);
		res.status(500).json({
			message: "Sorry, I am having trouble connecting to my brain right now. Please try again later.",
		});
	}
});
