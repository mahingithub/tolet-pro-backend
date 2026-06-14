'use strict';

const mongoose = require('mongoose');

/**
 * Pure helpers for property search + filter Mongo query construction. Kept
 * separate from the controller so the same logic can be reused by future
 * suggestion / autocomplete endpoints.
 *
 * Strategy:
 *   1. Build a $regex `$and` clause across every search token. Each token
 *      must be present somewhere in the haystack — this matches the user's
 *      expectations ("dhaka flat" must hit Dhaka properties that are flats).
 *   2. Tokens are case-insensitive and whitespace-tolerant. So "dhanmondi 12"
 *      matches "dhanmondi-12" or "Dhanmondi 12 / Block A".
 *   3. Other filters (division, type, category, price range) merge in as
 *      simple top-level fields.
 *   4. Sort + pagination are returned as separate options so the caller can
 *      chain a single Property.find(filter, ..., options).
 */

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Bound the worst-case cost of a single search. Each token becomes its own
// unanchored $regex clause, so an attacker sending a query with dozens of long
// tokens could force an expensive multi-regex scan. Real searches are a handful
// of short words, so these caps never affect normal use (audit 5.4 hardening).
const MAX_SEARCH_TOKENS = 8;
const MAX_TOKEN_LENGTH  = 64;

// Listing-intent aliases. Canonical values are 'rent' / 'sale' / 'commercial'.
// 'sell' / 'buy' / 'purchase' are legacy spellings that the Property model's
// pre('validate') hook already collapses to 'sale' on WRITE, and the one-time
// backfill migration rewrites in existing docs. We mirror that mapping HERE on
// the read/query side so a stale value — an old bookmarked '?intent=sell' link,
// a third-party API caller — still resolves to the right listings instead of
// matching zero docs. Keep this in lockstep with the model's normaliser.
const INTENT_ALIASES = { sell: 'sale', buy: 'sale', purchase: 'sale' };
function normaliseIntent(raw) {
  const v = String(raw || '').toLowerCase().trim();
  return INTENT_ALIASES[v] || v;
}

// Split a query into meaningful tokens, dropping noise like commas / dashes.
function tokenize(q) {
  return String(q || '')
    .toLowerCase()
    .split(/[\s,;]+/)
    .map((t) => t.replace(/^[-_/]+|[-_/]+$/g, ''))
    .filter((t) => t.length > 0 && t.length <= MAX_TOKEN_LENGTH);
}

// Build a single Mongo regex that matches a token allowing flexible
// whitespace/punctuation between adjacent characters typed by the user —
// covers "dhanmondi12" vs "Dhanmondi 12" vs "dhanmondi-12".
function tokenRegex(token) {
  const escaped = escapeRegex(token);
  return new RegExp(escaped, 'i');
}

function buildSearchFilter(rawFilters = {}) {
  const filter = {};
  const ands = [];

  // Multi-id lookup (saved-list sync). The client sends a comma-separated list
  // of property ids and wants the CURRENT server state of exactly those docs in
  // one request, so it can drop any that no longer exist from the user's saved
  // favourites. We validate each id and build an $in on _id. Garbage ids (stale
  // localStorage cruft, partially-typed values) are dropped SILENTLY rather than
  // thrown as a CastError that would 500 the whole request. If none are valid we
  // leave a guaranteed-empty match ($in: []) so the endpoint returns [] cleanly.
  // NOTE: the caller (listProperties) detects this _id.$in and deliberately
  // skips the default status='active' filter + lifts the page limit, so a saved
  // listing that's merely been rented/paused still comes back instead of looking
  // "deleted" to the client.
  if (rawFilters.ids != null && rawFilters.ids !== '') {
    const validIds = String(rawFilters.ids)
      .split(',')
      .map((s) => s.trim())
      .filter((s) => mongoose.Types.ObjectId.isValid(s))
      .map((s) => new mongoose.Types.ObjectId(s));
    filter._id = validIds.length ? { $in: validIds } : { $in: [] };
  }

  if (rawFilters.q) {
    const tokens = tokenize(rawFilters.q).slice(0, MAX_SEARCH_TOKENS);
    for (const t of tokens) {
      ands.push({ searchHaystack: { $regex: tokenRegex(t) } });
    }
  }

  if (rawFilters.division && rawFilters.division !== 'all') {
    filter.division = String(rawFilters.division).toLowerCase();
  }
  if (rawFilters.type)      filter.type      = rawFilters.type;
  if (rawFilters.category)  filter.category  = rawFilters.category;
  // Normalise legacy intent spellings to canonical before filtering.
  if (rawFilters.intent)    filter.intent    = normaliseIntent(rawFilters.intent);
  if (rawFilters.status)    filter.status    = rawFilters.status;

  const priceRange = {};
  if (rawFilters.minPrice != null && Number.isFinite(+rawFilters.minPrice)) {
    priceRange.$gte = +rawFilters.minPrice;
  }
  if (rawFilters.maxPrice != null && Number.isFinite(+rawFilters.maxPrice)) {
    priceRange.$lte = +rawFilters.maxPrice;
  }
  if (Object.keys(priceRange).length) filter.price = priceRange;

  if (ands.length) filter.$and = ands;
  return filter;
}

function buildSortOptions(sortBy = 'newest') {
  switch (sortBy) {
    case 'price_asc':  return { price: 1, _id: -1 };
    case 'price_desc': return { price: -1, _id: -1 };
    case 'popular':    return { popularity: -1, _id: -1 };
    case 'newest':
    default:           return { createdAt: -1, _id: -1 };
  }
}

module.exports = {
  buildSearchFilter,
  buildSortOptions,
  normaliseIntent,
  tokenize,
  tokenRegex,
  escapeRegex,
};
