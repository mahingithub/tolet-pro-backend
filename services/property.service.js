'use strict';

const mongoose = require('mongoose');

const Property = require('../models/Property');
const ApiError = require('../utils/ApiError');
const searchService = require('./searchService');

// ─── Helpers ───────────────────────────────────────────────────────────────
function normaliseRoomPhotos(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((p) => ({
      room: (p && p.room) ? String(p.room).trim().slice(0, 40) : 'other',
      url:  (p && (p.url || p.preview)) ? String(p.url || p.preview) : '',
    }))
    .filter((p) => p.url);
}

function gpsFromBody(body) {
  const lat = body.gpsLat === '' || body.gpsLat == null ? null : Number(body.gpsLat);
  const lng = body.gpsLng === '' || body.gpsLng == null ? null : Number(body.gpsLng);
  return {
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    address: body.gpsAddress || '',
  };
}

function findIdOrSlug(idOrSlug) {
  if (mongoose.Types.ObjectId.isValid(idOrSlug)) {
    return { $or: [{ _id: idOrSlug }, { slug: idOrSlug }] };
  }
  return { slug: idOrSlug };
}

// ─── Service ───────────────────────────────────────────────────────────────
async function createProperty({ body, user }) {
  // Wizard now collects both `floor` (legacy) and `floorNumber` (the new
  // "On which floor is this property located?" input). Either side wins,
  // and the model's pre('validate') hook keeps them in lockstep.
  const wizardFloor =
    Number.isFinite(Number(body.floorNumber)) && Number(body.floorNumber) !== 0
      ? Number(body.floorNumber)
      : Number(body.floor) || 0;

  const doc = new Property({
    title:       body.title,
    description: body.description || '',
    intent:      body.intent      || 'rent',
    // 'flat' is the new default — if a legacy caller still sends
    // 'apartment' the model's pre('validate') hook normalises it.
    type:        body.type        || 'flat',
    category:    body.category    || 'family',
    division:    body.division,
    district:    body.district    || '',
    area:        body.area        || '',
    location:    body.location    || '',
    gps:         gpsFromBody(body),
    beds:        body.beds        || 1,
    baths:       body.baths       || 1,
    sqft:        body.sqft        || 0,
    floor:       wizardFloor,
    floorNumber: wizardFloor,
    furnishing:  body.furnishing  || 'Unfurnished',
    amenities:   Array.isArray(body.amenities) ? body.amenities : [],
    coverPhoto:  body.coverPhoto  || '',
    roomPhotos:  normaliseRoomPhotos(body.roomPhotos),
    videoId:     body.videoId     || '',
    videoUrl:    body.videoUrl    || '',
    price:       body.price,
    originalPrice: body.price,
    status:      body.status      || 'active',
    ownerUserId: user._id,
    ownerName:   user.name  || '',
    ownerPhone:  user.phone || '',
  });
  await doc.save();
  return doc;
}

async function getPropertyById(idOrSlug) {
  const doc = await Property.findOne(findIdOrSlug(idOrSlug));
  if (!doc) throw ApiError.notFound('প্রপার্টি পাওয়া যায়নি।', { code: 'property_not_found' });
  return doc;
}

async function listProperties(query) {
  const filter = searchService.buildSearchFilter(query);

  // Public listing endpoint: only surface listings that are actively
  // available to rent. A landlord pausing or renting a listing should
  // remove it from search immediately. (Internal endpoints like
  // /api/host/properties continue to bypass this filter — they call
  // listMyProperties below.) If the caller explicitly passed a status
  // we respect it (used by the admin moderation queue).
  if (!filter.status) {
    filter.status = 'active';
  }

  const sort   = searchService.buildSortOptions(query.sort);
  const page   = query.page  || 1;
  const limit  = query.limit || 50;
  const skip   = (page - 1) * limit;

  const [items, total] = await Promise.all([
    // Never load the walkthrough video for a LIST. `videoUrl` can be a ~25MB
    // base64 data: URL. We also exclude description and searchHaystack.
    // We use .lean() to skip Mongoose hydration overhead which prevents OOM
    // on Render's 512MB RAM limit when loading many properties with base64 images.
    Property.find(filter)
      .select('-videoUrl -description -searchHaystack')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Property.countDocuments(filter),
  ]);

  return { items, total, page, limit };
}

async function listMyProperties(user) {
  return Property.find({ ownerUserId: user._id }).sort({ createdAt: -1, _id: -1 });
}

async function updateProperty({ idOrSlug, body, user }) {
  const doc = await Property.findOne(findIdOrSlug(idOrSlug));
  if (!doc) throw ApiError.notFound('প্রপার্টি পাওয়া যায়নি।', { code: 'property_not_found' });
  if (String(doc.ownerUserId) !== String(user._id)) {
    throw ApiError.forbidden('শুধুমাত্র মালিকই এই প্রপার্টি পরিবর্তন করতে পারবেন।', {
      code: 'not_owner',
    });
  }

  // Apply only the fields the caller actually sent. Re-running the model's
  // pre('validate') hook on .save() rebuilds the slug-and-haystack pair.
  const scalarFields = [
    'title', 'description', 'intent', 'type', 'category',
    'division', 'district', 'area', 'location',
    'beds', 'baths', 'sqft', 'floor', 'floorNumber', 'furnishing',
    'amenities', 'price', 'status', 'coverPhoto', 'videoId', 'videoUrl',
  ];
  for (const f of scalarFields) {
    if (Object.prototype.hasOwnProperty.call(body, f)) {
      doc[f] = body[f];
    }
  }
  // Keep `floor` and `floorNumber` in lockstep on partial updates: if the
  // caller patched only one side, mirror it to the other so older
  // readers don't go stale.
  if (Object.prototype.hasOwnProperty.call(body, 'floorNumber') &&
      !Object.prototype.hasOwnProperty.call(body, 'floor')) {
    doc.floor = body.floorNumber;
  } else if (Object.prototype.hasOwnProperty.call(body, 'floor') &&
             !Object.prototype.hasOwnProperty.call(body, 'floorNumber')) {
    doc.floorNumber = body.floor;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'roomPhotos')) {
    doc.roomPhotos = normaliseRoomPhotos(body.roomPhotos);
  }
  if (body.gpsLat !== undefined || body.gpsLng !== undefined || body.gpsAddress !== undefined) {
    doc.gps = {
      lat: body.gpsLat !== undefined
        ? (body.gpsLat === '' || body.gpsLat == null ? null : Number(body.gpsLat))
        : doc.gps?.lat ?? null,
      lng: body.gpsLng !== undefined
        ? (body.gpsLng === '' || body.gpsLng == null ? null : Number(body.gpsLng))
        : doc.gps?.lng ?? null,
      address: body.gpsAddress !== undefined ? body.gpsAddress : (doc.gps?.address || ''),
    };
  }
  await doc.save();
  return doc;
}

async function deleteProperty({ idOrSlug, user }) {
  const doc = await Property.findOne(findIdOrSlug(idOrSlug));
  if (!doc) throw ApiError.notFound('প্রপার্টি পাওয়া যায়নি।', { code: 'property_not_found' });
  if (String(doc.ownerUserId) !== String(user._id)) {
    throw ApiError.forbidden('শুধুমাত্র মালিকই এই প্রপার্টি মুছতে পারবেন।', {
      code: 'not_owner',
    });
  }
  await doc.deleteOne();
  return { id: String(doc._id) };
}

module.exports = {
  createProperty,
  getPropertyById,
  listProperties,
  listMyProperties,
  updateProperty,
  deleteProperty,
  // Exported for tests / future controllers.
  _internal: { normaliseRoomPhotos, gpsFromBody, findIdOrSlug },
};
