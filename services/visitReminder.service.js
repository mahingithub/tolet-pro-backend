'use strict';

/**
 * visitReminder.service.js
 * ──────────────────────────────────────────────────────────────────────────
 * Sends a ONE-TIME reminder to BOTH the tenant and the landlord ~2 hours
 * before an accepted property visit.
 *
 * Driven by a setInterval in server.js (every 15 min). This REQUIRES the
 * server to stay awake (Render Starter+). On the free tier the server sleeps,
 * so the 2-hour window can be missed entirely.
 *
 * Dedup: visitSchedule.reminderSent flips to true once a reminder is sent (or
 * once the visit time has passed), so overlapping runs never double-fire.
 *
 * Timezone: visit date/time strings are entered in Bangladesh time (BST,
 * UTC+6). We pin them to +06:00 so the computed instant is correct no matter
 * what timezone the server runs in (Render runs in UTC).
 */

const Inquiry       = require('../models/Inquiry');
const User          = require('../models/User');
const notifications = require('./notification.service');
const whatsapp      = require('./whatsapp.service');

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const BST_OFFSET   = '+06:00';

// Build a Date from 'YYYY-MM-DD' + 'HH:mm', interpreted as Bangladesh time.
function visitInstant(date, time) {
  if (!date) return null;
  const t = (time && /^\d{1,2}:\d{2}/.test(time)) ? time.slice(0, 5) : '00:00';
  const d = new Date(`${date}T${t.padStart(5, '0')}:00${BST_OFFSET}`);
  return isNaN(d.getTime()) ? null : d;
}

// Look up a user's WhatsApp number by id. Returns '' when unavailable.
async function resolveUserPhone(userId) {
  if (!userId) return '';
  const u = await User.findById(userId).select('phone').lean().catch(() => null);
  return (u && u.phone) ? u.phone : '';
}

async function runVisitReminders() {
  const now = Date.now();

  // Candidates: accepted visits not yet reminded. Small projection — we never
  // load full docs or messages[].
  const inquiries = await Inquiry.find({
    'visitSchedule.status':       'accepted',
    'visitSchedule.reminderSent': { $ne: true },
  })
    .select('propTitle propertyId inquirerUserId propertyOwnerId visitSchedule phone')
    .lean();

  let sent = 0;

  for (const inq of inquiries) {
    const vs = inq.visitSchedule || {};
    const when = visitInstant(vs.date, vs.time);
    if (!when) continue;

    const visitMs    = when.getTime();
    const reminderMs = visitMs - TWO_HOURS_MS;

    // Too early — a later run will catch it.
    if (now < reminderMs) continue;

    // Visit time already passed — never reminded in time; stop re-checking it.
    if (now > visitMs) {
      await Inquiry.updateOne(
        { _id: inq._id },
        { $set: { 'visitSchedule.reminderSent': true } },
      ).catch(() => {});
      continue;
    }

    // Inside the window [visitTime − 2h, visitTime]. Atomically CLAIM the
    // reminder first so a concurrent run can't double-send.
    const claim = await Inquiry.updateOne(
      { _id: inq._id, 'visitSchedule.reminderSent': { $ne: true } },
      { $set: { 'visitSchedule.reminderSent': true } },
    );
    if (!claim.modifiedCount) continue; // another run grabbed it

    const label = `${vs.date}${vs.time ? ' ' + vs.time : ''}`.trim();
    const prop  = inq.propTitle || 'প্রপার্টি';
    const meta  = {
      targetId:   String(inq._id),
      propertyId: String(inq.propertyId || ''),
      kind:       'visit_reminder',
    };

    // Tenant
    if (inq.inquirerUserId) {
      notifications.emit({
        userId: inq.inquirerUserId,
        type:   'inquiry',
        title:  '🗓️ ভিজিটের রিমাইন্ডার — ২ ঘণ্টা বাকি',
        body:   `${prop} — ${label} এ আপনার ভিজিট নির্ধারিত আছে।`,
        data:   meta,
      });
    }
    // Landlord
    if (inq.propertyOwnerId) {
      notifications.emit({
        userId: inq.propertyOwnerId,
        type:   'inquiry',
        title:  '🗓️ ভিজিটের রিমাইন্ডার — ২ ঘণ্টা বাকি',
        body:   `${prop} — ${label} এ ভাড়াটিয়া ভিজিটে আসবেন।`,
        data:   meta,
      });
    }

    // ── WhatsApp reminders to BOTH parties (best-effort, non-blocking) ──
    // sendWhatsAppMessage never throws, so a WhatsApp failure can't stop the
    // sweep or undo the reminderSent claim above.
    const tenantPhone   = inq.phone || await resolveUserPhone(inq.inquirerUserId);
    const landlordPhone = await resolveUserPhone(inq.propertyOwnerId);
    if (tenantPhone) {
      whatsapp.sendWhatsAppMessage(tenantPhone, {
        body: `🗓️ ${prop} — ${label} এ আপনার ভিজিট ২ ঘণ্টার মধ্যে। সময়মতো পৌঁছানোর চেষ্টা করুন।`,
      });
    }
    if (landlordPhone) {
      whatsapp.sendWhatsAppMessage(landlordPhone, {
        body: `🗓️ ${prop} — ${label} এ ভাড়াটিয়া ২ ঘণ্টার মধ্যে ভিজিটে আসবেন।`,
      });
    }
    sent++;
  }

  if (sent) console.log(`[visit-reminder] sent ${sent} reminder pair(s)`);
  return sent;
}

module.exports = { runVisitReminders, visitInstant };