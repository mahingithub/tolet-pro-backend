'use strict';

/**
 * SyncOp — the record of a write we have already applied.
 * ──────────────────────────────────────────────────────────────────────────
 * A landlord collects rent walking the building, where there is often no
 * signal. Those writes are queued on the phone and replayed when the network
 * returns, and a write can arrive twice for two ordinary reasons: the request
 * reached us but its response was lost, or the app was killed mid-flush and the
 * persisted queue replayed from the start.
 *
 * That is not a cosmetic problem here. `bookingPayment.service.applyPayment`
 * ACCUMULATES — `amountReceived` is folded into what the month already holds —
 * so the same ৳5,000 delivered twice becomes ৳10,000 collected. Every mutation
 * therefore carries a client-generated `opId`, and this collection is the memory
 * of which ones have been applied.
 *
 * Claiming is an INSERT against a unique index rather than a read-then-write, so
 * two devices flushing the same operation at the same moment cannot both win.
 *
 * Rows expire on their own after a week (TTL index): a queue only ever replays
 * recent work, so a longer memory buys nothing and just grows the collection.
 */

const mongoose = require('mongoose');

const SyncOpSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // The id the client minted for this operation.
    opId: { type: String, required: true, maxlength: 40 },
    at: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

// The claim. Scoped per user so one landlord's ids can never block another's.
SyncOpSchema.index({ userId: 1, opId: 1 }, { unique: true });
// Self-pruning: a replayed queue is days old at worst, never weeks.
SyncOpSchema.index({ at: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = mongoose.model('SyncOp', SyncOpSchema);
