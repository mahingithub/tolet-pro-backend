'use strict';

/**
 * Booking controller — lease CRUD + rent ledger mutations.
 * ──────────────────────────────────────────────────────────────────────────
 * Replaces the TODO(backend) stubs in HostDashboard.jsx with real
 * persistence. Every handler follows the same pattern as existing
 * controllers: try/catch, ApiError, next(err).
 */

const mongoose      = require('mongoose');
const Booking       = require('../models/Booking');
const Receipt       = require('../models/Receipt');
const User          = require('../models/User');
const notifications = require('../services/notification.service');
const { applyPayment } = require('../services/bookingPayment.service');
// "One person lives in one place." Shared with invite.controller's QR paths —
// it lives in a service because invite.controller already requires this file,
// so requiring it back would be circular. See tenancy.service.js.
const { settleMoveOut, sortByRecency } = require('../services/tenancy.service');
const ApiError      = require('../utils/ApiError');
const cloud         = require('../services/cloudinary.service');
const { getIo, emitToUser } = require('../socket');
const { invalidateInsightsCache } = require('../services/insights.service');
const { idempotent } = require('../utils/idempotency');

// ─── helpers ────────────────────────────────────────────────────────────────
function isObjectId(v) {
  return mongoose.Types.ObjectId.isValid(String(v));
}

// Reduce any phone format (+880 1712-xxxxxx, 01712xxxxxx, 8801712xxxxxx) down to
// its 10-digit BD mobile core so we can match a booking's typed phone against a
// registered User's stored phone regardless of formatting.
function phoneCore(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

// Find a registered tenant's user id from a phone number. Used to link manual /
// legacy bookings to a real account so Profile / Call / Message work. Returns
// null when no account matches (unregistered tenant → no profile to open).
async function resolveUserIdByPhone(phone) {
  const core = phoneCore(phone);
  if (!core) return null;
  try {
    const user = await User.findOne({ phone: new RegExp(`${core}$`) }).select('_id').lean();
    return user?._id || null;
  } catch {
    return null;
  }
}

// CRITICAL: sockets join room `user:<id>` (socket.js → roomFor). The old code
// emitted to `io.to(String(userId))` — a raw-id room nobody is in — so tenants
// never received realtime rent/booking updates. emitToUser() targets the room
// correctly.
function notifySocket(userId, event, payload) {
  if (!userId) return;
  try {
    const io = getIo();
    if (io) emitToUser(io, String(userId), event, payload);
  } catch (err) {
    console.warn('[booking] socket emit failed:', err.message);
  }
}

// ─── multi-member helpers ─────────────────────────────────────────────────────

// Short shareable invite code (mirrors Household). Uppercase, ambiguous
// characters (I/O/0/1) removed so it's easy to read aloud / type.
function genInviteCode(len = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

// A code guaranteed not to collide with an existing booking. Falls back to a
// longer code in the astronomically unlikely event of repeated collisions.
async function uniqueInviteCode() {
  for (let i = 0; i < 6; i += 1) {
    const code = genInviteCode();
    // eslint-disable-next-line no-await-in-loop
    const exists = await Booking.exists({ inviteCode: code });
    if (!exists) return code;
  }
  return genInviteCode(9);
}

// lean() leaves _id as an ObjectId on the booking AND each member and skips the
// toJSON transform. Normalise both to a string `id` for the client (member
// ledgers are already plain objects from lean()).
function shapeBookingLean(b) {
  if (!b) return b;
  b.id = String(b._id);
  delete b._id;
  if (Array.isArray(b.members)) {
    b.members.forEach((m) => { if (m && m._id) { m.id = String(m._id); delete m._id; } });
  }
  return b;
}

// Find a member subdoc by id on a (non-lean) booking document.
function findMember(booking, memberId) {
  if (!booking || !Array.isArray(booking.members)) return null;
  try { return booking.members.id(memberId) || null; } catch { return null; }
}

// ── Tenant profile ──────────────────────────────────────────────────────────
// Keys the client is allowed to set on a tenant profile. `name`, `phone` and
// `moveInDate` are deliberately NOT here: they live on the booking / member, so
// accepting them again would create a second copy of a tenant's name that can
// silently disagree with the first.
const TENANT_PROFILE_KEYS = [
  'fatherName', 'dob', 'maritalStatus', 'permanentAddress',
  'tenantType', 'tenantTypeOther', 'organization', 'department',
  'professionalIdStatus', 'professionalIdNumber',
  'govtIdStatus', 'govtIdType', 'govtIdNumber',
  'emergencyName', 'emergencyRelation', 'emergencyAddress', 'emergencyPhone',
  'photoUrl', 'photoPublicId',
];

// Turn a stored tenant photo into something the landlord's browser can load.
// The asset is uploaded 'authenticated', so the raw URL 401s — it only works
// once signed, and we sign it per response rather than storing a signed link.
// Mutates in place because it runs over lean() rows on the way out.
function signTenantPhoto(profile) {
  if (!profile || !profile.photoPublicId) return profile;
  try {
    profile.photoUrl = cloud.signedViewUrlFor({
      publicId: profile.photoPublicId,
      url: profile.photoUrl,
    });
  } catch { /* leave the stored value; a broken photo must never fail the list */ }
  return profile;
}

// The tenant now has their own account, so the landlord's intake photo is
// retired: cleared from the record AND deleted from Cloudinary. "Removed" has
// to mean the bytes are gone, not that we stopped rendering them.
function destroyTenantPhoto(profile) {
  if (!profile) return;
  const publicId = profile.photoPublicId;
  profile.photoUrl = '';
  profile.photoPublicId = '';
  if (!publicId) return;
  Promise.resolve()
    .then(() => cloud.destroy(publicId, { resourceType: 'image', type: 'authenticated' }))
    .catch((err) => console.warn('[booking] tenant photo cleanup failed:', err.message || err));
}

// Sign every tenant photo hanging off a booking — the primary tenant's and each
// seat's. Call on the way OUT of any landlord-facing read.
function signBookingPhotos(b) {
  if (!b) return b;
  signTenantPhoto(b.tenantProfile);
  if (Array.isArray(b.members)) b.members.forEach((m) => signTenantPhoto(m && m.tenantProfile));
  return b;
}

// The schema's own enums, mirrored so junk can be DROPPED here rather than
// reaching mongoose. "The enums on the schema reject junk" was true and was the
// problem: a free-text box that let someone type "ছাত্র" into tenantType turned
// into `ছাত্র is not a valid enum value`, which failed the whole save and
// surfaced to a Bangla-speaking landlord as a raw English mongoose string. An
// unrecognised answer to an optional question is an unanswered one, not an
// error — the forms that do offer a fixed list still send exact values.
const PROFILE_ENUMS = {
  maritalStatus:        ['single', 'married', 'divorced', 'widowed'],
  tenantType:           ['student', 'employee', 'business', 'freelancer', 'other'],
  govtIdStatus:         ['has', 'none'],
  govtIdType:           ['nid', 'passport'],
  professionalIdStatus: ['has', 'none'],
};

// Nothing here is required — a tenant with no NID, no student ID and no
// permanent address is a completely valid record. We only drop keys we don't
// own and coerce to trimmed strings.
function sanitiseTenantProfile(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  TENANT_PROFILE_KEYS.forEach((k) => {
    if (raw[k] === undefined || raw[k] === null) return;
    out[k] = String(raw[k]).trim();
  });

  // Anything outside the fixed list becomes '' (unanswered) instead of a crash.
  Object.entries(PROFILE_ENUMS).forEach(([k, allowed]) => {
    if (out[k] !== undefined && !allowed.includes(out[k])) out[k] = '';
  });

  // An ID NUMBER is itself the "আছে" answer. Callers that ask the আছে/নেই
  // question outright send the status; the AI scanner's review screen only has
  // the number, and requiring a status it never collects meant every NID and
  // student ID a landlord typed there was silently deleted on the way in.
  if (out.govtIdNumber && !out.govtIdStatus) out.govtIdStatus = 'has';
  if (out.professionalIdNumber && !out.professionalIdStatus) out.professionalIdStatus = 'has';

  // "নেই" (or an unanswered question) can't leave a number behind — otherwise a
  // corrected record would keep the ID the landlord just said didn't exist.
  if (out.govtIdStatus !== 'has') { out.govtIdType = ''; out.govtIdNumber = ''; }
  if (out.professionalIdStatus !== 'has') { out.professionalIdNumber = ''; }
  return out;
}

// Build a validated member object from raw client input, applying booking /
// property defaults (Requirement 1.4, 2.5). Resolves a real userId by phone so
// Profile / Call / Message work for members who already have an account.
async function buildMemberFromInput(raw = {}, defaults = {}) {
  const name  = String(raw.name || '').trim().slice(0, 100);
  const phone = (raw.phone && String(raw.phone).trim().length >= 10) ? String(raw.phone).trim() : '';
  let userId = raw.userId && isObjectId(raw.userId) ? raw.userId : null;
  if (!userId && phone) userId = await resolveUserIdByPhone(phone);
  const rentType = ['flat', 'room', 'seat'].includes(raw.rentType)
    ? raw.rentType
    : (['flat', 'room', 'seat'].includes(defaults.rentType) ? defaults.rentType : 'flat');
  const reqRent = Number(raw.monthlyRent);
  const profile = sanitiseTenantProfile(raw.tenantProfile);
  return {
    // An occupant added with no network arrives with the id the phone gave
    // them, so the rent collected against that seat while still offline points
    // at the same person once this reaches us. Only the shape is trusted — the
    // member is embedded in a booking that is already scoped to its landlord.
    ...(isObjectId(raw.id) ? { _id: raw.id } : {}),
    userId,
    name,
    phone,
    tenantProfile: profile,
    // A landlord-supplied photo only stands in until the occupant joins with
    // the invite code and brings their own profile picture.
    avatar:    raw.avatar || profile.photoUrl || '',
    rentType,
    floor:     String(raw.floor || '').trim().slice(0, 40),
    roomLabel: String(raw.roomLabel || '').trim().slice(0, 40),
    seatLabel: String(raw.seatLabel || '').trim().slice(0, 40),
    // How many seats this member occupies. 1 = normal; >1 = full-room booking.
    seatsBooked: Math.max(1, Number(raw.seatsBooked) || 1),
    monthlyRent:     reqRent > 0 ? reqRent : (Number(defaults.monthlyRent) || 0),
    serviceCharge:   Math.max(0, Number(raw.serviceCharge) || 0),
    securityDeposit: Math.max(0, Number(raw.securityDeposit) || 0),
    joinDate:    raw.joinDate ? new Date(raw.joinDate) : new Date(),
    status:      'active',
  };
}


// Property meta used by booking creation + member defaults: `type` (flat /
// sublet / hostel / …) drives multi-member (HOSTEL) vs single-tenant; the
// `rentalType` defaults a member's rentType.
async function fetchPropertyMeta(propertyId) {
  if (!propertyId || !isObjectId(propertyId)) return { type: '', intent: '', rentalType: 'flat' };
  const prop = await require('../models/Property').findById(propertyId).select('type intent rentalType').lean().catch(() => null);
  return {
    type: prop?.type || '',
    intent: prop?.intent || '',
    rentalType: prop && ['flat', 'room', 'seat'].includes(prop.rentalType) ? prop.rentalType : 'flat',
  };
}
// Default a member's rentType from the property's rentalType (mixed → flat).
async function propertyRentTypeDefault(propertyId) {
  return (await fetchPropertyMeta(propertyId)).rentalType;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/bookings — landlord creates a booking (Convert Inquiry → Lease)
// ─────────────────────────────────────────────────────────────────────────────
async function createBooking(req, res, next) {
  try {
    const {
      inquiryId, propertyId, property, location, tenant, tenantPhone,
      tenantsCount, leaseStart, leaseEnd, monthlyRent, rentDueDay,
      reminderLeadDays, autoReminder, serviceCharge,
      securityDeposit, advancePayment, paymentMethod, notes, chatId, tenantId,
      members, floorNumber, roomNumber, dealType, commercialTerms,
      lateFeeAmount, gracePeriodDays, tenantProfile, buildingId, unitId,
    } = req.body;

    // ── Where this lease sits ────────────────────────────────────────────
    // A unit id is the real answer, and it carries its building with it. We
    // re-read both from the database rather than trusting the client's pair,
    // so a booking can never claim a room in someone else's building — and so
    // the denormalised name/floor/room below always agree with the room record.
    const Unit     = require('../models/Unit');
    const Building = require('../models/Building');
    let linkedUnit = null;
    let linkedBuilding = null;
    if (isObjectId(unitId)) {
      linkedUnit = await Unit.findOne({ _id: unitId, landlordId: req.user._id }).lean();
      if (!linkedUnit) throw ApiError.badRequest('রুমটি পাওয়া যায়নি।');
      linkedBuilding = await Building.findOne({ _id: linkedUnit.buildingId, landlordId: req.user._id }).lean();
    } else if (isObjectId(buildingId)) {
      linkedBuilding = await Building.findOne({ _id: buildingId, landlordId: req.user._id }).lean();
      if (!linkedBuilding) throw ApiError.badRequest('বিল্ডিংটি পাওয়া যায়নি।');
    }

    // Either a real unit/building, a linked listing, or a manually typed name.
    // The last of these is the legacy path and stays supported for now.
    if (!linkedBuilding && !propertyId && !(property && String(property).trim())) {
      throw ApiError.badRequest('প্রপার্টি আবশ্যক (লিস্টিং বাছুন অথবা নাম লিখুন)।');
    }
    // Lease dates are OPTIONAL, and an omitted end date means OPEN-ENDED — not
    // "assume 12 months". A tenant here moves in and stays; the landlord never
    // signs a renewal, so inventing an expiry only made the lease die on its own
    // and demand a duplicate entry for the same tenant. The tenancy runs until
    // the host hands the unit to someone else. An explicit end date (a fixed
    // commercial tenure, say) is still honoured — and still has to make sense.
    const effLeaseStart = leaseStart ? new Date(leaseStart) : new Date();
    if (Number.isNaN(effLeaseStart.getTime())) throw ApiError.badRequest('লিজ শুরুর তারিখ সঠিক নয়।');
    let effLeaseEnd = null;
    if (leaseEnd) {
      effLeaseEnd = new Date(leaseEnd);
      if (Number.isNaN(effLeaseEnd.getTime())) throw ApiError.badRequest('লিজ শেষের তারিখ সঠিক নয়।');
      if (effLeaseStart >= effLeaseEnd) {
        throw ApiError.badRequest('লিজ শুরুর তারিখ শেষের আগে হতে হবে।');
      }
    }
    const rent = Number(monthlyRent);
    if (!rent || rent <= 0) throw ApiError.badRequest('মাসিক ভাড়া ০ এর বেশি হতে হবে।');

    // Link the booking to a real tenant account. Prefer the id passed from the
    // client (inquiry-converted bookings), else resolve by phone so manual
    // "New Lease" bookings also open the tenant's profile / chat / call.
    let linkedTenantId = tenantId && isObjectId(tenantId) ? tenantId : null;
    if (!linkedTenantId && tenantPhone) {
      linkedTenantId = await resolveUserIdByPhone(tenantPhone);
    }

    // Dedup: এক inquiry-র জন্য একটাই active booking। আগে convert হয়ে থাকলে
    // নতুন duplicate না বানিয়ে সেটাই ফেরত দাও।
    if (inquiryId && isObjectId(inquiryId)) {
      const existsForInquiry = await Booking.findOne({ inquiryId, status: { $ne: 'cancelled' } });
      if (existsForInquiry) {
        return res.status(200).json({ booking: existsForInquiry, deduped: true });
      }
    }

    // Property meta drives multi-member (hostel) defaults + is denormalized onto
    // the booking. Build any initial members + a fresh invite code so occupants
    // can self-join. rentType defaults from the property.
    const propMeta = await fetchPropertyMeta(propertyId);
    const rentTypeDefault = propMeta.rentalType;

    // Residential vs commercial. Prefer the LINKED property's intent; fall back
    // to the client-provided dealType for manual (no-listing) bookings.
    const resolvedDealType = propMeta.intent === 'commercial'
      ? 'commercial'
      : (dealType === 'commercial' ? 'commercial' : 'residential');
    const ctIn = (commercialTerms && typeof commercialTerms === 'object') ? commercialTerms : {};
    const resolvedCommercialTerms = resolvedDealType === 'commercial'
      ? {
          businessName:    String(ctIn.businessName || '').slice(0, 160),
          licenseNumber:   String(ctIn.licenseNumber || '').slice(0, 60),
          leaseTermMonths: Math.max(0, Math.min(600, Number(ctIn.leaseTermMonths) || 0)),
        }
      : undefined;

    const initialMembers = [];
    if (Array.isArray(members)) {
      for (const raw of members.slice(0, 200)) {
        // eslint-disable-next-line no-await-in-loop
        const m = await buildMemberFromInput(raw, { monthlyRent: rent, rentType: rentTypeDefault });
        if (m.name || m.phone) initialMembers.push(m);
      }
    }
    const inviteCode = await uniqueInviteCode();

    // ── A lease created with no network ──────────────────────────────────
    // The phone mints the id so the tenant is REAL the moment they are written
    // down: rent can be collected against them, in their own name, before this
    // record has ever reached us. A server-issued id would have meant every
    // offline payment pointing at a placeholder that has to be rewritten later
    // — and rewriting ids under money is how ledgers get lost.
    //
    // Nothing is trusted beyond the shape: the row is still stamped with this
    // landlord's id below, so a made-up id can only ever create their own
    // booking. If it already exists, the queue is replaying a lease we already
    // took — hand back the one we have rather than failing on a duplicate key.
    const clientId = req.body.id;
    if (isObjectId(clientId)) {
      const already = await Booking.findOne({ _id: clientId, landlordId: req.user._id });
      if (already) return res.status(200).json({ booking: already, replayed: true });
    }

    const booking = await Booking.create({
      ...(isObjectId(clientId) ? { _id: clientId } : {}),
      landlordId:       req.user._id,
      tenantId:         linkedTenantId,
      propertyId:       (propertyId && isObjectId(propertyId)) ? propertyId : null,
      inquiryId:        inquiryId && isObjectId(inquiryId) ? inquiryId : null,
      // The relationship. `property` below is now a display label, kept in sync
      // with the building's name but never used to find anything.
      buildingId:       linkedBuilding ? linkedBuilding._id : null,
      unitId:           linkedUnit ? linkedUnit._id : null,
      property:         (linkedBuilding && linkedBuilding.name) || property || '',
      location:         (linkedBuilding && linkedBuilding.address) || location || '',
      propertyType:     req.body.propertyType || propMeta.type || '',
      dealType:         resolvedDealType,
      ...(resolvedCommercialTerms ? { commercialTerms: resolvedCommercialTerms } : {}),
      // Denormalised from the unit when there is one — the room record is the
      // truth, and a booking that disagreed with it is how "room 301" ended up
      // meaning two different rooms.
      floorNumber:      linkedUnit ? String(linkedUnit.floor) : (floorNumber || ''),
      roomNumber:       linkedUnit ? linkedUnit.roomNumber : (roomNumber || ''),
      tenant:           tenant || '',
      tenantPhone:      (tenantPhone && tenantPhone.trim().length >= 10) ? tenantPhone.trim() : null,
      tenantProfile:    sanitiseTenantProfile(tenantProfile),
      tenantsCount:     Math.max(1, Number(tenantsCount) || 1),
      leaseStart:       effLeaseStart,
      leaseEnd:         effLeaseEnd,
      monthlyRent:      rent,
      advancePayment:   Math.max(0, Number(advancePayment) || 0),
      paymentMethod:    paymentMethod || '',
      rentDueDay:       Number(rentDueDay) || 5,
      // Late fee is opt-in: absent / 0 / junk ⇒ no fee is ever charged and the
      // reminders never mention one. Capped so a typo can't invent a ৳9,99,999 fee.
      lateFeeAmount:    Math.max(0, Math.min(100000, Number(lateFeeAmount) || 0)),
      // `?? 5` never fired: Number(undefined) is NaN, and ?? only catches
      // null/undefined — so a booking created without this field failed
      // validation outright ("Cast to Number failed for value NaN"). Written
      // this way rather than `|| 5` because an explicit 0 is a real answer:
      // rent is late from the day it is due.
      gracePeriodDays:  Math.max(0, Math.min(28, Number.isFinite(Number(gracePeriodDays)) ? Number(gracePeriodDays) : 5)),
      reminderLeadDays: Number(reminderLeadDays) || 3,
      autoReminder:     autoReminder !== false,
      serviceCharge:    Number(serviceCharge) || 0,
      securityDeposit:  Number(securityDeposit) || 0,
      notes:            notes || '',
      chatId:           chatId || '',
      members:          initialMembers,
      inviteCode,
    });

    // Property-কে rented mark করি যেন public listing থেকে সরে যায় + reload-এও থাকে।
    if (isObjectId(propertyId)) {
      const Property = require('../models/Property');
      await Property.updateOne(
        { _id: propertyId },
        // Stamp rentedAt so the cleanup sweep can retire this listing a few
        // days from now. It stays visible (badged "rented") until then.
        { $set: { status: 'rented', availabilityStatus: 'rented', rentedAt: new Date() } },
      ).catch(() => {});

      // The listing just dropped out of public search (listProperties filters
      // on status 'active' + availabilityStatus not rented/booked). Without this
      // it would keep showing as available in cached search pages, and other
      // tenants would keep enquiring about a place that is already taken.
      //
      // The slug isn't loaded on this path, so only the _id form of the detail
      // key is cleared here; a slug-keyed entry expires on its own 10-min TTL.
      await require('../services/cacheInvalidation').onPropertyChanged({
        id: String(propertyId),
        affectsCounts: true, // active → rented moves two overview buckets
      });
    }

    // If converted from an inquiry, mark it 'final_booking' AND tell the tenant
    // in realtime so their timeline flips to "Deal Confirmed 🎉" without a refresh.
    if (inquiryId && isObjectId(inquiryId)) {
      const inquiryHelper = require('../services/inquiry.helper');
      const updatedInq = await inquiryHelper
        .updateInquiryStatus(inquiryId, 'final_booking', req.user._id)
        .catch(() => null);

      if (updatedInq && updatedInq.inquirerUserId) {
        notifySocket(updatedInq.inquirerUserId, 'inquiry:status_updated', {
          inquiryId: String(updatedInq._id),
          status:    'final_booking',
        });
        notifySocket(updatedInq.inquirerUserId, 'rent:updated', {
          bookingId: String(booking._id),
        });
      }
    }

    // Invalidate insights cache so the host sees fresh analytics.
    invalidateInsightsCache(req.user._id);

    // Hand back a signed photo link so the card the host just created can show
    // the picture without waiting for a reload.
    const out = booking.toJSON();
    signBookingPhotos(out);
    return res.status(201).json({ booking: out });
  } catch (err) {
    return next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bookings/host — landlord's bookings (cancelled excluded)
// ─────────────────────────────────────────────────────────────────────────────
async function listHostBookings(req, res, next) {
  try {
    const bookings = await Booking.find({ landlordId: req.user._id, status: { $ne: 'cancelled' } })
      .populate('tenantId', 'avatar')
      .sort({ createdAt: -1 })
      .lean();

    // Self-healing backfill: legacy / manual bookings that were saved before a
    // tenant account existed (or without a linked id) get their tenantId
    // resolved by phone now, then persisted so Profile / Call / Message work.
    const needsResolve = bookings.filter(b => !b.tenantId && b.tenantPhone);
    if (needsResolve.length) {
      await Promise.all(needsResolve.map(async (b) => {
        const uid = await resolveUserIdByPhone(b.tenantPhone);
        if (uid) {
          b.tenantId = uid;
          Booking.updateOne({ _id: b._id }, { $set: { tenantId: uid } }).catch(() => {});
        }
      }));
    }

    bookings.forEach(b => {
      b.id = String(b._id);
      // A linked account's own avatar always beats the landlord's intake photo.
      b.tenantAvatar = (b.tenantId && b.tenantId.avatar) || b.tenantAvatar || '';
      if (b.tenantId && b.tenantId._id) b.tenantId = b.tenantId._id;
      delete b._id;
      // Normalise member ids for the client (lean skips toJSON).
      if (Array.isArray(b.members)) {
        b.members.forEach((m) => { if (m && m._id) { m.id = String(m._id); delete m._id; } });
      }
      // Intake photos are private assets — sign them for THIS landlord, who
      // owns the booking. Nobody else ever receives a loadable link.
      signBookingPhotos(b);
    });
    return res.json({ bookings });
  } catch (err) {
    return next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bookings/tenant — tenant's bookings (by tenantId OR phone match)
// ─────────────────────────────────────────────────────────────────────────────
async function listTenantBookings(req, res, next) {
  try {
    // Match the viewer as the single tenant OR as one of the booking's members
    // (by linked userId or by phone).
    const conditions = [{ tenantId: req.user._id }, { 'members.userId': req.user._id }];
    if (req.user.phone) {
      conditions.push({ tenantPhone: req.user.phone });
      conditions.push({ 'members.phone': req.user.phone });
    }
    const bookings = await Booking.find({ $or: conditions, status: { $ne: 'cancelled' } })
      .sort({ createdAt: -1 })
      .lean();

    const myPhoneCore = phoneCore(req.user.phone);
    bookings.forEach(b => {
      b.id = String(b._id);
      delete b._id;

      // ── IS THIS STILL MY HOME? ──────────────────────────────────────────
      // The query above matches every booking this person was EVER attached
      // to, and it has to: their member row is not deleted when they move out,
      // because the rent ledger and receipts hang off it and the landlord is
      // entitled to "who was in 301 last winter".
      //
      // What was missing is any way for the dashboard to tell the two apart.
      // It filtered on `b.status !== 'cancelled'` — the BOOKING's status, not
      // the viewer's own — so a tenant who had moved out months ago still saw
      // a live rent card for the old room, with its dues counted in their
      // total. Move somewhere new and you had two. That is the duplicate-card
      // bug, and it is answered here rather than in the UI so every consumer
      // (overview, payments, alerts, dues) gets the same answer.
      const mineRow = (b.members || []).find((m) => (m.userId && String(m.userId) === String(req.user._id))
        || (myPhoneCore && phoneCore(m.phone) === myPhoneCore));
      const closedBooking = b.status === 'completed' || b.status === 'cancelled';
      b.myMembership = {
        memberId:    mineRow ? String(mineRow._id || mineRow.id) : null,
        // A legacy single-tenant booking has no member row; the booking's own
        // status is the only thing that can have ended it.
        status:      mineRow ? (mineRow.status || 'active') : (closedBooking ? 'moved-out' : 'active'),
        moveOutDate: mineRow ? (mineRow.moveOutDate || null) : (closedBooking ? (b.leaseEnd || null) : null),
        // WHERE + WHAT THIS PERSON RENTS. Resolved once, here, so every tenant
        // surface names the same unit and quotes the same rent. A member's own
        // labels describe the seat they pay for; the booking's describe the
        // whole flat, and are only the right answer on a single-tenant lease.
        rentType:      mineRow ? (mineRow.rentType || 'flat') : (b.roomNumber ? 'room' : 'flat'),
        floor:         String((mineRow && mineRow.floor)     || b.floorNumber || '').trim(),
        roomLabel:     String((mineRow && mineRow.roomLabel) || b.roomNumber  || '').trim(),
        seatLabel:     String((mineRow && mineRow.seatLabel) || '').trim(),
        monthlyRent:   mineRow ? (Number(mineRow.monthlyRent) || Number(b.monthlyRent) || 0) : (Number(b.monthlyRent) || 0),
        serviceCharge: mineRow
          ? (mineRow.serviceCharge != null && mineRow.serviceCharge !== 0 ? Number(mineRow.serviceCharge) || 0 : Number(b.serviceCharge) || 0)
          : (Number(b.serviceCharge) || 0),
      };
      b.isPastTenancy = b.myMembership.status === 'moved-out' || closedBooking;
      // Viewer scoping (Requirement 7.3): a tenant only sees THEIR OWN member
      // ledger. Co-tenants stay visible for context (name/space) but their
      // financial ledger is stripped so one occupant can't read another's rent.
      if (Array.isArray(b.members) && b.members.length) {
        b.members = b.members.map((m) => {
          const id = m && m._id ? String(m._id) : m.id;
          const isMine = (m.userId && String(m.userId) === String(req.user._id))
            || (myPhoneCore && phoneCore(m.phone) === myPhoneCore);
          if (isMine) {
            return { ...m, id, _id: undefined };
          }
          return {
            id,
            name: m.name,
            avatar: m.avatar,
            rentType: m.rentType,
            floor: m.floor,
            roomLabel: m.roomLabel,
            seatLabel: m.seatLabel,
            status: m.status,
          };
        });
      }
    });

    // ── WHICH ONE IS HOME RIGHT NOW ─────────────────────────────────────────
    // A person lives in one place. When several tenancies are still open —
    // because a landlord never closed the old row, or because the tenant came
    // in through a path that predates settleMoveOut — the most recently
    // started one is the home they are in, and the rest are places they have
    // left but nobody stamped.
    //
    // Marked rather than filtered: those older rows still hold the tenant's
    // rent history and receipts, and the Payments tab lists them as previous
    // homes. Hiding them here would look like deleted records.
    //
    // Answered on the server so the overview, the Payments tab, the dues total
    // and Smart Alerts cannot each pick a different "current".
    const live = bookings.filter((b) => !b.isPastTenancy);
    const currentId = live.length
      ? sortByRecency(live, req.user._id, req.user.phone)[0].id
      : null;
    bookings.forEach((b) => {
      b.isCurrentHome = !b.isPastTenancy && b.id === currentId;
      // An open row that is NOT the current home: presumed left, not stamped.
      // The UI says "previous home" for these but keeps them distinguishable
      // from a properly closed tenancy, because this one is an inference.
      b.isSupersededTenancy = !b.isPastTenancy && b.id !== currentId;
    });

    return res.json({ bookings });
  } catch (err) {
    return next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/bookings/:id/ledger/:monthKey — mark rent paid/partial/due
// ─────────────────────────────────────────────────────────────────────────────
async function updateLedger(req, res, next) {
  try {
    const { id, monthKey } = req.params;
    if (!isObjectId(id)) throw ApiError.notFound('বুকিং পাওয়া যায়নি।');
    if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) {
      throw ApiError.badRequest('মাসের ফর্ম্যাট: YYYY-MM');
    }

    const booking = await Booking.findById(id);
    if (!booking) throw ApiError.notFound('বুকিং পাওয়া যায়নি।');
    if (String(booking.landlordId) !== String(req.user._id)) {
      throw ApiError.forbidden('এই বুকিং আপনার নয়।');
    }

    // All ledger writes (manual here + gateway webhook later) go through the
    // shared helper, so the ledger row, receipt, and tenant notification stay
    // perfectly consistent between the two paths.
    const updated = await applyPayment({
      booking,
      monthKey,
      source: 'manual',
      payment: {
        status:        req.body.status || 'full',
        paidOn:        req.body.paidOn,
        method:        req.body.method,
        txnId:         req.body.txnId,
        // What arrived THIS time. applyPayment folds it into whatever the month
        // already holds and derives the total itself — the whole point of the
        // accumulate fix, which never actually ran over HTTP because this field
        // was left out of the hand-written list below. Without it the server
        // stores whatever total the client worked out, which is wrong the
        // moment two people record against the same month (a landlord's queued
        // collection and the tenant's own payment, say).
        amountReceived: req.body.amountReceived,
        amount:        req.body.amount,
        balance:       req.body.balance,
        lateFee:       req.body.lateFee,
        dueNote:       req.body.dueNote,
        expectedPayBy: req.body.expectedPayBy,
        monthLabel:    req.body.monthLabel,
        totalDue:      req.body.totalDue,
      },
    });

    return res.json({ booking: updated });
  } catch (err) {
    return next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/bookings/:id/ledger/:monthKey — undo a payment record
// ─────────────────────────────────────────────────────────────────────────────
async function undoLedger(req, res, next) {
  try {
    const { id, monthKey } = req.params;
    if (!isObjectId(id)) throw ApiError.notFound('বুকিং পাওয়া যায়নি।');

    const booking = await Booking.findById(id);
    if (!booking) throw ApiError.notFound('বুকিং পাওয়া যায়নি।');
    if (String(booking.landlordId) !== String(req.user._id)) {
      throw ApiError.forbidden('এই বুকিং আপনার নয়।');
    }

    booking.ledger.delete(monthKey);
    await booking.save();

    // Remove receipt
    await Receipt.deleteOne({ bookingId: booking._id, monthKey }).catch(() => {});

    const updated = await Booking.findById(id).lean();
    if (updated) { updated.id = String(updated._id); delete updated._id; }
    return res.json({ booking: updated });
  } catch (err) {
    return next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/bookings/:id — update booking settings
// ─────────────────────────────────────────────────────────────────────────────
async function updateBooking(req, res, next) {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) throw ApiError.notFound('বুকিং পাওয়া যায়নি।');

    const booking = await Booking.findById(id);
    if (!booking) throw ApiError.notFound('বুকিং পাওয়া যায়নি।');
    if (String(booking.landlordId) !== String(req.user._id)) {
      throw ApiError.forbidden('এই বুকিং আপনার নয়।');
    }

    // Whitelist mutable fields.
    // leaseStart / leaseEnd are editable so the host can (a) renew a tenancy in
    // place and (b) CLOSE ONE OUT when the tenant leaves early — the tenant-change
    // flow pulls leaseEnd back to the move-out date and flips status to
    // 'completed', which retires the lease without deleting its rent history.
    const whitelist = [
      'autoReminder', 'reminderLeadDays', 'rentDueDay', 'monthlyRent',
      'notes', 'serviceCharge', 'securityDeposit', 'status',
      'tenant', 'tenantPhone', 'tenantId', 'tenantsCount',
      'advancePayment', 'paymentMethod', 'location',
      'floorNumber', 'roomNumber', 'propertyType',
      'leaseStart', 'leaseEnd',
      // The landlord can now CORRECT a saved lease, not only re-let it, so the
      // rest of what the lease form owns has to be writable too. Without these
      // an edit was accepted by the client and quietly dropped here — the name
      // changed on screen and reverted on the next reload.
      //
      // tenantProfile matters most: NID, profession, address and emergency
      // contact are exactly the fields a landlord fills in a hurry and needs to
      // put right later. It is a real subdocument, so assigning the object
      // replaces it wholesale — the client always sends the complete profile.
      'property', 'commercialTerms', 'tenantProfile',
      // Late-fee terms stay editable — a landlord can add one later, or drop it
      // back to 0 to stop charging it.
      'lateFeeAmount', 'gracePeriodDays',
    ];
    const DATE_FIELDS = new Set(['leaseStart', 'leaseEnd']);
    for (const key of whitelist) {
      if (req.body[key] === undefined) continue;
      if (DATE_FIELDS.has(key)) {
        // An explicitly empty leaseEnd means OPEN-ENDED — the host dropped the
        // expiry so the tenancy simply keeps running. leaseStart is required, so
        // clearing that one stays an error.
        if (req.body[key] === null || req.body[key] === '') {
          if (key === 'leaseStart') throw ApiError.badRequest('লিজ শুরুর তারিখ আবশ্যক।');
          booking[key] = null;
          continue;
        }
        const d = new Date(req.body[key]);
        if (Number.isNaN(d.getTime())) throw ApiError.badRequest('লিজের তারিখ সঠিক নয়।');
        booking[key] = d;
        continue;
      }
      // commercialTerms is a NESTED OBJECT, not a subdocument, so Mongoose does
      // not reliably notice a whole-object assignment. Merge onto what is there
      // (a patch that omits licenceNumber must not erase it) and say so
      // explicitly, or the save is a no-op that reports success.
      if (key === 'commercialTerms') {
        const incoming = req.body[key] || {};
        if (typeof incoming !== 'object') continue;
        const current = booking.commercialTerms?.toObject?.() || booking.commercialTerms || {};
        booking.commercialTerms = { ...current, ...incoming };
        booking.markModified('commercialTerms');
        continue;
      }
      booking[key] = req.body[key];
    }
    // Keep the term coherent: a lease can't end before it starts.
    if (booking.leaseEnd && booking.leaseStart && booking.leaseEnd < booking.leaseStart) {
      throw ApiError.badRequest('লিজ শেষের তারিখ শুরুর আগে হতে পারে না।');
    }

    await booking.save();

    // Notify Tenant about rent/booking update (room-correct emit).
    if (booking.tenantId) {
      notifySocket(booking.tenantId, 'rent:updated', { bookingId: String(booking._id) });

      notifications.emit({
        userId: booking.tenantId,
        type:   'rent_updated',
        title:  'আপনার ভাড়ার তথ্য আপডেট করা হয়েছে।',
        body:   'ল্যান্ডলর্ড আপনার ভাড়ার তথ্য আপডেট করেছেন।',
        data:   { bookingId: String(booking._id) },
      });
    }

    return res.json({ booking });
  } catch (err) {
    return next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/bookings/:id — landlord "Delete / Exclude" a booking (SOFT delete)
// ─────────────────────────────────────────────────────────────────────────────
// We DON'T wipe the row: receipts, disputes, and revenue stats depend on the
// history. We flip status to 'cancelled' (excluded from host + tenant lists).
// NOTE: this intentionally does NOT re-list the property — if the host wants
// the unit back on the market they can re-activate it from the Properties tab.
async function cancelBooking(req, res, next) {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) throw ApiError.notFound('বুকিং পাওয়া যায়নি।');

    const booking = await Booking.findById(id);
    if (!booking) throw ApiError.notFound('বুকিং পাওয়া যায়নি।');
    if (String(booking.landlordId) !== String(req.user._id)) {
      throw ApiError.forbidden('এই বুকিং আপনার নয়।');
    }

    await Booking.updateOne({ _id: id }, { $set: { status: 'cancelled' } });

    // Drop the active card from the tenant's dashboard in realtime.
    notifySocket(booking.tenantId, 'rent:updated', {
      bookingId: String(booking._id),
      status:    'cancelled',
    });

    return res.json({ success: true, id: String(booking._id) });
  } catch (err) {
    return next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/bookings/:id/members — add an occupant to a booking
// ─────────────────────────────────────────────────────────────────────────────
async function addMember(req, res, next) {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) throw ApiError.notFound('বুকিং পাওয়া যায়নি।');

    const booking = await Booking.findById(id);
    if (!booking) throw ApiError.notFound('বুকিং পাওয়া যায়নি।');
    if (String(booking.landlordId) !== String(req.user._id)) {
      throw ApiError.forbidden('এই বুকিং আপনার নয়।');
    }

    // Already here? The phone is replaying an occupant we have taken before
    // (its dedupe record can expire; the seat it created does not).
    if (isObjectId(req.body.id) && booking.members.id(req.body.id)) {
      return res.status(200).json({ booking, replayed: true });
    }

    const rentTypeDefault = await propertyRentTypeDefault(booking.propertyId);
    const memberDoc = await buildMemberFromInput(req.body, {
      monthlyRent: booking.monthlyRent,
      rentType:    rentTypeDefault,
    });
    if (!memberDoc.name && !memberDoc.phone) {
      throw ApiError.badRequest('সদস্যের নাম অথবা ফোন আবশ্যক।');
    }

    booking.members.push(memberDoc);
    if (!booking.inviteCode) booking.inviteCode = await uniqueInviteCode();
    await booking.save();

    const created = booking.members[booking.members.length - 1];
    // Tell a linked member (real account) they were added — realtime + bell.
    if (created.userId) {
      notifySocket(created.userId, 'rent:updated', { bookingId: String(booking._id) });
      notifications.emit({
        userId: created.userId,
        type:   'rent_updated',
        title:  'আপনাকে একটি ভাড়ায় যুক্ত করা হয়েছে।',
        body:   `${booking.property || 'একটি প্রপার্টিতে'} আপনাকে সদস্য হিসেবে যুক্ত করা হয়েছে।`,
        data:   { bookingId: String(booking._id), memberId: String(created._id) },
      });
    }

    invalidateInsightsCache(req.user._id);
    return res.status(201).json({ booking });
  } catch (err) {
    return next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/bookings/:id/members/:memberId — edit an occupant
// ─────────────────────────────────────────────────────────────────────────────
async function updateMember(req, res, next) {
  try {
    const { id, memberId } = req.params;
    if (!isObjectId(id)) throw ApiError.notFound('বুকিং পাওয়া যায়নি।');

    const booking = await Booking.findById(id);
    if (!booking) throw ApiError.notFound('বুকিং পাওয়া যায়নি।');
    if (String(booking.landlordId) !== String(req.user._id)) {
      throw ApiError.forbidden('এই বুকিং আপনার নয়।');
    }
    const member = findMember(booking, memberId);
    if (!member) throw ApiError.notFound('সদস্য পাওয়া যায়নি।');

    const whitelist = [
      'name', 'phone', 'avatar', 'rentType', 'floor', 'roomLabel', 'seatLabel',
      'monthlyRent', 'serviceCharge', 'securityDeposit', 'joinDate', 'moveOutDate', 'status',
    ];
    for (const key of whitelist) {
      if (req.body[key] !== undefined) member[key] = req.body[key];
    }
    // If a phone was (re)set and no account is linked yet, try to link one.
    if (req.body.phone !== undefined && !member.userId && member.phone) {
      const uid = await resolveUserIdByPhone(member.phone);
      if (uid) member.userId = uid;
    }

    await booking.save();
    if (member.userId) {
      notifySocket(member.userId, 'rent:updated', { bookingId: String(booking._id), memberId: String(member._id) });
    }
    return res.json({ booking });
  } catch (err) {
    return next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/bookings/:id/members/:memberId — move a member out (soft) or
// hard-remove (?hard=true, e.g. added by mistake).
// ─────────────────────────────────────────────────────────────────────────────
async function removeMember(req, res, next) {
  try {
    const { id, memberId } = req.params;
    if (!isObjectId(id)) throw ApiError.notFound('বুকিং পাওয়া যায়নি।');

    const booking = await Booking.findById(id);
    if (!booking) throw ApiError.notFound('বুকিং পাওয়া যায়নি।');
    if (String(booking.landlordId) !== String(req.user._id)) {
      throw ApiError.forbidden('এই বুকিং আপনার নয়।');
    }
    const member = findMember(booking, memberId);
    if (!member) throw ApiError.notFound('সদস্য পাওয়া যায়নি।');

    const linkedUserId = member.userId;
    if (req.query.hard === 'true') {
      // Hard delete — wipe the member and their receipts (mistaken add).
      booking.members.pull(memberId);
      await Receipt.deleteMany({ bookingId: booking._id, memberId }).catch(() => {});
    } else {
      // Soft move-out — keep rent history for records (Requirement 6.3).
      member.status = 'moved-out';
      member.moveOutDate = new Date();
    }
    await booking.save();

    if (linkedUserId) {
      notifySocket(linkedUserId, 'rent:updated', { bookingId: String(booking._id) });
    }
    return res.json({ booking });
  } catch (err) {
    return next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/bookings/:id/members/:memberId/ledger/:monthKey — mark a member's
// rent paid/partial/due for a month.
// ─────────────────────────────────────────────────────────────────────────────
async function updateMemberLedger(req, res, next) {
  try {
    const { id, memberId, monthKey } = req.params;
    if (!isObjectId(id)) throw ApiError.notFound('বুকিং পাওয়া যায়নি।');
    if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) {
      throw ApiError.badRequest('মাসের ফর্ম্যাট: YYYY-MM');
    }

    const booking = await Booking.findById(id);
    if (!booking) throw ApiError.notFound('বুকিং পাওয়া যায়নি।');
    if (String(booking.landlordId) !== String(req.user._id)) {
      throw ApiError.forbidden('এই বুকিং আপনার নয়।');
    }
    const member = findMember(booking, memberId);
    if (!member) throw ApiError.notFound('সদস্য পাওয়া যায়নি।');

    // Same shared write path as legacy — ledger row + receipt + notify stay
    // consistent; passing `member` scopes it all to this occupant.
    const updated = await applyPayment({
      booking,
      member,
      monthKey,
      source: 'manual',
      payment: {
        status:        req.body.status || 'full',
        paidOn:        req.body.paidOn,
        method:        req.body.method,
        txnId:         req.body.txnId,
        // What arrived THIS time. applyPayment folds it into whatever the month
        // already holds and derives the total itself — the whole point of the
        // accumulate fix, which never actually ran over HTTP because this field
        // was left out of the hand-written list below. Without it the server
        // stores whatever total the client worked out, which is wrong the
        // moment two people record against the same month (a landlord's queued
        // collection and the tenant's own payment, say).
        amountReceived: req.body.amountReceived,
        amount:        req.body.amount,
        balance:       req.body.balance,
        lateFee:       req.body.lateFee,
        dueNote:       req.body.dueNote,
        expectedPayBy: req.body.expectedPayBy,
        monthLabel:    req.body.monthLabel,
        totalDue:      req.body.totalDue,
      },
    });

    if (member.userId) {
      notifySocket(member.userId, 'rent:updated', { bookingId: String(booking._id), memberId: String(member._id) });
    }
    return res.json({ booking: updated });
  } catch (err) {
    return next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/bookings/:id/members/:memberId/ledger/:monthKey — undo a member's
// payment record for a month.
// ─────────────────────────────────────────────────────────────────────────────
async function undoMemberLedger(req, res, next) {
  try {
    const { id, memberId, monthKey } = req.params;
    if (!isObjectId(id)) throw ApiError.notFound('বুকিং পাওয়া যায়নি।');

    const booking = await Booking.findById(id);
    if (!booking) throw ApiError.notFound('বুকিং পাওয়া যায়নি।');
    if (String(booking.landlordId) !== String(req.user._id)) {
      throw ApiError.forbidden('এই বুকিং আপনার নয়।');
    }
    const member = findMember(booking, memberId);
    if (!member) throw ApiError.notFound('সদস্য পাওয়া যায়নি।');

    member.ledger.delete(monthKey);
    booking.markModified('members');
    await booking.save();
    await Receipt.deleteOne({ bookingId: booking._id, memberId: member._id, monthKey }).catch(() => {});

    if (member.userId) {
      notifySocket(member.userId, 'rent:updated', { bookingId: String(booking._id), memberId: String(member._id) });
    }
    const updated = shapeBookingLean(await Booking.findById(id).lean());
    return res.json({ booking: updated });
  } catch (err) {
    return next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/bookings/join — a tenant self-joins a booking with an invite code.
// Links to a phone-matched placeholder member, or creates a new member.
// ─────────────────────────────────────────────────────────────────────────────
async function joinByInvite(req, res, next) {
  try {
    const code = String(req.body.inviteCode || '').trim().toUpperCase();
    if (!code) throw ApiError.badRequest('ইনভাইট কোড আবশ্যক।');

    const booking = await Booking.findOne({ inviteCode: code, status: { $ne: 'cancelled' } });
    if (!booking) throw ApiError.notFound('এই কোডে কোনো বুকিং পাওয়া যায়নি।');

    // Already joined?
    let member = booking.members.find((m) => m.userId && String(m.userId) === String(req.user._id)) || null;

    if (!member) {
      // Match a placeholder occupant by phone, else add a brand-new member.
      const myPhoneCore = phoneCore(req.user.phone);
      const placeholder = myPhoneCore
        ? booking.members.find((m) => !m.userId && phoneCore(m.phone) === myPhoneCore)
        : null;

      if (placeholder) {
        placeholder.userId = req.user._id;
        if (!placeholder.name && req.user.name) placeholder.name = req.user.name;
        // THE PHOTO HAND-OVER. Until now this seat showed a picture the landlord
        // took at intake. This person now has an account, so their own profile
        // picture takes over and the landlord's copy is DELETED — not hidden.
        // (This used to read `if (!placeholder.avatar)`, which did the opposite:
        // the landlord's snapshot stuck permanently and the tenant's real
        // profile picture was never shown.)
        if (req.user.avatar) placeholder.avatar = req.user.avatar;
        if (placeholder.tenantProfile) {
          destroyTenantPhoto(placeholder.tenantProfile);
        }
        member = placeholder;
      } else {
        booking.members.push({
          userId:      req.user._id,
          name:        req.user.name || '',
          phone:       req.user.phone || '',
          avatar:      req.user.avatar || '',
          rentType:    await propertyRentTypeDefault(booking.propertyId),
          monthlyRent: booking.monthlyRent || 0,
          status:      'active',
        });
        member = booking.members[booking.members.length - 1];
      }

      // Same hand-over for a single-tenant lease (a flat or a room, which has
      // no seats): if the person joining IS the primary tenant, the landlord's
      // intake photo is deleted here too and their account takes over.
      const isPrimaryTenant = (booking.tenantId && String(booking.tenantId) === String(req.user._id))
        || (phoneCore(booking.tenantPhone) && phoneCore(booking.tenantPhone) === phoneCore(req.user.phone));
      if (isPrimaryTenant) {
        if (!booking.tenantId) booking.tenantId = req.user._id;
        if (booking.tenantProfile) destroyTenantPhoto(booking.tenantProfile);
      }

      await booking.save();

      // ── THEY LIVE HERE NOW ────────────────────────────────────────────────
      // Everywhere they used to live is now somewhere they used to live.
      //
      // THIS LINE WAS MISSING. The QR / link onboarding paths have always
      // called settleMoveOut, so a tenant who joined that way ended up with
      // exactly one home. A tenant who joined by CODE — this path, the "Add
      // code" button on their dashboard — kept every previous landlord's
      // booking live: four rent cards, four sets of dues, alerts for rooms
      // they left months ago. Same user action, two different outcomes,
      // decided by which door they came through.
      //
      // Only on a genuinely NEW membership (inside this `if`). Re-entering
      // your own code, or a page that retries the request, must not read as
      // moving house all over again.
      await settleMoveOut({
        tenantUserId:  req.user._id,
        tenantPhone:   req.user.phone,
        tenantName:    req.user.name || member.name || 'ভাড়াটিয়া',
        keepBookingId: booking._id,
        when:          new Date(),
        reason:        `${req.user.name || 'ভাড়াটিয়া'} নতুন বাসায় উঠেছেন।`,
      });
    }

    // Let the landlord's dashboard update in realtime.
    notifySocket(booking.landlordId, 'rent:updated', { bookingId: String(booking._id) });

    return res.json({ booking, memberId: String(member._id) });
  } catch (err) {
    return next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Offline write dedupe
// ─────────────────────────────────────────────────────────────────────────────
// A landlord records rent while walking the building, where the signal dies.
// Those writes queue on the phone and replay on reconnect, so the same one can
// reach us twice — and applyPayment ACCUMULATES, meaning a duplicate ৳5,000
// would become ৳10,000 collected. Every mutation below is therefore claimed by
// its `X-Op-Id` exactly once (utils/idempotency.js).
//
// The answer to a repeat is the booking as it stands now: the phone's queue
// wants a current snapshot, and it makes no difference to it whether this
// particular request was the one that did the work.
async function replayBooking(req, res) {
  const id = req.params.id || (req.body && req.body.id);
  const booking = isObjectId(id)
    ? await Booking.findOne({ _id: id, landlordId: req.user._id })
    : null;
  return res.json({ booking: booking || null, replayed: true });
}

module.exports = {
  createBooking: idempotent(createBooking, replayBooking),
  listHostBookings,
  listTenantBookings,
  updateLedger: idempotent(updateLedger, replayBooking),
  undoLedger: idempotent(undoLedger, replayBooking),
  updateBooking: idempotent(updateBooking, replayBooking),
  cancelBooking: idempotent(cancelBooking, async (req, res) => res.json({ success: true, replayed: true })),
  addMember: idempotent(addMember, replayBooking),
  updateMember: idempotent(updateMember, replayBooking),
  removeMember: idempotent(removeMember, replayBooking),
  updateMemberLedger: idempotent(updateMemberLedger, replayBooking),
  undoMemberLedger: idempotent(undoMemberLedger, replayBooking),
  joinByInvite,
  // Shared with building.controller.js, which puts tenants INTO units. Exported
  // rather than duplicated so there is one definition of what a member is and
  // one sanitiser for a tenant profile — two copies would drift, and the
  // "who counts as an occupant" rules are exactly where that hurts.
  buildMemberFromInput,
  sanitiseTenantProfile,
  findMember,
  uniqueInviteCode,
};