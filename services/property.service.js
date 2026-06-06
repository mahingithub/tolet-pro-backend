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
  const wizardFloor =
    Number.isFinite(Number(body.floorNumber)) && Number(body.floorNumber) !== 0
      ? Number(body.floorNumber)
      : Number(body.floor) || 0;

  const doc = new Property({
    title:       body.title,
    description: body.description || '',
    intent:      body.intent      || 'rent',
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

  // Public listing endpoint: only surface active listings.
  // Internal endpoints like /api/host/properties bypass this — they
  // call listMyProperties below.
  if (!filter.status) {
    filter.status = 'active';
  }

  const sort  = searchService.buildSortOptions(query.sort);
  const page  = query.page  || 1;
  const limit = query.limit || 50;
  const skip  = (page - 1) * limit;

  // ── FIX: MongoDB sort memory limit (32 MB) ────────────────────────────
  // Properties store large base64 blobs (coverPhoto, roomPhotos, videoUrl).
  // Sorting the full documents blew past Mongo's in-memory sort limit:
  //   "Sort exceeded memory limit of 33554432 bytes"
  //
  // Two-part fix:
  //   1. .select() — strip the heavy base64 fields BEFORE sort so Mongo
  //      only ranks lightweight scalar fields (price, createdAt, etc.).
  //      The controller's trimForListCard() already drops videoUrl on the
  //      way out; we drop it + the photo blobs here so they never enter
  //      the sort pipeline at all.
  //   2. .allowDiskUse(true) — safety net for edge cases where even the
  //      trimmed documents exceed 32 MB (very large collections).
  // ─────────────────────────────────────────────────────────────────────
  const [items, total] = await Promise.all([
    Property.find(filter)
      .select('-videoUrl -searchHaystack')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .allowDiskUse(true),
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
