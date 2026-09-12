'use strict';

/**
 * Admin Provider Controller — the verification queue.
 * ──────────────────────────────────────────────────────────────────────────
 * This is the ONLY place admin touches a provider, and it happens ONCE per
 * business. Admin verifies an identity, confirms a fee, and then gets out of
 * the way: every order after that is provider↔tenant with nobody in between.
 * Nothing in this file can be reached per-transaction, which is what keeps the
 * marketplace from being capped by whatever the support team can handle.
 *
 * ─── THE LIFECYCLE ADMIN DRIVES ──────────────────────────────────────────────
 *
 *   pending_review ──approve──▶ awaiting_payment ──confirm fee──▶ active
 *         │                                                          │
 *         └──reject──▶ rejected (provider fixes it and resubmits)     │
 *                                                    suspend ◀────────┘
 *
 * The fee is collected AFTER the identity check, not before. Asking a sceptical
 * shopkeeper for money before he has seen a human being look at his shop is
 * where this kind of product dies.
 *
 * ─── WHAT THIS FILE GUARDS ───────────────────────────────────────────────────
 * 1. The green badge cannot be granted to someone who submitted no documents.
 *    A ভেরিফাইড badge handed out on trust is worth nothing to the tenant it is
 *    supposed to protect — and worse than nothing, because it looks like a
 *    check that never happened.
 * 2. A rejection ALWAYS carries a reason, shown to the provider verbatim.
 * 3. Activation ALWAYS sets an expiry. A one-time fee with a permanent listing
 *    becomes a graveyard of disconnected phone numbers within a year, and
 *    backfilling an expiry across live providers afterwards is painful.
 */

const Provider = require('../models/Provider');
const Merchant = require('../models/Merchant');
const ApiError = require('../utils/ApiError');
const invalidate = require('../services/cacheInvalidation');
const { getCategory } = require('../config/serviceCategories');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// How long a paid registration lasts before it must be renewed.
const DEFAULT_REGISTRATION_MONTHS = 12;

/**
 * The admin's view of a provider — deliberately NOT `toJSON()`.
 *
 * Provider.toJSON strips the identity documents and the fee/TrxID so a route
 * that forgets to select carefully cannot leak them to a tenant. The reviewer
 * is the one person who must see exactly those things, so this builds the
 * fuller shape explicitly rather than by loosening the model's default.
 */
function pickAdminProvider(p) {
  const category = getCategory(p.category);
  const coords = p.geo && Array.isArray(p.geo.coordinates) ? p.geo.coordinates : [];

  return {
    id: String(p._id),
    ownerMerchantId: String(p.ownerMerchantId),
    ownerName: p.ownerName,
    phone: p.phone,
    altPhone: p.altPhone,

    name: p.name,
    about: p.about,
    category: p.category,
    categoryLabel: category ? category.label : null,
    interaction: category ? category.interaction : null,
    fields: p.fields || {},

    photoUrl: p.photoUrl,
    lat: coords[1] ?? null,
    lng: coords[0] ?? null,
    division: p.division,
    district: p.district,
    thana: p.thana,
    area: p.area,
    addressText: p.addressText,
    coverage: p.coverage,

    status: p.status,
    // The full verification sub-document, documents included. This is the
    // whole job: the reviewer compares the NID to the selfie to the pin.
    verification: p.verification,
    registration: p.registration,

    openNow: p.openNow,
    pricesUpdatedAt: p.pricesUpdatedAt,
    ratingAvg: p.ratingAvg,
    ratingCount: p.ratingCount,
    stats: p.stats,
    lastActiveAt: p.lastActiveAt,
    declineCount: p.declineCount,
    cancelCount: p.cancelCount,
    noShowCount: p.noShowCount,
    suspendedReason: p.suspendedReason,

    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

async function loadProvider(id) {
  const provider = await Provider.findById(id);
  if (!provider) throw ApiError.notFound('প্রোভাইডার পাওয়া যায়নি।', { code: 'provider_not_found' });
  return provider;
}

/**
 * Are there enough documents on file to justify the green badge?
 *
 * `full` means somebody's identity was actually checked: an NID, and a selfie
 * taken at the pinned location. Without both there is nothing to have checked,
 * so the badge is refused however well-intentioned the click was.
 */
function canGrantFullTier(provider) {
  const v = provider.verification || {};
  return Boolean(v.nidFrontUrl && v.nidBackUrl && v.selfieUrl);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/providers
//   ?status=pending_review|awaiting_payment|active|rejected|suspended|expired|all
//   ?category=gas&q=করিম&page=1&limit=30
//
// Defaults to the REVIEW QUEUE, because that is what this screen is for.
// ─────────────────────────────────────────────────────────────────────────────
exports.listProviders = asyncH(async (req, res) => {
  const status = String(req.query.status || 'pending_review');
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 30));

  const filter = {};
  if (status !== 'all') filter.status = status;
  if (req.query.category) filter.category = String(req.query.category);

  if (req.query.q) {
    const q = String(req.query.q).trim().slice(0, 80);
    // Escaped — an admin pasting a phone number with a '+' should search for
    // it, not blow up on an invalid regex.
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { name: new RegExp(safe, 'i') },
      { ownerName: new RegExp(safe, 'i') },
      { phone: new RegExp(safe, 'i') },
      { thana: new RegExp(safe, 'i') },
    ];
  }

  const [rows, total] = await Promise.all([
    Provider.find(filter)
      // Oldest first inside the queue: somebody who submitted on Monday should
      // not still be waiting while Friday's applications get reviewed.
      .sort(status === 'pending_review' ? { createdAt: 1 } : { updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Provider.countDocuments(filter),
  ]);

  return res.json({
    providers: rows.map(pickAdminProvider),
    page,
    limit,
    total,
    hasMore: page * limit < total,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/providers/stats — the queue's header counts
// ─────────────────────────────────────────────────────────────────────────────
exports.getStats = asyncH(async (req, res) => {
  const [pendingReview, awaitingPayment, active, suspended, rejected, expiringSoon] =
    await Promise.all([
      Provider.countDocuments({ status: 'pending_review' }),
      Provider.countDocuments({ status: 'awaiting_payment' }),
      Provider.countDocuments({ status: 'active' }),
      Provider.countDocuments({ status: 'suspended' }),
      Provider.countDocuments({ status: 'rejected' }),
      Provider.countDocuments({
        status: 'active',
        'registration.expiresAt': {
          $ne: null,
          $lt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      }),
    ]);

  return res.json({
    stats: { pendingReview, awaitingPayment, active, suspended, rejected, expiringSoon },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/providers/:id
// ─────────────────────────────────────────────────────────────────────────────
exports.getProvider = asyncH(async (req, res) => {
  const provider = await loadProvider(req.params.id);
  // The owner's MERCHANT account matters to the reviewer: someone already
  // banned, or brand new this morning, is a different decision.
  //
  // There is no personal KYC status to read here — a merchant account is a
  // login, and the identity that gets checked belongs to the BUSINESS
  // (provider.verification), because it is the shop a tenant is trusting.
  const owner = await Merchant.findById(provider.ownerMerchantId)
    .select('name phone isBanned banReason phoneVerified createdAt');

  return res.json({
    provider: pickAdminProvider(provider),
    owner: owner ? {
      id: String(owner._id),
      name: owner.name,
      phone: owner.phone,
      isBanned: owner.isBanned,
      banReason: owner.banReason,
      phoneVerified: owner.phoneVerified,
      memberSince: owner.createdAt,
    } : null,
    canGrantFullTier: canGrantFullTier(provider),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/providers/:id/approve   { tier?: 'basic'|'full' }
//
// Approves the IDENTITY. It does not make anyone live — the fee does that.
// ─────────────────────────────────────────────────────────────────────────────
exports.approve = asyncH(async (req, res) => {
  const provider = await loadProvider(req.params.id);

  if (provider.status !== 'pending_review') {
    throw ApiError.badRequest('এই প্রোভাইডার রিভিউয়ের অপেক্ষায় নেই।', {
      code: 'not_pending_review',
      details: { status: provider.status },
    });
  }

  // Default to whatever the evidence supports, so the common case needs no
  // decision at all from the reviewer.
  const requested = req.body?.tier === 'full' ? 'full' : 'basic';

  if (requested === 'full' && !canGrantFullTier(provider)) {
    // The guard that keeps the badge meaningful. Refusing here is the whole
    // reason a tenant can trust it.
    throw ApiError.badRequest(
      'সম্পূর্ণ যাচাইয়ের জন্য NID (দুই পাশ) ও লোকেশন-সেলফি লাগবে।',
      { code: 'insufficient_documents' },
    );
  }

  provider.verification.status = 'verified';
  provider.verification.tier = requested;
  provider.verification.reviewedAt = new Date();
  provider.verification.reviewedBy = req.user._id;
  provider.verification.rejectionReason = '';

  // Already paid (the provider submitted a TrxID with his application and it
  // was confirmed earlier)? Then approval is the last step. Otherwise the fee
  // is what activates him.
  provider.status = provider.registration?.paidAt ? 'active' : 'awaiting_payment';

  await provider.save();
  await invalidate.onAdminStatsChanged();

  return res.json({ provider: pickAdminProvider(provider) });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/providers/:id/reject   { reason }
//
// `reason` is REQUIRED and is shown to the provider verbatim. A rejection with
// no reason is a dead end: he cannot tell whether the photo was blurry or the
// pin was in the wrong place, so he either gives up or resubmits the same
// thing and wastes a second review.
// ─────────────────────────────────────────────────────────────────────────────
exports.reject = asyncH(async (req, res) => {
  const provider = await loadProvider(req.params.id);

  if (!['pending_review', 'awaiting_payment'].includes(provider.status)) {
    throw ApiError.badRequest('এই প্রোভাইডার রিভিউয়ের অপেক্ষায় নেই।', {
      code: 'not_pending_review',
      details: { status: provider.status },
    });
  }

  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 5) {
    throw ApiError.badRequest('বাতিলের কারণ লিখুন — প্রোভাইডার এটি দেখতে পাবেন।', {
      code: 'reason_required',
    });
  }

  provider.status = 'rejected';
  provider.verification.status = 'rejected';
  provider.verification.reviewedAt = new Date();
  provider.verification.reviewedBy = req.user._id;
  provider.verification.rejectionReason = reason.slice(0, 500);
  provider.verification.submittedForReview = false;

  await provider.save();
  await invalidate.onAdminStatsChanged();

  return res.json({ provider: pickAdminProvider(provider) });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/providers/:id/payment
//   { amount, method, trxId, months?, waived? }
//
// Confirms the registration fee and takes the provider LIVE. There is no
// payment gateway (see RentPaymentSubmission for the same pattern on rent):
// the provider sends the money and the reference, and an admin confirms it.
//
// `waived: true` covers a launch promotion — the first providers in a new
// thana, or one a landlord vouched for. A waived fee still sets an expiry,
// because the expiry is about the listing going stale, not about the money.
// ─────────────────────────────────────────────────────────────────────────────
exports.confirmPayment = asyncH(async (req, res) => {
  const provider = await loadProvider(req.params.id);

  if (!['awaiting_payment', 'active', 'expired'].includes(provider.status)) {
    throw ApiError.badRequest('এই প্রোভাইডার এখনো অনুমোদিত হয়নি।', {
      code: 'not_approved_yet',
      details: { status: provider.status },
    });
  }

  const waived = req.body?.waived === true;
  const amount = waived ? 0 : Number(req.body?.amount);
  const trxId = String(req.body?.trxId || '').trim();

  if (!waived) {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw ApiError.badRequest('সঠিক পরিমাণ দিন।', { code: 'bad_amount' });
    }
    if (!trxId) {
      throw ApiError.badRequest('ট্রানজেকশন আইডি দিন।', { code: 'trx_required' });
    }
  }

  const months = Math.min(60, Math.max(1, Number(req.body?.months) || DEFAULT_REGISTRATION_MONTHS));

  // Renewing an active provider extends from whichever is later — his current
  // expiry or today — so paying early never costs him the unused time.
  const base = provider.registration?.expiresAt && provider.registration.expiresAt > new Date()
    ? new Date(provider.registration.expiresAt)
    : new Date();
  const expiresAt = new Date(base);
  expiresAt.setMonth(expiresAt.getMonth() + months);

  provider.registration = {
    amount: waived ? 0 : Math.round(amount),
    method: waived ? 'waived' : String(req.body?.method || '').slice(0, 40),
    trxId: waived ? '' : trxId.slice(0, 60),
    paidAt: new Date(),
    confirmedBy: req.user._id,
    // NEVER null. This is what stops the directory becoming a graveyard of
    // disconnected numbers.
    expiresAt,
  };

  // Only a verified identity goes live. Confirming a fee must never be a way
  // around the review.
  if (provider.verification?.status === 'verified') {
    provider.status = 'active';
  }

  await provider.save();
  await invalidate.onAdminStatsChanged();

  return res.json({ provider: pickAdminProvider(provider) });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/providers/:id/suspend   { reason }
// ─────────────────────────────────────────────────────────────────────────────
exports.suspend = asyncH(async (req, res) => {
  const provider = await loadProvider(req.params.id);

  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 5) {
    throw ApiError.badRequest('স্থগিত করার কারণ লিখুন।', { code: 'reason_required' });
  }

  provider.status = 'suspended';
  provider.suspendedReason = reason.slice(0, 300);
  // Suspended and "open for business" is a contradiction a tenant should never
  // be shown, even for the moment before the listing drops out of search.
  provider.openNow = false;

  await provider.save();
  await invalidate.onAdminStatsChanged();

  return res.json({ provider: pickAdminProvider(provider) });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/providers/:id/unsuspend
// ─────────────────────────────────────────────────────────────────────────────
exports.unsuspend = asyncH(async (req, res) => {
  const provider = await loadProvider(req.params.id);

  if (provider.status !== 'suspended') {
    throw ApiError.badRequest('এই প্রোভাইডার স্থগিত নন।', { code: 'not_suspended' });
  }

  const expired = provider.registration?.expiresAt
    && provider.registration.expiresAt < new Date();

  // Coming back from a suspension must not silently restore a registration
  // that lapsed while he was away.
  provider.status = expired ? 'expired' : 'active';
  provider.suspendedReason = '';
  // Left CLOSED on purpose: he decides when he is open again, not us.
  provider.openNow = false;

  await provider.save();
  await invalidate.onAdminStatsChanged();

  return res.json({ provider: pickAdminProvider(provider) });
});

exports.pickAdminProvider = pickAdminProvider;
exports.canGrantFullTier = canGrantFullTier;
exports.DEFAULT_REGISTRATION_MONTHS = DEFAULT_REGISTRATION_MONTHS;
