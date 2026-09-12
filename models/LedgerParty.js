'use strict';

/**
 * LedgerParty — one page in the shopkeeper's বাকির খাতা.
 * ─────────────────────────────────────────────────────────────────────────────
 * This is not a new accounting system. It is the credit book he already keeps
 * on paper: a page per person, দিলাম and পেলাম down the side, a running total
 * at the bottom. Nothing here should require him to learn a concept he does not
 * already use every day.
 *
 * ─── A PARTY IS NOT A USER ───────────────────────────────────────────────────
 * The overwhelming majority of a shopkeeper's customers will never hold a
 * To-Let Pro account or a Merchant account, and most of them never will. So a
 * party is a private record owned by the merchant — a name and, if he has it, a
 * phone number — created by him in two seconds without anybody else's
 * involvement.
 *
 * Trying to resolve parties against platform accounts would kill the feature on
 * day one: he would open the book, fail to find রহিম ভাই from the tea stall,
 * and go back to paper. `userId` is deliberately absent, and should stay that
 * way.
 *
 * ─── WHAT `balance` MEANS ────────────────────────────────────────────────────
 * ONE definition, everywhere: **the amount this party owes the merchant**, in
 * whole taka. It is derived from the entries and never set directly.
 *
 *   balance > 0   তিনি আপনার কাছে বাকি  (you will get)
 *   balance = 0   settled
 *   balance < 0   you owe them — an overpayment, or a refund pending
 *
 * The UI must never show a negative number to a shopkeeper; it says "পাবেন" or
 * "দেবেন" and shows the magnitude. The sign is an implementation detail.
 *
 * Suppliers (আমি কার কাছে বাকি) are NOT modelled yet. They invert the meaning
 * of every column and are a separate page in the paper book too; bolting them
 * onto this one with a direction flag would make both harder to read. Add them
 * as their own thing when the customer side is proven.
 */

const mongoose = require('mongoose');

const LedgerPartySchema = new mongoose.Schema(
  {
    merchantId: {
      type: mongoose.Schema.Types.ObjectId, ref: 'Merchant', required: true, index: true,
    },

    name: { type: String, required: true, trim: true, maxlength: 120 },
    // Optional on purpose. He knows "চায়ের দোকানের রহিম" and may not have a
    // number at all — demanding one would stop the entry he came here to make.
    // Without it, reminders simply are not offered for this party.
    phone: { type: String, trim: true, default: '', maxlength: 20 },
    note:  { type: String, trim: true, default: '', maxlength: 200 },

    // Derived from LedgerEntry, kept here so the party list renders without an
    // aggregation. Moved ONLY by `$inc` (see ledger.controller) so two entries
    // written at once cannot clobber each other, and rebuildable from the
    // entries by `recompute()` below if it ever drifts.
    balance: { type: Number, default: 0 },

    // Cheap denormalisations for the list: sort by who owes most, and show
    // "৩ দিন আগে" without touching the entries.
    lastEntryAt: { type: Date, default: null },
    entryCount:  { type: Number, default: 0 },

    // ─── Reminders ───────────────────────────────────────────────────────────
    // The recipient is NOT a user of this platform — he is a stranger to us who
    // happens to owe a shopkeeper money. Messaging him carries the same rules
    // the ধার reminders already follow, and they are strict on purpose:
    //
    //   • opt-in, per party, set by the merchant
    //   • never when the balance is settled or negative
    //   • at most once in `REMINDER_COOLDOWN_DAYS`
    //   • never without a phone number
    //
    // Getting this wrong does not annoy a user — it makes the platform the
    // thing that harassed somebody's customer on their behalf.
    reminder: {
      optIn:      { type: Boolean, default: false },
      lastSentAt: { type: Date, default: null },
      sentCount:  { type: Number, default: 0 },
    },

    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// The party list: this merchant's people, biggest debt first.
LedgerPartySchema.index({ merchantId: 1, balance: -1 });
// "Find রহিম" as he types.
LedgerPartySchema.index({ merchantId: 1, name: 1 });
// Two parties with the same phone under one merchant is nearly always the same
// person entered twice — which is how a balance silently splits in half.
//
// `$gt: ''` is how you say "a non-empty string" in a partial filter. The
// obvious `$ne: ''` is NOT allowed — Mongo compiles it to `$not` and rejects
// the whole index spec ("Expression not supported in partial index") — and
// since most parties legitimately have no phone at all, dropping the filter
// would instead cap every merchant at ONE phone-less party.
LedgerPartySchema.index(
  { merchantId: 1, phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $type: 'string', $gt: '' } } },
);

/** পাবেন / দেবেন / মিটে গেছে — what the UI should actually say. */
LedgerPartySchema.virtual('standing').get(function standing() {
  if (this.balance > 0) return 'will_receive';
  if (this.balance < 0) return 'will_pay';
  return 'settled';
});

/**
 * Rebuild `balance` from the entries. The denormalised number is an
 * optimisation and this is the truth — a shopkeeper who cannot trust the total
 * goes back to paper, so there must always be a way to prove it.
 */
LedgerPartySchema.statics.recompute = async function recompute(partyId) {
  const LedgerEntry = mongoose.model('LedgerEntry');
  const [agg] = await LedgerEntry.aggregate([
    { $match: { partyId: new mongoose.Types.ObjectId(String(partyId)), voidedAt: null } },
    {
      $group: {
        _id: null,
        balance: {
          $sum: { $cond: [{ $eq: ['$kind', 'credit'] }, '$amount', { $multiply: ['$amount', -1] }] },
        },
        entryCount: { $sum: 1 },
        lastEntryAt: { $max: '$at' },
      },
    },
  ]);

  const next = agg || { balance: 0, entryCount: 0, lastEntryAt: null };
  await this.updateOne({ _id: partyId }, {
    $set: {
      balance: next.balance,
      entryCount: next.entryCount,
      lastEntryAt: next.lastEntryAt,
    },
  });
  return next;
};

LedgerPartySchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('LedgerParty', LedgerPartySchema);
