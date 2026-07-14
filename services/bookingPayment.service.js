'use strict';

/**
 * bookingPayment.service — single source of truth for writing a rent payment
 * into a booking's ledger, upserting/cleaning the matching Receipt, and
 * notifying the tenant.
 * ──────────────────────────────────────────────────────────────────────────
 * Used by BOTH paths so they can never drift apart:
 *   • Manual host action  → booking.controller.updateLedger
 *   • Payment gateway      → payment.controller webhook (added later)
 *
 * The receipt now snapshots monthlyRent + serviceCharge + the landlord's
 * name/phone so the tenant's receipt is fully self-contained.
 */

const Booking       = require('../models/Booking');
const Receipt       = require('../models/Receipt');
const User          = require('../models/User');
const notifications = require('./notification.service');

// Only these two statuses mean "money actually came in".
const PAID_STATUSES = ['full', 'partial'];

/**
 * @param {Object} opts
 * @param {Object} opts.booking   a Mongoose Booking document (NOT lean — we save it)
 * @param {Object} [opts.member]  a member subdoc of the booking (multi-member);
 *                                omit for the legacy single-tenant ledger path
 * @param {String} opts.monthKey  'YYYY-MM'
 * @param {String} [opts.source]  'manual' | 'gateway'  (default 'manual')
 * @param {Object} [opts.payment] { status, paidOn, method, txnId, amount, balance,
 *                                  lateFee, dueNote, expectedPayBy, monthLabel, totalDue }
 * @returns {Promise<Object>} the updated lean booking
 */
async function applyPayment({ booking, member = null, monthKey, source = 'manual', payment = {} }) {
  const status        = payment.status || 'full';
  const paymentSource = source === 'gateway' ? 'gateway' : 'manual';

  const entry = {
    paid:          PAID_STATUSES.includes(status),
    status,
    paidOn:        payment.paidOn || '',
    method:        payment.method || '',
    txnId:         payment.txnId || '',
    amount:        Number(payment.amount) || 0,
    balance:       Number(payment.balance) || 0,
    lateFee:       Number(payment.lateFee) || 0,
    dueNote:       payment.dueNote || '',
    expectedPayBy: payment.expectedPayBy || '',
    paymentSource,
  };

  // Write to the member's ledger when a member is given, else the legacy
  // booking-level ledger. The member is embedded in the booking, so saving the
  // booking persists either path; markModified guards the nested-Map change.
  const ledgerHolder = member || booking;
  ledgerHolder.ledger.set(monthKey, entry);
  if (member) booking.markModified('members');
  await booking.save();

  // Who the receipt + notification are for: the member (multi-member) or the
  // booking's single tenant (legacy single-tenant path).
  const memberId     = member ? member._id : null;
  const notifyUserId = member ? member.userId : booking.tenantId;
  const payerName    = member ? (member.name || '')  : (booking.tenant || '');
  const payerPhone   = member ? (member.phone || '') : (booking.tenantPhone || '');
  const rentAmount   = member
    ? (Number(member.monthlyRent)   || Number(booking.monthlyRent)   || 0)
    : (Number(booking.monthlyRent)   || 0);
  const svcAmount    = member
    ? (Number(member.serviceCharge) || Number(booking.serviceCharge) || 0)
    : (Number(booking.serviceCharge) || 0);
  const receiptFilter = { bookingId: booking._id, memberId, monthKey };

  if (PAID_STATUSES.includes(status)) {
    // Landlord profile snapshot for the receipt (self-contained, no JOIN at read).
    const landlord = await User.findById(booking.landlordId)
      .select('name phone')
      .lean()
      .catch(() => null);

    const property = await require('../models/Property').findById(booking.propertyId)
      .select('title coverPhoto')
      .lean()
      .catch(() => null);

    // Receipt upsert — denormalized so dashboards don't JOIN every render.
    const receiptDoc = await Receipt.findOneAndUpdate(
      receiptFilter,
      {
        $set: {
          landlordId:    booking.landlordId,
          tenantId:      notifyUserId || null,
          memberId,
          memberName:    payerName,
          propertyId:    booking.propertyId,
          propertyTitle: booking.property || property?.title || '',
          propertyImage: property?.coverPhoto || '',
          tenantPhone:   payerPhone,
          landlordName:  landlord?.name  || '',
          landlordPhone: landlord?.phone || '',
          monthLabel:    payment.monthLabel || monthKey,
          status,
          monthlyRent:   rentAmount,
          serviceCharge: svcAmount,
          totalDue:      Number(payment.totalDue) || (rentAmount + svcAmount) || 0,
          totalPaid:     Number(payment.amount) || 0,
          balance:       Number(payment.balance) || 0,
          method:        payment.method || '',
          txnId:         payment.txnId || '',
          paidOn:        payment.paidOn || '',
          paymentSource,
          issuedAt:      new Date(),
          read:          false,
        },
      },
      { upsert: true, new: true, runValidators: true },
    );

    // Notify the payer — a linked member OR the legacy tenant. Placeholder
    // members (no userId) get no in-app notification; the landlord shares the
    // PDF / SMS instead.
    if (notifyUserId) {
      notifications.emit({
        userId: notifyUserId,
        type:   'receipt',
        title:  `ভাড়া রিসিট — ${booking.property || 'Property'}`,
        body:   `${payment.monthLabel || monthKey} এর ${status === 'full' ? 'সম্পূর্ণ' : 'আংশিক'} ভাড়া রিসিট পাওয়া গেছে।`,
        data:   { targetId: String(receiptDoc._id), bookingId: String(booking._id), memberId: memberId ? String(memberId) : null, monthKey },
      });
    }
  } else {
    // 'due' / 'pending' / 'overdue' / 'scheduled' — no receipt yet; clear any stale one.
    await Receipt.deleteOne(receiptFilter).catch(() => {});
  }

  const updated = await Booking.findById(booking._id).lean();
  if (updated) {
    updated.id = String(updated._id);
    delete updated._id;
    // lean() leaves member _id as ObjectId + skips toJSON — normalise to id.
    if (Array.isArray(updated.members)) {
      updated.members.forEach((m) => { if (m && m._id) { m.id = String(m._id); delete m._id; } });
    }
  }
  return updated;
}

module.exports = { applyPayment, PAID_STATUSES };