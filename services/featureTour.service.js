'use strict';

/**
 * featureTour.service — the new-account feature tour.
 * ──────────────────────────────────────────────────────────────────────────
 * Daily sweep. For every account whose signup was 1, 3, 7 or 14 days ago, send
 * that day's tip: one feature, one sentence, one tap to the screen it lives on.
 * Four in total, then the account is finished with the tour forever.
 *
 * The content — and the reasoning about what makes this onboarding rather than
 * spam — lives in utils/featureTips.js. This file is the delivery mechanics.
 *
 * WHAT THIS SWEEP GUARANTEES
 *
 *   ONCE PER STEP, EVER. `user.featureTourSent` holds the ids already sent, and
 *   the update that records a step is CONDITIONAL on it still being absent
 *   ($ne in the filter). Two overlapping runs — a retry, a second dyno, a
 *   manual invocation during an incident — cannot both win that update, so the
 *   notification goes out at most once even though nothing here is
 *   transactional. The write happens BEFORE the send for the same reason: if
 *   the process dies mid-sweep, the failure mode is one person missing one tip,
 *   not one person getting it every day until someone notices.
 *
 *   A MISSED DAY IS FORGIVEN, NOT REPLAYED. The window for "day 3" is anyone
 *   aged 3 or more days who has not had that tip and whose LATER tips are also
 *   still pending. So an account that signed up while the cron was down still
 *   gets its day-3 tip on day 5 — but an account that is now 40 days old does
 *   not suddenly receive all four at once, because only the earliest pending
 *   step is sent per run. One tip per person per day, always.
 *
 *   ROLE-CORRECT DESTINATIONS. The role comes from `roles[]`, not the
 *   single-valued `role` (which is just whichever mode the UI is in today).
 *   Someone who is both is treated as a landlord for the tour: it is the role
 *   with more to learn, and sending both variants would be two notifications on
 *   the same day about the same feature.
 *
 *   BANNED AND MUTED ACCOUNTS. Banned users are excluded from the query. Muted
 *   users are NOT — notifyPolicy decides whether the push is allowed to make a
 *   noise, and the in-app row is written either way. That split is deliberate
 *   and is the same one every other notification in this app makes: muting
 *   governs interruption, not information.
 */

const User = require('../models/User');
const notifications = require('./notification.service');
const { TIP_DAYS, MAX_TIP_DAY, tipFor } = require('../utils/featureTips');

const DAY_MS = 24 * 60 * 60 * 1000;

// How many accounts one run will touch. The tour reaches every new signup, and
// a launch spike (or a backfill after downtime) should not turn a daily cron
// into a several-thousand-push burst that trips FCM's rate limits and stalls
// the worker. The remainder is picked up by tomorrow's run, one day later than
// ideal — which for an onboarding tip costs nothing.
const MAX_PER_RUN = Number(process.env.FEATURE_TOUR_MAX_PER_RUN || 400);

/** Whole days between two dates, both floored to local midnight. */
function daysSince(createdAt, today) {
  const a = new Date(createdAt);
  const from = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const to = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((to - from) / DAY_MS);
}

/**
 * Which role's copy this account should get.
 * Landlord wins when the account is both — see the header.
 */
function roleFor(user) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  if (roles.includes('landlord')) return 'landlord';
  if (roles.includes('tenant')) return 'tenant';
  // An account with neither (an admin, or a document written before roles[]
  // existed) is not somebody this tour has anything to say to.
  return null;
}

/**
 * The step this account is due for right now, or null.
 *
 * Returns the EARLIEST pending step whose day has passed — not the one matching
 * today exactly. That is what makes a missed day catch up instead of being lost,
 * while still sending only one tip per run. Exported for tests.
 */
function pendingStep(user, today = new Date()) {
  if (!user?.createdAt) return null;
  const age = daysSince(user.createdAt, today);
  if (age < TIP_DAYS[0]) return null;

  const sent = new Set(Array.isArray(user.featureTourSent) ? user.featureTourSent : []);
  const role = roleFor(user);
  if (!role) return null;

  const lang = user?.preferences?.language === 'bn' ? 'bn' : 'en';

  for (const day of TIP_DAYS) {
    if (day > age) break;               // not due yet, and neither is anything after it
    const tip = tipFor(day, role, lang);
    // No variant for this role — mark nothing, just move on. Skipping rather
    // than substituting is what keeps a landlord-only page away from a tenant.
    if (!tip) continue;
    if (sent.has(tip.id)) continue;     // already had it
    return { day, ...tip };
  }
  return null;
}

/**
 * Send one tip to one user. Never throws.
 * @returns {Promise<boolean>} true when a notification was actually created
 */
async function deliverStep(user, step) {
  // CLAIM FIRST. The $ne guard makes this the concurrency gate: whichever run
  // updates the document first is the one that sends, and a second run reading
  // the same user a moment earlier finds matchedCount 0 and stops. See the
  // header for why a lost tip is a better failure than a repeated one.
  const claim = await User.updateOne(
    { _id: user._id, featureTourSent: { $ne: step.id } },
    { $addToSet: { featureTourSent: step.id } },
  ).catch(() => null);

  if (!claim || claim.matchedCount === 0) return false;

  const doc = await notifications.emit({
    userId: user._id,
    type: 'feature_tip',
    title: step.title,
    body: step.body,
    // `path` is what NotificationPanel and notificationDestination() read; `url`
    // is what the service worker reads off the push envelope. Both, for the same
    // reason marketing.service sends both — the two transports look in
    // different places.
    data: { kind: 'feature_tip', step: step.id, path: step.path, url: step.path },
    // Replaces yesterday's tip rather than stacking beside it. Someone who has
    // not opened the app in a fortnight should find ONE tip waiting, the newest,
    // not a column of four.
    collapseKey: 'feature_tip',
    // null when FEATURE_TIP_IMAGE_BASE is unset, or when this tip is a
    // text-only one — both are normal, and emit() treats a falsy image as "no
    // picture" rather than an error.
    image: step.image || '',
  });

  return !!doc;
}

/**
 * Run the sweep.
 * @param {Date} today  injectable for tests
 * @returns {Promise<{scanned:number, sent:number, byStep:Object}>}
 */
async function runFeatureTour(today = new Date()) {
  const stats = { scanned: 0, sent: 0, byStep: {} };

  // Only accounts old enough for the first tip, and young enough that the last
  // one has not long passed. The upper bound has a week of slack so a backlog
  // from downtime still drains instead of ageing out of the window silently.
  const oldest = new Date(today.getTime() - (MAX_TIP_DAY + 7) * DAY_MS);
  const newest = new Date(today.getTime() - TIP_DAYS[0] * DAY_MS);

  const candidates = await User.find({
    createdAt: { $gte: oldest, $lte: newest },
    isBanned: { $ne: true },
    // Anyone who has already finished the tour is excluded in the QUERY rather
    // than filtered in the loop, so a growing user base does not turn this into
    // a full scan of every account from the last three weeks.
    $expr: { $lt: [{ $size: { $ifNull: ['$featureTourSent', []] } }, TIP_DAYS.length] },
  })
    .select('_id roles featureTourSent createdAt preferences')
    .sort({ createdAt: 1 })   // oldest signups first — they are furthest behind
    .limit(MAX_PER_RUN)
    .lean();

  for (const user of candidates) {
    stats.scanned += 1;
    const step = pendingStep(user, today);
    if (!step) continue;

    // One failure must never end the sweep — the next user's tip is unrelated
    // to this one's gateway trouble.
    const ok = await deliverStep(user, step).catch((err) => {
      console.warn('[feature-tour] delivery failed:', err?.message);
      return false;
    });

    if (ok) {
      stats.sent += 1;
      stats.byStep[step.id] = (stats.byStep[step.id] || 0) + 1;
    }
  }

  if (stats.sent) {
    console.log(`[feature-tour] sent ${stats.sent} tip(s) across ${stats.scanned} candidate(s)`);
  }
  return stats;
}

module.exports = { runFeatureTour, pendingStep, roleFor, daysSince, MAX_PER_RUN };
