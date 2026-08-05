'use strict';

/**
 * Billing Controller
 * ──────────────────────────────────────────────────────────────────────────
 * Handles subscription state for hosts. We simulate a local payment gateway
 * like bKash or SSLCommerz by immediately activating the subscription upon checkout.
 */

const Subscription = require('../models/Subscription');
const Property = require('../models/Property');
const ApiError = require('../utils/ApiError');
const { grantLandlordTrial } = require('../services/subscription.service');
const { trialEndFrom } = require('../utils/subscriptionTier');

// Simulated plans — MUST mirror the frontend catalogue in
// tolet-pro-frontend/src/services/subscriptionService.js (ids AND prices),
// otherwise checkout rejects the plan the UI just offered.
const PLANS = [
  { id: 'plus_monthly', name: 'Plus Monthly', price: 19,  currency: 'BDT', interval: 'month', tier: 'plus' },
  { id: 'plus_yearly',  name: 'Plus Yearly',  price: 229, currency: 'BDT', interval: 'year',  tier: 'plus' },
  { id: 'pro_monthly',  name: 'Pro Monthly',  price: 49,  currency: 'BDT', interval: 'month', tier: 'pro' },
  { id: 'pro_yearly',   name: 'Pro Yearly',   price: 599, currency: 'BDT', interval: 'year',  tier: 'pro' },
];

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/** Does this user hold the landlord role? Mirrors landlord.controller.js. */
function isLandlord(user) {
  if (!user) return false;
  return Array.isArray(user.roles)
    ? user.roles.includes('landlord')
    : user.role === 'landlord';
}

/**
 * Fetch the caller's subscription, provisioning the launch trial if they are a
 * landlord who somehow never got one (accounts that predate the grant hooks in
 * services/subscription.service.js).
 *
 * Tenants deliberately get NOTHING persisted — subscriptions are a landlord
 * concept, and creating a row here used to burn a tenant's 2-month trial the
 * first time they so much as loaded a page that read billing state.
 */
async function ensureSubscription(user) {
  const sub = await Subscription.findOne({ userId: user._id });
  if (sub) return sub;
  if (!isLandlord(user)) return null;
  return grantLandlordTrial(user._id);
}

/**
 * Shape returned to a caller with no subscription row (a tenant). Not persisted
 * — the frontend's updateCache() maps a null/expired subscription to the free
 * tier, and this keeps that contract without a DB write.
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
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/billing/plans
// ─────────────────────────────────────────────────────────────────────────────
exports.getPlans = (req, res) => {
  res.json({ plans: PLANS });
};

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
// POST /api/billing/checkout
// ─────────────────────────────────────────────────────────────────────────────
exports.checkout = asyncH(async (req, res) => {
  const { planId, paymentMethod } = req.body;
  const plan = PLANS.find(p => p.id === planId);
  
  if (!plan) {
    throw ApiError.badRequest('অবাস্তব প্ল্যান আইডি।'); // Invalid plan ID
  }
  
  // Checkout provisions the row if it's missing — a landlord may be paying
  // straight away without ever having held a trial.
  let sub = await ensureSubscription(req.user);
  if (!sub) {
    sub = await Subscription.create({
      userId: req.user._id,
      planId: 'free',
      status: 'trialing',
      trialTier: 'free',
      trialEndsAt: trialEndFrom(),
      autoRenew: false,
    });
  }

  // Simulate payment success and update subscription
  const currentPeriodEnd = new Date();
  if (plan.interval === 'month') {
    currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
  } else if (plan.interval === 'year') {
    currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 1);
  }
  
  sub.planId = planId;
  sub.status = 'active';
  sub.currentPeriodEnd = currentPeriodEnd;
  sub.autoRenew = true;
  sub.lastPaymentMethod = paymentMethod || 'bKash';
  sub.lastTransactionId = 'TXN-' + Math.random().toString(36).substring(2, 10).toUpperCase();
  
  await sub.save();
  
  // Sync tier to all listings owned by this host for immediate badge/sort updates
  await Property.updateMany(
    { ownerUserId: req.user._id },
    { $set: { hostTier: plan.tier || 'free' } }
  );

  res.json({ 
    success: true, 
    message: 'পেমেন্ট সফল হয়েছে!', // Payment successful!
    subscription: sub.toJSON() 
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
