'use strict';

/**
 * roomKey.js — deciding whether two written room numbers mean the same room.
 * ──────────────────────────────────────────────────────────────────────────
 * THE BUG THIS EXISTS TO KILL
 * A landlord creates room "101" in the app. Later they photograph an admission
 * form where the same room is written "Room 101" — or "রুম ১০১", or "#101", or
 * "101 " with a trailing space. The scanner looked the room up with an exact
 * string match:
 *
 *     Unit.findOne({ buildingId, roomNumber, floor })
 *
 * "Room 101" !== "101", so it found nothing and CREATED A SECOND ROOM. The
 * building now holds two rooms that are the same room, with two bookings, two
 * rent ledgers, and no way to reconcile them — and the landlord did nothing
 * wrong except write the room number the way people write room numbers.
 *
 * The database's unique index on { buildingId, floor, roomNumber } does not
 * catch this, because the two strings genuinely differ. Uniqueness has to be
 * decided on what the strings MEAN, which is what this file is for.
 *
 * TWO FUNCTIONS, DELIBERATELY DIFFERENT
 *   • normaliseRoomNumber() — aggressive, for MATCHING. Everything that could
 *     be decoration is stripped, so "Room 101" and "১০১" collapse to "101".
 *   • cleanRoomLabel()      — gentle, for STORING. Only obvious prefix words
 *     are dropped, so a saved room still reads the way a human wrote it.
 *
 * WHAT IS DELIBERATELY *NOT* MERGED
 * "A-101" does not collapse to "101". In a building with blocks, those are two
 * different rooms, and quietly merging them would put a tenant in someone
 * else's flat — a worse failure than the duplicate this file prevents. When
 * matching is uncertain the caller is told to ask, never to guess.
 */

// Bengali and Arabic-Indic digits → ASCII. A form written in Bangla is the
// normal case here, not an edge case.
const DIGIT_MAP = {
  '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
  '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

function toAsciiDigits(s) {
  return String(s ?? '').replace(/[০-৯٠-٩]/g, (d) => DIGIT_MAP[d] || d);
}

// Words that mean "this is a room number" and carry no identity of their own.
// Anchored to the START only: a trailing token is part of the name (a room
// called "101 Annex" is not room 101).
const PREFIX_RE = new RegExp(
  '^\\s*(?:'
  + 'room|rm|flat|apt|apartment|unit|house|no|number'
  + '|রুম|কক্ষ|ফ্ল্যাট|বাসা|নং|নম্বর'
  + ')\\s*[.:#-]?\\s*',
  'i',
);

/**
 * The matching key. Lowercase, digits normalised, decoration removed.
 * Returns '' when there is nothing identifying left.
 *
 *   'Room 101' · '১০১' · '#101' · ' 101 '  →  '101'
 *   'A-101'                                →  'a101'
 */
function normaliseRoomNumber(raw) {
  let s = toAsciiDigits(raw).trim();
  if (!s) return '';
  // Strip repeatedly: "Flat No. 101" carries two prefix words.
  for (let i = 0; i < 3 && PREFIX_RE.test(s); i += 1) s = s.replace(PREFIX_RE, '');
  // Everything that is not a letter or a digit is formatting.
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * What actually gets stored on a newly created Unit.
 *
 * Gentler than the matching key on purpose: a room the landlord later reads in
 * a list should look like a room number, not like a slug. Only the prefix words
 * and surrounding whitespace go.
 *
 *   'Room 101' → '101'    'রুম ১০১' → '১০১'    'A-101' → 'A-101'
 */
function cleanRoomLabel(raw) {
  let s = String(raw ?? '').trim().replace(/\s+/g, ' ');
  for (let i = 0; i < 3 && PREFIX_RE.test(s); i += 1) s = s.replace(PREFIX_RE, '');
  // A bare "#" or "No." in front of the number is punctuation, not identity.
  s = s.replace(/^\s*[#№]\s*/, '');
  return s.trim().slice(0, 40);
}

/**
 * Read a floor out of free text off a page: '3rd', '৩য়', 'Floor 2', 'ground'.
 *
 * RETURNS null WHEN NOTHING IS THERE, and that is the important part. The old
 * parser returned 0 for unreadable input, so a form with no floor on it put the
 * tenant on the ground floor — creating "101" on floor 0 next to the real "101"
 * on floor 1. Silently defaulting is what manufactured the duplicate; null lets
 * the caller ask instead.
 */
function parseFloorLabel(raw) {
  const s = toAsciiDigits(raw).trim().toLowerCase();
  if (!s) return null;

  // Named ground floor — common on Bangladeshi forms, and never a digit.
  if (/(^|\b)(ground|nichtola|নিচতলা|নিচ তলা|গ্রাউন্ড)(\b|$)/.test(s)) return 0;
  if (/(^|\b)(basement|বেসমেন্ট)(\b|$)/.test(s)) {
    const m = /-?\d+/.exec(s);
    return m ? -Math.abs(parseInt(m[0], 10)) : -1;
  }

  const m = /-?\d+/.exec(s);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(-5, Math.min(200, n));
}

module.exports = {
  toAsciiDigits,
  normaliseRoomNumber,
  cleanRoomLabel,
  parseFloorLabel,
};
