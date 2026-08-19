'use strict';

/**
 * leaseExpiryReminder.service — "your lease ends soon" nudges.
 * ──────────────────────────────────────────────────────────────────────────
 * Daily sweep. For every ACTIVE booking whose `leaseEnd` falls on one of the
 * milestone days (7 days out, then 1 day out), nudge both sides so neither is
 * surprised by a lease running out:
 *   • tenant   → in-app notification (+ push) and WhatsApp
 *   • landlord → same, but ONLY on Pro
 *
 * PLAN GATE: mirrors visitReminder.service. Automatic reminders are the "Smart
 * Alerts" feature (Pro), so the LANDLORD's copy is gated. The TENANT's copy is
 * never gated — the tenant is not the one buying a plan, and going silent on
 * "your home's lease ends tomorrow" because their landlord is on the free tier
 * would punish the wrong party.
 *
 * De-dupe: booking.lastLeaseExpiryReminderKey stores `<leaseEnd>@<days>`, so a
 * milestone fires once. Extending the lease changes leaseEnd and therefore the
 * key, which re-arms both milestones for the new end date.
 */

const Booking       = require('../models/Booking');
const User          = require('../models/User');
const notifications = require('./notification.service');
const whatsapp      = require('./whatsapp.service');
const env           = require('../config/env');
const { tiersForUsers } = require('./subscription.service');

let sms = null;
try { sms = require('./sms.service'); } catch { sms = null; }

// Milestones in days-before-expiry, checked nearest-first so a sweep that was
// missed for several days still sends the most urgent one rather than a stale
// 7-day warning.
const MILESTONES = [1, 7];

const DAY_MS = 24 * 60 * 60 * 1000;

const dateKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

/** Whole days from `today` until `leaseEnd`, both floored to local midnight. */
function daysUntil(leaseEnd, today) {
  const a = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const e = new Date(leaseEnd);
  const b = new Date(e.getFullYear(), e.getMonth(), e.getDate());
  return Math.round((b - a) / DAY_MS);
}

/**
 * The milestone this booking is due for right now, or null.
 * Exported for tests.
 */
function milestoneFor(booking, today = new Date()) {
  if (!booking || !booking.leaseEnd) return null;
  const left = daysUntil(booking.leaseEnd, today);
  if (left < 0) return null; // already expired — nothing to warn about
  // Nearest milestone that today has reached (left <= milestone).
  const hit = MILESTONES.find((m) => left <= m);
  if (hit == null) return null;
  return { days: hit, daysLeft: left, key: `${dateKey(booking.leaseEnd)}@${hit}` };
}

async function resolveUserPhone(userId) {
  if (!userId) return '';
  const u = await User.findById(userId).select('phone').lean().catch(() => null);
  return (u && u.phone) ? u.phone : '';
}

async function runLeaseExpiryReminders(today = new Date()) {
  // Only look at leases ending within the widest milestone window — no point
  // loading every active booking in the system.
  const horizon = new Date(today.getTime() + (Math.max(...MILESTONES) + 1) * DAY_MS);

  const bookings = await Booking.find({
    status: 'active',
    deletedAt: null,
    leaseEnd: { $gte: new Date(today.getTime() - DAY_MS), $lte: horizon },
  });

  if (!bookings.length) return 0;

  const tierByLandlord = await tiersForUsers(bookings.map((b) => b.landlordId));
  let sent = 0;

  for (const booking of bookings) {
    const milestone = milestoneFor(booking, today);
    if (!milestone) continue;
    if (booking.lastLeaseExpiryReminderKey === milestone.key) continue; // already sent

    booking.lastLeaseExpiryReminderKey = milestone.key;
    await booking.save();

    const prop = booking.property || 'বাসা';
    const when = milestone.daysLeft <= 0
      ? 'আজ'
      : `${milestone.daysLeft} দিন পর`;
    const meta = {
      bookingId:  String(booking._id),
      propertyId: String(booking.propertyId || ''),
      leaseEnd:   dateKey(booking.leaseEnd),
      kind:       'lease_expiry_reminder',
    };

    // ── Tenant — never gated ───────────────────────────────────────────────
    const tenantTitle = `📄 লিজ নবায়নের সময় হয়েছে — ${prop}`;
    const tenantBody  = `প্রিয় ভাড়াটিয়া, আপনার লিজের মেয়াদ ${when} (${dateKey(booking.leaseEnd)}) শেষ হতে চলেছে। থাকার ইচ্ছা থাকলে নবায়নের জন্য বাড়িওয়ালার সাথে যোগাযোগ করুন। ধন্যবাদ।`;

    if (booking.tenantId) {
      notifications.emit({
        userId: booking.tenantId, type: 'booking',
        title: tenantTitle, body: tenantBody, data: meta,
      }).catch(() => {});
    }
    // Members on a multi-tenant booking (hostel / mess) each get their own copy.
    for (const m of (booking.members || [])) {
      if (m.status === 'moved-out' || !m.userId) continue;
      if (String(m.userId) === String(booking.tenantId)) continue; // already notified
      notifications.emit({
        userId: m.userId, type: 'booking',
        title: tenantTitle, body: tenantBody, data: { ...meta, memberId: String(m._id) },
      }).catch(() => {});
    }

    // Phone fallback for a tenant with no linked account (WhatsApp → SMS),
    // same chain the rent reminder uses.
    const tenantPhone = booking.tenantPhone || await resolveUserPhone(booking.tenantId);
    if (!booking.tenantId && tenantPhone) {
      whatsapp.sendWhatsAppMessage(tenantPhone, { body: `${tenantTitle}\n\n${tenantBody}` })
        .then((waRes) => {
          if (!waRes.success && env.smsApiKey && sms) {
            sms.sendSms(tenantPhone, `${tenantTitle} — ${tenantBody}`).catch(() => {});
          }
        })
        .catch(() => {});
    }

    // ── Landlord — Smart Alerts, so Pro only ───────────────────────────────
    if ((tierByLandlord.get(String(booking.landlordId)) || 'free') === 'pro') {
      const llTitle = '📄 ভাড়াটিয়ার লিজ শেষ হতে চলেছে';
      const llBody  = `${prop} — ${booking.tenant || 'ভাড়াটিয়া'} এর লিজ ${when} (${dateKey(booking.leaseEnd)}) শেষ হচ্ছে। নবায়ন বা নতুন ভাড়াটিয়ার ব্যবস্থা করুন।`;

      notifications.emit({
        userId: booking.landlordId, type: 'booking',
        title: llTitle, body: llBody, data: meta,
      }).catch(() => {});

      const landlordPhone = await resolveUserPhone(booking.landlordId);
      if (landlordPhone) {
        whatsapp.sendWhatsAppMessage(landlordPhone, { body: `${llTitle}\n\n${llBody}` })
          .then((waRes) => {
            if (!waRes.success && env.smsApiKey && sms) {
              sms.sendSms(landlordPhone, `${llTitle} — ${llBody}`).catch(() => {});
            }
          })
          .catch(() => {});
      }
    }

    sent += 1;
  }

  if (sent) console.log(`[lease-expiry] sent ${sent} lease-expiry reminder(s)`);
  return sent;
}

module.exports = { runLeaseExpiryReminders, milestoneFor, daysUntil, MILESTONES };
