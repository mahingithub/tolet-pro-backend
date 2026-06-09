'use strict';

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

// Split a query into meaningful tokens, dropping noise like commas / dashes.
function tokenize(q) {
  return String(q || '')
    .toLowerCase()
    .split(/[\s,;]+/)
    .map((t) => t.replace(/^[-_/]+|[-_/]+$/g, ''))
    .filter((t) => t.length > 0);
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

  if (rawFilters.q) {
    const tokens = tokenize(rawFilters.q);
    for (const t of tokens) {
      ands.push({ searchHaystack: { $regex: tokenRegex(t) } });
    }
  }

  if (rawFilters.division && rawFilters.division !== 'all') {
    filter.division = String(rawFilters.division).toLowerCase();
  }
  if (rawFilters.type)      filter.type      = rawFilters.type;
  if (rawFilters.category)  filter.category  = rawFilters.category;
  if (rawFilters.intent)    filter.intent    = rawFilters.intent;
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
  tokenize,
  tokenRegex,
  escapeRegex,
};
