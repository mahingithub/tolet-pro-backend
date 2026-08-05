'use strict';

/**
 * BoostCredit model — the Plus plan's "1× Top Search Boost / month".
 * ──────────────────────────────────────────────────────────────────────────
 * One row per landlord. `creditsRemaining` is refilled to the plan's monthly
 * allowance on the 1st of each month by services/cron.service.js →
 * resetMonthlyBoostCredits(), and spent by POST /api/boost/:propertyId.
 *
 * Credits do NOT accumulate: the reset SETS the balance rather than adding to
 * it, so a host who skipped a month starts the next one with exactly one
 * boost, not two.
 *
 * Pro does not consume credits — Pro listings already rank above everything
 * else via the hostTier sort, so the boost endpoint short-circuits for them.
 */

const mongoose = require('mongoose');

const BoostCreditSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    creditsRemaining: { type: Number, default: 0, min: 0 },
    // Month key ('YYYY-MM') of the last refill. The reset job uses this to stay
    // idempotent — a re-run in the same month is a no-op, so a restarted cron
    // can't hand out a second allowance.
    lastResetDate: { type: Date, default: null },
    lastResetMonth: { type: String, default: '' },
    // Audit trail for support ("why do I have no boost left?").
    lastSpentAt: { type: Date, default: null },
    totalSpent: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

BoostCreditSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('BoostCredit', BoostCreditSchema);
