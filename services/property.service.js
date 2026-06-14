'use strict';

const mongoose = require('mongoose');

const Property = require('../models/Property');
const ApiError = require('../utils/ApiError');
const Booking = require('../models/Booking');
const Inquiry = require('../models/Inquiry');
const Receipt  = require('../models/Receipt');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const searchService = require('./searchService');

// ─── Helpers ───────────────────────────────────────────────────────────────
const MAX_THUMBNAIL_CHARS = 1_000_000;

function normaliseThumbnail(value) {
  const s = value ? String(value) : '';
  return s.length <= MAX_THUMBNAIL_CHARS ? s : '';
}

function normaliseRoomPhotos(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((p) => ({
      room: (p && p.room) ? String(p.room).trim().slice(0, 40) : 'other',
      url:  (p && (p.url || p.preview)) ? String(p.url || p.preview) : '',
      thumbUrl: normaliseThumbnail(p && p.thumbUrl),
    }))
    .filter((p) => p.url);
}

// Intent-specific details are an open-shaped bag (Mixed in the model). The v1
// guard is deliberately loose (Option B): accept a plain object as-is, and
// collapse anything that isn't one (array / string / number / null / undefined)
// to {}. The SHAPE of the fields inside — tenantPreference, landMeasurement,
// gasLine, etc. — is owned by the wizard per intent+type and is NOT validated
// here. This keeps a malformed bag from ever blocking a submission.
function normaliseSpecificDetails(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

// ─── LIST-RESPONSE BASE64 GUARD ──────────────────────────────────────────────
// Older listings (created before the Cloudinary migration) stored cover/room
// images as base64 `data:` URLs — `coverPhotoThumb` alone could be ~1MB. When a
// LIST endpoint projected those fields back for 100 docs, the Node process on
// Render's 512MB instance spiked into OOM and the request died mid-response
// ("Fetch failed loading" on the client, empty feed). `httpOnly` returns a
// field ONLY when it is an http(s) URL; any base64 value collapses to '' so the
// list payload stays small no matter how much legacy base64 sits in MongoDB.
// Legacy cards just show a placeholder image until those docs are migrated —
// the page LOADS instead of crashing.
const httpOnly = (field) => ({
  $cond: [
    { $regexMatch: { input: { $ifNull: [field, ''] }, regex: /^https?:\/\//i } },
    field,
    '',
  ],
});

// Keep only the room photos we actually render on a card, by room category.
const LIST_ROOM_PHOTO_FILTER = {
  $filter: {
    input: { $ifNull: ['$roomPhotos', []] },
    as: 'photo',
    cond: {
      $regexMatch: {
        input: { $toLower: { $ifNull: ['$$photo.room', ''] } },
        regex: /bed|bath|toilet|wash|living|drawing|hall|kitchen|cook|other/,
      },
    },
  },
};

const LIST_CARD_PROJECT = {
  title: 1,
  intent: 1,
  type: 1,
  category: 1,
  division: 1,
  district: 1,
  area: 1,
  location: 1,
  gps: 1,
  beds: 1,
  baths: 1,
  sqft: 1,
  floor: 1,
  floorNumber: 1,
  furnishing: 1,
  amenities: 1,
  // base64 cover → '' so a single legacy doc can't bloat the list payload.
  coverPhoto: httpOnly('$coverPhoto'),
  // coverPhotoThumb is intentionally dropped from LIST responses: the frontend
  // derives a card-size thumbnail from the Cloudinary URL on the fly
  // (toCloudinaryListingImage), so shipping a separate (often base64) thumb is
  // pure dead weight and a former OOM source.
  roomPhotos: {
    $map: {
      input: LIST_ROOM_PHOTO_FILTER,
      as: 'photo',
      in: {
        room: '$$photo.room',
        url:  httpOnly('$$photo.url'),  // base64 url → ''; thumbUrl never sent
      },
    },
  },
  videoId: 1,
  price: 1,
  originalPrice: 1,
  status: 1,
  ownerUserId: 1,
  ownerName: 1,
  ownerPhone: 1,
  rating: 1,
  reviews: 1,
  popularity: 1,
  inquiries: 1,
  verified: 1,
  slug: 1,
  createdAt: 1,
  updatedAt: 1,
  // NOTE: specificDetails is intentionally NOT projected onto list cards — it
  // keeps the feed payload lean. The detail endpoint (getPropertyById → toJSON)
  // returns the full bag. `intent` IS on the card so the tab UI can render
  // intent-aware card layouts without an extra fetch. If a particular card ever
  // needs one specific field (e.g. land size), add just that path here.
};

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
    coverPhotoThumb: normaliseThumbnail(body.coverPhotoThumb),
    videoId:     body.videoId     || '',
    videoUrl:    body.videoUrl    || '',
    // Intent-specific details bag (rent/sale/commercial fields). Sanitised to a
    // plain object; the model stores it as Mixed. undefined/garbage → {}.
    specificDetails: normaliseSpecificDetails(body.specificDetails),
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

async function getSuggestions(q) {
  const filter = searchService.buildSearchFilter({ q });
  // We only want a few fields to build the autocomplete suggestions
  const properties = await Property.find(filter)
    .select('title location area district division')
    .limit(20)
    .lean();
    
  return properties.map(p => ({
    id: String(p._id),
    title: p.title || '',
    location: p.location || '',
    area: p.area || '',
    district: p.district || '',
    division: p.division || ''
  }));
}

async function listProperties(query) {
  const filter = searchService.buildSearchFilter(query);

  // Detect a by-id lookup (saved-list sync): the client asked for specific
  // property ids via ?ids=. In that mode we must NOT apply the default
  // status='active' filter and we must NOT paginate — a saved listing that
  // has since been rented or paused still EXISTS and has to come back, else
  // the client wrongly treats it as deleted and drops it from favourites.
  const isIdLookup = Boolean(filter._id && filter._id.$in);

  // Public listing endpoint: only surface listings that are actively
  // available to rent. A landlord pausing or renting a listing should
  // remove it from search immediately. (Internal endpoints like
  // /api/host/properties continue to bypass this filter — they call
  // listMyProperties below.) If the caller explicitly passed a status
  // we respect it (used by the admin moderation queue). A by-id lookup is
  // exempt for the reason explained above.
  if (!isIdLookup && !filter.status) {
    filter.status = 'active';
  }
  
  if (!isIdLookup && !filter.availabilityStatus) {
    // Legacy properties might not have this field set. By using $nin,
    // we match 'available' as well as documents where the field is missing.
    filter.availabilityStatus = { $nin: ['rented', 'booked'] };
  }

  const sort   = searchService.buildSortOptions(query.sort);
  const page   = isIdLookup ? 1 : (query.page  || 1);
  // For an id lookup, return every requested doc in one page (no cutoff when a
  // user has more saved than the default 50). Otherwise keep normal paging.
  const limit  = isIdLookup
    ? Math.max(filter._id.$in.length, 1)
    : (query.limit || 50);
  const skip   = (page - 1) * limit;

  const [items, total] = await Promise.all([
    // Never load the walkthrough video for a LIST. `videoUrl` can be a ~25MB
    // base64 data: URL. We also exclude description and searchHaystack.
    // We use .lean() to skip Mongoose hydration overhead which prevents OOM
    // on Render's 512MB RAM limit when loading many properties with base64 images.
    Property.aggregate([
      { $match: filter },
      // Project out the massive base64 strings BEFORE sorting. This prevents the
      // 32MB in-memory sort limit (OOM) on MongoDB Free Tier (M0) which doesn't
      // support allowDiskUse: true.
      { $project: { coverPhoto: 0, coverPhotoThumb: 0, roomPhotos: 0, videoUrl: 0, description: 0, searchHaystack: 0 } },
      { $sort: sort },
      { $skip: skip },
      { $limit: limit }
    ])
    .then(async (idDocs) => {
      const ids = idDocs.map(d => d._id);
      if (ids.length === 0) return [];
      // Re-fetch the page WITH card fields — but LIST_CARD_PROJECT now strips
      // any base64 cover/room image (httpOnly) and never returns coverPhotoThumb
      // or roomPhotos[].thumbUrl, so the response payload stays small even when
      // legacy base64 docs are in the result set. This is the fix for the
      // GET /api/properties OOM ("Fetch failed loading" / empty feed).
      const unsortedItems = await Property.aggregate([
        { $match: { _id: { $in: ids } } },
        { $project: LIST_CARD_PROJECT },
      ]);
      const map = {};
      unsortedItems.forEach(item => map[item._id.toString()] = item);
      return ids.map(id => map[id.toString()]).filter(Boolean);
    }),
    Property.countDocuments(filter),
  ]);

  return { items, total, page, limit };
}

async function listMyProperties(user) {
  return Property.find({ ownerUserId: user._id })
    // Host dashboard cards need editable metadata and photos, but not the
    // giant video blob or search text. Excluding them keeps /api/host/properties
    // responsive even when a host uploaded walkthrough videos.
    .select('-videoUrl -searchHaystack')
    .sort({ createdAt: -1, _id: -1 })
    .lean();
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
    'amenities', 'price', 'status', 'coverPhoto', 'coverPhotoThumb', 'videoId', 'videoUrl',
  ];
  for (const f of scalarFields) {
    if (Object.prototype.hasOwnProperty.call(body, f)) {
      doc[f] = f === 'coverPhotoThumb' ? normaliseThumbnail(body[f]) : body[f];
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
  // specificDetails is a Mixed bag — REPLACE it wholesale when (and only when)
  // the caller sends it. The wizard re-bundles the complete object on every
  // edit, so a merge would strand stale keys when a host switches intent/type
  // (e.g. rent→sale should drop the rent-only fields, not keep them). Guarding
  // on hasOwnProperty means a partial update (e.g. just `price`) never wipes it.
  // Mongoose cannot auto-detect in-place Mixed changes, so markModified is
  // MANDATORY here — without it, save() is a silent no-op for this field.
  if (Object.prototype.hasOwnProperty.call(body, 'specificDetails')) {
    doc.specificDetails = normaliseSpecificDetails(body.specificDetails);
    doc.markModified('specificDetails');
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


  const propertyId = doc._id;

  // ── Collect every related id BEFORE deleting anything ──────────────────
  // We gather inquiry / booking / conversation (and then receipt) ids up front
  // so we can delete their child docs (messages, receipts) AND sweep every
  // notification that deep-links to any of them. Ordering is deliberate:
  // gather → delete children & parents → delete the Property LAST (below). If
  // anything throws midway, the Property still exists, so the whole delete can
  // simply be retried rather than leaving a half-deleted listing with no anchor.
  const [relatedInquiries, relatedBookings, relatedConversations] = await Promise.all([
    Inquiry.find({ propertyId }).select('_id'),
    Booking.find({ propertyId }).select('_id'),
    Conversation.find({ propertyId }).select('_id'),
  ]);

  const inquiryIds      = relatedInquiries.map((d) => d._id);
  const bookingIds      = relatedBookings.map((d) => d._id);
  const conversationIds = relatedConversations.map((d) => d._id);

  // Receipts hang off bookings.
  const relatedReceipts = bookingIds.length
    ? await Receipt.find({ bookingId: { $in: bookingIds } }).select('_id')
    : [];
  const receiptIds = relatedReceipts.map((d) => d._id);

  // ── Build the notification sweep ───────────────────────────────────────
  // Notification.data is a free-form Mixed bag; depending on the event it
  // carries one of propertyId / inquiryId / bookingId / conversationId /
  // receiptId. We OR across every key + id-set we just gathered so NO orphaned
  // bell item survives, regardless of which deep-link key a given notification
  // used. Clauses for empty id-sets are skipped so we never build a `$in: []`
  // that matches nothing-but-costs-a-scan.
  const notifClauses = [{ 'data.propertyId': propertyId }];
  if (inquiryIds.length)      notifClauses.push({ 'data.inquiryId':      { $in: inquiryIds } });
  if (bookingIds.length)      notifClauses.push({ 'data.bookingId':      { $in: bookingIds } });
  if (conversationIds.length) notifClauses.push({ 'data.conversationId': { $in: conversationIds } });
  if (receiptIds.length)      notifClauses.push({ 'data.receiptId':      { $in: receiptIds } });

  // ── Delete children + parents (Property removed last, below) ───────────
  const [
    delMessages,
    delReceipts,
    delInquiries,
    delBookings,
    delConversations,
    delNotifications,
  ] = await Promise.all([
    conversationIds.length
      ? Message.deleteMany({ conversationId: { $in: conversationIds } })
      : Promise.resolve({ deletedCount: 0 }),
    receiptIds.length
      ? Receipt.deleteMany({ _id: { $in: receiptIds } })
      : Promise.resolve({ deletedCount: 0 }),
    Inquiry.deleteMany({ propertyId }),
    Booking.deleteMany({ propertyId }),
    conversationIds.length
      ? Conversation.deleteMany({ _id: { $in: conversationIds } })
      : Promise.resolve({ deletedCount: 0 }),
    Notification.deleteMany({ $or: notifClauses }),
  ]);

  await doc.deleteOne();
  return {
    id: String(propertyId),
    deletedInquiries:     delInquiries.deletedCount,
    deletedBookings:      delBookings.deletedCount,
    deletedReceipts:      delReceipts.deletedCount,
    deletedConversations: delConversations.deletedCount,
    deletedMessages:      delMessages.deletedCount,
    deletedNotifications: delNotifications.deletedCount,
  };
}

module.exports = {
  createProperty,
  getPropertyById,
  getSuggestions,
  listProperties,
  listMyProperties,
  updateProperty,
  deleteProperty,
  // Exported for tests / future controllers.
  _internal: { normaliseRoomPhotos, normaliseSpecificDetails, gpsFromBody, findIdOrSlug },
};