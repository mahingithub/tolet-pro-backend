'use strict';

/**
 * rentPayment.controller — tenant manual rent submissions + landlord review.
 * ──────────────────────────────────────────────────────────────────────────
 * TO-LET PRO V1 manual rent flow (no gateway):
 *
 *   POST   /api/rent-payments                  tenant submits "I have paid"
 *   POST   /api/rent-payments/:id/screenshot   tenant attaches proof (multipart 'file')
 *   GET    /api/rent-payments/tenant           tenant's own submissions
 *   GET    /api/rent-payments/host[?status=]   landlord's submissions (pending list)
 *   POST   /api/rent-payments/:id/approve       landlord approves → ledger + receipt
 *   POST   /api/rent-payments/:id/reject        landlord rejects (with reason)
 *
 * APPROVE routes the money-write through bookingPayment.service.applyPayment
 * so the ledger row, receipt, and tenant "receipt" notification stay identical
 * to the landlord marking a month paid by hand.
 */

const mongoose = require('mongoose');
const Booking  = require('../models/Booking');
const RentPaymentSubmission = require('../models/RentPaymentSubmission');
const cloudinary = require('../services/cloudinary.service');
const notifications = require('../services/notification.service');
const { applyPayment } = require('../services/bookingPayment.service');
const { labelForType } = require('./paymentMethod.controller');
const ApiError = require('../utils/ApiError');
const { getIo, emitToUser } = require('../socket');

function isObjectId(v) {
  return mongoose.Types.ObjectId.isValid(String(v));
}

function phoneCore(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

// Room-correct realtime emit (sockets join room `user:<id>`).
function notifySocket(userId, event, payload) {
  if (!userId) return;
  try {
    const io = getIo();
    if (io) emitToUser(io, String(userId), event, payload);
  } catch (err) {
    console.warn('[rent-payment] socket emit failed:', err.message);
  }
}

// Is `user` the tenant on `booking` (by linked id, or by matching phone)?
function isBookingTenant(booking, user) {
  if (booking.tenantId && String(booking.tenantId) === String(user._id)) return true;
  const core = phoneCore(booking.tenantPhone);
  return !!core && core === phoneCore(user.phone);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/rent-payments — tenant submits a manual rent payment
// ─────────────────────────────────────────────────────────────────────────────
async function submitPayment(req, res, next) {
  try {
    const {
      bookingId, monthKey, monthLabel, amount, txnId, paymentDate,
      paymentMethodType, paymentMethodLabel, notes,
    } = req.body;

    if (!isObjectId(bookingId)) throw ApiError.badRequest('বুকিং আইডি সঠিক নয়।');
    if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) {
      throw ApiError.badRequest('মাসের ফর্ম্যাট: YYYY-MM');
    }
    const amt = Number(amount);
    if (!amt || amt <= 0) throw ApiError.badRequest('পরিমাণ ০ এর বেশি হতে হবে।');

    const booking = await Booking.findById(bookingId);
    if (!booking) throw ApiError.notFound('বুকিং পাওয়া যায়নি।');
    if (!isBookingTenant(booking, req.user)) {
      throw ApiError.forbidden('এই বুকিং আপনার নয়।');
    }

    // Already fully paid this month? Nothing to submit.
    const existing = booking.ledger.get(monthKey);
    if (existing && (existing.paid === true || existing.status === 'full')) {
      throw ApiError.badRequest('এই মাসের ভাড়া ইতিমধ্যে পরিশোধিত।');
    }

    // Block duplicate pending claims for the same month (keeps the landlord's
    // verification list clean; tenant can re-submit only after a rejection).
    const dupe = await RentPaymentSubmission.findOne({
      bookingId: booking._id, monthKey, status: 'pending',
    }).lean();
    if (dupe) {
      throw ApiError.conflict('এই মাসের পেমেন্ট ইতিমধ্যে যাচাইয়ের অপেক্ষায় আছে।');
    }

    const label = paymentMethodLabel || labelForType(paymentMethodType) || '';

    const submission = await RentPaymentSubmission.create({
      bookingId:          booking._id,
      landlordId:         booking.landlordId,
      tenantId:           req.user._id,
      propertyId:         booking.propertyId,
      monthKey,
      monthLabel:         monthLabel || monthKey,
      tenantName:         (req.user.name || booking.tenant || '').slice(0, 120),
      tenantPhone:        (booking.tenantPhone || req.user.phone || '').slice(0, 20),
      propertyTitle:      booking.property || '',
      amount:             amt,
      txnId:              String(txnId || '').trim().slice(0, 80),
      paymentDate:        String(paymentDate || '').trim(),
      paymentMethodType:  String(paymentMethodType || '').trim(),
      paymentMethodLabel: label,
      notes:              String(notes || '').trim().slice(0, 500),
    });

    // Reflect "awaiting verification" on the ledger so BOTH dashboards + the
    // Smart-Alert reminders recognise the state (paid stays false — it is NOT
    // a payment yet). Skip if the month already carries a real paid entry.
    if (!existing || !['full', 'partial'].includes(existing.status)) {
      booking.ledger.set(monthKey, {
        paid:          false,
        status:        'submitted',
        paidOn:        String(paymentDate || '').trim(),
        method:        label,
        txnId:         String(txnId || '').trim(),
        amount:        amt,
        balance:       0,
        lateFee:       existing?.lateFee || 0,
        dueNote:       'যাচাইয়ের অপেক্ষায়',
        expectedPayBy: existing?.expectedPayBy || '',
        paymentSource: 'manual',
      });
      await booking.save();
    }

    // Notify the landlord (in-app + push + realtime).
    notifications.emit({
      userId: booking.landlordId,
      type:   'payment',
      title:  '💳 নতুন ভাড়া পেমেন্ট — যাচাই করুন',
      body:   `${submission.tenantName || 'ভাড়াটিয়া'} ${submission.monthLabel} এর ৳${amt.toLocaleString('en-IN')} পেমেন্ট সাবমিট করেছেন।`,
      data:   { submissionId: String(submission._id), bookingId: String(booking._id), monthKey },
    });
    notifySocket(booking.landlordId, 'rent:payment_submitted', {
      submissionId: String(submission._id), bookingId: String(booking._id), monthKey,
    });

    return res.status(201).json({ submission });
  } catch (err) {
    return next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/rent-payments/:id/screenshot — tenant attaches payment proof
// ─────────────────────────────────────────────────────────────────────────────
async function uploadScreenshot(req, res, next) {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) throw ApiError.notFound('পেমেন্ট পাওয়া যায়নি।');
    if (!req.file) return res.status(400).json({ message: 'কোনো ফাইল পাওয়া যায়নি।', code: 'no_file' });

    const submission = await RentPaymentSubmission.findById(id);
    if (!submission) throw ApiError.notFound('পেমেন্ট পাওয়া যায়নি।');

    // Only the submitting tenant may attach proof.
    const owns = (submission.tenantId && String(submission.tenantId) === String(req.user._id)) ||
      (submission.tenantPhone && phoneCore(submission.tenantPhone) === phoneCore(req.user.phone));
    if (!owns) throw ApiError.forbidden('এই পেমেন্ট আপনার নয়।');

    const uploaded = await cloudinary.uploadBuffer(req.file.buffer, {
      folder:   `tolet-pro/rent-payments/${submission.landlordId}`,
      publicId: `proof_${submission._id}`,
    });

    submission.screenshotUrl      = uploaded.secureUrl;
    submission.screenshotPublicId = uploaded.publicId;
    await submission.save();

    return res.json({ submission });
  } catch (err) {
    return next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/rent-payments/tenant — the tenant's own submissions
// ─────────────────────────────────────────────────────────────────────────────
async function listTenantSubmissions(req, res, next) {
  try {
    const conditions = [{ tenantId: req.user._id }];
    const phone = (req.user.phone || '').trim();
    if (phone.length >= 10 && !/^(\+?0+|1234567890|0000000000)$/.test(phone)) {
      conditions.push({ tenantPhone: phone });
    }
    const submissions = await RentPaymentSubmission.find({ $or: conditions })
      .sort({ createdAt: -1 })
      .lean();
    submissions.forEach(s => { s.id = String(s._id); delete s._id; });
    return res.json({ submissions });
  } catch (err) {
    return next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/rent-payments/host[?status=pending] — landlord's submissions
// ─────────────────────────────────────────────────────────────────────────────
async function listHostSubmissions(req, res, next) {
  try {
    const filter = { landlordId: req.user._id };
    if (['pending', 'approved', 'rejected'].includes(req.query.status)) {
      filter.status = req.query.status;
    }
    const submissions = await RentPaymentSubmission.find(filter)
      .sort({ status: 1, createdAt: -1 }) // pending first (alphabetical), newest first
      .lean();
    submissions.forEach(s => { s.id = String(s._id); delete s._id; });
    return res.json({ submissions });
  } catch (err) {
    return next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/rent-payments/:id/approve — landlord approves → ledger + receipt
// ─────────────────────────────────────────────────────────────────────────────
async function approveSubmission(req, res, next) {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) throw ApiError.notFound('পেমেন্ট পাওয়া যায়নি।');

    const submission = await RentPaymentSubmission.findById(id);
    if (!submission) throw ApiError.notFound('পেমেন্ট পাওয়া যায়নি।');
    if (String(submission.landlordId) !== String(req.user._id)) {
      throw ApiError.forbidden('এই পেমেন্ট আপনার নয়।');
    }
    if (submission.status !== 'pending') {
      throw ApiError.badRequest('এই পেমেন্ট ইতিমধ্যে রিভিউ করা হয়েছে।');
    }

    const booking = await Booking.findById(submission.bookingId);
    if (!booking) throw ApiError.notFound('বুকিং পাওয়া যায়নি।');

    const totalDue = (Number(booking.monthlyRent) || 0) + (Number(booking.serviceCharge) || 0);
    const paid     = Number(submission.amount) || 0;
    // Full when it clears the month's dues; otherwise a partial payment.
    const status   = (totalDue > 0 && paid < totalDue) ? 'partial' : 'full';
    const balance  = Math.max(totalDue - paid, 0);
    const paidOn   = submission.paymentDate || new Date().toISOString().slice(0, 10);

    // Route through the shared money-write chokepoint → writes ledger entry,
    // upserts the Receipt, and fires the tenant "receipt" notification.
    const updatedBooking = await applyPayment({
      booking,
      monthKey: submission.monthKey,
      source:   'manual',
      payment: {
        status,
        paidOn,
        method:     submission.paymentMethodLabel || 'Manual',
        txnId:      submission.txnId,
        amount:     paid,
        balance,
        monthLabel: submission.monthLabel || submission.monthKey,
        totalDue,
      },
    });

    submission.status     = 'approved';
    submission.reviewedAt = new Date();
    await submission.save();

    // Extra tenant nudge that the claim itself was approved (receipt notif is
    // separate, from applyPayment). Realtime refresh of the tenant rent view.
    if (submission.tenantId) {
      notifications.emit({
        userId: submission.tenantId,
        type:   'payment',
        title:  '✅ ভাড়া পেমেন্ট অনুমোদিত',
        body:   `${submission.monthLabel} এর ৳${paid.toLocaleString('en-IN')} পেমেন্ট নিশ্চিত হয়েছে। রিসিট তৈরি হয়েছে।`,
        data:   { submissionId: String(submission._id), bookingId: String(booking._id), monthKey: submission.monthKey },
      });
    }
    notifySocket(submission.tenantId, 'rent:updated', { bookingId: String(booking._id) });

    return res.json({ submission, booking: updatedBooking });
  } catch (err) {
    return next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/rent-payments/:id/reject — landlord rejects (with reason)
// ─────────────────────────────────────────────────────────────────────────────
async function rejectSubmission(req, res, next) {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) throw ApiError.notFound('পেমেন্ট পাওয়া যায়নি।');

    const submission = await RentPaymentSubmission.findById(id);
    if (!submission) throw ApiError.notFound('পেমেন্ট পাওয়া যায়নি।');
    if (String(submission.landlordId) !== String(req.user._id)) {
      throw ApiError.forbidden('এই পেমেন্ট আপনার নয়।');
    }
    if (submission.status !== 'pending') {
      throw ApiError.badRequest('এই পেমেন্ট ইতিমধ্যে রিভিউ করা হয়েছে।');
    }

    submission.status          = 'rejected';
    submission.rejectionReason = String(req.body.reason || '').trim().slice(0, 300);
    submission.reviewedAt      = new Date();
    await submission.save();

    // Roll back the "submitted" ledger marker so the month returns to its
    // normal due/overdue state (a rejected claim was never a payment).
    const booking = await Booking.findById(submission.bookingId);
    if (booking) {
      const entry = booking.ledger.get(submission.monthKey);
      if (entry && entry.status === 'submitted') {
        booking.ledger.delete(submission.monthKey);
        await booking.save();
      }
    }

    if (submission.tenantId) {
      notifications.emit({
        userId: submission.tenantId,
        type:   'payment',
        title:  '❌ ভাড়া পেমেন্ট বাতিল',
        body:   submission.rejectionReason
          ? `${submission.monthLabel} এর পেমেন্ট বাতিল হয়েছে: ${submission.rejectionReason}`
          : `${submission.monthLabel} এর পেমেন্ট যাচাই করা যায়নি। অনুগ্রহ করে সঠিক তথ্য দিয়ে আবার সাবমিট করুন।`,
        data:   { submissionId: String(submission._id), bookingId: String(submission.bookingId), monthKey: submission.monthKey },
      });
    }
    notifySocket(submission.tenantId, 'rent:updated', { bookingId: String(submission.bookingId) });

    return res.json({ submission });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  submitPayment,
  uploadScreenshot,
  listTenantSubmissions,
  listHostSubmissions,
  approveSubmission,
  rejectSubmission,
};
