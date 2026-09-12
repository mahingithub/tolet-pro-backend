'use strict';

/**
 * priceCompliance.service — checking prices against a published ceiling.
 * ─────────────────────────────────────────────────────────────────────────────
 * Only two categories are regulated in any dependable way: LPG cylinders, where
 * BERC announces a monthly MAXIMUM retail price, and the entry broadband tiers
 * covered by BTRC's "One Country One Rate". Grocery is not, and never will be
 * here — TCB announces a few items sporadically and there is no number we could
 * hold a shopkeeper to without inventing it.
 *
 * ─── WHAT THIS IS ALLOWED TO DO ──────────────────────────────────────────────
 * A cap is a MAXIMUM, not a price. Shops sell below it, and the cheaper shop is
 * exactly what a tenant is looking for. So this service:
 *
 *   ✓ records which rows sit above the ceiling, on the provider
 *   ✓ nudges that provider once, in his own words, to check them
 *   ✗ never rewrites a price
 *   ✗ never hides, ranks down, or suspends anybody for it
 *   ✗ never says "overcharging" — we know what was published, not what was
 *     agreed at the door, and a delivery charge is not a violation
 *
 * The flag is advisory. A human decides whether it means anything, and the
 * provider is told what was compared so he can push back with a receipt.
 */

const Provider = require('../models/Provider');
const RegulatedRate = require('../models/RegulatedRate');
const notify = require('./serviceRequestNotify.service');
const { regulatedCategories, getCategory } = require('../config/serviceCategories');

const DAY_MS = 24 * 60 * 60 * 1000;

// A shopkeeper hears about this at most once a fortnight, however many rows are
// over and however often the sweep runs. This is a nudge about paperwork, not
// an emergency.
const NUDGE_COOLDOWN_DAYS = 14;

// Prices are entered in whole taka and regulators publish whole taka, but a
// ৳1 gap is a rounding argument, not a finding. Only flag a real difference.
const TOLERANCE = 1;

const APP = 'TO-LET PRO';

/**
 * Compare one provider's prices against the ceilings in force.
 *
 * Pure: returns the rows that are over, and touches nothing. The caller
 * decides whether to persist — which keeps this usable from a controller that
 * wants to warn a provider while he is still editing.
 */
function findOverCapRows(provider, rateMap) {
  const cat = getCategory(provider.category);
  const regulated = cat && cat.price && cat.price.regulated;
  if (!regulated) return [];

  const over = [];
  for (const rowKey of regulated.rows) {
    const rate = rateMap[`${regulated.field}.${rowKey}`];
    if (!rate) continue;   // no circular on file for this row yet

    const price = provider.fields?.[regulated.field]?.[rowKey];
    // A row he does not stock has no price and is not a finding.
    if (!Number.isFinite(price)) continue;

    if (price > rate.maxPrice + TOLERANCE) {
      over.push({
        field: regulated.field,
        row: rowKey,
        price,
        cap: rate.maxPrice,
      });
    }
  }
  return over;
}

/** The provider-facing message. Names the row, the two numbers, and who published. */
function nudgeBody(provider, over, authority) {
  const lines = over.slice(0, 4).map((r) => {
    const cat = getCategory(provider.category);
    const field = cat?.providerFields.find((f) => f.key === r.field);
    const row = field?.rows?.find((x) => x.key === r.row);
    return `• ${row ? row.bn : r.row}: আপনার ৳${r.price}, ${authority} সর্বোচ্চ ৳${r.cap}`;
  });

  return [
    `${provider.name} এর কিছু দাম ${authority} এর প্রকাশিত সর্বোচ্চ দামের উপরে আছে:`,
    ...lines,
    over.length > 4 ? `…এবং আরও ${over.length - 4}টি` : null,
    // The escape hatch, said first. Most flags will be a stale price list, and
    // treating a shopkeeper as a suspect over one is how he stops answering.
    'দাম পুরোনো হয়ে থাকলে অ্যাপে গিয়ে ঠিক করে দিন। ডেলিভারি খরচ আলাদা হলে সেটি সমস্যা নয়।',
    `— ${APP}`,
  ].filter(Boolean).join('\n');
}

/**
 * Sweep every active provider in a regulated category.
 *
 * `checkedAt` is stamped even when nothing is over, so "checked and clean" is
 * distinguishable from "never checked" — without that, an empty overCapRows
 * means both, and the admin console cannot tell a compliant shop from an
 * unexamined one.
 */
async function runPriceCompliance(now = new Date()) {
  const categories = regulatedCategories();
  const cooldown = new Date(now.getTime() - NUDGE_COOLDOWN_DAYS * DAY_MS);

  let swept = 0;
  let flagged = 0;
  let nudged = 0;

  for (const cat of categories) {
    const rateMap = await RegulatedRate.currentFor(cat.id, now);
    // No circular on file for this category yet. Sweeping would stamp every
    // provider "checked" against nothing, which is worse than not checking.
    if (!Object.keys(rateMap).length) continue;

    const providers = await Provider.find({ category: cat.id, status: 'active' }).limit(1000);

    for (const p of providers) {
      swept += 1;
      const over = findOverCapRows(p, rateMap);

      await Provider.updateOne({ _id: p._id }, {
        $set: { 'priceCompliance.checkedAt': now, 'priceCompliance.overCapRows': over },
      });
      if (!over.length) continue;

      flagged += 1;

      const last = p.lifecycle?.priceNudgedAt;
      if (last && last > cooldown) continue;

      // Shares `lifecycle.priceNudgedAt` with the staleness nudge on purpose:
      // both are "go and fix your price list", and a shopkeeper who gets both
      // in one week reads it as spam rather than as two findings.
      await Provider.updateOne({ _id: p._id }, { $set: { 'lifecycle.priceNudgedAt': now } });
      nudged += 1;

      await notify.toPhone(
        p.phone,
        nudgeBody(p, over, cat.price.regulated.authority),
        { label: 'price-cap' },
      ).catch(() => null);
    }
  }

  if (flagged) {
    console.log(`[price-cap] ${swept} checked, ${flagged} over cap, ${nudged} nudged`);
  }
  return { swept, flagged, nudged };
}

module.exports = {
  runPriceCompliance,
  findOverCapRows,
  nudgeBody,
  NUDGE_COOLDOWN_DAYS,
  TOLERANCE,
};
