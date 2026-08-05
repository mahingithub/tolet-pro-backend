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
const User          = require('../models/User');
const notifications = require('./notification.service');
const whatsapp      = require('./whatsapp.service');
const { runRentReminders } = require('./rentReminder.service');
const { runLeaseExpiryReminders } = require('./leaseExpiryReminder.service');
const { resetMonthlyBoostCredits } = require('./boost.service');

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

// Resolve a tenant's WhatsApp number for a booking: prefer the denormalized
// `tenantPhone`, else look it up from the linked User account.
async function resolveTenantPhone(booking) {
  if (booking.tenantPhone && String(booking.tenantPhone).trim().length >= 8) {
    return String(booking.tenantPhone).trim();
  }
  if (booking.tenantId) {
    const u = await User.findById(booking.tenantId).select('phone').lean().catch(() => null);
    if (u && u.phone) return u.phone;
  }
  return '';
}

// Fire-and-forget WhatsApp reminder to a booking's tenant. NEVER blocks or
// throws — mirrors how notifications.emit is called (best-effort side channel),
// so a WhatsApp failure can't disrupt the billing/late-fee run.
function notifyTenantWhatsApp(booking, message) {
  resolveTenantPhone(booking)
    .then((phone) => {
      if (!phone) {
        console.warn(`[cron] no tenant phone for booking ${booking._id} — WhatsApp skipped`);
        return null;
      }
      return whatsapp.sendWhatsAppMessage(phone, { body: message });
    })
    .catch((e) => console.warn('[cron] WhatsApp notify failed:', e.message));
}

// ─── 1) Monthly invoice generator ────────────────────────────────────────────
async function generateMonthlyInvoices() {
  const monthKey = currentMonthKey();
  const bookings = await Booking.find({ status: 'active' });
  let created = 0;

  for (const booking of bookings) {
    // Multi-member bookings: seed EACH active member's own ledger row so every
    // occupant is tracked + notified individually. Legacy single-tenant
    // bookings fall through to the booking-level path below.
    if (Array.isArray(booking.members) && booking.members.length) {
      let dirty = false;
      for (const m of booking.members) {
        if (m.status === 'moved-out') continue;
        if (m.ledger.get(monthKey)) continue; // idempotent
        const rent = Number(m.monthlyRent) || Number(booking.monthlyRent) || 0;
        m.ledger.set(monthKey, {
          paid: false, status: 'due', amount: 0, balance: rent, lateFee: 0, paymentSource: 'manual',
        });
        dirty = true;
        created += 1;
        if (m.userId) {
          notifications.emit({
            userId: m.userId,
            type:   'payment',
            title:  `নতুন ভাড়ার বিল — ${booking.property || 'Property'}`,
            body:   `${monthLabel(monthKey)} এর ভাড়া ৳${rent} পরিশোধের জন্য প্রস্তুত।`,
            data:   { targetId: String(booking._id), bookingId: String(booking._id), memberId: String(m._id), monthKey },
          });
        }
      }
      if (dirty) { booking.markModified('members'); await booking.save(); }
      continue;
    }

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
        type:   'payment',
        title:  `নতুন ভাড়ার বিল — ${booking.property || 'Property'}`,
        body:   `${monthLabel(monthKey)} এর ভাড়া ৳${Number(booking.monthlyRent) || 0} পরিশোধের জন্য প্রস্তুত।`,
        data:   { targetId: String(booking._id), bookingId: String(booking._id), monthKey },
      });
    }

    // WhatsApp reminder — new invoice ready (best-effort, non-blocking).
    notifyTenantWhatsApp(
      booking,
      `📢 ${booking.property || 'আপনার বাসা'} — ${monthLabel(monthKey)} এর নতুন ভাড়ার বিল প্রস্তুত। ভাড়া ৳${Number(booking.monthlyRent) || 0}।`,
    );
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
    // Multi-member bookings: apply late fees per member on their own ledger.
    if (Array.isArray(booking.members) && booking.members.length) {
      const grace  = Number(booking.gracePeriodDays) || 0;
      const dueDay = Number(booking.rentDueDay) || 5;
      if (dayOfMonth <= dueDay + grace) continue;           // still inside grace window
      let dirty = false;
      for (const m of booking.members) {
        if (m.status === 'moved-out') continue;
        const e = m.ledger.get(monthKey);
        if (!e || e.paid || e.status === 'overdue' || !UNPAID_STATUSES.includes(e.status)) continue;
        const rent    = Number(m.monthlyRent) || Number(booking.monthlyRent) || 0;
        const lateFee = Number(booking.lateFeeAmount) || 0;
        const prev    = typeof e.toObject === 'function' ? e.toObject() : e;
        m.ledger.set(monthKey, {
          paid: false, status: 'overdue', paidOn: prev.paidOn || '', method: prev.method || '',
          txnId: prev.txnId || '', amount: Number(prev.amount) || 0, balance: rent + lateFee,
          lateFee, dueNote: prev.dueNote || '', expectedPayBy: prev.expectedPayBy || '',
          paymentSource: prev.paymentSource || 'manual',
        });
        dirty = true;
        flagged += 1;
        if (m.userId) {
          notifications.emit({
            userId: m.userId,
            type:   'payment',
            title:  `⚠️ ভাড়া বকেয়া — ${booking.property || 'Property'}`,
            body:   `${monthLabel(monthKey)} এর ভাড়া বকেয়া। ৳${lateFee} লেট ফি যোগ হয়েছে — মোট বকেয়া ৳${rent + lateFee}।`,
            data:   { targetId: String(booking._id), bookingId: String(booking._id), memberId: String(m._id), monthKey },
          });
        }
      }
      if (dirty) { booking.markModified('members'); await booking.save(); }
      continue;
    }

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
        type:   'payment',
        title:  `⚠️ ভাড়া বকেয়া — ${booking.property || 'Property'}`,
        body:   `${monthLabel(monthKey)} এর ভাড়া বকেয়া। ৳${lateFee} লেট ফি যোগ হয়েছে — মোট বকেয়া ৳${rent + lateFee}।`,
        data:   { targetId: String(booking._id), bookingId: String(booking._id), monthKey },
      });
    }

    // WhatsApp reminder — rent overdue + late fee applied (best-effort).
    notifyTenantWhatsApp(
      booking,
      `⚠️ ${booking.property || 'আপনার বাসা'} এর ভাড়া বকেয়া। ৳${lateFee} লেট ফি যোগ হয়েছে — মোট বকেয়া ৳${rent + lateFee}।`,
    );
  }

  console.log(`[cron] late-fees: ${flagged} bookings marked overdue for ${monthKey}`);
  return flagged;
}

// ─── Scheduler ────────────────────────────────────────────────────────────────
function startCronJobs() {
  const invoiceSchedule  = TEST ? '* * * * *' : '0 0 1 * *'; // 1st of month, 00:00
  const lateFeeSchedule  = TEST ? '* * * * *' : '0 0 * * *'; // every day, 00:00
  const reminderSchedule = TEST ? '* * * * *' : '0 9 * * *';  // every day, 09:00 — per-member rent nudges
  const leaseSchedule    = TEST ? '* * * * *' : '30 9 * * *'; // every day, 09:30 — lease-expiry warnings
  // 1st of the month, 00:05 — refill each Plus host's monthly search boost.
  // Runs a few minutes after the invoice job so the two don't contend.
  const boostResetSchedule = TEST ? '* * * * *' : '5 0 1 * *';

  cron.schedule(invoiceSchedule, () => {
    generateMonthlyInvoices().catch((e) => console.error('[cron] invoice error:', e.message));
  }, { timezone: TZ });

  cron.schedule(lateFeeSchedule, () => {
    enforceLateFees().catch((e) => console.error('[cron] late-fee error:', e.message));
  }, { timezone: TZ });

  cron.schedule(reminderSchedule, () => {
    runRentReminders().catch((e) => console.error('[cron] rent-reminder error:', e.message));
  }, { timezone: TZ });

  cron.schedule(leaseSchedule, () => {
    runLeaseExpiryReminders().catch((e) => console.error('[cron] lease-expiry error:', e.message));
  }, { timezone: TZ });

  cron.schedule(boostResetSchedule, () => {
    resetMonthlyBoostCredits().catch((e) => console.error('[cron] boost-reset error:', e.message));
  }, { timezone: TZ });

  console.log(
    `[cron] started — invoices: "${invoiceSchedule}", late-fees: "${lateFeeSchedule}", ` +
    `reminders: "${reminderSchedule}", lease-expiry: "${leaseSchedule}", ` +
    `boost-reset: "${boostResetSchedule}", TZ: ${TZ}` +
    (TEST ? '  (TEST MODE: every minute)' : ''),
  );
}

module.exports = {
  startCronJobs,
  generateMonthlyInvoices,
  enforceLateFees,
  runRentReminders,
  runLeaseExpiryReminders,
  resetMonthlyBoostCredits,
};