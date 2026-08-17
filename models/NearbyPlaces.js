'use strict';

/**
 * NearbyPlaces model — persistent cache for the property "What's nearby" grid.
 * ──────────────────────────────────────────────────────────────────────────
 * Nearby POIs come from OpenStreetMap's Overpass API, which is free but slow
 * and frequently overloaded (we routinely measure 8–16 s on a good mirror and
 * outright 504s on a bad one). Hitting it on every property view made the
 * section take 5–45 s to appear, and sometimes fail entirely.
 *
 * Hospitals, mosques and bus stops do not move, so the answer is cacheable
 * more or less forever. We bucket coordinates into a grid of ~110 m cells
 * (3 decimal places) and store one document per cell, which means:
 *
 *   • Every property in the same neighbourhood shares one cached answer.
 *   • The cache survives server restarts and is shared across instances,
 *     unlike the in-process LRU that sits in front of it.
 *   • The first viewer of a brand-new area pays the Overpass cost once;
 *     everybody after them is served from Mongo in a few milliseconds.
 *
 * `refreshedAt` drives stale-while-revalidate: past SOFT_TTL we still return
 * the cached rows immediately and kick off a background refresh. The TTL index
 * on `expiresAt` is only a hard floor so abandoned cells eventually vacate.
 */

const mongoose = require('mongoose');

// One cached POI row. `name` is whatever OSM's default `name` tag holds
// (usually English or a transliteration); `nameBn` is the `name:bn` tag when
// a mapper has supplied one, which is what lets the UI render real Bengali.
const PlaceSchema = new mongoose.Schema(
  {
    key:    { type: String, required: true },   // stable category id: 'hospital', 'mosque', …
    name:   { type: String, default: '' },
    nameBn: { type: String, default: '' },
    distKm: { type: Number, default: null },    // null = nothing found in radius
  },
  { _id: false },
);

const NearbyPlacesSchema = new mongoose.Schema(
  {
    // "23.792,90.408" — lat/lng rounded to 3 dp. The only field this collection
    // is ever queried by. `unique` already creates the index, so no `index: true`.
    cell: { type: String, required: true, unique: true },

    // Centre of the cell the Overpass query was actually run for, kept for
    // debugging and for the background refresh.
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },

    places: { type: [PlaceSchema], default: [] },

    // Which Overpass mirror answered, and how long it took. Purely
    // diagnostic, but very handy when the section gets slow again.
    source:   { type: String, default: '' },
    tookMs:   { type: Number, default: 0 },

    // Bumped on every successful upstream fetch. Drives stale-while-revalidate.
    // Not indexed — it's only ever read from a document already fetched by cell.
    refreshedAt: { type: Date, default: Date.now },

    // Hard expiry backstop for the TTL index below.
    expiresAt: { type: Date, default: () => new Date(Date.now() + 180 * 24 * 60 * 60 * 1000) },
  },
  { timestamps: true },
);

// Mongo auto-deletes cells nobody has refreshed in ~6 months.
NearbyPlacesSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('NearbyPlaces', NearbyPlacesSchema);
