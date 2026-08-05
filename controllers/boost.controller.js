'use strict';

/**
 * Boost Controller — Plus plan's monthly search boost.
 * See services/boost.service.js for the credit rules.
 */

const boostService = require('../services/boost.service');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/boost/status — credits left this month (drives the dashboard button)
// ─────────────────────────────────────────────────────────────────────────────
exports.getStatus = asyncH(async (req, res) => {
  const status = await boostService.getBoostStatus(req.user._id);
  res.json({ boost: status });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/boost/:propertyId — spend one credit, pin the listing for 24h
// ─────────────────────────────────────────────────────────────────────────────
exports.boost = asyncH(async (req, res) => {
  const result = await boostService.boostProperty({
    propertyId: req.params.propertyId,
    user: req.user,
  });
  res.json({ success: true, ...result });
});
