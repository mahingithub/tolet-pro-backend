'use strict';

/**
 * utils/phone.js — the one definition of "are these two phone numbers the
 * same person?"
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * A Bangladeshi mobile number arrives in this app in at least four shapes:
 *
 *     +8801712345678      the tenant's own signup, E.164
 *     01712345678         what a landlord types into the intake form
 *     8801712345678       what an SMS gateway hands back
 *     01712-345678        what somebody pastes out of their contacts
 *
 * They are one number. Nothing in the database agreed on that, so the app
 * compared them the only way an un-normalised column allows — a SUFFIX REGEX:
 *
 *     User.findOne({ phone: new RegExp(`${core}$`) })
 *
 * That works, and it cannot be indexed. An index is ordered by PREFIX, so
 * `/2345678$/` has no place to start: Mongo reads every key in the index and
 * tests each one. Measured on a 3,000-user seed it examined 3,001 keys to
 * return 1 row — and it runs once per unlinked booking on every host
 * dashboard load, plus on every tenant join (settleMoveOut).
 *
 * THE FIX IS TO STORE THE COMPARISON KEY, not just the display value. Every
 * phone column now has a `*Core` sibling holding the last 10 digits, written
 * by a pre('validate') hook so it cannot drift, and indexed. The regex becomes
 * an equality match.
 *
 * ── WHY THE LAST TEN DIGITS ──
 * A BD mobile number is 11 digits national (01XXXXXXXXX) and the country code
 * is +880. Dropping to the last 10 keeps everything that identifies the
 * subscriber (1XXXXXXXXX) and throws away only the parts that vary by format —
 * the leading 0 and the country code. Two numbers with the same last 10 digits
 * are the same subscriber; that is the assumption the old regex already made,
 * kept here unchanged so behaviour does not shift underneath anyone.
 *
 * NOT a validator. `phoneCore('garbage')` returns '' rather than throwing,
 * because half the callers are handling a landlord's free-typed intake field
 * where a blank or a partial number is normal and must not break a save.
 */

/**
 * Reduce any phone format to its comparable 10-digit core.
 *
 * @param   {*} input  anything; non-strings are coerced, null/undefined are safe
 * @returns {string}   10 digits, or '' when there aren't enough to identify anyone
 *
 * @example
 *   phoneCore('+8801712345678')  // '1712345678'
 *   phoneCore('01712345678')     // '1712345678'
 *   phoneCore('01712-345678')    // '1712345678'
 *   phoneCore('')                // ''
 *   phoneCore('12345')           // ''  — too short to be anybody
 */
function phoneCore(input) {
  const digits = String(input == null ? '' : input).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

/**
 * Do these two numbers belong to the same person, whatever format each is in?
 * Two blanks are NOT a match — otherwise every occupant with no phone on file
 * would match every other one, which is how a rent ledger ends up attached to
 * a stranger.
 */
function samePhone(a, b) {
  const ca = phoneCore(a);
  return Boolean(ca) && ca === phoneCore(b);
}

/**
 * Build the `$or` branches that find a person by phone across BOTH the fast
 * indexed column and the legacy un-backfilled one.
 *
 * Callers should prefer a plain `{ [coreField]: core }` equality once the
 * backfill migration has run everywhere. This helper exists for the window
 * where some rows are backfilled and some are not — see the "fast path, slow
 * fallback" pattern in booking.controller.resolveUserIdByPhone.
 *
 * @param {string} coreField   e.g. 'phoneCore' or 'members.phoneCore'
 * @param {string} rawField    e.g. 'phone'     or 'members.phone'
 * @param {string} core        output of phoneCore()
 */
function phoneMatchBranches(coreField, rawField, core) {
  if (!core) return [];
  return [
    { [coreField]: core },
    // Legacy fallback: rows written before phoneCore existed and not yet
    // backfilled. Unindexable, so this branch is the slow one — it disappears
    // once migrations/2026-09-06-phone-core.js has run.
    { [rawField]: new RegExp(`${core}$`) },
  ];
}

module.exports = { phoneCore, samePhone, phoneMatchBranches };
