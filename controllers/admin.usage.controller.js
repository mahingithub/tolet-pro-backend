'use strict';

/**
 * Admin usage tracking — HOW MANY, never WHO.
 * ──────────────────────────────────────────────────────────────────────────
 * The question this answers is the product one: how many landlords actually
 * run the management system, how many buildings it is keeping, and how many
 * people are on each Living wallet — share (Household) vs solo (SoloLedger).
 * It exists so a feature can be updated knowing the size of the audience it
 * would land on.
 *
 * ── Deliberately identity-free ───────────────────────────────────────────
 * Every pipeline below ends in a COUNT. No _id, name, phone or email is ever
 * projected out of this file, and `$group` on a user id exists only so the
 * following `$count` can measure the set — the ids never leave the database.
 * That is the whole privacy contract of this endpoint: the console learns the
 * size of each group and nothing about its members. A per-user drilldown is a
 * different endpoint with a different justification; do not add it here by
 * widening one of these pipelines.
 *
 * ── Why "adoption" is measured on records, not on roles ──────────────────
 * `roles: 'landlord'` only says someone was granted the role. A landlord who
 * signed up and left has it too. So the funnel here is measured on the work
 * they did — a building created, a live tenancy, a booking touched recently —
 * because that is what "running the system" actually looks like in the data.
 * Each number's definition is returned to the client (see `definitions`) so
 * the console can label it and nobody has to guess what they are reading.
 */

const Building = require('../models/Building');
const Unit = require('../models/Unit');
const Booking = require('../models/Booking');
const Household = require('../models/Household');
const SoloLedger = require('../models/SoloLedger');
const User = require('../models/User');
const cache = require('../config/redis');

// "Recently active" window. 30 days is one rent cycle, which is the natural
// heartbeat of this product: a landlord who collected rent this month is
// running the system, one who hasn't touched a booking in two cycles isn't.
const ACTIVE_DAYS = 30;

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

// Aggregations that end in `$count` return `[]` — not `[{ n: 0 }]` — when
// nothing matched, so every read of one goes through here.
const countOf = (rows) => (Array.isArray(rows) && rows[0] ? Number(rows[0].n) || 0 : 0);

// A booking that is live right now. Cancelled/completed leases and soft-deleted
// rows are history, not usage.
const LIVE_BOOKING = { status: 'active', deletedAt: null };

/**
 * A live booking that someone actually lives in.
 *
 * `status: 'active'` alone is NOT enough, and the difference is not small: most
 * live bookings in the database are empty shells left from before the Building
 * model existed — no members[], no buildingId, no unitId, blank tenantName.
 * Counting those reported ~5x the real number of tenancies while the occupant
 * count stayed flat, which reads as a broken dashboard rather than a big one.
 *
 * An occupant is a member row, and only a member row: `tenantsCount` on those
 * legacy documents is a stale fallback that still holds numbers like 6 for a
 * booking with nobody in it, so it is never summed here.
 *
 * The leftovers are not swept under the rug — they are reported as
 * `unlinkedRecords` so the two numbers still add up to every live booking.
 */
const OCCUPIED_BOOKING = {
  ...LIVE_BOOKING,
  members: { $elemMatch: { status: { $ne: 'moved-out' } } },
};

// Runs a `$count`-terminated pipeline and resolves to the number. Returns the
// PROMISE rather than awaiting, so every query in buildUsageStats can sit in
// one Promise.all and actually run concurrently.
const countingPipeline = (Model, pipeline) => Model.aggregate(pipeline).then(countOf);

/**
 * Size of the set of distinct landlords behind some collection of records.
 * `$group` collapses to one row per landlord and `$count` measures how many
 * rows that produced — the ids themselves are dropped inside the database.
 */
const distinctLandlords = (Model, match) => countingPipeline(Model, [
  { $match: match },
  { $group: { _id: '$landlordId' } },
  { $count: 'n' },
]);

// ─── GET /api/admin/usage ───────────────────────────────────────────────────
async function getUsage(req, res, next) {
  try {
    const stats = await cache.getOrSet(
      cache.KEY.adminStats('usage'),
      cache.TTL.ADMIN_STATS,
      () => buildUsageStats(),
    );
    return res.json({ stats });
  } catch (err) {
    return next(err);
  }
}

async function buildUsageStats() {
  const since = daysAgo(ACTIVE_DAYS);

  const [
    // ── management system (landlord side) ──
    landlordAccounts,
    landlordsWithBuilding,
    landlordsWithTenancy,
    landlordsActive,
    buildingsTracked,
    buildingsArchived,
    unitsTracked,
    liveTenancies,
    liveBookingRows,
    occupancy,
    buildingMix,

    // ── Living (tenant side) ──
    households,
    householdsActive,
    shareUsers,
    soloLedgers,
    soloWithEntries,
    soloActive,
    bothModes,
  ] = await Promise.all([
    // The denominator: accounts that hold the landlord role at all. Everything
    // below is a subset of this, which is what makes the funnel readable.
    User.countDocuments({ roles: 'landlord' }),

    // Set up the manager — at least one building on the books.
    distinctLandlords(Building, { status: 'active' }),

    // Actually running it — at least one tenancy with somebody in it.
    distinctLandlords(Booking, OCCUPIED_BOOKING),

    // Still running it — an occupied tenancy touched inside the window.
    // `updatedAt` moves on rent collection, edits, member changes and
    // reminders, so it is the cheapest honest proxy for "this landlord used
    // the system this month".
    distinctLandlords(Booking, { ...OCCUPIED_BOOKING, updatedAt: { $gte: since } }),

    Building.countDocuments({ status: 'active' }),
    Building.countDocuments({ status: 'archived' }),
    Unit.countDocuments({ status: 'active' }),
    Booking.countDocuments(OCCUPIED_BOOKING),
    // Every live booking, occupied or not. Only used to derive the leftover
    // count by subtraction, which keeps the two numbers guaranteed to sum
    // rather than trusting two predicates to stay each other's complement.
    Booking.countDocuments(LIVE_BOOKING),

    // Occupancy is SEATS, not heads: one member row holding a whole 4-seat room
    // has seatsBooked = 4 (see seatsTaken in services/tenancy.service.js), so
    // counting member rows would under-report the space in use. Both numbers
    // are returned because they answer different questions — how full the
    // buildings are, vs how many people are on the books.
    Booking.aggregate([
      { $match: OCCUPIED_BOOKING },
      { $unwind: '$members' },
      { $match: { 'members.status': { $ne: 'moved-out' } } },
      {
        $group: {
          _id: null,
          seats: { $sum: { $ifNull: ['$members.seatsBooked', 1] } },
          people: { $sum: 1 },
          // A member row with a userId is a tenant who joined the app; without
          // one they are a record the landlord typed in. The gap between these
          // is the size of the "invite your tenants" opportunity.
          linked: { $sum: { $cond: [{ $ifNull: ['$members.userId', false] }, 1, 0] } },
        },
      },
    ]),

    // What kind of landlord runs the system — whole flats, single rooms, or
    // hostel seats. `rentedAs` is the field that decides which booking flow
    // they ever see, so it is the split that matters for a product update.
    Building.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$rentedAs', n: { $sum: 1 } } },
    ]),

    Household.countDocuments({}),
    Household.countDocuments({ updatedAt: { $gte: since } }),

    // People in share mode — real joined users only. A member with userId null
    // is a placeholder the group splits with, not somebody running the app, and
    // counting them would inflate the share-mode audience.
    countingPipeline(Household, [
      { $unwind: '$members' },
      { $match: { 'members.userId': { $ne: null } } },
      // One person can only be in one household, but $group also makes this
      // safe if that ever stops being true.
      { $group: { _id: '$members.userId' } },
      { $count: 'n' },
    ]),

    // A SoloLedger document is created on demand and only saved by a mutation
    // (loadMine in livingSolo.controller.js), so its mere existence already
    // means the person wrote something.
    SoloLedger.countDocuments({}),
    // …but a ledger whose every row was later deleted still exists, because
    // deletes here are tombstones. This is the count that still has something
    // live in it.
    SoloLedger.countDocuments({ entries: { $elemMatch: { deletedAt: null } } }),
    SoloLedger.countDocuments({ updatedAt: { $gte: since } }),

    // People who run both wallets. Needed to report a truthful "Living users"
    // total — share + solo double-counts exactly this set.
    countingPipeline(SoloLedger, [
      {
        $lookup: {
          from: Household.collection.name,
          localField: 'userId',
          foreignField: 'members.userId',
          as: 'shared',
        },
      },
      { $match: { 'shared.0': { $exists: true } } },
      { $count: 'n' },
    ]),
  ]);

  const occ = occupancy[0] || { seats: 0, people: 0, linked: 0 };

  // rentedAs is a small fixed enum; normalise it into a stable shape so the
  // console doesn't have to handle a missing key.
  const mix = { flat: 0, room: 0, seat: 0 };
  for (const row of buildingMix) {
    if (row && Object.prototype.hasOwnProperty.call(mix, row._id)) mix[row._id] = row.n;
  }

  return {
    generatedAt: new Date().toISOString(),
    activeWindowDays: ACTIVE_DAYS,

    // ── Management system ──
    management: {
      landlordAccounts,
      landlordsWithBuilding,
      landlordsWithTenancy,
      landlordsActive,
      buildingsTracked,
      buildingsArchived,
      unitsTracked,
      liveTenancies,
      // Live bookings with nobody in them — the pre-Building leftovers
      // described on OCCUPIED_BOOKING. Surfaced rather than dropped so the
      // tenancy count can be reconciled against the raw collection.
      unlinkedRecords: Math.max(0, liveBookingRows - liveTenancies),
      seatsOccupied: occ.seats,
      tenantsTracked: occ.people,
      tenantsOnApp: occ.linked,
      buildingMix: mix,
    },

    // ── Living: the two wallets ──
    living: {
      shareUsers,
      households,
      householdsActive,
      soloUsers: soloLedgers,
      soloWithEntries,
      soloActive,
      bothModes,
      // Distinct people on Living at all. Subtracting the overlap is the whole
      // reason bothModes is computed — without it this number is inflated by
      // everyone who uses share and solo side by side.
      totalUsers: shareUsers + soloLedgers - bothModes,
    },

    // Shipped with the numbers so the console labels them the same way this
    // file measures them, and a definition can never silently drift from the
    // query that produced it.
    definitions: {
      landlordsWithBuilding: 'Landlords who have added at least one active building.',
      landlordsWithTenancy: 'Landlords with at least one occupied tenancy on the books.',
      landlordsActive: `Landlords whose occupied tenancies were touched in the last ${ACTIVE_DAYS} days.`,
      liveTenancies: 'Active leases with at least one current occupant.',
      unlinkedRecords: 'Older active bookings with no occupant, building or unit attached — not counted as tenancies.',
      seatsOccupied: 'Seats held by current occupants — a whole-room hold counts as every seat it fills.',
      tenantsTracked: 'Current occupants on live tenancies.',
      tenantsOnApp: 'Occupants whose record is linked to a real app account.',
      shareUsers: 'People in a shared Roommate Wallet (placeholders excluded).',
      soloUsers: 'People with a solo খাতা saved on the server.',
      bothModes: 'People who use the shared wallet and a solo খাতা.',
    },
  };
}

module.exports = { getUsage };
