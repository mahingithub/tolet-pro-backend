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

  // ── Payments ACCUMULATE within a month ────────────────────────────────────
  // A month's entry holds the TOTAL received for that month. Rent ৳6,000 with
  // ৳5,000 already banked, then ৳1,000 arrives: the entry must become ৳6,000
  // settled, not ৳1,000 with ৳5,000 still owing. Writing the entry wholesale
  // made every later payment erase the earlier one.
  //
  // `amountReceived` is what arrived THIS time. When it is absent the caller is
  // an older client sending a finished total, and we store that as before.
  const ledgerHolder = member || booking;
  const existing = (ledgerHolder.ledger && ledgerHolder.ledger.get)
    ? ledgerHolder.ledger.get(monthKey)
    : null;
  const bankedAlready = (existing && (existing.paid || existing.status === 'partial'))
    ? Math.max(0, Number(existing.amount) || 0)
    : 0;

  const isPayment = PAID_STATUSES.includes(status);
  const increment = Number(payment.amountReceived);
  const totalDue  = Math.max(0, Number(payment.totalDue) || 0);

  let resolvedAmount  = Number(payment.amount) || 0;
  let resolvedBalance = Number(payment.balance) || 0;
  let resolvedStatus  = status;

  if (isPayment && Number.isFinite(increment)) {
    resolvedAmount  = bankedAlready + Math.max(0, increment);
    resolvedBalance = totalDue > 0 ? Math.max(0, totalDue - resolvedAmount) : 0;
    // Derived from the money, not from which button the landlord pressed.
    if (totalDue > 0) resolvedStatus = resolvedBalance <= 0 ? 'full' : 'partial';
  }

  const entry = {
    paid:          PAID_STATUSES.includes(resolvedStatus),
    status:        resolvedStatus,
    paidOn:        payment.paidOn || '',
    method:        payment.method || '',
    txnId:         payment.txnId || '',
    amount:        resolvedAmount,
    balance:       resolvedBalance,
    lateFee:       Number(payment.lateFee) || 0,
    dueNote:       payment.dueNote || '',
    expectedPayBy: payment.expectedPayBy || '',
    paymentSource,
  };

  // Written to the member's ledger when a member is given, else the legacy
  // booking-level ledger (`ledgerHolder` is resolved above, where the existing
  // entry is read so this payment can be added to it). The member is embedded
  // in the booking, so saving the booking persists either path; markModified
  // guards the nested-Map change.
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
          // Read off the entry that was actually stored, not off the request.
          // The tenant's receipt and the landlord's ledger have to agree about
          // how much of the month has been settled — quoting the request would
          // hand the tenant a receipt for the last ৳1,000 while the ledger says
          // ৳6,000 is paid.
          status:        entry.status,
          monthlyRent:   rentAmount,
          serviceCharge: svcAmount,
          totalDue:      Number(payment.totalDue) || (rentAmount + svcAmount) || 0,
          totalPaid:     entry.amount,
          balance:       entry.balance,
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