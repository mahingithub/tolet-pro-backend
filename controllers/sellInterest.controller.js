'use strict';

/**
 * Sell-Interest Controller
 * ──────────────────────────────────────────────────────────────────────────
 * Records "I am interested in selling my property" clicks (demand gauge while
 * self-service selling is Coming Soon) and exposes admin stats.
 *
 *   POST /api/sell-interest        (optionalAuth) — record a click
 *   GET  /api/admin/sell-interest  (requireAdminAuth) — count + recent list
 */

const SellInterest = require('../models/SellInterest');
const { LEGACY_SOURCE_MAP, getCategory } = require('../config/serviceCategories');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const normaliseKind = (v) => {
  const s = String(v || '').toLowerCase();
  return (s === 'buy' || s === 'service') ? s : 'sell';
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sell-interest — record one interest click.
// Works for guests AND logged-in users (optionalAuth attaches req.user when a
// valid token is present). No form data is required; a logged-in user's name +
// phone are copied from their account so the agency can follow up.
// ─────────────────────────────────────────────────────────────────────────────
exports.recordInterest = asyncH(async (req, res) => {
  const kind = normaliseKind(req.body.kind);
  const source = String(req.body.source || 'add_property').trim().slice(0, 60);
  const user = req.user || null;

  if (user) {
    // One record per (person, kind, SOURCE): a repeat tap on the SAME source
    // bumps clickCount, so one person tapping "Internet" five times is still
    // one interested person — but that same person also tapping "Cleaning"
    // is now a second row, not an overwrite.
    //
    // `source` used to live in $set with the filter being just (userId, kind).
    // That made every category tap clobber the previous one: a tenant who
    // tapped Internet → Cleaning → Movers left a single row reading
    // `source: 'service_movers', clickCount: 3`, and the first two categories
    // were gone. The per-category demand signal — the entire reason this
    // collection exists for kind:'service' — was being destroyed on write.
    // Only guests (one row per tap, no identity to dedupe on) kept it intact.
    //
    // The filter fields seed the new doc on insert, so they must NOT also
    // appear in an update operator — that would raise a Mongo write conflict.
    // Hence `source` moves OUT of $set as it moves INTO the filter.
    const doc = await SellInterest.findOneAndUpdate(
      { userId: user._id, kind, source },
      {
        $set: { name: user.name || '', phone: user.phone || '' },
        $inc: { clickCount: 1 },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    return res.status(201).json({ ok: true, interest: doc.toJSON() });
  }

  // Guest — anonymous demand signal (can't dedupe without an identity).
  const doc = await SellInterest.create({ kind, source });
  return res.status(201).json({ ok: true, interest: doc.toJSON() });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/sell-interest — admin stats + recent follow-up list.
// Query: ?kind=sell|buy|service (default 'sell').
//
// Since a logged-in person can now hold several rows of the same kind (one per
// source), a row is no longer a person. The headline counts therefore count
// DISTINCT PEOPLE — `registered` is a distinct userId count, and guests are
// counted per row because there is no identity to dedupe them by.
//
// For kind:'sell' this changes nothing: the only source that has ever been
// recorded is 'add_property', so one person still has exactly one row, and the
// admin Overview tile reads the same numbers it always did.
// ─────────────────────────────────────────────────────────────────────────────
exports.getStats = asyncH(async (req, res) => {
  const kind = normaliseKind(req.query.kind);
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [records, registeredIds, guests, last7d, recentDocs, bySource] = await Promise.all([
    SellInterest.countDocuments({ kind }),
    SellInterest.distinct('userId', { kind, userId: { $ne: null } }),
    SellInterest.countDocuments({ kind, userId: null }),
    SellInterest.countDocuments({ kind, createdAt: { $gte: since7d } }),
    SellInterest.find({ kind }).sort({ updatedAt: -1 }).limit(50),

    // The per-category breakdown — the whole point of keying rows by source.
    // `taps` sums clickCount (raw enthusiasm); `people` is the head count that
    // should actually drive which categories launch first.
    SellInterest.aggregate([
      { $match: { kind } },
      {
        $group: {
          _id: '$source',
          records: { $sum: 1 },
          taps: { $sum: '$clickCount' },
          users: { $addToSet: '$userId' },
          guests: { $sum: { $cond: [{ $eq: ['$userId', null] }, 1, 0] } },
          lastAt: { $max: '$updatedAt' },
        },
      },
      {
        $project: {
          _id: 0,
          source: '$_id',
          records: 1,
          taps: 1,
          guests: 1,
          lastAt: 1,
          // $addToSet collapses every guest into a single null, so filter it
          // out rather than trusting $size on the raw set.
          registered: {
            $size: { $filter: { input: '$users', cond: { $ne: ['$$this', null] } } },
          },
        },
      },
      { $addFields: { people: { $add: ['$registered', '$guests'] } } },
      { $sort: { people: -1, taps: -1 } },
    ]),
  ]);

  const registered = registeredIds.length;

  res.json({
    stats: {
      total: registered + guests,  // distinct people (best-effort for guests)
      registered,                  // distinct logged-in accounts
      guests,                      // anonymous rows — one per tap
      last7d,                      // rows created in the last 7 days
      records,                     // raw row count (people × categories)
    },
    // Present for every kind, but only meaningful for 'service', where each
    // source is one ServicesPage category. Mapped to a real category id +
    // bilingual label so the console can render it without its own lookup
    // table, and so a retired tile still resolves to where it went.
    byCategory: bySource.map((row) => {
      const categoryId = LEGACY_SOURCE_MAP[row.source] || null;
      const category = categoryId ? getCategory(categoryId) : null;
      return {
        ...row,
        categoryId,
        label: category ? category.label : null,
        status: category ? category.status : null,
      };
    }),
    recent: recentDocs.map((d) => d.toJSON()),
  });
});
