'use strict';

/**
 * Provider Controller — registration and self-service editing.
 * ──────────────────────────────────────────────────────────────────────────
 * Everything a provider does to his OWN business. Admin approval lives
 * elsewhere (admin routes); this file never grants `active` status to anybody.
 *
 * Three rules run through all of it:
 *
 * 1. OWNERSHIP IS CHECKED ON EVERY CALL, against the MERCHANT making it. The
 *    provider app has a client-side guard, but a guard in a browser protects
 *    the experience, never the data. `loadOwned()` is the only way a document
 *    is fetched here.
 *
 * 2. DRAFTS SAVE AT EVERY STEP. Registration happens over seven screens and
 *    will be interrupted by a customer halfway through. A partial save must
 *    never be rejected for missing a field from a screen he has not reached —
 *    that is `{ partial: true }`. Required fields are enforced exactly once,
 *    at submit.
 *
 * 3. ONLY A PRICE CHANGE STAMPS `pricesUpdatedAt`. Editing opening hours must
 *    not, or an unrelated save would launder a stale price as fresh and defeat
 *    the freshness ladder entirely.
 */

const Provider = require('../models/Provider');
const ApiError = require('../utils/ApiError');
const {
  getCategory,
  validateProviderFields,
} = require('../config/serviceCategories');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Statuses a provider may still edit himself. Once it is with an admin or
// live, the shape is frozen except for the narrow self-service fields.
const EDITABLE_STATUSES = ['draft', 'rejected'];

/**
 * Fetch a provider that this caller owns, or throw. The single door — no
 * handler in this file may call Provider.findById directly.
 */
async function loadOwned(id, merchant) {
  const provider = await Provider.findById(id);
  if (!provider) throw ApiError.notFound('প্রোভাইডার পাওয়া যায়নি।', { code: 'provider_not_found' });
  if (String(provider.ownerMerchantId) !== String(merchant._id)) {
    // 404, not 403: a caller who does not own this row should not learn that
    // it exists.
    throw ApiError.notFound('প্রোভাইডার পাওয়া যায়নি।', { code: 'provider_not_found' });
  }
  return provider;
}

/** Turn the validator's error list into the shape the API returns. */
function fieldErrors(errors) {
  return ApiError.badRequest('কিছু তথ্য ঠিক নেই।', {
    code: 'invalid_fields',
    details: errors,
  });
}

/**
 * Did any price_rows value actually change?
 *
 * This is what gates `pricesUpdatedAt`, so it compares the price_rows fields
 * ONLY — a change to `delivery` or `brands` is not a price change, and
 * stamping on it would quietly reset the staleness clock.
 */
function pricesChanged(category, before = {}, after = {}) {
  const cat = getCategory(category);
  if (!cat) return false;

  return cat.providerFields
    .filter((f) => f.type === 'price_rows')
    .some((f) => {
      const a = before[f.key] || {};
      const b = after[f.key] || {};
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of keys) {
        if (a[k] !== b[k]) return true;
      }
      return false;
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/providers — start a registration (draft)
// ─────────────────────────────────────────────────────────────────────────────
exports.create = asyncH(async (req, res) => {
  const { name, category, lat, lng } = req.body || {};

  const cat = getCategory(category);
  if (!cat) throw ApiError.badRequest('এই ক্যাটাগরি নেই।', { code: 'unknown_category' });
  if (cat.status !== 'live') {
    throw ApiError.badRequest('এই ক্যাটাগরিতে এখন রেজিস্ট্রেশন বন্ধ।', { code: 'category_not_live' });
  }
  if (!name || !String(name).trim()) {
    throw ApiError.badRequest(`${cat.nameLabel.bn} দিন।`, { code: 'name_required' });
  }
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    throw ApiError.badRequest('ম্যাপে আপনার অবস্থান দিন।', { code: 'location_required' });
  }

  const provider = new Provider({
    ownerMerchantId: req.merchant._id,
    ownerName: req.merchant.name || '',
    phone: req.merchant.phone || '',
    name: String(name).trim(),
    category,
    status: 'draft',
    // The category seeds coverage so the provider answers one chip question
    // instead of having to understand the concept.
    coverage: { ...cat.defaultCoverage },
  });
  // NEVER assign geo.coordinates by hand — GeoJSON is [lng, lat] and getting
  // it backwards silently relocates a Dhaka shop to Somalia.
  provider.setPoint(Number(lat), Number(lng));

  await provider.save();

  // No role is granted here any more. A merchant account IS the permission —
  // there is nothing on a To-Let Pro user to flip, because a shopkeeper does
  // not have one.
  return res.status(201).json({ provider: provider.toJSON() });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/providers/mine
// ─────────────────────────────────────────────────────────────────────────────
exports.listMine = asyncH(async (req, res) => {
  const providers = await Provider.find({ ownerMerchantId: req.merchant._id }).sort({ createdAt: -1 });
  return res.json({ providers: providers.map((p) => p.toJSON()) });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/providers/:id — the owner's own view
//
// Returns the freshness state alongside, so the listing editor can show
// "দাম ১২ দিন আগে আপডেট" without re-deriving the per-category clock.
// ─────────────────────────────────────────────────────────────────────────────
exports.getOne = asyncH(async (req, res) => {
  const provider = await loadOwned(req.params.id, req.merchant);
  return res.json({
    provider: provider.toJSON(),
    freshness: provider.priceFreshness(),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/providers/:id — the registration's non-field steps
//
// Every step of onboarding lands here, one at a time. Unknown keys are ignored
// rather than rejected: an older app build sending a field we have since
// removed should still be able to save the rest of its step.
// ─────────────────────────────────────────────────────────────────────────────
exports.update = asyncH(async (req, res) => {
  const provider = await loadOwned(req.params.id, req.merchant);
  const body = req.body || {};

  // A live or under-review listing is not freely editable — a provider must
  // not be able to swap his category out from under an admin's review, or
  // change the business an approved verification was granted to.
  const locked = !EDITABLE_STATUSES.includes(provider.status);

  if (typeof body.name === 'string' && body.name.trim()) {
    provider.name = body.name.trim();
  }
  if (typeof body.about === 'string') provider.about = body.about;
  if (typeof body.altPhone === 'string') provider.altPhone = body.altPhone;
  if (typeof body.hours === 'string') provider.hours = body.hours;

  if (!locked && body.category) {
    const cat = getCategory(body.category);
    if (!cat || cat.status !== 'live') {
      throw ApiError.badRequest('এই ক্যাটাগরিতে এখন রেজিস্ট্রেশন বন্ধ।', { code: 'category_not_live' });
    }
    if (cat.id !== provider.category) {
      // The answers belong to the old category's questions and mean nothing
      // under the new one. Clearing them is honest; carrying them over would
      // leave a গ্যাস price table attached to a grocery listing.
      provider.category = cat.id;
      provider.fields = {};
      provider.pricesUpdatedAt = null;
      provider.coverage = { ...cat.defaultCoverage };
    }
  }

  if (Number.isFinite(Number(body.lat)) && Number.isFinite(Number(body.lng))) {
    provider.setPoint(Number(body.lat), Number(body.lng));
  }

  for (const key of ['division', 'district', 'thana', 'area', 'addressText']) {
    if (typeof body[key] === 'string') provider[key] = body[key];
  }

  if (body.coverage && typeof body.coverage === 'object') {
    const { mode, radiusKm, thanas, areas } = body.coverage;
    if (mode === 'radius' || mode === 'areas') provider.coverage.mode = mode;
    if (Number.isFinite(Number(radiusKm))) provider.coverage.radiusKm = Number(radiusKm);
    if (Array.isArray(thanas)) provider.coverage.thanas = thanas.map(String).slice(0, 50);
    if (Array.isArray(areas)) provider.coverage.areas = areas.map(String).slice(0, 100);
  }

  if (typeof body.photoUrl === 'string') {
    provider.photoUrl = body.photoUrl;
    if (typeof body.photoPublicId === 'string') provider.photoPublicId = body.photoPublicId;
  }

  await provider.save();
  return res.json({ provider: provider.toJSON() });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/providers/:id/fields — the category-specific answers
//
// `?partial=1` for a draft step; omit it to validate as if submitting.
// ─────────────────────────────────────────────────────────────────────────────
exports.updateFields = asyncH(async (req, res) => {
  const provider = await loadOwned(req.params.id, req.merchant);
  const partial = req.query.partial === '1' || req.query.partial === 'true';

  const result = validateProviderFields(provider.category, req.body?.fields, {
    partial,
    // An already-registered provider keeps the right to edit his own prices
    // even if we later took his category out of the launch set.
    allowNotLive: true,
  });
  if (!result.ok) throw fieldErrors(result.errors);

  const before = provider.fields || {};
  // A partial save must MERGE, not replace — step 6 posts only the fields on
  // step 6, and a replace would wipe everything answered before it.
  const after = partial ? { ...before, ...result.values } : result.values;

  if (pricesChanged(provider.category, before, after)) {
    provider.pricesUpdatedAt = new Date();
  }

  provider.fields = after;
  provider.markModified('fields');   // Mixed — mongoose cannot see into it
  provider.lastActiveAt = new Date();
  await provider.save();

  return res.json({
    provider: provider.toJSON(),
    freshness: provider.priceFreshness(),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/providers/:id/submit — draft → pending_review
//
// The one place required fields are enforced. Everything before this is a
// draft and is allowed to be incomplete.
// ─────────────────────────────────────────────────────────────────────────────
exports.submit = asyncH(async (req, res) => {
  const provider = await loadOwned(req.params.id, req.merchant);

  if (!EDITABLE_STATUSES.includes(provider.status)) {
    throw ApiError.badRequest('এটি ইতিমধ্যে জমা দেওয়া হয়েছে।', { code: 'already_submitted' });
  }

  const result = validateProviderFields(provider.category, provider.fields, { allowNotLive: true });
  if (!result.ok) throw fieldErrors(result.errors);

  const missing = [];
  if (!provider.name) missing.push('name');
  if (!provider.geo?.coordinates?.length) missing.push('location');
  if (!provider.phone) missing.push('phone');
  // `basic` KYC — one photo — is all that is asked for here. NID belongs to
  // the VERIFIED badge, earned later; demanding it at the door is the wall
  // that stops a গৃহকর্মী from ever registering.
  if (!provider.photoUrl && !provider.verification?.photoUrl) missing.push('photo');

  if (missing.length) {
    throw ApiError.badRequest('রেজিস্ট্রেশন সম্পূর্ণ হয়নি।', {
      code: 'incomplete_registration',
      details: missing,
    });
  }

  provider.status = 'pending_review';
  provider.verification.submittedForReview = true;
  provider.verification.status = 'pending';
  provider.verification.tier = provider.verification.nidFrontUrl ? 'full' : 'basic';
  provider.verification.rejectionReason = '';
  provider.lastActiveAt = new Date();
  await provider.save();

  return res.json({ provider: provider.toJSON() });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/providers/:id/open — the খোলা / বন্ধ switch
//
// The single most important control in the provider app, so it is its own
// endpoint: one field, no validation to trip over, and nothing else that can
// fail alongside it.
// ─────────────────────────────────────────────────────────────────────────────
exports.setOpen = asyncH(async (req, res) => {
  const provider = await loadOwned(req.params.id, req.merchant);

  if (provider.status !== 'active') {
    // A draft or a listing still under review is not visible to anyone, so
    // "open" would be a claim about nothing.
    throw ApiError.badRequest('আপনার প্রোফাইল এখনো চালু হয়নি।', { code: 'provider_not_active' });
  }

  provider.openNow = Boolean(req.body?.openNow);
  provider.lastActiveAt = new Date();
  await provider.save();

  return res.json({ provider: provider.toJSON() });
});
