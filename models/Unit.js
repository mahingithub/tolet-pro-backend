'use strict';

/**
 * Unit model — one rentable space inside a building (a room, or a flat).
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * Until now a "room" had no independent existence: it was whatever floor and
 * room number happened to be typed on a Booking. That had two consequences the
 * landlord felt directly.
 *
 *   1. A room could not exist without a tenant. `Booking` requires a leaseStart
 *      and a monthlyRent, so there was no way to say "room 301 has four seats,
 *      two of them empty" — vacancy was unrepresentable.
 *   2. Every new tenant meant retyping the room. Set the room up once, and the
 *      rent, floor, number and seat count outlive every tenant who passes
 *      through it — which is what a landlord means by "I already created that
 *      room."
 *
 * FLOOR IS A NUMBER, ON PURPOSE
 * It used to be free text on the booking (`floorNumber: String`), so "3rd",
 * "৩য়" and "3" were three different floors that could not be put in order.
 * Rent Collection is meant to read like the building itself — ground floor
 * first, then 1st, then 2nd, and 101 · 102 · 103 within each — and you cannot
 * sort a building out of adjectives. The label is rendered from the number.
 */

const mongoose = require('mongoose');

const UnitSchema = new mongoose.Schema(
  {
    buildingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Building', required: true, index: true },
    // Denormalised so ownership can be checked without loading the building.
    landlordId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // 0 = ground floor (নিচতলা). Negative allows a basement.
    floor:      { type: Number, required: true, min: -5, max: 200 },
    roomNumber: { type: String, required: true, trim: true, maxlength: 40 },

    // Seats in this room. Only meaningful when the building is rentedAs 'seat';
    // 1 everywhere else, because a flat or a single room IS one tenancy.
    seatCapacity: { type: Number, default: 1, min: 1, max: 60 },

    // Who this flat is suitable for — ফ্যামিলি / ব্যাচেলর / উভয়.
    //
    // PER-FLAT, NOT PER-BUILDING. One Green View holds flat 101 for a family,
    // 102 for bachelors and 103 for either; classifying the building would have
    // meant splitting it into two buildings that don't exist.
    //
    // METADATA ONLY. It drives classification, search/filter, card labels and
    // future house rules — nothing else. The booking shape, the seat system and
    // the rent ledger are identical whichever value it holds, because a flat let
    // to a family and a flat let to bachelors are the same thing everywhere it
    // counts: one unit, one occupancy, one payer, one ledger.
    //
    // Named `suitableFor` rather than `tenantType` on purpose: TenantProfile
    // already has a `tenantType` (student / employee / business / …) and two
    // different meanings under one name is how fields get misread later.
    suitableFor: { type: String, enum: ['', 'family', 'bachelor', 'both'], default: '' },

    // Money terms, set once with the room. Seats divide monthlyRent between
    // them unless a seat carries its own amount.
    monthlyRent:   { type: Number, default: 0, min: 0 },
    serviceCharge: { type: Number, default: 0, min: 0 },
    rentDueDay:    { type: Number, default: 5, min: 1, max: 28 },

    notes:  { type: String, trim: true, default: '', maxlength: 300 },
    status: { type: String, enum: ['active', 'archived'], default: 'active', index: true },
  },
  { timestamps: true },
);

// A building cannot hold two "room 301" on the same floor. This is the
// constraint that makes a unit addressable at all — and it is enforced here
// rather than by a UI check, because the AI scanner writes rooms too.
UnitSchema.index(
  { buildingId: 1, floor: 1, roomNumber: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } },
);

UnitSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => { ret.id = String(ret._id); delete ret._id; return ret; },
});

module.exports = mongoose.models.Unit || mongoose.model('Unit', UnitSchema);
