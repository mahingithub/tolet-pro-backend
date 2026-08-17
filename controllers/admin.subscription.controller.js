'use strict';

/**
 * admin.subscription.controller.js
 * ──────────────────────────────────────────────────────────────────────────
 * The Subscriptions console: plan/reachability table + the multi-channel
 * "special offer" blast.
 *
 * Endpoints (mounted under /api/admin by routes/admin.routes.js, so every
 * handler already sits behind requireAdminAuth):
 *   GET  /api/admin/subscriptions              — audience table + headline counts
 *   POST /api/admin/subscriptions/send-offer   — deliver a composed offer
 *
 * The heavy lifting lives in services/marketing.service.js; this layer is
 * request validation, the audit trail, and shaping the response.
 */

const marketing = require('../services/marketing.service');
const auditLog = require('../services/auditLog.service');
const ApiError = require('../utils/ApiError');

// ─── GET /api/admin/subscriptions ───────────────────────────────────────────
// Query: tier=free|plus|pro, installed=true|false, whatsapp=true|false,
//        search=<name|phone|email>, page, limit
async function listSubscriptions(req, res, next) {
  try {
    const data = await marketing.listAudience(req.query || {});
    return res.json(data);
  } catch (err) {
    return next(err);
  }
}

// ─── POST /api/admin/subscriptions/send-offer ───────────────────────────────
// Body: {
//   channels: ['inapp','push','sms','whatsapp'],
//   title, body, smsText?,
//   whatsapp?: { template, languageCode?, params?: [] },
//   userIds?: [],            // explicit recipients (wins over filters)
//   filters?: { tier, installed, whatsapp, search },
// }
async function sendOffer(req, res, next) {
  try {
    const {
      channels = [],
      title = '',
      body = '',
      smsText = '',
      whatsapp = null,
      userIds = [],
      filters = {},
    } = req.body || {};

    const selected = Array.isArray(channels)
      ? channels.filter((c) => marketing.CHANNELS.includes(c))
      : [];

    if (!selected.length) {
      throw ApiError.badRequest('অন্তত একটি চ্যানেল নির্বাচন করুন।', { code: 'no_channel' });
    }

    // in-app and push both render a title + body; SMS falls back to `body`
    // when smsText is blank. So a blank body is unusable for every channel
    // except a WhatsApp template (which carries its own approved copy).
    const needsBody = selected.some((c) => c !== 'whatsapp');
    if (needsBody && !String(body).trim()) {
      throw ApiError.badRequest('বার্তার বডি লিখুন।', { code: 'no_body' });
    }
    if (selected.includes('inapp') || selected.includes('push')) {
      if (!String(title).trim()) {
        throw ApiError.badRequest('বার্তার শিরোনাম লিখুন।', { code: 'no_title' });
      }
    }

    // Fail fast rather than letting whatsapp.service reject every single
    // recipient one at a time — a template name is not optional for marketing.
    if (selected.includes('whatsapp') && !String(whatsapp?.template || '').trim()) {
      throw ApiError.badRequest(
        'WhatsApp মার্কেটিং বার্তার জন্য অনুমোদিত টেমপ্লেট নাম দিন।',
        { code: 'no_whatsapp_template' },
      );
    }

    // Input guard only. These bounds match the Notification schema, but the copy
    // still grows afterwards when marketing.service expands {{name}}/{{tier}}
    // per recipient — so this slice canNOT be the thing that keeps the row
    // valid. notification.service.emit() clamps to the schema limit AFTER
    // personalisation; without that, a 600-char body containing {{name}}
    // overflowed maxlength and the notification was silently dropped for every
    // recipient whose name pushed it over.
    const out = await marketing.sendOffer({
      channels: selected,
      title: String(title).slice(0, 160),
      body: String(body).slice(0, 600),
      smsText: String(smsText || '').slice(0, 600),
      whatsapp: whatsapp || undefined,
      userIds: Array.isArray(userIds) ? userIds : [],
      filters: filters || {},
      data: { source: 'admin_offer' },
    });

    // Marketing blasts are irreversible and outward-facing, so they leave a
    // trail: who sent what, to how many people, on which channels.
    await auditLog.safeLog(auditLog.logAdminAction, req, {
      action: 'marketing.send_offer',
      description: `Sent offer "${String(title).slice(0, 60)}" to ${out.attempted} user(s) via ${selected.join(', ')}`,
      metadata: {
        channels: selected,
        attempted: out.attempted,
        capped: out.capped,
        sent: out.sent,
        filters: Array.isArray(userIds) && userIds.length ? { explicitIds: userIds.length } : filters,
      },
    });

    // The per-user `results` array is intentionally omitted from the response:
    // it's one entry per recipient and can run to thousands of rows. The
    // per-channel tallies are what the console renders.
    return res.json({
      message: 'Offer dispatched',
      attempted: out.attempted,
      capped: out.capped,
      maxRecipients: out.maxRecipients,
      sent: out.sent,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { listSubscriptions, sendOffer };
