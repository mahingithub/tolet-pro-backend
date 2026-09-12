'use strict';

/**
 * DeliveryTrack — following one delivery, over a link.
 * ─────────────────────────────────────────────────────────────────────────────
 * A shopkeeper's delivery boy is not a user of this platform and never will be.
 * He is a teenager on a bicycle with somebody else's Android phone, he changes
 * every few weeks, and asking him to install an app and hold an account is
 * asking for a feature nobody uses. So tracking works the only way it can:
 *
 *   1. The shopkeeper taps ট্র্যাকিং লিংক on an accepted order.
 *   2. He sends the link over WhatsApp — the app he already uses to tell the
 *      boy where to go.
 *   3. The boy opens it. The page asks for location and posts a point every
 *      few seconds while it stays open.
 *   4. The shopkeeper and the TENANT both watch the same dot.
 *
 * No login, no install, no account. The token in the URL is the entire
 * credential, which is why the rules below are what they are.
 *
 * ─── THE TOKEN IS A CAPABILITY, SO IT IS DELIBERATELY WEAK ───────────────────
 * Anyone holding the link can post a position. That is acceptable ONLY because
 * of what the link can and cannot do:
 *
 *   • It is scoped to ONE order. It cannot read the tenant's details, cannot
 *     see any other order, and cannot move the order's status.
 *   • It EXPIRES — with the order, or after TTL_HOURS, whichever comes first.
 *     A link forwarded to a group chat stops working the same evening.
 *   • The worst a stranger can do with it is lie about where a bicycle is.
 *
 * ─── WHAT IT DOES NOT STORE ──────────────────────────────────────────────────
 * No identity for the courier. No name, no phone, no device id beyond a coarse
 * label. We are asking a stranger's phone for its location; recording who he is
 * on top of that would be collecting a person's movements because it happened
 * to be easy. The trail is a list of points attached to an ORDER, and it dies
 * with the order.
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

// How long a link stays alive at most, regardless of the order. A delivery is
// minutes; a whole working day is already generous, and it bounds how long a
// forwarded link keeps reporting.
const TTL_HOURS = 12;

// Trail length. Roughly an hour at one point every 20 seconds — enough to draw
// the route taken, short enough that a document cannot grow without bound if a
// phone is left on a windowsill.
const MAX_POINTS = 180;

// Below this the "distance left" number is not measuring travel, it is
// measuring GPS noise — and a number that jitters is a number nobody trusts.
const ARRIVED_METRES = 80;

const PointSchema = new mongoose.Schema(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    // Metres, as reported by the browser. Kept because a 2 km "accuracy" fix
    // from a cell tower should not be drawn as if it were a GPS lock.
    accuracy: { type: Number, default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const DeliveryTrackSchema = new mongoose.Schema(
  {
    requestId: {
      type: mongoose.Schema.Types.ObjectId, ref: 'ServiceRequest', required: true, index: true,
    },
    providerId: {
      type: mongoose.Schema.Types.ObjectId, ref: 'Provider', required: true, index: true,
    },

    // Only the HASH is stored. A database read must not yield a working link,
    // for the same reason the merchant refresh token is hashed: the row is the
    // one place both a backup and a leak would find it.
    tokenHash: { type: String, required: true, unique: true },

    // Where it is going. Copied from the order at creation, so the tracker page
    // can draw the destination without reading the order — and so a link can
    // never be used to fish the tenant's address out of a changing document.
    destination: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      // NOT the full address. The courier already has that from his boss; the
      // tracker only needs a point to aim at and a label to show.
      label: { type: String, default: '', maxlength: 120 },
    },

    // Where the shop is, so "how far has he got" has two ends.
    origin: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },

    status: {
      type: String,
      enum: ['pending', 'live', 'arrived', 'ended'],
      default: 'pending',
      index: true,
    },

    // A coarse label the courier's browser reports. Never a name or a number.
    device: { type: String, default: '', maxlength: 120 },

    points: { type: [PointSchema], default: [] },
    lastPoint: { type: PointSchema, default: null },

    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// Mongo drops the document once `expiresAt` passes. The trail is operational
// data with no reason to outlive the delivery, and letting the database forget
// it is better than trusting a sweep we would have to remember to write.
DeliveryTrackSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// "Is there already a live link for this order?" — the only other query.
DeliveryTrackSchema.index({ requestId: 1, status: 1 });

/** Only the hash is stored, so this is how a presented token is checked. */
DeliveryTrackSchema.statics.hashToken = function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
};

/**
 * Metres between two points, on a sphere.
 *
 * Haversine rather than a projected approximation: the error of a flat-earth
 * shortcut is small in Dhaka but the code is no simpler, and this number is
 * shown to a shopkeeper as "৪০০ মিটার দূরে".
 */
DeliveryTrackSchema.statics.metresBetween = function metresBetween(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)));
};

/**
 * Record one position.
 *
 * Trims the trail to MAX_POINTS and flips to `arrived` once the courier is
 * within ARRIVED_METRES of the destination — which is a hint for the UI, not a
 * state change on the order. Only the shopkeeper marks an order delivered;
 * a phone being near an address is not proof anything changed hands.
 */
DeliveryTrackSchema.methods.addPoint = function addPoint({ lat, lng, accuracy }) {
  const point = { lat, lng, accuracy: accuracy ?? null, at: new Date() };

  this.points.push(point);
  if (this.points.length > MAX_POINTS) {
    this.points = this.points.slice(-MAX_POINTS);
  }
  this.lastPoint = point;

  if (this.status === 'pending') {
    this.status = 'live';
    this.startedAt = new Date();
  }

  const left = this.constructor.metresBetween(point, this.destination);
  if (left != null && left <= ARRIVED_METRES && this.status === 'live') {
    this.status = 'arrived';
  }

  return point;
};

/** Metres still to travel, or null when we have no fix yet. */
DeliveryTrackSchema.methods.metresLeft = function metresLeft() {
  return this.constructor.metresBetween(this.lastPoint, this.destination);
};

/**
 * What a WATCHER may see — the shopkeeper, and the tenant.
 *
 * Deliberately not `toJSON`: the full document carries the token hash and the
 * whole trail, and a watcher needs neither. The tenant in particular gets the
 * courier's position because he is on his way to their door, and nothing else.
 */
DeliveryTrackSchema.methods.toWatcher = function toWatcher() {
  return {
    id: String(this._id),
    requestId: String(this.requestId),
    status: this.status,
    destination: this.destination,
    origin: this.origin,
    lastPoint: this.lastPoint || null,
    metresLeft: this.metresLeft(),
    // The recent trail, so a map can draw a line rather than a teleporting dot.
    trail: this.points.slice(-40),
    startedAt: this.startedAt,
    endedAt: this.endedAt,
    expiresAt: this.expiresAt,
    // Whether it is worth polling again. A watcher that cannot tell a finished
    // delivery from a stalled one polls forever.
    isOpen: ['pending', 'live', 'arrived'].includes(this.status)
      && this.expiresAt > new Date(),
  };
};

DeliveryTrackSchema.statics.TTL_HOURS = TTL_HOURS;
DeliveryTrackSchema.statics.MAX_POINTS = MAX_POINTS;
DeliveryTrackSchema.statics.ARRIVED_METRES = ARRIVED_METRES;

module.exports = mongoose.models.DeliveryTrack
  || mongoose.model('DeliveryTrack', DeliveryTrackSchema);
module.exports.TTL_HOURS = TTL_HOURS;
module.exports.ARRIVED_METRES = ARRIVED_METRES;
