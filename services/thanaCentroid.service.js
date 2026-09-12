'use strict';

/**
 * thanaCentroid.service — giving a thana name a point to measure from.
 * ─────────────────────────────────────────────────────────────────────────────
 * GET /api/services/nearby cannot sort by distance when the tenant has no
 * coordinates, and a real share of them don't: Property.gps is nullable and
 * Booking.propertyId is too, so a tenant who typed their address by hand has a
 * thana name and nothing else. Until now that path returned rank order and said
 * `sortedByDistance: false` rather than pretending — honest, and not much use
 * in a category where the whole point is "who is nearest".
 *
 * ─── WHY THIS IS DERIVED AND NOT IMPORTED ────────────────────────────────────
 * The obvious fix is a thana-centroid table. The dataset the app already ships
 * (tolet-pro-frontend/scripts/bd-geo/source) does not have one: bd_districts
 * carries lat/lon, bd_upazilas carries only { id, district_id, name, bn_name,
 * url }. A district centroid is 10–30 km from the thana in question, which is
 * worse than useless against a 2 km hyperlocal radius — it would order shops
 * confidently and wrongly.
 *
 * So the centroid is computed from the coordinates WE already hold for that
 * thana: the pins verified providers dropped, and the GPS on properties listed
 * there. Both were placed by a human who was standing in the place. It costs no
 * external dataset, it sharpens as the thana fills up, and a thana we have no
 * points for stays honestly unsorted instead of being guessed at.
 *
 * ─── THE MEDIAN, NOT THE MEAN ────────────────────────────────────────────────
 * One property pinned in the wrong district — a typo, a map tap on the wrong
 * screen — drags a mean clean out of the thana. The component-wise median
 * ignores it. This matters because the input is user-placed pins, and at a
 * dozen points one bad row is 8% of the average and 0% of the median.
 */

const Provider = require('../models/Provider');
const Property = require('../models/Property');

// Below this many points the median is not measuring a neighbourhood, it is
// measuring whoever happened to sign up first. A thana under the floor returns
// null and the caller keeps saying `sortedByDistance: false`.
const MIN_POINTS = 3;

// Recomputed at most this often per thana. These move slowly — a thana's centre
// of mass does not shift between two tenants' searches — and the sweep behind
// this is a convenience, not a correctness requirement.
const TTL_MS = 12 * 60 * 60 * 1000;

// Bangladesh, generously boxed. A pin outside it is a swapped lat/lng or a
// default-zero coordinate, and either would move a centroid into the Bay of
// Bengal.
const BD_BOX = { minLat: 20.5, maxLat: 26.7, minLng: 88.0, maxLng: 92.7 };

const inBangladesh = (lat, lng) => (
  Number.isFinite(lat) && Number.isFinite(lng)
  && lat >= BD_BOX.minLat && lat <= BD_BOX.maxLat
  && lng >= BD_BOX.minLng && lng <= BD_BOX.maxLng
);

/**
 * Process-local cache. Deliberately NOT Redis: the value is a pair of floats
 * derived from data this process can read in one indexed query, and a cache
 * miss costs one aggregation. Adding a network round-trip to save a local one
 * would be slower on the miss and no faster on the hit.
 */
const cache = new Map();   // thana → { lat, lng, n, at }

/** Component-wise median. Not the centre of the polygon; the middle of the pins. */
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Every trustworthy point we hold inside a thana.
 *
 * Providers first because their pins were checked by a human during
 * verification; properties are the volume. Both are filtered through the
 * bounding box before they are allowed to vote.
 */
async function collectPoints(thana) {
  const [providers, properties] = await Promise.all([
    Provider.find({ thana, status: { $in: ['active', 'expired', 'suspended'] } })
      .select('geo')
      .limit(500)
      .lean(),
    // Matched on Property.thana exactly, never on the free-text address. A
    // regex over the address string matches "মিরপুর রোড, ধানমন্ডি" for a
    // মিরপুর search and drags the centroid into the wrong neighbourhood —
    // and this whole service exists to avoid confidently wrong distances.
    Property.find({ thana, 'gps.lat': { $ne: null } })
      .select('gps')
      .limit(500)
      .lean()
      .catch(() => []),
  ]);

  const points = [];
  for (const p of providers) {
    const c = p.geo && Array.isArray(p.geo.coordinates) ? p.geo.coordinates : null;
    // Stored [lng, lat] — the one ordering in this codebase that runs opposite
    // to everything else.
    if (c && inBangladesh(c[1], c[0])) points.push({ lat: c[1], lng: c[0] });
  }
  for (const p of properties) {
    const lat = Number(p.gps?.lat);
    const lng = Number(p.gps?.lng);
    if (inBangladesh(lat, lng)) points.push({ lat, lng });
  }
  return points;
}

/**
 * The point to measure a thana's searches from, or null when we do not have
 * enough evidence to guess one.
 *
 * Returning null is a real answer, not a failure: the caller falls back to rank
 * order and says so. A centroid invented from one pin would order every shop in
 * the thana by its distance from that single shop.
 */
async function centroidFor(thana, { force = false } = {}) {
  const key = String(thana || '').trim();
  if (!key) return null;

  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < TTL_MS) {
    return hit.lat === null ? null : hit;
  }

  const points = await collectPoints(key);
  if (points.length < MIN_POINTS) {
    // Negative results are cached too — a thana with no providers is exactly
    // the one that will be asked about repeatedly and found empty every time.
    cache.set(key, { lat: null, lng: null, n: points.length, at: Date.now() });
    return null;
  }

  const value = {
    lat: median(points.map((p) => p.lat)),
    lng: median(points.map((p) => p.lng)),
    n: points.length,
    at: Date.now(),
  };
  cache.set(key, value);
  return value;
}

/**
 * Resolve where a browse request is being made FROM.
 *
 * One helper rather than the same three lines in `nearby` and
 * `nearbyCategories`, and it reports HOW it decided — a caller must be able to
 * tell a GPS fix from a neighbourhood guess, because only one of them justifies
 * telling the tenant "৪০০ মিটার দূরে".
 */
async function resolveUserOrigin({ point, thana }) {
  if (point) return { ...point, source: 'gps', thana: thana || undefined };

  if (thana) {
    const c = await centroidFor(thana);
    if (c) {
      return {
        lat: c.lat,
        lng: c.lng,
        thana,
        // Named honestly. The client should round distances hard, or say
        // "এলাকার মধ্যে" instead of a figure it cannot stand behind.
        source: 'thana_centroid',
        basedOn: c.n,
      };
    }
    return { thana, source: 'thana_name' };
  }

  return null;
}

/** Drop the memo — for tests, and for a script that just imported providers. */
function clearCache() { cache.clear(); }

module.exports = {
  resolveUserOrigin,
  centroidFor,
  collectPoints,
  clearCache,
  median,
  inBangladesh,
  MIN_POINTS,
  TTL_MS,
};
