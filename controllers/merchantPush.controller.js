'use strict';

/**
 * Merchant push controller — registering a shopkeeper's device.
 * ──────────────────────────────────────────────────────────────────────────
 * The reason this exists: an order gives him 30 minutes to answer before it
 * expires, the tenant is told nobody replied, and the silence counts against
 * him as a no-show. WhatsApp was his only channel — throttled, a paid SMS on
 * fallback, and a different app to switch to. Push puts the order on the lock
 * screen of the phone already in his hand.
 */

const pushService = require('../services/push.service');
const ApiError = require('../utils/ApiError');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// GET /api/merchant/push/key
//
// Served rather than bundled. A VAPID key baked into the frontend means
// rotating it needs a frontend deploy, and the two would be out of step for
// however long that takes — during which every subscription silently fails.
exports.publicKey = (req, res) => res.json({
  publicKey: process.env.VAPID_PUBLIC_KEY || '',
  configured: pushService.isConfigured(),
});

// POST /api/merchant/push/subscribe   { subscription, device? }
exports.subscribe = asyncH(async (req, res) => {
  const { subscription } = req.body || {};
  if (!subscription || !subscription.endpoint || !subscription.keys?.auth) {
    throw ApiError.badRequest('সাবস্ক্রিপশন সঠিক নয়।', { code: 'bad_subscription' });
  }

  const saved = await pushService.saveMerchantSubscription(
    req.merchant._id,
    subscription,
    req.body?.device || req.headers['user-agent'],
  );

  return res.json({ ok: true, id: String(saved._id) });
});

// DELETE /api/merchant/push/subscribe   { endpoint }
//
// Keyed on the ENDPOINT rather than on the merchant, so signing out on one
// phone never silences the shop counter.
exports.unsubscribe = asyncH(async (req, res) => {
  const endpoint = req.body?.endpoint;
  if (!endpoint) throw ApiError.badRequest('Endpoint দিন।', { code: 'endpoint_required' });

  await pushService.removeMerchantSubscription(endpoint);
  return res.json({ ok: true });
});
