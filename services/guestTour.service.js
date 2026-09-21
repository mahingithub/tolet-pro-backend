'use strict';

/**
 * guestTour.service — the feature tour for people who have not signed up.
 * ──────────────────────────────────────────────────────────────────────────
 * The same four tips as services/featureTour.service.js, on the same days, but
 * addressed to an INSTALL rather than an account: one AnonDevice row, a push
 * token if we have one, and no user behind it.
 *
 * ── TWO SURFACES, BECAUSE PERMISSION IS NOT OURS TO GRANT ─────────────────
 * On Android 13+ notification permission is a runtime grant. If someone taps
 * "Don't allow" there is no API — none, at any privilege level — that lets the
 * app post a notification anyway. That is an OS guarantee, not a setting we
 * have failed to find.
 *
 * So the tour has two ways to reach a device, and which one is used is decided
 * by what that device actually permits:
 *
 *   PUSH   — the row has a token. deliverGuestStep() sends it, and the tip
 *            arrives on the lock screen like any other notification.
 *   IN-APP — the row has no token (permission declined, or never asked).
 *            Nothing is sent. Instead the tip WAITS, and the next time the app
 *            is opened on that device, GET /api/app/tips/pending hands it over
 *            and the app shows it as a card.
 *
 * The second path is the whole point of this file. A declined permission used
 * to mean the person was simply lost — we knew they had installed the app and
 * had no way to say anything to them ever again. Now it means we talk to them
 * when they are already looking at us, which is arguably the better moment
 * anyway: an in-app card cannot be swiped away unread on a lock screen.
 *
 * ── WHAT IS DELIBERATELY NOT DONE HERE ────────────────────────────────────
 * No Notification row is written. That collection requires a userId and is the
 * user's own history; a guest has neither. When the device signs in, the CLAIM
 * (see claimDevice) merges what they have already seen into their account so
 * the tour does not start over — it does not back-fill a bell they never had.
 */

const AnonDevice = require('../models/AnonDevice');
const User = require('../models/User');
const firebaseAdmin = require('./firebaseAdmin');
const { TIP_DAYS, MAX_TIP_DAY, tipFor } = require('../utils/featureTips');
const { CHANNEL } = require('./notifyPolicy');

const DAY_MS = 24 * 60 * 60 * 1000;

const MAX_PER_RUN = Number(process.env.GUEST_TOUR_MAX_PER_RUN || 400);

/** Whole days between two dates, both floored to local midnight. */
function daysSince(from, today) {
  const a = new Date(from);
  const start = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((end - start) / DAY_MS);
}

/**
 * The step this device is due for, or null.
 *
 * Same earliest-pending rule as the account tour: a device that was offline for
 * a fortnight gets its next tip, not all of them at once. Exported for tests.
 */
function pendingStep(device, today = new Date()) {
  if (!device || device.claimedBy) return null;
  const age = daysSince(device.firstSeenAt || device.createdAt, today);
  if (age < TIP_DAYS[0]) return null;

  const sent = new Set(Array.isArray(device.tourSent) ? device.tourSent : []);
  const lang = device.language === 'bn' ? 'bn' : 'en';

  for (const day of TIP_DAYS) {
    if (day > age) break;
    const tip = tipFor(day, 'guest', lang);
    if (!tip) continue;
    if (sent.has(tip.id)) continue;
    return { day, ...tip };
  }
  return null;
}

/** Record a step against a device, and only if it is still unrecorded. */
async function claimStep(deviceId, stepId) {
  const res = await AnonDevice.updateOne(
    { _id: deviceId, tourSent: { $ne: stepId } },
    { $addToSet: { tourSent: stepId } },
  ).catch(() => null);
  return !!res && res.matchedCount > 0;
}

/**
 * Push one guest tip. Never throws.
 * @returns {Promise<boolean>} true when FCM accepted it
 */
async function deliverGuestStep(device, step) {
  // Claim before sending, for the same reason the account tour does: a crash
  // mid-sweep should cost one tip, not produce a daily repeat.
  if (!(await claimStep(device._id, step.id))) return false;

  const res = await firebaseAdmin.sendToToken(device.token, {
    title: step.title,
    body: step.body,
    // The guest has no account, so there is no notificationId and nothing to
    // mark read — the tap only needs somewhere to land.
    data: { kind: 'feature_tip', step: step.id, path: step.path, url: step.path, type: 'feature_tip' },
    // Chosen here rather than by notifyPolicy, which needs a user to decide
    // about. The promos channel is the honest one: this is us advertising, and
    // it is the channel the person can mute without losing anything.
    channelId: CHANNEL.PROMOS,
    image: step.image || '',
  });

  // FCM says this token is gone — the app was uninstalled or its data cleared.
  // Blank it rather than deleting the row: the install may come back, and the
  // tourSent history is what stops it being toured a second time if it does.
  if (res.dead) {
    await AnonDevice.updateOne({ _id: device._id }, { $set: { token: '' } }).catch(() => {});
  }

  return res.sent > 0;
}

/**
 * The daily sweep — PUSH ONLY.
 *
 * Devices with no token are skipped here and left pending on purpose; they are
 * served by pendingGuestTip() when the app next opens. Sweeping them would burn
 * their step on a notification that physically cannot be displayed.
 */
async function runGuestTour(today = new Date()) {
  const stats = { scanned: 0, sent: 0, byStep: {} };

  const oldest = new Date(today.getTime() - (MAX_TIP_DAY + 7) * DAY_MS);
  const newest = new Date(today.getTime() - TIP_DAYS[0] * DAY_MS);

  const devices = await AnonDevice.find({
    claimedBy: null,
    token: { $ne: '' },
    firstSeenAt: { $gte: oldest, $lte: newest },
    $expr: { $lt: [{ $size: { $ifNull: ['$tourSent', []] } }, TIP_DAYS.length] },
  })
    .sort({ firstSeenAt: 1 })
    .limit(MAX_PER_RUN)
    .lean();

  for (const device of devices) {
    stats.scanned += 1;
    const step = pendingStep(device, today);
    if (!step) continue;

    const ok = await deliverGuestStep(device, step).catch((err) => {
      console.warn('[guest-tour] delivery failed:', err?.message);
      return false;
    });

    if (ok) {
      stats.sent += 1;
      stats.byStep[step.id] = (stats.byStep[step.id] || 0) + 1;
    }
  }

  if (stats.sent) {
    console.log(`[guest-tour] pushed ${stats.sent} tip(s) to ${stats.scanned} device(s)`);
  }
  return stats;
}

/**
 * THE IN-APP SURFACE. A tip for a device to show as a card, right now.
 *
 * Called on app open by GET /api/app/tips/pending. Returns null far more often
 * than not — which is correct: this fires on every launch, and most launches
 * are not a tour day.
 *
 * `markSent` defaults to true because the caller displays what it receives. A
 * tip handed over and not shown is a tip lost, so the endpoint and the card
 * have to be the same action; splitting them into "fetch" and "acknowledge"
 * would just add a round trip in which the app can be closed.
 */
async function pendingGuestTip(deviceId, { today = new Date(), markSent = true } = {}) {
  if (!deviceId) return null;

  const device = await AnonDevice.findOne({ deviceId: String(deviceId) }).lean().catch(() => null);
  if (!device) return null;

  const step = pendingStep(device, today);
  if (!step) return null;

  if (markSent && !(await claimStep(device._id, step.id))) return null;

  return { step: step.id, title: step.title, body: step.body, path: step.path, image: step.image };
}

/**
 * This install just signed in — hand the tour over to the account.
 *
 * Merges the device's delivered steps into the user's own `featureTourSent`, so
 * somebody who saw two tips as a guest continues at three rather than starting
 * again. Idempotent, and safe to call on every app open.
 *
 * Never throws: a failed claim must not break a login.
 */
async function claimDevice(deviceId, userId) {
  if (!deviceId || !userId) return false;
  try {
    const device = await AnonDevice.findOne({ deviceId: String(deviceId) }).lean();
    if (!device || String(device.claimedBy || '') === String(userId)) return false;

    if (Array.isArray(device.tourSent) && device.tourSent.length) {
      // $addToSet with $each merges without duplicating anything the account
      // already had — which matters when a person installs on a second phone
      // after finishing the tour on the first.
      await User.updateOne(
        { _id: userId },
        { $addToSet: { featureTourSent: { $each: device.tourSent } } },
      );
    }

    await AnonDevice.updateOne(
      { _id: device._id },
      { $set: { claimedBy: userId, claimedAt: new Date() } },
    );
    return true;
  } catch (err) {
    console.warn('[guest-tour] claim failed:', err?.message);
    return false;
  }
}

module.exports = {
  runGuestTour,
  pendingGuestTip,
  claimDevice,
  pendingStep,
  daysSince,
  MAX_PER_RUN,
};
