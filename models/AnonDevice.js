'use strict';

/**
 * AnonDevice — an install we know about before we know who is holding it.
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS COLLECTION EXISTS
 * Everything else in this app hangs off a User: deviceTokens live on the user
 * document, a Notification row REQUIRES a userId. That is correct for every
 * transactional message we send — but it means somebody who installs the app,
 * looks around and never signs up is completely invisible to us and completely
 * unreachable. They are also the exact person a feature tour is for.
 *
 * So this is the pre-signup half of the same idea: one row per install, keyed by
 * the client-minted `deviceId` that services/appClientService.js already stores
 * in localStorage. No account, no phone number, nothing that identifies a person
 * — a random id, a push token, and which tour steps have been delivered to it.
 *
 * ── THE PART THAT MATTERS MOST: CLAIMING ──────────────────────────────────
 * The moment this device signs in, the row is CLAIMED and its `tourSent` is
 * merged into the user's `featureTourSent`. Without that, somebody who installed
 * on Monday, got two guest tips, then signed up on Friday would start the whole
 * tour again from day one — the same four notifications, a second time, to
 * somebody who has already seen half of them. A claimed row never sends again;
 * from then on the user's own tour state is the only one that counts.
 *
 * ── WHAT A ROW WITHOUT A TOKEN MEANS ──────────────────────────────────────
 * `token` is optional and is very often empty, because a device can be known
 * (the app launched) without being pushable (notification permission declined,
 * which on Android 13+ is the common case). Those rows are NOT useless: they are
 * exactly who the in-app tour surface is for — see `pendingGuestTip` in
 * services/guestTour.service.js. A row with no token is a person we can still
 * talk to, just not on their lock screen.
 *
 * ── RETENTION ──────────────────────────────────────────────────────────────
 * A TTL index drops rows 120 days after they were last seen. The tour is over
 * in 14 days, a claimed row is inert, and keeping a push token for a device that
 * has not opened the app in four months is holding data we have no use for.
 */

const mongoose = require('mongoose');

const AnonDeviceSchema = new mongoose.Schema(
  {
    // The client-minted random id from localStorage. Unique because it IS the
    // identity here — two rows for one install would double every tip.
    deviceId: { type: String, required: true, unique: true, maxlength: 64 },

    // FCM registration token. Empty when the device has not granted notification
    // permission; see the header for why that row is still worth keeping.
    token: { type: String, default: '', maxlength: 4096, index: true },

    platform: { type: String, enum: ['android', 'ios', 'web'], default: 'web' },
    kind:     { type: String, enum: ['native', 'pwa', 'browser'], default: 'browser' },

    // Which language to write the tips in. Taken from the app's own language
    // switcher, which a guest can use before signing up — so we are not guessing
    // from a locale header.
    language:   { type: String, enum: ['en', 'bn'], default: 'en' },
    appVersion: { type: String, default: '', maxlength: 32 },

    firstSeenAt: { type: Date, default: Date.now },
    // No `index: true` here — the TTL index declared at the bottom of this file
    // already covers this path, and declaring both makes Mongoose build two
    // indexes on the same key and warn about it on every boot.
    lastSeenAt:  { type: Date, default: Date.now },

    // Tour step ids already delivered to this device. Same shape and the same
    // reasoning as User.featureTourSent — ids rather than a counter, so editing
    // the tour never re-notifies anyone.
    tourSent: { type: [String], default: [] },

    // Set once this install signs in. A claimed row is finished: the user
    // document takes over, and the guest sweep skips it forever.
    claimedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    claimedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// The guest sweep's query: unclaimed rows, oldest first, that still have tour
// left. Compound so it does not collection-scan once this table is large.
AnonDeviceSchema.index({ claimedBy: 1, firstSeenAt: 1 });

// Retention. `expireAfterSeconds` counts from lastSeenAt, so an install that
// keeps being used keeps being kept.
AnonDeviceSchema.index({ lastSeenAt: 1 }, { expireAfterSeconds: 120 * 24 * 60 * 60 });

module.exports = mongoose.model('AnonDevice', AnonDeviceSchema);
