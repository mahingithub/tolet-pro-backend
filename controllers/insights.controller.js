'use strict';

/**
 * insights.controller.js — Host AI Insights endpoint.
 * ──────────────────────────────────────────────────────────────────────────
 * GET /api/host/insights (auth required)
 * Returns aggregated portfolio analytics: performance metrics, market
 * opportunities, demand signals, and quick wins.
 */

const { getHostInsights } = require('../services/insights.service');

async function getInsights(req, res, next) {
  try {
    const data = await getHostInsights(req.user._id);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[insights] Error computing insights:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getInsights };
