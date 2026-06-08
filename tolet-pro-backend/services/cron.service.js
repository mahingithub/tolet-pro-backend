'use strict';

/**
 * cron.service — automated rent billing.
 * ──────────────────────────────────────────────────────────────────────────
 *   1) Monthly invoice generator — 1st of every month @ 00:00 (Asia/Dhaka).
 *      For each ACTIVE booking, seeds the current month's ledger row as 'due'
 *      (balance = monthlyRent) IF it doesn't already exist, then notifies the
 *      tenant. Idempotent: never overwrites a row a host already recorded.
 *
 *   2) Late-fee enforcer — every day @ 00:00 (Asia/Dhaka).
 *      For each ACTIVE booking, if this month's row is still unpaid and today
 *      is past (rentDueDay + gracePeriodDays), flips it to 'overdue', adds
 *      lateFeeAmount to the balance, and warns the tenant. Idempotent: a row
 *      already 'overdue' (or paid) is skipped, so the fee is added only once.
 *
 * Set CRON_TEST=1 to run BOTH jobs every minute (for end-to-end testing).
 * Set CRON_TZ to override the timezone (defaults to Asia/Dhaka).
 */

const cron          = require('node-cron');
const Booking       = require('../models/Booking');
const notifications = require('./notification.service');

const TZ   = process.env.CRON_TZ || 'Asia/Dhaka';
const TEST = process.env.CRON_TEST === '1';

const UNPAID_STATUSES = ['due', 'pending', 'scheduled'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

function currentMonthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return `${MONTHS[(m || 1) - 1]} ${y}`;
}

// ─── 1) Monthly invoice generator ────────────────────────────────────────────
async function generateMonthlyInvoices() {
  const monthKey = currentMonthKey();
  const bookings = await Booking.find({ status: 'active' });
  let created = 0;

  for (const booking of bookings) {
    if (booking.ledger.get(monthKey)) continue; // idempotent — row already exists

    booking.ledger.set(monthKey, {
      paid:          false,
      status:        'due',
      amount:        0,
      balance:       Number(booking.monthlyRent) || 0,
      lateFee:       0,
      paymentSource: 'manual',
    });
    await booking.save();
    created += 1;

    if (booking.tenantId) {
      notifications.emit({
        userId: booking.tenantId,
        type:   'rent_invoice',
        title:  `নতুন ভাড়ার বিল — ${booking.property || 'Property'}`,
        body:   `${monthLabel(monthKey)} এর ভাড়া ৳${Number(booking.monthlyRent) || 0} পরিশোধের জন্য প্রস্তুত।`,
        data:   { bookingId: String(booking._id), monthKey },
      });
    }
  }

  console.log(`[cron] invoices: ${created} created for ${monthKey} (of ${bookings.length} active bookings)`);
  return created;
}

// ─── 2) Late-fee enforcer ─────────────────────────────────────────────────────
async function enforceLateFees() {
  const today      = new Date();
  const dayOfMonth = today.getDate();
  const monthKey   = currentMonthKey(today);
  const bookings   = await Booking.find({ status: 'active' });
  let flagged = 0;

  for (const booking of bookings) {
    const entry = booking.ledger.get(monthKey);
    if (!entry) continue;                                   // no invoice yet this month
    if (entry.paid) continue;                               // already settled
    if (entry.status === 'overdue') continue;               // fee already applied (idempotent)
    if (!UNPAID_STATUSES.includes(entry.status)) continue;  // partial/full → leave alone

    const grace  = Number(booking.gracePeriodDays) || 0;
    const dueDay  = Number(booking.rentDueDay) || 5;
    if (dayOfMonth <= dueDay + grace) continue;             // still inside grace window

    const rent    = Number(booking.monthlyRent) || 0;
    const lateFee = Number(booking.lateFeeAmount) || 0;
    const prev    = typeof entry.toObject === 'function' ? entry.toObject() : entry;

    booking.ledger.set(monthKey, {
      paid:          false,
      status:        'overdue',
      paidOn:        prev.paidOn || '',
      method:        prev.method || '',
      txnId:         prev.txnId || '',
      amount:        Number(prev.amount) || 0,
      balance:       rent + lateFee,
      lateFee,
      dueNote:       prev.dueNote || '',
      expectedPayBy: prev.expectedPayBy || '',
      paymentSource: prev.paymentSource || 'manual',
    });
    await booking.save();
    flagged += 1;

    if (booking.tenantId) {
      notifications.emit({
        userId: booking.tenantId,
        type:   'rent_overdue',
        title:  `⚠️ ভাড়া বকেয়া — ${booking.property || 'Property'}`,
        body:   `${monthLabel(monthKey)} এর ভাড়া বকেয়া। ৳${lateFee} লেট ফি যোগ হয়েছে — মোট বকেয়া ৳${rent + lateFee}।`,
        data:   { bookingId: String(booking._id), monthKey },
      });
    }
  }

  console.log(`[cron] late-fees: ${flagged} bookings marked overdue for ${monthKey}`);
  return flagged;
}

// ─── Scheduler ────────────────────────────────────────────────────────────────
function startCronJobs() {
  const invoiceSchedule = TEST ? '* * * * *' : '0 0 1 * *'; // 1st of month, 00:00
  const lateFeeSchedule = TEST ? '* * * * *' : '0 0 * * *'; // every day, 00:00

  cron.schedule(invoiceSchedule, () => {
    generateMonthlyInvoices().catch((e) => console.error('[cron] invoice error:', e.message));
  }, { timezone: TZ });

  cron.schedule(lateFeeSchedule, () => {
    enforceLateFees().catch((e) => console.error('[cron] late-fee error:', e.message));
  }, { timezone: TZ });

  console.log(
    `[cron] started — invoices: "${invoiceSchedule}", late-fees: "${lateFeeSchedule}", TZ: ${TZ}` +
    (TEST ? '  (TEST MODE: every minute)' : ''),
  );
}

module.exports = { startCronJobs, generateMonthlyInvoices, enforceLateFees };