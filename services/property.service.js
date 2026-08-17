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
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const searchService = require('./searchService');
const { postToFacebookPage } = require('./facebook.service');
const { tierOf, limitsFor } = require('../utils/subscriptionTier');
const cache = require('../config/redis');
const invalidate = require('./cacheInvalidation');

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

// Walkthrough videos. Plans allow 0 (free) / 1 (plus) / 5 (pro) per property,
// so this is an array — but the model still mirrors entry [0] onto the legacy
// `videoUrl` / `videoId` scalars, and this accepts those scalars as a
// one-element array, so pre-multi-video clients keep working unchanged.
function normaliseVideos(input, legacy = {}) {
  const list = Array.isArray(input) ? input : [];
  const out = list
    .map((v) => {
      if (typeof v === 'string') return { url: v.trim(), youtubeId: '', name: '', thumbnail: '' };
      if (!v || typeof v !== 'object') return null;
      return {
        url:       v.url ? String(v.url).trim() : '',
        youtubeId: v.youtubeId ? String(v.youtubeId).trim().slice(0, 200) : '',
        thumbnail: normaliseThumbnail(v.thumbnail),
        name:      v.name ? String(v.name).trim().slice(0, 200) : '',
      };
    })
    .filter((v) => v && (v.url || v.youtubeId));

  if (out.length) return out;

  // Legacy single-video payload → wrap it so downstream code has one shape.
  const url = legacy.videoUrl ? String(legacy.videoUrl).trim() : '';
  const youtubeId = legacy.videoId ? String(legacy.videoId).trim().slice(0, 200) : '';
  return url || youtubeId ? [{ url, youtubeId, thumbnail: '', name: '' }] : [];
}

/**
 * Reject a create/update that exceeds the host's plan limits.
 *
 * This is the ONLY real enforcement — the matching checks in the AddProperty
 * wizard are a UX courtesy that a direct API call trivially bypasses.
 * `existingCount` is omitted on update (media-only checks).
 */
function assertWithinTierLimits({ tier, roomPhotos, videos, existingCount }) {
  const limits = limitsFor(tier);

  if (existingCount != null && existingCount >= limits.maxProperties) {
    throw ApiError.forbidden(
      `আপনার প্ল্যানে সর্বোচ্চ ${limits.maxProperties}টি প্রপার্টি যোগ করা যায়। আরও যোগ করতে আপগ্রেড করুন।`,
      { code: 'tier_limit_properties', details: { tier, limit: limits.maxProperties } },
    );
  }

  if (Array.isArray(roomPhotos) && roomPhotos.length > limits.maxPhotos) {
    throw ApiError.forbidden(
      `আপনার প্ল্যানে প্রতি প্রপার্টিতে সর্বোচ্চ ${limits.maxPhotos}টি ছবি দেওয়া যায়।`,
      { code: 'tier_limit_photos', details: { tier, limit: limits.maxPhotos } },
    );
  }

  if (Array.isArray(videos) && videos.length > limits.maxVideos) {
    throw ApiError.forbidden(
      limits.maxVideos === 0
        ? 'ভিডিও আপলোড করতে প্লাস বা প্রো প্ল্যানে আপগ্রেড করুন।'
        : `আপনার প্ল্যানে প্রতি প্রপার্টিতে সর্বোচ্চ ${limits.maxVideos}টি ভিডিও দেওয়া যায়।`,
      { code: 'tier_limit_videos', details: { tier, limit: limits.maxVideos } },
    );
  }
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

// How many uploaded room photos to ship per card. Category-AGNOSTIC: the old
// filter only allowed residential room names (bed/bath/living/kitchen…), which
// silently DROPPED every commercial photo (workspace / reception / meeting /
// cabin / front / floor / panel …) — so commercial cards had no thumbnails to
// render. We now keep ALL room photos and just cap the count to keep the list
// payload lean.
const LIST_ROOM_PHOTO_CAP = 8;

const LIST_CARD_PROJECT = {
  title: 1,
  intent: 1,
  type: 1,
  category: 1,
  division: 1,
  district: 1,
  thana: 1,
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
  specificDetails: 1,
  // base64 cover → '' so a single legacy doc can't bloat the list payload.
  coverPhoto: httpOnly('$coverPhoto'),
  // coverPhotoThumb is intentionally dropped from LIST responses: the frontend
  // derives a card-size thumbnail from the Cloudinary URL on the fly
  // (toCloudinaryListingImage), so shipping a separate (often base64) thumb is
  // pure dead weight and a former OOM source.
  roomPhotos: {
    $slice: [
      {
        $map: {
          input: { $ifNull: ['$roomPhotos', []] },
          as: 'photo',
          in: {
            room: '$$photo.room',
            url:  httpOnly('$$photo.url'),  // base64 url → ''; thumbUrl never sent
          },
        },
      },
      LIST_ROOM_PHOTO_CAP,
    ],
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
  // Plan signals the card renders: hostTier drives the Plus/Pro badge and the
  // Gold Card border; boosted/boostedUntil drive the host dashboard's Boost
  // button state ("Boosted" vs spendable). Without these projected the client
  // received undefined and every listing looked free / un-boosted.
  hostTier: 1,
  boosted: 1,
  boostedUntil: 1,
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

  // Plan entitlement drives BOTH the badge stamped on the listing and the
  // limits enforced below. tierOf() expiry-checks the paid period and the
  // 2-month launch trial, so a lapsed host is back on free limits immediately.
  const sub = await Subscription.findOne({ userId: user._id });
  const hostTier = tierOf(sub);

  const roomPhotos = normaliseRoomPhotos(body.roomPhotos);
  const videos = normaliseVideos(body.videos, body);

  assertWithinTierLimits({
    tier: hostTier,
    roomPhotos,
    videos,
    existingCount: await Property.countDocuments({ ownerUserId: user._id }),
  });

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
    thana:       body.thana       || '',
    area:        body.area        || '',
    location:    body.location    || '',
    gps:         gpsFromBody(body),
    // Preserve an explicit 0: commercial units & land send beds/baths: 0
    // because they have none. The old `|| 1` coerced that 0 into a phantom
    // "1 Bed / 1 Bath" that then surfaced on listing cards and the detail page.
    beds:        body.beds  == null || body.beds  === '' ? 1 : Number(body.beds),
    baths:       body.baths == null || body.baths === '' ? 1 : Number(body.baths),
    sqft:        body.sqft        || 0,
    floor:       wizardFloor,
    floorNumber: wizardFloor,
    furnishing:  body.furnishing  || 'Unfurnished',
    amenities:   Array.isArray(body.amenities) ? body.amenities : [],
    coverPhoto:  body.coverPhoto  || '',
    roomPhotos,
    coverPhotoThumb: normaliseThumbnail(body.coverPhotoThumb),
    // videos[] is canonical; the model's pre('validate') hook mirrors entry [0]
    // onto videoId/videoUrl so legacy readers keep working.
    videos,
    // Intent-specific details bag (rent/sale/commercial fields). Sanitised to a
    // plain object; the model stores it as Mixed. undefined/garbage → {}.
    specificDetails: normaliseSpecificDetails(body.specificDetails),
    price:       body.price,
    originalPrice: body.price,
    status:      body.status      || 'active',
    ownerUserId: user._id,
    ownerName:   user.name  || '',
    ownerPhone:  user.phone || '',
    hostTier:    hostTier,
  });
  await doc.save();

  // Facebook auto-post is a PAID perk: "Facebook Boost Post" on Plus and
  // "Facebook Super Boost Post" on Pro. Free listings are not posted.
  // `hostTier` was already resolved above, so this costs no extra query.
  //
  // Fire-and-forget: errors are caught inside — never blocks or fails
  // property creation.
  if (hostTier === 'plus' || hostTier === 'pro') {
    postToFacebookPage(doc, { superBoost: hostTier === 'pro' }).catch(() => {});
  }

  // A new listing must appear in search on the host's very next page load, so
  // every cached search page is dropped. Awaited (not fire-and-forget) so the
  // 201 response can't beat the invalidation and let the host reload into a
  // cached feed that is missing the listing they just created.
  await invalidate.onPropertyChanged({
    id: String(doc._id),
    slug: doc.slug,
    affectsCounts: true, // moves totalProperties + the status buckets
  });

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
    .select('title location area thana district division')
    .limit(20)
    .lean();

  return properties.map(p => ({
    id: String(p._id),
    title: p.title || '',
    location: p.location || '',
    area: p.area || '',
    thana: p.thana || '',
    district: p.district || '',
    division: p.division || ''
  }));
}

/**
 * Public property search — CACHE-ASIDE, 2 min TTL.
 *
 * This is the hot path: two aggregations plus a countDocuments on every call,
 * over a collection where legacy docs carry base64 media. It is also the most
 * repeated query on the platform (every visitor hits the default feed), which
 * is exactly the shape caching pays off on.
 *
 * ── WHY THE CACHE STOPS HERE, NOT AT THE RESPONSE ────────────────────────
 * We cache the DB result only. The controller then runs attachHostTiers() on
 * the returned items, which reads Subscription, Review and User.avatar LIVE.
 * That split is deliberate: a landlord whose subscription just lapsed must lose
 * their Plus/Pro badge immediately (the comment on attachHostTiers spells this
 * out), and caching the finished response for 2 minutes would keep serving the
 * badge. Splitting it means the expensive part is cached and the entitlement
 * part stays correct.
 *
 * ── WHY 2 MINUTES AND NOT LONGER ─────────────────────────────────────────
 * Search ordering is `activeBoost DESC`, and activeBoost is computed per
 * request from `boostedUntil` — there is no write when a boost expires, so
 * there is nothing to invalidate on. The TTL is the ONLY thing that retires an
 * expired boost from a cached page, so it has to stay short.
 *
 * Deliberately NOT invalidated on inquiry-count changes: services/inquiry.service.js
 * does `$inc: { inquiries: 1 }` and that field is on the list card, but flushing
 * every cached search page whenever anyone sends an inquiry would keep the hit
 * rate near zero to keep a counter 2 minutes fresher. Not a worthwhile trade.
 */
async function listProperties(query) {
  return cache.getOrSet(
    cache.KEY.search(invalidate.hashQuery(query)),
    cache.TTL.SEARCH,
    () => listPropertiesFromDb(query),
  );
}

async function listPropertiesFromDb(query) {
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

  const baseSort = searchService.buildSortOptions(query.sort);
  // Ranking: an ACTIVE paid boost wins, then plan tier, then whatever the
  // caller asked to sort by.
  //
  // `activeBoost` is computed per-request from boostedUntil rather than read
  // off the stored `boosted` flag, so a boost expires on its own schedule with
  // no un-boost sweep to run (and no window where a stale flag keeps a listing
  // pinned). The stored flag is kept for cheap filtering/indexing only.
  //
  // hostTier sorts pro (p-r-o) > plus (p-l-u-s) > free (f-r-e-e) alphabetically
  // descending, so -1 ranks higher tiers first without a lookup table.
  const sort = { activeBoost: -1, hostTier: -1, ...baseSort };
  const boostField = {
    $addFields: {
      activeBoost: {
        $cond: [
          { $and: [
            { $eq: ['$boosted', true] },
            { $gt: ['$boostedUntil', new Date()] },
          ] },
          1,
          0,
        ],
      },
    },
  };
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
      { $project: { coverPhoto: 0, coverPhotoThumb: 0, roomPhotos: 0, videoUrl: 0, videos: 0, description: 0, searchHaystack: 0 } },
      boostField,
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

  // Snapshot BEFORE mutating, for cache invalidation after the save.
  //   prevStatus → tells us whether the admin overview counts moved.
  //   prevSlug   → defensive. The slug is stable today (the model builds one
  //                only `if (!this.slug)`), so a rename keeps it; capturing it
  //                anyway means the old detail cache key is already handled if
  //                slug regeneration is ever enabled.
  const prevSlug = doc.slug;
  const prevStatus = doc.status;

  // Apply only the fields the caller actually sent. Re-running the model's
  // pre('validate') hook on .save() rebuilds the slug-and-haystack pair.
  const scalarFields = [
    'title', 'description', 'intent', 'type', 'category',
    'division', 'district', 'thana', 'area', 'location',
    'beds', 'baths', 'sqft', 'floor', 'floorNumber', 'furnishing',
    // videoId / videoUrl are deliberately NOT here — they are mirrors of
    // videos[0] now, written by the model hook. The videos block below owns
    // them (and accepts a legacy videoUrl/videoId payload as a 1-item array).
    'amenities', 'price', 'status', 'coverPhoto', 'coverPhotoThumb',
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
  // Media edits are tier-limited exactly like creation is — otherwise a free
  // host could create a compliant listing and then PATCH 40 photos onto it.
  const touchesPhotos = Object.prototype.hasOwnProperty.call(body, 'roomPhotos');
  const touchesVideos = Object.prototype.hasOwnProperty.call(body, 'videos') ||
    Object.prototype.hasOwnProperty.call(body, 'videoUrl') ||
    Object.prototype.hasOwnProperty.call(body, 'videoId');

  if (touchesPhotos || touchesVideos) {
    const sub = await Subscription.findOne({ userId: user._id });
    const tier = tierOf(sub);
    const nextPhotos = touchesPhotos ? normaliseRoomPhotos(body.roomPhotos) : null;
    const nextVideos = touchesVideos ? normaliseVideos(body.videos, body) : null;

    assertWithinTierLimits({
      tier,
      roomPhotos: nextPhotos,
      videos: nextVideos,
    });

    if (nextPhotos) doc.roomPhotos = nextPhotos;
    if (nextVideos) doc.videos = nextVideos;
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

  // Clear the detail entry under the new slug, the old slug AND the _id, plus
  // every cached search page. `affectsCounts` only when status moved, since that
  // is the sole field on this path the admin overview counts.
  await invalidate.onPropertyChanged({
    id: String(doc._id),
    slug: doc.slug,
    prevSlug: prevSlug !== doc.slug ? prevSlug : null,
    affectsCounts: prevStatus !== doc.status,
  });

  return doc;
}

// Cascade-delete a property document and EVERY child doc that hangs off it
// (inquiries, bookings, receipts, conversations, messages, and any bell
// notification that deep-links to any of them). Ownership authorization is
// the CALLER's responsibility: the host DELETE route enforces it in
// deleteProperty() below, while the rented-cleanup cron intentionally runs
// this with no user context. `doc` must be an already-loaded Property doc.
async function purgePropertyCascade(doc) {
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

  // Who is about to lose notifications? Their cached unread badge has to be
  // cleared, and this is the ONLY moment we can find out — once the deleteMany
  // below runs, the rows are gone and the affected users are unknowable. The
  // set is arbitrary (tenants who inquired, both chat participants, …), not
  // just the owner. Non-fatal: a failure here costs a stale badge for one TTL.
  let notifiedUserIds = [];
  try {
    notifiedUserIds = await Notification.find({ $or: notifClauses }).distinct('userId');
  } catch (err) {
    console.warn('[property] could not collect notified users for cache invalidation:', err.message);
  }

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

  // Runs for BOTH callers of this cascade — the host's DELETE route and the
  // rented-cleanup cron — which is why the hook belongs here rather than in the
  // controller. Clears the detail entry (id + slug), every search page, the
  // admin counts, and the unread badge of each affected user.
  await invalidate.onPropertyDeleted({
    id: String(propertyId),
    slug: doc.slug,
    affectedUserIds: notifiedUserIds,
  });

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

// Host-facing delete: resolve the listing, enforce that the caller owns it,
// then run the same cascade the cleanup cron uses.
async function deleteProperty({ idOrSlug, user }) {
  const doc = await Property.findOne(findIdOrSlug(idOrSlug));
  if (!doc) throw ApiError.notFound('প্রপার্টি পাওয়া যায়নি।', { code: 'property_not_found' });
  if (String(doc.ownerUserId) !== String(user._id)) {
    throw ApiError.forbidden('শুধুমাত্র মালিকই এই প্রপার্টি মুছতে পারবেন।', {
      code: 'not_owner',
    });
  }
  return purgePropertyCascade(doc);
}

module.exports = {
  createProperty,
  getPropertyById,
  getSuggestions,
  listProperties,
  listMyProperties,
  updateProperty,
  deleteProperty,
  // Reused by the rented-listing cleanup sweep (no owner check — see fn doc).
  purgePropertyCascade,
  // Exported for tests / future controllers.
  _internal: {
    normaliseRoomPhotos, normaliseSpecificDetails, gpsFromBody, findIdOrSlug,
    normaliseVideos, assertWithinTierLimits,
  },
};