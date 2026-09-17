'use strict';

/**
 * hostRentDigest.service — "৩ জন ভাড়াটিয়ার ভাড়া বাকি".
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Every rent notification this app sends points at the TENANT. cron.service
 * invoices them, enforces their late fee and warns them; rentReminder nudges
 * them three times a month; leaseExpiryReminder warns them. The landlord — the
 * person whose money it is, and the person who opened the app to track it — was
 * told nothing. They found out rent was unpaid by opening the rent register and
 * reading it, which means they found out whenever they happened to look.
 *
 * WHAT IT SENDS
 *
 * ONE notification per landlord, counting every occupant across every property,
 * with the total outstanding. Not one per unpaid tenant: a hostel owner with
 * fourteen unpaid seats would get fourteen pushes on the same morning, which is
 * indistinguishable from spam and trains them to swipe the app's notifications
 * away without reading. One line they can act on beats fourteen they can't.
 *
 * WHEN IT SENDS — milestones, not a daily drip
 *
 * The same discipline rentReminder uses on tenants, applied to the landlord:
 *   • FIRST   — the day the grace period runs out and something is genuinely
 *               late. Before that the tenant is not late and there is nothing
 *               to report.
 *   • REPEAT  — at most once every 7 days while anything is still unpaid.
 * So a bad month costs the landlord about three notifications, not twenty-five.
 * A month where everyone pays on time costs zero: the sweep finds nothing and
 * sends nothing, which is the case that has to stay silent for the rest to
 * carry any weight.
 *
 * WHO COUNTS AS AN OCCUPANT
 *
 * A member row, or a legacy single-tenant booking with a linked tenantId.
 * Deliberately NOT "every active booking": most active bookings in this system
 * are empty shells with no occupant at all, and counting them would tell a
 * landlord that eleven people owe them rent when four do. A number a landlord
 * can disprove by opening the register is worse than no number.
 */

const Booking       = require('../models/Booking');
const Notification  = require('../models/Notification');
const notifications = require('./notification.service');

const UNPAID_STATUSES = ['due', 'pending', 'scheduled', 'overdue', 'partial'];

// Minimum gap between two digests to the same landlord about the same month.
const REPEAT_AFTER_DAYS = 7;

const MONTHS_BN = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
                   'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];

const EN_TO_BN = { 0: '০', 1: '১', 2: '২', 3: '৩', 4: '৪', 5: '৫', 6: '৬', 7: '৭', 8: '৮', 9: '৯' };

// Bengali numerals for anything a landlord reads. The rest of the app's copy is
// Bengali; a digest that says "3 tenants" beside "৳45,000" reads as a bug.
const bn = (n) => String(n).replace(/\d/g, (d) => EN_TO_BN[d]);

// Thousands separators, then Bengali digits. Rent figures in this market run to
// five and six digits and are unreadable without grouping.
const bnMoney = (n) => bn(Math.round(Number(n) || 0).toLocaleString('en-US'));

function currentMonthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabelBn(monthKey) {
  const [y, m] = String(monthKey).split('-').map(Number);
  return `${MONTHS_BN[(m || 1) - 1]} ${bn(y)}`;
}

/**
 * What is still owed on one ledger entry for the month.
 *
 * A MISSING entry counts as the full rent owed, not as zero. The invoice job
 * runs on the 1st and seeds every row, but a tenancy that started mid-month has
 * no row until the next run — reading that absence as "paid" would quietly drop
 * exactly the newest tenants from the count.
 */
function outstandingFor(ledger, rent, monthKey = currentMonthKey()) {
  const due = Number(rent) || 0;
  const entry = ledger && typeof ledger.get === 'function' ? ledger.get(monthKey) : null;
  if (!entry) return due;
  if (entry.paid) return 0;
  if (!UNPAID_STATUSES.includes(entry.status)) return 0;
  // `balance` is what the ledger itself says is left, including any late fee
  // the enforcer added. Fall back to the rent when it is missing or zero on an
  // unpaid row, which is the shape a hand-entered row can take.
  const balance = Number(entry.balance) || 0;
  return balance > 0 ? balance : Math.max(0, due - (Number(entry.amount) || 0));
}

/** Has the grace period for this booking expired today? */
function pastGrace(booking, today = new Date()) {
  const dueDay = Number(booking.rentDueDay) || 5;
  const grace  = Number(booking.gracePeriodDays) || 0;
  return today.getDate() > dueDay + grace;
}

/**
 * Collect every unpaid occupant for one landlord.
 * @returns {{ count: number, total: number, names: string[], properties: Set<string> }}
 */
function collectUnpaid(bookings, today = new Date(), monthKey = currentMonthKey(today)) {
  let count = 0;
  let total = 0;
  const names = [];
  const properties = new Set();

  for (const booking of bookings) {
    // Nobody is late until the landlord's own grace period has run out. Using
    // the booking's configured window rather than a fixed date is the whole
    // reason those fields exist.
    if (!pastGrace(booking, today)) continue;

    const hasMembers = Array.isArray(booking.members) && booking.members.length > 0;

    if (hasMembers) {
      for (const m of booking.members) {
        if (m.status === 'moved-out') continue;
        const rent = Number(m.monthlyRent) || Number(booking.monthlyRent) || 0;
        const owed = outstandingFor(m.ledger, rent, monthKey);
        if (owed <= 0) continue;
        count += 1;
        total += owed;
        if (m.name) names.push(m.name);
        if (booking.property) properties.add(booking.property);
      }
      continue;
    }

    // Legacy single-tenant booking. `tenantId` is the occupant test here — an
    // active booking with no members and no linked tenant is an empty unit, and
    // an empty unit does not owe rent.
    if (!booking.tenantId) continue;
    const owed = outstandingFor(booking.ledger, booking.monthlyRent, monthKey);
    if (owed <= 0) continue;
    count += 1;
    total += owed;
    if (booking.tenant) names.push(booking.tenant);
    if (booking.property) properties.add(booking.property);
  }

  return { count, total, names, properties };
}

/**
 * Should this landlord hear about it today?
 *
 * The last digest we sent IS the state — no new field on User, no migration.
 * A digest for a different month always sends (a new month is new news); the
 * same month is rate-limited to once a week.
 */
async function shouldSend(landlordId, monthKey) {
  const last = await Notification
    .findOne({ userId: landlordId, type: 'rent_due_summary' })
    .sort({ createdAt: -1 })
    .select('createdAt data')
    .lean()
    .catch(() => null);

  if (!last) return true;
  if ((last.data && last.data.monthKey) !== monthKey) return true;

  const ageDays = (Date.now() - new Date(last.createdAt).getTime()) / 86400000;
  return ageDays >= REPEAT_AFTER_DAYS;
}

// "রহিম, করিম এবং আরও ২ জন" — name the people when there are few enough for a
// name to mean anything, count them when there aren't.
function describeWho(names, count) {
  const shown = names.slice(0, 2).filter(Boolean);
  if (shown.length === 0) return `${bn(count)} জন ভাড়াটিয়া`;
  const rest = count - shown.length;
  if (rest <= 0) return shown.join(', ');
  return `${shown.join(', ')} এবং আরও ${bn(rest)} জন`;
}

async function runHostRentDigest() {
  const today    = new Date();
  const monthKey = currentMonthKey(today);

  const bookings = await Booking.find({ status: 'active' })
    .select('landlordId tenantId tenant property members ledger monthlyRent rentDueDay gracePeriodDays');

  // Group by landlord so each one is a single decision and a single message.
  const byLandlord = new Map();
  for (const b of bookings) {
    if (!b.landlordId) continue;
    const key = String(b.landlordId);
    if (!byLandlord.has(key)) byLandlord.set(key, []);
    byLandlord.get(key).push(b);
  }

  let sent = 0;
  for (const [landlordId, theirs] of byLandlord) {
    const { count, total, names, properties } = collectUnpaid(theirs, today, monthKey);
    // Everybody paid. Say nothing — a "0 unpaid" notification is the kind of
    // message that makes people mute an app.
    if (count === 0) continue;

    if (!(await shouldSend(landlordId, monthKey))) continue;

    const where = properties.size === 1
      ? ` — ${[...properties][0]}`
      : (properties.size > 1 ? ` — ${bn(properties.size)}টি বাসা` : '');

    await notifications.emit({
      userId: landlordId,
      type:   'rent_due_summary',
      title:  `${bn(count)} জন ভাড়াটিয়ার ভাড়া বাকি${where}`,
      body:   `${monthLabelBn(monthKey)} — ${describeWho(names, count)}। মোট বকেয়া ৳${bnMoney(total)}।`,
      data:   {
        monthKey,
        count,
        total,
        // Straight into the rent register. A notification that drops the
        // landlord on a generic dashboard has made them do the finding twice.
        //
        // This must stay in step with HOST.rent in the frontend's
        // utils/notificationRoute.js: the web service worker routes off this
        // `url`, the native tap routes off the type in that table, and the two
        // have to arrive at the same screen.
        url: '/host-dashboard?tab=rent',
      },
      // One rent digest per month occupies one slot in the shade. Next week's
      // replaces this week's instead of sitting beneath it.
      collapseKey: `rent-due-${monthKey}`,
    });
    sent += 1;
  }

  console.log(`[cron] host-rent-digest: ${sent} landlords notified for ${monthKey} (of ${byLandlord.size} with active bookings)`);
  return sent;
}

module.exports = {
  runHostRentDigest,
  // Exported for tests: the counting rules (empty shells, missing ledger rows,
  // moved-out members) are where this is most likely to go quietly wrong.
  collectUnpaid,
  outstandingFor,
  describeWho,
};
