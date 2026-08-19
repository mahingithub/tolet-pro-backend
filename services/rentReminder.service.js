'use strict';

/**
 * rentReminder.service — rent-due reminders.
 * ──────────────────────────────────────────────────────────────────────────
 * Daily sweep over every ACTIVE booking with autoReminder on. Find the next
 * UNPAID month; if its due date is within `reminderLeadDays` (or already past),
 * nudge the tenant on every channel we have for them:
 *   • linked account  → in-app notification (+ push via notification.service)
 *   • phone number    → WhatsApp, with SMS as a fallback if WhatsApp fails or
 *                       is unconfigured (best-effort)
 * Someone with both a linked account and a phone gets both — WhatsApp is not a
 * fallback for the app, it runs alongside it. A tenant who never installed the
 * app and never connected to the landlord still gets nudged, because the phone
 * number the landlord typed on the lease is enough.
 *
 * Two shapes of booking are handled:
 *   • MULTI-MEMBER (hostel / mess) — one nudge per active member, off that
 *     member's own ledger and phone.
 *   • SINGLE-TENANT (flat / single room / commercial) — one nudge off the
 *     booking-level ledger, tenantId and tenantPhone. These used to be skipped
 *     here entirely, which meant the formats most landlords actually use got no
 *     rent-due reminder at all — only the 1st-of-month invoice and the overdue
 *     late-fee warning that cron.service sends.
 *
 * AT MOST 3 REMINDERS PER TENANT PER MONTH. Rather than a counter that burns its
 * quota on three consecutive days, the cap comes from three MILESTONES — one
 * reminder each, spread across the month where they're actually useful:
 *   1. 'lead'    — `reminderLeadDays` before the due date (heads-up)
 *   2. 'due'     — the due date has arrived
 *   3. 'overdue' — the grace period has run out
 * De-dupe: lastReminderKey stores `${monthKey}@${milestone}` (on the member for
 * multi-member bookings, on the booking for single-tenant ones), so each
 * milestone fires exactly once per month — 3 messages maximum, never two on the
 * same day, and the count resets naturally with the next month's rent.
 *
 * LATE FEE: mentioned ONLY when the landlord actually set one on the lease
 * (`lateFeeAmount > 0`). No fee configured ⇒ no fee wording anywhere, because
 * threatening a charge the landlord never agreed to is worse than saying nothing.
 *
 * PLAN GATE: automatic reminders are the "Smart Alerts" feature, which is Pro
 * only. Plus unlocks the rent-collection LEDGER (manual tracking); it does not
 * buy the auto-nudges. A landlord on free/plus is skipped entirely.
 */

const Booking       = require('../models/Booking');
const User          = require('../models/User');
const notifications = require('./notification.service');
const whatsapp      = require('./whatsapp.service');
const env           = require('../config/env');
const { tiersForUsers } = require('./subscription.service');

let sms = null;
try { sms = require('./sms.service'); } catch { sms = null; }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

// The three milestones ARE the per-month cap: one reminder each, so a tenant can
// never receive more than 3 in a month for the same rent.
const MILESTONES = ['lead', 'due', 'overdue'];
const MAX_REMINDERS_PER_MONTH = MILESTONES.length; // 3

const monthKeyOf = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
const monthLabel = (key) => { const [y, m] = String(key).split('-').map(Number); return `${MONTHS[(m || 1) - 1]} ${y}`; };


// Every 'YYYY-MM' from leaseStart through leaseEnd, inclusive.
//
// An OPEN-ENDED tenancy has no leaseEnd (the norm: the tenant stays for years
// and nobody signs a renewal). Rent is still owed every month, so the window
// rolls forward to the end of the current year instead of collapsing to an
// empty list — otherwise a tenant who never signed a term would silently stop
// receiving rent reminders.
function enumerateMonths(leaseStart, leaseEnd) {
  const start = new Date(leaseStart);
  const now   = new Date();
  const end   = leaseEnd ? new Date(leaseEnd) : new Date(now.getFullYear(), 11, 31);
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

// The number to reach a single-tenant booking's tenant on. Prefer the phone the
// landlord typed onto the lease — that exists even when the tenant has no
// account — and fall back to the linked User's phone.
async function resolveTenantPhone(booking) {
  const typed = String(booking.tenantPhone || '').trim();
  if (typed.length >= 8) return typed;
  if (booking.tenantId) {
    const u = await User.findById(booking.tenantId).select('phone').lean().catch(() => null);
    if (u && u.phone) return String(u.phone).trim();
  }
  return '';
}

// The earliest unpaid month whose reminder window has opened (today is within
// leadDays of its due date, or past it). Returns { key, due } or null. Months
// are chronological, so the first unpaid one that is NOT yet in-window ends the
// search — we never remind about a future month before its window opens.
//
// `movedIn` (defaults to the lease start) is the date the tenant actually took
// the unit. Months whose due date fell BEFORE that are skipped: a lease starting
// the 17th with rent due on the 5th spans that calendar month, so without this a
// brand-new lease would fire an "your rent is overdue" WhatsApp the moment it was
// created — for a due date that passed before the tenant ever moved in.
function nextDueForReminder(ledger, booking, today, leadDays, movedIn = null) {
  const months = enumerateMonths(booking.leaseStart, booking.leaseEnd);
  const from = new Date(movedIn || booking.leaseStart);
  const hasFrom = !Number.isNaN(from.getTime());
  for (const key of months) {
    if (isPaid(ledger, key)) continue;
    const due = dueDate(key, booking.rentDueDay);
    if (!due) continue;
    if (hasFrom && due < from) continue; // due before move-in — not this tenant's
    const windowStart = new Date(due);
    windowStart.setDate(windowStart.getDate() - (Number(leadDays) || 3));
    if (today >= windowStart) return { key, due };
    return null;
  }
  return null;
}

const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// Which of the 3 milestones today falls on for a given due date — the thing that
// caps a tenant at 3 reminders a month. Returns 'lead' | 'due' | 'overdue', or
// null when the lead window hasn't opened yet.
//   … ──[lead]──▶ due ──[due]──▶ due+grace ──[overdue]──▶ …
function milestoneFor(due, today, leadDays, graceDays) {
  const t  = midnight(today);
  const d0 = midnight(due);
  const lead = new Date(d0); lead.setDate(lead.getDate() - (Number(leadDays) || 3));
  const graceEnd = new Date(d0); graceEnd.setDate(graceEnd.getDate() + (Number(graceDays) || 0));
  if (t > graceEnd) return 'overdue';
  if (t >= d0) return 'due';
  if (t >= lead) return 'lead';
  return null;
}

// Build the reminder copy for a milestone. The late-fee sentence is appended ONLY
// when the landlord configured a fee — `lateFee` of 0 produces no fee wording at
// all, in any milestone.
function reminderMessage({ milestone, tenantName, property, monthKey, amountDue, lateFee, dueOn, graceDays }) {
  const label = monthLabel(monthKey);
  const who = tenantName ? `প্রিয় ${tenantName}` : 'প্রিয় ভাড়াটিয়া';
  const dueDayNum = dueOn.getDate();
  const fee = Number(lateFee) || 0;

  if (milestone === 'overdue') {
    const title = `🔔 ভাড়া এখনো পরিশোধ হয়নি — ${property}`;
    const body = fee > 0
      ? `${who}, ${label} এর ভাড়া ৳${amountDue} এখনো পাওয়া যায়নি। লেট ফি ৳${fee} যুক্ত হওয়ায় মোট পাওনা এখন ৳${amountDue + fee}। দ্রুত পরিশোধ করে দিলে ভালো হয়। কোনো সমস্যা থাকলে জানাবেন।`
      : `${who}, ${label} এর ভাড়া ৳${amountDue} এখনো পাওয়া যায়নি। দ্রুত পরিশোধ করে দিলে ভালো হয়। কোনো সমস্যা থাকলে জানাবেন।`;
    return { title, body };
  }

  if (milestone === 'due') {
    const title = `📌 আজ ভাড়া পরিশোধের দিন — ${property}`;
    const body = `${who}, ${label} এর ভাড়া ৳${amountDue} আজ (${dueDayNum} তারিখ) পরিশোধের শেষ দিন। সুবিধামতো পরিশোধ করে দিলে খুশি হবো। ধন্যবাদ।`;
    return { title, body };
  }

  // 'lead' (advance reminder)
  const daysLeft = Math.max(0, Math.round((midnight(dueOn) - midnight(new Date())) / 86400000));
  const title = `🔔 ভাড়ার রিমাইন্ডার — ${property}`;
  const body = `${who}, ${label} এর ভাড়া ৳${amountDue} আগামী ${dueDayNum} তারিখে (${daysLeft} দিন পর) পরিশোধের অনুরোধ রইলো। সময়মতো দিলে লেট ফি এড়ানো যাবে। ধন্যবাদ।`;
  return { title, body };
}

async function runRentReminders(today = new Date()) {
  const bookings = await Booking.find({ status: 'active', autoReminder: true });
  let sent = 0;
  let skippedTier = 0;

  // One batched query for every landlord in the sweep — Smart Alerts is Pro
  // only, so most bookings may be filtered out before any work is done.
  const tierByLandlord = await tiersForUsers(bookings.map((b) => b.landlordId));

  for (const booking of bookings) {
    if ((tierByLandlord.get(String(booking.landlordId)) || 'free') !== 'pro') {
      skippedTier += 1;
      continue;
    }
    const leadDays = Number(booking.reminderLeadDays) || 3;
    let dirty = false;

    // ── SINGLE-TENANT booking (flat / single room / commercial) ─────────────
    // No members[], so the obligation lives on the booking itself. The tenant
    // may have no account at all — the phone number on the lease is the channel.
    if (!Array.isArray(booking.members) || !booking.members.length) {
      const next = nextDueForReminder(booking.ledger, booking, today, leadDays);
      if (!next) continue;

      const milestone = milestoneFor(next.due, today, leadDays, booking.gracePeriodDays);
      if (!milestone) continue;

      // One reminder per milestone per month ⇒ 3 maximum for this month's rent.
      const dedupeKey = `${next.key}@${milestone}`;
      if (booking.lastReminderKey === dedupeKey) continue;
      booking.lastReminderKey = dedupeKey;
      booking.lastReminderAt  = today;

      const rent  = Number(booking.monthlyRent) || 0;
      const service = Number(booking.serviceCharge) || 0;
      const { title, body } = reminderMessage({
        milestone,
        tenantName: booking.tenant,
        property:   booking.property || 'বাসা',
        monthKey:   next.key,
        amountDue:  rent + service,
        // Only the landlord's own setting can put a late fee in the message.
        lateFee:    Number(booking.lateFeeAmount) || 0,
        dueOn:      next.due,
        graceDays:  Number(booking.gracePeriodDays) || 0,
      });

      if (booking.tenantId) {
        notifications.emit({
          userId: booking.tenantId,
          type:   'payment',
          title,
          body,
          data:   { bookingId: String(booking._id), monthKey: next.key, kind: 'rent_reminder', milestone },
        }).catch(() => {});
      }

      // Works with no app install and no landlord connection: WhatsApp to the
      // number on the lease, SMS if WhatsApp is unavailable.
      const phone = await resolveTenantPhone(booking);
      if (phone) {
        whatsapp.sendWhatsAppMessage(phone, { body: `${title}\n\n${body}` })
          .then((waRes) => {
            if (!waRes.success && env.smsApiKey && sms) {
              sms.sendSms(phone, `${title} — ${body}`).catch(() => {});
            }
          })
          .catch(() => {});
      }

      sent += 1;
      await booking.save();
      continue;
    }

    for (const m of booking.members) {
      if (m.status === 'moved-out') continue;
      // A seat added later isn't chased for the months before they joined.
      const movedIn = (m.joinDate && new Date(m.joinDate) > new Date(booking.leaseStart))
        ? m.joinDate
        : booking.leaseStart;
      const next = nextDueForReminder(m.ledger, booking, today, leadDays, movedIn);
      if (!next) continue;

      const milestone = milestoneFor(next.due, today, leadDays, booking.gracePeriodDays);
      if (!milestone) continue;

      // One reminder per milestone per month ⇒ 3 maximum per seat-holder.
      const dedupeKey = `${next.key}@${milestone}`;
      if (m.lastReminderKey === dedupeKey) continue;
      m.lastReminderKey = dedupeKey;
      m.lastReminderAt  = today;
      dirty = true;

      const rent  = Number(m.monthlyRent) || Number(booking.monthlyRent) || 0;
      const { title, body } = reminderMessage({
        milestone,
        tenantName: m.name,
        property:   booking.property || 'বাসা',
        monthKey:   next.key,
        amountDue:  rent + (Number(m.serviceCharge) || 0),
        // Late-fee terms are set per LEASE, so every seat in the room shares them.
        lateFee:    Number(booking.lateFeeAmount) || 0,
        dueOn:      next.due,
        graceDays:  Number(booking.gracePeriodDays) || 0,
      });

      if (m.userId) {
        // Best-effort like the WhatsApp/SMS sends below — a push/socket
        // hiccup must not reject the whole sweep and skip the remaining members.
        notifications.emit({
          userId: m.userId,
          type:   'payment',
          title,
          body,
          data:   { bookingId: String(booking._id), memberId: String(m._id), monthKey: next.key, kind: 'rent_reminder', milestone },
        }).catch(() => {});
      }

      if (m.phone) {
        // Sent alongside the in-app push, not as a fallback to it: any member
        // with a phone gets WhatsApp too. If WhatsApp fails (or is
        // unconfigured), fall back to SMS.
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

  if (sent || skippedTier) {
    console.log(
      `[rent-reminder] sent ${sent} member reminder(s)` +
      (skippedTier ? `, skipped ${skippedTier} booking(s) — landlord not on Pro` : ''),
    );
  }
  return sent;
}

module.exports = {
  runRentReminders, nextDueForReminder, enumerateMonths, dueDate,
  milestoneFor, reminderMessage, MILESTONES, MAX_REMINDERS_PER_MONTH,
};
