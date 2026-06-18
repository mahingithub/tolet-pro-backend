'use strict';

/**
 * insights.service.js — AI-powered host portfolio analytics.
 * ──────────────────────────────────────────────────────────────────────────
 * Aggregates data from Booking, Property, and Inquiry collections to
 * generate actionable insights for a host's portfolio. Each section is
 * computed via MongoDB aggregation pipelines for efficiency.
 *
 * Caching: Simple in-memory Map with 30-minute TTL. Invalidate by calling
 * `invalidateInsightsCache(hostId)` when a new booking is created.
 */

const mongoose = require('mongoose');
const Booking  = require('../models/Booking');
const Property = require('../models/Property');
const Inquiry  = require('../models/Inquiry');

// ─── In-memory cache (30-minute TTL) ────────────────────────────────────────
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const cache = new Map();

/**
 * Invalidate the insights cache for a specific host.
 * Call this from the booking controller when a new booking is created.
 */
function invalidateInsightsCache(hostId) {
  cache.delete(`insights_${String(hostId)}`);
}

/**
 * Main entry point — returns the full insights payload for a host.
 */
async function getHostInsights(hostId) {
  const cacheKey = `insights_${String(hostId)}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const hid = new mongoose.Types.ObjectId(hostId);

  // Run all independent aggregations in parallel for speed.
  const [
    performanceMetrics,
    marketOpportunities,
    demandSignals,
    quickWins,
  ] = await Promise.all([
    computePerformanceMetrics(hid),
    computeMarketOpportunities(hid),
    computeDemandSignals(),
    computeQuickWins(hid),
  ]);

  const data = { performanceMetrics, marketOpportunities, demandSignals, quickWins };

  // Store in cache with timestamp.
  cache.set(cacheKey, { data, timestamp: Date.now() });

  return data;
}

// ─── A) Performance Metrics ─────────────────────────────────────────────────

async function computePerformanceMetrics(hostId) {
  const now = new Date();

  // First day of current month.
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  // First day of last month.
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  // End of last month = start of this month.
  const lastMonthEnd = thisMonthStart;

  // ── Revenue this month vs last month ────────────────────────────────────
  // Sum `monthlyRent` from active bookings created in each period.
  // "Active" bookings are the confirmed equivalent in this schema.
  const [revenueAgg] = await Booking.aggregate([
    // Stage 1: Match bookings belonging to this host with status 'active'.
    { $match: { landlordId: hostId, status: 'active' } },
    // Stage 2: Compute conditional sums for this month and last month
    //          based on createdAt falling within each date range.
    {
      $group: {
        _id: null,
        thisMonth: {
          $sum: {
            $cond: [
              { $gte: ['$createdAt', thisMonthStart] },
              '$monthlyRent',
              0,
            ],
          },
        },
        lastMonth: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gte: ['$createdAt', lastMonthStart] },
                  { $lt: ['$createdAt', lastMonthEnd] },
                ],
              },
              '$monthlyRent',
              0,
            ],
          },
        },
        // Total monthly revenue from ALL active bookings (for the summary).
        totalMonthly: { $sum: '$monthlyRent' },
        activeBookingCount: { $sum: 1 },
      },
    },
  ]);

  const thisMonthRevenue = revenueAgg?.thisMonth || 0;
  const lastMonthRevenue = revenueAgg?.lastMonth || 0;
  const totalMonthlyRevenue = revenueAgg?.totalMonthly || 0;
  const activeBookingCount = revenueAgg?.activeBookingCount || 0;
  const revenueChangePercent = lastMonthRevenue > 0
    ? Math.round(((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100)
    : thisMonthRevenue > 0 ? 100 : 0;

  // ── Occupancy rate ──────────────────────────────────────────────────────
  // (properties with at least 1 active booking / total active properties) * 100.
  const [totalActiveProperties, propertiesWithBookings] = await Promise.all([
    // Count all active properties belonging to this host.
    Property.countDocuments({ ownerUserId: hostId, status: 'active' }),
    // Count distinct properties that have at least one active booking.
    Booking.distinct('propertyId', { landlordId: hostId, status: 'active' })
      .then((ids) => ids.length),
  ]);

  const occupancyRate = totalActiveProperties > 0
    ? Math.round((propertiesWithBookings / totalActiveProperties) * 100)
    : 0;

  // ── Inquiry conversion rate ─────────────────────────────────────────────
  // (bookings / total inquiries) * 100 for this host.
  const totalInquiries = await Inquiry.countDocuments({ propertyOwnerId: hostId });
  const totalBookings = await Booking.countDocuments({ landlordId: hostId });
  const inquiryConversion = totalInquiries > 0
    ? Math.round((totalBookings / totalInquiries) * 100)
    : 0;

  return {
    revenueThisMonth: {
      value: totalMonthlyRevenue,
      thisMonth: thisMonthRevenue,
      lastMonth: lastMonthRevenue,
      changePercent: revenueChangePercent,
      activeBookings: activeBookingCount,
    },
    occupancyRate,
    inquiryConversion,
    totalInquiries,
    totalBookings,
    totalActiveProperties,
  };
}

// ─── B) Market Opportunities ────────────────────────────────────────────────

async function computeMarketOpportunities(hostId) {
  // Fetch all active properties belonging to this host.
  const hostProperties = await Property.find(
    { ownerUserId: hostId, status: 'active' },
    { _id: 1, title: 1, area: 1, type: 1, price: 1 },
  ).lean();

  const opportunities = [];

  for (const prop of hostProperties) {
    // Skip properties without area or type — we can't find comparables.
    if (!prop.area || !prop.type) continue;

    // Aggregate: find the average price of OTHER properties with the same
    // area + type (excluding this host's own properties).
    const [marketData] = await Property.aggregate([
      // Stage 1: Match properties with the same area and type, excluding
      //          properties owned by this host, and only active listings.
      {
        $match: {
          area: prop.area,
          type: prop.type,
          ownerUserId: { $ne: hostId },
          status: 'active',
        },
      },
      // Stage 2: Calculate count and average price of comparable properties.
      {
        $group: {
          _id: null,
          avgPrice: { $avg: '$price' },
          count: { $sum: 1 },
        },
      },
    ]);

    // Fallback: skip if fewer than 3 comparable properties exist.
    if (!marketData || marketData.count < 3) continue;

    const marketAvg = Math.round(marketData.avgPrice);
    const hostPrice = prop.price;
    let tag, potentialImpact, increasePercent;

    if (hostPrice < marketAvg * 0.95) {
      // Underpriced — host could charge more.
      tag = 'underpriced';
      potentialImpact = Math.round(marketAvg * 0.95 - hostPrice);
      increasePercent = Math.round(((marketAvg * 0.95 - hostPrice) / hostPrice) * 100);
    } else if (hostPrice > marketAvg * 1.05) {
      // Overpriced — host may lose tenants or have longer vacancy.
      tag = 'overpriced';
      potentialImpact = Math.round(hostPrice - marketAvg * 1.05);
      increasePercent = 0;
    } else {
      // Well-optimized — within ±5% of market average.
      tag = 'optimized';
      potentialImpact = 0;
      increasePercent = 0;
    }

    opportunities.push({
      propertyId: prop._id,
      property: prop.title,
      area: prop.area,
      type: prop.type,
      currentRent: hostPrice,
      marketAvg,
      suggestedRent: tag === 'underpriced'
        ? Math.round(marketAvg * 0.95)
        : hostPrice,
      increasePercent,
      potentialImpact,
      tag,
      comparables: marketData.count,
    });
  }

  // Sort: underpriced first (highest impact), then overpriced, then optimized.
  const priority = { underpriced: 0, overpriced: 1, optimized: 2 };
  opportunities.sort((a, b) => (priority[a.tag] ?? 9) - (priority[b.tag] ?? 9));

  return opportunities;
}

// ─── C) Demand Signals ──────────────────────────────────────────────────────

async function computeDemandSignals() {
  // Aggregate platform-wide inquiries grouped by the property's area.
  // We need to join Inquiry → Property to get the area field.
  const areaStats = await Inquiry.aggregate([
    // Stage 1: Look up the property document to get its area and views.
    {
      $lookup: {
        from: 'properties',
        localField: 'propertyId',
        foreignField: '_id',
        as: 'prop',
      },
    },
    // Stage 2: Unwind the joined property (1:1 relationship).
    { $unwind: { path: '$prop', preserveNullAndEmptyArrays: false } },
    // Stage 3: Group by the property's area to count inquiries and
    //          compute the average views per property in that area.
    {
      $group: {
        _id: '$prop.area',
        totalInquiries: { $sum: 1 },
        avgViews: { $avg: { $ifNull: ['$prop.popularity', 0] } },
      },
    },
    // Stage 4: Filter out areas with blank names.
    { $match: { _id: { $ne: '', $ne: null } } },
    // Stage 5: Sort by total inquiries descending.
    { $sort: { totalInquiries: -1 } },
    // Stage 6: Limit to top 20 areas to keep payload reasonable.
    { $limit: 20 },
  ]);

  if (areaStats.length === 0) return [];

  // Rank areas into quartiles based on their position in the sorted list.
  const total = areaStats.length;
  return areaStats.map((stat, index) => {
    const percentile = ((index + 1) / total) * 100;
    let label, trend;

    if (percentile <= 25) {
      label = 'Very High';
      trend = 'up';
    } else if (percentile <= 50) {
      label = 'High';
      trend = 'up';
    } else if (percentile <= 75) {
      label = 'Moderate';
      trend = 'stable';
    } else {
      label = 'Low';
      trend = 'down';
    }

    // Compute a demand score (0–100) based on relative position.
    const demandScore = Math.round(((total - index) / total) * 100);

    return {
      area: stat._id,
      totalInquiries: stat.totalInquiries,
      avgViews: Math.round(stat.avgViews || 0),
      demand: demandScore,
      label,
      trend,
    };
  });
}

// ─── D) Quick Wins ──────────────────────────────────────────────────────────

async function computeQuickWins(hostId) {
  const wins = [];
  const now = new Date();

  // ── 1. Properties missing cover photo ──────────────────────────────────
  const noCover = await Property.find(
    { ownerUserId: hostId, status: 'active', $or: [{ coverPhoto: '' }, { coverPhoto: null }, { coverPhoto: { $exists: false } }] },
    { _id: 1, title: 1 },
  ).lean();

  for (const p of noCover) {
    wins.push({
      type: 'missing_cover_photo',
      propertyId: p._id,
      title: `Add cover photo to "${p.title}"`,
      detail: 'Listings with photos get 3× more inquiries',
      urgency: 'Action now · Low effort',
      priority: 'high',
    });
  }

  // ── 2. Properties missing room photos (empty array) ────────────────────
  const noRoomPhotos = await Property.find(
    { ownerUserId: hostId, status: 'active', $or: [{ roomPhotos: { $size: 0 } }, { roomPhotos: { $exists: false } }] },
    { _id: 1, title: 1 },
  ).lean();

  for (const p of noRoomPhotos) {
    // Skip if already flagged for missing cover photo (avoid duplicate wins).
    if (noCover.some((nc) => String(nc._id) === String(p._id))) continue;
    wins.push({
      type: 'missing_room_photos',
      propertyId: p._id,
      title: `Add room photos to "${p.title}"`,
      detail: 'Listings with multiple photos let 40% faster',
      urgency: 'Action now · Low effort',
      priority: 'high',
    });
  }

  // ── 3. Active bookings/leases expiring within 30–60 days ───────────────
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysFromNow = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

  const expiringSoon = await Booking.find(
    {
      landlordId: hostId,
      status: 'active',
      leaseEnd: { $gte: thirtyDaysFromNow, $lte: sixtyDaysFromNow },
    },
    { _id: 1, property: 1, tenant: 1, leaseEnd: 1 },
  ).lean();

  for (const b of expiringSoon) {
    const daysLeft = Math.round((new Date(b.leaseEnd) - now) / (1000 * 60 * 60 * 24));
    wins.push({
      type: 'lease_expiring',
      bookingId: b._id,
      title: `Lease for "${b.property || 'Property'}" expires in ${daysLeft} days`,
      detail: `Tenant: ${b.tenant || 'N/A'} — discuss renewal to avoid vacancy`,
      urgency: `${daysLeft} days remaining`,
      priority: daysLeft <= 30 ? 'high' : 'medium',
    });
  }

  // ── 4. Properties with zero inquiries in the last 30 days ──────────────
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Get all active property IDs for this host.
  const activePropertyIds = await Property.find(
    { ownerUserId: hostId, status: 'active' },
    { _id: 1, title: 1 },
  ).lean();

  if (activePropertyIds.length > 0) {
    // Find which of these properties received at least one inquiry in the last 30 days.
    const propertiesWithRecentInquiries = await Inquiry.distinct('propertyId', {
      propertyId: { $in: activePropertyIds.map((p) => p._id) },
      createdAt: { $gte: thirtyDaysAgo },
    });

    const withInquirySet = new Set(propertiesWithRecentInquiries.map(String));

    for (const p of activePropertyIds) {
      if (!withInquirySet.has(String(p._id))) {
        wins.push({
          type: 'zero_inquiries',
          propertyId: p._id,
          title: `"${p.title}" has zero inquiries in 30 days`,
          detail: 'Consider updating listing photos, description, or price',
          urgency: 'Needs attention',
          priority: 'medium',
        });
      }
    }
  }

  // ── 5. Host response rate check ────────────────────────────────────────
  // Reuse the computeHostStats logic: if response rate < 80%, flag it.
  try {
    const { computeHostStats } = require('../controllers/hostStats.controller');
    const stats = await computeHostStats(hostId);
    if (stats.responseRate < 80) {
      wins.push({
        type: 'low_response_rate',
        title: `Your response rate is ${stats.responseRate}%`,
        detail: 'Hosts with 90%+ response rate get 2× more bookings',
        urgency: 'Improve now',
        priority: 'high',
        responseRate: stats.responseRate,
      });
    }
  } catch (err) {
    // Non-critical — skip if hostStats computation fails.
    console.warn('[insights] Could not compute host response rate:', err.message);
  }

  // Sort: high priority first, then medium.
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  wins.sort((a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9));

  return wins;
}

module.exports = {
  getHostInsights,
  invalidateInsightsCache,
};
