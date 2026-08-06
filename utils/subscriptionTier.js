'use strict';

/**
 * subscriptionTier — the single source of truth for "what tier is this host on,
 * and what are they allowed to do?"
 * ──────────────────────────────────────────────────────────────────────────
 * This used to be answered in three different places with three different
 * rules (property.service checked `active || trialing` and ignored expiry,
 * property.controller checked `active` only, the frontend mapped any trial to
 * 'pro'), so a landlord could legitimately be Pro in one code path and free in
 * the next. Everything now goes through `tierOf()`.
 *
 * Limits mirror tolet-pro-frontend/src/services/subscriptionService.js →
 * TIER_LIMITS. The frontend copy is the UX guard (disable the button early);
 * this copy is the one that actually enforces, because the API must not trust
 * the browser.
 */

// Length and tier of the share-task reward trial: a host who shares the app
// link (POST /api/billing/share-trial) gets 2 months of full Pro. This is the
// ONLY trial in the system — signing up as a landlord grants nothing.
const TRIAL_TIER = 'pro';
const TRIAL_MONTHS = 2;

const TIER_LIMITS = {
  free: { maxProperties: 1, maxPhotos: 5, maxVideos: 0 },
  plus: { maxProperties: 3, maxPhotos: 15, maxVideos: 1 },
  // "Unlimited listings" is real; media is capped per the plan spec.
  pro: { maxProperties: Infinity, maxPhotos: 50, maxVideos: 5 },
};

const TIER_ORDER = { free: 0, plus: 1, pro: 2 };

/** 'pro_yearly' → 'pro', 'plus_monthly' → 'plus', anything else → 'free'. */
function planTier(planId) {
  const id = String(planId || '');
  if (id.startsWith('pro')) return 'pro';
  if (id.startsWith('plus')) return 'plus';
  return 'free';
}

/**
 * Resolve a Subscription document to the tier it currently entitles.
 * Both paid and trial states are expiry-checked, so a lapsed subscription
 * degrades to 'free' the moment it lapses — no cron sweep required.
 *
 * @param {object|null} sub  a Subscription doc (or .lean() object)
 * @param {Date} [now]
 * @returns {'free'|'plus'|'pro'}
 */
function tierOf(sub, now = new Date()) {
  if (!sub) return 'free';

  if (sub.status === 'active') {
    // A missing currentPeriodEnd means the period was never stamped; treat the
    // subscription as live rather than silently downgrading a paying customer.
    if (!sub.currentPeriodEnd || new Date(sub.currentPeriodEnd) > now) {
      return planTier(sub.planId);
    }
    return 'free';
  }

  if (sub.status === 'trialing') {
    if (sub.trialEndsAt && new Date(sub.trialEndsAt) > now) {
      return sub.trialTier || TRIAL_TIER;
    }
    return 'free';
  }

  // past_due / canceled — canceled still runs to the end of the paid period,
  // which the 'active' branch above already covers while it lasts.
  return 'free';
}

/** Limits for a tier name; unknown tiers fall back to the free plan. */
function limitsFor(tier) {
  return TIER_LIMITS[tier] || TIER_LIMITS.free;
}

/** True when `tier` is at least `min` ('plus' satisfies a 'plus' minimum). */
function tierAtLeast(tier, min) {
  return (TIER_ORDER[tier] ?? 0) >= (TIER_ORDER[min] ?? 0);
}

/** The trial end date for a trial starting now. */
function trialEndFrom(start = new Date()) {
  const end = new Date(start);
  end.setMonth(end.getMonth() + TRIAL_MONTHS);
  return end;
}

module.exports = {
  TRIAL_TIER,
  TRIAL_MONTHS,
  TIER_LIMITS,
  planTier,
  tierOf,
  limitsFor,
  tierAtLeast,
  trialEndFrom,
};
