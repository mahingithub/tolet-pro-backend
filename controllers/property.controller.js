'use strict';

const propertyService = require('../services/property.service');
const propertyValidators = require('../validators/property.validators');
const ApiError = require('../utils/ApiError');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ── Listing-card payload trimming ───────────────────────────────────────────
// The public listing/search response must stay light on mobile. Per property
// we ship ONLY: coverPhoto + the best three room-category photos in priority
// order (bedroom / bathroom / living room / kitchen / other). The heavy
// walkthrough video (`videoUrl`, up to ~25 MB base64) is dropped entirely; it
// loads on the detail page instead, along with the full room gallery.
const LIST_ROOM_BUCKETS = [
  { room: 'bedroom', matches: (r) => r.includes('bed') },
  { room: 'bathroom', matches: (r) => r.includes('bath') || r.includes('toilet') || r.includes('wash') },
  { room: 'living', matches: (r) => r.includes('living') || r.includes('drawing') || r.includes('hall') },
  { room: 'kitchen', matches: (r) => r.includes('kitchen') || r.includes('cook') },
  { room: 'other', matches: (r) => r.includes('other') },
];
const LIST_ROOM_PHOTO_LIMIT = 3;

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
  const photos = Array.isArray(p.roomPhotos) ? p.roomPhotos : [];
  const picked = [];
  for (const bucket of LIST_ROOM_BUCKETS) {
    if (picked.length >= LIST_ROOM_PHOTO_LIMIT) break;
    const hit = photos.find(
      (ph) => !picked.some((pickedPhoto) => pickedPhoto.source === ph) &&
        bucket.matches(String((ph && ph.room) || '').toLowerCase()),
    );
    if (hit) {
      picked.push({
        source: hit,
        room: bucket.room,
        url: toCloudinaryCardImage(hit.thumbUrl || hit.thumbnailUrl || hit.url || hit.preview || ''),
      });
    }
  }
  p.roomPhotos = picked
    .filter((ph) => ph.url)
    .map(({ room, url }) => ({ room, url })); // ≤ 3 room photos; cover stays in coverPhoto
  return p;
}

function formatLeanProperty(p) {
  if (typeof p.toJSON === 'function') return p.toJSON();
  const ret = { ...p };
  ret.id              = String(ret._id);
  ret.landlordId      = ret.ownerUserId ? String(ret.ownerUserId) : null;
  ret.landlordName    = ret.ownerName  || '';
  ret.landlordPhone   = ret.ownerPhone || '';
  ret.gpsLat          = ret.gps && ret.gps.lat ? ret.gps.lat : null;
  ret.gpsLng          = ret.gps && ret.gps.lng ? ret.gps.lng : null;
  ret.gpsAddress      = ret.gps && ret.gps.address ? ret.gps.address : '';
  ret.rentalCategory  = ret.category;
  delete ret.searchHaystack;
  delete ret._id;
  return ret;
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
