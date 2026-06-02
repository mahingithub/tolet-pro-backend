'use strict';

const propertyService = require('../services/property.service');
const propertyValidators = require('../validators/property.validators');
const ApiError = require('../utils/ApiError');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ── Listing-card payload trimming ───────────────────────────────────────────
// The public listing/search response must stay light on mobile. Per property
// we ship ONLY: coverPhoto + at most one photo each for bedroom / bathroom /
// living (or kitchen) — i.e. max 4 images for the card. The heavy walkthrough
// video (`videoUrl`, up to ~25 MB base64) is dropped entirely; it loads on the
// detail page instead, along with the full room gallery.
const LIST_ROOM_BUCKETS = [
  (r) => r.includes('bed'),
  (r) => r.includes('bath'),
  (r) => r.includes('living') || r.includes('kitchen') || r.includes('drawing'),
];

function trimForListCard(p) {
  delete p.videoUrl;
  const photos = Array.isArray(p.roomPhotos) ? p.roomPhotos : [];
  const picked = [];
  for (const matches of LIST_ROOM_BUCKETS) {
    const hit = photos.find(
      (ph) => !picked.includes(ph) && matches(String((ph && ph.room) || '').toLowerCase()),
    );
    if (hit) picked.push(hit);
  }
  p.roomPhotos = picked; // ≤ 3 room photos; the cover stays in coverPhoto
  return p;
}

exports.createProperty = asyncH(async (req, res) => {
  const doc = await propertyService.createProperty({ body: req.body, user: req.user });
  res.status(201).json({ property: doc.toJSON() });
});

exports.getProperties = asyncH(async (req, res) => {
  const parsed = propertyValidators.listQuery.safeParse(req.query);
  if (!parsed.success) {
    throw ApiError.badRequest('Query params সঠিক নয়।', {
      code: 'validation_error',
      details: parsed.error.issues.map((i) => ({
        path: i.path.join('.'), message: i.message,
      })),
    });
  }
  const out = await propertyService.listProperties(parsed.data);
  res.json({
    properties: out.items.map((d) => trimForListCard(d.toJSON())),
    total: out.total,
    page:  out.page,
    limit: out.limit,
  });
});

exports.getPropertyById = asyncH(async (req, res) => {
  const doc = await propertyService.getPropertyById(req.params.id);
  res.json({ property: doc.toJSON() });
});

exports.updateProperty = asyncH(async (req, res) => {
  const doc = await propertyService.updateProperty({
    idOrSlug: req.params.id,
    body: req.body,
    user: req.user,
  });
  res.json({ property: doc.toJSON() });
});

exports.deleteProperty = asyncH(async (req, res) => {
  const out = await propertyService.deleteProperty({
    idOrSlug: req.params.id,
    user: req.user,
  });
  res.json({ ok: true, ...out });
});

exports.getHostProperties = asyncH(async (req, res) => {
  const items = await propertyService.listMyProperties(req.user);
  res.json({ properties: items.map((d) => d.toJSON()) });
});