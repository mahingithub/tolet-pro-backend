'use strict';

/**
 * thanaNames.js — one thana, one name.
 * ─────────────────────────────────────────────────────────────────────────────
 * A thana reaches this server in whichever language the person was reading.
 * The tenant's LocationBar sends `bn ? t.bn : t.en`, so ধানমন্ডি and Dhanmondi
 * are the same neighbourhood arriving as two different strings — and the
 * provider's coverage list is matched with an exact `$in`. Store one spelling,
 * search with the other, and the match silently fails for every tenant reading
 * the app in Bangla, which is most of them.
 *
 * So both sides go through here:
 *
 *   WRITE  provider.controller canonicalises `coverage.thanas` before saving
 *   READ   serviceBrowse canonicalises the tenant's thana before matching
 *
 * Symmetric by construction. Neither side has to know which language the other
 * one was speaking.
 *
 * ─── AN UNKNOWN NAME IS PASSED THROUGH, NOT DROPPED ──────────────────────────
 * `thana` is a free-text query parameter and always has been, and a provider
 * registered before this dataset existed may hold a spelling it has never seen.
 * Canonicalising to '' would turn "a place we don't recognise" into "nowhere",
 * which is a worse answer than leaving the string alone and letting an exact
 * match decide. So an unrecognised name comes back trimmed and otherwise
 * untouched.
 *
 * The dictionary itself is GENERATED — see data/bdThanas.js. Do not add
 * spellings here; add them to the generator's alias table so the tenant's
 * picker learns them at the same time.
 */

const { THANAS, THANA_ALIASES } = require('../data/bdThanas');

/**
 * Loose key for lookup: case, spacing and punctuation all fall away, so
 * "Cox's Bazar Sadar", "coxs bazar sadar" and "Coxsbazar-Sadar" collide.
 * Identical to the generator's `norm`, and it must stay that way — the keys in
 * THANA_ALIASES were built with it.
 */
const norm = (s) => String(s || '')
  .toLowerCase()
  .replace(/[^a-z0-9ঀ-৿]+/g, '');

/**
 * The one spelling this thana is stored and matched as: its English label.
 *
 * @param {string} value any spelling — English, Bengali, or a superseded
 *   romanisation (Faridgonj, Ukhiya, Barisal Sadar).
 * @returns {string} the canonical English label, or the trimmed input when we
 *   do not recognise it. Empty in, empty out.
 */
function canonicalThana(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return THANA_ALIASES[norm(raw)] || raw;
}

/** Is this a thana the pickers actually offer? */
function isKnownThana(value) {
  return Boolean(THANA_ALIASES[norm(value)]);
}

/**
 * Clean a provider's coverage list: canonicalise, drop blanks, de-dupe, and
 * cap.
 *
 * De-duping matters more than it looks — the picker offers ONE row per thana
 * name, but a client that sent both "ধানমন্ডি" and "Dhanmondi" would otherwise
 * burn two of the 50 slots on the same place.
 *
 * @param {unknown} list
 * @param {{ max?: number }} [opts]
 * @returns {string[]}
 */
function canonicalThanaList(list, { max = 50 } = {}) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const name = canonicalThana(item);
    if (!name) continue;
    const key = norm(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Every spelling worth matching a STORED thana string against.
 *
 * Used where the other side of the comparison is a field we did not write
 * through canonicalThana() — Provider.thana, which predates this module and
 * may hold either language. Coverage lists do not need it: both ends of that
 * comparison are canonical, so an exact match is correct and indexable.
 *
 * @returns {string[]} the input and its canonical form, de-duped.
 */
function thanaSpellings(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  const canonical = canonicalThana(raw);
  return canonical === raw ? [raw] : [raw, canonical];
}

module.exports = {
  THANAS,
  canonicalThana,
  canonicalThanaList,
  isKnownThana,
  thanaSpellings,
  norm,
};
