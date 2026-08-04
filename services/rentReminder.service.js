'use strict';

/**
 * rentReminder.service — per-member rent-due reminders.
 * ──────────────────────────────────────────────────────────────────────────
 * Daily sweep. For each ACTIVE booking that has members and autoReminder on,
 * find every active member's next UNPAID month; if that month's due date is
 * within `reminderLeadDays` (or already past), nudge the member:
 *   • linked account  → in-app notification (+ push via notification.service)
 *   • phone only      → SMS (best-effort, only when the gateway is configured)
 *
 * De-dupe: member.lastReminderKey stores `${monthKey}@${YYYY-MM-DD}` so the
 * same member+month is never reminded twice on the same day (Requirement 5.3),
 * but the nudge repeats on later days until the rent is paid.
 *
 * Legacy single-tenant bookings are intentionally skipped here — their monthly
 * invoice + late-fee notifications are already handled by cron.service.
 */

const Booking       = require('../models/Booking');
const User          = require('../models/User');
const notifications = require('./notification.service');
const whatsapp      = require('./whatsapp.service');
const env           = require('../config/env');

let sms = null;
try { sms = require('./sms.service'); } catch { sms = null; }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

const monthKeyOf = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
const monthLabel = (key) => { const [y, m] = String(key).split('-').map(Number); return `${MONTHS[(m || 1) - 1]} ${y}`; };
const dayStamp   = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Every 'YYYY-MM' from leaseStart through leaseEnd, inclusive.
function enumerateMonths(leaseStart, leaseEnd) {
  const start = new Date(leaseStart);
  const end   = new Date(leaseEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const out = [];
  const cur  = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  let safety = 0;
  while (cur <= last && safety < 600) {
    out.push(monthKeyOf(cur.getFullYear(), cur.getMonth() + 1));
    cur.setMonth(cur.getMonth() + 1);
    safety += 1;
  }
  return out;
}

// Actual due date for a month key, clamped to the last day of the month.
function dueDate(key, dueDay) {
  const [y, m] = String(key).split('-').map(Number);
  if (!y || !m) return null;
  const lastDay = new Date(y, m, 0).getDate();
  const day = Math.min(Math.max(1, dueDay || 5), lastDay);
  return new Date(y, m - 1, day);
}

function isPaid(ledger, key) {
  const e = ledger && (typeof ledger.get === 'function' ? ledger.get(key) : ledger[key]);
  return !!(e && e.paid);
}

// The earliest unpaid month whose reminder window has opened (today is within
// leadDays of its due date, or past it). Returns { key, due } or null. Months
// are chronological, so the first unpaid one that is NOT yet in-window ends the
// search — we never remind about a future month before its window opens.
function nextDueForReminder(ledger, booking, today, leadDays) {
  const months = enumerateMonths(booking.leaseStart, booking.leaseEnd);
  for (const key of months) {
    if (isPaid(ledger, key)) continue;
    const due = dueDate(key, booking.rentDueDay);
    if (!due) continue;
    const windowStart = new Date(due);
    windowStart.setDate(windowStart.getDate() - (Number(leadDays) || 3));
    if (today >= windowStart) return { key, due };
    return null;
  }
  return null;
}

async function runRentReminders(today = new Date()) {
  const bookings = await Booking.find({ status: 'active', autoReminder: true });
  const stamp = dayStamp(today);
  let sent = 0;

  for (const booking of bookings) {
    if (!Array.isArray(booking.members) || !booking.members.length) continue; // legacy handled elsewhere
    const leadDays = Number(booking.reminderLeadDays) || 3;
    let dirty = false;

    for (const m of booking.members) {
      if (m.status === 'moved-out') continue;
      const next = nextDueForReminder(m.ledger, booking, today, leadDays);
      if (!next) continue;

      const dedupeKey = `${next.key}@${stamp}`;
      if (m.lastReminderKey === dedupeKey) continue; // already nudged today
      m.lastReminderKey = dedupeKey;
      m.lastReminderAt  = today;
      dirty = true;

      const rent  = Number(m.monthlyRent) || Number(booking.monthlyRent) || 0;
      const label = monthLabel(next.key);
      const title = `⏰ ভাড়ার রিমাইন্ডার — ${booking.property || 'বাসা'}`;
      const body  = `${m.name ? m.name + ', ' : ''}${label} এর ভাড়া ৳${rent} পরিশোধের সময় হয়েছে।`;

      let userHasApp = false;
      if (m.userId) {
        const user = await User.findById(m.userId).select('deviceTokens').lean();
        if (user && user.deviceTokens && user.deviceTokens.length > 0) {
          userHasApp = true;
        }

        notifications.emit({
          userId: m.userId,
          type:   'payment',
          title,
          body,
          data:   { bookingId: String(booking._id), memberId: String(m._id), monthKey: next.key, kind: 'rent_reminder' },
        });
      }
      
      if (!userHasApp && m.phone) {
        // Fallback: Try WhatsApp first. If it fails (or is unconfigured), fallback to SMS.
        whatsapp.sendWhatsAppMessage(m.phone, { body: `${title}\n\n${body}` })
          .then(waRes => {
            if (!waRes.success && env.smsApiKey && sms) {
              sms.sendSms(m.phone, `${title} — ${body}`).catch(() => {});
            }
          })
          .catch(() => {});
      }
      sent += 1;
    }

    if (dirty) await booking.save();
  }

  if (sent) console.log(`[rent-reminder] sent ${sent} member reminder(s)`);
  return sent;
}

module.exports = { runRentReminders, nextDueForReminder, enumerateMonths, dueDate };
