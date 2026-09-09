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

/**
 * Fan one reminder out over every channel we have for this person.
 *
 * Extracted so the daily sweep and the landlord's "send now" button deliver
 * through the SAME code — the two used to be one real implementation and one
 * toast that lied (HostDashboard's sendRentReminder never called the server),
 * and a second copy here would drift the same way.
 *
 * Resolves to a per-channel outcome. The sweep ignores it (fire-and-forget, so
 * one slow gateway can't stall the loop); the manual endpoint awaits it so the
 * landlord is told what actually happened instead of an unconditional "sent".
 */
async function deliverReminder({ userId, phone, title, body, data, allowSms = true }) {
  const out = { inApp: 'skipped', whatsapp: 'skipped', sms: 'skipped' };

  if (userId) {
    // Best-effort: a push/socket hiccup must not reject the whole sweep and
    // skip the remaining members.
    out.inApp = 'queued';
    notifications.emit({ userId, type: 'payment', title, body, data }).catch(() => {});
  }

  // Sent ALONGSIDE the in-app push, not as a fallback to it: anyone with a
  // phone gets WhatsApp too, because most tenants never installed the app.
  if (phone) {
    const waRes = await whatsapp
      .sendWhatsAppMessage(phone, { body: `${title}\n\n${body}` })
      .catch(() => ({ success: false }));
    out.whatsapp = waRes.success ? 'sent' : 'failed';

    // SMS only when WhatsApp could not deliver — it costs money per message,
    // which is why the manual button passes allowSms:false: the landlord-
    // triggered path must stay free, and a tenant it could not reach on
    // WhatsApp is reported back rather than quietly billed to us.
    if (allowSms && !waRes.success && env.smsApiKey && sms) {
      out.sms = await sms.sendSms(phone, `${title} — ${body}`).then(() => 'sent').catch(() => 'failed');
    }
  }

  return out;
}

// The earliest unpaid month, IGNORING the lead window that gates the automatic
// sweep. Only the manual "send now" path uses this: a landlord who taps Remind
// on the 9th for rent due on the 26th means it, and nextDueForReminder() would
// answer null there because the 3-day window has not opened yet.
function firstUnpaidMonth(ledger, booking, movedIn = null) {
  const months = enumerateMonths(booking.leaseStart, booking.leaseEnd);
  const from = new Date(movedIn || booking.leaseStart);
  const hasFrom = !Number.isNaN(from.getTime());
  for (const key of months) {
    if (isPaid(ledger, key)) continue;
    const due = dueDate(key, booking.rentDueDay);
    if (!due) continue;
    if (hasFrom && due < from) continue; // due before move-in — not this tenant's
    return { key, due };
  }
  return null;
}

// ONE manual reminder per occupant per rent month. Permanent, not a rolling
// timer: a cooldown only spaces taps out, and a landlord who waits it out could
// still send a tenant a message a day. The cap is what keeps our WhatsApp
// traffic looking like a landlord nudging tenants rather than a bulk sender —
// the automatic sweep already allows up to 3 (one per milestone), so a tenant's
// hard ceiling is 4 rent messages in a month, from every path combined.
const MANUAL_REMINDERS_PER_MONTH = 1;

// How long a landlord's own words are allowed to be. WhatsApp itself accepts
// 4096; the lower bound here is because this text is also pushed as an in-app
// notification body, and it keeps a paste of something enormous from becoming
// the message.
const MAX_CUSTOM_MESSAGE_LEN = 1000;

const manualSentFor = (holder, key) => {
  const m = holder && holder.manualReminders;
  if (!m) return null;
  return (typeof m.get === 'function' ? m.get(key) : m[key]) || null;
};

/**
 * Work out WHO is being reminded, about WHICH month, and WHAT the default text
 * says — without sending anything.
 *
 * Shared by the confirm dialog's preview and the send itself, so the words the
 * landlord approves in the dialog are the words that actually go out. Two
 * separate builders would eventually disagree, and the landlord would be
 * editing a message that no longer matched.
 */
async function resolveManualReminder({ booking, memberId = null, monthKey = null, today = new Date() }) {
  const leadDays = Number(booking.reminderLeadDays) || 3;
  const member   = memberId && Array.isArray(booking.members)
    ? (booking.members.id ? booking.members.id(memberId) : null)
    : null;

  if (memberId && !member) return { ok: false, reason: 'member_not_found' };
  if (member && member.status === 'moved-out') return { ok: false, reason: 'moved_out' };

  // Where this occupant's obligation lives — the member row for a shared room,
  // the booking itself for a flat / single tenancy.
  const holder     = member || booking;
  const ledger     = member ? member.ledger : booking.ledger;
  const movedIn    = member && member.joinDate && new Date(member.joinDate) > new Date(booking.leaseStart)
    ? member.joinDate
    : booking.leaseStart;
  const tenantName = member ? member.name : booking.tenant;
  const phone      = member ? member.phone : await resolveTenantPhone(booking);
  const userId     = member ? member.userId : booking.tenantId;

  // WhatsApp and the in-app push are the only channels the button uses (SMS
  // costs money), so with neither there is nothing to offer the landlord.
  if (!phone && !userId) return { ok: false, reason: 'no_channel' };

  let target;
  if (monthKey) {
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return { ok: false, reason: 'bad_month' };
    if (isPaid(ledger, monthKey)) return { ok: false, reason: 'already_paid' };
    const due = dueDate(monthKey, booking.rentDueDay);
    if (!due) return { ok: false, reason: 'bad_month' };
    target = { key: monthKey, due };
  } else {
    target = firstUnpaidMonth(ledger, booking, movedIn);
    if (!target) return { ok: false, reason: 'no_unpaid_month' };
  }

  // Still early? Say so with the advance wording rather than refusing.
  const milestone = milestoneFor(target.due, today, leadDays, booking.gracePeriodDays) || 'lead';

  const amountDue = member
    ? (Number(member.monthlyRent) || Number(booking.monthlyRent) || 0) + (Number(member.serviceCharge) || 0)
    : (Number(booking.monthlyRent) || 0) + (Number(booking.serviceCharge) || 0);

  const { title, body } = reminderMessage({
    milestone,
    tenantName,
    property:  booking.property || 'বাসা',
    monthKey:  target.key,
    amountDue,
    // Only the landlord's own lease setting can put a late fee in the message.
    lateFee:   Number(booking.lateFeeAmount) || 0,
    dueOn:     target.due,
    graceDays: Number(booking.gracePeriodDays) || 0,
  });

  const alreadySentAt = manualSentFor(holder, target.key);

  return {
    ok: true,
    member, holder, userId, phone,
    monthKey: target.key,
    dueOn: target.due,
    milestone, tenantName, amountDue,
    title, body,
    // The dialog needs to know the button is spent BEFORE the landlord writes a
    // message, not after they press Send.
    alreadySent: Boolean(alreadySentAt),
    alreadySentAt: alreadySentAt || null,
    channels: { whatsapp: Boolean(phone), inApp: Boolean(userId) },
  };
}

/** Preview only — what the confirm dialog shows. Sends nothing, writes nothing. */
async function previewManualReminder(args) {
  const r = await resolveManualReminder(args);
  if (!r.ok) return r;
  return {
    ok: true,
    monthKey: r.monthKey,
    milestone: r.milestone,
    tenantName: r.tenantName,
    amountDue: r.amountDue,
    title: r.title,
    message: r.body,
    alreadySent: r.alreadySent,
    alreadySentAt: r.alreadySentAt,
    channels: r.channels,
  };
}

/**
 * Send ONE rent reminder immediately — the landlord's "Remind" button, after
 * they confirmed it in the dialog.
 *
 * Differs from the daily sweep, all of it because a human asked for this one:
 *   • no lead-window gate — any unpaid month can be nudged (firstUnpaidMonth)
 *   • 'lead' wording when it is still early, rather than refusing
 *   • the landlord may replace the body with their own words
 *   • ONE per occupant per rent month, permanently (MANUAL_REMINDERS_PER_MONTH)
 *   • WhatsApp + in-app only — never SMS, which costs money
 * It still WRITES lastReminderKey, so the sweep won't re-send the same
 * milestone hours later and double-message the tenant.
 *
 * @returns {Promise<object>} { ok:true, monthKey, milestone, tenantName, amountDue, channels }
 *                         or { ok:false, reason, ... }
 */
async function sendManualReminder({
  booking, memberId = null, monthKey = null, customMessage = null, today = new Date(),
}) {
  const r = await resolveManualReminder({ booking, memberId, monthKey, today });
  if (!r.ok) return r;

  // The cap is checked against the month we RESOLVED to, not the one asked for,
  // so omitting monthKey can't slip past it.
  if (r.alreadySent) {
    return { ok: false, reason: 'already_sent_this_month', monthKey: r.monthKey, sentAt: r.alreadySentAt };
  }

  const custom = typeof customMessage === 'string' ? customMessage.trim() : '';
  if (custom.length > MAX_CUSTOM_MESSAGE_LEN) return { ok: false, reason: 'message_too_long' };
  const body = custom || r.body;

  const channels = await deliverReminder({
    userId: r.userId,
    phone:  r.phone,
    title:  r.title,
    body,
    data: {
      bookingId: String(booking._id),
      ...(r.member ? { memberId: String(r.member._id) } : {}),
      monthKey: r.monthKey,
      kind: 'rent_reminder',
      milestone: r.milestone,
      manual: true,
    },
    // Never SMS from the button — see deliverReminder.
    allowSms: false,
  });

  // Burn the month's single press even if WhatsApp failed. Retrying a failed
  // send is exactly the loop that looks like a bot to WhatsApp, and the landlord
  // is told which channel worked so they can follow up by hand.
  if (!r.holder.manualReminders) r.holder.manualReminders = new Map();
  r.holder.manualReminders.set(r.monthKey, today);
  r.holder.lastReminderKey = `${r.monthKey}@${r.milestone}`;
  r.holder.lastReminderAt  = today;
  await booking.save();

  return {
    ok: true,
    monthKey: r.monthKey,
    milestone: r.milestone,
    tenantName: r.tenantName,
    amountDue: r.amountDue,
    customised: Boolean(custom),
    channels,
  };
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

      // Works with no app install and no landlord connection: WhatsApp to the
      // number on the lease, SMS if WhatsApp is unavailable. Deliberately NOT
      // awaited — one slow gateway must not stall the rest of the sweep.
      const phone = await resolveTenantPhone(booking);
      deliverReminder({
        userId: booking.tenantId,
        phone,
        title,
        body,
        data: { bookingId: String(booking._id), monthKey: next.key, kind: 'rent_reminder', milestone },
      }).catch(() => {});

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

      // Not awaited, for the same reason as the single-tenant branch above.
      deliverReminder({
        userId: m.userId,
        phone:  m.phone,
        title,
        body,
        data: { bookingId: String(booking._id), memberId: String(m._id), monthKey: next.key, kind: 'rent_reminder', milestone },
      }).catch(() => {});

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
  runRentReminders, sendManualReminder, previewManualReminder, nextDueForReminder,
  firstUnpaidMonth, enumerateMonths, dueDate, milestoneFor, reminderMessage,
  deliverReminder, MILESTONES, MAX_REMINDERS_PER_MONTH,
  MANUAL_REMINDERS_PER_MONTH, MAX_CUSTOM_MESSAGE_LEN,
};
