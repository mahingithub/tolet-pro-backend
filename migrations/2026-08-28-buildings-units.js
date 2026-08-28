/**
 * 2026-08-28-buildings-units.js
 * ─────────────────────────────────────────────────────────────────────────
 * Turns the landlord's loose `landlordProfile.buildings[]` array into real
 * Building records, synthesises a Unit for every distinct room already in use,
 * and backfills `buildingId` / `unitId` onto every existing Booking.
 *
 * WHY
 * A booking's only link to a building was its `property` NAME, compared with
 * `===`. Any lease whose typed name didn't match a building exactly was
 * filtered out of Bookings, Rent Collection and the dashboard — a real row in
 * the database that looked, to the landlord, like a save that silently failed.
 * After this migration the join is by id and that class of bug is gone.
 *
 * WHAT IT DOES NOT DO
 * It never invents a building for a lease it cannot place. Leases whose
 * property name matches nothing are REPORTED, not guessed at — that is the
 * data the landlord will need to reassign by hand, and quietly filing it under
 * a plausible-looking building would hide the very problem we are fixing.
 *
 * Usage:
 *   • Dry run (no writes, full report):
 *       node migrations/2026-08-28-buildings-units.js --dry-run
 *   • Apply:
 *       node migrations/2026-08-28-buildings-units.js
 *   • Against a specific DB:
 *       MONGO_URI=mongodb://prod-host/tolet node migrations/2026-08-28-buildings-units.js
 *
 * Idempotent — re-running skips anything already linked. Safe to run twice.
 *
 * Rollback:
 *       node migrations/2026-08-28-buildings-units.js --rollback
 *   Unsets buildingId/unitId on bookings and drops the Buildings/Units this
 *   migration created. Bookings keep their `property` name throughout, so the
 *   old name-matching code still works if you have to redeploy backwards.
 *
 * Pre-deploy checklist:
 *   1. mongodump --db tolet --out backups/pre-buildings/
 *   2. --dry-run first; read the "could not place" list
 *   3. Apply, then spot-check one hostel landlord's Bookings tab
 */

'use strict';

const mongoose = require('mongoose');

const argv      = process.argv.slice(2);
const DRY_RUN   = argv.includes('--dry-run');
const ROLLBACK  = argv.includes('--rollback');
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/tolet';

const User     = require('../models/User');
const Booking  = require('../models/Booking');
const Building = require('../models/Building');
const Unit     = require('../models/Unit');

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

// Names were the join key, so they must be compared the way the old code's
// bugs actually behaved — but normalised, because "Sky View " and "sky view"
// are the same building to a human and were two different ones to `===`.
const normName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// Floor was free text: "3rd", "৩য়", "3", "" — pull a number out of whatever is
// there so rooms can finally be put in order. Unparseable ⇒ ground floor.
const BN_DIGITS = { '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9' };
function parseFloor(raw) {
  const s = String(raw ?? '').replace(/[০-৯]/g, (d) => BN_DIGITS[d] || d);
  const m = /-?\d+/.exec(s);
  if (!m) return 0;
  const n = parseInt(m[0], 10);
  return Number.isFinite(n) ? Math.max(-5, Math.min(200, n)) : 0;
}

// A booking's format, from what was denormalised onto it at creation.
function subCategoryOf(propertyType) {
  if (propertyType === 'hostel') return 'hostel';
  if (propertyType === 'single_room' || propertyType === 'sublet') return 'single_room';
  return 'flat';
}

// Only hostels and single rooms are subdivided; a flat is let whole.
const isFlatType = (sub) => sub === 'flat';


// ═══════════════════════════════════════════════════════════════════════════
// Phase 1 — derive Building records from the bookings themselves
// ═══════════════════════════════════════════════════════════════════════════
// THE SOURCE OF TRUTH IS THE BOOKINGS, NOT THE PROFILE.
//
// An earlier draft of this migration read landlordProfile.buildings[]. That
// array does not exist: LandlordProfileSchema is strict and never declared a
// `buildings` path, so Mongoose has been silently discarding it on every save.
// A landlord's buildings only ever lived in frontend state. Reading it here
// would have found zero landlords and reported every single lease as
// unplaceable — a migration that looked like it ran and did nothing.
//
// The durable record of "which buildings does this landlord have" is the set of
// distinct property names on their own bookings. That is what the dashboard's
// own recovery code falls back to, and it is what we use.
//
// The profile blob is still read when present (a non-strict write may have got
// through somewhere), purely to pick up an address the bookings don't carry.
async function migrateBuildings() {
  log('▶ Phase 1 — distinct booking property names → Building collection');

  // Addresses, where a profile blob happens to hold any. Best-effort only.
  const addressByName = new Map();
  const profiled = await User.find({ 'landlordProfile.buildings.0': { $exists: true } })
    .select('_id landlordProfile.buildings').lean().catch(() => []);
  profiled.forEach((u) => {
    (u.landlordProfile?.buildings || []).forEach((b) => {
      if (b?.name) addressByName.set(`${u._id}|${normName(b.name)}`, String(b.location || b.address || ''));
    });
  });
  if (profiled.length) log(`  ${profiled.length} landlord(s) had a usable profile blob (addresses only)`);

  // Every distinct (landlord, property name) pair that has a live booking.
  const groups = await Booking.aggregate([
    { $match: { status: { $ne: 'cancelled' }, property: { $nin: [null, ''] } } },
    {
      $group: {
        _id: { landlordId: '$landlordId', name: { $trim: { input: '$property' } } },
        // What format this building is, judged by what its leases say they are.
        types: { $addToSet: '$propertyType' },
        count: { $sum: 1 },
      },
    },
  ]);
  log(`  ${groups.length} distinct building name(s) across all landlords`);

  const index = new Map();
  let created = 0, reused = 0;

  for (const g of groups) {
    const landlordId = g._id.landlordId;
    const name = String(g._id.name || '').trim();
    if (!landlordId || !name) continue;

    const key = String(landlordId);
    if (!index.has(key)) index.set(key, new Map());
    const mine = index.get(key);
    // Two spellings of one name ("Sky View" / "sky view ") are one building.
    if (mine.has(normName(name))) { continue; }

    // eslint-disable-next-line no-await-in-loop
    const existing = await Building.findOne({ landlordId, name });
    if (existing) { mine.set(normName(name), existing); reused += 1; continue; }

    // A hostel among the leases makes the whole building a hostel: seats are
    // the more specific claim, and a hostel let by seat is what a mixed set of
    // propertyTypes on one name almost always means.
    const types = (g.types || []).filter(Boolean);
    const sub = types.includes('hostel') ? 'hostel'
      : types.some((t) => t === 'single_room' || t === 'sublet') ? 'single_room'
        : 'flat';

    if (DRY_RUN) {
      log(`  [dry-run] would create "${name}" as ${sub} (${g.count} lease(s))`);
      mine.set(normName(name), { _id: `dry_${name}`, name });
      created += 1;
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const doc = await Building.create({
      landlordId,
      name,
      address: addressByName.get(`${landlordId}|${normName(name)}`) || '',
      category: 'residential',
      subCategory: sub,
      rentedAs: isFlatType(sub) ? 'flat' : (sub === 'hostel' ? 'seat' : 'room'),
    });
    mine.set(normName(name), doc);
    created += 1;
  }

  log(`  ✓ ${created} building(s) created, ${reused} already existed`);
  return index;
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 2 — bookings → buildingId, and a Unit per distinct room
// ═══════════════════════════════════════════════════════════════════════════
async function migrateBookings(index) {
  log('▶ Phase 2 — bookings → buildingId + unitId');

  const bookings = await Booking.find({
    $or: [{ buildingId: null }, { buildingId: { $exists: false } }],
    status: { $ne: 'cancelled' },
  }).select('_id landlordId property propertyType floorNumber roomNumber monthlyRent serviceCharge rentDueDay members').lean();

  log(`  ${bookings.length} booking(s) not yet linked`);

  let linked = 0, unitsMade = 0;
  const orphans = [];
  // "buildingId|floor|roomNumber" → Unit, so many leases on one room share it.
  const unitCache = new Map();

  for (const bk of bookings) {
    const mine = index.get(String(bk.landlordId));
    const building = mine ? mine.get(normName(bk.property)) : null;

    if (!building) {
      // Deliberately NOT guessed at. This is the list the landlord fixes.
      orphans.push({ id: String(bk._id), property: bk.property || '(blank)', tenant: bk.tenant });
      continue;
    }

    const floor = parseFloor(bk.floorNumber);
    // A whole-flat lease may genuinely have no room number. Give it a stable
    // label rather than an empty one, or every such lease in a building would
    // collide on the same unique index.
    const roomNumber = String(bk.roomNumber || '').trim() || `Unit-${String(bk._id).slice(-4)}`;
    const cacheKey = `${building._id}|${floor}|${roomNumber.toLowerCase()}`;

    let unit = unitCache.get(cacheKey);
    if (!unit) {
      if (DRY_RUN) {
        unit = { _id: `dry_unit_${cacheKey}` };
        unitsMade += 1;
      } else {
        // eslint-disable-next-line no-await-in-loop
        unit = await Unit.findOne({ buildingId: building._id, floor, roomNumber });
        if (!unit) {
          const liveMembers = Array.isArray(bk.members)
            ? bk.members.filter((m) => m && m.status !== 'moved-out').length : 0;
          // eslint-disable-next-line no-await-in-loop
          unit = await Unit.create({
            buildingId: building._id,
            landlordId: bk.landlordId,
            floor,
            roomNumber,
            // Capacity is what is demonstrably in the room today. Guessing
            // higher would invent vacancies that don't exist.
            seatCapacity: Math.max(1, liveMembers),
            monthlyRent:   Number(bk.monthlyRent) || 0,
            serviceCharge: Number(bk.serviceCharge) || 0,
            rentDueDay:    Number(bk.rentDueDay) || 5,
          });
          unitsMade += 1;
        }
      }
      unitCache.set(cacheKey, unit);
    }

    if (!DRY_RUN) {
      // eslint-disable-next-line no-await-in-loop
      await Booking.updateOne(
        { _id: bk._id },
        { $set: { buildingId: building._id, unitId: unit._id, floorNumber: String(floor), roomNumber } },
      );
    }
    linked += 1;
  }

  log(`  ✓ ${linked} booking(s) linked, ${unitsMade} unit(s) created`);

  if (orphans.length) {
    log(`  ⚠ ${orphans.length} booking(s) could NOT be placed — their property name matches no building.`);
    log('    These are exactly the leases that were invisible before. They stay');
    log('    visible-but-unassigned rather than being filed under a guess:');
    orphans.slice(0, 20).forEach((o) => log(`      • ${o.property}  (booking ${o.id})`));
    if (orphans.length > 20) log(`      … and ${orphans.length - 20} more`);
  }

  return { linked, unitsMade, orphans: orphans.length };
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3 — family_flat / bachelor_flat → flat, carried down to the units
// ═══════════════════════════════════════════════════════════════════════════
// An earlier revision of this migration briefly classified BUILDINGS as
// family_flat / bachelor_flat. That was wrong: one building routinely holds
// flat 101 for a family, 102 for bachelors and 103 for either, so the
// distinction belongs to each FLAT, not to the building containing them.
//
// This phase undoes it without losing the information — the building goes back
// to plain 'flat', and whatever it was classified as is written down onto its
// units as `suitableFor`, which is where it should have been. Units the
// landlord has already set by hand are never overwritten.
//
// A no-op on databases that never saw that revision, which is most of them.
async function relabelBuildingFlatTypes() {
  log("▶ Phase 3 — building family_flat/bachelor_flat → flat (moves down to units)");

  const legacy = await Building.find({ subCategory: { $in: ['family_flat', 'bachelor_flat'] } })
    .select('_id subCategory name').lean();

  if (!legacy.length) {
    log('  none found — nothing to undo');
    return { relabelled: 0 };
  }
  log(`  ${legacy.length} building(s) carry the withdrawn classification`);

  if (DRY_RUN) {
    legacy.slice(0, 10).forEach((b) => log(`  [dry-run] "${b.name}" ${b.subCategory} → flat, units → suitableFor`));
    return { relabelled: 0 };
  }

  let movedUnits = 0;
  for (const b of legacy) {
    const suitableFor = b.subCategory === 'bachelor_flat' ? 'bachelor' : 'family';
    // Only fill units that have no answer yet — a hand-set flat wins.
    // eslint-disable-next-line no-await-in-loop
    const r = await Unit.updateMany(
      { buildingId: b._id, $or: [{ suitableFor: '' }, { suitableFor: { $exists: false } }] },
      { $set: { suitableFor } },
    );
    movedUnits += r.modifiedCount;
  }

  const res = await Building.updateMany(
    { subCategory: { $in: ['family_flat', 'bachelor_flat'] } },
    { $set: { subCategory: 'flat' } },
  );
  log(`  ✓ ${res.modifiedCount} building(s) back to 'flat', ${movedUnits} unit(s) given suitableFor`);
  return { relabelled: res.modifiedCount };
}

// Legacy field name from the same withdrawn revision.
async function renameLettingType() {
  const n = await Unit.collection.countDocuments({ lettingType: { $exists: true } });
  if (!n) return;
  log(`▶ Phase 3b — ${n} unit(s) still carry \`lettingType\`; renaming to \`suitableFor\``);
  if (DRY_RUN) { log('  [dry-run] would rename the field and map any → both'); return; }
  await Unit.collection.updateMany({ lettingType: { $exists: true } }, { $rename: { lettingType: 'suitableFor' } });
  // 'any' was the old wording for what is now 'both'.
  await Unit.collection.updateMany({ suitableFor: 'any' }, { $set: { suitableFor: 'both' } });
  log('  ✓ renamed');
}

// ═══════════════════════════════════════════════════════════════════════════
// Rollback
// ═══════════════════════════════════════════════════════════════════════════
async function rollback() {
  log('▶ ROLLBACK — unlinking bookings and dropping Buildings/Units');
  if (DRY_RUN) {
    const n = await Booking.countDocuments({ buildingId: { $ne: null } });
    log(`  [dry-run] would unlink ${n} booking(s), drop ${await Building.countDocuments()} building(s), ${await Unit.countDocuments()} unit(s)`);
    return;
  }
  const r = await Booking.updateMany({}, { $unset: { buildingId: '', unitId: '' } });
  log(`  ✓ unlinked ${r.modifiedCount} booking(s)`);
  const u = await Unit.deleteMany({});
  const b = await Building.deleteMany({});
  log(`  ✓ dropped ${u.deletedCount} unit(s), ${b.deletedCount} building(s)`);
  log('  Bookings keep their `property` name, so the pre-migration code still runs.');
}

// ═══════════════════════════════════════════════════════════════════════════
(async function main() {
  log(`Connecting to ${MONGO_URI.replace(/\/\/[^@]+@/, '//***@')}`);
  await mongoose.connect(MONGO_URI);
  if (DRY_RUN) log('DRY RUN — no writes will be made');

  try {
    if (ROLLBACK) {
      await rollback();
    } else {
      const index = await migrateBuildings();
      const res = await migrateBookings(index);
      const rel = await relabelBuildingFlatTypes();
      await renameLettingType();
      log('');
      log(`SUMMARY: ${res.linked} linked · ${res.unitsMade} units · ${res.orphans} unplaced · ${rel.relabelled} relabelled`);
    }
    log('Done.');
  } catch (err) {
    log('FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
