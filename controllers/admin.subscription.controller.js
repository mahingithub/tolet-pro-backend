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
const campaignLinks = require('../services/campaignLink.service');
const auditLog = require('../services/auditLog.service');
const { listTargets, normalizeTarget } = require('../utils/campaignTargets');
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

// ─── GET /api/admin/subscriptions/targets ───────────────────────────────────
// The destination presets the composer offers, straight from the same list the
// send endpoint validates against — so the picker can never offer a page the
// server will then reject.
async function listCampaignTargets(_req, res, next) {
  try {
    return res.json(listTargets());
  } catch (err) {
    return next(err);
  }
}

// ─── GET /api/admin/subscriptions/links ─────────────────────────────────────
// Click counts for recent campaigns. This is the only delivery-to-action signal
// SMS and WhatsApp produce at all — both report "sent" and nothing further.
async function listCampaignLinks(req, res, next) {
  try {
    const rows = await campaignLinks.recentLinks(req.query?.limit);
    return res.json({ rows });
  } catch (err) {
    return next(err);
  }
}

// ─── POST /api/admin/subscriptions/send-offer ───────────────────────────────
// Body: {
//   channels: ['inapp','push','sms','whatsapp'],
//   title, body, smsText?,
//   targetPath?: '/subscription',   // where a tap lands; defaults to the plan page
//   whatsapp?: { mode:'text'|'template', body?, template?, languageCode?, params?: [] },
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
      targetPath = '',
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

    // ── WhatsApp: which of the two send modes, and does this server have it ──
    // Getting this wrong is not a rejected request, it is a blast that reports
    // "dispatched" and delivers to nobody: whatsapp.service skips a Meta
    // template on any other provider, one recipient at a time, and the console
    // renders a skip as consent working normally.
    let waMode = null;
    if (selected.includes('whatsapp')) {
      const caps = marketing.channelCapabilities().whatsapp;
      waMode = whatsapp?.mode === 'text' || whatsapp?.mode === 'template'
        ? whatsapp.mode
        : caps.mode;

      if (waMode === 'template' && caps.provider !== 'meta') {
        throw ApiError.badRequest(
          `এই সার্ভারের WhatsApp প্রোভাইডার '${caps.provider}' — এটি Meta টেমপ্লেট পাঠাতে পারে না। বার্তার টেক্সট লিখুন।`,
          { code: 'whatsapp_template_unsupported' },
        );
      }
      if (waMode === 'template' && !String(whatsapp?.template || '').trim()) {
        throw ApiError.badRequest(
          'WhatsApp মার্কেটিং বার্তার জন্য অনুমোদিত টেমপ্লেট নাম দিন।',
          { code: 'no_whatsapp_template' },
        );
      }
      // Text mode falls back to the shared body, so it only fails when BOTH
      // are empty — which would send a bare link with no context.
      if (waMode === 'text' && !String(whatsapp?.body || body || '').trim()) {
        throw ApiError.badRequest('WhatsApp বার্তার টেক্সট লিখুন।', { code: 'no_whatsapp_body' });
      }
      if (!caps.configured) {
        throw ApiError.badRequest(
          'এই সার্ভারে WhatsApp কনফিগার করা নেই — গেটওয়ে সেট করে আবার চেষ্টা করুন।',
          { code: 'whatsapp_not_configured' },
        );
      }
    }

    // ── Where the tap lands ──────────────────────────────────────────────
    // Validated here rather than at the link-minting step so a bad destination
    // is a 400 BEFORE anything is sent, not a broken link discovered after the
    // SMS has been billed. An empty value keeps the historical default.
    let resolvedTarget = '';
    if (String(targetPath || '').trim()) {
      const target = normalizeTarget(targetPath);
      if (!target.ok) {
        throw ApiError.badRequest(target.reason, { code: 'bad_target_path' });
      }
      resolvedTarget = target.path;
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
      targetPath: resolvedTarget || undefined,
      whatsapp: whatsapp
        ? { ...whatsapp, mode: waMode, body: String(whatsapp.body || '').slice(0, 900) }
        : undefined,
      // requireAdminAuth attaches the admin document as `req.user`.
      adminId: req.user?._id || null,
      userIds: Array.isArray(userIds) ? userIds : [],
      filters: filters || {},
      data: { source: 'admin_offer' },
    });

    // Marketing blasts are irreversible and outward-facing, so they leave a
    // trail: who sent what, to how many people, on which channels.
    //
    // Wrapped defensively even though safeLog is contractually non-throwing.
    // Past this line the messages are ALREADY SENT — SMS is billed, push is on
    // people's phones, none of it recallable. Reporting a failure to the admin
    // at that point is worse than losing the audit row: they will reasonably
    // assume nothing went out and send the whole campaign a second time. (This
    // is not hypothetical: safeLog's own catch block used to throw on the
    // circular Express `req`, so a rejected audit write returned a 500 for a
    // blast that had fully succeeded.)
    try {
      await auditLog.safeLog(auditLog.logAdminAction, req, {
        action: 'marketing.send_offer',
        description: `Sent offer "${String(title).slice(0, 60)}" to ${out.attempted} user(s) via ${selected.join(', ')}`,
        metadata: {
          channels: selected,
          attempted: out.attempted,
          capped: out.capped,
          sent: out.sent,
          // The destination and the exact short links that went out. Without
          // these the trail records that a campaign was sent but not where it
          // pointed — which is the part anyone reviewing it afterwards needs.
          targetPath: out.targetPath,
          links: out.links,
          whatsappMode: waMode || undefined,
          filters: Array.isArray(userIds) && userIds.length ? { explicitIds: userIds.length } : filters,
        },
      });
    } catch (logErr) {
      console.error('[admin.sendOffer] audit log failed after a successful send:', logErr?.message);
    }

    // The per-user `results` array is intentionally omitted from the response:
    // it's one entry per recipient and can run to thousands of rows. The
    // per-channel tallies are what the console renders.
    return res.json({
      message: 'Offer dispatched',
      attempted: out.attempted,
      capped: out.capped,
      maxRecipients: out.maxRecipients,
      sent: out.sent,
      targetPath: out.targetPath,
      links: out.links,
      whatsappOverflow: out.whatsappOverflow,
      whatsappMaxPerBlast: out.whatsappMaxPerBlast,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { listSubscriptions, listCampaignTargets, listCampaignLinks, sendOffer };
