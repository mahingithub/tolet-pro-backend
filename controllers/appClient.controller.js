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
  } catch (err) {
    // A heartbeat is not worth an error screen. Log and answer OK — the client
    // does not read the response, and failing it would only surface as a
    // console error on every app launch.
    console.error('[appClient] appOpened failed:', err?.message);
  }

  return res.json({ ok: true });
};
