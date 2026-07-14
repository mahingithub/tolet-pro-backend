'use strict';

/**
 * rentedCleanup.service.js
 * ──────────────────────────────────────────────────────────────────────────
 * A property listing flips to `status: 'rented'` (with `rentedAt` stamped) the
 * moment a landlord creates a booking for it (booking.controller.createBooking).
 *
 * We deliberately DO NOT delete it right away — the host should still see the
 * listing, badged "rented" with a countdown, so they can review it / create the
 * lease. After RENTED_RETENTION_DAYS have passed since it was rented, this sweep
 * permanently removes the listing AND every child document that hangs off it
 * (inquiries, bookings, receipts, conversations, messages, notifications) via
 * the shared property.service cascade.
 *
 * Driven by a setInterval in server.js (hourly). Same always-on caveat as the
 * visit-reminder sweep: on a sleeping free-tier instance the timer doesn't fire
 * while asleep, but because the window is measured in DAYS (not minutes) the
 * job simply catches up on the next boot / tick — nothing is missed.
 */

const Property = require('../models/Property');
const { purgePropertyCascade } = require('./property.service');

// How long a rented listing stays visible before it's auto-removed. The
// frontend countdown badge (HostDashboard rentedDaysLeft) mirrors this value.
const RENTED_RETENTION_DAYS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

async function runRentedCleanup() {
  const now = Date.now();

  // Backfill: any listing that is already 'rented' but has no rentedAt (legacy
  // rows created before this field existed, or rented through some path that
  // didn't stamp it) gets rentedAt = now. This intentionally grants a FULL
  // retention window from this moment rather than deleting them immediately, so
  // deploying this feature never mass-purges pre-existing rented listings.
  await Property.updateMany(
    { status: 'rented', rentedAt: null },
    { $set: { rentedAt: new Date() } },
  ).catch((e) => console.warn('[rented-cleanup] backfill failed:', e.message));

  // Listings that have been 'rented' longer than the retention window. A null
  // rentedAt never matches `$lte: <date>`, so freshly-backfilled rows above are
  // safe this run and only expire once they've actually aged past the window.
  const cutoff = new Date(now - RENTED_RETENTION_DAYS * DAY_MS);
  const expired = await Property.find({
    status: 'rented',
    rentedAt: { $lte: cutoff },
  }).select('_id');

  let deleted = 0;
  for (const doc of expired) {
    try {
      await purgePropertyCascade(doc);
      deleted += 1;
    } catch (e) {
      // One bad listing shouldn't abort the whole sweep — log and move on.
      console.warn(`[rented-cleanup] failed to delete ${doc._id}:`, e.message);
    }
  }

  if (deleted) console.log(`[rented-cleanup] removed ${deleted} expired rented listing(s)`);
  return deleted;
}

module.exports = { runRentedCleanup, RENTED_RETENTION_DAYS };
