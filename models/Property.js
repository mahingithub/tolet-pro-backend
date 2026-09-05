'use strict';

const mongoose = require('mongoose');

// ─── ENUMS ─────────────────────────────────────────────────────────────────
// Keep these in sync with the frontend constants in `propertyService.js`.
const DIVISIONS = [
  'dhaka', 'chittagong', 'sylhet', 'rajshahi',
  'khulna', 'barishal', 'rangpur', 'mymensingh',
];

// Property types span all three listing intents (rent / sale / commercial).
// 'flat' is the new canonical replacement for 'apartment' per the design-system
// vocabulary shift; 'apartment' is kept ONLY as a read-time alias for legacy
// records and is normalised away on write (see `pre('validate')` below).
const PROPERTY_TYPES = [
  // Rental
  'flat', 'apartment', 'sublet', 'hostel', 'single_room',
  // Purchase
  'independent', 'house', 'duplex', 'studio', 'penthouse', 'land', 'building',
  // Commercial
  'office', 'shop', 'showroom', 'restaurant',
];

const CATEGORIES = [
  // Rental – apartments / sublet / single_room
  'family', 'bachelor_male', 'bachelor_female', 'sublet',
  'student', 'student_male', 'student_female',
  // Rental – hostel
  'working_professional', 'co_ed',
  // Purchase – flat
  'ready_flat', 'used', 'new_project', 'investment',
  // Purchase – house
  'duplex', 'triplex', 'single_story',
  // Purchase – land
  'residential', 'commercial', 'agricultural', 'road_side',
  // Purchase – building
  'commercial_building', 'residential_building',
  // Commercial & Purchase – shop
  'retail', 'wholesale', 'showroom',
  // Commercial & Purchase – restaurant
  'fast_food', 'dine_in', 'cafe', 'fine_dining',
  // Commercial – office
  'corporate', 'startup', 'co_working',
  // Commercial – showroom
  'brand_outlet', 'vehicle_showroom',
  // Commercial – warehouse (legacy)
  'warehouse',
];

// Listing intent. 'rent' / 'sale' / 'commercial' are the CANONICAL values the
// wizard and the mode-switcher tabs use — the DB only ever stores one of these
// three. 'sell' / 'buy' / 'purchase' are kept ONLY as accepted aliases for
// legacy callers and are normalised to 'sale' on write (see `pre('validate')`).
// They stay in the enum so Zod (`z.enum(ENUMS.INTENTS)`) accepts the old wire
// values long enough for the hook to rewrite them — exactly how 'apartment'
// is accepted and rewritten to 'flat'.
const INTENTS = ['rent', 'sale', 'commercial', 'sell', 'buy', 'purchase'];

const FURNISHINGS = ['Furnished', 'Semi-Furnished', 'Unfurnished'];

// `paused` means the host temporarily took the listing down (it can be
// resumed). `inactive` is admin/system-driven (e.g. moderation removed
// it, or the listing expired). The host dashboard surfaces a Pause /
// Resume toggle and writes 'paused' / 'active'; admin moderation writes
// 'inactive'. Keep both because the semantics are different from a
// host-perspective.
const STATUSES = ['active', 'paused', 'inactive', 'rented', 'draft'];

// ─── HELPERS ───────────────────────────────────────────────────────────────
function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

// Builds the search blob used by `searchService.search()`. Everything that
// a tenant might type into the search box ends up in here, lowercased.
//   ➜ "dhanmondi"          → matches by area
//   ➜ "dhanmondi 12"       → matches by free-form location text
//   ➜ "dhaka flat"         → "dhaka" (division) + "flat" (type alias)
//   ➜ "family apartment"   → "family" (category alias) + "apartment" (type)
function buildSearchHaystack(doc) {
  const typeAliases = {
    flat:         'flat apartment',
    apartment:    'flat apartment',
    sublet:       'sublet room shared',
    hostel:       'hostel mess',
    single_room:  'single room studio',
    independent:  'independent house bari',
    house:        'house bari home',
    duplex:       'duplex',
    studio:       'studio',
    penthouse:    'penthouse',
    land:         'land plot zomi',
    building:     'building tower',
    office:       'office workspace',
    shop:         'shop dokan retail',
    showroom:     'showroom display',
    restaurant:   'restaurant cafe',
  };
  const categoryAliases = {
    family:                'family paribarik',
    bachelor_male:         'bachelor male bachelors',
    bachelor_female:       'bachelor female bachelors',
    sublet:                'sublet room',
    student:               'student',
    student_male:          'student male ছাত্র',
    student_female:        'student female ছাত্রী',
    working_professional:  'working professional job চাকরিজীবী',
    co_ed:                 'mixed co-ed all',
    ready_flat:            'ready flat',
    used:                  'used resale',
    new_project:           'new project',
    investment:            'investment',
    duplex:                'duplex',
    triplex:               'triplex',
    single_story:          'single story one floor',
    residential:           'residential আবাসিক',
    commercial:            'commercial বাণিজ্যিক',
    agricultural:          'agricultural কৃষি',
    road_side:             'road side main road',
    commercial_building:   'commercial building',
    residential_building:  'residential building',
    retail:                'retail shop',
    wholesale:             'wholesale পাইকারি',
    showroom:              'showroom',
    fast_food:             'fast food',
    dine_in:               'dine in restaurant',
    cafe:                  'cafe coffee',
    fine_dining:           'fine dining',
    corporate:             'corporate office',
    startup:               'startup',
    co_working:            'co-working coworking shared workspace',
    brand_outlet:          'brand outlet',
    vehicle_showroom:      'vehicle showroom car',
    warehouse:             'warehouse godown',
  };
  const parts = [
    doc.title,
    doc.description,
    doc.division,
    doc.district,
    doc.thana,
    doc.area,
    doc.location,
    doc.gps && doc.gps.address,
    doc.type,
    typeAliases[doc.type] || '',
    doc.category,
    categoryAliases[doc.category] || '',
    doc.intent,
    doc.furnishing,
    Array.isArray(doc.amenities) ? doc.amenities.join(' ') : '',
    doc.ownerName,
  ];
  return parts
    .filter(Boolean)
    .map((s) => String(s).toLowerCase().trim())
    .filter((s) => s.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ');
}

// ─── Media validation (audit 4.4) ──────────────────────────────────────────
// Real photos/videos must be uploaded (Cloudinary) and stored as https URLs.
// Inline base64 (data: URIs) bloats documents — big listings blew past memory
// on list queries and pushed docs toward Mongo's 16MB limit. A tiny data: URI
// (e.g. a placeholder pixel) is tolerated, but anything larger is rejected so a
// full base64 image/video can never be persisted again. Hosted URLs always pass.
const MAX_INLINE_MEDIA = 4 * 1024; // 4KB — tiny threshold; real media is far larger
function rejectInlineMedia(v) {
  if (!v) return true; // empty / optional is fine
  if (/^\s*data:/i.test(v) && v.length > MAX_INLINE_MEDIA) return false;
  return true;
}
const inlineMediaValidator = {
  validator: rejectInlineMedia,
  message: 'Inline base64 media is not allowed — upload the file and save its URL instead.',
};

// ─── SUB-SCHEMAS ───────────────────────────────────────────────────────────
const RoomPhotoSchema = new mongoose.Schema(
  {
    room: { type: String, trim: true, default: 'other', maxlength: 40 },
    // Hosted (https) URL only — uploaded to Cloudinary by the client. Inline
    // base64 is rejected by inlineMediaValidator (audit 4.4); the short maxlength
    // is a second guard so an oversized payload can't bloat the document.
    url:  { type: String, trim: true, required: true, maxlength: 8192, validate: inlineMediaValidator },
    // Optional compressed/card-sized version. Detail pages still read `url`.
    thumbUrl: { type: String, trim: true, default: '', maxlength: 8192, validate: inlineMediaValidator },
  },
  { _id: false }
);

// A single walkthrough video. Plans allow 0 / 1 / 5 per property (free / plus /
// pro) — enforced in services/property.service.js, not here, so the schema stays
// a storage concern. Either an uploaded `url` OR a `youtubeId` is present.
const VideoSchema = new mongoose.Schema(
  {
    url:       { type: String, trim: true, default: '', maxlength: 8192, validate: inlineMediaValidator },
    youtubeId: { type: String, trim: true, default: '', maxlength: 200 },
    thumbnail: { type: String, trim: true, default: '', maxlength: 8192, validate: inlineMediaValidator },
    name:      { type: String, trim: true, default: '', maxlength: 200 },
  },
  { _id: false }
);

const GpsSchema = new mongoose.Schema(
  {
    lat:     { type: Number, default: null },
    lng:     { type: Number, default: null },
    address: { type: String, trim: true, default: '', maxlength: 400 },
  },
  { _id: false }
);

// ─── PROPERTY ──────────────────────────────────────────────────────────────
const PropertySchema = new mongoose.Schema(
  {
    title:       { type: String, required: true, trim: true, minlength: 3, maxlength: 160 },
    description: { type: String, trim: true, default: '', maxlength: 4000 },
    // `intent` and `division` are the leading fields of compound indexes at the
    // bottom of this file, so they need no standalone index of their own —
    // Mongo reads a single-field predicate straight off the compound's prefix.
    // `type` and `category` DO keep theirs: they are real filter fields that
    // are not the prefix of anything.
    intent:      { type: String, enum: INTENTS,       default: 'rent' },
    // Default type is now 'flat' — the wizard's rent intent renames
    // "Apartment" to "Flat". Legacy 'apartment' rows are auto-rewritten to
    // 'flat' inside the pre('validate') hook.
    type:        { type: String, enum: PROPERTY_TYPES, default: 'flat', index: true },
    category:    { type: String, enum: CATEGORIES,    default: 'family', index: true },

    division:    { type: String, enum: DIVISIONS, required: true, lowercase: true, trim: true },
    district:    { type: String, trim: true, default: '', maxlength: 80 },
    // Thana / upazila — the level tenants actually search by, since a district
    // like Dhaka or Bhola is far too broad. Stored as the English display label
    // (e.g. 'Dhanmondi', 'Lalmohan'), matching `area`. Deliberately NOT an enum:
    // the picker ships 613 thanas but a host may legitimately type one we don't
    // have, and rejecting that would leave them unable to list at all.
    thana:       { type: String, trim: true, default: '', maxlength: 100 },
    area:        { type: String, trim: true, default: '', maxlength: 120 },
    location:    { type: String, trim: true, default: '', maxlength: 200 },
    gps:         { type: GpsSchema, default: () => ({}) },

    beds:        { type: Number, default: 1, min: 0,  max: 50  },
    baths:       { type: Number, default: 1, min: 0,  max: 50  },
    sqft:        { type: Number, default: 0, min: 0,  max: 1_000_000 },
    floor:       { type: Number, default: 0, min: -5, max: 200 },
    furnishing:  { type: String, enum: FURNISHINGS, default: 'Unfurnished' },

    // ─── Multi-member rent management (house / room / seat) ──────────────────
    // How this property is let out, which drives the DEFAULT member.rentType
    // when a landlord adds occupants to its booking:
    //   flat  → whole unit to one lease (default, legacy behaviour)
    //   room  → subdivided into rooms, each rented separately
    //   seat  → hostel / mess: rooms subdivided into seats/beds
    //   mixed → a combination (rentType then lives per-member on the booking)
    // Not indexed: rentalType is never a query predicate. It is read off a
    // property the caller already loaded, to pick the default member.rentType
    // when a landlord adds occupants (booking.controller → fetchPropertyMeta).
    rentalType:  { type: String, enum: ['flat', 'room', 'seat', 'mixed'], default: 'flat' },
    // Total rentable slots (seats / rooms). Occupancy = active members on the
    // booking; Vacancy = capacity - occupancy. 0 = not tracked (whole-flat).
    capacity:    { type: Number, default: 0, min: 0, max: 500 },

    amenities:   { type: [String], default: [] },
    // Hosted (https) cover image URL — uploaded to Cloudinary by the wizard.
    // Inline base64 is rejected (audit 4.4); short maxlength is a second guard.
    coverPhoto:  { type: String, trim: true, default: '', maxlength: 8192, validate: inlineMediaValidator },
    // Optional card-sized cover image used only by listing/dashboard payloads.
    coverPhotoThumb: { type: String, trim: true, default: '', maxlength: 8192, validate: inlineMediaValidator },
    roomPhotos:  { type: [RoomPhotoSchema], default: [] },
    // Canonical walkthrough video list (up to 5 on Pro). `videoId` / `videoUrl`
    // below are LEGACY MIRRORS of videos[0], kept in lockstep by the
    // pre('validate') hook so every existing listing and every reader that
    // predates multi-video keeps working with no migration.
    videos:      { type: [VideoSchema], default: [] },

    // YouTube ID (e.g. 'O-P_J_gvALE'). Mirror of videos[0].youtubeId.
    videoId:     { type: String, trim: true, default: '', maxlength: 200 },
    // Locally-recorded video walkthrough — uploaded to Cloudinary, stored as an
    // https URL. Sits alongside videoId so a host can attach a raw clip even
    // when no YouTube version exists — video walkthroughs are now the primary
    // listing media per the design brief ("video walkthroughs prioritised over
    // photos in initial listing views"). Inline base64 is rejected (audit 4.4).
    videoUrl:    { type: String, trim: true, default: '', maxlength: 8192, validate: inlineMediaValidator },

    // Which floor the unit sits on ("On which floor is this property located?")
    // — 0 = ground, negative = basement levels.
    floorNumber: { type: Number, default: 0, min: -5, max: 200 },

    // ─── Intent-specific details (Dynamic Tab Architecture) ──────────────────
    // Open-shaped bag whose fields depend on intent + type (subCategory):
    //   rent       → tenantPreference, floorLevel, utilities …
    //   sale       → landMeasurement, frontRoadWidth, khatian (CS/RS) …
    //   commercial → gasLine, ducting/exhaust, fireSafety …
    // Stored as Mixed because the shape is intentionally open per the design.
    // IMPORTANT: Mongoose does NOT auto-detect in-place edits to Mixed fields.
    // The property service MUST call `doc.markModified('specificDetails')`
    // before `save()` on update, or the change is silently dropped.
    specificDetails: { type: mongoose.Schema.Types.Mixed, default: {} },

    price:         { type: Number, required: true, min: 0, max: 1_000_000_000 },
    originalPrice: { type: Number, default: null, min: 0, max: 1_000_000_000 },

    // Both are covered by the { status, availabilityStatus, createdAt } feed
    // index below — and neither is ever queried without the other, because the
    // public feed always asks for "active AND not already taken".
    status:        { type: String, enum: STATUSES, default: 'active' },
    availabilityStatus: {
      type: String,
      enum: ['available', 'booked', 'rented'],
      default: 'available',
    },

    // When this listing was marked 'rented' (stamped by booking.controller
    // createBooking). A rented listing is kept visible — badged with a
    // countdown — for RENTED_RETENTION_DAYS, then permanently removed by the
    // sweep in services/rentedCleanup.service.js. Null for any non-rented
    // listing; indexed because the cleanup query filters on it.
    // Covered by { status, rentedAt } below — the cleanup sweep always pairs
    // the two ("rented listings whose retention window has run out"), and a
    // rentedAt-only predicate does not exist anywhere in the app.
    rentedAt: { type: Date, default: null },

    // ─── Ownership snapshot ──────────────────────────────────────────────
    // ownerUserId is the canonical link; ownerName + ownerPhone are stored as
    // a denormalised snapshot so listing cards don't have to JOIN to render.
    ownerUserId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    ownerName:     { type: String, trim: true, default: '', maxlength: 80 },
    ownerPhone:    { type: String, trim: true, default: '', maxlength: 20 },
    // Not indexed: hostTier is a SORT key in the feed, never a filter — and it
    // is the second key of a sort whose first key is computed at query time
    // (activeBoost), so no index on it could be used for that sort anyway.
    hostTier:      { type: String, enum: ['free', 'plus', 'pro'], default: 'free' },

    // ─── Search boost (Plus perk) ────────────────────────────────────────
    // A Plus host may spend one monthly credit to pin a listing to the top of
    // the feed for 24h. `boosted` is the sort key; `boostedUntil` is the truth.
    // A sweep is deliberately NOT required to un-boost: the feed query filters
    // on boostedUntil > now, so an expired boost stops ranking on its own even
    // if `boosted` is still true. See services/boost.service.js.
    // Not indexed: `boosted` is never a query predicate. The feed does not
    // filter on it — it recomputes activeBoost per request from boostedUntil
    // (see the comment above), so the stored flag is only ever read back off a
    // document that was already fetched.
    boosted:      { type: Boolean, default: false },
    boostedUntil: { type: Date, default: null },

    // ─── Counters (denormalised) ─────────────────────────────────────────
    rating:        { type: Number, default: 0, min: 0, max: 5 },
    reviews:       { type: Number, default: 0, min: 0 },
    popularity:    { type: Number, default: 0, min: 0 },
    inquiries:     { type: Number, default: 0, min: 0 },
    verified:      { type: Boolean, default: false },

    // ─── Search ──────────────────────────────────────────────────────────
    slug:           { type: String, trim: true, lowercase: true, index: true },
    searchHaystack: { type: String, trim: true, default: '' },

    // ─── Admin moderation audit ──────────────────────────────────────────
    // Set whenever an admin uses POST /api/admin/properties/:id/moderate.
    // We keep the actor + reason on the document for later support
    // tickets ("why was my listing removed?"). The actual public-visibility
    // change happens via the `status` enum flipping to 'inactive'.
    moderationReason: { type: String, default: '', maxlength: 500 },
    moderatedAt:      { type: Date,   default: null },
    moderatedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// Mongo text index for richer multi-word search.
//
// READ THIS BEFORE ASSUMING IT IS DOING ANYTHING. Nothing in the codebase
// issues a $text query — searchService.buildSearchFilter builds $regex clauses
// against searchHaystack instead, and that is the only search path there is.
// So today this index is written on every property save and read by nobody,
// which for a text index (it tokenises the whole haystack string on each write)
// is the most expensive way in the schema to store nothing.
//
// It is kept rather than dropped because the recommended fix is to START USING
// it — a $text query is what turns the search from a collection scan into an
// index seek. That change alters which listings match and in what order, so it
// is a product decision, written up separately rather than slipped in here. If
// that write-up is rejected and regex search is kept, drop this index.
PropertySchema.index({ searchHaystack: 'text' });

// ─── The public feed ────────────────────────────────────────────────────────
// THE hot query in the app: every visit to the listing page runs it twice, once
// for the page and once for `countDocuments` on the same filter. The filter is
// always `{ status: 'active', availabilityStatus: { $nin: ['rented','booked'] } }`
// plus whatever the user narrowed by, so those two lead. createdAt trails them
// so the default "newest first" sort is read in b-tree order.
//
// This also makes the count cheap: with every field of the filter in one index,
// countDocuments answers from the index alone and never touches a document.
PropertySchema.index({ status: 1, availabilityStatus: 1, createdAt: -1 });

// Common filter combo — division + status + createdAt — used by the listing
// page's "Newest in Dhaka" feed and the "active only" homepage.
PropertySchema.index({ division: 1, status: 1, createdAt: -1 });

// Mode-switcher feed — intent + status + createdAt. The tab UI always filters
// by intent first, so this keeps "Newest for Sale" / "Newest Commercial"
// pages off a collection scan.
PropertySchema.index({ intent: 1, status: 1, createdAt: -1 });

// ─── Host dashboard ─────────────────────────────────────────────────────────
// listMyProperties: every property a host owns, newest first, no status filter
// (a host sees their paused and rented listings too). Without createdAt in the
// index this fetched the host's whole portfolio and sorted it in memory.
// `_id: -1` is included because the query sorts by `{ createdAt: -1, _id: -1 }`
// and an index that stops short of the tie-break key cannot serve that sort.
PropertySchema.index({ ownerUserId: 1, createdAt: -1, _id: -1 });
// Host property lookups filtered to a status — insights + the listing quota check.
PropertySchema.index({ ownerUserId: 1, status: 1 });

// ─── Sweeps + analytics ─────────────────────────────────────────────────────
// rentedCleanup.service: rented listings whose retention window has expired.
// Equality on status, range on rentedAt — range last, so the scan starts at the
// cutoff instead of at the first rented listing ever.
PropertySchema.index({ status: 1, rentedAt: 1 });
// Market opportunity comparisons: find comparable properties by area + type.
PropertySchema.index({ area: 1, type: 1, price: 1 });

// ─── Auto-build slug + haystack on save ────────────────────────────────────
PropertySchema.pre('validate', function preValidate(next) {
  // Vocabulary shift — "apartment" is now spelled "flat" everywhere on the
  // wire. Any legacy or third-party caller that still sends 'apartment' is
  // silently normalised so the DB only ever stores the canonical value.
  if (this.type === 'apartment') this.type = 'flat';

  // Listing-intent vocabulary — 'sale' is the canonical word the wizard uses.
  // Collapse the legacy 'sell' / 'buy' / 'purchase' aliases so the DB only
  // ever stores rent / sale / commercial.
  if (this.intent === 'sell' || this.intent === 'buy' || this.intent === 'purchase') {
    this.intent = 'sale';
  }

  // Keep the legacy `floor` column in lockstep with the new
  // `floorNumber` wizard input. Whichever side the caller wrote, mirror
  // the value to the other so existing readers (and the toJSON shape)
  // keep working without a breaking migration.
  if (Number.isFinite(this.floorNumber) && this.floorNumber !== 0 && !this.floor) {
    this.floor = this.floorNumber;
  } else if (Number.isFinite(this.floor) && this.floor !== 0 && !this.floorNumber) {
    this.floorNumber = this.floor;
  }

  // Keep the legacy single-video columns in lockstep with `videos[]`, exactly
  // as `floor` / `floorNumber` above. Whichever side the caller wrote wins:
  //   videos[] present  → mirror entry [0] down onto videoUrl / videoId
  //   only the scalars  → lift them into a one-element videos[]
  // Existing documents (written before videos[] existed) hit the second branch
  // the first time they are saved, so they self-migrate on next edit.
  if (Array.isArray(this.videos) && this.videos.length) {
    const first = this.videos[0] || {};
    this.videoUrl = first.url || '';
    this.videoId  = first.youtubeId || '';
  } else if (this.videoUrl || this.videoId) {
    this.videos = [{
      url:       this.videoUrl || '',
      youtubeId: this.videoId  || '',
      thumbnail: '',
      name:      '',
    }];
  }

  if (!this.slug) {
    const stem = slugify(this.title || 'property');
    // Append last 6 chars of the auto-gen _id (Mongoose creates it before
    // validation) to keep slugs collision-resistant without a unique index.
    const idTail = String(this._id || new mongoose.Types.ObjectId())
      .slice(-6)
      .toLowerCase();
    this.slug = `${stem}-${idTail}`.slice(0, 100);
  }
  this.searchHaystack = buildSearchHaystack(this);
  next();
});

// `findOneAndUpdate` skips pre('validate'), so re-derive the haystack on
// update via findOneAndUpdate / updateOne pipelines. The controller calls
// `recomputeSearchHaystack()` after applying patches.
PropertySchema.statics.recomputeSearchHaystack = function recompute(doc) {
  return buildSearchHaystack(doc);
};
PropertySchema.statics.ENUMS = {
  DIVISIONS, PROPERTY_TYPES, CATEGORIES, INTENTS, FURNISHINGS, STATUSES,
};

// ─── JSON serialisation ────────────────────────────────────────────────────
// The frontend's `_normaliseApiProperty()` reads many alias fields. We don't
// want to pollute the DB with redundant copies, so we hand-craft a `toJSON`
// transform that exposes the legacy aliases on the wire while keeping the
// canonical doc clean.
PropertySchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id              = String(ret._id);
    ret.landlordId      = ret.ownerUserId ? String(ret.ownerUserId) : null;
    ret.landlordName    = ret.ownerName  || '';
    ret.landlordPhone   = ret.ownerPhone || '';
    ret.hostTier        = ret.hostTier   || 'free';
    ret.gpsLat          = ret.gps && ret.gps.lat ? ret.gps.lat : null;
    ret.gpsLng          = ret.gps && ret.gps.lng ? ret.gps.lng : null;
    ret.gpsAddress      = ret.gps && ret.gps.address ? ret.gps.address : '';
    ret.rentalCategory  = ret.category;
    // Strip the internal haystack — it's not useful to the client and only
    // adds payload size.
    delete ret.searchHaystack;
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('Property', PropertySchema);
module.exports.buildSearchHaystack = buildSearchHaystack;
module.exports.slugify = slugify;
module.exports.ENUMS = { DIVISIONS, PROPERTY_TYPES, CATEGORIES, INTENTS, FURNISHINGS, STATUSES };