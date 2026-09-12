'use strict';

/**
 * Admin Regulated Rates — typing in the circular.
 * ──────────────────────────────────────────────────────────────────────────
 * BERC re-announces the LPG maximum monthly; BTRC's entry broadband tiers move
 * rarely but do move. Neither can live in a config file, because a number baked
 * into a deploy goes wrong on OUR release cycle rather than the regulator's.
 * So an admin types the circular in here when it lands.
 *
 * This is the ONLY write path for a cap, and it is admin-only for the obvious
 * reason: a provider who could enter his own ceiling would be marking his own
 * homework.
 *
 * Entering a rate does not touch anybody's prices — see
 * services/priceCompliance.service.js for exactly what a cap is allowed to do.
 */

const RegulatedRate = require('../models/RegulatedRate');
const Provider = require('../models/Provider');
const ApiError = require('../utils/ApiError');
const compliance = require('../services/priceCompliance.service');
const { regulatedCategories, getCategory } = require('../config/serviceCategories');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/regulated-rates
//
// Returns which rows are regulated AT ALL (from the registry) alongside the
// rates on file, so the console can render a complete form instead of only the
// rows somebody happened to fill in already.
// ─────────────────────────────────────────────────────────────────────────────
exports.list = asyncH(async (req, res) => {
  const categories = regulatedCategories();
  const now = new Date();

  const out = [];
  for (const cat of categories) {
    const reg = cat.price.regulated;
    const field = cat.providerFields.find((f) => f.key === reg.field);
    const current = await RegulatedRate.currentFor(cat.id, now);

    out.push({
      category: cat.id,
      label: cat.label,
      authority: reg.authority,
      note: reg.note,
      field: reg.field,
      rows: reg.rows.map((rowKey) => {
        const row = field?.rows?.find((r) => r.key === rowKey);
        const rate = current[`${reg.field}.${rowKey}`] || null;
        return {
          rowKey,
          label: row ? { bn: row.bn, en: row.en } : null,
          unit: row?.unit || null,
          // null means no circular is on file for this row — which is a
          // different thing from a cap of zero, and the console must be able
          // to tell them apart.
          maxPrice: rate ? rate.maxPrice : null,
          effectiveFrom: rate ? rate.effectiveFrom : null,
          sourceUrl: rate ? rate.sourceUrl : '',
        };
      }),
    });
  }

  return res.json({ categories: out });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/regulated-rates/history?category=gas&rowKey=kg_12
// ─────────────────────────────────────────────────────────────────────────────
exports.history = asyncH(async (req, res) => {
  const filter = {};
  if (req.query.category) filter.category = String(req.query.category);
  if (req.query.rowKey) filter.rowKey = String(req.query.rowKey);

  const rows = await RegulatedRate.find(filter)
    .sort({ effectiveFrom: -1 })
    .limit(Math.min(200, Number.parseInt(req.query.limit, 10) || 50));

  return res.json({ rates: rows.map((r) => r.toJSON()) });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/regulated-rates
//   { category, rowKey, maxPrice, effectiveFrom, sourceUrl?, note? }
//
// One row per call. A circular usually sets several sizes at once, but the
// console posts them individually so a typo in the 45kg price cannot roll back
// a correct 12kg one.
// ─────────────────────────────────────────────────────────────────────────────
exports.upsert = asyncH(async (req, res) => {
  const category = String(req.body?.category || '');
  const cat = getCategory(category);
  const reg = cat && cat.price && cat.price.regulated;

  if (!reg) {
    // Refused rather than stored. A cap on an unregulated category is a number
    // we invented, and the whole model exists not to do that.
    throw ApiError.badRequest('এই ক্যাটাগরিতে সরকারি নির্ধারিত দাম নেই।', {
      code: 'not_regulated',
    });
  }

  const rowKey = String(req.body?.rowKey || '');
  if (!reg.rows.includes(rowKey)) {
    throw ApiError.badRequest('এই আইটেমে সরকারি দাম প্রযোজ্য নয়।', {
      code: 'row_not_regulated',
      details: { allowed: reg.rows },
    });
  }

  const maxPrice = Number(req.body?.maxPrice);
  if (!Number.isFinite(maxPrice) || maxPrice <= 0) {
    throw ApiError.badRequest('সঠিক সর্বোচ্চ দাম দিন।', { code: 'bad_price' });
  }

  const effectiveFrom = req.body?.effectiveFrom
    ? new Date(req.body.effectiveFrom) : new Date();
  if (Number.isNaN(effectiveFrom.getTime())) {
    throw ApiError.badRequest('কার্যকর তারিখ সঠিক নয়।', { code: 'bad_date' });
  }

  // Keyed on the effective date, so re-submitting the same circular corrects it
  // while a NEW circular becomes its own row. History is kept, never
  // overwritten: a compliance check against last month has to use last month's
  // ceiling.
  const doc = await RegulatedRate.findOneAndUpdate(
    { category, field: reg.field, rowKey, effectiveFrom },
    {
      $set: {
        maxPrice: Math.round(maxPrice),
        authority: reg.authority,
        sourceUrl: String(req.body?.sourceUrl || '').slice(0, 600),
        note: String(req.body?.note || '').slice(0, 300),
        enteredBy: req.user._id,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  return res.status(201).json({ rate: doc.toJSON() });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/regulated-rates/check
//
// Re-run the compliance sweep now, rather than waiting for the nightly one.
// What an admin wants immediately after typing in a new circular.
// ─────────────────────────────────────────────────────────────────────────────
exports.runCheck = asyncH(async (req, res) => {
  const summary = await compliance.runPriceCompliance();
  return res.json({ ...summary });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/regulated-rates/flagged
//
// The providers currently priced above a ceiling.
//
// This endpoint is the entire reason the sweep writes
// `Provider.priceCompliance.overCapRows` at all. Without it the flag was
// computed nightly, stored, and read by nobody — a check that runs and reports
// to no one is not a check.
//
// ─── IT IS A REVIEW QUEUE, NOT AN ACCUSATION LIST ────────────────────────────
// A cap is a MAXIMUM and most flags are simply a stale price list. So this
// returns the two numbers side by side plus `pricesUpdatedAt`, and says nothing
// about what should happen next — that is a human's call. Nothing here
// suspends, hides or rewrites anybody.
// ─────────────────────────────────────────────────────────────────────────────
exports.listFlagged = asyncH(async (req, res) => {
  const filter = { 'priceCompliance.overCapRows.0': { $exists: true } };
  if (req.query.category) filter.category = String(req.query.category);

  const rows = await Provider.find(filter)
    .select('name phone category thana area status pricesUpdatedAt priceCompliance')
    // Worst first: the biggest gap is the one most likely to be a real problem
    // rather than a forgotten update.
    .limit(Math.min(200, Number.parseInt(req.query.limit, 10) || 100))
    .lean();

  const providers = rows.map((p) => {
    const cat = getCategory(p.category);
    const field = cat?.providerFields?.find((f) => f.key === cat?.price?.regulated?.field);

    const over = (p.priceCompliance?.overCapRows || []).map((r) => {
      const row = field?.rows?.find((x) => x.key === r.row);
      return {
        ...r,
        label: row ? { bn: row.bn, en: row.en } : null,
        // Precomputed so the console never has to re-derive the one number the
        // whole row is sorted and judged on.
        overBy: Math.max(0, r.price - r.cap),
      };
    });

    return {
      id: String(p._id),
      name: p.name,
      phone: p.phone,
      category: p.category,
      categoryLabel: cat ? cat.label : null,
      authority: cat?.price?.regulated?.authority || null,
      thana: p.thana,
      area: p.area,
      status: p.status,
      // The most likely innocent explanation, shown next to the accusation.
      pricesUpdatedAt: p.pricesUpdatedAt,
      checkedAt: p.priceCompliance?.checkedAt || null,
      overCapRows: over,
      worstOverBy: over.reduce((m, r) => Math.max(m, r.overBy), 0),
    };
  });

  providers.sort((a, b) => b.worstOverBy - a.worstOverBy);

  return res.json({ providers, count: providers.length });
});
