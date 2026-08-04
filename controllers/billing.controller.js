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

/**
 * Helper to ensure a subscription exists for a host.
 * New hosts automatically get a 3-month trial.
 */
async function ensureSubscription(userId) {
  let sub = await Subscription.findOne({ userId });
  if (!sub) {
    const trialEndsAt = new Date();
    trialEndsAt.setMonth(trialEndsAt.getMonth() + 3);
    
    sub = await Subscription.create({
      userId,
      planId: 'free',
      status: 'trialing',
      trialEndsAt,
      autoRenew: false
    });
  }
  return sub;
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
  const sub = await ensureSubscription(req.user._id);
  res.json({ subscription: sub.toJSON() });
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
  
  let sub = await ensureSubscription(req.user._id);
  
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
  let sub = await ensureSubscription(req.user._id);
  
  if (sub.status !== 'active') {
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
