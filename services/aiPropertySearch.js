'use strict';

/**
 * aiPropertySearch.js — the assistant's listing search, with relaxation.
 * ─────────────────────────────────────────────────────────────────────────────
 * The assistant used to run ONE query built from every filter Gemini extracted,
 * ANDed together, and report "কোনো ফলাফল খুঁজে পাইনি" the moment it came back
 * empty. At this catalogue size that is almost always a false negative rather
 * than an honest answer: "I want a home in Uttara, bachelor flat" becomes
 * { q: 'uttara bachelor flat', type: 'flat', category: 'bachelor_male',
 *   intent: 'rent' } and misses the real Uttara listing — a hostel filed under
 * category 'student_male' — on three separate counts, every one of which the
 * person asking would have happily taken.
 *
 * So the search descends a ladder instead. Rung 0 is exactly what was asked
 * for; each rung below gives up the next-least-important constraint, and we
 * stop at the first rung that returns anything. What got given up comes back
 * with the results as `dropped` + `matchQuality`, because the assistant has to
 * SAY it — "উত্তরায় ঠিক ব্যাচেলর ফ্ল্যাট নেই, তবে এই হোস্টেলটি আছে" is a good
 * answer; quietly passing a hostel off as the flat they asked for is not.
 *
 * Two constraints are never relaxed:
 *   status 'active' — a paused/rented listing is not available at any rung.
 *   intent          — someone renting must never be shown properties for sale.
 *
 * Cost: the rungs run in sequence and stop at the first hit, so a normal search
 * is one or two queries. The worst case (nothing in the catalogue matches the
 * intent at all) is one bounded `$limit: 6` aggregation per rung.
 */

const Property = require('../models/Property');
const searchService = require('./searchService');
const { expandLocationToken } = require('../utils/locationAliases');

const RESULT_LIMIT = 6;

// Words Gemini leaves in `q` that describe the PROPERTY, not the place. They
// already have dedicated filter fields (type / category / intent), so inside
// `q` they can only ever subtract: buildSearchFilter requires EVERY token to
// appear in the haystack, and "bachelor" is not in the haystack of a listing
// filed as student_male. Dropping them is what turns "uttara bachelor flat"
// back into "uttara".
const DESCRIPTOR_TOKENS = new Set([
  // English / Banglish
  'flat', 'flats', 'apartment', 'apartments', 'house', 'home', 'basa', 'bari',
  'room', 'rooms', 'seat', 'seats', 'bed', 'beds', 'bedroom', 'bedrooms',
  'bath', 'baths', 'bathroom', 'bathrooms', 'sublet', 'hostel', 'mess',
  'bachelor', 'bachelors', 'family', 'student', 'students',
  'male', 'female', 'boys', 'girls', 'men', 'women',
  'office', 'shop', 'showroom', 'restaurant', 'commercial', 'residential',
  'rent', 'rental', 'sale', 'buy', 'sell', 'price', 'budget', 'cheap',
  'available', 'looking', 'want', 'need', 'find', 'search', 'show', 'me', 'for', 'in', 'a', 'an', 'the',
  // Bengali
  'বাসা', 'বাড়ি', 'ফ্ল্যাট', 'এপার্টমেন্ট', 'রুম', 'সিট', 'মেস', 'হোস্টেল', 'সাবলেট',
  'ব্যাচেলর', 'ফ্যামিলি', 'ছাত্র', 'ছাত্রী', 'ছেলে', 'মেয়ে',
  'অফিস', 'দোকান', 'শোরুম', 'রেস্টুরেন্ট',
  'ভাড়া', 'বিক্রি', 'দরকার', 'চাই', 'খুঁজছি', 'বাজেট',
]);

/**
 * Narrow a free-text query to the tokens that are plausibly place names.
 * A token survives unless it is known property vocabulary AND is not a place
 * the bilingual location dictionary recognises (so "Mirpur" survives even
 * though "mirpur" would never be a descriptor, and an area we have no alias
 * for — "Banasree" — survives simply by not being on the descriptor list).
 *
 * @returns {string|null} the narrowed query, or null when nothing changed /
 *   the query was descriptors all the way down (in which case the rungs below
 *   drop `q` outright instead).
 */
function placeOnlyQuery(q) {
  const tokens = searchService.tokenize(q);
  if (!tokens.length) return null;
  const kept = tokens.filter(
    (t) => !DESCRIPTOR_TOKENS.has(t) || expandLocationToken(t).length > 1,
  );
  if (!kept.length || kept.length === tokens.length) return null;
  return kept.join(' ');
}

// The ladder. `drop` is cumulative and ordered by what a person gives up first:
// which tenant bucket the listing is labelled with, then the bedroom count,
// then the descriptive noise in the query, then the property type, then the
// budget — and only at the very bottom the area itself, because where you live
// is the one thing almost nobody compromises on first.
const RUNGS = [
  { drop: [],                                                             quality: 'exact'       },
  { drop: ['category'],                                                   quality: 'relaxed'     },
  { drop: ['category', 'beds', 'baths'],                                  quality: 'relaxed'     },
  { drop: ['category', 'beds', 'baths'],                                  quality: 'relaxed', placeOnlyQ: true },
  { drop: ['category', 'beds', 'baths', 'type'],                          quality: 'relaxed', placeOnlyQ: true },
  { drop: ['category', 'beds', 'baths', 'type', 'minPrice'],              quality: 'relaxed', placeOnlyQ: true, widenPrice: 1.5 },
  { drop: ['category', 'beds', 'baths', 'type', 'minPrice', 'maxPrice'],  quality: 'relaxed', placeOnlyQ: true },
  { drop: ['category', 'beds', 'baths', 'type', 'minPrice', 'maxPrice', 'q'],             quality: 'nearby'      },
  { drop: ['category', 'beds', 'baths', 'type', 'minPrice', 'maxPrice', 'q', 'division'], quality: 'other_areas' },
];

// Keep only the arguments we understand, in the shape the filter builder wants.
function normaliseArgs(args = {}) {
  const out = {};
  if (args.q)        out.q        = String(args.q).trim();
  if (args.division) out.division = String(args.division).toLowerCase();
  if (args.type)     out.type     = String(args.type);
  if (args.category) out.category = String(args.category);
  if (args.intent)   out.intent   = String(args.intent);
  for (const k of ['minPrice', 'maxPrice', 'beds', 'baths']) {
    if (args[k] != null && Number.isFinite(+args[k])) out[k] = +args[k];
  }
  if (!out.q) delete out.q;
  return out;
}

// Stable identity for a rung's filters, so rungs that changed nothing (no
// category was given, so "drop category" is the same search) collapse into one.
function rungKey(input) {
  return Object.keys(input).sort().map((k) => `${k}=${input[k]}`).join('&');
}

/**
 * Expand the AI's filters into the ordered list of searches to try.
 * Pure — no database — so the ladder itself is unit-testable.
 *
 * @param {object} args raw tool arguments from the model
 * @returns {Array<{ input: object, matchQuality: string, dropped: string[],
 *                   budgetWidenedTo: number|null, areaNarrowedTo: string|null }>}
 */
function buildRungs(args = {}) {
  const base = normaliseArgs(args);
  const narrowedQ = base.q ? placeOnlyQuery(base.q) : null;

  const rungs = [];
  const seen = new Set();

  for (const rung of RUNGS) {
    const input = {};
    for (const [k, v] of Object.entries(base)) {
      if (!rung.drop.includes(k)) input[k] = v;
    }

    let areaNarrowedTo = null;
    if (rung.placeOnlyQ && narrowedQ && input.q) {
      input.q = narrowedQ;
      areaNarrowedTo = narrowedQ;
    }

    let budgetWidenedTo = null;
    if (rung.widenPrice && input.maxPrice != null) {
      input.maxPrice = Math.round(input.maxPrice * rung.widenPrice);
      budgetWidenedTo = input.maxPrice;
    }

    const key = rungKey(input);
    if (seen.has(key)) continue; // identical to a rung we're already trying
    seen.add(key);

    // 'nearby' means "not your area, but still your city" — which only holds if
    // a division survived to keep it in the city. With no division given, this
    // rung IS the everything-everywhere rung, and has to say so.
    const quality =
      rung.quality === 'nearby' && !base.division ? 'other_areas' : rung.quality;

    rungs.push({
      input,
      matchQuality: quality,
      // Only report constraints that were actually there to give up.
      dropped: rung.drop.filter((k) => base[k] != null),
      budgetWidenedTo,
      areaNarrowedTo,
    });
  }

  return rungs;
}

/**
 * Run one rung. Reuses the SAME buildSearchFilter the rest of the app searches
 * with. OOM-safe: the aggregation collapses any legacy base64 coverPhoto to ''
 * inside Mongo so it never loads into Node memory (matching the hardening
 * already applied across property/inquiry services).
 */
async function runOne(input, { sortBy }) {
  const filter = searchService.buildSearchFilter(input);
  if (!filter.status) filter.status = 'active'; // only ever surface live listings

  if (input.beds  != null) filter.beds  = { $gte: input.beds };
  if (input.baths != null) filter.baths = { $gte: input.baths };

  const docs = await Property.aggregate([
    { $match: filter },
    { $sort: searchService.buildSortOptions(sortBy) },
    { $limit: RESULT_LIMIT },
    {
      $project: {
        title: 1, price: 1, beds: 1, baths: 1, sqft: 1,
        type: 1, category: 1, intent: 1, division: 1,
        location: 1, area: 1, district: 1,
        coverPhoto: {
          $cond: [
            { $regexMatch: { input: { $ifNull: ['$coverPhoto', ''] }, regex: /^https?:\/\//i } },
            '$coverPhoto',
            '',
          ],
        },
      },
    },
  ]);

  return docs.map((d) => ({
    id:         String(d._id),
    title:      d.title || 'Property',
    price:      d.price ?? null,
    beds:       d.beds ?? null,
    baths:      d.baths ?? null,
    sqft:       d.sqft ?? null,
    type:       d.type || '',
    category:   d.category || '',
    location:   [d.location, d.area, d.district].filter(Boolean)[0] || '',
    coverPhoto: d.coverPhoto || '',
  }));
}

/**
 * Search live listings for the assistant, descending the relaxation ladder
 * until something comes back.
 *
 * @returns {Promise<{ properties: object[], matchQuality: string,
 *                     dropped: string[], budgetWidenedTo: number|null,
 *                     areaNarrowedTo: string|null, searched: object }>}
 *   matchQuality is 'exact' (nothing given up), 'relaxed' (some attribute
 *   filters ignored, area kept), 'nearby' (area ignored, division kept),
 *   'other_areas' (area and division both ignored) or 'none' (the catalogue
 *   genuinely has nothing for this intent).
 */
async function searchListings(args = {}) {
  const rungs = buildRungs(args);
  const askedMax = normaliseArgs(args).maxPrice;

  for (const rung of rungs) {
    // Once we stop honouring the budget, cheapest-first puts whatever is
    // closest to what they could actually afford at the top.
    const relaxedBudget = askedMax != null && rung.input.maxPrice !== askedMax;
    const properties = await runOne(rung.input, { sortBy: relaxedBudget ? 'price_asc' : 'newest' });

    if (properties.length) {
      return {
        properties,
        matchQuality: rung.matchQuality,
        dropped: rung.dropped,
        budgetWidenedTo: rung.budgetWidenedTo,
        areaNarrowedTo: rung.areaNarrowedTo,
        searched: rung.input,
      };
    }
  }

  return {
    properties: [],
    matchQuality: 'none',
    dropped: [],
    budgetWidenedTo: null,
    areaNarrowedTo: null,
    searched: rungs.length ? rungs[0].input : {},
  };
}

module.exports = {
  searchListings,
  // exported for tests
  buildRungs,
  placeOnlyQuery,
  DESCRIPTOR_TOKENS,
  RESULT_LIMIT,
};
