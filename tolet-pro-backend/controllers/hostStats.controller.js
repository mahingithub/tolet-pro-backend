'use strict';

/**
 * hostStats.controller — REAL host performance metrics (no demo data).
 * ──────────────────────────────────────────────────────────────────────────
 * GET /api/host-stats  (auth required)  → {
 *   responseRate,     // %  — share of inbound chat threads the host replied to
 *   avgResponseTime,  // minutes — avg gap between a tenant's first message and
 *                     //           the host's first reply, across replied threads
 *   conversionRate,   // %  — bookings created ÷ inquiries received (capped 100)
 *   totalInquiries, totalBookings   // context
 * }
 *
 * Mounted on its own path (not under the existing /api/host router) so it needs
 * no edits to host.routes.js. Replaces the hardcoded 98% / 15min / 24% card.
 */

const Inquiry      = require('../models/Inquiry');
const Booking      = require('../models/Booking');
const Conversation = require('../models/Conversation');
const Message      = require('../models/Message');

async function computeHostStats(hostId) {
  const hid = String(hostId);

  // ── Conversion rate — bookings ÷ inquiries ────────────────────────────────
  const [totalInquiries, totalBookings] = await Promise.all([
    Inquiry.countDocuments({ propertyOwnerId: hostId }),
    Booking.countDocuments({ landlordId: hostId }),
  ]);
  const conversionRate = totalInquiries > 0
    ? Math.min(100, Math.round((totalBookings / totalInquiries) * 100))
    : 0;

  // ── Response rate + avg response time (from chat threads) ─────────────────
  const conversations = await Conversation.find({ participants: hostId })
    .select('_id')
    .lean();
  const convIds = conversations.map((c) => c._id);

  let inboundThreads = 0;   // threads where a tenant wrote at least once
  let repliedThreads = 0;   // …and the host replied after that
  let totalReplyMs   = 0;
  let replySamples   = 0;

  if (convIds.length) {
    // One query for all messages across the host's threads, oldest-first.
    const messages = await Message.find({ conversationId: { $in: convIds } })
      .select('conversationId senderId createdAt')
      .sort({ createdAt: 1 })
      .lean();

    const byConv = new Map();
    for (const m of messages) {
      const k = String(m.conversationId);
      if (!byConv.has(k)) byConv.set(k, []);
      byConv.get(k).push(m);
    }

    for (const msgs of byConv.values()) {
      const firstInbound = msgs.find((m) => String(m.senderId) !== hid);
      if (!firstInbound) continue;            // host-only thread → nothing to answer
      inboundThreads += 1;

      const reply = msgs.find(
        (m) => String(m.senderId) === hid &&
               new Date(m.createdAt) > new Date(firstInbound.createdAt),
      );
      if (reply) {
        repliedThreads += 1;
        totalReplyMs   += new Date(reply.createdAt) - new Date(firstInbound.createdAt);
        replySamples   += 1;
      }
    }
  }

  const responseRate = inboundThreads > 0
    ? Math.round((repliedThreads / inboundThreads) * 100)
    : 0;
  const avgResponseTime = replySamples > 0
    ? Math.round(totalReplyMs / replySamples / 60000)   // ms → minutes
    : 0;

  return { responseRate, avgResponseTime, conversionRate, totalInquiries, totalBookings };
}

async function getHostStats(req, res, next) {
  try {
    const stats = await computeHostStats(req.user._id);
    return res.json(stats);
  } catch (err) {
    return next(err);
  }
}

module.exports = { getHostStats, computeHostStats };
