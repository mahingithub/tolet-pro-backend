'use strict';

/**
 * Geo routes — backs the property "What's nearby" grid.
 *
 * GET /api/geo/nearby?lat=&lng=      ← preferred
 *   Returns the nearest hospital / school / market / mosque / bus stop / park
 *   already reduced to one row per category:
 *
 *     { places: [{ key, name, nameBn, distKm }], cached, stale, pending }
 *
 *   All the slow work (Overpass, mirror racing, caching, distance maths) lives
 *   in services/nearbyPlaces.service.js. Being a GET matters: unlike the old
 *   POST proxy, the response is genuinely cacheable by the browser, any CDN in
 *   front of the API, and the service worker.
 *
 * POST /api/geo/overpass            ← deprecated, kept for compatibility
 *   Raw Overpass passthrough. Older clients (and any cached JS bundle still
 *   in the wild) call this, so it stays until those age out.
 */

const express = require('express');
const router = express.Router();

const nearbyService = require('../services/nearbyPlaces.service');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/geo/nearby
// ─────────────────────────────────────────────────────────────────────────────
router.get('/nearby', async (req, res) => {
  const lat = Number.parseFloat(req.query.lat);
  const lng = Number.parseFloat(req.query.lng);

  try {
    const result = await nearbyService.getNearbyPlaces(lat, lng);

    if (result.pending) {
      // The cell is still being filled upstream. Don't let this be cached —
      // the client should come back for the real answer shortly.
      res.set('Cache-Control', 'no-store');
    } else {
      // POIs are effectively static, so cache hard and let revalidation happen
      // in the background.
      res.set(
        'Cache-Control',
        'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800',
      );
      res.set('ETag', `W/"nearby-${result.cell}-${result.places.length}"`);
    }

    // Diagnostics for "why was this slow" without needing server logs.
    res.set('X-Nearby-Cache', result.pending ? 'pending' : result.layer);

    return res.json({
      places: result.places,
      cached: result.cached,
      stale: result.stale,
      pending: result.pending,
      radiusM: 3000,
    });
  } catch (err) {
    if (err.code === 'bad_coords') {
      return res.status(400).json({
        message: 'Valid lat and lng query parameters are required.',
        code: 'bad_coords',
      });
    }
    console.error('[geo/nearby] unexpected failure:', err);
    // Never break the property page over a decorative section.
    res.set('Cache-Control', 'no-store');
    return res.json({ places: [], cached: false, stale: false, pending: true, radiusM: 3000 });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/geo/overpass  (deprecated)
//
// Retained so browsers running a previously cached bundle keep working. It now
// races the mirrors in parallel like the service does, rather than walking them
// sequentially — the old version could take ~45 s before giving up.
// ─────────────────────────────────────────────────────────────────────────────
const LEGACY_ENDPOINTS = [
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

router.post('/overpass', async (req, res) => {
  const query =
    (req.body && (req.body.query || req.body.data)) ||
    (typeof req.body === 'string' ? req.body : '');

  if (!query || typeof query !== 'string' || query.length > 8000) {
    return res
      .status(400)
      .json({ message: 'Invalid or missing Overpass query.', code: 'bad_query' });
  }

  const controllers = [];
  const attempt = (endpoint) => {
    const controller = new AbortController();
    controllers.push(controller);
    const timer = setTimeout(() => controller.abort(), 12000);
    return fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent': 'TO-LET-PRO/1.0 (+https://tolet-pro.vercel.app; rentals app)',
      },
      body: 'data=' + encodeURIComponent(query),
      signal: controller.signal,
    })
      .then(async (upstream) => {
        if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);
        const text = await upstream.text();
        const json = JSON.parse(text); // throws on Overpass's HTML error pages
        if (!json || !Array.isArray(json.elements)) throw new Error('no elements');
        return json;
      })
      .finally(() => clearTimeout(timer));
  };

  try {
    const data = await Promise.any(LEGACY_ENDPOINTS.map(attempt));
    res.set('Cache-Control', 'public, max-age=86400');
    return res.json(data);
  } catch {
    // Overpass-shaped empty result so the old frontend's `data.elements || []`
    // fallback shows "no nearby places" instead of throwing.
    return res.status(200).json({ elements: [] });
  } finally {
    for (const c of controllers) {
      try { c.abort(); } catch { /* already settled */ }
    }
  }
});

module.exports = router;
