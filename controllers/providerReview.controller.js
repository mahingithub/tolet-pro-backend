'use strict';

/**
 * ProviderReview Controller — three surfaces, three gates.
 * ─────────────────────────────────────────────────────────────────────────────
 *   PUBLIC    GET  /api/services/providers/:id/reviews   read a shop's reviews
 *   TENANT    POST /api/service-requests/reviews         leave or edit one
 *   MERCHANT  POST /api/merchant/reviews/:id/reply       answer one
 *
 * The same three-way split as everything else in this system: a guest may
 * read, a User may write, a Merchant may reply — and each is a different token
 * audience rather than a role check on one.
 *
 * ─── THE GATE IS THE POINT ───────────────────────────────────────────────────
 * Anyone can write a review of anything on the internet, which is why nobody
 * believes them. Here a review requires a row in the connection ledger: a
 * completed order, or — for the four contact-tier categories that have no order
 * flow at all — a recorded call. The gate is checked server-side against the
 * ledger, never against a claim in the body.
 */

const mongoose = require('mongoose');

const ProviderReview = require('../models/ProviderReview');
const ServiceRequest = require('../models/ServiceRequest');
const ContactEvent = require('../models/ContactEvent');
const Provider = require('../models/Provider');
const ApiError = require('../utils/ApiError');
const { getCategory } = require('../config/serviceCategories');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/**
 * May this user review this provider, and on what evidence?
 *
 * Returns `{ basis, requestId }` or null. Never trusts anything from the
 * request body — the whole value of the badge is that the server checked.
 */
async function findEntitlement(userId, provider) {
  // The strong evidence, and the only one that counts for an order-tier shop:
  // a request this person placed with this provider and actually received.
  const completed = await ServiceRequest.findOne({
    providerId: provider._id,
    tenantId: userId,
    status: 'completed',
  }).sort({ completedAt: -1 }).select('_id');

  if (completed) return { basis: 'order', requestId: completed._id };

  const cat = getCategory(provider.category);
  if (cat && cat.interaction === 'contact') {
    // গৃহকর্মী, ইলেকট্রিশিয়ান, প্লাম্বার, ইন্টারনেট never produce an order, so
    // requiring one would silence reviews in exactly the four categories where
    // a stranger entering your home makes trust matter most.
    //
    // A `view` is NOT enough — that is browsing, not contact. Weaker evidence
    // than a completed order, and recorded as such in `basis`.
    const called = await ContactEvent.exists({
      providerId: provider._id,
      userId,
      kind: { $in: ['call_tel', 'call_inapp', 'request'] },
    });
    if (called) return { basis: 'contact', requestId: null };
  }

  return null;
}

async function loadActiveProvider(id) {
  if (!mongoose.isValidObjectId(id)) {
    throw ApiError.notFound('প্রোভাইডার পাওয়া যায়নি।', { code: 'provider_not_found' });
  }
  const provider = await Provider.findById(id);
  if (!provider) {
    throw ApiError.notFound('প্রোভাইডার পাওয়া যায়নি।', { code: 'provider_not_found' });
  }
  return provider;
}

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC — GET /api/services/providers/:id/reviews
// ═════════════════════════════════════════════════════════════════════════════
exports.listForProvider = asyncH(async (req, res) => {
  const provider = await loadActiveProvider(req.params.id);
  const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));

  const [rows, breakdown] = await Promise.all([
    ProviderReview.find({ providerId: provider._id, hidden: false })
      .sort({ createdAt: -1 })
      .limit(limit),

    // The 5→1 histogram. A 4.5 built from twenty 5s and two 1s is a different
    // shop from a 4.5 built from twenty-two 4s, and only the histogram says
    // which one a tenant is looking at.
    ProviderReview.aggregate([
      { $match: { providerId: provider._id, hidden: false } },
      { $group: { _id: '$rating', n: { $sum: 1 } } },
    ]),
  ]);

  const stars = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of breakdown) stars[r._id] = r.n;

  return res.json({
    reviews: rows.map((r) => r.toJSON()),
    ratingAvg: provider.ratingAvg,
    ratingCount: provider.ratingCount,
    stars,
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TENANT — POST /api/service-requests/reviews   { providerId, rating, comment }
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Leave a review, or replace the one already there.
 *
 * An upsert rather than a create-or-409: the tenant-facing action is "rate this
 * shop", and someone whose second visit went better should be able to say so
 * without first finding and deleting an old row. The unique index makes "one
 * person, one shop, one opinion" true whatever the client does.
 */
exports.upsertMine = asyncH(async (req, res) => {
  const rating = Number(req.body?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw ApiError.badRequest('১ থেকে ৫ তারকা দিন।', { code: 'bad_rating' });
  }

  const provider = await loadActiveProvider(req.body?.providerId);

  const entitlement = await findEntitlement(req.user._id, provider);
  if (!entitlement) {
    // Said plainly, and differently per tier, because "you cannot review this"
    // with no reason reads as censorship.
    const cat = getCategory(provider.category);
    throw ApiError.forbidden(
      cat && cat.interaction === 'contact'
        ? 'রিভিউ দিতে হলে আগে এই প্রোভাইডারকে ফোন করতে হবে।'
        : 'সম্পন্ন হওয়া অর্ডারের পরেই রিভিউ দেওয়া যায়।',
      { code: 'not_entitled' },
    );
  }

  const doc = await ProviderReview.findOneAndUpdate(
    { providerId: provider._id, reviewerId: req.user._id },
    {
      $set: {
        rating,
        comment: String(req.body?.comment || '').slice(0, 1000),
        reviewerName: req.user.name || '',
        category: provider.category,
        basis: entitlement.basis,
        requestId: entitlement.requestId,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  // Recomputed from the rows, never incremented: an edit has to subtract its
  // own old value, and an average that drifts can never be reconciled.
  const totals = await ProviderReview.recomputeProvider(provider._id);

  // Link the review back to the order it came from, so the tenant's order
  // screen can show "রিভিউ দেওয়া হয়েছে" instead of asking again.
  if (entitlement.requestId) {
    await ServiceRequest.updateOne(
      { _id: entitlement.requestId },
      { $set: { rating, ratedAt: new Date(), reviewId: doc._id } },
    );
  }

  return res.status(201).json({ review: doc.toJSON(), ...totals });
});

/** GET /api/service-requests/reviews/mine?providerId= — "have I rated this?" */
exports.getMine = asyncH(async (req, res) => {
  if (!mongoose.isValidObjectId(req.query.providerId)) {
    throw ApiError.badRequest('প্রোভাইডার আইডি দিন।', { code: 'bad_provider' });
  }
  const doc = await ProviderReview.findOne({
    providerId: req.query.providerId,
    reviewerId: req.user._id,
  });
  return res.json({ review: doc ? doc.toJSON() : null });
});

// ═════════════════════════════════════════════════════════════════════════════
// MERCHANT — POST /api/merchant/reviews/:id/reply   { text }
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The right of reply.
 *
 * The single most valuable thing on a hyperlocal listing: a calm answer to a
 * bad review does more for a shop than the review costs it. He may write and
 * rewrite his own reply forever, and he may never touch the review itself —
 * that asymmetry is the whole deal.
 */
exports.reply = asyncH(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw ApiError.notFound('রিভিউ পাওয়া যায়নি।', { code: 'review_not_found' });
  }

  const review = await ProviderReview.findById(req.params.id);
  if (!review) throw ApiError.notFound('রিভিউ পাওয়া যায়নি।', { code: 'review_not_found' });

  // Ownership derived from the review's provider, never from a providerId in
  // the body — otherwise any merchant could answer anybody's reviews in his
  // own shop's name.
  const owned = await Provider.exists({
    _id: review.providerId,
    ownerMerchantId: req.merchant._id,
  });
  if (!owned) throw ApiError.notFound('রিভিউ পাওয়া যায়নি।', { code: 'review_not_found' });

  const text = String(req.body?.text || '').trim();
  if (!text) throw ApiError.badRequest('উত্তর লিখুন।', { code: 'text_required' });

  review.reply = { text: text.slice(0, 600), at: new Date(), byMerchantId: req.merchant._id };
  await review.save();

  return res.json({ review: review.toJSON() });
});

/** GET /api/merchant/reviews — every review across the shops he owns. */
exports.listForMerchant = asyncH(async (req, res) => {
  const providerIds = await Provider.find({ ownerMerchantId: req.merchant._id }).distinct('_id');
  if (!providerIds.length) return res.json({ reviews: [] });

  const filter = { providerId: { $in: providerIds } };
  // The default view is the one that needs an answer. A merchant opening this
  // screen is looking for what to reply to, not for a wall of five-star rows.
  if (req.query.unanswered === '1') filter['reply.at'] = null;

  const rows = await ProviderReview.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(100, Number.parseInt(req.query.limit, 10) || 50));

  return res.json({ reviews: rows.map((r) => r.toJSON()) });
});

exports.findEntitlement = findEntitlement;
