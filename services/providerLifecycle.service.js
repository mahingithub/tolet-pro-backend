'use strict';

/**
 * providerLifecycle.service — the sweeps that replace the human broker.
 * ─────────────────────────────────────────────────────────────────────────────
 * Admin verifies a provider once, confirms a fee once, and then leaves. That is
 * what lets the marketplace grow past the size of the support team, and it
 * means nothing after that moment is watched by a person. These five sweeps are
 * what watch it instead:
 *
 *   1. expireStaleRequests   an order nobody answered is closed, and the tenant
 *                            is told — instead of them waiting all evening on a
 *                            shop that never looked at their phone.
 *   2. autoSuspend           a provider who keeps not turning up stops being
 *                            listed. With no admin in the transaction path,
 *                            behaviour is the only thing that can enforce
 *                            quality.
 *   3. expireRegistrations   a lapsed registration drops out of search. This is
 *                            what stops the directory becoming a graveyard of
 *                            disconnected phone numbers.
 *   4. warnExpiringSoon      …with notice first, because the point is renewal,
 *                            not eviction.
 *   5. nudgeStalePrices      a price list nobody has touched in twice its
 *                            category's window is a lie the tenant is reading.
 *
 * ─── EVERY SWEEP IS IDEMPOTENT AND CLAIMS BEFORE IT ACTS ─────────────────────
 * These run on a timer, on a host that can be restarted mid-run, and Render's
 * free tier will happily sleep through a scheduled minute and fire two runs
 * close together afterwards. So no sweep may send a second message or count a
 * second strike for the same event: each one either claims its row with a
 * conditional update, or stamps a `lifecycle.*At` marker it then filters on.
 */

const Provider = require('../models/Provider');
const ServiceRequest = require('../models/ServiceRequest');
const notify = require('./serviceRequestNotify.service');
const { freshnessState } = require('../config/serviceCategories');

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── Auto-suspension thresholds ──────────────────────────────────────────────
// Deliberately far apart, and deliberately NOT applied to declines.
//
// Declining honestly is good behaviour — a shop that is out of stock and says
// so is doing the right thing, and suspending it would teach every provider to
// accept everything and cancel later, which is strictly worse for the tenant.
// So `declineCount` is tracked and never punished, and only these two bite:
//
//   NO_SHOW  he never answered at all. The cheapest failure to commit and the
//            most expensive to receive, so the bar is lowest.
//   CANCEL   he said yes and then did not turn up. Worse than a decline, but
//            it does at least involve having answered.
const NO_SHOW_LIMIT = 5;
const CANCEL_LIMIT = 8;

// How much notice before a registration lapses. Two nudges, not five: a
// shopkeeper who ignores both is not going to renew on the sixth.
const EXPIRY_WARN_DAYS = [30, 7];

// Don't nudge about prices more than once a fortnight, whatever the category's
// own freshness window says. A weekly grocery clock would otherwise produce a
// weekly message, and a weekly message is how a number gets blocked.
const PRICE_NUDGE_COOLDOWN_DAYS = 14;

const APP = 'TO-LET PRO';

/** Every sweep returns this shape so the cron log reads the same way. */
const result = (swept, acted, extra = {}) => ({ swept, acted, ...extra });

// ═════════════════════════════════════════════════════════════════════════════
// 1. Orders nobody answered
// ═════════════════════════════════════════════════════════════════════════════

// Asserted at load rather than trusted: the claim below writes `status`
// directly (see the note on it), so if the state machine ever stops allowing
// placed → expired, this file must fail loudly instead of quietly writing an
// illegal state.
if (!ServiceRequest.canTransition('placed', 'expired')) {
  throw new Error('providerLifecycle: placed → expired is no longer a legal transition');
}

/**
 * Close every request whose response window ran out.
 *
 * ── Why this one writes `status` directly ────────────────────────────────────
 * Everywhere else in this system a transition goes through
 * `ServiceRequest.transition()`, and that rule is worth keeping. Here it cannot
 * be: two overlapping cron runs both loading the same `placed` document would
 * both call transition(), both save, and the tenant would be told twice while
 * the provider took two no-show strikes for one silence. The conditional update
 * is the claim — only one caller can match `status: 'placed'` — and the
 * legality of the move it performs is asserted above, at load.
 */
async function expireStaleRequests(now = new Date()) {
  const due = await ServiceRequest.find({ status: 'placed', respondBy: { $lt: now } })
    .select('_id')
    .limit(500);

  let acted = 0;
  for (const { _id } of due) {
    const doc = await ServiceRequest.findOneAndUpdate(
      { _id, status: 'placed' },      // ← the claim
      {
        $set: { status: 'expired', closedAt: now },
        $push: {
          timeline: {
            status: 'expired',
            at: now,
            byRole: 'system',
            reason: 'কেউ সময়মতো উত্তর দেননি',
          },
        },
      },
      { new: true },
    );
    if (!doc) continue;   // another run got there first

    acted += 1;
    // Silence counts against him; an honest decline never does.
    await Provider.updateOne({ _id: doc.providerId }, { $inc: { noShowCount: 1 } });
    await notify.tenantStatusChanged(doc).catch(() => null);
  }

  if (acted) console.log(`[lifecycle] expired ${acted} unanswered requests`);
  return result(due.length, acted);
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. Providers who keep not turning up
// ═════════════════════════════════════════════════════════════════════════════

async function autoSuspend(now = new Date()) {
  const candidates = await Provider.find({
    status: 'active',
    $or: [
      { noShowCount: { $gte: NO_SHOW_LIMIT } },
      { cancelCount: { $gte: CANCEL_LIMIT } },
    ],
  }).limit(200);

  let acted = 0;
  for (const p of candidates) {
    const reason = p.noShowCount >= NO_SHOW_LIMIT
      ? `${p.noShowCount} বার অর্ডারের উত্তর দেননি — স্বয়ংক্রিয়ভাবে স্থগিত।`
      : `${p.cancelCount} বার গ্রহণ করে বাতিল করেছেন — স্বয়ংক্রিয়ভাবে স্থগিত।`;

    // Claimed on `status`, so a second run cannot re-suspend and re-message.
    const claimed = await Provider.findOneAndUpdate(
      { _id: p._id, status: 'active' },
      {
        $set: {
          status: 'suspended',
          suspendedReason: reason,
          // Suspended and "open for business" is a contradiction a tenant must
          // never be shown, even for the moment before search drops him.
          openNow: false,
          'lifecycle.suspendedAt': now,
        },
      },
      { new: true },
    );
    if (!claimed) continue;

    acted += 1;
    // He is told WHY and what to do, because a listing that vanishes with no
    // explanation is how somebody concludes the platform stole their fee.
    await notify.toPhone(
      claimed.phone,
      `${reason}\nআপত্তি থাকলে সাপোর্টে যোগাযোগ করুন।\n— ${APP}`,
      { label: 'lifecycle' },
    ).catch(() => null);
  }

  if (acted) console.log(`[lifecycle] auto-suspended ${acted} providers`);
  return result(candidates.length, acted);
}

// ═════════════════════════════════════════════════════════════════════════════
// 3 + 4. Registration expiry
// ═════════════════════════════════════════════════════════════════════════════

async function expireRegistrations(now = new Date()) {
  const due = await Provider.find({
    status: 'active',
    'registration.expiresAt': { $ne: null, $lt: now },
  }).limit(500);

  let acted = 0;
  for (const p of due) {
    const claimed = await Provider.findOneAndUpdate(
      { _id: p._id, status: 'active' },
      { $set: { status: 'expired', openNow: false, 'lifecycle.expiredAt': now } },
      { new: true },
    );
    if (!claimed) continue;

    acted += 1;
    await notify.toPhone(
      claimed.phone,
      `আপনার রেজিস্ট্রেশনের মেয়াদ শেষ হয়েছে, তাই ${claimed.name} এখন আর খুঁজে পাওয়া যাচ্ছে না।\n`
      + `নবায়ন করলে সাথে সাথে আবার চালু হবে।\n— ${APP}`,
      { label: 'lifecycle' },
    ).catch(() => null);
  }

  if (acted) console.log(`[lifecycle] expired ${acted} registrations`);
  return result(due.length, acted);
}

/**
 * Two warnings before the lights go out.
 *
 * `lifecycle.expiryWarnedFor` holds the threshold already sent (30, then 7), so
 * the 30-day notice goes once and the 7-day notice still gets through after it.
 * A plain "warnedAt" timestamp could only ever deliver one of the two.
 */
async function warnExpiringSoon(now = new Date()) {
  let swept = 0;
  let acted = 0;

  for (const days of EXPIRY_WARN_DAYS) {
    const cutoff = new Date(now.getTime() + days * DAY_MS);
    const due = await Provider.find({
      status: 'active',
      'registration.expiresAt': { $ne: null, $gt: now, $lt: cutoff },
      // Never warned, or last warned at a WIDER threshold than this one.
      $or: [
        { 'lifecycle.expiryWarnedFor': { $exists: false } },
        { 'lifecycle.expiryWarnedFor': null },
        { 'lifecycle.expiryWarnedFor': { $gt: days } },
      ],
    }).limit(500);

    swept += due.length;

    for (const p of due) {
      // Stamp BEFORE sending, and only if nobody else stamped it first. A
      // message sent and then failed to stamp is a message sent every minute.
      const claimed = await Provider.findOneAndUpdate(
        {
          _id: p._id,
          $or: [
            { 'lifecycle.expiryWarnedFor': { $exists: false } },
            { 'lifecycle.expiryWarnedFor': null },
            { 'lifecycle.expiryWarnedFor': { $gt: days } },
          ],
        },
        { $set: { 'lifecycle.expiryWarnedFor': days, 'lifecycle.expiryWarnedAt': now } },
        { new: true },
      );
      if (!claimed) continue;

      acted += 1;
      await notify.toPhone(
        claimed.phone,
        `${claimed.name} এর রেজিস্ট্রেশনের মেয়াদ আর ${days} দিন আছে।\n`
        + `নবায়ন না করলে তালিকা থেকে সরে যাবে।\n— ${APP}`,
        { label: 'lifecycle' },
      ).catch(() => null);
    }
  }

  if (acted) console.log(`[lifecycle] warned ${acted} providers about expiry`);
  return result(swept, acted);
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. Price lists nobody has touched
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Nudge providers whose prices have gone past `expired` on their own
 * category's clock — grocery after a fortnight, a plumber's visit charge never.
 *
 * The freshness test is done in JS rather than in the query because the
 * threshold is per-category; the query only narrows to active providers that
 * are out of cooldown, which is the part Mongo can do.
 */
async function nudgeStalePrices(now = new Date()) {
  const cooldown = new Date(now.getTime() - PRICE_NUDGE_COOLDOWN_DAYS * DAY_MS);

  const candidates = await Provider.find({
    status: 'active',
    $or: [
      { 'lifecycle.priceNudgedAt': { $exists: false } },
      { 'lifecycle.priceNudgedAt': null },
      { 'lifecycle.priceNudgedAt': { $lt: cooldown } },
    ],
  }).limit(500);

  let acted = 0;
  for (const p of candidates) {
    const { state } = freshnessState(p.category, p.pricesUpdatedAt);
    // `aging` and `stale` are the tenant-facing warning ladder; only `expired`
    // — twice the category's window — is worth a message.
    if (state !== 'expired') continue;

    const claimed = await Provider.findOneAndUpdate(
      {
        _id: p._id,
        $or: [
          { 'lifecycle.priceNudgedAt': { $exists: false } },
          { 'lifecycle.priceNudgedAt': null },
          { 'lifecycle.priceNudgedAt': { $lt: cooldown } },
        ],
      },
      { $set: { 'lifecycle.priceNudgedAt': now } },
      { new: true },
    );
    if (!claimed) continue;

    acted += 1;
    await notify.toPhone(
      claimed.phone,
      `${claimed.name} এর দামের তালিকা অনেকদিন আপডেট হয়নি।\n`
      + `পুরোনো দাম দেখে ক্রেতা ফোন করে হতাশ হন — অ্যাপে গিয়ে দাম ঠিক করে দিন।\n— ${APP}`,
      { label: 'lifecycle' },
    ).catch(() => null);
  }

  if (acted) console.log(`[lifecycle] nudged ${acted} providers about stale prices`);
  return result(candidates.length, acted);
}

// ═════════════════════════════════════════════════════════════════════════════

/** Everything, in dependency order, for one cron tick. */
async function runProviderLifecycle(now = new Date()) {
  const out = {};
  // Expiry first: it is what produces the no-show strikes that autoSuspend
  // then reads, so running it second would always act a tick late.
  out.requests = await expireStaleRequests(now);
  out.suspended = await autoSuspend(now);
  out.registrations = await expireRegistrations(now);
  out.warned = await warnExpiringSoon(now);
  return out;
}

module.exports = {
  runProviderLifecycle,
  expireStaleRequests,
  autoSuspend,
  expireRegistrations,
  warnExpiringSoon,
  nudgeStalePrices,
  NO_SHOW_LIMIT,
  CANCEL_LIMIT,
  EXPIRY_WARN_DAYS,
  PRICE_NUDGE_COOLDOWN_DAYS,
};
