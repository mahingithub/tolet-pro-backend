'use strict';

/**
 * Service Browse Controller — the tenant-facing directory.
 * ──────────────────────────────────────────────────────────────────────────
 * Public and unauthenticated: a guest browsing /services is exactly who we
 * want to reach, and there is nothing private in an approved listing.
 *
 *   GET /api/services/nearby             providers near a point, nearest first
 *   GET /api/services/nearby/categories  which categories actually have anyone
 *   GET /api/services/providers/:id      one provider's public profile
 *
 * ─── THE ORDERING RULE ───────────────────────────────────────────────────────
 * DISTANCE FIRST, quality as a tie-break inside a distance band. A verified
 * shop 5 km away must not outrank an unverified one 200 m away — for a মুদি
 * দোকান or a gas cylinder, "near" IS the product, and a ranking that buries the
 * shop downstairs is a ranking nobody trusts twice. So results are bucketed
 * into 500 m bands and sorted (band, score, exact distance): nearest wins, and
 * among roughly-equally-near providers the verified, open, well-rated one goes
 * first. That also gives the badge real commercial value without letting it
 * override geography.
 *
 * ─── COVERAGE IS THE PROVIDER'S ANSWER, NOT OURS ─────────────────────────────
 * A provider says how far he travels (`coverage`). Being within his radius is a
 * filter, not a preference — showing a tenant someone who will not come is
 * worse than showing nobody.
 *
 * ─── NEVER SHOW AN EMPTY CATEGORY ────────────────────────────────────────────
 * /nearby/categories exists so the tenant grid can render only the tiles that
 * will actually produce results. An empty category teaches tenants the whole
 * feature is broken, and one bad tap costs more than the missing tile ever
 * would.
 */

const Provider = require('../models/Provider');
const ApiError = require('../utils/ApiError');
const origins = require('../services/thanaCentroid.service');
const { getCategory, freshnessState } = require('../config/serviceCategories');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// How far we look before giving up. Beyond this a "local" provider is not
// local, whatever his coverage radius claims.
const DEFAULT_RADIUS_M = 5000;
const MAX_RADIUS_M = 25000;

// Distance band for tie-breaking, in metres. 500 m is roughly "the same few
// streets" in urban Dhaka — close enough that a tenant does not care which of
// two shops is marginally nearer, and will care which one is verified.
const BAND_M = 500;

/**
 * The `$match` that enforces each provider's own coverage answer.
 *
 * `radius` providers are matched on distance. `areas` providers (an ISP sells
 * by covered thana, not by how far a van drives) are matched on the tenant's
 * thana — and when we don't know it, fall back to distance so they are not
 * silently dropped from every result.
 */
function coverageMatch(thana) {
  const radiusRule = {
    $and: [
      { $eq: ['$coverage.mode', 'radius'] },
      { $lte: ['$distanceM', { $multiply: [{ $ifNull: ['$coverage.radiusKm', 2] }, 1000] }] },
    ],
  };

  const areasRule = thana
    ? { $and: [
      { $eq: ['$coverage.mode', 'areas'] },
      { $in: [thana, { $ifNull: ['$coverage.thanas', []] }] },
    ] }
    // No thana known: keep areas-mode providers that are simply nearby rather
    // than excluding a whole coverage mode because the tenant's address is thin.
    : { $eq: ['$coverage.mode', 'areas'] };

  return { $match: { $expr: { $or: [radiusRule, areasRule] } } };
}

/** Verified + open + well-rated, as a number the sort can use. */
const SCORE_STAGE = {
  $addFields: {
    isVerified: {
      $and: [
        { $eq: ['$verification.status', 'verified'] },
        { $eq: ['$verification.tier', 'full'] },
      ],
    },
    distanceKm: { $divide: ['$distanceM', 1000] },
    distanceBand: { $floor: { $divide: ['$distanceM', BAND_M] } },
  },
};

const RANK_STAGE = {
  $addFields: {
    score: {
      $add: [
        { $cond: ['$isVerified', 100, 0] },
        { $cond: ['$openNow', 20, 0] },
        { $multiply: [{ $ifNull: ['$ratingAvg', 0] }, 4] },
      ],
    },
  },
};

/**
 * A provider as a tenant sees them.
 *
 * Two things are deliberately shaped here rather than in the model:
 *
 * 1. EXPIRED PRICES ARE HIDDEN — the PROVIDER IS NOT. His name, distance and
 *    phone number still work, and the phone number is the actual product. A
 *    price we can no longer stand behind is a broken promise with To-Let Pro's
 *    name on it; a delisted provider who paid a registration fee is a refund
 *    request. Hide the number, keep the man.
 *
 * 2. Only the category's `tenantCard` fields ride on the list response. The
 *    rest arrives on the detail endpoint, so a 30-provider list is not 30 full
 *    price tables.
 */
function toPublicProvider(doc, { full = false } = {}) {
  const cat = getCategory(doc.category);
  const fresh = freshnessState(doc.category, doc.pricesUpdatedAt);
  const pricesHidden = fresh.state === 'expired';

  const priceKeys = new Set(
    (cat?.providerFields || [])
      .filter((f) => f.type === 'price_rows' || f.type === 'money')
      .map((f) => f.key),
  );

  const wanted = full
    ? Object.keys(doc.fields || {})
    : (cat?.tenantCard || []);

  const fields = {};
  for (const key of wanted) {
    if (pricesHidden && priceKeys.has(key)) continue;
    if (doc.fields && doc.fields[key] !== undefined) fields[key] = doc.fields[key];
  }

  const coords = doc.geo && Array.isArray(doc.geo.coordinates) ? doc.geo.coordinates : [];

  return {
    id: String(doc._id),
    name: doc.name,
    about: full ? doc.about : undefined,
    category: doc.category,
    categoryLabel: cat ? cat.label : null,
    interaction: cat ? cat.interaction : null,

    // The Call button is the primary action in every tier, so the number is
    // never withheld — not even when the prices are stale.
    phone: doc.phone,
    altPhone: full ? doc.altPhone : undefined,
    // No owner id on the wire. In-app WebRTC calling between a tenant and a
    // provider is deliberately NOT supported — they live in separate identity
    // systems, and models/Call.js refs User on both ends. `tel:` is the
    // contact path, which is also the more reliable one for a shopkeeper whose
    // app may not be open. ContactEvent still counts the tap as a lead.

    photoUrl: doc.photoUrl,
    gallery: full ? (doc.gallery || []) : undefined,

    lat: coords[1] ?? null,
    lng: coords[0] ?? null,
    thana: doc.thana,
    area: doc.area,
    addressText: full ? doc.addressText : undefined,
    distanceKm: doc.distanceKm != null ? Math.round(doc.distanceKm * 10) / 10 : null,

    openNow: doc.openNow,
    hours: full ? doc.hours : undefined,
    isVerified: Boolean(
      doc.verification?.status === 'verified' && doc.verification?.tier === 'full',
    ),
    ratingAvg: doc.ratingAvg || 0,
    ratingCount: doc.ratingCount || 0,

    fields,
    // Said out loud rather than left as a silent gap, so the card can explain
    // itself: "দাম অনির্ধারিত — ফোন করে জেনে নিন".
    pricesHidden,
    priceAgeDays: fresh.ageDays,
  };
}

/** lat/lng from the query, or null when the tenant's location is unknown. */
function readPoint(req) {
  const lat = Number.parseFloat(req.query.lat);
  const lng = Number.parseFloat(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/services/nearby?lat=&lng=&category=&thana=&radius=&limit=
// ─────────────────────────────────────────────────────────────────────────────
exports.nearby = asyncH(async (req, res) => {
  const point = readPoint(req);
  const thana = req.query.thana ? String(req.query.thana).trim().slice(0, 100) : '';
  const category = req.query.category ? String(req.query.category) : '';
  const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));

  if (category && !getCategory(category)) {
    throw ApiError.badRequest('এই ক্যাটাগরি নেই।', { code: 'unknown_category' });
  }

  const baseQuery = { status: 'active' };
  if (category) baseQuery.category = category;

  if (!point && !thana) {
    throw ApiError.badRequest('অবস্থান বা থানা দিন।', { code: 'location_required' });
  }

  // ── Where is this search being made FROM? ─────────────────────────────────
  //
  // Property.gps is nullable and Booking.propertyId is too, so a real share of
  // tenants arrive with a thana name and nothing else. resolveUserOrigin turns
  // that name into a point when we hold enough verified pins in the thana to
  // derive one honestly, and returns `source: 'thana_name'` when we do not.
  //
  // The upazila dataset the app ships has no coordinates — only districts do,
  // and a district centroid is 10-30 km out, which against a 2 km hyperlocal
  // radius would order shops confidently and wrongly. See
  // services/thanaCentroid.service.js.
  const origin = await origins.resolveUserOrigin({ point, thana });

  // ── Still no point: rank order, and say so rather than pretending ─────────
  if (!origin.lat) {
    const rows = await Provider.find({
      ...baseQuery,
      $or: [{ thana }, { 'coverage.thanas': thana }],
    })
      .sort({ 'verification.tier': -1, openNow: -1, ratingAvg: -1 })
      .limit(limit)
      .lean();

    return res.json({
      providers: rows.map((d) => toPublicProvider(d)),
      sortedByDistance: false,
      origin,
      count: rows.length,
    });
  }

  // ── The real path: nearest first ──────────────────────────────────────────
  const radiusM = Math.min(
    MAX_RADIUS_M,
    Math.max(500, Number.parseInt(req.query.radius, 10) || DEFAULT_RADIUS_M),
  );

  const rows = await Provider.aggregate([
    {
      // $geoNear must be the first stage, and it is what uses the 2dsphere
      // index on { geo, category, status }.
      $geoNear: {
        near: { type: 'Point', coordinates: [point.lng, point.lat] },
        distanceField: 'distanceM',
        maxDistance: radiusM,
        query: baseQuery,
        spherical: true,
      },
    },
    SCORE_STAGE,
    coverageMatch(thana),
    RANK_STAGE,
    // Nearest band first; quality decides only between near-equals.
    { $sort: { distanceBand: 1, score: -1, distanceM: 1 } },
    { $limit: limit },
  ]);

  return res.json({
    providers: rows.map((d) => toPublicProvider(d)),
    sortedByDistance: true,
    // `origin.source` says whether this was a GPS fix or a neighbourhood
    // guess. The client must not print "৪০০ মিটার দূরে" off a centroid.
    origin,
    radiusM,
    count: rows.length,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/services/nearby/categories?lat=&lng=&thana=
//
// Which category tiles should the tenant grid actually render. Returns a count
// per category so a tile can say "৪ জন কাছে আছে" instead of just existing.
// ─────────────────────────────────────────────────────────────────────────────
exports.nearbyCategories = asyncH(async (req, res) => {
  const point = readPoint(req);
  const thana = req.query.thana ? String(req.query.thana).trim().slice(0, 100) : '';

  if (!point && !thana) {
    throw ApiError.badRequest('অবস্থান বা থানা দিন।', { code: 'location_required' });
  }

  // Same origin resolution as /nearby, so the tile grid and the list it opens
  // into never disagree about where the tenant is standing.
  const origin = await origins.resolveUserOrigin({ point, thana });

  let rows;
  if (origin && origin.lat) {
    const radiusM = Math.min(
      MAX_RADIUS_M,
      Math.max(500, Number.parseInt(req.query.radius, 10) || DEFAULT_RADIUS_M),
    );
    rows = await Provider.aggregate([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [origin.lng, origin.lat] },
          distanceField: 'distanceM',
          maxDistance: radiusM,
          query: { status: 'active' },
          spherical: true,
        },
      },
      SCORE_STAGE,
      coverageMatch(thana),
      { $group: { _id: '$category', count: { $sum: 1 }, nearestM: { $min: '$distanceM' } } },
    ]);
  } else {
    rows = await Provider.aggregate([
      { $match: { status: 'active', $or: [{ thana }, { 'coverage.thanas': thana }] } },
      { $group: { _id: '$category', count: { $sum: 1 }, nearestM: { $min: null } } },
    ]);
  }

  const categories = rows
    .map((r) => {
      const cat = getCategory(r._id);
      if (!cat) return null;
      return {
        id: cat.id,
        label: cat.label,
        blurb: cat.blurb,
        icon: cat.icon,
        interaction: cat.interaction,
        count: r.count,
        nearestKm: r.nearestM != null ? Math.round((r.nearestM / 1000) * 10) / 10 : null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.count - a.count);

  return res.json({ categories, count: categories.length, origin });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/services/providers/:id
//
// One provider's public profile. Reads through Provider.toJSON's rules by way
// of toPublicProvider, so identity documents and the registration TrxID cannot
// reach a tenant even if this handler is later edited carelessly.
// ─────────────────────────────────────────────────────────────────────────────
exports.getProvider = asyncH(async (req, res) => {
  const doc = await Provider.findById(req.params.id).lean();

  // A provider who is suspended, expired or still in review is simply not
  // there as far as a tenant is concerned — 404, not "this exists but is
  // hidden", which would leak the state of someone's application.
  if (!doc || doc.status !== 'active') {
    throw ApiError.notFound('প্রোভাইডার পাওয়া যায়নি।', { code: 'provider_not_found' });
  }

  const point = readPoint(req);
  if (point) {
    // Distance is computed here rather than asked of Mongo: one document does
    // not justify a geo query.
    const [lng, lat] = doc.geo?.coordinates || [];
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const R = 6371;
      const dLat = ((lat - point.lat) * Math.PI) / 180;
      const dLng = ((lng - point.lng) * Math.PI) / 180;
      const a = Math.sin(dLat / 2) ** 2
        + Math.cos((point.lat * Math.PI) / 180) * Math.cos((lat * Math.PI) / 180)
        * Math.sin(dLng / 2) ** 2;
      doc.distanceKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
  }

  return res.json({ provider: toPublicProvider(doc, { full: true }) });
});

exports.toPublicProvider = toPublicProvider;
exports.BAND_M = BAND_M;
