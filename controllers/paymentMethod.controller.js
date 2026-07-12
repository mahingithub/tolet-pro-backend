'use strict';

/**
 * paymentMethod.controller — landlord manual-payment accounts (V1, no gateway).
 * ──────────────────────────────────────────────────────────────────────────
 *   GET    /api/payment-methods                 landlord's own methods
 *   POST   /api/payment-methods                 add a method
 *   PATCH  /api/payment-methods/:id             edit / toggle active / set default
 *   DELETE /api/payment-methods/:id             remove (+ Cloudinary QR cleanup)
 *   POST   /api/payment-methods/:id/qr          upload/replace QR image (multipart 'file')
 *   GET    /api/payment-methods/booking/:bookingId   tenant reads their landlord's
 *                                                    ACTIVE methods for a booking
 *
 * Every landlord-scoped query filters by landlordId so one landlord can never
 * see or mutate another's payout details. The tenant read is scoped to a
 * booking the tenant actually belongs to.
 */

const mongoose      = require('mongoose');
const PaymentMethod = require('../models/PaymentMethod');
const Booking       = require('../models/Booking');
const cloudinary    = require('../services/cloudinary.service');
const ApiError      = require('../utils/ApiError');

const { PAYMENT_TYPES } = PaymentMethod;

function isObjectId(v) {
  return mongoose.Types.ObjectId.isValid(String(v));
}

// Reduce any phone format down to its 10-digit BD mobile core so a booking's
// typed tenantPhone can be matched against the logged-in user's stored phone.
function phoneCore(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

// Human label for reminders / receipts (bkash → 'bKash').
function labelForType(type) {
  switch (type) {
    case 'bkash':  return 'bKash';
    case 'nagad':  return 'Nagad';
    case 'rocket': return 'Rocket';
    case 'bank':   return 'Bank';
    default:       return type || '';
  }
}

// ── GET /api/payment-methods ─────────────────────────────────────────────────
async function listMyMethods(req, res, next) {
  try {
    const methods = await PaymentMethod.find({ landlordId: req.user._id })
      .sort({ isDefault: -1, createdAt: 1 })
      .lean();
    methods.forEach(m => { m.id = String(m._id); delete m._id; });
    return res.json({ methods });
  } catch (err) {
    return next(err);
  }
}

// ── POST /api/payment-methods ────────────────────────────────────────────────
async function createMethod(req, res, next) {
  try {
    const { type, accountHolderName, accountNumber, bankName, branchName } = req.body;

    if (!PAYMENT_TYPES.includes(type)) {
      throw ApiError.badRequest('পেমেন্ট মেথড টাইপ সঠিক নয়।');
    }
    if (!accountHolderName || !String(accountHolderName).trim()) {
      throw ApiError.badRequest('অ্যাকাউন্ট হোল্ডারের নাম আবশ্যক।');
    }
    if (!accountNumber || !String(accountNumber).trim()) {
      throw ApiError.badRequest('মোবাইল/অ্যাকাউন্ট নম্বর আবশ্যক।');
    }

    // First method a landlord adds becomes their default automatically.
    const existingCount = await PaymentMethod.countDocuments({ landlordId: req.user._id });
    const makeDefault = existingCount === 0 || req.body.isDefault === true;

    // Enforce the single-default invariant before inserting a new default.
    if (makeDefault) {
      await PaymentMethod.updateMany(
        { landlordId: req.user._id },
        { $set: { isDefault: false } },
      );
    }

    const method = await PaymentMethod.create({
      landlordId:        req.user._id,
      type,
      accountHolderName: String(accountHolderName).trim().slice(0, 120),
      accountNumber:     String(accountNumber).trim().slice(0, 40),
      bankName:          type === 'bank' ? String(bankName || '').trim().slice(0, 120) : '',
      branchName:        type === 'bank' ? String(branchName || '').trim().slice(0, 120) : '',
      isActive:          req.body.isActive !== false,
      isDefault:         makeDefault,
    });

    return res.status(201).json({ method });
  } catch (err) {
    return next(err);
  }
}

// ── PATCH /api/payment-methods/:id ───────────────────────────────────────────
async function updateMethod(req, res, next) {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) throw ApiError.notFound('পেমেন্ট মেথড পাওয়া যায়নি।');

    const method = await PaymentMethod.findOne({ _id: id, landlordId: req.user._id });
    if (!method) throw ApiError.notFound('পেমেন্ট মেথড পাওয়া যায়নি।');

    const b = req.body;
    if (b.type !== undefined) {
      if (!PAYMENT_TYPES.includes(b.type)) throw ApiError.badRequest('পেমেন্ট মেথড টাইপ সঠিক নয়।');
      method.type = b.type;
    }
    if (b.accountHolderName !== undefined) method.accountHolderName = String(b.accountHolderName).trim().slice(0, 120);
    if (b.accountNumber      !== undefined) method.accountNumber      = String(b.accountNumber).trim().slice(0, 40);
    if (b.bankName           !== undefined) method.bankName           = String(b.bankName || '').trim().slice(0, 120);
    if (b.branchName         !== undefined) method.branchName         = String(b.branchName || '').trim().slice(0, 120);
    if (b.isActive           !== undefined) method.isActive           = !!b.isActive;

    // Bank-only fields cleared when the type is switched to a mobile wallet.
    if (method.type !== 'bank') { method.bankName = ''; method.branchName = ''; }

    // Setting THIS method default clears the flag on all the landlord's others.
    if (b.isDefault === true) {
      await PaymentMethod.updateMany(
        { landlordId: req.user._id, _id: { $ne: method._id } },
        { $set: { isDefault: false } },
      );
      method.isDefault = true;
      // A default must be usable — auto-activate it.
      method.isActive = true;
    } else if (b.isDefault === false) {
      method.isDefault = false;
    }

    // Deactivating the current default hands the default to another active method.
    if (b.isActive === false && method.isDefault) {
      method.isDefault = false;
      const fallback = await PaymentMethod.findOne({
        landlordId: req.user._id, _id: { $ne: method._id }, isActive: true,
      }).sort({ createdAt: 1 });
      if (fallback) { fallback.isDefault = true; await fallback.save(); }
    }

    await method.save();
    return res.json({ method });
  } catch (err) {
    return next(err);
  }
}

// ── DELETE /api/payment-methods/:id ──────────────────────────────────────────
async function deleteMethod(req, res, next) {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) throw ApiError.notFound('পেমেন্ট মেথড পাওয়া যায়নি।');

    const method = await PaymentMethod.findOne({ _id: id, landlordId: req.user._id });
    if (!method) throw ApiError.notFound('পেমেন্ট মেথড পাওয়া যায়নি।');

    // Best-effort QR cleanup so we don't leak Cloudinary storage (non-fatal).
    if (method.qrImagePublicId) {
      await cloudinary.destroy(method.qrImagePublicId).catch(() => {});
    }

    const wasDefault = method.isDefault;
    await method.deleteOne();

    // Promote another active method to default so reminders keep working.
    if (wasDefault) {
      const fallback = await PaymentMethod.findOne({ landlordId: req.user._id, isActive: true })
        .sort({ createdAt: 1 });
      if (fallback) { fallback.isDefault = true; await fallback.save(); }
    }

    return res.json({ ok: true, id });
  } catch (err) {
    return next(err);
  }
}

// ── POST /api/payment-methods/:id/qr ─────────────────────────────────────────
// Upload / replace the payment QR image. multipart field name must be 'file'.
async function uploadQr(req, res, next) {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) throw ApiError.notFound('পেমেন্ট মেথড পাওয়া যায়নি।');
    if (!req.file) return res.status(400).json({ message: 'কোনো ফাইল পাওয়া যায়নি।', code: 'no_file' });

    const method = await PaymentMethod.findOne({ _id: id, landlordId: req.user._id });
    if (!method) throw ApiError.notFound('পেমেন্ট মেথড পাওয়া যায়নি।');

    // Deterministic publicId → re-uploads overwrite the previous QR (no leak).
    const uploaded = await cloudinary.uploadBuffer(req.file.buffer, {
      folder:   `tolet-pro/payment-methods/${req.user._id}`,
      publicId: `qr_${method._id}`,
    });

    method.qrImageUrl      = uploaded.secureUrl;
    method.qrImagePublicId = uploaded.publicId;
    await method.save();

    return res.json({ method });
  } catch (err) {
    return next(err);
  }
}

// ── DELETE /api/payment-methods/:id/qr ───────────────────────────────────────
async function deleteQr(req, res, next) {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) throw ApiError.notFound('পেমেন্ট মেথড পাওয়া যায়নি।');

    const method = await PaymentMethod.findOne({ _id: id, landlordId: req.user._id });
    if (!method) throw ApiError.notFound('পেমেন্ট মেথড পাওয়া যায়নি।');

    if (method.qrImagePublicId) {
      await cloudinary.destroy(method.qrImagePublicId).catch(() => {});
    }
    method.qrImageUrl = '';
    method.qrImagePublicId = '';
    await method.save();

    return res.json({ method });
  } catch (err) {
    return next(err);
  }
}

// ── GET /api/payment-methods/booking/:bookingId ──────────────────────────────
// Tenant-facing: returns the landlord's ACTIVE methods for a booking the
// tenant belongs to (matched by tenantId or phone). Used by the rent page.
async function listForBooking(req, res, next) {
  try {
    const { bookingId } = req.params;
    if (!isObjectId(bookingId)) throw ApiError.notFound('বুকিং পাওয়া যায়নি।');

    const booking = await Booking.findById(bookingId).lean();
    if (!booking) throw ApiError.notFound('বুকিং পাওয়া যায়নি।');

    // Authorise: the requester must be the tenant (id or phone) or the landlord.
    const isLandlord = String(booking.landlordId) === String(req.user._id);
    const isTenantById = booking.tenantId && String(booking.tenantId) === String(req.user._id);
    const isTenantByPhone = booking.tenantPhone &&
      phoneCore(booking.tenantPhone) &&
      phoneCore(booking.tenantPhone) === phoneCore(req.user.phone);
    if (!isLandlord && !isTenantById && !isTenantByPhone) {
      throw ApiError.forbidden('এই বুকিং আপনার নয়।');
    }

    const methods = await PaymentMethod.find({ landlordId: booking.landlordId, isActive: true })
      .sort({ isDefault: -1, createdAt: 1 })
      .lean();
    methods.forEach(m => { m.id = String(m._id); delete m._id; });

    return res.json({ methods });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listMyMethods,
  createMethod,
  updateMethod,
  deleteMethod,
  uploadQr,
  deleteQr,
  listForBooking,
  labelForType,
};
