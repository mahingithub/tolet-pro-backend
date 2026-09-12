'use strict';

/**
 * One AI backend for the whole app.
 * ─────────────────────────────────────────────────────────────────────────────
 * Three features talk to Gemini — the chat assistant, its voice transcription
 * (both in controllers/aiChatController.js) and the খাতা/ভর্তি ফরম scanner
 * (controllers/aiScanController.js). They run on ONE of two Google backends,
 * chosen at boot from the environment:
 *
 *   Vertex AI — the default whenever a service account is configured. Bills
 *   against the Google Cloud credit.
 *
 *   Google AI Studio (GEMINI_API_KEY) — the metered fallback for when that
 *   credit runs out.
 *
 * Switching is an ENV change, not a code change:
 *
 *     AI_PROVIDER=aistudio      ← moves all three features at once
 *
 * That matters more than it looks. The scanner used to switch by moving a `//`
 * in two places that had to agree, and the assistant used to hold a separate
 * AI Studio key — which went stale on its own and turned every question into
 * the assistant's friendly "we're busy right now" fallback, indistinguishable
 * from real load. One lever, one credential, one boot line saying which is live.
 *
 * Callers stay backend-agnostic. The two SDKs take the same
 * getGenerativeModel / startChat / sendMessage / generateContent calls, and the
 * places they genuinely differ are all handled here:
 *
 *   SchemaType     Vertex sends 'STRING', AI Studio 'string'. Wrong case is
 *                  rejected as a malformed tool declaration.
 *   responseText   AI Studio wraps the reply in response.text(); Vertex has no
 *                  such method — calling it is a TypeError, not a wrong answer.
 *   toolCallsOf    Likewise for response.functionCalls().
 *
 * One request shape works on both: generateContent({ contents: [...] }). The
 * bare [prompt, image] array the AI Studio SDK also allows arrives at Vertex as
 * a malformed call, so don't use it.
 */

const {
  VERTEX_PROJECT, VERTEX_LOCATION, VERTEX_MODEL, vertexAuthOptions, hasVertexCredentials,
} = require('../config/vertex');

const AI_PROVIDER = String(
  process.env.AI_PROVIDER || (hasVertexCredentials() ? 'vertex' : 'aistudio'),
).toLowerCase();

const USE_VERTEX = AI_PROVIDER === 'vertex';

const SDK = USE_VERTEX ? require('@google-cloud/vertexai') : require('@google/generative-ai');

// Both SDKs renamed this enum at some point (FunctionDeclarationSchemaType ->
// SchemaType), so try both names. The literal is a last resort that keeps a
// version bump from taking every AI feature down at require time.
const SchemaType =
  SDK.SchemaType ||
  SDK.FunctionDeclarationSchemaType ||
  { OBJECT: 'object', STRING: 'string', NUMBER: 'number', INTEGER: 'integer', BOOLEAN: 'boolean', ARRAY: 'array' };

const AI_MODEL = USE_VERTEX ? VERTEX_MODEL : (process.env.GEMINI_MODEL || 'gemini-2.5-flash');

// Built lazily: a credential added AFTER boot — the usual shape of a Render
// env-var fix — is then picked up on the next request instead of needing a
// restart. A construction failure is logged and retried, never a boot crash;
// the rest of the API must keep serving when the AI backend is misconfigured.
let client = null;
function getClient() {
  if (client) return client;
  try {
    if (USE_VERTEX) {
      client = new SDK.VertexAI({
        project: VERTEX_PROJECT,
        location: VERTEX_LOCATION,
        googleAuthOptions: vertexAuthOptions(),
      });
    } else if (process.env.GEMINI_API_KEY) {
      client = new SDK.GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    }
  } catch (err) {
    console.error(`[ai] could not initialise the ${AI_PROVIDER} client:`, err.message);
    client = null;
  }
  return client;
}

// The message to show when there is no client to build at all.
const UNAVAILABLE_REASON = USE_VERTEX
  ? 'Vertex AI is not configured'
  : 'Missing API Key';

function candidateParts(result) {
  const resp = result?.response ?? result;
  return resp?.candidates?.[0]?.content?.parts || [];
}

function responseText(result) {
  const resp = result?.response ?? result;
  if (typeof resp?.text === 'function') {
    // AI Studio's helper throws rather than returning '' when the candidate
    // carries no text at all (a tool-call-only turn, or a safety block).
    try {
      return String(resp.text() || '');
    } catch {
      /* fall through to the parts */
    }
  }
  return candidateParts(result).map((p) => (p && p.text) || '').join('');
}

function toolCallsOf(result) {
  const resp = result?.response ?? result;
  if (typeof resp?.functionCalls === 'function') return resp.functionCalls() || [];
  return candidateParts(result).map((p) => p && p.functionCall).filter(Boolean);
}

// Printed once at boot. When the assistant answers with its "we're busy"
// fallback, this line is how you tell a dead credential from real load.
const BACKEND_LABEL = USE_VERTEX
  ? `Vertex AI (${VERTEX_PROJECT} / ${VERTEX_LOCATION} / ${AI_MODEL})`
  : `Google AI Studio (GEMINI_API_KEY, ${AI_MODEL})`;

console.log(`[ai] backend: ${BACKEND_LABEL}`);

module.exports = {
  AI_PROVIDER,
  USE_VERTEX,
  AI_MODEL,
  SchemaType,
  UNAVAILABLE_REASON,
  BACKEND_LABEL,
  getClient,
  candidateParts,
  responseText,
  toolCallsOf,
};
