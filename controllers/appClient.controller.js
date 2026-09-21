'use strict';

/**
 * appClient.controller.js — "this account just opened the app".
 * ──────────────────────────────────────────────────────────────────────────
 * POST /api/app/opened   Body: { deviceId, platform?, kind?, appVersion? }
 *
 * One endpoint, called once per app launch. It exists because the only signal
 * we had for "does this user have the app" was a push token, and a push token
 * requires the user to accept the notification prompt. On Android 13+ most
 * people do not, so the admin console listed installed users as not installed
 * and every "app users only" campaign silently under-targeted.
 *
 * Deliberately cheap and idempotent: one indexed update, no response body worth
 * parsing, and the client fires it without awaiting. Nothing in the app should
 * ever be blocked by it.
 */

const User = require('../models/User');
const AnonDevice = require('../models/AnonDevice');
const guestTour = require('../services/guestTour.service');

// Kinds that mean "the app is installed on this device". A plain browser tab is
// recorded too — it is what tells us a user is reachable on the web at all —
// but it is not an install, and marketing.service treats it accordingly.
const KINDS = ['native', 'pwa', 'browser'];
const PLATFORMS = ['android', 'ios', 'web'];

// How many devices we keep per user. A landlord with a phone, a tablet and two
// browsers is normal; a hundred entries means something is minting a new
// deviceId every launch, and the cap keeps that from growing the document
// without bound.
const MAX_CLIENTS = 10;

const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

exports.appOpened = async (req, res) => {
  const body = req.body || {};
  const deviceId = clean(body.deviceId, 64);

  if (!deviceId) {
    return res.status(400).json({ message: 'deviceId is required', code: 'device_id_required' });
  }

  const platformRaw = clean(body.platform, 20).toLowerCase();
  const kindRaw = clean(body.kind, 20).toLowerCase();
  const platform = PLATFORMS.includes(platformRaw) ? platformRaw : 'web';
  const kind = KINDS.includes(kindRaw) ? kindRaw : 'browser';
  const appVersion = clean(body.appVersion, 32);
  const now = new Date();

  try {
    // 1) Refresh an existing entry. `arrayFilters` targets the one element by
    //    deviceId, so a user with several devices doesn't have the wrong one
    //    stamped. platform/kind are re-written because they genuinely change:
    //    the same install goes from 'browser' to 'pwa' the day the user adds it
    //    to their home screen.
    const updated = await User.updateOne(
      { _id: req.user._id, 'appClients.deviceId': deviceId },
      {
        $set: {
          'appClients.$[c].lastSeenAt': now,
          'appClients.$[c].platform': platform,
          'appClients.$[c].kind': kind,
          ...(appVersion ? { 'appClients.$[c].appVersion': appVersion } : {}),
        },
      },
      { arrayFilters: [{ 'c.deviceId': deviceId }] },
    );

    if (updated.matchedCount === 0) {
      // 2) First launch on this device. `$slice: -MAX_CLIENTS` keeps the most
      //    recently added entries and drops the oldest in the same operation.
      //
      //    The filter repeats the `$ne` guard because two launches can race
      //    (a cold start plus a resume): without it both would miss the update
      //    above and push a duplicate entry for the same device.
      await User.updateOne(
        { _id: req.user._id, 'appClients.deviceId': { $ne: deviceId } },
        {
          $push: {
            appClients: {
              $each: [{
                deviceId,
                platform,
                kind,
                ...(appVersion ? { appVersion } : {}),
                firstSeenAt: now,
                lastSeenAt: now,
              }],
              $slice: -MAX_CLIENTS,
            },
          },
        },
      );
    }
    // This install has an account now. Hand any guest tour progress over to it
    // so somebody who saw two tips before signing up continues at three rather
    // than being toured all over again. Non-throwing by contract and awaited
    // only so the next launch sees a settled state.
    await guestTour.claimDevice(deviceId, req.user._id);
  } catch (err) {
    // A heartbeat is not worth an error screen. Log and answer OK — the client
    // does not read the response, and failing it would only surface as a
    // console error on every app launch.
    console.error('[appClient] appOpened failed:', err?.message);
  }

  return res.json({ ok: true });
};

// ─── POST /api/app/device ───────────────────────────────────────────────────
// UNAUTHENTICATED, deliberately. This is the pre-signup twin of /opened: it
// records an install we cannot attribute to anybody, so the guest feature tour
// has something to address. See models/AnonDevice.js.
//
// Body: { deviceId, token?, platform?, kind?, language?, appVersion? }
//
// `token` is OPTIONAL and usually absent — a device is registered whether or not
// notification permission was granted, because a device we cannot push is still
// a device we can show an in-app card to on its next launch. Refusing rows
// without a token would throw away exactly the people this endpoint exists to
// stop losing.
exports.registerAnonDevice = async (req, res) => {
  const body = req.body || {};
  const deviceId = clean(body.deviceId, 64);

  if (!deviceId) {
    return res.status(400).json({ message: 'deviceId is required', code: 'device_id_required' });
  }

  const platformRaw = clean(body.platform, 20).toLowerCase();
  const kindRaw = clean(body.kind, 20).toLowerCase();
  const langRaw = clean(body.language, 5).toLowerCase();

  const now = new Date();
  const set = {
    platform: PLATFORMS.includes(platformRaw) ? platformRaw : 'web',
    kind: KINDS.includes(kindRaw) ? kindRaw : 'browser',
    language: langRaw === 'bn' ? 'bn' : 'en',
    lastSeenAt: now,
  };

  const appVersion = clean(body.appVersion, 32);
  if (appVersion) set.appVersion = appVersion;

  // Only written when supplied. An app that registers on launch (no token yet)
  // and again after the permission prompt (with one) must not have the second
  // call wipe... nor the FIRST call of a later launch clear a token we already
  // hold, which is what an unconditional $set would do.
  const token = clean(body.token, 4096);
  if (token) set.token = token;

  try {
    await AnonDevice.updateOne(
      { deviceId },
      { $set: set, $setOnInsert: { deviceId, firstSeenAt: now, tourSent: [] } },
      { upsert: true },
    );
  } catch (err) {
    // A duplicate key here means two launches raced the upsert; the row exists,
    // which is the outcome we wanted. Anything else is logged and swallowed —
    // the client does not read this response and must not be blocked by it.
    if (err?.code !== 11000) console.error('[appClient] registerAnonDevice failed:', err?.message);
  }

  return res.json({ ok: true });
};

// ─── GET /api/app/tips/pending?deviceId=… ───────────────────────────────────
// UNAUTHENTICATED. The in-app half of the guest tour: a tip for a device that
// cannot be pushed, handed over on app open so the app can show it as a card.
//
// Returns { tip: null } far more often than not — it is called on every launch
// and most launches are not a tour day.
//
// The tip is marked delivered as it is handed over, because the caller displays
// what it receives; a separate acknowledge step would only add a round trip in
// which the app can be closed and the tip lost.
exports.pendingTip = async (req, res) => {
  const deviceId = clean(req.query?.deviceId, 64);
  if (!deviceId) return res.json({ tip: null });

  const tip = await guestTour.pendingGuestTip(deviceId).catch((err) => {
    console.error('[appClient] pendingTip failed:', err?.message);
    return null;
  });

  return res.json({ tip: tip || null });
};
