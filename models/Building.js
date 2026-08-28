'use strict';

/**
 * Building model — the landlord's property, as a real record.
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * A landlord's buildings used to live inside `landlordProfile.buildings` — a
 * loose array on the user document with client-generated ids like
 * `bldg_1724832000`. Nothing referenced those ids. A booking's only link to a
 * building was its `property` NAME, matched with `===`:
 *
 *     bookings.filter(b => b.property === bldg.name)
 *
 * That string was the foreign key, and it broke exactly as you would expect.
 * Picking "Hostel" on the Add Tenant form cleared the pre-filled property name,
 * the landlord retyped something slightly different, and the saved lease — a
 * real row, written to the database, with a success toast — matched no building
 * and vanished from Bookings, Rent Collection and the dashboard at once. It
 * looked exactly like a failed save.
 *
 * A booking now carries `buildingId`. Names are for reading; ids are for
 * joining. Renaming a building is a display change and nothing more.
 *
 * THE HIERARCHY
 *     Building → Unit (floor + room) → Seat (a member on the booking)
 *
 * `rentedAs` is decided here, once, and it LOCKS the building: a seat building
 * only ever opens the seat flow, so a hostel owner can't accidentally create a
 * whole-room tenancy over a room that already has four seats in it.
 */

const mongoose = require('mongoose');

// Residential is fully specified. Commercial deliberately carries no
// sub-categories yet — its form hasn't been designed, and inventing one would
// mean guessing at fields nobody asked for.
const CATEGORIES = ['residential', 'commercial'];

// The three residential types the setup wizard offers.
//
// Family vs bachelor is deliberately NOT here. One building routinely holds
// both — flat 101 to a family, 102 to bachelors, 103 to either — so it is a
// property of each FLAT, not of the building that contains them. It lives on
// Unit.suitableFor. Classifying the whole building would have forced a landlord
// to split one Green View into two, which is not a building, it is a filter.
const SUB_CATEGORIES = ['flat', 'hostel', 'single_room', ''];

// The residential types offered in the UI, in wizard order.
const RESIDENTIAL_SUB_CATEGORIES = ['flat', 'hostel', 'single_room'];

// A flat is let whole. Only rooms and hostels can be subdivided, so only they
// get a choice of rentedAs.
const FLAT_SUB_CATEGORIES = ['flat'];

// How the units in this building are let out, which decides which booking form
// the landlord ever sees:
//   flat → the whole unit is one tenancy (a family flat)
//   room → each room is one tenancy (a single-room let)
//   seat → each room is subdivided into seats, one tenancy per seat (a hostel)
const RENTED_AS = ['flat', 'room', 'seat'];

const BuildingSchema = new mongoose.Schema(
  {
    landlordId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    name:    { type: String, required: true, trim: true, maxlength: 160 },
    address: { type: String, trim: true, default: '', maxlength: 300 },

    category:    { type: String, enum: CATEGORIES, default: 'residential', index: true },
    // Indexed because the buildings list filters on it.
    subCategory: { type: String, enum: SUB_CATEGORIES, default: 'flat', index: true },
    rentedAs:    { type: String, enum: RENTED_AS, default: 'flat' },

    // Defaults a new room inherits, so the money terms are typed once per
    // building rather than once per room. A room can still override them.
    defaultMonthlyRent:  { type: Number, default: 0, min: 0 },
    defaultServiceCharge: { type: Number, default: 0, min: 0 },
    defaultRentDueDay:   { type: Number, default: 5, min: 1, max: 28 },

    // Archived buildings stay joinable so historic leases still resolve a name.
    status: { type: String, enum: ['active', 'archived'], default: 'active', index: true },
  },
  { timestamps: true },
);

// One landlord shouldn't end up with two buildings of the same name — that is
// the ambiguity the name-matching bug was built on. Scoped per landlord, and
// only across ACTIVE buildings so an archived one doesn't block re-use.
BuildingSchema.index(
  { landlordId: 1, name: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } },
);

BuildingSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => { ret.id = String(ret._id); delete ret._id; return ret; },
});

module.exports = mongoose.models.Building || mongoose.model('Building', BuildingSchema);
module.exports.ENUMS = {
  CATEGORIES, SUB_CATEGORIES, RENTED_AS,
  RESIDENTIAL_SUB_CATEGORIES, FLAT_SUB_CATEGORIES,
};
