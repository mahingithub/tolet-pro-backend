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
const ApiError      = require('../utils/ApiError');
const { getIo, emitToUser } = require('../socket');
const { invalidateInsightsCache } = require('../services/insights.service');

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
  return {
    userId,
    name,
    phone,
    avatar:    raw.avatar || '',
    rentType,
    floor:     String(raw.floor || '').trim().slice(0, 40),
    roomLabel: String(raw.roomLabel || '').trim().slice(0, 40),
    seatLabel: String(raw.seatLabel || '').trim().slice(0, 40),
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
  const prop = await require('../models/Property').findById(propertyId).select('type rentalType').lean().catch(() => null);
  return {
    type: prop?.type || '',
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
      members,
    } = req.body;

    if (!propertyId) throw ApiError.badRequest('propertyId আবশ্যক।');
    if (!leaseStart || !leaseEnd) throw ApiError.badRequest('লিজের তারিখ আবশ্যক।');
    if (new Date(leaseStart) >= new Date(leaseEnd)) {
      throw ApiError.badRequest('লিজ শুরুর তারিখ শেষের আগে হতে হবে।');
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
    const initialMembers = [];
    if (Array.isArray(members)) {
      for (const raw of members.slice(0, 200)) {
        // eslint-disable-next-line no-await-in-loop
        const m = await buildMemberFromInput(raw, { monthlyRent: rent, rentType: rentTypeDefault });
        if (m.name || m.phone) initialMembers.push(m);
      }
    }
    const inviteCode = await uniqueInviteCode();

    const booking = await Booking.create({
      landlordId:       req.user._id,
      tenantId:         linkedTenantId,
      propertyId:       propertyId,
      inquiryId:        inquiryId && isObjectId(inquiryId) ? inquiryId : null,
      property:         property || '',
      location:         location || '',
      propertyType:     req.body.propertyType || propMeta.type || '',
      tenant:           tenant || '',
      tenantPhone:      (tenantPhone && tenantPhone.trim().length >= 10) ? tenantPhone.trim() : null,
      tenantsCount:     Math.max(1, Number(tenantsCount) || 1),
      leaseStart:       new Date(leaseStart),
      leaseEnd:         new Date(leaseEnd),
      monthlyRent:      rent,
      advancePayment:   Math.max(0, Number(advancePayment) || 0),
      paymentMethod:    paymentMethod || '',
      rentDueDay:       Number(rentDueDay) || 5,
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

    return res.status(201).json({ booking });
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
      b.tenantAvatar = (b.tenantId && b.tenantId.avatar) || b.tenantAvatar || '';
      if (b.tenantId && b.tenantId._id) b.tenantId = b.tenantId._id;
      delete b._id;
      // Normalise member ids for the client (lean skips toJSON).
      if (Array.isArray(b.members)) {
        b.members.forEach((m) => { if (m && m._id) { m.id = String(m._id); delete m._id; } });
      }
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

    // Whitelist mutable fields
    const whitelist = [
      'autoReminder', 'reminderLeadDays', 'rentDueDay', 'monthlyRent',
      'notes', 'serviceCharge', 'securityDeposit', 'status',
      'tenant', 'tenantPhone', 'tenantId', 'tenantsCount',
      'advancePayment', 'paymentMethod', 'location',
    ];
    for (const key of whitelist) {
      if (req.body[key] !== undefined) {
        booking[key] = req.body[key];
      }
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
        if (!placeholder.avatar && req.user.avatar) placeholder.avatar = req.user.avatar;
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
      await booking.save();
    }

    // Let the landlord's dashboard update in realtime.
    notifySocket(booking.landlordId, 'rent:updated', { bookingId: String(booking._id) });

    return res.json({ booking, memberId: String(member._id) });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  createBooking,
  listHostBookings,
  listTenantBookings,
  updateLedger,
  undoLedger,
  updateBooking,
  cancelBooking,
  addMember,
  updateMember,
  removeMember,
  updateMemberLedger,
  undoMemberLedger,
  joinByInvite,
};