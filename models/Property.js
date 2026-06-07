'use strict';

const mongoose = require('mongoose');

// ─── ENUMS ─────────────────────────────────────────────────────────────────
// Keep these in sync with the frontend constants in `propertyService.js`.
const DIVISIONS = [
  'dhaka', 'chittagong', 'sylhet', 'rajshahi',
  'khulna', 'barishal', 'rangpur', 'mymensingh',
];

// Property types span all three listing intents (rent / purchase / commercial).
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
  // Rental
  'family', 'bachelor_male', 'bachelor_female', 'sublet', 'student',
  // Purchase
  'ready_flat', 'used', 'new_project', 'investment',
  // Commercial
  'corporate', 'startup', 'retail', 'warehouse',
];

const INTENTS = ['rent', 'sell', 'buy', 'purchase', 'commercial'];

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
    family:           'family',
    bachelor_male:    'bachelor male bachelors',
    bachelor_female:  'bachelor female bachelors',
    sublet:           'sublet room',
    student:          'student',
    ready_flat:       'ready flat',
    used:             'used resale',
    new_project:      'new project',
    investment:       'investment',
    corporate:        'corporate office',
    startup:          'startup',
    retail:           'retail shop',
    warehouse:        'warehouse godown',
  };
  const parts = [
    doc.title,
    doc.description,
    doc.division,
    doc.district,
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

// ─── SUB-SCHEMAS ───────────────────────────────────────────────────────────
const RoomPhotoSchema = new mongoose.Schema(
  {
    room: { type: String, trim: true, default: 'other', maxlength: 40 },
    // Either a data: URL (base64 inline) or an https URL. We cap the length
    // so an oversized upload can't blow up the document past Mongo's 16MB
    // doc limit on its own.
    url:  { type: String, trim: true, required: true, maxlength: 4_000_000 },
    // Optional compressed/card-sized version. Detail pages still read `url`.
    thumbUrl: { type: String, trim: true, default: '', maxlength: 1_000_000 },
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
    intent:      { type: String, enum: INTENTS,       default: 'rent', index: true },
    // Default type is now 'flat' — the wizard's rent intent renames
    // "Apartment" to "Flat". Legacy 'apartment' rows are auto-rewritten to
    // 'flat' inside the pre('validate') hook.
    type:        { type: String, enum: PROPERTY_TYPES, default: 'flat', index: true },
    category:    { type: String, enum: CATEGORIES,    default: 'family', index: true },

    division:    { type: String, enum: DIVISIONS, required: true, lowercase: true, trim: true, index: true },
    district:    { type: String, trim: true, default: '', maxlength: 80 },
    area:        { type: String, trim: true, default: '', maxlength: 120 },
    location:    { type: String, trim: true, default: '', maxlength: 200 },
    gps:         { type: GpsSchema, default: () => ({}) },

    beds:        { type: Number, default: 1, min: 0,  max: 50  },
    baths:       { type: Number, default: 1, min: 0,  max: 50  },
    sqft:        { type: Number, default: 0, min: 0,  max: 1_000_000 },
    floor:       { type: Number, default: 0, min: -5, max: 200 },
    furnishing:  { type: String, enum: FURNISHINGS, default: 'Unfurnished' },

    amenities:   { type: [String], default: [] },
    // Inline image storage — either base64 data URL or http URL. Mirrors the
    // shape the wizard already builds (`form.coverPhoto.preview`) so the
    // frontend doesn't need to change to talk to the API.
    coverPhoto:  { type: String, trim: true, default: '', maxlength: 4_000_000 },
    // Optional card-sized cover image used only by listing/dashboard payloads.
    coverPhotoThumb: { type: String, trim: true, default: '', maxlength: 1_000_000 },
    roomPhotos:  { type: [RoomPhotoSchema], default: [] },
    // YouTube ID (e.g. 'O-P_J_gvALE'). Optional second video source.
    videoId:     { type: String, trim: true, default: '', maxlength: 200 },
    // Locally-uploaded video walkthrough (data: URL OR https URL). Sits
    // alongside videoId so a host can attach a raw clip even when no
    // YouTube version exists — video walkthroughs are now the primary
    // listing media per the design brief ("video walkthroughs prioritised
    // over photos in initial listing views").
    videoUrl:    { type: String, trim: true, default: '', maxlength: 25_000_000 },

    // Which floor the unit sits on ("On which floor is this property located?")
    // — 0 = ground, negative = basement levels.
    floorNumber: { type: Number, default: 0, min: -5, max: 200 },

    price:         { type: Number, required: true, min: 0, max: 1_000_000_000 },
    originalPrice: { type: Number, default: null, min: 0, max: 1_000_000_000 },

    status:        { type: String, enum: STATUSES, default: 'active', index: true },

    // ─── Ownership snapshot ──────────────────────────────────────────────
    // ownerUserId is the canonical link; ownerName + ownerPhone are stored as
    // a denormalised snapshot so listing cards don't have to JOIN to render.
    ownerUserId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ownerName:     { type: String, trim: true, default: '', maxlength: 80 },
    ownerPhone:    { type: String, trim: true, default: '', maxlength: 20 },

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

// Mongo text index for richer multi-word search. The regex fallback in
// services/searchService.js still handles substring matches that text-index
// stemming misses (e.g. "dhanmondi 12" inside "Dhanmondi-12").
PropertySchema.index({ searchHaystack: 'text' });

// Common filter combo — division + status + createdAt — used by the listing
// page's "Newest in Dhaka" feed and the "active only" homepage.
PropertySchema.index({ division: 1, status: 1, createdAt: -1 });

// ─── Auto-build slug + haystack on save ────────────────────────────────────
PropertySchema.pre('validate', function preValidate(next) {
  // Vocabulary shift — "apartment" is now spelled "flat" everywhere on the
  // wire. Any legacy or third-party caller that still sends 'apartment' is
  // silently normalised so the DB only ever stores the canonical value.
  if (this.type === 'apartment') this.type = 'flat';

  // Keep the legacy `floor` column in lockstep with the new
  // `floorNumber` wizard input. Whichever side the caller wrote, mirror
  // the value to the other so existing readers (and the toJSON shape)
  // keep working without a breaking migration.
  if (Number.isFinite(this.floorNumber) && this.floorNumber !== 0 && !this.floor) {
    this.floor = this.floorNumber;
  } else if (Number.isFinite(this.floor) && this.floor !== 0 && !this.floorNumber) {
    this.floorNumber = this.floor;
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
