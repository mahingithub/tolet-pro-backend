'use strict';

/**
 * Building + Unit controller — the landlord's property structure.
 * ──────────────────────────────────────────────────────────────────────────
 *   Building → Unit (floor + room) → Seat (a member on the unit's booking)
 *
 * Rooms are created ONCE and outlive every tenant who passes through them, so
 * these endpoints are deliberately separate from booking creation: you can add
 * a room with no tenant in it, which is the only way vacancy can be shown.
 */

const mongoose = require('mongoose');
const Building = require('../models/Building');
const Unit     = require('../models/Unit');
const Booking  = require('../models/Booking');
const ApiError = require('../utils/ApiError');

const { RESIDENTIAL_SUB_CATEGORIES, FLAT_SUB_CATEGORIES } = Building.ENUMS;
// Who a FLAT is suitable for. Per-unit, never per-building: one building holds
// family flats, bachelor flats and both-flats side by side.
const SUITABLE_FOR = ['', 'family', 'bachelor', 'both'];

// An intake photo is a private Cloudinary asset; the stored URL 401s until it
// is signed. Signed per response for the landlord who owns the booking, never
// stored signed. Same helper the booking controller uses.
const signTenantPhoto = (profile) => {
  if (!profile) return profile;
  const plain = typeof profile.toObject === 'function' ? profile.toObject() : { ...profile };
  if (!plain.photoPublicId) return plain;
  try {
    plain.photoUrl = require('../services/cloudinary.service')
      .signedViewUrlFor({ publicId: plain.photoPublicId, url: plain.photoUrl });
  } catch { /* a broken photo must never fail the room list */ }
  return plain;
};

function isObjectId(v) {
  return mongoose.Types.ObjectId.isValid(String(v));
}

// Room numbers are strings but read as numbers: 101 · 102 · … · 110, not
// 101 · 110 · 102. Compare the leading digits numerically and fall back to a
// plain locale compare for names like "A" or "Shop-2".
function compareRoomNumbers(a, b) {
  const na = parseInt(String(a).replace(/\D/g, ''), 10);
  const nb = parseInt(String(b).replace(/\D/g, ''), 10);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

// The order a landlord walks their own building: ground floor up, and room by
// room within each floor. Every list of units goes through this.
function sortUnits(units) {
  return units.sort((x, y) => (x.floor - y.floor) || compareRoomNumbers(x.roomNumber, y.roomNumber));
}

// ── Room ranges ─────────────────────────────────────────────────────────────
// "101 to 109" is nine rooms. A floor is built in one go in the real world, so
// creating it one room at a time is thirty forms for a thirty-room building.
//
// The rule is deliberately narrow so it can be mirrored exactly in the UI's
// preview: the two ends must share the same non-digit prefix and suffix, and
// only the number between them moves. Zero padding is preserved, because "007"
// and "7" are different doors.
//
// Mirrored by expandRoomRange() in the frontend's UnitsManager. Keep in step.
const ROOM_RANGE_MAX = 200;

function expandRoomRange(from, to) {
  const a = String(from || '').trim();
  const b = String(to || '').trim();
  if (!a || !b) throw ApiError.badRequest('রুম নম্বরের শুরু ও শেষ দুটোই দিন।');

  const shape = /^(\D*)(\d+)(\D*)$/;
  const ma = shape.exec(a);
  const mb = shape.exec(b);
  if (!ma || !mb) throw ApiError.badRequest('রুম নম্বরে অন্তত একটি সংখ্যা থাকতে হবে (যেমন ১০১ বা A1)।');
  if (ma[1] !== mb[1] || ma[3] !== mb[3]) {
    throw ApiError.badRequest('শুরু ও শেষের গঠন এক হতে হবে — যেমন A101 থেকে A109।');
  }

  const start = parseInt(ma[2], 10);
  const end   = parseInt(mb[2], 10);
  if (end < start) throw ApiError.badRequest('শেষ নম্বরটি শুরুর চেয়ে বড় হতে হবে।');
  const count = end - start + 1;
  if (count > ROOM_RANGE_MAX) {
    throw ApiError.badRequest(`একবারে সর্বোচ্চ ${ROOM_RANGE_MAX}টি রুম — পরিসরটি ছোট করুন।`);
  }

  // "007" keeps its width; "7" does not gain one.
  const width = ma[2].length;
  const pad = (n) => (ma[2].startsWith('0') ? String(n).padStart(width, '0') : String(n));

  const out = [];
  for (let n = start; n <= end; n += 1) out.push(`${ma[1]}${pad(n)}${ma[3]}`);
  return out;
}

// Load a building the caller actually owns. Everything else 404s rather than
// 403s — a landlord has no business learning that someone else's id exists.
async function ownedBuilding(req, id) {
  if (!isObjectId(id)) throw ApiError.notFound('বিল্ডিং পাওয়া যায়নি।');
  const b = await Building.findOne({ _id: id, landlordId: req.user._id });
  if (!b) throw ApiError.notFound('বিল্ডিং পাওয়া যায়নি।');
  return b;
}

// ── POST /api/buildings ─────────────────────────────────────────────────────
async function createBuilding(req, res, next) {
  try {
    const { name, address, category, subCategory, rentedAs,
            defaultMonthlyRent, defaultServiceCharge, defaultRentDueDay } = req.body || {};

    if (!name || !String(name).trim()) throw ApiError.badRequest('বিল্ডিংয়ের নাম আবশ্যক।');

    const cat = category === 'commercial' ? 'commercial' : 'residential';
    // Commercial has no sub-categories yet, and a seat/room split is a
    // residential idea — so a commercial building stays on the whole-unit form
    // it already had rather than being handed a half-built flow.
    const sub = cat === 'residential'
      ? (RESIDENTIAL_SUB_CATEGORIES.includes(subCategory) ? subCategory : 'flat')
      : '';
    // Seats and rooms only make sense for the formats that have them. A flat is
    // let whole, so only hostels and single rooms get a choice here.
    let letAs = 'flat';
    if (cat === 'residential' && !FLAT_SUB_CATEGORIES.includes(sub)) {
      letAs = rentedAs === 'seat' ? 'seat' : 'room';
    }

    const building = await Building.create({
      landlordId: req.user._id,
      name: String(name).trim(),
      address: String(address || '').trim(),
      category: cat,
      subCategory: sub,
      rentedAs: letAs,
      defaultMonthlyRent:   Math.max(0, Number(defaultMonthlyRent) || 0),
      defaultServiceCharge: Math.max(0, Number(defaultServiceCharge) || 0),
      defaultRentDueDay:    Math.min(28, Math.max(1, Number(defaultRentDueDay) || 5)),
    });

    return res.status(201).json({ building });
  } catch (err) {
    // A duplicate name is a real, explainable conflict — not a 500.
    if (err && err.code === 11000) {
      return next(ApiError.badRequest('এই নামে আপনার একটি বিল্ডিং আগে থেকেই আছে।'));
    }
    return next(err);
  }
}

// ── GET /api/buildings ──────────────────────────────────────────────────────
// Every building with its live counts, so the overview never has to guess.
async function listBuildings(req, res, next) {
  try {
    const buildings = await Building.find({ landlordId: req.user._id, status: 'active' })
      .sort({ createdAt: 1 })
      .lean();

    const ids = buildings.map((b) => b._id);
    const [units, bookings] = await Promise.all([
      Unit.find({ buildingId: { $in: ids }, status: 'active' }).lean(),
      Booking.find({ buildingId: { $in: ids }, status: { $ne: 'cancelled' } })
        .select('buildingId unitId members status').lean(),
    ]);

    const unitCount = new Map();
    const seatCount = new Map();
    units.forEach((u) => {
      const k = String(u.buildingId);
      unitCount.set(k, (unitCount.get(k) || 0) + 1);
      seatCount.set(k, (seatCount.get(k) || 0) + (Number(u.seatCapacity) || 1));
    });

    // Occupancy counts PEOPLE, not leases: a hostel room with four seats filled
    // is four occupants on one booking.
    const occupied = new Map();
    bookings.forEach((b) => {
      const k = String(b.buildingId);
      const live = Array.isArray(b.members)
        ? b.members.filter((m) => m && m.status !== 'moved-out').length
        : 0;
      occupied.set(k, (occupied.get(k) || 0) + (live || 1));
    });

    buildings.forEach((b) => {
      b.id = String(b._id);
      delete b._id;
      b.unitCount     = unitCount.get(b.id) || 0;
      b.seatCapacity  = seatCount.get(b.id) || 0;
      b.occupiedCount = occupied.get(b.id) || 0;
      b.vacantCount   = Math.max(0, b.seatCapacity - b.occupiedCount);
    });

    return res.json({ buildings });
  } catch (err) {
    return next(err);
  }
}

// ── PATCH /api/buildings/:id ────────────────────────────────────────────────
async function updateBuilding(req, res, next) {
  try {
    const building = await ownedBuilding(req, req.params.id);
    const { name, address, defaultMonthlyRent, defaultServiceCharge, defaultRentDueDay } = req.body || {};

    // Renaming is now SAFE — bookings join on buildingId, so the name is just a
    // label. This used to be blocked in the UI ("Name cannot be changed as it
    // is linked to existing tenants") precisely because the name was the join.
    if (name !== undefined && String(name).trim()) building.name = String(name).trim();
    if (address !== undefined) building.address = String(address).trim();
    if (defaultMonthlyRent !== undefined)   building.defaultMonthlyRent   = Math.max(0, Number(defaultMonthlyRent) || 0);
    if (defaultServiceCharge !== undefined) building.defaultServiceCharge = Math.max(0, Number(defaultServiceCharge) || 0);
    if (defaultRentDueDay !== undefined)    building.defaultRentDueDay    = Math.min(28, Math.max(1, Number(defaultRentDueDay) || 5));

    // category / subCategory / rentedAs stay NOT editable. Flipping a seat
    // building to a flat building would orphan every seat already let in it;
    // that is a migration, not a settings toggle. (Family vs bachelor is no
    // longer a building type at all — it is Unit.suitableFor, per flat.)

    await building.save();
    return res.json({ building });
  } catch (err) {
    if (err && err.code === 11000) {
      return next(ApiError.badRequest('এই নামে আপনার একটি বিল্ডিং আগে থেকেই আছে।'));
    }
    return next(err);
  }
}

// ── DELETE /api/buildings/:id ───────────────────────────────────────────────
// Soft: archived, never destroyed. Past leases and rent ledgers point here.
async function archiveBuilding(req, res, next) {
  try {
    const building = await ownedBuilding(req, req.params.id);
    building.status = 'archived';
    await building.save();
    await Unit.updateMany({ buildingId: building._id }, { $set: { status: 'archived' } });
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
}

// ── POST /api/buildings/:id/units ───────────────────────────────────────────
// Create a room. No tenant required — that is the entire point.
async function createUnit(req, res, next) {
  try {
    const building = await ownedBuilding(req, req.params.id);
    const { floor, roomNumber, seatCapacity, monthlyRent, serviceCharge, rentDueDay, notes, suitableFor } = req.body || {};

    if (roomNumber === undefined || !String(roomNumber).trim()) {
      throw ApiError.badRequest('রুম/ফ্ল্যাট নম্বর আবশ্যক।');
    }
    const flr = Number(floor);
    if (!Number.isFinite(flr)) throw ApiError.badRequest('ফ্লোর নম্বর আবশ্যক।');

    // Seats exist only in a seat building. Anywhere else a unit IS one tenancy,
    // so capacity is pinned to 1 rather than left as a misleading input.
    const seats = building.rentedAs === 'seat'
      ? Math.min(60, Math.max(1, Number(seatCapacity) || 1))
      : 1;

    const unit = await Unit.create({
      buildingId:  building._id,
      landlordId:  req.user._id,
      floor:       Math.round(flr),
      roomNumber:  String(roomNumber).trim(),
      seatCapacity: seats,
      // Fall back to the building's defaults so a landlord entering 30 rooms
      // types the rent once, not thirty times.
      monthlyRent:   Number(monthlyRent)   >= 0 && monthlyRent   !== '' && monthlyRent   !== undefined ? Math.max(0, Number(monthlyRent))   : building.defaultMonthlyRent,
      serviceCharge: Number(serviceCharge) >= 0 && serviceCharge !== '' && serviceCharge !== undefined ? Math.max(0, Number(serviceCharge)) : building.defaultServiceCharge,
      rentDueDay:    Number(rentDueDay)    ? Math.min(28, Math.max(1, Number(rentDueDay))) : building.defaultRentDueDay,
      // Chosen per flat. No building-level default: one building holds family
      // flats, bachelor flats and both-flats side by side.
      suitableFor: SUITABLE_FOR.includes(suitableFor) ? suitableFor : '',
      notes: String(notes || '').trim(),
    });

    return res.status(201).json({ unit });
  } catch (err) {
    if (err && err.code === 11000) {
      return next(ApiError.badRequest('এই ফ্লোরে এই রুম নম্বরটি আগে থেকেই আছে।'));
    }
    return next(err);
  }
}

// ── POST /api/buildings/:id/units/bulk ──────────────────────────────────────
// A whole floor at once: "101 to 109" creates nine rooms sharing one set of
// terms. Rooms that already exist are SKIPPED, not treated as failures — a
// landlord extending 101–109 to 101–115 should get the six new ones without
// having to work out which six those are.
async function createUnitsBulk(req, res, next) {
  try {
    const building = await ownedBuilding(req, req.params.id);
    const { from, to, floor, seatCapacity, monthlyRent, serviceCharge, rentDueDay, suitableFor, notes } = req.body || {};

    const flr = Number(floor);
    if (!Number.isFinite(flr)) throw ApiError.badRequest('ফ্লোর নম্বর আবশ্যক।');

    const roomNumbers = expandRoomRange(from, to);

    const seats = building.rentedAs === 'seat'
      ? Math.min(60, Math.max(1, Number(seatCapacity) || 1))
      : 1;
    const shared = {
      buildingId:  building._id,
      landlordId:  req.user._id,
      floor:       Math.round(flr),
      seatCapacity: seats,
      suitableFor: SUITABLE_FOR.includes(suitableFor) ? suitableFor : '',
      monthlyRent:   monthlyRent   !== undefined && monthlyRent   !== '' ? Math.max(0, Number(monthlyRent))   : building.defaultMonthlyRent,
      serviceCharge: serviceCharge !== undefined && serviceCharge !== '' ? Math.max(0, Number(serviceCharge)) : building.defaultServiceCharge,
      rentDueDay:    Number(rentDueDay) ? Math.min(28, Math.max(1, Number(rentDueDay))) : building.defaultRentDueDay,
      notes: String(notes || '').trim(),
    };

    // One query, not one per room.
    const existing = await Unit.find({
      buildingId: building._id, floor: shared.floor, roomNumber: { $in: roomNumbers }, status: 'active',
    }).select('roomNumber').lean();
    const taken = new Set(existing.map((u) => u.roomNumber));

    const toCreate = roomNumbers.filter((n) => !taken.has(n));
    const created = toCreate.length
      ? await Unit.insertMany(toCreate.map((roomNumber) => ({ ...shared, roomNumber })), { ordered: false })
      : [];

    return res.status(201).json({
      created: created.length,
      skipped: roomNumbers.length - toCreate.length,
      skippedRooms: roomNumbers.filter((n) => taken.has(n)),
      units: sortUnits(created.map((u) => u.toJSON())),
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return next(ApiError.badRequest('এই ফ্লোরে কিছু রুম নম্বর আগে থেকেই আছে।'));
    }
    return next(err);
  }
}

// ── GET /api/buildings/:id/units ────────────────────────────────────────────
// Rooms in building order, each carrying who is actually in it. This is what
// makes "room 301 · 2 of 4 seats filled · Mahin, Momin" renderable.
async function listUnits(req, res, next) {
  try {
    const building = await ownedBuilding(req, req.params.id);

    const [units, bookings] = await Promise.all([
      Unit.find({ buildingId: building._id, status: 'active' }).lean(),
      Booking.find({ buildingId: building._id, status: { $ne: 'cancelled' } })
        .select('unitId tenant tenantPhone members leaseStart leaseEnd status monthlyRent')
        .lean(),
    ]);

    const byUnit = new Map();
    bookings.forEach((b) => {
      if (!b.unitId) return;
      const k = String(b.unitId);
      if (!byUnit.has(k)) byUnit.set(k, []);
      byUnit.get(k).push(b);
    });

    units.forEach((u) => {
      u.id = String(u._id);
      delete u._id;
      const rows = byUnit.get(u.id) || [];
      // One booking per unit holds all its seats as members; a whole-unit let
      // has no members and is itself the single occupant.
      u.occupants = rows.flatMap((b) => {
        const mems = Array.isArray(b.members) ? b.members.filter((m) => m && m.status !== 'moved-out') : [];
        if (mems.length) {
          return mems.map((m) => ({
            bookingId: String(b._id), memberId: String(m._id),
            name: m.name || '', phone: m.phone || '', seatLabel: m.seatLabel || '',
            joinDate: m.joinDate || null,
            avatar: m.avatar || '',
            // The intake details, so the landlord can read back what they
            // collected. Photo signed for this landlord only — the raw
            // authenticated URL is not loadable on its own.
            tenantProfile: signTenantPhoto(m.tenantProfile),
          }));
        }
        return [{
          bookingId: String(b._id), memberId: null,
          name: b.tenant || '', phone: b.tenantPhone || '',
          joinDate: b.leaseStart || null,
          tenantProfile: signTenantPhoto(b.tenantProfile),
        }];
      });
      u.occupiedSeats = u.occupants.length;
      u.vacantSeats   = Math.max(0, (Number(u.seatCapacity) || 1) - u.occupiedSeats);
    });

    return res.json({ building, units: sortUnits(units) });
  } catch (err) {
    return next(err);
  }
}

// ── PATCH /api/units/:unitId ────────────────────────────────────────────────
async function updateUnit(req, res, next) {
  try {
    const { unitId } = req.params;
    if (!isObjectId(unitId)) throw ApiError.notFound('রুম পাওয়া যায়নি।');
    const unit = await Unit.findOne({ _id: unitId, landlordId: req.user._id });
    if (!unit) throw ApiError.notFound('রুম পাওয়া যায়নি।');

    const { floor, roomNumber, seatCapacity, monthlyRent, serviceCharge, rentDueDay, notes, suitableFor } = req.body || {};
    if (floor !== undefined && Number.isFinite(Number(floor))) unit.floor = Math.round(Number(floor));
    if (roomNumber !== undefined && String(roomNumber).trim()) unit.roomNumber = String(roomNumber).trim();
    if (monthlyRent   !== undefined) unit.monthlyRent   = Math.max(0, Number(monthlyRent) || 0);
    if (serviceCharge !== undefined) unit.serviceCharge = Math.max(0, Number(serviceCharge) || 0);
    if (rentDueDay    !== undefined) unit.rentDueDay    = Math.min(28, Math.max(1, Number(rentDueDay) || 5));
    if (notes !== undefined) unit.notes = String(notes).trim();
    if (suitableFor !== undefined && SUITABLE_FOR.includes(suitableFor)) unit.suitableFor = suitableFor;

    if (seatCapacity !== undefined) {
      const next = Math.min(60, Math.max(1, Number(seatCapacity) || 1));
      // Shrinking below the people already in the room would strand them with
      // no seat, so the floor is however many are actually living there.
      const live = await Booking.find({ unitId: unit._id, status: { $ne: 'cancelled' } }).select('members').lean();
      const occupied = live.reduce((n, b) => n + (Array.isArray(b.members)
        ? b.members.filter((m) => m && m.status !== 'moved-out').length : 1), 0);
      if (next < occupied) {
        throw ApiError.badRequest(`এই রুমে এখন ${occupied} জন আছেন — সিট সংখ্যা তার কম করা যাবে না।`);
      }
      unit.seatCapacity = next;
    }

    await unit.save();
    return res.json({ unit });
  } catch (err) {
    if (err && err.code === 11000) {
      return next(ApiError.badRequest('এই ফ্লোরে এই রুম নম্বরটি আগে থেকেই আছে।'));
    }
    return next(err);
  }
}

// ── DELETE /api/units/:unitId ───────────────────────────────────────────────
async function archiveUnit(req, res, next) {
  try {
    const { unitId } = req.params;
    if (!isObjectId(unitId)) throw ApiError.notFound('রুম পাওয়া যায়নি।');
    const unit = await Unit.findOne({ _id: unitId, landlordId: req.user._id });
    if (!unit) throw ApiError.notFound('রুম পাওয়া যায়নি।');

    // A room with someone living in it is not a mistake to be undone.
    const live = await Booking.exists({ unitId: unit._id, status: { $nin: ['cancelled', 'completed'] } });
    if (live) throw ApiError.badRequest('এই রুমে চলমান ভাড়াটিয়া আছেন — আগে লিজ বন্ধ করুন।');

    unit.status = 'archived';
    await unit.save();
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Tenants live INSIDE a unit
// ═══════════════════════════════════════════════════════════════════════════
// The rule these two endpoints exist to enforce: adding or replacing a tenant
// NEVER creates a room, and never creates a second booking for a room that
// already has one. The unit is the durable thing; people arrive at it and leave
// it. A hostel room's four occupants are four members of ONE booking, which is
// what lets each of them carry their own rent ledger while the room keeps a
// single identity.
//
// Everything is keyed on unitId. No name matching anywhere in this path.

// One definition of a member and one tenant-profile sanitiser, shared with the
// booking controller. Required lazily inside the functions that use them so the
// two controllers can require each other's models without ordering games.
const bookingCtrl = () => require('./booking.controller');

// The live booking sitting on this unit, if any. 'completed'/'cancelled' rows
// are history — they never block a new tenant.
async function liveBookingForUnit(unitId) {
  return Booking.findOne({ unitId, status: { $nin: ['cancelled', 'completed'] } });
}

const activeMembers = (booking) => (Array.isArray(booking?.members)
  ? booking.members.filter((m) => m && m.status !== 'moved-out')
  : []);

// Floor label the tenant will recognise. 0 is নিচতলা, not "floor 0". Same
// wording invite.controller uses, so a room reads the same on the landlord's
// screen and in the tenant's notification about it.
function floorLabel(n) {
  const f = Number(n);
  if (f === 0) return 'নিচতলা';
  if (f < 0) return `বেসমেন্ট ${Math.abs(f)}`;
  return `${f} তলা`;
}

// Best-effort realtime nudge. A dashboard that refreshes a beat late is a much
// smaller problem than a room move that fails because the socket was down.
function notifySocket(userId, event, payload) {
  try {
    const { getIo, emitToUser } = require('../socket');
    const io = getIo();
    if (io) emitToUser(io, String(userId), event, payload);
  } catch (err) {
    console.warn('[building] socket emit failed:', err.message);
  }
}

// Load a unit the caller owns, plus its building (which decides seat vs whole).
async function ownedUnit(req, unitId) {
  if (!isObjectId(unitId)) throw ApiError.notFound('রুম পাওয়া যায়নি।');
  const unit = await Unit.findOne({ _id: unitId, landlordId: req.user._id });
  if (!unit) throw ApiError.notFound('রুম পাওয়া যায়নি।');
  const building = await Building.findOne({ _id: unit.buildingId, landlordId: req.user._id });
  if (!building) throw ApiError.notFound('বিল্ডিং পাওয়া যায়নি।');
  return { unit, building };
}

// Shared shape for a person arriving in a unit.
//
// Deliberately does NOT read `userId` from the body, even though
// placeTenantInUnit accepts one: that would let a landlord bind any account id
// they liked to a seat in their building. The only caller allowed to set it is
// the invite controller, which takes it from the tenant's OWN session.
function tenantInputFrom(body = {}) {
  return {
    name:  String(body.name || '').trim().slice(0, 100),
    phone: String(body.phone || '').trim().slice(0, 20),
    moveInDate: body.moveInDate ? new Date(body.moveInDate) : new Date(),
    tenantProfile: bookingCtrl().sanitiseTenantProfile(body.tenantProfile),
    // A seat may carry its own rent; blank means it takes an equal share of the
    // room rent, which is resolved at display time, not stored.
    monthlyRent: Number(body.monthlyRent) > 0 ? Number(body.monthlyRent) : 0,
    // Optional: the caller can name the seat (the replace flow reuses the
    // outgoing occupant's). Left blank, placeTenantInUnit assigns the lowest
    // free one.
    seatLabel: String(body.seatLabel || '').trim().slice(0, 40),
  };
}

// ── POST /api/units/:unitId/tenants ─────────────────────────────────────────
// Put a tenant into this unit. Creates the unit's booking only if it does not
// have one yet; otherwise adds a member to the booking that is already there.
// The core of "put this person in this unit", with no HTTP in it. The manual
// form and the AI scanner both go through here, so a scanned tenant is placed
// by exactly the same rules as a hand-typed one — including the rule that a
// full room is refused rather than duplicated.
async function placeTenantInUnit({ landlordId, unit, building, input }) {
  {
    if (!input.name) throw ApiError.badRequest('ভাড়াটিয়ার নাম আবশ্যক।');
    if (!input.phone) throw ApiError.badRequest('মোবাইল নম্বর আবশ্যক।');

    const isSeat = building.rentedAs === 'seat';
    const capacity = isSeat ? Math.max(1, Number(unit.seatCapacity) || 1) : 1;

    let booking = await liveBookingForUnit(unit._id);

    // Room is full — this is a replace, not an add, and saying so plainly is
    // more useful than silently creating a parallel booking (which is exactly
    // what the old flow did).
    if (booking && activeMembers(booking).length >= capacity) {
      if (isSeat) {
        throw ApiError.badRequest(`এই রুমে ${capacity}টি সিটই পূর্ণ — সিট সংখ্যা বাড়ান, অথবা কোনো সিটের ভাড়াটিয়া বদলান।`);
      }
      // "Replace the old tenant" is the wrong instruction when a hostel ledger
      // has been scanned into a flat building: the roommates are not
      // replacements, the building was simply set up as whole-unit. Say which
      // of the two it actually is.
      throw ApiError.badRequest(
        'এই ইউনিটে ইতিমধ্যে একজন ভাড়াটিয়া আছেন। একই ইউনিটে একাধিক জন রাখতে হলে বিল্ডিংটি "সিট হিসেবে" তৈরি করতে হবে; নয়তো পুরোনো ভাড়াটিয়া বদলান।',
      );
    }

    // Which seat this person takes. Assigned HERE, centrally, so every writer
    // gets one — the AI scanner was producing members with a blank seatLabel,
    // and only the old lease form ever set one. The lowest free number within
    // capacity is used, so a seat vacated by a move-out is filled again rather
    // than the count simply climbing.
    let seatLabel = String(input.seatLabel || '').trim();
    if (isSeat && !seatLabel) {
      const taken = new Set(activeMembers(booking).map((m) => String(m.seatLabel || '').trim()).filter(Boolean));
      for (let n = 1; n <= capacity; n += 1) {
        const candidate = `Seat ${n}`;
        if (!taken.has(candidate)) { seatLabel = candidate; break; }
      }
      // Capacity is about to grow past its own labels (the scanner does this as
      // more names in one room turn up); fall back to the next number up.
      if (!seatLabel) seatLabel = `Seat ${activeMembers(booking).length + 1}`;
    }

    const member = await bookingCtrl().buildMemberFromInput(
      {
        name: input.name,
        phone: input.phone,
        // Normally absent: the landlord types a name and a number, and
        // buildMemberFromInput resolves an account from the phone if one exists.
        // Self-onboarding is the one case where we already know exactly who this
        // is — they were logged in when they filled the form — so the account is
        // linked from their session rather than inferred from a number they may
        // have typed differently from the one they registered with.
        userId: input.userId || null,
        tenantProfile: input.tenantProfile,
        monthlyRent: input.monthlyRent,
        rentType: isSeat ? 'seat' : (building.rentedAs === 'room' ? 'room' : 'flat'),
        floor: String(unit.floor),
        roomLabel: unit.roomNumber,
        seatLabel,
        joinDate: input.moveInDate,
      },
      // A seat inherits nothing by default: leaving monthlyRent at 0 is what
      // makes seatShare() divide the room rent equally between the occupants.
      { monthlyRent: isSeat ? 0 : unit.monthlyRent, rentType: isSeat ? 'seat' : 'flat' },
    );

    if (!booking) {
      // FIRST tenant in this unit — the unit's one booking is created here, and
      // it takes its money terms from the room, not from a form.
      booking = await Booking.create({
        landlordId,
        buildingId:   building._id,
        unitId:       unit._id,
        property:     building.name,
        location:     building.address || '',
        propertyType: building.subCategory || '',
        dealType:     building.category === 'commercial' ? 'commercial' : 'residential',
        floorNumber:  String(unit.floor),
        roomNumber:   unit.roomNumber,
        tenant:       isSeat ? '' : input.name,
        tenantPhone:  (!isSeat && input.phone.length >= 10) ? input.phone : null,
        tenantProfile: isSeat ? {} : input.tenantProfile,
        tenantId:     member.userId || null,
        leaseStart:   input.moveInDate,
        leaseEnd:     null,
        monthlyRent:   unit.monthlyRent,
        serviceCharge: unit.serviceCharge,
        rentDueDay:    unit.rentDueDay,
        members:      [member],
        inviteCode:   await bookingCtrl().uniqueInviteCode(),
      });
    } else {
      booking.members.push(member);
      // A whole-unit let keeps the primary tenant fields in step with its one
      // occupant, since the rest of the app reads those.
      if (!isSeat) {
        booking.tenant = input.name;
        booking.tenantPhone = input.phone.length >= 10 ? input.phone : null;
        booking.tenantProfile = input.tenantProfile;
        if (member.userId) booking.tenantId = member.userId;
      }
      await booking.save();
    }

    const added = booking.members[booking.members.length - 1];
    return { booking, memberId: String(added._id) };
  }
}

// ── POST /api/units/:unitId/tenants ─────────────────────────────────────────
// Put a tenant into this unit. Creates the unit's booking only if it does not
// have one yet; otherwise adds a member to the booking already there.
async function addTenantToUnit(req, res, next) {
  try {
    const { unit, building } = await ownedUnit(req, req.params.unitId);
    const out = await placeTenantInUnit({
      landlordId: req.user._id,
      unit,
      building,
      input: tenantInputFrom(req.body),
    });
    return res.status(201).json(out);
  } catch (err) {
    return next(err);
  }
}

// ── POST /api/units/:unitId/tenants/:memberId/replace ───────────────────────
// The occupant left; someone else takes the SAME seat. The unit, its rent and
// the seat itself are untouched — only the person changes. The outgoing member
// is marked moved-out rather than deleted, so their rent history survives.
async function replaceTenantInUnit(req, res, next) {
  try {
    const { unit, building } = await ownedUnit(req, req.params.unitId);
    const input = tenantInputFrom(req.body);
    if (!input.name) throw ApiError.badRequest('নতুন ভাড়াটিয়ার নাম আবশ্যক।');
    if (!input.phone) throw ApiError.badRequest('মোবাইল নম্বর আবশ্যক।');

    const booking = await liveBookingForUnit(unit._id);
    if (!booking) throw ApiError.notFound('এই ইউনিটে চলমান কোনো লিজ নেই।');

    const outgoing = bookingCtrl().findMember(booking, req.params.memberId);
    if (!outgoing || outgoing.status === 'moved-out') {
      throw ApiError.notFound('এই সিটে কোনো ভাড়াটিয়া নেই।');
    }

    const isSeat = building.rentedAs === 'seat';

    // Closed out, not deleted: last year's payments hang off this row.
    outgoing.status = 'moved-out';
    outgoing.moveOutDate = input.moveInDate;

    const member = await bookingCtrl().buildMemberFromInput(
      {
        name: input.name,
        phone: input.phone,
        tenantProfile: input.tenantProfile,
        monthlyRent: input.monthlyRent,
        rentType: outgoing.rentType,
        floor: String(unit.floor),
        roomLabel: unit.roomNumber,
        // The SAME seat, by label — that is what "same seat, new person" means.
        seatLabel: outgoing.seatLabel || '',
        joinDate: input.moveInDate,
      },
      { monthlyRent: isSeat ? 0 : unit.monthlyRent, rentType: outgoing.rentType },
    );
    booking.members.push(member);

    if (!isSeat) {
      booking.tenant = input.name;
      booking.tenantPhone = input.phone.length >= 10 ? input.phone : null;
      booking.tenantProfile = input.tenantProfile;
      booking.tenantId = member.userId || null;
      // A fresh tenancy on the same unit starts a fresh ledger; the outgoing
      // member's own ledger keeps the history.
      booking.leaseStart = input.moveInDate;
      booking.ledger = {};
    }

    await booking.save();
    const added = booking.members[booking.members.length - 1];
    return res.json({ booking, memberId: String(added._id), replacedMemberId: String(outgoing._id) });
  } catch (err) {
    return next(err);
  }
}

// ── POST /api/units/:unitId/tenants/:memberId/shift ─────────────────────────
// The SAME person, a DIFFERENT room. 203 moves to 206.
//
// WHY THIS IS THE LANDLORD'S BUTTON AND NOT THE TENANT'S
// The tenant may not have the app, may not have a smartphone, and does not need
// to know this software exists. The landlord holds the register — they are the
// one who knows the tenant knocked on the door and said "I'm taking 206 from
// the first". So the move is one action on the row that is already in front of
// them: pick the new room, tap Shift. Nothing is retyped and nothing is
// approved, because the person doing it is the authority the approval would
// have been asking.
//
// (Tenants who DO have the app can ask for the same move themselves — that
// goes through invite.controller's shift flow and waits for this same landlord
// to say yes. Two doors, one outcome.)
//
// WHAT MOVES AND WHAT STAYS
// Everything about the person moves: their account link, their NID, their
// photo, their emergency contact, their phone. Their RENT HISTORY does not —
// it stays on the row they are leaving, stamped moved-out, because "who was in
// 203 last winter and what did they pay" is a question about 203. The new room
// starts a clean ledger at the new rent.
//
// ORDER MATTERS. The new room is filled BEFORE the old one is closed. If the
// destination turns out to be full, placeTenantInUnit throws and nothing has
// changed — the tenant is still in 203. Closing first and then failing would
// leave a real person in no room at all.
async function shiftTenantToUnit(req, res, next) {
  try {
    const { unit: fromUnit, building } = await ownedUnit(req, req.params.unitId);

    const toUnitId = String(req.body.toUnitId || '');
    if (!isObjectId(toUnitId)) throw ApiError.badRequest('কোন রুমে সরাবেন সেটি বেছে নিন।');
    if (String(fromUnit._id) === toUnitId) {
      throw ApiError.badRequest('ভাড়াটিয়া তো এই রুমেই আছেন — অন্য একটি রুম বেছে নিন।');
    }
    // Its own ownership check, and its own building: a landlord may move a
    // tenant between two buildings they own, and the destination's `rentedAs`
    // is what decides seat vs whole-unit on arrival.
    const { unit: toUnit, building: toBuilding } = await ownedUnit(req, toUnitId);

    const fromBooking = await liveBookingForUnit(fromUnit._id);
    if (!fromBooking) throw ApiError.notFound('এই রুমে চলমান কোনো লিজ নেই।');

    // 'primary' is the LEGACY whole-unit tenancy: a booking written before
    // members[] existed, where the tenant IS the booking. There is no member
    // row to carry across, so the booking's own tenant fields are the person.
    const isLegacy = String(req.params.memberId) === 'primary';
    const outgoing = isLegacy ? null : bookingCtrl().findMember(fromBooking, req.params.memberId);
    if (!isLegacy && (!outgoing || outgoing.status === 'moved-out')) {
      throw ApiError.notFound('এই সিটে কোনো ভাড়াটিয়া নেই।');
    }
    if (isLegacy && fromBooking.members?.length) {
      throw ApiError.badRequest('এই রুমের ভাড়াটিয়া বেছে নিন।');
    }

    const moveInDate = req.body.moveInDate ? new Date(req.body.moveInDate) : new Date();
    const person = outgoing || {
      name: fromBooking.tenant, phone: fromBooking.tenantPhone,
      userId: fromBooking.tenantId, avatar: '',
      tenantProfile: fromBooking.tenantProfile,
    };

    const name  = String(person.name  || '').trim();
    const phone = String(person.phone || '').trim();
    if (!name)  throw ApiError.badRequest('ভাড়াটিয়ার নাম পাওয়া যায়নি।');
    if (!phone) throw ApiError.badRequest('ভাড়াটিয়ার মোবাইল নম্বর পাওয়া যায়নি।');

    // NOTHING IS RETYPED. Every field below came off the row being left. The
    // landlord collected it once, months ago; asking for it again to move
    // someone down a floor is the paper-form busywork this replaces.
    const out = await placeTenantInUnit({
      landlordId: req.user._id,
      unit: toUnit,
      building: toBuilding,
      input: {
        name,
        phone,
        userId: person.userId || null,
        tenantProfile: person.tenantProfile
          ? (typeof person.tenantProfile.toObject === 'function'
              ? person.tenantProfile.toObject()
              : person.tenantProfile)
          : {},
        moveInDate,
        // A blank rent lets the destination room's own terms apply — which is
        // usually what a move means. The landlord may override.
        monthlyRent: Number(req.body.monthlyRent) > 0 ? Number(req.body.monthlyRent) : 0,
        seatLabel: String(req.body.seatLabel || '').trim().slice(0, 40),
      },
    });

    // They are in 206. Now close 203 — kept, not deleted, so its ledger and
    // receipts stay answerable.
    if (outgoing) {
      outgoing.status = 'moved-out';
      outgoing.moveOutDate = moveInDate;
      fromBooking.markModified('members');
    }
    const stillOccupied = (fromBooking.members || []).some((m) => m && m.status !== 'moved-out');
    if (!stillOccupied) {
      // The room is empty. A whole-unit let mirrors its occupant into the
      // booking's own tenant fields, and the tenant dashboard matches on those
      // — leaving them set would keep handing the tenant a live card for 203.
      fromBooking.status   = 'completed';
      fromBooking.leaseEnd = fromBooking.leaseEnd || moveInDate;
    }
    await fromBooking.save();

    // Tell them, if they are on the platform. Their rent card is about to point
    // at a different room, and finding that out by noticing is not good enough.
    const movedUserId = person.userId;
    if (movedUserId) {
      try {
        await require('../services/notification.service').emit({
          userId: movedUserId,
          type:   'tenant_onboarding',
          title:  'আপনার রুম বদলানো হয়েছে',
          body:   `${toBuilding.name} — ${floorLabel(toUnit.floor)}, রুম ${toUnit.roomNumber}. আপনার নতুন ভাড়ার হিসাব এখানেই দেখবেন। আগের রুমের রেকর্ড ও রিসিট মুছে যায়নি।`,
          data: {
            audience:  'tenant',
            kind:      'shift',
            bookingId: String(out.booking._id),
            unitId:    String(toUnit._id),
            fromUnitId: String(fromUnit._id),
          },
        });
      } catch (err) {
        console.warn('[building] shift notification failed:', err.message);
      }
      notifySocket(movedUserId, 'rent:updated', { bookingId: String(out.booking._id) });
    }
    notifySocket(req.user._id, 'rent:updated', { bookingId: String(out.booking._id) });

    return res.json({
      booking: out.booking,
      memberId: out.memberId,
      fromBookingId: String(fromBooking._id),
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  createBuilding,
  listBuildings,
  updateBuilding,
  archiveBuilding,
  createUnit,
  createUnitsBulk,
  expandRoomRange,
  listUnits,
  updateUnit,
  archiveUnit,
  addTenantToUnit,
  placeTenantInUnit,
  tenantInputFrom,
  liveBookingForUnit,
  replaceTenantInUnit,
  shiftTenantToUnit,
  // exported for the migration + tests
  compareRoomNumbers,
  sortUnits,
};
