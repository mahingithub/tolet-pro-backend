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

// Is `user` the booking's single (whole-unit) tenant?
function isBookingTenant(booking, user) {
  if (booking.tenantId && String(booking.tenantId) === String(user._id)) return true;
  const core = phoneCore(booking.tenantPhone);
  return !!core && core === phoneCore(user.phone);
}

// The user's own members[] row on a shared unit, or null.
function findBookingMember(booking, user) {
  const core = phoneCore(user.phone);
  return (booking.members || []).find((m) => m
    && ((m.userId && String(m.userId) === String(user._id))
      || (core && phoneCore(m.phone) === core))) || null;
}

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  WHO IS PAYING, AND FOR WHAT                                             ║
// ║                                                                          ║
// ║  A booking is either one tenancy (a flat, one tenant, one ledger) or a   ║
// ║  shared unit whose occupants each carry their OWN rent, service charge   ║
// ║  and ledger on members[]. Everything money-shaped in this controller     ║
// ║  used to assume the first case:                                          ║
// ║                                                                          ║
// ║    • a member who joined by invite code got 403 on submit — they are     ║
// ║      not booking.tenantId, so the app told them the lease wasn't theirs; ║
// ║    • when a submission was approved, the month's obligation was read     ║
// ║      off booking.monthlyRent. A ৳6,000 seat in a ৳45,000 flat produced   ║
// ║      a ৳45,600 receipt, and the tenant's own dashboard (which reads      ║
// ║      their member row) kept saying ৳6,000. That is the mismatch between  ║
// ║      the payments page and the overview.                                 ║
// ║                                                                          ║
// ║  This resolver answers both questions once: may this user pay on this    ║
// ║  booking, and WHICH ledger + rent are theirs. Every handler below uses   ║
// ║  it, so the submit, the approve and the roll-back can't pick different   ║
// ║  answers.                                                                ║
// ╚══════════════════════════════════════════════════════════════════════════╝
function resolvePayer(booking, user) {
  const member = findBookingMember(booking, user);
  if (member) {
    return {
      member,
      ledger: member.ledger,
      // A member row may leave money terms blank, meaning "same as the unit".
      monthlyRent:   Number(member.monthlyRent)   || Number(booking.monthlyRent)   || 0,
      serviceCharge: member.serviceCharge != null && member.serviceCharge !== 0
        ? Number(member.serviceCharge) || 0
        : Number(booking.serviceCharge) || 0,
      name:  member.name  || user.name || booking.tenant || '',
      phone: member.phone || user.phone || '',
      floorNumber: String(member.floor     || booking.floorNumber || '').trim(),
      roomNumber:  String(member.roomLabel || booking.roomNumber  || '').trim(),
      seatLabel:   String(member.seatLabel || '').trim(),
    };
  }
  if (!isBookingTenant(booking, user)) return null;
  return {
    member: null,
    ledger: booking.ledger,
    monthlyRent:   Number(booking.monthlyRent)   || 0,
    serviceCharge: Number(booking.serviceCharge) || 0,
    name:  booking.tenant      || user.name  || '',
    phone: booking.tenantPhone || user.phone || '',
    floorNumber: String(booking.floorNumber || '').trim(),
    roomNumber:  String(booking.roomNumber  || '').trim(),
    seatLabel:   '',
  };
}

// The member subdoc a submission was filed against, re-read at review time.
function memberForSubmission(booking, submission) {
  if (!submission.memberId) return null;
  return (booking.members || []).id
    ? booking.members.id(submission.memberId)
    : (booking.members || []).find((m) => String(m._id) === String(submission.memberId)) || null;
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

    // Who is paying, and against which ledger. Members are first-class here —
    // see resolvePayer for why they used to be turned away at this line.
    const payer = resolvePayer(booking, req.user);
    if (!payer) throw ApiError.forbidden('এই বুকিং আপনার নয়।');

    // Already fully paid this month? Nothing to submit. Read from the PAYER's
    // ledger — a flatmate settling their share does not settle yours.
    const existing = payer.ledger.get(monthKey);
    if (existing && (existing.paid === true || existing.status === 'full')) {
      throw ApiError.badRequest('এই মাসের ভাড়া ইতিমধ্যে পরিশোধিত।');
    }

    // Block duplicate pending claims for the same month (keeps the landlord's
    // verification list clean; tenant can re-submit only after a rejection).
    // Scoped to the occupant, so four seats filing for August are four claims.
    const dupe = await RentPaymentSubmission.findOne({
      bookingId: booking._id,
      memberId:  payer.member ? payer.member._id : null,
      monthKey,
      status: 'pending',
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
      memberId:           payer.member ? payer.member._id : null,
      memberName:         payer.member ? (payer.name || '').slice(0, 120) : '',
      monthKey,
      monthLabel:         monthLabel || monthKey,
      tenantName:         (req.user.name || payer.name || '').slice(0, 120),
      tenantPhone:        (payer.phone || req.user.phone || '').slice(0, 20),
      propertyTitle:      booking.property || '',
      floorNumber:        payer.floorNumber,
      roomNumber:         payer.roomNumber,
      seatLabel:          payer.seatLabel,
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
      payer.ledger.set(monthKey, {
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
      // Members are embedded, so saving the booking persists either ledger —
      // but a nested Map change needs the explicit markModified.
      if (payer.member) booking.markModified('members');
      await booking.save();
    }

    // Notify the landlord (in-app + push + realtime). Name the unit: a
    // building name alone doesn't tell them which room just paid.
    const whereLabel = [booking.property, payer.floorNumber && `${payer.floorNumber} তলা`, payer.roomNumber && `রুম ${payer.roomNumber}`, payer.seatLabel && `সিট ${payer.seatLabel}`]
      .filter(Boolean).join(' · ');
    notifications.emit({
      userId: booking.landlordId,
      type:   'payment',
      title:  '💳 নতুন ভাড়া পেমেন্ট — যাচাই করুন',
      body:   `${submission.tenantName || 'ভাড়াটিয়া'}${whereLabel ? ` (${whereLabel})` : ''} ${submission.monthLabel} এর ৳${amt.toLocaleString('en-IN')} পেমেন্ট সাবমিট করেছেন।`,
      data:   { submissionId: String(submission._id), bookingId: String(booking._id), memberId: payer.member ? String(payer.member._id) : null, monthKey },
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
// POST /api/rent-payments/:id/direct-screenshot — tenant attaches direct upload proof
// ─────────────────────────────────────────────────────────────────────────────
async function saveDirectScreenshot(req, res, next) {
  try {
    const { id } = req.params;
    const { secureUrl, publicId } = req.body || {};

    if (!secureUrl || !publicId) {
      throw ApiError.badRequest('secureUrl and publicId are required.');
    }

    const submission = await RentPaymentSubmission.findById(id);
    if (!submission) throw ApiError.notFound('Payment submission not found.');

    if (submission.screenshotPublicId && submission.screenshotPublicId !== publicId) {
      await cloudinary.destroy(submission.screenshotPublicId).catch(() => {});
    }

    submission.screenshotUrl = secureUrl;
    submission.screenshotPublicId = publicId;
    submission.status = 'pending';
    await submission.save();

    res.json({
      ok: true,
      message: 'Screenshot saved successfully.',
      submission,
    });
  } catch (err) {
    next(err);
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

    // THE MONTH'S OBLIGATION IS THE PAYER'S, NOT THE UNIT'S.
    // This read `booking.monthlyRent + booking.serviceCharge` unconditionally,
    // so approving a ৳6,000 seat in a ৳45,000 flat wrote a ৳45,600 receipt and
    // marked the month 'partial' with ৳39,600 still owing — money the occupant
    // never agreed to. The member the claim was filed against decides.
    const member   = memberForSubmission(booking, submission);
    const rent     = member ? (Number(member.monthlyRent) || Number(booking.monthlyRent) || 0) : (Number(booking.monthlyRent) || 0);
    const service  = member
      ? (member.serviceCharge != null && member.serviceCharge !== 0 ? Number(member.serviceCharge) || 0 : Number(booking.serviceCharge) || 0)
      : (Number(booking.serviceCharge) || 0);
    const totalDue = rent + service;
    const paid     = Number(submission.amount) || 0;
    // Full when it clears the month's dues; otherwise a partial payment.
    const status   = (totalDue > 0 && paid < totalDue) ? 'partial' : 'full';
    const balance  = Math.max(totalDue - paid, 0);
    const paidOn   = submission.paymentDate || new Date().toISOString().slice(0, 10);

    // Route through the shared money-write chokepoint → writes ledger entry,
    // upserts the Receipt, and fires the tenant "receipt" notification.
    // Passing `member` is what puts the entry on the occupant's own ledger and
    // stamps the receipt with their memberId (applyPayment has always
    // supported this; the manual-rent path simply never used it).
    const updatedBooking = await applyPayment({
      booking,
      member,
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
    // Roll back the SAME ledger the submission wrote to. Rejecting a member's
    // claim used to clear the booking-level month instead — leaving the
    // occupant's own month stuck on "awaiting verification" forever while
    // wiping a whole-unit entry that had nothing to do with the claim.
    const booking = await Booking.findById(submission.bookingId);
    if (booking) {
      const member = memberForSubmission(booking, submission);
      const holder = member || booking;
      const entry = holder.ledger.get(submission.monthKey);
      if (entry && entry.status === 'submitted') {
        holder.ledger.delete(submission.monthKey);
        if (member) booking.markModified('members');
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

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/rent-payments/:id — landlord removes a payment record from their
// history. Only the owning landlord may delete, and only an already-reviewed
// (approved / rejected) record — a still-pending claim must be approved or
// rejected first. This removes the submission record + its proof screenshot;
// it does NOT reverse an approved month's ledger/receipt (the tenant keeps
// their receipt), it only clears the entry from the landlord's history list.
// ─────────────────────────────────────────────────────────────────────────────
async function deleteSubmission(req, res, next) {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) throw ApiError.notFound('পেমেন্ট পাওয়া যায়নি।');

    const submission = await RentPaymentSubmission.findById(id);
    if (!submission) throw ApiError.notFound('পেমেন্ট পাওয়া যায়নি।');
    if (String(submission.landlordId) !== String(req.user._id)) {
      throw ApiError.forbidden('এই পেমেন্ট আপনার নয়।');
    }
    if (submission.status === 'pending') {
      throw ApiError.badRequest('পেন্ডিং পেমেন্ট মুছে ফেলা যাবে না — আগে অনুমোদন বা বাতিল করুন।');
    }

    // Best-effort cleanup of the proof screenshot so we don't leak Cloudinary
    // quota. Non-fatal — a stale asset never blocks the delete.
    if (submission.screenshotPublicId) {
      await cloudinary.destroy(submission.screenshotPublicId).catch(() => {});
    }

    await submission.deleteOne();

    return res.json({ ok: true, id: String(submission._id) });
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
  deleteSubmission,
  saveDirectScreenshot,
};
