'use strict';

const { z } = require('zod');
const { ENUMS } = require('../models/Property');

// ─── Reusable field schemas ────────────────────────────────────────────────
const titleSchema = z.string().trim().min(3, 'শিরোনাম অন্তত ৩ অক্ষরের হতে হবে।').max(160);
const descriptionSchema = z.string().trim().max(4000).optional().default('');
const divisionSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => ENUMS.DIVISIONS.includes(v), 'বিভাগ সঠিক নয়।');
const intentSchema     = z.enum(ENUMS.INTENTS).default('rent');
// Default is now 'flat' — the wizard renamed the "Apartment" option per
// the v2.1 design-system vocabulary shift. 'apartment' is still in the
// enum as an accepted alias for legacy callers and is normalised to
// 'flat' inside the Property pre('validate') hook.
const typeSchema       = z.enum(ENUMS.PROPERTY_TYPES).default('flat');
const categorySchema   = z.enum(ENUMS.CATEGORIES).default('family');
const furnishingSchema = z.enum(ENUMS.FURNISHINGS).default('Unfurnished');
const statusSchema     = z.enum(ENUMS.STATUSES).default('active');

// Intent-specific details bag. v1 contract is deliberately LOOSE (Option B):
// we only assert the SHAPE is a JSON object (z.record rejects arrays/strings/
// null), not the keys inside it — those depend on intent+type and are owned by
// the wizard. No `.default({})` here on purpose: defaulting would make the key
// always "present", and on a PATCH that the caller never intended to touch, the
// service would then overwrite the stored bag with {}. We let the service apply
// the {} default on create and skip the field entirely on an absent PATCH.
const specificDetailsSchema = z.record(z.any());

// Accept numeric inputs as either real numbers or numeric strings (the wizard
// sometimes sends "1200" instead of 1200) — coerce on the way in.
const numField = (min, max) =>
  z.coerce.number().finite().min(min).max(max);

// Image strings can be either base64 data: URLs OR plain https URLs. Use a
// generous max length so a single 3MB photo fits comfortably as base64.
const photoUrlSchema = z
  .string()
  .max(4_000_000, 'ছবি অনেক বড়। সর্বোচ্চ ~৩MB অনুমোদিত।')
  .refine(
    (s) => s === '' || /^https?:\/\//i.test(s) || /^data:image\//i.test(s),
    'ছবির URL সঠিক নয়।'
  );

// Locally-uploaded video walkthroughs. Accept either an https URL or a
// data: URL with a video/* mime type. Cap is large enough for a typical
// 20MB phone walkthrough clip; anything bigger should be hosted off-doc.
const videoUrlSchema = z
  .string()
  .max(25_000_000, 'ভিডিও অনেক বড়। সর্বোচ্চ ~২০MB অনুমোদিত।')
  .refine(
    (s) => s === '' || /^https?:\/\//i.test(s) || /^data:video\//i.test(s),
    'ভিডিও URL সঠিক নয়।'
  );

// The wizard sends room photos as `{ room, preview }` (data URL) before
// upload; the read API returns them as `{ room, url }`. Accept either shape
// so the same payload can flow in both directions — the property service
// normalises `preview` → `url` before saving.
const roomPhotoSchema = z
  .object({
    room:    z.string().trim().max(40).default('other'),
    url:     photoUrlSchema.optional(),
    preview: photoUrlSchema.optional(),
    thumbUrl: photoUrlSchema.optional(),
  })
  .passthrough()
  .refine(
    (p) => Boolean(p.url || p.preview),
    'ছবির URL দেওয়া হয়নি।'
  );

// A walkthrough video entry. Either an uploaded `url` or a YouTube id must be
// present. `preview` is accepted because the wizard uses that key for a local
// blob/data URL before upload — same in-and-out symmetry as roomPhotoSchema.
const videoSchema = z
  .object({
    url:       z.union([videoUrlSchema, z.literal('')]).optional(),
    preview:   z.union([videoUrlSchema, z.literal('')]).optional(),
    youtubeId: z.string().trim().max(200).optional(),
    thumbnail: z.union([photoUrlSchema, z.literal('')]).optional(),
    name:      z.string().trim().max(200).optional(),
  })
  .passthrough()
  .refine(
    (v) => Boolean(v.url || v.preview || v.youtubeId),
    'ভিডিও URL বা YouTube ID দেওয়া হয়নি।'
  );

// Hard ceilings, NOT per-tier limits. These only stop absurd payloads; the
// actual plan limits (5/15/50 photos, 0/1/5 videos) are enforced per host in
// services/property.service.js → assertWithinTierLimits(). Keep MAX_PHOTOS at
// or above the Pro photo cap or Pro's 50 photos become unreachable.
const MAX_PHOTOS = 50;
const MAX_VIDEOS = 5;

// ─── Schemas exported to routes ────────────────────────────────────────────
module.exports = {
  createProperty: z.object({
    title:       titleSchema,
    description: descriptionSchema,
    intent:      intentSchema.optional(),
    type:        typeSchema.optional(),
    category:    categorySchema.optional(),
    division:    divisionSchema,
    district:    z.string().trim().max(80).optional().default(''),
    area:        z.string().trim().max(120).optional().default(''),
    location:    z.string().trim().max(200).optional().default(''),
    gpsLat:      z.union([z.coerce.number(), z.null(), z.literal('')]).optional(),
    gpsLng:      z.union([z.coerce.number(), z.null(), z.literal('')]).optional(),
    gpsAddress:  z.string().trim().max(400).optional().default(''),
    beds:        numField(0, 50).optional().default(1),
    baths:       numField(0, 50).optional().default(1),
    sqft:        numField(0, 1_000_000).optional().default(0),
    floor:       numField(-5, 200).optional().default(0),
    furnishing:  furnishingSchema.optional(),
    amenities:   z.array(z.string().trim().max(80)).max(100).optional().default([]),
    price:       numField(0, 1_000_000_000),
    status:      statusSchema.optional(),
    coverPhoto:  z.union([photoUrlSchema, z.literal('')]).optional().default(''),
    coverPhotoThumb: z.union([photoUrlSchema, z.literal('')]).optional().default(''),
    roomPhotos:  z.array(roomPhotoSchema).max(MAX_PHOTOS).optional().default([]),
    // Canonical multi-video field (up to 5 on Pro).
    videos:      z.array(videoSchema).max(MAX_VIDEOS).optional().default([]),
    // Legacy single-video fields — still accepted so older clients keep working.
    // property.service.js wraps them into a one-element videos[].
    videoId:     z.string().trim().max(200).optional().default(''),
    // Locally-uploaded property walkthrough (data: URL OR https URL).
    videoUrl:    z.union([videoUrlSchema, z.literal('')]).optional().default(''),
    // "On which floor is this property located?" — new wizard field.
    floorNumber: numField(-5, 200).optional().default(0),
    // Intent-specific details (rent/sale/commercial). Loose object — see schema.
    specificDetails: specificDetailsSchema.optional(),
  }),

  // PATCH bodies — every field optional. We still validate types/enums.
  updateProperty: z.object({
    title:       titleSchema.optional(),
    description: descriptionSchema,
    intent:      intentSchema.optional(),
    type:        typeSchema.optional(),
    category:    categorySchema.optional(),
    division:    divisionSchema.optional(),
    district:    z.string().trim().max(80).optional(),
    area:        z.string().trim().max(120).optional(),
    location:    z.string().trim().max(200).optional(),
    gpsLat:      z.union([z.coerce.number(), z.null(), z.literal('')]).optional(),
    gpsLng:      z.union([z.coerce.number(), z.null(), z.literal('')]).optional(),
    gpsAddress:  z.string().trim().max(400).optional(),
    beds:        numField(0, 50).optional(),
    baths:       numField(0, 50).optional(),
    sqft:        numField(0, 1_000_000).optional(),
    floor:       numField(-5, 200).optional(),
    furnishing:  furnishingSchema.optional(),
    amenities:   z.array(z.string().trim().max(80)).max(100).optional(),
    price:       numField(0, 1_000_000_000).optional(),
    status:      statusSchema.optional(),
    coverPhoto:  z.union([photoUrlSchema, z.literal('')]).optional(),
    coverPhotoThumb: z.union([photoUrlSchema, z.literal('')]).optional(),
    roomPhotos:  z.array(roomPhotoSchema).max(MAX_PHOTOS).optional(),
    videos:      z.array(videoSchema).max(MAX_VIDEOS).optional(),
    videoId:     z.string().trim().max(200).optional(),
    videoUrl:    z.union([videoUrlSchema, z.literal('')]).optional(),
    floorNumber: numField(-5, 200).optional(),
    // Intent-specific details. MUST be declared here too — updateProperty is
    // .strict(), so an undeclared key would be rejected outright on edit.
    specificDetails: specificDetailsSchema.optional(),
  }).strict().refine(
    (obj) => Object.keys(obj).length > 0,
    'আপডেট করার মতো কোনো তথ্য পাওয়া যায়নি।'
  ),

  listQuery: z.object({
    q:        z.string().trim().max(120).optional(),
    division: z.string().trim().toLowerCase().optional(),
    type:     z.string().trim().optional(),
    category: z.string().trim().optional(),
    intent:   z.string().trim().optional(),
    status:   z.string().trim().optional(),
    minPrice: z.coerce.number().min(0).optional(),
    maxPrice: z.coerce.number().min(0).optional(),
    page:     z.coerce.number().int().min(1).max(500).optional().default(1),
    limit:    z.coerce.number().int().min(1).max(100).optional().default(50),
    sort:     z.enum(['newest', 'price_asc', 'price_desc', 'popular']).optional().default('newest'),
  }),
};