'use strict';

/**
 * subscription.service — trial provisioning.
 * ──────────────────────────────────────────────────────────────────────────
 * Every landlord gets 2 months of full Pro, free. The clock starts when they
 * actually BECOME a landlord, which is one of three moments:
 *
 *   1. signing up with role 'landlord'          → services/auth.service.js
 *   2. an admin approving their verification    → controllers/admin.controller.js
 *   3. self-serve role add after that approval  → controllers/auth.controller.additions.js
 *
 * It used to be granted lazily the first time anyone opened the subscription
 * page, which meant the clock started at an arbitrary moment (and tenants got
 * trials they could never use).
 */

const Subscription = require('../models/Subscription');
const { TRIAL_TIER, trialEndFrom, tierOf } = require('../utils/subscriptionTier');

/**
 * Give `userId` the landlord launch trial, once.
 *
 * Idempotent: if the user already has ANY subscription row — an in-flight
 * trial, a paid plan, or a lapsed one — it is returned untouched. Re-granting
 * would hand a lapsed landlord a fresh 2 months every time they toggled roles.
 *
 * @param {import('mongoose').Types.ObjectId|string} userId
 * @returns {Promise<object|null>} the subscription, or null if it couldn't be created
 */
async function grantLandlordTrial(userId) {
  if (!userId) return null;

  const existing = await Subscription.findOne({ userId });
  if (existing) return existing;

  try {
    return await Subscription.create({
      userId,
      planId: 'free',
      status: 'trialing',
      trialTier: TRIAL_TIER,
      trialEndsAt: trialEndFrom(),
      autoRenew: false,
    });
  } catch (err) {
    // `userId` is unique — a concurrent grant (e.g. signup racing a first page
    // load) loses the insert. Return whatever the winner wrote.
    if (err && err.code === 11000) return Subscription.findOne({ userId });
    throw err;
  }
}

/**
 * Fire-and-forget wrapper for call sites where the trial is a side effect and
 * must never fail the surrounding request (signup, admin approval, role add).
 */
function grantLandlordTrialQuietly(userId) {
  grantLandlordTrial(userId).catch((e) =>
    console.warn('[subscription] trial grant failed for', String(userId), '—', e.message),
  );
}

/**
 * Batch-resolve the current tier for many users in ONE query.
 *
 * Built for the reminder sweeps, which iterate hundreds of bookings/inquiries
 * and must not issue a subscription lookup per row.
 *
 * @param {Array<string|object>} userIds
 * @returns {Promise<Map<string,'free'|'plus'|'pro'>>} keyed by String(userId);
 *          users with no subscription are absent — read with `?? 'free'`.
 */
async function tiersForUsers(userIds) {
  const out = new Map();
  const ids = [...new Set((userIds || []).filter(Boolean).map(String))];
  if (!ids.length) return out;

  const now = new Date();
  const subs = await Subscription.find({ userId: { $in: ids } })
    .select('userId planId status trialTier trialEndsAt currentPeriodEnd')
    .lean();

  for (const s of subs) out.set(String(s.userId), tierOf(s, now));
  return out;
}

module.exports = { grantLandlordTrial, grantLandlordTrialQuietly, tiersForUsers };
