'use strict';

/**
 * memberRent — one occupant's share of a booking's monthly rent.
 * ──────────────────────────────────────────────────────────────────────────
 * A member row normally carries its own `monthlyRent`, and that is the answer.
 * When it doesn't (0 — a room filled from the Rooms view, where the landlord
 * sets the ROOM's rent and never a per-seat figure), the room's rent is split
 * evenly between the people still living there.
 *
 * Every server path used to fall back to the WHOLE booking rent instead:
 *
 *     Number(m.monthlyRent) || Number(booking.monthlyRent)
 *
 * so in a ৳6,000 two-seat room each roommate was billed ৳6,000. The landlord's
 * rent screen (which splits — seatShare() in tolet-pro-frontend's
 * HostDashboard.jsx) showed ৳3,000 owed, while the digest pushed to that same
 * landlord said ৳12,000, and the reminder sent to each tenant quoted ৳6,000.
 *
 * This mirrors the app's rule exactly, so the ledger screen and every number
 * the server sends agree:
 *   • an explicit per-member rent wins —
 *   • unless it merely repeats the room's rent in a room several people share,
 *     which is the room rent copied onto a seat, not a seat price;
 *   • otherwise the room's rent divided by the active occupants.
 *
 * RENT ONLY. Service charge is left to each caller as before.
 */

const activeMemberCount = (booking) => (Array.isArray(booking?.members)
  ? booking.members.filter((m) => m && m.status !== 'moved-out').length
  : 0);

function memberRentShare(booking, member) {
  const roomRent = Number(booking?.monthlyRent) || 0;
  const explicit = Number(member?.monthlyRent) || 0;
  const active = activeMemberCount(booking);
  if (explicit > 0 && !(active > 1 && explicit === roomRent)) return explicit;
  return active > 1 ? Math.round(roomRent / active) : roomRent;
}

module.exports = { memberRentShare };
