'use strict';

/**
 * services.routes.js — mounted at /api/services.
 *
 * GET /api/services/categories       the category registry
 * GET /api/services/categories/:id   one category
 *
 * ─── ONE DEFINITION, THREE CONSUMERS ─────────────────────────────────────────
 * config/serviceCategories.js is the single source for what a category IS, and
 * this route is how the three clients read it. None of them keeps a copy — the
 * backend is CommonJS, both frontends are ESM, and a hand-synced copy across
 * three repos is a guaranteed "the form asked for a field the API rejects".
 *
 *   provider onboarding   needs providerFields (to render the registration
 *                         form), nameLabel, photoLabel, defaultCoverage, kyc
 *                         → GET /categories            (view=full, the default)
 *   provider listing edit needs ONE category's providerFields, especially its
 *                         price_rows definitions
 *                         → GET /categories/:id
 *   tenant service page   needs only the tile grid — id, label, blurb, icon
 *                         → GET /categories?view=grid  (3.7 kB, not 23.5 kB)
 *
 * ─── WHY view=full IS THE DEFAULT ────────────────────────────────────────────
 * The light view is six times smaller and the tenant page is the busiest
 * consumer, so the temptation is to make `grid` the default. Don't: a provider
 * client that forgets the parameter would then render a registration form with
 * no questions in it and fail silently. A tenant page that forgets it merely
 * downloads more than it needs. Correctness is the safer default; the small
 * payload is opt-in.
 *
 * ─── THIS ENDPOINT DOES NOT KNOW WHERE YOU ARE ───────────────────────────────
 * It returns configuration, not availability. "Never show an empty category"
 * is a real rule, but it needs the user's location and a Provider query, so it
 * belongs to the browse endpoint — NOT here. Do not assume a category in this
 * response has anybody registered under it.
 *
 * Public on purpose: a guest browsing /services is exactly who we want to
 * reach, and there is nothing private in a category definition.
 */

const express = require('express');
const crypto = require('crypto');

const {
  CATEGORIES,
  liveCategories,
  getCategory,
  INTERACTIONS,
  FIELD_TYPES,
  KYC_TIERS,
  PRICE_AUTHORITIES,
} = require('../config/serviceCategories');

const browse = require('../controllers/serviceBrowse.controller');
const contact = require('../controllers/contactEvent.controller');
const reviews = require('../controllers/providerReview.controller');
const optionalAuth = require('../middleware/optionalAuth');

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// Browse — the tenant-facing directory.
//
// Public and unauthenticated, like the category registry above: a guest
// looking at /services is exactly who we want to reach.
//
// NOT cached the way /categories is. These responses depend on the caller's
// coordinates and on which providers are open right now, so a shared cache
// would serve one tenant another tenant's neighbourhood.
//
// '/nearby/categories' is declared BEFORE '/nearby' would ever be asked to
// match it — a different path today, but adding '/nearby/:something' later
// would swallow it.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/nearby/categories', browse.nearbyCategories);
router.get('/nearby', browse.nearby);
router.get('/providers/:id', browse.getProvider);
// Public on purpose, like the listing itself: a review nobody can read
// before deciding to call is a review that does no work.
router.get('/providers/:id/reviews', reviews.listForProvider);

// Record that somebody opened a card or tapped ফোন করুন. optionalAuth: a guest
// browsing is real demand, they simply cannot be deduped. Never 4xx's on a bad
// providerId — this is analytics on a page the user is already looking at, and
// an error toast over a counter would be absurd.
router.post('/contact', optionalAuth, contact.record);

// ─────────────────────────────────────────────────────────────────────────────
// Precomputed payloads
//
// The registry is static for the life of the process — it changes only on
// deploy — so every view is serialised ONCE at module load and every request
// after that is a string write and an ETag compare. Nothing is built per
// request, and nothing here is allowed to vary per request either.
//
// ⚠ Never put a timestamp (`generatedAt`, `now`, …) in these payloads. It
// would change the body on every boot, break the ETag contract, and quietly
// turn a cacheable response into an uncacheable one.
// ─────────────────────────────────────────────────────────────────────────────

/** The tenant tile grid: everything needed to draw a card, nothing more. */
const toGrid = (c) => ({
  id: c.id,
  status: c.status,
  icon: c.icon,
  label: c.label,
  blurb: c.blurb,
  interaction: c.interaction,
});

function buildPayload({ view, status }) {
  const source = status === 'all' ? CATEGORIES : liveCategories();
  const categories = view === 'grid' ? source.map(toGrid) : source;

  return {
    categories,
    // The enums the clients branch on, shipped alongside so a form renderer
    // never hardcodes a list that this file owns.
    meta: { interactions: INTERACTIONS, fieldTypes: FIELD_TYPES, kycTiers: KYC_TIERS, priceAuthorities: PRICE_AUTHORITIES },
    count: categories.length,
    view,
    status,
  };
}

/** view|status → { body, etag }. Four combinations, all built once. */
const VARIANTS = new Map();
for (const view of ['full', 'grid']) {
  for (const status of ['live', 'all']) {
    const body = JSON.stringify(buildPayload({ view, status }));
    const etag = `"cat-${crypto.createHash('sha1').update(body).digest('hex').slice(0, 16)}"`;
    VARIANTS.set(`${view}:${status}`, { body, etag });
  }
}

// Config that changes only on deploy, and the ETag changes WITH the deploy —
// so a long shared cache is safe. The browser revalidates every 5 minutes; a
// CDN holds it for a day and serves stale while it revalidates behind the
// scenes. A deploy that edits a category invalidates every cache immediately
// because the hash moves.
const CACHE_CONTROL = 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800';

/** Honour If-None-Match. Returns true when a 304 was sent. */
function notModified(req, res, etag) {
  const ifNoneMatch = req.headers['if-none-match'];
  if (ifNoneMatch && ifNoneMatch.split(',').some((t) => t.trim() === etag)) {
    res.status(304).end();
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/services/categories
//   ?view=full|grid     full (default) = providerFields included
//   ?status=live|all    live (default) = only categories open for registration
// ─────────────────────────────────────────────────────────────────────────────
router.get('/categories', (req, res) => {
  // Anything unrecognised falls back to the safe default rather than 400ing.
  // A typo'd query parameter must not take down a tenant's services page.
  const view = req.query.view === 'grid' ? 'grid' : 'full';
  const status = req.query.status === 'all' ? 'all' : 'live';

  const { body, etag } = VARIANTS.get(`${view}:${status}`);

  res.set('Cache-Control', CACHE_CONTROL);
  res.set('ETag', etag);
  res.set('Vary', 'Accept-Encoding');
  if (notModified(req, res, etag)) return undefined;

  res.type('application/json');
  return res.send(body);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/services/categories/:id
//
// For the provider's listing editor, which needs exactly one category's
// providerFields and has no use for the other fourteen.
//
// Resolves PLANNED categories too: a provider already registered under a
// category we later took out of the launch set must still be able to open and
// edit his own prices. Whether new registrations are accepted is a separate
// question, answered by validateProviderFields().
// ─────────────────────────────────────────────────────────────────────────────
router.get('/categories/:id', (req, res) => {
  const category = getCategory(req.params.id);

  if (!category) {
    // Not cacheable: a category id that is missing today may exist after the
    // next deploy, and a cached 404 would outlive the fix.
    res.set('Cache-Control', 'no-store');
    return res.status(404).json({
      message: 'এই ক্যাটাগরি পাওয়া যায়নি।',
      code: 'unknown_category',
    });
  }

  const body = JSON.stringify({ category });
  const etag = `"cat1-${crypto.createHash('sha1').update(body).digest('hex').slice(0, 16)}"`;

  res.set('Cache-Control', CACHE_CONTROL);
  res.set('ETag', etag);
  res.set('Vary', 'Accept-Encoding');
  if (notModified(req, res, etag)) return undefined;

  res.type('application/json');
  return res.send(body);
});

module.exports = router;
