'use strict';

/**
 * tenancy.service — when a tenancy ends, and which one a person is actually in.
 * ──────────────────────────────────────────────────────────────────────────
 * ONE PERSON LIVES IN ONE PLACE.
 *
 * That is the rule this file enforces, and it is a product decision, not a
 * technical one. Somebody moves out of 301 and into 204 — or leaves one
 * landlord for another entirely — and nobody closes the old row. The old
 * landlord has no reason to think about a tenant who has gone; the tenant has
 * no button. So the old tenancy just stays live: a second rent card, a second
 * set of dues, a second lot of overdue alerts, forever. Do it four times and
 * the dashboard claims you are simultaneously renting four homes and owe
 * ৳97,377 across all of them.
 *
 * Joining somewhere new is therefore read as leaving everywhere else.
 *
 * WHERE THIS USED TO LIVE, AND WHY IT MOVED
 * All of this was private to invite.controller, so only the QR / link
 * onboarding paths ran it. The invite-CODE path (booking.controller.joinByInvite
 * — the "Add code" button on the tenant dashboard) never did, which is how a
 * tenant accumulated four live tenancies while the QR path kept exactly one.
 * booking.controller cannot require invite.controller (invite.controller
 * already requires booking.controller), so the shared rule lives here, in one
 * definition both sides call.
 *
 * NOTHING HERE DELETES ANYTHING. A tenancy ends by being stamped with a
 * move-out date, never by being removed, because the landlord's question six
 * months later is "who was in 301 last winter and until when" — and the rent
 * ledger, the receipts and the NID that answer it all hang off the member row.
 */

const Booking = require('../models/Booking');
const { phoneCore, phoneMatchBranches } = require('../utils/phone');
const notifications = require('./notification.service');

function notifySocket(userId, event, payload) {
  if (!userId) return;
  try {
    const { getIo, emitToUser } = require('../socket');
    const io = getIo();
    if (io) emitToUser(io, String(userId), event, payload);
  } catch (err) {
    console.warn('[tenancy] socket emit failed:', err.message);
  }
}

const activeMembers = (booking) => (Array.isArray(booking?.members)
  ? booking.members.filter((m) => m && m.status !== 'moved-out')
  : []);

/**
 * How many SEATS a booking is holding — not how many people are in it.
 *
 * The two stopped being the same number when a tenant became able to take a
 * whole room: one member row with seatsBooked = 4 fills a 4-seat room by
 * itself. Counting heads there reports three free seats that do not exist, and
 * every screen that offers a seat has to agree with the one check that refuses
 * it (placeTenantInUnit) or the app advertises rooms it will not let anyone
 * into. So capacity is measured HERE, once, for all of them.
 *
 * A member written before seatsBooked existed has no such field; those rows are
 * single seats, hence the `|| 1`.
 */
const seatsTaken = (booking) => activeMembers(booking)
  .reduce((sum, m) => sum + (Number(m.seatsBooked) || 1), 0);

/** True when one occupant has reserved the entire room. */
const hasWholeRoomHold = (booking) => activeMembers(booking)
  .some((m) => (Number(m.seatsBooked) || 1) > 1);

/**
 * The member row belonging to this person, if any.
 */
function findMyMember(booking, tenantUserId, tenantPhone) {
  const core = phoneCore(tenantPhone);
  return (booking.members || []).find((m) => m
    && ((m.userId && String(m.userId) === String(tenantUserId))
      || (core && phoneCore(m.phone) === core))) || null;
}

/**
 * WHEN THIS PERSON'S TENANCY BEGAN.
 *
 * Used to decide which of several live tenancies is the current one. Their own
 * move-in beats the lease's start date (on a shared unit the lease may predate
 * them by years), which in turn beats when the record happened to be created.
 * `createdAt` is the tie-break, not the signal: two rooms joined the same day
 * are ordered by which was entered second.
 */
function tenancyStartedAt(booking, tenantUserId, tenantPhone) {
  const member = findMyMember(booking, tenantUserId, tenantPhone);
  const candidates = [member && member.joinDate, booking.leaseStart, booking.createdAt];
  for (const c of candidates) {
    const d = c ? new Date(c) : null;
    if (d && !Number.isNaN(d.getTime())) return d;
  }
  return new Date(0);
}

/**
 * Order a person's tenancies newest-first. The head of the list is the home
 * they are in now; everything after it is somewhere they used to be.
 */
function sortByRecency(bookings, tenantUserId, tenantPhone) {
  return [...bookings].sort((a, b) => {
    const at = tenancyStartedAt(a, tenantUserId, tenantPhone).getTime();
    const bt = tenancyStartedAt(b, tenantUserId, tenantPhone).getTime();
    if (bt !== at) return bt - at;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });
}

/**
 * End one person's occupancy of one booking.
 *
 * Handles both shapes a tenancy comes in:
 *   • members[] — the normal case. Their member row is closed; co-occupants of
 *     a hostel room are untouched.
 *   • a LEGACY single-tenant booking with an empty members[], matched by
 *     tenantId / tenantPhone. There is no row to close, so the booking itself
 *     is completed and leaseEnd stamped — which is what the Booking model
 *     already documents as "the host handed the unit over".
 *
 * @returns {boolean} whether anything actually changed.
 */
function closeMembership(booking, tenantUserId, tenantPhone, when) {
  const core = phoneCore(tenantPhone);
  let touched = false;

  (booking.members || []).forEach((m) => {
    if (!m || m.status === 'moved-out') return;
    const mine = (m.userId && String(m.userId) === String(tenantUserId))
      || (core && phoneCore(m.phone) === core);
    if (!mine) return;
    m.status = 'moved-out';
    m.moveOutDate = when;
    touched = true;
  });

  if (touched) {
    booking.markModified('members');
    // The unit is empty now. A whole-unit let mirrors its occupant into the
    // booking's own tenant fields, and listTenantBookings matches on those, so
    // leaving them set would keep handing the ex-tenant a live card for a room
    // they no longer live in.
    if (activeMembers(booking).length === 0) {
      booking.status  = 'completed';
      booking.leaseEnd = booking.leaseEnd || when;
    }
    return true;
  }

  // Legacy row: no members[] at all, the tenant is the booking.
  const isLegacyTenant = (booking.tenantId && String(booking.tenantId) === String(tenantUserId))
    || (core && phoneCore(booking.tenantPhone) === core);
  if (!booking.members?.length && isLegacyTenant && booking.status !== 'completed') {
    booking.status   = 'completed';
    booking.leaseEnd = booking.leaseEnd || when;
    return true;
  }

  return false;
}

/** Every live tenancy this person still holds, newest-first. */
async function findLiveTenancies(tenantUserId, tenantPhone) {
  const core = phoneCore(tenantPhone);
  const match = [{ 'members.userId': tenantUserId }, { tenantId: tenantUserId }];
  // Indexed equality on the normalised core, PLUS the legacy suffix-regex for
  // rows the backfill has not reached yet. phoneMatchBranches() builds both —
  // see utils/phone.js for why the regex alone could never use an index.
  match.push(...phoneMatchBranches('members.phoneCore', 'members.phone', core));
  match.push(...phoneMatchBranches('tenantPhoneCore', 'tenantPhone', core));
  const rows = await Booking.find({
    status: { $nin: ['cancelled', 'completed'] },
    deletedAt: null,
    $or: match,
  });
  // A row can match on phone while the member is already moved out — that is
  // history, not a live tenancy.
  const live = rows.filter((b) => {
    const m = findMyMember(b, tenantUserId, tenantPhone);
    return m ? m.status !== 'moved-out' : true;
  });
  return sortByRecency(live, tenantUserId, tenantPhone);
}

/**
 * The tenant moved house. Close every OTHER tenancy they still hold.
 *
 * ASSUMPTION, MADE ON PURPOSE: a person lives in one place. Joining somewhere
 * new is read as leaving everywhere else. That is right for the case this
 * serves and wrong for the rare tenant who genuinely holds two lets at once
 * (a shop and a home); they would have to be re-added by the landlord, which is
 * a landlord-side action that still exists. The rent history survives either
 * way, so the cost of being wrong is a re-add, not lost data.
 *
 * The landlord being left is TOLD. They are losing a tenant off their register
 * without touching anything, and finding that out by noticing an empty row
 * later is not acceptable.
 */
async function closeOtherTenancies({ tenantUserId, tenantPhone, keepBookingId, when }) {
  const core = phoneCore(tenantPhone);
  const match = [{ 'members.userId': tenantUserId }, { tenantId: tenantUserId }];
  // Indexed equality on the normalised core, PLUS the legacy suffix-regex for
  // rows the backfill has not reached yet. phoneMatchBranches() builds both —
  // see utils/phone.js for why the regex alone could never use an index.
  match.push(...phoneMatchBranches('members.phoneCore', 'members.phone', core));
  match.push(...phoneMatchBranches('tenantPhoneCore', 'tenantPhone', core));

  const others = await Booking.find({
    _id: { $ne: keepBookingId },
    status: { $nin: ['cancelled', 'completed'] },
    deletedAt: null,
    $or: match,
  });

  const closed = [];
  for (const booking of others) {
    // eslint-disable-next-line no-await-in-loop
    if (!closeMembership(booking, tenantUserId, tenantPhone, when)) continue;
    // eslint-disable-next-line no-await-in-loop
    await booking.save();
    closed.push(booking);
  }
  return closed;
}

async function notifyLandlordOfMoveOut({ booking, tenantName, reason }) {
  const where = [booking.property, booking.roomNumber ? `রুম ${booking.roomNumber}` : '']
    .filter(Boolean).join(' — ');
  await notifications.emit({
    userId: booking.landlordId,
    type:   'tenant_onboarding',
    title:  `${tenantName} বাসা ছেড়েছেন`,
    body:   `${where} — ${reason} রেকর্ড ও ভাড়ার হিসাব মুছে যায়নি, আগের মতোই দেখতে পাবেন।`,
    data: {
      audience:  'landlord',
      bookingId: String(booking._id),
      kind:      'move_out',
    },
  });
  notifySocket(booking.landlordId, 'rent:updated', { bookingId: String(booking._id) });
}

/**
 * Run after a tenant has been placed in a unit: close everything they left
 * behind and tell the landlords who lost them. Best-effort by design — the
 * placement itself has already committed, and a failure to tidy up the OLD
 * tenancy must never surface as "joining failed" to someone who has joined.
 */
async function settleMoveOut({ tenantUserId, tenantPhone, tenantName, keepBookingId, when, reason }) {
  try {
    const closed = await closeOtherTenancies({
      tenantUserId, tenantPhone, keepBookingId, when,
    });
    for (const booking of closed) {
      // eslint-disable-next-line no-await-in-loop
      await notifyLandlordOfMoveOut({ booking, tenantName, reason }).catch(() => {});
    }
    return closed;
  } catch (err) {
    console.warn('[tenancy] closing previous tenancies failed:', err.message);
    return [];
  }
}

module.exports = {
  phoneCore,
  activeMembers,
  seatsTaken,
  hasWholeRoomHold,
  findMyMember,
  tenancyStartedAt,
  sortByRecency,
  findLiveTenancies,
  closeMembership,
  closeOtherTenancies,
  notifyLandlordOfMoveOut,
  settleMoveOut,
};
