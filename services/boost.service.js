'use strict';

/**
 * boost.service — the Plus plan's "1× Top Search Boost / month".
 * ──────────────────────────────────────────────────────────────────────────
 * Spending a credit pins one listing to the top of the search feed for 24h.
 *
 * Who gets what:
 *   free → no credits, no boosting (upsell)
 *   plus → 1 credit per calendar month
 *   pro  → no credits needed; Pro listings already outrank Plus and free via
 *          the hostTier sort ("Super Boost & Top Position"), so the endpoint
 *          returns a no-op success rather than burning a credit that would
 *          buy them nothing.
 *
 * Credits reset (not accumulate) on the 1st of each month — see
 * resetMonthlyBoostCredits(), scheduled from services/cron.service.js.
 */

const BoostCredit = require('../models/BoostCredit');
const Property = require('../models/Property');
const Subscription = require('../models/Subscription');
const ApiError = require('../utils/ApiError');
const { tierOf } = require('../utils/subscriptionTier');

// Monthly allowance per tier. Pro is 0 by design (see header).
const MONTHLY_CREDITS = { free: 0, plus: 1, pro: 0 };

const BOOST_DURATION_MS = 24 * 60 * 60 * 1000;

const monthKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/**
 * Read a host's credit row, refilling it on the fly if the monthly reset
 * hasn't run for the current month yet.
 *
 * The lazy refill matters: the cron only fires while the server is awake, and
 * on a sleeping free-tier instance the 1st-of-month tick is easily missed. A
 * host opening their dashboard mid-month would otherwise see 0 credits until
 * the following month. Idempotent via `lastResetMonth`.
 */
async function getOrCreateCredits(userId, tier, now = new Date()) {
  const allowance = MONTHLY_CREDITS[tier] ?? 0;
  const thisMonth = monthKey(now);

  let row = await BoostCredit.findOne({ userId });

  if (!row) {
    try {
      row = await BoostCredit.create({
        userId,
        creditsRemaining: allowance,
        lastResetDate: now,
        lastResetMonth: thisMonth,
      });
    } catch (err) {
      // userId is unique — a concurrent create loses; read the winner.
      if (err && err.code === 11000) row = await BoostCredit.findOne({ userId });
      else throw err;
    }
    return row;
  }

  if (row.lastResetMonth !== thisMonth) {
    row.creditsRemaining = allowance;
    row.lastResetDate = now;
    row.lastResetMonth = thisMonth;
    await row.save();
  }

  return row;
}

/** Public read model for the dashboard's Boost button. */
async function getBoostStatus(userId, now = new Date()) {
  const sub = await Subscription.findOne({ userId });
  const tier = tierOf(sub, now);
  const allowance = MONTHLY_CREDITS[tier] ?? 0;

  // Free hosts never get a row — nothing to refill, nothing to show.
  if (allowance === 0) {
    return {
      tier,
      creditsRemaining: 0,
      monthlyAllowance: 0,
      // Pro doesn't need to boost; free can't.
      canBoost: false,
      reason: tier === 'pro' ? 'pro_always_top' : 'upgrade_required',
    };
  }

  const row = await getOrCreateCredits(userId, tier, now);
  return {
    tier,
    creditsRemaining: row.creditsRemaining,
    monthlyAllowance: allowance,
    canBoost: row.creditsRemaining > 0,
    reason: row.creditsRemaining > 0 ? null : 'no_credits',
    lastResetDate: row.lastResetDate,
  };
}

/**
 * Spend one credit to boost `propertyId` for 24 hours.
 * Throws ApiError on every rejection path so the controller stays thin.
 */
async function boostProperty({ propertyId, user, now = new Date() }) {
  const property = await Property.findById(propertyId);
  if (!property) {
    throw ApiError.notFound('প্রপার্টি পাওয়া যায়নি।', { code: 'property_not_found' });
  }
  if (String(property.ownerUserId) !== String(user._id)) {
    throw ApiError.forbidden('শুধুমাত্র মালিকই এই প্রপার্টি বুস্ট করতে পারবেন।', {
      code: 'not_owner',
    });
  }

  const sub = await Subscription.findOne({ userId: user._id });
  const tier = tierOf(sub, now);

  if (tier === 'free') {
    throw ApiError.forbidden(
      'সার্চ বুস্ট ব্যবহার করতে প্লাস বা প্রো প্ল্যানে আপগ্রেড করুন।',
      { code: 'boost_upgrade_required', details: { tier } },
    );
  }

  // Pro already sits at the top of the feed — spending a credit would buy
  // nothing, so treat it as an idempotent success instead of an error.
  if (tier === 'pro') {
    return {
      boosted: true,
      alreadyTop: true,
      creditsRemaining: 0,
      boostedUntil: property.boostedUntil,
      message: 'প্রো লিস্টিং সবসময়ই সার্চে সবার উপরে থাকে।',
    };
  }

  // Already boosted and still live — don't burn a second credit.
  if (property.boostedUntil && property.boostedUntil > now) {
    const status = await getBoostStatus(user._id, now);
    return {
      boosted: true,
      alreadyBoosted: true,
      creditsRemaining: status.creditsRemaining,
      boostedUntil: property.boostedUntil,
      message: 'এই প্রপার্টি এখনো বুস্ট করা আছে।',
    };
  }

  const credits = await getOrCreateCredits(user._id, tier, now);
  if (credits.creditsRemaining <= 0) {
    throw ApiError.forbidden(
      'এই মাসের বুস্ট শেষ হয়ে গেছে। পরের মাসে আবার পাবেন, অথবা প্রো প্ল্যানে আপগ্রেড করুন।',
      { code: 'boost_no_credits', details: { tier, creditsRemaining: 0 } },
    );
  }

  // Deduct atomically and only proceed if THIS request won the decrement, so
  // two concurrent taps can't spend the same credit twice.
  const claimed = await BoostCredit.findOneAndUpdate(
    { userId: user._id, creditsRemaining: { $gt: 0 } },
    {
      $inc: { creditsRemaining: -1, totalSpent: 1 },
      $set: { lastSpentAt: now },
    },
    { new: true },
  );
  if (!claimed) {
    throw ApiError.forbidden('এই মাসের বুস্ট শেষ হয়ে গেছে।', { code: 'boost_no_credits' });
  }

  property.boosted = true;
  property.boostedUntil = new Date(now.getTime() + BOOST_DURATION_MS);
  await property.save();

  // A boost is a PAID perk whose entire value is appearing at the top of
  // search, so the host must see it take effect on their next page load rather
  // than up to 2 minutes later. Search ranking sorts on activeBoost, so every
  // cached page is now mis-ordered.
  //
  // Note the asymmetry: boosts START with a write (invalidated here) but EXPIRE
  // with no write at all — activeBoost is recomputed per request from
  // boostedUntil. Nothing can invalidate on expiry, which is why the search TTL
  // is kept short enough to retire a finished boost on its own.
  await require('./cacheInvalidation').onPropertyChanged({
    id: String(property._id),
    slug: property.slug,
  });

  return {
    boosted: true,
    creditsRemaining: claimed.creditsRemaining,
    boostedUntil: property.boostedUntil,
    message: 'আপনার প্রপার্টি ২৪ ঘণ্টার জন্য সার্চের উপরে থাকবে।',
  };
}

/**
 * Monthly refill for every host currently entitled to credits.
 * Scheduled on the 1st @ 00:05 (Asia/Dhaka) by cron.service.
 *
 * Idempotent: rows already stamped with the current month are skipped, so a
 * restart or a manual re-run never grants a second allowance.
 */
async function resetMonthlyBoostCredits(now = new Date()) {
  const thisMonth = monthKey(now);

  // Only tiers with a non-zero allowance need rows.
  const eligibleTiers = Object.keys(MONTHLY_CREDITS).filter((t) => MONTHLY_CREDITS[t] > 0);

  const subs = await Subscription.find({
    $or: [
      { status: 'active' },
      { status: 'trialing', trialEndsAt: { $gt: now } },
    ],
  }).select('userId planId status trialTier trialEndsAt currentPeriodEnd').lean();

  let updated = 0;
  for (const sub of subs) {
    const tier = tierOf(sub, now);
    if (!eligibleTiers.includes(tier)) continue;

    const res = await BoostCredit.updateOne(
      { userId: sub.userId, lastResetMonth: { $ne: thisMonth } },
      {
        $set: {
          creditsRemaining: MONTHLY_CREDITS[tier],
          lastResetDate: now,
          lastResetMonth: thisMonth,
        },
        $setOnInsert: { userId: sub.userId, totalSpent: 0 },
      },
      { upsert: true },
    ).catch((err) => {
      // Upsert can collide with a lazy getOrCreateCredits() running at the same
      // moment; the row exists either way, so this is safe to ignore.
      if (err && err.code === 11000) return { modifiedCount: 0, upsertedCount: 0 };
      throw err;
    });

    if (res.modifiedCount || res.upsertedCount) updated += 1;
  }

  if (updated) console.log(`[boost-reset] refilled ${updated} host(s) for ${thisMonth}`);
  return updated;
}

module.exports = {
  boostProperty,
  getBoostStatus,
  getOrCreateCredits,
  resetMonthlyBoostCredits,
  MONTHLY_CREDITS,
  BOOST_DURATION_MS,
};
