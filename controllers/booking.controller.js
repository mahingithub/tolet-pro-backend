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
const Inquiry       = require('../models/Inquiry');
const notifications = require('../services/notification.service');
const { applyPayment } = require('../services/bookingPayment.service');
const ApiError      = require('../utils/ApiError');

// ─── helpers ────────────────────────────────────────────────────────────────
function isObjectId(v) {
  return mongoose.Types.ObjectId.isValid(String(v));
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/bookings — landlord creates a booking (Convert Inquiry → Lease)
// ─────────────────────────────────────────────────────────────────────────────
async function createBooking(req, res, next) {
  try {
    const {
      inquiryId, propertyId, property, tenant, tenantPhone,
      leaseStart, leaseEnd, monthlyRent, rentDueDay,
      reminderLeadDays, autoReminder, serviceCharge,
      securityDeposit, notes, chatId, tenantId,
    } = req.body;

    if (!propertyId) throw ApiError.badRequest('propertyId আবশ্যক।');
    if (!leaseStart || !leaseEnd) throw ApiError.badRequest('লিজের তারিখ আবশ্যক।');
    if (new Date(leaseStart) >= new Date(leaseEnd)) {
      throw ApiError.badRequest('লিজ শুরুর তারিখ শেষের আগে হতে হবে।');
    }
    const rent = Number(monthlyRent);
    if (!rent || rent <= 0) throw ApiError.badRequest('মাসিক ভাড়া ০ এর বেশি হতে হবে।');

    const booking = await Booking.create({
      landlordId:       req.user._id,
      tenantId:         tenantId && isObjectId(tenantId) ? tenantId : null,
      propertyId:       propertyId,
      inquiryId:        inquiryId && isObjectId(inquiryId) ? inquiryId : null,
      property:         property || '',
      tenant:           tenant || '',
      tenantPhone:      tenantPhone || '',
      leaseStart:       new Date(leaseStart),
      leaseEnd:         new Date(leaseEnd),
      monthlyRent:      rent,
      rentDueDay:       Number(rentDueDay) || 5,
      reminderLeadDays: Number(reminderLeadDays) || 3,
      autoReminder:     autoReminder !== false,
      serviceCharge:    Number(serviceCharge) || 0,
      securityDeposit:  Number(securityDeposit) || 0,
      notes:            notes || '',
      chatId:           chatId || '',
    });

    // If converted from an inquiry, mark it.
    if (inquiryId && isObjectId(inquiryId)) {
      await Inquiry.findByIdAndUpdate(inquiryId, { status: 'converted' }).catch(() => {});
    }

    return res.status(201).json({ booking });
  } catch (err) {
    return next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bookings/host — landlord's bookings
// ─────────────────────────────────────────────────────────────────────────────
async function listHostBookings(req, res, next) {
  try {
    const bookings = await Booking.find({ landlordId: req.user._id })
      .sort({ createdAt: -1 })
      .lean();
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
    const conditions = [{ tenantId: req.user._id }];
    if (req.user.phone) {
      conditions.push({ tenantPhone: req.user.phone });
    }
    const bookings = await Booking.find({ $or: conditions })
      .sort({ createdAt: -1 })
      .lean();
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
      'autoReminder', 'reminderLeadDays', 'rentDueDay',
      'notes', 'serviceCharge', 'securityDeposit', 'status',
      'tenant', 'tenantPhone', 'tenantId',
    ];
    for (const key of whitelist) {
      if (req.body[key] !== undefined) {
        booking[key] = req.body[key];
      }
    }

    await booking.save();
    return res.json({ booking });
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
};