'use strict';

/**
 * invite.controller.js — tenant self-onboarding by QR / link.
 * ──────────────────────────────────────────────────────────────────────────
 * THE PROBLEM THIS SOLVES
 * Putting a tenant into a room means typing their name, their phone, their
 * father's name, their NID number, their emergency contact, and photographing
 * two sides of an ID card. The landlord was doing all of it, for every tenant,
 * from a piece of paper the tenant had already filled in by hand.
 *
 * The tenant has all of that information, on the phone in their pocket, and is
 * the only person who can type it correctly. So they type it. The landlord
 * shares a link, and approves what comes back.
 *
 * TWO TOKENS, TWO TRUST LEVELS
 *   • Building token  — "everyone in the building, click this". Forwardable by
 *     design; the sender picks their own room. A submission is a CLAIM and
 *     waits for the landlord (TenantOnboarding.status = 'pending').
 *   • Unit token      — "you, room 203, click this". Handed to one person for
 *     one room, like a key. Auto-approves.
 *
 * Both write a TenantOnboarding row, so the host has one audit trail no matter
 * which door someone came through.
 *
 * WHY THE FORM REQUIRES A LOGIN
 * The point of onboarding is to attach a PERSON to a room — an account that can
 * then see their own rent, receipts and messages. An anonymous form would
 * produce a name in a box, which is the thing the landlord could already type
 * themselves. The resolve step is public (so the link previews before signup),
 * the submit step is not.
 */

const mongoose  = require('mongoose');
const QRCode    = require('qrcode');

const Building         = require('../models/Building');
const Unit             = require('../models/Unit');
const Booking          = require('../models/Booking');
const User             = require('../models/User');
const TenantOnboarding = require('../models/TenantOnboarding');

const ApiError      = require('../utils/ApiError');
const notifications = require('../services/notification.service');
const { uniqueToken, inviteUrl } = require('../utils/inviteToken');

const bookingCtrl  = () => require('./booking.controller');
const buildingCtrl = () => require('./building.controller');

function isObjectId(v) {
  return mongoose.Types.ObjectId.isValid(String(v));
}

// Same reduction booking.controller uses, so a phone typed on the invite form
// matches a placeholder the landlord typed months ago in a different format.
function phoneCore(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

function notifySocket(userId, event, payload) {
  try {
    const { getIo, emitToUser } = require('../socket');
    const io = getIo();
    if (io) emitToUser(io, String(userId), event, payload);
  } catch (err) {
    console.warn('[invite] socket emit failed:', err.message);
  }
}

const activeMembers = (booking) => (Array.isArray(booking?.members)
  ? booking.members.filter((m) => m && m.status !== 'moved-out')
  : []);

// Floor label the tenant will recognise. 0 is নিচতলা, not "floor 0".
function floorLabel(n) {
  const f = Number(n);
  if (f === 0) return 'নিচতলা';
  if (f < 0) return `বেসমেন্ট ${Math.abs(f)}`;
  return `${f} তলা`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Share side — the landlord getting a QR + link
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The QR as a PNG data URL, rendered here rather than in the app.
 *
 * The backend already depends on `qrcode`; adding a QR library to the frontend
 * would have shipped a second implementation to every user's phone in order to
 * draw a picture of a string the server already has. The image is small enough
 * to inline, and a data URL is directly usable by <img>, by "save image", and
 * by the share sheet.
 */
async function qrDataUrl(url) {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 512,
    color: { dark: '#111827', light: '#FFFFFF' },
  });
}

// Shape one share payload. Everything the sheet needs, in one response.
async function sharePayload(token, extra = {}) {
  const url = inviteUrl(token);
  return { token, url, qr: await qrDataUrl(url), ...extra };
}

async function ownedBuilding(req, id) {
  if (!isObjectId(id)) throw ApiError.notFound('বিল্ডিং পাওয়া যায়নি।');
  const building = await Building.findOne({ _id: id, landlordId: req.user._id });
  if (!building) throw ApiError.notFound('বিল্ডিং পাওয়া যায়নি।');
  return building;
}

async function ownedUnit(req, unitId) {
  if (!isObjectId(unitId)) throw ApiError.notFound('রুম পাওয়া যায়নি।');
  const unit = await Unit.findOne({ _id: unitId, landlordId: req.user._id });
  if (!unit) throw ApiError.notFound('রুম পাওয়া যায়নি।');
  return unit;
}

// ── GET /api/invite/building/:buildingId ────────────────────────────────────
// The universal link for a whole building. Mints the token on first ask.
async function getBuildingInvite(req, res, next) {
  try {
    const building = await ownedBuilding(req, req.params.buildingId);
    if (!building.inviteToken) {
      building.inviteToken = await uniqueToken(Building);
      await building.save();
    }
    return res.json({
      invite: await sharePayload(building.inviteToken, {
        scope:        'building',
        buildingId:   String(building._id),
        buildingName: building.name,
        enabled:      building.inviteEnabled !== false,
      }),
    });
  } catch (err) {
    return next(err);
  }
}

// ── GET /api/invite/unit/:unitId ────────────────────────────────────────────
// The link for one room.
async function getUnitInvite(req, res, next) {
  try {
    const unit = await ownedUnit(req, req.params.unitId);
    if (!unit.inviteToken) {
      unit.inviteToken = await uniqueToken(Unit);
      await unit.save();
    }
    const building = await Building.findById(unit.buildingId).select('name').lean();
    return res.json({
      invite: await sharePayload(unit.inviteToken, {
        scope:        'unit',
        unitId:       String(unit._id),
        buildingId:   String(unit.buildingId),
        buildingName: building?.name || '',
        floor:        unit.floor,
        roomNumber:   unit.roomNumber,
      }),
    });
  } catch (err) {
    return next(err);
  }
}

// ── POST /api/invite/building/:buildingId/revoke ────────────────────────────
// ── POST /api/invite/unit/:unitId/revoke ────────────────────────────────────
// Issue a NEW token. The old link (and every QR already printed from it) stops
// resolving immediately — which is the entire point, and worth saying out loud
// in the UI before the landlord taps it.
async function revokeBuildingInvite(req, res, next) {
  try {
    const building = await ownedBuilding(req, req.params.buildingId);
    building.inviteToken = await uniqueToken(Building);
    await building.save();
    return res.json({ invite: await sharePayload(building.inviteToken, { scope: 'building' }) });
  } catch (err) {
    return next(err);
  }
}

async function revokeUnitInvite(req, res, next) {
  try {
    const unit = await ownedUnit(req, req.params.unitId);
    unit.inviteToken = await uniqueToken(Unit);
    await unit.save();
    return res.json({ invite: await sharePayload(unit.inviteToken, { scope: 'unit' }) });
  } catch (err) {
    return next(err);
  }
}

// ── PATCH /api/invite/building/:buildingId ──────────────────────────────────
// Turn the universal link on/off without changing it.
async function setBuildingInviteEnabled(req, res, next) {
  try {
    const building = await ownedBuilding(req, req.params.buildingId);
    building.inviteEnabled = req.body.enabled !== false;
    await building.save();
    return res.json({ enabled: building.inviteEnabled });
  } catch (err) {
    return next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tenant side — resolving a token and submitting a form
// ─────────────────────────────────────────────────────────────────────────────

// Find whichever kind of token this is. Building and Unit tokens come from the
// same 128-bit space, so a token is unambiguous and the caller never says which
// sort they hold — the link is just a link.
async function findByToken(token) {
  const clean = String(token || '').trim();
  if (!clean || clean.length > 64) return null;

  const unit = await Unit.findOne({ inviteToken: clean, status: 'active' });
  if (unit) {
    const building = await Building.findById(unit.buildingId);
    if (!building) return null;
    return { scope: 'unit', unit, building, token: clean };
  }

  const building = await Building.findOne({ inviteToken: clean, status: 'active' });
  if (building) return { scope: 'building', unit: null, building, token: clean };

  return null;
}

// Vacancy for one unit: how many seats it has and how many are still free.
// A whole-flat/room building has a capacity of exactly one, because the unit
// IS the tenancy — the same rule placeTenantInUnit enforces on write.
function occupancyOf(unit, building, booking) {
  const isSeat   = building.rentedAs === 'seat';
  const capacity = isSeat ? Math.max(1, Number(unit.seatCapacity) || 1) : 1;
  const taken    = activeMembers(booking).length;
  return { capacity, taken, free: Math.max(0, capacity - taken) };
}

// ── GET /api/invite/resolve/:token ──────────────────────────────────────────
// PUBLIC. What the tenant sees before they commit to anything: whose building
// this is, and (for a universal link) which rooms they can pick from.
//
// Deliberately thin. It names the landlord and the building — which the person
// holding the link already knows, because someone gave it to them — and lists
// room numbers with free seats. It does NOT list who lives in them.
async function resolveInvite(req, res, next) {
  try {
    const found = await findByToken(req.params.token);
    if (!found) throw ApiError.notFound('এই লিংকটি আর কাজ করছে না। বাড়িওয়ালার কাছ থেকে নতুন লিংক নিন।');

    const { scope, unit, building } = found;
    if (scope === 'building' && building.inviteEnabled === false) {
      throw ApiError.badRequest('এই বিল্ডিংয়ে এখন নতুন ভাড়াটিয়া যুক্ত করা বন্ধ আছে।');
    }

    const host = await User.findById(building.landlordId).select('name avatar').lean();

    const base = {
      scope,
      buildingName: building.name,
      address:      building.address || '',
      rentedAs:     building.rentedAs,
      hostName:     host?.name || '',
      hostAvatar:   host?.avatar || '',
      // The landlord's own id. submitOnboarding refuses a landlord joining
      // their own building, and without this the page can only find that out
      // by letting them fill in the whole form and rejecting it at the end —
      // which is exactly what a landlord scanning their own QR to test it
      // would hit. No new exposure: landlord ids are already public in
      // /landlord/:id profile URLs, and this endpoint already names the host.
      hostId:       String(building.landlordId),
      // Whether what they submit will be live immediately or wait for a yes.
      // Shown on the form, so nobody is surprised by a pending state.
      needsApproval: scope === 'building',
    };

    if (scope === 'unit') {
      const booking = await buildingCtrl().liveBookingForUnit(unit._id);
      const occ = occupancyOf(unit, building, booking);
      return res.json({
        invite: {
          ...base,
          unit: {
            id: String(unit._id),
            floor: unit.floor,
            floorLabel: floorLabel(unit.floor),
            roomNumber: unit.roomNumber,
            monthlyRent: unit.monthlyRent,
            ...occ,
          },
        },
      });
    }

    // Universal link — every active room, with its vacancy, for the picker.
    const units = await Unit.find({ buildingId: building._id, status: 'active' }).lean();
    const bookings = await Booking.find({
      unitId: { $in: units.map((u) => u._id) },
      status: { $nin: ['cancelled', 'completed'] },
    }).select('unitId members').lean();

    const byUnit = new Map(bookings.map((b) => [String(b.unitId), b]));
    const rooms = units
      .map((u) => ({
        id: String(u._id),
        floor: u.floor,
        floorLabel: floorLabel(u.floor),
        roomNumber: u.roomNumber,
        monthlyRent: u.monthlyRent,
        ...occupancyOf(u, building, byUnit.get(String(u._id))),
      }))
      .sort((a, b) => (a.floor - b.floor)
        || buildingCtrl().compareRoomNumbers(a.roomNumber, b.roomNumber));

    return res.json({ invite: { ...base, rooms } });
  } catch (err) {
    return next(err);
  }
}

// ── POST /api/invite/:token/submit ──────────────────────────────────────────
// The tenant's completed form. Requires a login.
async function submitOnboarding(req, res, next) {
  try {
    const found = await findByToken(req.params.token);
    if (!found) throw ApiError.notFound('এই লিংকটি আর কাজ করছে না। বাড়িওয়ালার কাছ থেকে নতুন লিংক নিন।');

    const { scope, building } = found;
    let unit = found.unit;

    if (scope === 'building') {
      if (building.inviteEnabled === false) {
        throw ApiError.badRequest('এই বিল্ডিংয়ে এখন নতুন ভাড়াটিয়া যুক্ত করা বন্ধ আছে।');
      }
      // The tenant picked a room. Confirm it is really in THIS building — the
      // unitId arrives from the client, and a unit id from someone else's
      // building would otherwise place a stranger in a stranger's room.
      const unitId = String(req.body.unitId || '');
      if (!isObjectId(unitId)) throw ApiError.badRequest('আপনার রুম/ফ্ল্যাট নির্বাচন করুন।');
      unit = await Unit.findOne({ _id: unitId, buildingId: building._id, status: 'active' });
      if (!unit) throw ApiError.badRequest('এই বিল্ডিংয়ে এই রুমটি পাওয়া যায়নি।');
    }

    // A landlord cannot onboard into their own building — they are already in
    // it, and the resulting row would put them in their own pending queue.
    if (String(building.landlordId) === String(req.user._id)) {
      throw ApiError.badRequest('এটি আপনার নিজের বিল্ডিং — আপনি নিজে ভাড়াটিয়া হিসেবে যুক্ত হতে পারবেন না।');
    }

    const name  = String(req.body.name || '').trim().slice(0, 100);
    const phone = String(req.body.phone || '').trim().slice(0, 20);
    if (!name)  throw ApiError.badRequest('আপনার নাম লিখুন।');
    if (phoneCore(phone).length < 10) throw ApiError.badRequest('সঠিক মোবাইল নম্বর লিখুন।');

    // Same sanitiser the landlord's own intake form goes through, so a
    // self-filled profile and a landlord-typed one are the same record.
    const tenantProfile = bookingCtrl().sanitiseTenantProfile(req.body.tenantProfile);

    // ARE THEY ALREADY IN THIS ROOM?
    //
    // Usually yes, in any building that was set up before this feature existed:
    // the landlord typed their name and number, buildMemberFromInput matched it
    // to their account, and they have been a linked member ever since.
    //
    // That is NOT a reason to turn the form away. They are not asking to join
    // something they are already in — they are handing over the NID, the photo
    // and the emergency contact that nobody had. And there is nothing for the
    // landlord to approve, because the landlord is the one who put them there,
    // so it applies at once even through the building-wide link.
    const existingBooking = await buildingCtrl().liveBookingForUnit(unit._id);
    const alreadyMember = activeMembers(existingBooking)
      .find((m) => m.userId && String(m.userId) === String(req.user._id));

    const pendingAlready = await TenantOnboarding.findOne({
      tenantId: req.user._id, buildingId: building._id, unitId: unit._id, status: 'pending',
    });
    if (pendingAlready) {
      throw ApiError.badRequest('আপনার আবেদন ইতিমধ্যে জমা আছে — বাড়িওয়ালার অনুমোদনের অপেক্ষায়।');
    }

    // Two things take effect immediately rather than waiting:
    //   • a UNIT link — a key, handed to one person for one room;
    //   • an ALREADY-LISTED tenant — the landlord already put them in this room,
    //     so there is no claim to check, only details to record.
    // A building link from someone nobody has listed is the one case that waits.
    const immediate = scope === 'unit' || !!alreadyMember;

    const doc = {
      landlordId: building.landlordId,
      tenantId:   req.user._id,
      buildingId: building._id,
      unitId:     unit._id,
      scope,
      tokenUsed:  found.token,
      name,
      phone,
      tenantProfile,
      moveInDate: req.body.moveInDate ? new Date(req.body.moveInDate) : new Date(),
      note:       String(req.body.note || '').trim().slice(0, 300),
      status:     immediate ? 'approved' : 'pending',
    };

    if (immediate) {
      const placed = await attachToUnit({
        landlordId: building.landlordId,
        unit,
        building,
        tenantUserId: req.user._id,
        name,
        phone,
        tenantProfile,
        moveInDate: doc.moveInDate,
      });
      doc.bookingId = placed.booking._id;
      doc.memberId  = placed.memberId;
      doc.decidedAt = new Date();
    }

    const onboarding = await TenantOnboarding.create(doc);

    await notifyLandlordOfSubmission({ onboarding, building, unit, tenantName: name });
    notifySocket(building.landlordId, 'rent:updated', {
      bookingId: doc.bookingId ? String(doc.bookingId) : null,
    });

    return res.status(201).json({ onboarding });
  } catch (err) {
    // The unique partial index is the last line of defence against a
    // double-tapped submit; report it as the same friendly message.
    if (err && err.code === 11000) {
      return next(ApiError.badRequest('আপনার আবেদন ইতিমধ্যে জমা আছে — বাড়িওয়ালার অনুমোদনের অপেক্ষায়।'));
    }
    return next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Writing an approved tenant into the room
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Put a self-onboarded tenant into a unit.
 *
 * There are THREE ways this lands, and getting the first two right is what
 * makes the feature usable in a building that already has data in it:
 *
 *   1. The landlord listed this person AND their account was already linked.
 *      buildMemberFromInput resolves a userId from the phone number at the
 *      moment the landlord types it, so this is the NORMAL case in any
 *      established building: the tenant has an account (that is how they opened
 *      the link) and the landlord typed the number correctly.
 *
 *      Their submission is not a request to join something they are already in
 *      — it is the eleven fields and the photograph nobody had yet. So it
 *      completes their record rather than being refused. Refusing it was the
 *      first version of this function, and it meant the feature collected
 *      nothing at all from precisely the buildings it was built for.
 *
 *   2. The landlord listed them, but as a PLACEHOLDER — typed months ago, or
 *      with a number that matched no account at the time. That row is who they
 *      are; their account links to it rather than creating a second row for the
 *      same human. Mirrors joinByInvite, including the photo hand-over.
 *
 *   3. Nobody listed them. They become a new member through the same
 *      placeTenantInUnit() the manual form and the AI scanner use, so seat
 *      capacity, seat labelling and rent inheritance behave identically.
 */
async function attachToUnit({
  landlordId, unit, building, tenantUserId, name, phone, tenantProfile, moveInDate,
}) {
  const booking = await buildingCtrl().liveBookingForUnit(unit._id);
  const core = phoneCore(phone);

  if (booking) {
    // (1) then (2) — an account already bound to a seat wins over a phone match,
    // because it is a fact rather than an inference.
    const linked = activeMembers(booking)
      .find((m) => m.userId && String(m.userId) === String(tenantUserId));
    const placeholder = !linked && core
      ? activeMembers(booking).find((m) => !m.userId && phoneCore(m.phone) === core)
      : null;

    const existing = linked || placeholder;

    if (existing) {
      existing.userId = tenantUserId;
      if (name) existing.name = name;
      if (phone) existing.phone = phone;

      // Their own details replace the landlord's guesswork, field by field —
      // but only where they actually filled something in, so a landlord's
      // correct entry is never wiped by a blank on the tenant's form.
      const incoming = tenantProfile || {};
      existing.tenantProfile = existing.tenantProfile || {};
      Object.keys(incoming).forEach((k) => {
        if (incoming[k] !== '' && incoming[k] != null) existing.tenantProfile[k] = incoming[k];
      });

      // THE PHOTO HAND-OVER, same rule as joinByInvite: this person has an
      // account now, so their own picture stands and the landlord's intake
      // snapshot is destroyed rather than kept. If the tenant uploaded a photo
      // on the invite form, that IS their own picture and it stays.
      const tenantUser = await User.findById(tenantUserId).select('avatar').lean();
      if (tenantUser?.avatar) existing.avatar = tenantUser.avatar;
      else if (incoming.photoUrl) existing.avatar = incoming.photoUrl;

      booking.markModified('members');
      await booking.save();
      return { booking, memberId: existing._id };
    }
  }

  const out = await buildingCtrl().placeTenantInUnit({
    landlordId,
    unit,
    building,
    input: {
      name,
      phone,
      userId: tenantUserId,
      tenantProfile,
      moveInDate: moveInDate || new Date(),
      monthlyRent: 0,
      seatLabel: '',
    },
  });
  return { booking: out.booking, memberId: out.memberId };
}

async function notifyLandlordOfSubmission({ onboarding, building, unit, tenantName }) {
  const where = `${building.name} — ${floorLabel(unit.floor)}, রুম ${unit.roomNumber}`;
  const pending = onboarding.status === 'pending';
  await notifications.emit({
    userId: building.landlordId,
    type:   'tenant_onboarding',
    title:  pending
      ? `${tenantName} যুক্ত হতে চান — অনুমোদন দিন`
      : `${tenantName} নিজের তথ্য জমা দিয়েছেন`,
    body:   pending
      ? `${where} — তথ্য জমা হয়েছে, আপনার অনুমোদনের অপেক্ষায়।`
      : `${where} — তথ্য যুক্ত হয়ে গেছে।`,
    data: {
      // WHICH SIDE THIS IS FOR. 'tenant_onboarding' is the only type that
      // travels in both directions — this one to the landlord, the approve /
      // reject pair back to the tenant — and the two belong on opposite
      // dashboards. The client cannot infer it from the recipient's roles: a
      // landlord who joined someone ELSE's building as a tenant holds both,
      // and guessing from role ownership sent them to the wrong dashboard.
      // See NotificationPanel.jsx's 'tenant_onboarding' case.
      audience:     'landlord',
      onboardingId: String(onboarding._id),
      buildingId:   String(building._id),
      unitId:       String(unit._id),
      bookingId:    onboarding.bookingId ? String(onboarding.bookingId) : null,
      status:       onboarding.status,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Host side — the pending queue
// ─────────────────────────────────────────────────────────────────────────────

// ── GET /api/invite/onboardings?status=pending ──────────────────────────────
async function listOnboardings(req, res, next) {
  try {
    const status = ['pending', 'approved', 'rejected'].includes(req.query.status)
      ? req.query.status
      : 'pending';

    const rows = await TenantOnboarding.find({ landlordId: req.user._id, status })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('unitId', 'floor roomNumber')
      .populate('buildingId', 'name')
      .lean();

    // An NID scan / intake photo is a private Cloudinary asset — the stored URL
    // 401s until it is signed, and it is signed here per response for the
    // landlord this submission was addressed to. Never stored signed.
    const cloud = require('../services/cloudinary.service');
    const onboardings = rows.map((r) => {
      const out = { ...r, id: String(r._id) };
      delete out._id;
      if (out.tenantProfile?.photoPublicId) {
        try {
          out.tenantProfile = {
            ...out.tenantProfile,
            photoUrl: cloud.signedViewUrlFor({
              publicId: out.tenantProfile.photoPublicId,
              url:      out.tenantProfile.photoUrl,
            }),
          };
        } catch { /* a broken photo must never fail the queue */ }
      }
      out.unit     = out.unitId && typeof out.unitId === 'object' ? out.unitId : null;
      out.building = out.buildingId && typeof out.buildingId === 'object' ? out.buildingId : null;
      out.unitId     = out.unit ? String(out.unit._id) : out.unitId;
      out.buildingId = out.building ? String(out.building._id) : out.buildingId;
      if (out.unit) out.unit.floorLabel = floorLabel(out.unit.floor);
      return out;
    });

    return res.json({ onboardings });
  } catch (err) {
    return next(err);
  }
}

async function ownedOnboarding(req) {
  const { id } = req.params;
  if (!isObjectId(id)) throw ApiError.notFound('আবেদনটি পাওয়া যায়নি।');
  const row = await TenantOnboarding.findOne({ _id: id, landlordId: req.user._id });
  if (!row) throw ApiError.notFound('আবেদনটি পাওয়া যায়নি।');
  return row;
}

// ── POST /api/invite/onboardings/:id/approve ────────────────────────────────
// One tap. Everything below it was typed by the tenant.
async function approveOnboarding(req, res, next) {
  try {
    const row = await ownedOnboarding(req);
    if (row.status !== 'pending') throw ApiError.badRequest('এই আবেদনের সিদ্ধান্ত ইতিমধ্যে হয়ে গেছে।');

    const unit = await Unit.findOne({ _id: row.unitId, status: 'active' });
    if (!unit) throw ApiError.badRequest('এই রুমটি আর নেই।');
    const building = await Building.findById(row.buildingId);
    if (!building) throw ApiError.badRequest('বিল্ডিংটি আর নেই।');

    // placeTenantInUnit throws a readable Bangla error when the room filled up
    // while this request was sitting in the queue — which is exactly the moment
    // a landlord needs to be told, so it is allowed through untouched.
    const placed = await attachToUnit({
      landlordId:   row.landlordId,
      unit,
      building,
      tenantUserId: row.tenantId,
      name:         row.name,
      phone:        row.phone,
      tenantProfile: row.tenantProfile ? row.tenantProfile.toObject() : {},
      moveInDate:   row.moveInDate,
    });

    row.status    = 'approved';
    row.bookingId = placed.booking._id;
    row.memberId  = placed.memberId;
    row.decidedAt = new Date();
    await row.save();

    await notifications.emit({
      userId: row.tenantId,
      type:   'tenant_onboarding',
      title:  'আপনার আবেদন অনুমোদিত হয়েছে',
      body:   `${building.name} — ${floorLabel(unit.floor)}, রুম ${unit.roomNumber} এ আপনি যুক্ত হয়েছেন।`,
      data:   {
        audience: 'tenant',
        bookingId: String(placed.booking._id),
        onboardingId: String(row._id),
      },
    });
    notifySocket(row.tenantId, 'rent:updated', { bookingId: String(placed.booking._id) });
    notifySocket(row.landlordId, 'rent:updated', { bookingId: String(placed.booking._id) });

    return res.json({ onboarding: row, bookingId: String(placed.booking._id) });
  } catch (err) {
    return next(err);
  }
}

// ── POST /api/invite/onboardings/:id/reject ─────────────────────────────────
// A decline tells the tenant. Someone who filled in a form with their NID on it
// should not be left watching a spinner that never resolves.
async function rejectOnboarding(req, res, next) {
  try {
    const row = await ownedOnboarding(req);
    if (row.status !== 'pending') throw ApiError.badRequest('এই আবেদনের সিদ্ধান্ত ইতিমধ্যে হয়ে গেছে।');

    row.status       = 'rejected';
    row.rejectReason = String(req.body.reason || '').trim().slice(0, 300);
    row.decidedAt    = new Date();
    await row.save();

    await notifications.emit({
      userId: row.tenantId,
      type:   'tenant_onboarding',
      title:  'আপনার আবেদন গ্রহণ করা হয়নি',
      body:   row.rejectReason || 'বাড়িওয়ালা আবেদনটি গ্রহণ করেননি। সঠিক রুম নির্বাচন করেছেন কিনা দেখে নিন।',
      data:   { audience: 'tenant', onboardingId: String(row._id), status: 'rejected' },
    });

    return res.json({ onboarding: row });
  } catch (err) {
    return next(err);
  }
}

// ── GET /api/invite/my-submissions ──────────────────────────────────────────
// The tenant's own view of what they sent and where it stands.
async function listMySubmissions(req, res, next) {
  try {
    const rows = await TenantOnboarding.find({ tenantId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate('unitId', 'floor roomNumber')
      .populate('buildingId', 'name')
      .select('-tenantProfile')
      .lean();
    return res.json({
      submissions: rows.map((r) => {
        const out = { ...r, id: String(r._id) };
        delete out._id;
        return out;
      }),
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getBuildingInvite,
  getUnitInvite,
  revokeBuildingInvite,
  revokeUnitInvite,
  setBuildingInviteEnabled,
  resolveInvite,
  submitOnboarding,
  listOnboardings,
  approveOnboarding,
  rejectOnboarding,
  listMySubmissions,
  // exported for tests
  attachToUnit,
  findByToken,
};
