'use strict';

/**
 * RegulatedRate — a published government ceiling for one priced row.
 * ─────────────────────────────────────────────────────────────────────────────
 * config/serviceCategories.js says WHICH rows are regulated and by whom (BERC
 * for LPG cylinders, BTRC's "One Country One Rate" for the entry broadband
 * tiers). It cannot say what the number is: BERC re-announces monthly, and a
 * price baked into a config file is a price that goes wrong on a deploy cycle
 * rather than a regulator's cycle. So the numbers live here, entered by an
 * admin when the circular comes out.
 *
 * ─── A CAP IS A MAXIMUM, NOT A PRICE ─────────────────────────────────────────
 * This is the rule the whole model exists to protect. Shops sell below the
 * ceiling all the time, and a cheaper shop is the thing a tenant most wants to
 * find. So nothing derived from this collection may ever:
 *
 *   • set or rewrite a provider's price
 *   • hide or rank down a provider for being UNDER the cap
 *   • describe a provider as "overcharging" — we know what the regulator
 *     published, not what was agreed at the door
 *
 * It may do exactly two things: flag a row priced above the ceiling for review
 * (Provider.priceCompliance.overCapRows), and nudge providers to update when a
 * new circular lands.
 *
 * ─── HISTORY IS KEPT, NOT OVERWRITTEN ────────────────────────────────────────
 * Each announcement is its own row with its own `effectiveFrom`. A compliance
 * check against last month's order has to use last month's ceiling — the same
 * reason an order freezes its unit prices at placement. `current()` picks the
 * newest row that had already taken effect at the moment being asked about.
 */

const mongoose = require('mongoose');

const RegulatedRateSchema = new mongoose.Schema(
  {
    // serviceCategories id ('gas', 'internet') + the price_rows field and row
    // key the ceiling applies to. Matching the registry's own keys means an
    // old rate still resolves to a real, labelled row years later.
    category: { type: String, required: true, index: true },
    field:    { type: String, required: true, trim: true, maxlength: 60 },
    rowKey:   { type: String, required: true, trim: true, maxlength: 60 },

    authority: { type: String, enum: ['BERC', 'BTRC', 'other'], required: true },

    maxPrice: { type: Number, required: true, min: 0 },

    // When the circular takes effect — NOT when it was typed in. An admin
    // entering Tuesday's rate on Thursday must be able to say so, or every
    // compliance check between the two is measured against the wrong number.
    effectiveFrom: { type: Date, required: true, index: true },

    // Where this number came from, so a shopkeeper who disputes it can be shown
    // the circular rather than argued with. A cap with no citation is a number
    // we made up, and it will be treated as one.
    sourceUrl: { type: String, default: '', maxlength: 600 },
    note:      { type: String, default: '', maxlength: 300 },

    enteredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

// One announcement per row per effective date. Re-entering the same circular —
// which is what a double-submit or a second admin does — updates rather than
// stacking two ceilings that disagree.
RegulatedRateSchema.index(
  { category: 1, field: 1, rowKey: 1, effectiveFrom: -1 },
  { unique: true },
);

/**
 * The ceilings in force for a category at a given moment.
 *
 * Returns a `{ "field.rowKey": rate }` map. Built with one aggregation and a
 * `$first` per row rather than N queries, because the compliance sweep runs
 * over every active provider.
 */
RegulatedRateSchema.statics.currentFor = async function currentFor(category, at = new Date()) {
  const rows = await this.aggregate([
    { $match: { category, effectiveFrom: { $lte: at } } },
    // Newest FIRST, so `$first` below is the one in force. A row announced for
    // next month is excluded by the match above, not by this sort.
    { $sort: { effectiveFrom: -1 } },
    {
      $group: {
        _id: { field: '$field', rowKey: '$rowKey' },
        maxPrice: { $first: '$maxPrice' },
        authority: { $first: '$authority' },
        effectiveFrom: { $first: '$effectiveFrom' },
        sourceUrl: { $first: '$sourceUrl' },
      },
    },
  ]);

  return Object.fromEntries(rows.map((r) => [
    `${r._id.field}.${r._id.rowKey}`,
    {
      field: r._id.field,
      rowKey: r._id.rowKey,
      maxPrice: r.maxPrice,
      authority: r.authority,
      effectiveFrom: r.effectiveFrom,
      sourceUrl: r.sourceUrl,
    },
  ]));
};

RegulatedRateSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.models.RegulatedRate
  || mongoose.model('RegulatedRate', RegulatedRateSchema);
