'use strict';

/**
 * Receipt controller — read-only views for tenants and landlords,
 * plus a "mark read" endpoint so the tenant's unread badge clears.
 */

const mongoose = require('mongoose');
const Receipt  = require('../models/Receipt');
const Booking  = require('../models/Booking');
const ApiError = require('../utils/ApiError');

function isObjectId(v) {
  return mongoose.Types.ObjectId.isValid(String(v));
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/receipts/tenant — tenant's receipts
// Matches by tenantId OR tenantPhone so receipts created before the
// tenant was linked (tenantId = null) still show up.
// ─────────────────────────────────────────────────────────────────────────────
async function listTenantReceipts(req, res, next) {
  try {
    const conditions = [{ tenantId: req.user._id }];
    // Only match by phone if it's a real, non-trivial number (10+ digits).
    // Empty strings, placeholders like '1234567890', and nulls are excluded
    // to prevent receipts leaking to unrelated accounts.
    const phone = (req.user.phone || '').trim();
    if (phone.length >= 10 && !/^(\+?0+|1234567890|0000000000)$/.test(phone)) {
      conditions.push({ tenantPhone: phone });
    }
    const receipts = await Receipt.find({ $or: conditions })
      .sort({ issuedAt: -1 })
      .lean();
    return res.json({ receipts });
  } catch (err) {
    return next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/receipts/host — landlord's issued receipts
// ─────────────────────────────────────────────────────────────────────────────
async function listHostReceipts(req, res, next) {
  try {
    const receipts = await Receipt.find({ landlordId: req.user._id })
      .sort({ issuedAt: -1 })
      .lean();
    return res.json({ receipts });
  } catch (err) {
    return next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/receipts/:id/read — mark a receipt as read by the tenant
// ─────────────────────────────────────────────────────────────────────────────
async function markReceiptRead(req, res, next) {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) throw ApiError.notFound('রিসিট পাওয়া যায়নি।');

    const receipt = await Receipt.findById(id);
    if (!receipt) throw ApiError.notFound('রিসিট পাওয়া যায়নি।');

    // Only the tenant (or phone-matched user) may mark as read.
    const isTenant = (
      (receipt.tenantId && String(receipt.tenantId) === String(req.user._id)) ||
      (receipt.tenantPhone && receipt.tenantPhone.length >= 10 && receipt.tenantPhone === req.user.phone)
    );
    if (!isTenant) throw ApiError.forbidden('এই রিসিট আপনার নয়।');

    receipt.read = true;
    await receipt.save();

    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

module.exports = { listTenantReceipts, listHostReceipts, markReceiptRead };
