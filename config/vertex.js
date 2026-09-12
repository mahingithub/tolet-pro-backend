'use strict';

/**
 * Vertex AI project + credentials, shared by every AI feature.
 * ─────────────────────────────────────────────────────────────────────────────
 * Two controllers talk to Gemini — the খাতা/ভর্তি ফরম scanner
 * (controllers/aiScanController.js) and the chat assistant
 * (controllers/aiChatController.js). They used to carry separate copies of the
 * project id, region and service-account decoding, which is how one of them can
 * end up billing a different project than the other after a single edit. One
 * copy, here.
 *
 * Service-account credentials are deliberately NOT a JSON key file sitting next
 * to package.json. This backend deploys to Render straight from git (see
 * render.yaml), so a key file in the tree is a private key pushed to the remote;
 * .gitignore catches the usual key filenames, but a filename it doesn't
 * recognise would still go through. The project already carries Google
 * credentials the safe way — FIREBASE_SERVICE_ACCOUNT_BASE64, entered in the
 * Render dashboard, never in the repo — so Vertex uses the same shape:
 *
 *     VERTEX_SERVICE_ACCOUNT_BASE64=$(base64 -i your-key.json)
 *
 * Unset, google-auth-library falls back on its own: GOOGLE_APPLICATION_CREDENTIALS
 * (a path on disk, convenient for local dev), then Application Default
 * Credentials from `gcloud auth application-default login`. A missing or
 * malformed credential surfaces as a failed request, never a boot crash — the
 * rest of the API must keep serving even when the AI backend is misconfigured.
 */

const VERTEX_PROJECT  = process.env.VERTEX_PROJECT_ID || 'to-let-pro-14e09';
const VERTEX_LOCATION = process.env.VERTEX_LOCATION   || 'us-central1';
const VERTEX_MODEL    = process.env.VERTEX_MODEL      || 'gemini-2.5-flash';

function vertexAuthOptions() {
  const b64 = process.env.VERTEX_SERVICE_ACCOUNT_BASE64 || '';
  if (!b64) return undefined;
  try {
    return { credentials: JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) };
  } catch (err) {
    console.error('[vertex-ai] VERTEX_SERVICE_ACCOUNT_BASE64 is not valid base64-JSON:', err.message);
    return undefined;
  }
}

// Whether this environment can authenticate to Vertex at all. Used to pick the
// backend at boot instead of making someone edit code to switch — see the
// provider block at the top of aiChatController.js.
//
// GOOGLE_APPLICATION_CREDENTIALS counts because google-auth-library reads it
// itself; bare ADC (`gcloud auth application-default login`) does not, because
// there is no way to detect it without an async probe, and a wrong guess here
// costs a request that fails instead of one that quietly used the other backend.
function hasVertexCredentials() {
  return !!(process.env.VERTEX_SERVICE_ACCOUNT_BASE64 || process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

module.exports = {
  VERTEX_PROJECT,
  VERTEX_LOCATION,
  VERTEX_MODEL,
  vertexAuthOptions,
  hasVertexCredentials,
};
