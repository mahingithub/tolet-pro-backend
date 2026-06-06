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
 * The old inline logic lived in updateLedger; it's been lifted here verbatim
 * (same Receipt fields, same notification) with two fixes:
 *   1) `paid` is now derived ONLY from full/partial (previously `status !== 'due'`,
 *      which wrongly marked the new 'pending'/'overdue'/'scheduled' rows as paid).
 *   2) `paymentSource` ('manual' | 'gateway') is recorded on the ledger entry
 *      (and the receipt, once you add the field to Receipt.js).
 */

const Booking       = require('../models/Booking');
const Receipt       = require('../models/Receipt');
const notifications = require('./notification.service');

// Only these two statuses mean "money actually came in".
const PAID_STATUSES = ['full', 'partial'];

/**
 * @param {Object} opts
 * @param {Object} opts.booking   a Mongoose Booking document (NOT lean — we save it)
 * @param {String} opts.monthKey  'YYYY-MM'
 * @param {String} [opts.source]  'manual' | 'gateway'  (default 'manual')
 * @param {Object} [opts.payment] { status, paidOn, method, txnId, amount, balance,
 *                                  lateFee, dueNote, expectedPayBy, monthLabel, totalDue }
 * @returns {Promise<Object>} the updated lean booking
 */
async function applyPayment({ booking, monthKey, source = 'manual', payment = {} }) {
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

  booking.ledger.set(monthKey, entry);
  await booking.save();

  if (PAID_STATUSES.includes(status)) {
    // Receipt upsert — denormalized so dashboards don't JOIN every render.
    await Receipt.findOneAndUpdate(
      { bookingId: booking._id, monthKey },
      {
        $set: {
          landlordId:    booking.landlordId,
          tenantId:      booking.tenantId,
          propertyId:    booking.propertyId,
          propertyTitle: booking.property || '',
          tenantPhone:   booking.tenantPhone || '',
          monthLabel:    payment.monthLabel || monthKey,
          status,
          totalDue:      Number(payment.totalDue) || Number(booking.monthlyRent) || 0,
          totalPaid:     Number(payment.amount) || 0,
          balance:       Number(payment.balance) || 0,
          method:        payment.method || '',
          txnId:         payment.txnId || '',
          paidOn:        payment.paidOn || '',
          paymentSource, // add this field to Receipt.js to persist (ignored until then)
          issuedAt:      new Date(),
          read:          false,
        },
      },
      { upsert: true, new: true },
    );

    if (booking.tenantId) {
      notifications.emit({
        userId: booking.tenantId,
        type:   'rent_receipt',
        title:  `ভাড়া রিসিট — ${booking.property || 'Property'}`,
        body:   `${payment.monthLabel || monthKey} এর ${status === 'full' ? 'সম্পূর্ণ' : 'আংশিক'} ভাড়া রিসিট পাওয়া গেছে।`,
        data:   { bookingId: String(booking._id), monthKey },
      });
    }
  } else {
    // 'due' / 'pending' / 'overdue' / 'scheduled' — no receipt yet; clear any stale one.
    await Receipt.deleteOne({ bookingId: booking._id, monthKey }).catch(() => {});
  }

  return Booking.findById(booking._id).lean();
}

module.exports = { applyPayment, PAID_STATUSES };