'use strict';

/**
 * Billing Controller
 * ──────────────────────────────────────────────────────────────────────────
 * Handles subscription state for hosts. There is no payment gateway: hosts
 * pay by bKash / Nagad Send Money and submit the TrxID, which is accepted by a
 * forwarded wallet SMS or an admin — see services/subscriptionPayment.service.js.
 */

const Subscription = require('../models/Subscription');
const Property = require('../models/Property');
const ApiError = require('../utils/ApiError');
const { trialEndFrom, tierOf, TRIAL_MONTHS } = require('../utils/subscriptionTier');
const payments = require('../services/subscriptionPayment.service');
const SubscriptionPayment = require('../models/SubscriptionPayment');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/** Does this user hold the landlord role? Mirrors landlord.controller.js. */
function isLandlord(user) {
  if (!user) return false;
  return Array.isArray(user.roles)
    ? user.roles.includes('landlord')
    : user.role === 'landlord';
}

/**
 * Fetch the caller's subscription, or null when they have none.
 *
 * A missing row IS the free plan (`tierOf(null) === 'free'`), and nothing is
 * provisioned on read — there is no automatic trial. A row appears only when
 * the host buys a plan (checkout) or completes the share task (claimShareTrial).
 * This used to lazily grant a landlord the 2-month launch trial here.
 */
async function ensureSubscription(user) {
  return Subscription.findOne({ userId: user._id });
}

/**
 * Shape returned to a caller with no subscription row. Not persisted — the
 * frontend's updateCache() maps a null/expired subscription to the free tier,
 * and this keeps that contract without a DB write.
 */
function freeSubscriptionStub(userId) {
  return {
    userId: String(userId),
    planId: 'free',
    status: 'canceled',
    trialEndsAt: null,
    trialTier: 'free',
    currentPeriodEnd: null,
    autoRenew: false,
    shareTrialClaimedAt: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/billing/plans
// ─────────────────────────────────────────────────────────────────────────────
exports.getPlans = asyncH(async (req, res) => {
  const settings = await payments.getSettings();
  res.json({ plans: await payments.getPlans(settings), methods: await payments.payMethods(settings) });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/billing/payments — multipart: planId, methodId, trxId, sender, file?
// ─────────────────────────────────────────────────────────────────────────────
exports.submitPayment = asyncH(async (req, res) => {
  const payment = await payments.submit(req.user, req.body || {}, req.file);
  const sub = await ensureSubscription(req.user);
  res.status(201).json({
    payment: payments.publicPayment(payment),
    subscription: sub ? sub.toJSON() : freeSubscriptionStub(req.user._id),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/billing/payments — the host's recent claims, newest first
// ─────────────────────────────────────────────────────────────────────────────
exports.listMyPayments = asyncH(async (req, res) => {
  const rows = await SubscriptionPayment.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(5).lean();
  res.json({ payments: rows.map(payments.publicPayment) });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/billing/payments/sms — the wallet phone's SMS forwarder
// ─────────────────────────────────────────────────────────────────────────────
// Body is the forwarder app's default JSON: { from, text, ... }. Authenticated
// by the key made in the admin console, as `Authorization: Bearer <key>`.
exports.receivePaymentSms = asyncH(async (req, res) => {
  const { smsKeyHash } = await payments.getSettings();
  if (!smsKeyHash) {
    throw new ApiError(503, 'Automatic payment check is not configured.', { code: 'sms_check_off' });
  }
  if (!payments.smsKeyMatches(smsKeyHash, req.get('authorization'))) {
    throw ApiError.unauthorized('Bad key.', { code: 'bad_sms_key' });
  }
  const { from = '', text = '' } = req.body || {};
  res.json({ result: await payments.receiveSms(String(from), String(text)) });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/host/me/subscription
// ─────────────────────────────────────────────────────────────────────────────
exports.getMySubscription = asyncH(async (req, res) => {
  const sub = await ensureSubscription(req.user);
  res.json({
    subscription: sub ? sub.toJSON() : freeSubscriptionStub(req.user._id),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/billing/cancel
// ─────────────────────────────────────────────────────────────────────────────
exports.cancel = asyncH(async (req, res) => {
  let sub = await ensureSubscription(req.user);

  if (!sub || sub.status !== 'active') {
    throw ApiError.badRequest('আপনার কোনো সক্রিয় সাবস্ক্রিপশন নেই।'); // No active subscription
  }
  
  sub.autoRenew = false;
  await sub.save();
  
  res.json({
    success: true,
    message: 'অটো-রিনিউ সফলভাবে বাতিল করা হয়েছে।', // Auto-renew cancelled successfully
    subscription: sub.toJSON()
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/billing/share-trial
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Grant the share-task Pro trial.
 *
 * The host shares the app link from the Free Pro Trial popup; the client calls
 * this once the task is done. This is the ONLY place the reward is granted —
 * the popup's local state is presentation, and the media/listing limits in
 * services/property.service.js read the Subscription row this writes.
 *
 * Rules (deliberately strict, because the reward is free Pro):
 *   • landlords only — subscriptions are a landlord concept everywhere else
 *   • once per account, ever — `shareTrialClaimedAt` is the latch
 *   • free tier only — a host already on Plus/Pro (trial or paid) has nothing
 *     to gain and would have their existing entitlement rewritten
 */
exports.claimShareTrial = asyncH(async (req, res) => {
  if (!isLandlord(req.user)) {
    throw ApiError.forbidden('শুধুমাত্র বাড়িওয়ালারা এই ট্রায়াল নিতে পারবেন।', {
      code: 'share_trial_not_landlord',
    }); // Landlords only
  }

  let sub = await ensureSubscription(req.user);

  if (sub?.shareTrialClaimedAt) {
    throw ApiError.badRequest('আপনি ইতিমধ্যে এই ফ্রি ট্রায়ালটি নিয়েছেন।', {
      code: 'share_trial_already_claimed',
    }); // Already claimed
  }

  // Anyone already entitled to Plus/Pro keeps what they have — granting here
  // would overwrite a paid period with a trial.
  if (sub && tierOf(sub) !== 'free') {
    throw ApiError.badRequest('আপনার প্ল্যান ইতিমধ্যে সক্রিয় আছে।', {
      code: 'share_trial_not_eligible',
    }); // Plan already active
  }

  const trialEndsAt = trialEndFrom();

  if (!sub) {
    sub = await Subscription.create({
      userId: req.user._id,
      planId: 'free',
      status: 'trialing',
      trialTier: 'pro',
      trialEndsAt,
      autoRenew: false,
      shareTrialClaimedAt: new Date(),
    });
  } else {
    sub.planId = 'free';
    sub.status = 'trialing';
    sub.trialTier = 'pro';
    sub.trialEndsAt = trialEndsAt;
    sub.autoRenew = false;
    sub.shareTrialClaimedAt = new Date();
    await sub.save();
  }

  // Same sync checkout does — existing listings pick up the Pro badge and the
  // top-of-search sort straight away instead of on their next edit.
  await Property.updateMany(
    { ownerUserId: req.user._id },
    { $set: { hostTier: 'pro' } },
  );

  res.json({
    success: true,
    message: `অভিনন্দন! ${TRIAL_MONTHS} মাসের ফ্রি প্রো আনলক হয়েছে।`, // Free Pro unlocked
    subscription: sub.toJSON(),
  });
});
