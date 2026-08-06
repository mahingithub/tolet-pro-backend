'use strict';

/**
 * subscription.service — tier lookup.
 * ──────────────────────────────────────────────────────────────────────────
 * There is NO automatic trial. Every account — landlord or tenant — starts on
 * the free plan, which is represented by the absence of a Subscription row
 * (`tierOf(null) === 'free'`, see utils/subscriptionTier.js).
 *
 * The only way to obtain a Pro trial is to complete the share task:
 * POST /api/billing/share-trial → controllers/billing.controller.js. That
 * handler is deliberately the sole writer of a trialing row, so the reward
 * stays one-per-account (latched by `shareTrialClaimedAt`) and can't be farmed
 * by toggling roles.
 *
 * This previously granted 2 months of Pro at signup / on landlord approval /
 * on self-serve role add. Those hooks are gone; a row now appears only on
 * checkout or a share-trial claim.
 */

const Subscription = require('../models/Subscription');
const { tierOf } = require('../utils/subscriptionTier');

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

module.exports = { tiersForUsers };
