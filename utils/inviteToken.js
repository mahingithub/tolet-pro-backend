'use strict';

/**
 * inviteToken.js — URL-safe invite tokens for tenant self-onboarding.
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT `genInviteCode()`
 * Booking already has a 6-character `inviteCode` (ABCDEF), and that code is
 * good at exactly what it was built for: being read aloud down a phone line and
 * typed into a box. 32^6 is ~1 billion, which is fine when a human has to type
 * each guess into a rate-limited form.
 *
 * A token that travels in a URL has the opposite job. Nobody types it, so its
 * length costs nothing — and because it opens a form that collects an NID and a
 * photograph, and (for a building token) lets the sender pick which room they
 * claim to live in, it should not be enumerable at all. 128 bits from
 * crypto.randomBytes is.
 *
 * So: `inviteCode` stays the spoken code, and this is the scanned/clicked one.
 * They coexist deliberately rather than one replacing the other.
 *
 * BASE58, NOT BASE64
 * The token is printed on a QR code that a landlord may stick to a hostel wall.
 * If the print smudges, someone will try to read it out. Base58 drops the four
 * characters that get misread when that happens — 0/O and I/l — so the failure
 * mode is "the QR is scanned again", not "a wrong room is claimed".
 */

const crypto = require('crypto');

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * A cryptographically random token. 22 base58 characters ≈ 128 bits.
 * @param {number} len
 * @returns {string}
 */
function genToken(len = 22) {
  // Rejection-free mapping: read a byte, keep it only when it lands inside a
  // whole number of alphabet spans, so every character is uniformly likely.
  // (A plain `byte % 58` would make the first 24 characters slightly more
  // common — irrelevant at 128 bits, but this costs nothing.)
  const max = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  let out = '';
  while (out.length < len) {
    const buf = crypto.randomBytes(len);
    for (let i = 0; i < buf.length && out.length < len; i += 1) {
      if (buf[i] < max) out += ALPHABET[buf[i] % ALPHABET.length];
    }
  }
  return out;
}

/**
 * A token guaranteed not to collide with an existing row on `Model.inviteToken`.
 * A collision at 128 bits is not a real event; the loop exists so that a
 * mis-seeded RNG surfaces as a longer token rather than a duplicate-key crash.
 *
 * @param {import('mongoose').Model} Model
 * @returns {Promise<string>}
 */
async function uniqueToken(Model) {
  for (let i = 0; i < 5; i += 1) {
    const token = genToken();
    // eslint-disable-next-line no-await-in-loop
    if (!(await Model.exists({ inviteToken: token }))) return token;
  }
  return genToken(32);
}

/**
 * Where the tenant-facing app lives, for building a shareable link.
 * Mirrors publicAppBaseUrl() in fcm.service.js — same env chain, so a deploy
 * that sets one gets both.
 *
 * THE FALLBACK IS www, NOT THE APEX, AND THAT IS NOT A STYLE CHOICE.
 * toletpro.rent 308-redirects to www.toletpro.rent. A redirect is invisible in
 * a browser, but it breaks the two things this URL exists for:
 *
 *   • Android App Links verification does not follow redirects when it fetches
 *     /.well-known/assetlinks.json, so a link on the apex cannot verify and
 *     the app is never offered.
 *   • Every link here is printed into a QR code. A QR that resolves via a
 *     redirect is a QR that breaks the day the redirect changes, and it is
 *     already taped to a wall by then.
 *
 * So links are minted on the host that answers 200 directly.
 */
function publicAppBaseUrl() {
  return (
    process.env.PUBLIC_APP_URL
    || process.env.APP_URL
    || process.env.FRONTEND_URL
    || 'https://www.toletpro.rent'
  ).replace(/\/+$/, '');
}

/** The link a tenant opens. Kept in one place so QR and copy-link never drift. */
function inviteUrl(token) {
  return `${publicAppBaseUrl()}/join/${token}`;
}

module.exports = { genToken, uniqueToken, inviteUrl, publicAppBaseUrl };
