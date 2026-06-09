'use strict';

/**
 * Server-side proxy for the Overpass (OpenStreetMap) API used by the property
 * "Nearby places" feature.
 *
 * Why this exists: the browser cannot call https://overpass-api.de directly —
 * it gets (a) CORS-blocked (Overpass omits Access-Control-Allow-Origin when
 * overloaded) and (b) a 406 because Overpass rejects browser User-Agents, which
 * fetch() won't let us override. Calling Overpass from the server fixes both:
 * we send a descriptive User-Agent, and the response is same-origin to our API.
 *
 * Endpoint:  POST /api/geo/overpass
 *   Body (JSON):  { "query": "<overpass QL>" }
 * Returns Overpass JSON untouched, so the frontend mapping stays the same.
 *
 * Note: requires Node 18+ (global fetch). On Render this is the default.
 */

const express = require('express');
const router = express.Router();

// Tried in order; we fall through to the next on any failure (429 / 504 / 406 /
// network error / timeout).
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
];

router.post('/overpass', async (req, res) => {
  // Accept { query } (preferred) or a raw form body data=<query>.
  const query =
    (req.body && (req.body.query || req.body.data)) ||
    (typeof req.body === 'string' ? req.body : '');

  if (!query || typeof query !== 'string' || query.length > 8000) {
    return res
      .status(400)
      .json({ message: 'Invalid or missing Overpass query.', code: 'bad_query' });
  }

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const upstream = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          // Descriptive UA is what Overpass's usage policy asks for.
          'User-Agent': 'TO-LET-PRO/1.0 (+https://tolet-pro.vercel.app; rentals app)',
        },
        body: 'data=' + encodeURIComponent(query),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!upstream.ok) continue; // overloaded / throttled → try next mirror

      const data = await upstream.json();
      res.set('Cache-Control', 'public, max-age=86400'); // nearby POIs barely change
      return res.json(data);
    } catch (_err) {
      clearTimeout(timer);
      // network error / timeout / abort → try next mirror
    }
  }

  // Every mirror failed — return an empty Overpass-shaped result so the
  // frontend's existing graceful fallback (data.elements || []) just shows
  // "no nearby places" instead of throwing.
  return res.status(200).json({ elements: [] });
});

module.exports = router;