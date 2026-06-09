'use strict';

/**
 * Billing Controller
 * ──────────────────────────────────────────────────────────────────────────
 * Handles subscription state for hosts. We simulate a local payment gateway
 * like bKash or SSLCommerz by immediately activating the subscription upon checkout.
 */

const Subscription = require('../models/Subscription');
const ApiError = require('../utils/ApiError');

// Simulated plans
const PLANS = [
  { id: 'pro_monthly', name: 'Pro Monthly', price: 999, currency: 'BDT', interval: 'month' },
  { id: 'pro_yearly', name: 'Pro Yearly', price: 9999, currency: 'BDT', interval: 'year' }
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
