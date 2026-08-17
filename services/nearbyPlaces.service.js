'use strict';

/**
 * ─── NEARBY PLACES SERVICE ───────────────────────────────────────────────────
 *
 * Powers the "What's nearby" grid on the property details page: the nearest
 * hospital / school / market / mosque / bus stop / park to a property, with
 * real distances, sourced from OpenStreetMap via the Overpass API.
 *
 * WHY THIS FILE EXISTS
 * Overpass is free but slow and often overloaded. Measured against the three
 * mirrors this app used to walk *sequentially*:
 *
 *     overpass-api.de          → HTTP 504 after 10.8 s
 *     overpass.kumi.systems    → no response at all, hangs past 40 s
 *     lz4.overpass-api.de      → HTTP 200 after 8–16 s
 *
 * Sequential fall-through therefore cost ~45 s in the common case, on *every*
 * page view, because the old proxy cached nothing (it set Cache-Control on a
 * POST response, which no browser or CDN caches). That is the 5–10 s+ delay
 * and the intermittent "no data" the section suffered from.
 *
 * WHAT THIS DOES INSTEAD
 *   1. Races every mirror in parallel — the first valid answer wins, the rest
 *      are aborted. Worst case becomes one mirror's timeout, not the sum.
 *   2. Two cache layers in front of Overpass: an in-process LRU (microseconds)
 *      and a Mongo collection keyed on a ~110 m grid cell (milliseconds, shared
 *      across users and surviving restarts). POIs don't move, so a hit is
 *      almost always correct.
 *   3. Single-flight: concurrent callers for the same cell share one upstream
 *      request instead of stampeding Overpass.
 *   4. Stale-while-revalidate: a stale cell is returned instantly and
 *      refreshed in the background.
 *   5. A hard deadline on the caller's wait. If a cold cell can't be filled in
 *      time we return `pending` rather than making the user stare at a spinner;
 *      the fetch continues in the background and the retry lands on a warm
 *      cache.
 *
 * Net effect: first-ever view of a new neighbourhood costs one Overpass call,
 * every view after that is served from cache in a few milliseconds.
 */

const mongoose = require('mongoose');
const NearbyPlaces = require('../models/NearbyPlaces');

/**
 * Is Mongo actually connected right now?
 *
 * Mongoose buffers commands when it isn't, so a plain findOne() against a down
 * database sits for ~10 s before throwing — which would reintroduce exactly the
 * kind of stall this service exists to remove. The DB is only a cache layer
 * here, so skipping it when it's unavailable is always the right call.
 */
const dbReady = () => mongoose.connection?.readyState === 1;

// ─── CATEGORIES ──────────────────────────────────────────────────────────────
// `key` is the stable contract with the frontend — labels, icons and Bengali
// translations live in the UI, never here. `overpass` is the query fragment,
// and `match` re-identifies an element's category in the flat response.
//
// Note the deliberate use of `nwr` (node/way/relation) rather than `node` for
// everything except bus stops: parks, school campuses and hospital grounds are
// almost always mapped as polygons, so the old node-only query silently
// returned nothing for them. `out center` gives us a centroid for those.
const CATEGORIES = [
  {
    key: 'hospital',
    overpass: 'nwr["amenity"~"^(hospital|clinic|doctors)$"]',
    match: (t) => ['hospital', 'clinic', 'doctors'].includes(t.amenity),
  },
  {
    key: 'school',
    overpass: 'nwr["amenity"~"^(school|college|university)$"]',
    match: (t) => ['school', 'college', 'university'].includes(t.amenity),
  },
  {
    key: 'market',
    // Needs a name to be useful ("Market — 400 m" with no name is noise).
    overpass: 'nwr["shop"~"^(supermarket|mall|department_store|convenience|greengrocer)$"]["name"]',
    match: (t) =>
      ['supermarket', 'mall', 'department_store', 'convenience', 'greengrocer'].includes(t.shop) ||
      t.amenity === 'marketplace',
  },
  {
    key: 'marketplace',
    // Folded into the 'market' card by `match` above; separate query fragment
    // because bazaars use amenity=marketplace rather than a shop=* tag.
    overpass: 'nwr["amenity"="marketplace"]',
    mergeInto: 'market',
  },
  {
    key: 'mosque',
    overpass: 'nwr["amenity"="place_of_worship"]["religion"="muslim"]',
    match: (t) => t.amenity === 'place_of_worship' && t.religion === 'muslim',
  },
  {
    key: 'bus_stop',
    overpass: 'nwr["highway"~"^(bus_stop|bus_station)$"]',
    match: (t) => ['bus_stop', 'bus_station'].includes(t.highway) || t.amenity === 'bus_station',
  },
  {
    key: 'bus_station',
    overpass: 'nwr["amenity"="bus_station"]',
    mergeInto: 'bus_stop',
  },
  {
    key: 'park',
    overpass: 'nwr["leisure"~"^(park|garden|playground|pitch)$"]',
    match: (t) => ['park', 'garden', 'playground', 'pitch'].includes(t.leisure),
  },
];

// The categories the frontend actually renders, in order. Derived so the
// merge-only fragments above never leak into the response.
const OUTPUT_KEYS = CATEGORIES.filter((c) => !c.mergeInto).map((c) => c.key);

// ─── TUNING ──────────────────────────────────────────────────────────────────
const SEARCH_RADIUS_M = 3000;   // 3 km — matches what the UI implies by "nearby"
const PER_CATEGORY_CAP = 25;    // per-category `out` limit; see buildQuery()
const OVERPASS_QL_TIMEOUT = 25; // seconds, declared inside the query itself

// Our own abort per mirror. Generous on purpose: mirrors regularly need 8–20 s
// for a multi-category query, and because they race, a slow one costs nothing.
// Crucially this does NOT bound how long a user waits — getNearbyPlaces()
// applies its own much shorter deadline and lets the fetch finish in the
// background, so a patient timeout here only improves the cache fill rate.
const MIRROR_TIMEOUT_MS = 22000;

// All mirrors failed → try once more after this delay so a cold cell still
// fills without needing another visitor to trigger it.
const RETRY_DELAY_MS = 20000;

const SOFT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d → serve stale + refresh
const LRU_MAX = 750;            // cells held in process memory

// Every mirror is tried simultaneously, so a slow or dead one costs nothing as
// long as a sibling answers.
//
// These must all carry the FULL planet database. Regional instances are
// disqualified no matter how fast they are: overpass.osm.ch (Switzerland) and
// overpass.osm.jp (Japan) both answer a Bangladesh query with HTTP 200 and an
// empty `elements` array in ~2 s, which is faster than any global mirror and
// would therefore win the race with no data at all.
// Order carries no functional weight (they run concurrently) but reflects
// observed reliability. The two overpass-api.de hostnames share one backend and
// therefore one rate limit — when they 429, they 429 together, which is why
// having unrelated operators in this list matters.
const OVERPASS_ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

// Overpass's usage policy asks for a descriptive User-Agent.
const USER_AGENT = 'TO-LET-PRO/1.0 (+https://tolet-pro.vercel.app; rentals app)';

// ─── GEO HELPERS ─────────────────────────────────────────────────────────────

/** Great-circle distance in kilometres. */
function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Snap coordinates to a ~110 m grid. Two flats on the same street share a cell
 * and therefore a cache entry, which is what makes the cache hit rate high
 * enough to matter. The returned lat/lng are the *cell centre*, so every
 * property in the cell gets an identical (and identically cached) answer.
 */
function toCell(lat, lng) {
  const cLat = Math.round(lat * 1000) / 1000;
  const cLng = Math.round(lng * 1000) / 1000;
  return { cell: `${cLat.toFixed(3)},${cLng.toFixed(3)}`, lat: cLat, lng: cLng };
}

function isValidLatLng(lat, lng) {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
    // 0,0 is the classic "coordinates missing" sentinel — never worth querying.
    !(lat === 0 && lng === 0)
  );
}

// ─── OVERPASS ────────────────────────────────────────────────────────────────

/**
 * One statement per category, each with its own `out` limit.
 *
 * This matters: the previous implementation unioned every category and then
 * applied a single shared `out center body 20`, so in a dense city the first
 * 20 elements were all schools and mosques and the Park / Bus Stop cards
 * rendered "—" even though plenty existed nearby. Per-category limits
 * guarantee each card gets candidates.
 */
function buildQuery(lat, lng) {
  const around = `(around:${SEARCH_RADIUS_M},${lat},${lng})`;
  const body = CATEGORIES
    .map(({ overpass }) => `${overpass}${around};out center tags ${PER_CATEGORY_CAP};`)
    .join('\n');
  return `[out:json][timeout:${OVERPASS_QL_TIMEOUT}];\n${body}`;
}

/**
 * Race every mirror; first one to return parseable JSON with an `elements`
 * array wins and the others are aborted.
 *
 * Overpass has an irritating habit of answering 200 with an XML/HTML error
 * body, so "did it parse and contain elements" is the only trustworthy
 * success check.
 */
async function fetchFromOverpass(lat, lng) {
  const query = buildQuery(lat, lng);
  const startedAt = Date.now();
  const controllers = [];

  // Well-formed but empty responses are parked here instead of winning. See the
  // fallback below — an empty answer is only trusted once nobody offers data.
  const emptyAnswers = [];

  const attempt = (endpoint) => {
    const controller = new AbortController();
    controllers.push(controller);
    const timer = setTimeout(() => controller.abort(), MIRROR_TIMEOUT_MS);

    return fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: 'data=' + encodeURIComponent(query),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${endpoint} → HTTP ${res.status}`);
        const text = await res.text();
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          // 200 + HTML error page. Treat as failure so a sibling can win.
          throw new Error(`${endpoint} → non-JSON body`);
        }
        if (!json || !Array.isArray(json.elements)) {
          throw new Error(`${endpoint} → no elements array`);
        }
        if (json.elements.length === 0) {
          // Reject so a mirror holding real data can still win the race. A
          // regional extract answers "0 results" for out-of-region queries
          // quickly and correctly-shaped, which is worse than a plain error.
          emptyAnswers.push({ elements: [], source: new URL(endpoint).host });
          throw new Error(`${endpoint} → empty result`);
        }
        return { elements: json.elements, source: new URL(endpoint).host };
      })
      .finally(() => clearTimeout(timer));
  };

  try {
    // Promise.any resolves on the first mirror with actual data and only
    // rejects once every mirror has failed — the same fall-through semantics as
    // before, but costing one timeout instead of the sum of all of them.
    const winner = await Promise.any(OVERPASS_ENDPOINTS.map(attempt));
    return { ...winner, tookMs: Date.now() - startedAt };
  } catch (err) {
    // Nobody had data. If at least one healthy mirror said "genuinely nothing
    // here" (plausible for a remote rural property), trust that rather than
    // reporting a failure and retrying forever.
    if (emptyAnswers.length) {
      return { ...emptyAnswers[0], tookMs: Date.now() - startedAt };
    }
    throw err;
  } finally {
    // Stop the losers so we don't hold sockets open for no reason.
    for (const c of controllers) {
      try { c.abort(); } catch { /* already settled */ }
    }
  }
}

/**
 * Collapse a flat Overpass response into one nearest place per category.
 * Runs on the server so the browser receives ~600 bytes instead of ~90 KB.
 */
function reduceToNearest(elements, lat, lng) {
  const best = new Map(OUTPUT_KEYS.map((k) => [k, { key: k, name: '', nameBn: '', distKm: null }]));

  for (const el of elements) {
    const tags = el.tags || {};
    const elLat = el.lat ?? el.center?.lat;
    const elLng = el.lon ?? el.center?.lon;
    if (elLat == null || elLng == null) continue;

    for (const cat of CATEGORIES) {
      if (cat.mergeInto || !cat.match || !cat.match(tags)) continue;

      const dist = haversineKm(lat, lng, elLat, elLng);
      const current = best.get(cat.key);
      if (current.distKm !== null && current.distKm <= dist) continue;

      best.set(cat.key, {
        key: cat.key,
        name: tags.name || tags['name:en'] || '',
        // The Bengali label the UI prefers when the app is in বাংলা. Falls
        // back to the localised alt/official name before giving up.
        nameBn: tags['name:bn'] || tags['alt_name:bn'] || tags['official_name:bn'] || '',
        distKm: Math.round(dist * 1000) / 1000,
      });
      break; // an element belongs to exactly one output category
    }
  }

  return OUTPUT_KEYS.map((k) => best.get(k));
}

// ─── CACHE LAYERS ────────────────────────────────────────────────────────────

/** L1: in-process LRU. Map preserves insertion order, so the first key is oldest. */
const lru = new Map();

function lruGet(cell) {
  if (!lru.has(cell)) return null;
  const entry = lru.get(cell);
  lru.delete(cell);       // re-insert to mark as recently used
  lru.set(cell, entry);
  return entry;
}

function lruSet(cell, entry) {
  if (lru.has(cell)) lru.delete(cell);
  lru.set(cell, entry);
  if (lru.size > LRU_MAX) lru.delete(lru.keys().next().value);
}

/** Single-flight registry: cell → in-progress promise. */
const inflight = new Map();

const isStale = (refreshedAt) => Date.now() - new Date(refreshedAt).getTime() > SOFT_TTL_MS;

/** Cells whose retry has already been used up, so we don't loop on a dead area. */
const retried = new Set();

/**
 * Fetch from Overpass and persist, deduped per cell. Never rejects — callers
 * treat `null` as "couldn't fill this cell right now".
 */
function refreshCell(cell, lat, lng) {
  if (inflight.has(cell)) return inflight.get(cell);

  const job = (async () => {
    try {
      const { elements, source, tookMs } = await fetchFromOverpass(lat, lng);
      const places = reduceToNearest(elements, lat, lng);
      const entry = { cell, lat, lng, places, source, tookMs, refreshedAt: new Date() };

      lruSet(cell, entry);

      // Persist for other instances / restarts. Best-effort: a cache write
      // failing must never fail the request.
      if (dbReady()) NearbyPlaces.findOneAndUpdate(
        { cell },
        {
          $set: {
            cell, lat, lng, places, source, tookMs,
            refreshedAt: entry.refreshedAt,
            expiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
          },
        },
        { upsert: true, new: true },
      ).catch((e) => console.warn('[nearby] cache persist failed:', e.message));

      retried.delete(cell); // success — allow a future retry if it ever fails
      return entry;
    } catch (err) {
      // Promise.any failure carries an AggregateError; surface something useful.
      const detail = err?.errors?.map((e) => e.message).join('; ') || err.message;
      console.warn(`[nearby] all Overpass mirrors failed for ${cell}: ${detail}`);

      // Overpass overload is usually transient (429s clear, 504s pass). Try
      // once more shortly so this cell gets cached without waiting for another
      // visitor. One retry only — a genuinely unreachable Overpass shouldn't
      // turn into a background loop.
      if (!retried.has(cell)) {
        retried.add(cell);
        const t = setTimeout(() => refreshCell(cell, lat, lng), RETRY_DELAY_MS);
        // Don't hold the process open for a cache warm (matters for tests/CLI).
        if (typeof t.unref === 'function') t.unref();
      }
      return null;
    } finally {
      inflight.delete(cell);
    }
  })();

  inflight.set(cell, job);
  return job;
}

/** Read L1, then L2. Returns an entry or null. */
async function readCache(cell) {
  const hit = lruGet(cell);
  if (hit) return { ...hit, layer: 'memory' };

  if (!dbReady()) return null;

  try {
    const doc = await NearbyPlaces.findOne({ cell }).maxTimeMS(1500).lean();
    if (doc && Array.isArray(doc.places) && doc.places.length) {
      const entry = {
        cell: doc.cell,
        lat: doc.lat,
        lng: doc.lng,
        places: doc.places,
        source: doc.source,
        tookMs: doc.tookMs,
        refreshedAt: doc.refreshedAt,
      };
      lruSet(cell, entry); // promote into L1 for the next reader
      return { ...entry, layer: 'db' };
    }
  } catch (e) {
    console.warn('[nearby] cache read failed:', e.message);
  }
  return null;
}

// ─── PUBLIC API ──────────────────────────────────────────────────────────────

/**
 * Nearest POI per category around a coordinate.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {number} [waitMs] Hard ceiling on how long we'll block for a cold
 *        cell. On expiry we return `pending: true` and let the fetch finish in
 *        the background, so the UI can show a placeholder and retry into a
 *        warm cache instead of hanging.
 * @returns {Promise<{places: Array, cached: boolean, stale: boolean,
 *                    pending: boolean, layer: string, source: string,
 *                    tookMs: number, cell: string}>}
 */
async function getNearbyPlaces(lat, lng, waitMs = 9000) {
  if (!isValidLatLng(lat, lng)) {
    const err = new Error('Invalid coordinates.');
    err.code = 'bad_coords';
    throw err;
  }

  const { cell, lat: cLat, lng: cLng } = toCell(lat, lng);
  const cached = await readCache(cell);

  if (cached) {
    // Stale-while-revalidate: answer now, quietly re-fetch for the next caller.
    if (isStale(cached.refreshedAt)) refreshCell(cell, cLat, cLng);
    return {
      places: cached.places,
      cached: true,
      stale: isStale(cached.refreshedAt),
      pending: false,
      layer: cached.layer,
      source: cached.source || '',
      tookMs: cached.tookMs || 0,
      cell,
    };
  }

  // Cold cell. Start (or join) the fetch, but don't let the user wait forever.
  const job = refreshCell(cell, cLat, cLng);
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve('__timeout__'), waitMs);
  });

  let result;
  try {
    result = await Promise.race([job, deadline]);
  } finally {
    clearTimeout(timer);
  }

  if (result === '__timeout__') {
    return {
      places: emptyPlaces(),
      cached: false, stale: false, pending: true,
      layer: 'none', source: '', tookMs: waitMs, cell,
    };
  }

  if (!result) {
    // Every mirror failed. Empty rows so the UI degrades to "—" rather than
    // erroring, and `pending` invites a retry later.
    return {
      places: emptyPlaces(),
      cached: false, stale: false, pending: true,
      layer: 'none', source: '', tookMs: 0, cell,
    };
  }

  return {
    places: result.places,
    cached: false, stale: false, pending: false,
    layer: 'overpass', source: result.source, tookMs: result.tookMs, cell,
  };
}

/** Placeholder rows — same shape and order the UI expects, all blank. */
function emptyPlaces() {
  return OUTPUT_KEYS.map((key) => ({ key, name: '', nameBn: '', distKm: null }));
}

/**
 * Fire-and-forget cache warm. Called when a property is opened so the Overpass
 * round-trip starts before the browser has even asked for the nearby data.
 * Deliberately returns nothing and swallows everything.
 */
function warmNearbyPlaces(lat, lng) {
  if (!isValidLatLng(lat, lng)) return;
  const { cell, lat: cLat, lng: cLng } = toCell(lat, lng);

  // Cheap synchronous L1 check first so warming a hot cell costs nothing.
  if (lruGet(cell) || inflight.has(cell)) return;

  setImmediate(() => {
    readCache(cell)
      .then((hit) => {
        if (!hit) return refreshCell(cell, cLat, cLng);
        if (isStale(hit.refreshedAt)) return refreshCell(cell, cLat, cLng);
        return null;
      })
      .catch(() => { /* warming is best-effort by definition */ });
  });
}

module.exports = {
  getNearbyPlaces,
  warmNearbyPlaces,
  // Exported for tests / diagnostics.
  OUTPUT_KEYS,
  toCell,
  haversineKm,
  buildQuery,
};
