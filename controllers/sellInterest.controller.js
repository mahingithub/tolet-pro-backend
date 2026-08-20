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
    // One record per (person, kind): a repeat tap just bumps clickCount, so the
    // "interested people" head count is never inflated by the same user.
    // The filter fields (userId, kind) seed the new doc on insert, so they must
    // NOT also appear in an update operator — that would raise a Mongo write
    // conflict. name/phone/source ($set) and clickCount ($inc) don't overlap
    // the filter, so this upserts cleanly (clickCount → 1 on insert, +1 after).
    const doc = await SellInterest.findOneAndUpdate(
      { userId: user._id, kind },
      {
        $set: { name: user.name || '', phone: user.phone || '', source },
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
// Query: ?kind=sell|buy (default 'sell').
// ─────────────────────────────────────────────────────────────────────────────
exports.getStats = asyncH(async (req, res) => {
  const kind = normaliseKind(req.query.kind);
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [total, registered, last7d, recentDocs] = await Promise.all([
    SellInterest.countDocuments({ kind }),
    SellInterest.countDocuments({ kind, userId: { $ne: null } }),
    SellInterest.countDocuments({ kind, createdAt: { $gte: since7d } }),
    SellInterest.find({ kind }).sort({ updatedAt: -1 }).limit(50),
  ]);

  res.json({
    stats: {
      total,                    // distinct interest records (people)
      registered,               // of those, how many are logged-in accounts
      guests: total - registered,
      last7d,                   // records created in the last 7 days
    },
    recent: recentDocs.map((d) => d.toJSON()),
  });
});
