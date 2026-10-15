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
 *   GET  /api/admin/subscription-payments      — bKash / Nagad claims to verify
 *   POST /api/admin/subscription-payments/:id/approve | /reject
 *   POST|PUT|DELETE /api/admin/subscription-payments/methods[/:id] — payment methods (super admin)
 *   PUT  /api/admin/subscription-payments/prices         — plan prices (super admin)
 *   POST|DELETE /api/admin/subscription-payments/sms-key — forwarder key (super admin)
 *
 * The heavy lifting lives in services/marketing.service.js; this layer is
 * request validation, the audit trail, and shaping the response.
 */

const marketing = require('../services/marketing.service');
const campaignLinks = require('../services/campaignLink.service');
const auditLog = require('../services/auditLog.service');
const { listTargets, normalizeTarget } = require('../utils/campaignTargets');
const ApiError = require('../utils/ApiError');
const mongoose = require('mongoose');
const SubscriptionPayment = require('../models/SubscriptionPayment');
const PaymentSms = require('../models/PaymentSms');
const subPayments = require('../services/subscriptionPayment.service');
const { signedViewUrlFor } = require('../services/cloudinary.service');

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

// ─── GET /api/admin/subscription-payments?status=pending|approved|rejected ──
// Each claim comes with the wallet SMS carrying its TrxID (if one arrived) and
// the reason the automatic check left it here, so the reviewer can compare
// without opening the wallet app. Pending is oldest first: that's the queue.
async function listSubscriptionPayments(req, res, next) {
  try {
    const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
    const rows = await SubscriptionPayment.find({ status })
      .sort({ createdAt: status === 'pending' ? 1 : -1 })
      .limit(200)
      .lean();

    const smsRows = rows.length
      ? await PaymentSms.find({ trxId: { $in: [...new Set(rows.map((r) => r.trxId))] } }).lean()
      : [];
    const lastSms = await PaymentSms.findOne().sort({ createdAt: -1 }).select('createdAt').lean();
    const settings = await subPayments.getSettings();

    const payments = rows.map((r) => {
      const sms = smsRows.find((m) => r.smsId && String(m._id) === String(r.smsId))
        || smsRows.find((m) => m.trxId === r.trxId && m.method === r.method)
        || smsRows.find((m) => m.trxId === r.trxId);
      return {
        ...r,
        id: String(r._id),
        screenshotUrl: r.screenshotPublicId
          ? signedViewUrlFor({ publicId: r.screenshotPublicId, url: r.screenshotUrl })
          : '',
        sms: sms ? {
          id: String(sms._id),
          method: sms.method,
          amount: sms.amount,
          sender: sms.sender,
          text: sms.text,
          receivedAt: sms.createdAt,
          usedByOther: !!sms.paymentId && String(sms.paymentId) !== String(r._id),
        } : null,
      };
    });

    return res.json({
      payments,
      methods: await subPayments.adminMethods(settings),
      plans: await subPayments.getPlans(settings),
      smsCheck: {
        configured: !!settings.smsKeyHash,
        keyCreatedAt: settings.smsKeyCreatedAt || null,
        lastSmsAt: lastSms ? lastSms.createdAt : null,
      },
    });
  } catch (err) {
    return next(err);
  }
}

// ─── POST /api/admin/subscription-payments/:id/approve ──────────────────────
async function approveSubscriptionPayment(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('পেমেন্ট পাওয়া যায়নি।');
    const payment = await subPayments.adminApprove(req.params.id, req.user?._id || null);
    await auditLog.safeLog(auditLog.logAdminAction, req, {
      action: 'subscription_payment.approve',
      targetType: 'user',
      targetId: String(payment.userId),
      description: `Approved ${payment.planId} ৳${payment.amount} (${payment.method} ${payment.trxId}) for user ${payment.userId}`,
      metadata: { paymentId: String(payment._id), userId: String(payment.userId), trxId: payment.trxId },
    });
    return res.json({ payment });
  } catch (err) {
    return next(err);
  }
}

// ─── POST /api/admin/subscription-payments/:id/reject  { reason } ───────────
async function rejectSubscriptionPayment(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('পেমেন্ট পাওয়া যায়নি।');
    const reason = String(req.body?.reason || '').trim();
    if (!reason) throw ApiError.badRequest('কেন গ্রহণ করা হলো না তা লিখুন — ব্যবহারকারী এটি দেখবেন।', { code: 'no_reason' });
    const payment = await subPayments.adminReject(req.params.id, reason, req.user?._id || null);
    await auditLog.safeLog(auditLog.logAdminAction, req, {
      action: 'subscription_payment.reject',
      targetType: 'user',
      targetId: String(payment.userId),
      description: `Rejected ${payment.method} ${payment.trxId} for user ${payment.userId}: ${reason.slice(0, 80)}`,
      metadata: { paymentId: String(payment._id), userId: String(payment.userId), trxId: payment.trxId },
    });
    return res.json({ payment });
  } catch (err) {
    return next(err);
  }
}

// ─── Payment methods ("Add Payment System") — super admins only ────────────
// POST   /api/admin/subscription-payments/methods      { type, accountNumber, … }
// PUT    /api/admin/subscription-payments/methods/:id  same body (also on/off)
// DELETE /api/admin/subscription-payments/methods/:id
// Each decides where hosts' money goes, so each leaves an audit row.
function methodHandler(change) {
  return async (req, res, next) => {
    try {
      if (req.params.id && !mongoose.isValidObjectId(req.params.id)) {
        throw ApiError.notFound('মাধ্যমটি পাওয়া যায়নি।', { code: 'method_not_found' });
      }
      const methods = await change(req);
      await auditLog.safeLog(auditLog.logAdminAction, req, {
        action: 'subscription_payment.settings',
        targetType: 'config',
        targetId: 'billing',
        description: `${req.method} payment method ${req.params.id || ''} ${req.body?.type || ''} ${req.body?.accountNumber || ''}`.trim(),
        metadata: { methods: methods.map((m) => `${m.type}:${m.accountNumber}${m.enabled ? '' : ' (off)'}`) },
      });
      return res.json({ methods });
    } catch (err) {
      return next(err);
    }
  };
}
const addPaymentMethod = methodHandler((req) => subPayments.addMethod(req.body || {}, req.user?._id || null));
const updatePaymentMethod = methodHandler((req) => subPayments.updateMethod(req.params.id, req.body || {}, req.user?._id || null));
const deletePaymentMethod = methodHandler((req) => subPayments.deleteMethod(req.params.id, req.user?._id || null));

// ─── PUT /api/admin/subscription-payments/prices
//   { prices: { plus_monthly: 19, pro_monthly: 49 }, yearlyDiscount: 20 }
// What each plan costs; yearly prices follow from the discount. Takes effect
// for the next claim — one already submitted keeps the amount it was asked for.
async function updatePlanPrices(req, res, next) {
  try {
    const plans = await subPayments.updatePrices(req.body?.prices, req.body?.yearlyDiscount, req.user?._id || null);
    await auditLog.safeLog(auditLog.logAdminAction, req, {
      action: 'subscription_payment.prices',
      targetType: 'config',
      targetId: 'billing',
      description: `Set plan prices: ${plans.map((p) => `${p.id} ৳${p.price}`).join(', ')} (yearly ${plans.find((p) => p.discount != null)?.discount}% off)`,
      metadata: { prices: Object.fromEntries(plans.map((p) => [p.id, p.price])) },
    });
    return res.json({ plans });
  } catch (err) {
    return next(err);
  }
}

// ─── POST /api/admin/subscription-payments/sms-key ──────────────────────────
// A new key for the wallet phone's SMS forwarder, shown ONCE. Any earlier key
// stops working, so the phone must be given the new one.
async function createSmsKey(req, res, next) {
  try {
    const key = await subPayments.createSmsKey(req.user?._id || null);
    await auditLog.safeLog(auditLog.logAdminAction, req, {
      action: 'subscription_payment.sms_key',
      targetType: 'config',
      targetId: 'billing',
      description: 'Made a new SMS forwarder key (automatic payment check on)',
    });
    return res.json({ key });
  } catch (err) {
    return next(err);
  }
}

// ─── DELETE /api/admin/subscription-payments/sms-key ────────────────────────
async function removeSmsKey(req, res, next) {
  try {
    await subPayments.removeSmsKey(req.user?._id || null);
    await auditLog.safeLog(auditLog.logAdminAction, req, {
      action: 'subscription_payment.sms_key',
      targetType: 'config',
      targetId: 'billing',
      description: 'Removed the SMS forwarder key (automatic payment check off)',
    });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  addPaymentMethod,
  updatePaymentMethod,
  deletePaymentMethod,
  updatePlanPrices,
  createSmsKey,
  removeSmsKey,
  listSubscriptions,
  listCampaignTargets,
  listCampaignLinks,
  sendOffer,
  listSubscriptionPayments,
  approveSubscriptionPayment,
  rejectSubscriptionPayment,
};
