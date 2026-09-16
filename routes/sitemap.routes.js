'use strict';

/**
 * sitemap.routes.js — GET /api/sitemap/properties.xml
 * ──────────────────────────────────────────────────────────────────────────
 * The frontend's sitemap.xml is generated at build time and lists every
 * location and landing page, but no individual listing: there can be thousands,
 * they change daily, and only this server knows which are live. With no links
 * to listings anywhere in crawlable HTML either, search engines had no way to
 * discover a listing page at all.
 *
 * This streams the live ones. The frontend proxies it onto its own host as
 * /sitemap-properties.xml (vercel.json) — search engines reject sitemap
 * entries on a different host than the sitemap — and robots.txt names it.
 *
 * Only listings a renter can act on: active, and not already rented or
 * booked. Same visibility rule as the public listing search.
 */

const express = require('express');
const Property = require('../models/Property');

const router = express.Router();

// The canonical host every listing URL must be written against. Not an env
// value: it has to match the frontend's canonical tags exactly, in every
// environment, or search engines treat the entries as another site's.
const SITE_URL = 'https://www.toletpro.rent';

// The sitemap protocol's per-file limit.
const MAX_URLS = 50000;

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

async function buildPropertiesSitemap() {
  const rows = await Property.find({
    status: 'active',
    availabilityStatus: { $nin: ['rented', 'booked'] },
  })
    .select('slug updatedAt')
    .sort({ updatedAt: -1 })
    .limit(MAX_URLS)
    .lean();

  const urls = rows.map((p) => {
    // Same path the frontend's propertyPath() builds: slug first, id fallback.
    const loc = `${SITE_URL}/property/${encodeURIComponent(p.slug || String(p._id))}`;
    const lastmod = p.updatedAt ? new Date(p.updatedAt).toISOString().slice(0, 10) : '';
    return `  <url>\n    <loc>${esc(loc)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n  </url>`;
  });

  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + (urls.length ? `${urls.join('\n')}\n` : '')
    + '</urlset>\n';
}

router.get('/properties.xml', async (req, res, next) => {
  try {
    const xml = await buildPropertiesSitemap();
    res.set('Content-Type', 'application/xml; charset=utf-8');
    // An hour is fresh enough for a crawler and keeps a burst of fetches off
    // the database.
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(xml);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.buildPropertiesSitemap = buildPropertiesSitemap;
