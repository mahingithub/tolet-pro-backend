'use strict';

/**
 * TenantOnboarding — a tenant's own account of who they are, awaiting the
 * landlord's yes.
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS MODEL EXISTS AT ALL
 * The obvious implementation of "tenant scans a QR and fills in a form" writes
 * straight into Booking.members[]. That works right up until the link leaves
 * the person it was sent to — and a building-wide link is *meant* to leave, it
 * gets pasted into a group chat with forty people in it.
 *
 * At that point "I live in room 203" stops being a fact the app can act on and
 * becomes a claim someone typed. This model is where a claim waits. The
 * landlord, who is the only one who actually knows who lives in 203, turns it
 * into a fact by approving it — and only then does anything touch Booking.
 *
 * The landlord still types nothing. That was the whole point of the feature,
 * and it survives: approving is one tap on a row that is already filled in.
 *
 * WHAT SKIPS THE QUEUE
 * A UNIT-scoped token is sent to one person for one room, the way a key is.
 * Those auto-approve — a row is still written here, immediately `approved`, so
 * every self-onboarding leaves the same audit trail whichever door it came
 * through, and the host has one place to look for "how did this person get in".
 *
 * WHAT THIS IS NOT
 * Not a KYC/verification record. `kyc_tenant` already covers "is this person's
 * NID real". This only covers "does this person belong in this room", which is
 * the landlord's question, not the platform's.
 */

const mongoose = require('mongoose');
const { TenantProfileSchema } = require('./Booking');

const TenantOnboardingSchema = new mongoose.Schema(
  {
    // Who has to decide. Denormalised from the building so the host's pending
    // list is a single indexed read with no joins.
    landlordId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Who is asking. Always a real account — the invite form requires a login,
    // so an approval links a person, not a name.
    tenantId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    buildingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Building', required: true, index: true },
    // The room being claimed. Set from the token for a unit invite, or from the
    // tenant's own choice for a building invite.
    unitId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', default: null, index: true },
    // Filled in on approval — the booking the member was actually written to.
    bookingId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null },
    memberId:   { type: mongoose.Schema.Types.ObjectId, default: null },

    // Which door they came through. Decides whether this needed approval, and
    // is worth keeping afterwards: "they used the group link" is the context a
    // landlord wants when a record looks wrong six months later.
    scope: { type: String, enum: ['building', 'unit'], required: true },
    // The token as used, so a revoked token's submissions stay traceable.
    tokenUsed: { type: String, trim: true, default: '', maxlength: 64 },

    // ── 'join' vs 'shift' ────────────────────────────────────────────────────
    // A SHIFT is the same person moving from one room to another in a building
    // they are already in — 301 to 204 — and it is a different question from a
    // join even though it produces the same kind of member row.
    //
    // It rides this model rather than getting its own because the landlord's
    // decision is identical in shape ("does this person belong in that room?"),
    // and because the alternative — the tenant re-scanning the building QR and
    // filling the whole form again — creates a SECOND live tenancy for one
    // human, which is exactly the duplicate-card problem this is meant to end.
    //
    // The difference is what approval does: a shift also closes the row they
    // are leaving, in the same save. See approveOnboarding().
    kind: { type: String, enum: ['join', 'shift'], default: 'join', index: true },

    // Where a shift is coming FROM. Null on a plain join. Kept after the move
    // so "they were in 301 until March" is answerable from this row alone,
    // without walking two bookings' member arrays.
    fromUnitId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Unit',    default: null },
    fromBookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null },
    fromMemberId:  { type: mongoose.Schema.Types.ObjectId, default: null },

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },

    // ── What the tenant typed ────────────────────────────────────────────────
    // Name and phone sit here rather than only in tenantProfile because that is
    // where the rest of the app reads them from on a member, and because the
    // host's pending list needs them without unpacking the profile.
    name:  { type: String, trim: true, default: '', maxlength: 100 },
    phone: { type: String, trim: true, default: '', maxlength: 20 },
    tenantProfile: { type: TenantProfileSchema, default: () => ({}) },
    // Their requested move-in. The landlord's approval is what makes it a lease
    // start; until then it is a date on a form.
    moveInDate: { type: Date, default: Date.now },

    // Free text from the tenant ("I'm the one who called on Friday"). Useful
    // exactly once — when the landlord is deciding — and never after.
    note: { type: String, trim: true, default: '', maxlength: 300 },

    decidedAt: { type: Date, default: null },
    // Why it was declined, shown back to the tenant so a rejection is not a
    // silent disappearance.
    rejectReason: { type: String, trim: true, default: '', maxlength: 300 },
  },
  { timestamps: true },
);

// The host's pending queue: "what is waiting for me, newest first".
TenantOnboardingSchema.index({ landlordId: 1, status: 1, createdAt: -1 });
// The tenant's own view, and the duplicate-submission check.
TenantOnboardingSchema.index({ tenantId: 1, status: 1 });

// One person cannot have two requests pending for the same room at once —
// double-tapping "Connect" is the common case, and a second row would show the
// landlord the same person twice. Partial so approved/rejected history is kept
// in full (someone may legitimately move out of 203 and back into it later).
TenantOnboardingSchema.index(
  { tenantId: 1, buildingId: 1, unitId: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } },
);

TenantOnboardingSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => { ret.id = String(ret._id); delete ret._id; return ret; },
});

module.exports = mongoose.models.TenantOnboarding
  || mongoose.model('TenantOnboarding', TenantOnboardingSchema);
