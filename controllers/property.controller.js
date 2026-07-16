'use strict';

const propertyService = require('../services/property.service');
const propertyValidators = require('../validators/property.validators');
const ApiError = require('../utils/ApiError');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ── Listing-card payload trimming ───────────────────────────────────────────
// The public listing/search response must stay light on mobile. Per property
// we ship ONLY: coverPhoto + a few room-category photos — ONE per unique
// category, ANY property kind (residential OR commercial). The card renders the
// cover + its best 3 thumbnails from these. The heavy walkthrough video
// (`videoUrl`, up to ~25 MB base64) is dropped entirely; it loads on the detail
// page instead, along with the full room gallery.
//
// We ship a few EXTRA distinct categories (limit 6) so the card can prefer
// photos that differ from the cover when choosing its 3 thumbnails.
const LIST_ROOM_PHOTO_LIMIT = 6;

function toCloudinaryCardImage(url) {
  const s = String(url || '').trim();
  if (!/^https?:\/\/res\.cloudinary\.com\//i.test(s)) return s;
  const marker = '/image/upload/';
  const markerIndex = s.indexOf(marker);
  if (markerIndex === -1) return s;
  const after = s.slice(markerIndex + marker.length);
  const firstSegment = after.split('/')[0] || '';
  if (/^(?:a_|ar_|b_|c_|co_|dpr_|e_|f_|fl_|g_|h_|l_|o_|q_|r_|t_|w_|x_|y_|z_)/.test(firstSegment)) {
    return s;
  }
  return `${s.slice(0, markerIndex + marker.length)}f_auto,q_auto:eco,w_640,c_fill/${after}`;
}

function trimForListCard(p) {
  delete p.videoUrl;
  const coverThumb = p.coverPhotoThumb || '';
  p.coverPhoto = toCloudinaryCardImage(coverThumb || p.coverPhoto);
  delete p.coverPhotoThumb;
  // Keep ONE photo per unique room category, in upload order, CATEGORY-AGNOSTIC
  // (residential AND commercial). We preserve the REAL room id so the card
  // labels it correctly (Front / Inside Floor / Workspace / Reception / Washroom
  // …) and can order/choose. The old version bucketed by residential room names
  // (bed/bath/living/kitchen), which dropped every commercial photo except a
  // washroom (it matched 'wash') and even re-tagged it "bathroom".
  const photos = Array.isArray(p.roomPhotos) ? p.roomPhotos : [];
  const picked = [];
  const seenRooms = new Set();
  for (const ph of photos) {
    if (picked.length >= LIST_ROOM_PHOTO_LIMIT) break;
    const room = String((ph && ph.room) || 'other').toLowerCase();
    if (seenRooms.has(room)) continue;
    const url = toCloudinaryCardImage((ph && (ph.thumbUrl || ph.thumbnailUrl || ph.url || ph.preview)) || '');
    if (!url) continue;
    seenRooms.add(room);
    picked.push({ room, url });
  }
  p.roomPhotos = picked; // ≤ LIST_ROOM_PHOTO_LIMIT distinct-category photos; cover stays in coverPhoto
  return p;
}

function formatLeanProperty(p) {
  if (typeof p.toJSON === 'function') return p.toJSON();
  const ret = { ...p };
  ret.id              = String(ret._id);
  ret.landlordId      = ret.ownerUserId ? String(ret.ownerUserId) : null;
  ret.landlordName    = ret.ownerName  || '';
  ret.gpsLat          = ret.gps && ret.gps.lat ? ret.gps.lat : null;
  ret.gpsLng          = ret.gps && ret.gps.lng ? ret.gps.lng : null;
  ret.gpsAddress      = ret.gps && ret.gps.address ? ret.gps.address : '';
  ret.rentalCategory  = ret.category;
  delete ret.searchHaystack;
  delete ret.ownerPhone;
  delete ret._id;
  return ret;
}

exports.createProperty = asyncH(async (req, res) => {
  const doc = await propertyService.createProperty({ body: req.body, user: req.user });
  res.status(201).json({ property: doc.toJSON() });
});

exports.getSuggestions = asyncH(async (req, res) => {
  const q = req.query.q || '';
  if (!q || q.length < 2) {
    return res.json({ suggestions: [] });
  }
  const suggestions = await propertyService.getSuggestions(q);
  res.json({ suggestions });
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
    properties: out.items.map((d) => trimForListCard(formatLeanProperty(d))),
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
  res.json({ properties: items.map((d) => trimForListCard(formatLeanProperty(d))) });
});
