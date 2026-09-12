const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');
const MerchantPushSubscription = require('../models/MerchantPushSubscription');
require('dotenv').config();

/**
 * push.service — one delivery path, two subscriber collections.
 * ──────────────────────────────────────────────────────────────────────────
 * TENANTS/LANDLORDS live in PushSubscription (ref: User); SHOPKEEPERS live in
 * MerchantPushSubscription (ref: Merchant). They are separate collections
 * because the two identity systems are separate — see the header on
 * models/MerchantPushSubscription.js.
 *
 * What is deliberately NOT separate is everything below: the VAPID setup, the
 * payload encoding, and the rule that a 404/410 prunes the endpoint. Two tables,
 * one sender — so a fix to the prune logic can never apply to one audience and
 * not the other.
 */

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    'mailto:support@toletpro.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
} else {
  console.warn('[push.service] Missing VAPID keys. Web push notifications will be disabled.');
}

const isConfigured = () => Boolean(
  process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY,
);

/**
 * Push a payload to every subscription matching `filter` in `Model`.
 *
 * NEVER throws — a push failure must not break the caller. Because of that,
 * callers cannot learn anything from a rejected promise, so the outcome is
 * reported in the RETURN VALUE instead. This used to return `undefined` on
 * every path (success, no-keys, no-subscriptions, hard error alike), which made
 * it impossible to tell "delivered" from "silently did nothing" — the admin
 * marketing console was reporting 100% push success against an unconfigured
 * gateway because of it.
 *
 * @returns {Promise<{sent:number, failed:number, pruned:number, subscriptions:number,
 *                    skipped?:boolean, reason?:'not_configured'|'no_subscription'|'error'}>}
 */
async function deliver(Model, filter, payload) {
  const result = { sent: 0, failed: 0, pruned: 0, subscriptions: 0 };

  if (!isConfigured()) {
    return { ...result, skipped: true, reason: 'not_configured' };
  }

  try {
    const subscriptions = await Model.find(filter);
    if (!subscriptions || subscriptions.length === 0) {
      return { ...result, skipped: true, reason: 'no_subscription' };
    }
    result.subscriptions = subscriptions.length;

    const notifications = subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: sub.keys,
        }, JSON.stringify(payload));
        result.sent += 1;
        // Best-effort bookkeeping; a failure here is not a delivery failure.
        await Model.updateOne({ _id: sub._id }, { $set: { lastSentAt: new Date() } })
          .catch(() => null);
      } catch (error) {
        result.failed += 1;
        // 404/410 is the push service saying this endpoint is gone for good.
        // Pruning is what stops a shopkeeper who reinstalls the app from
        // accumulating dead endpoints that are retried forever.
        if (error.statusCode === 404 || error.statusCode === 410) {
          console.log('Subscription expired/invalid, removing:', sub.endpoint);
          await Model.findOneAndDelete({ endpoint: sub.endpoint });
          result.pruned += 1;
        } else {
          console.error('Error sending push notification:', error);
        }
      }
    });

    await Promise.all(notifications);
    return result;
  } catch (error) {
    console.error('Push notification error:', error);
    return { ...result, reason: 'error', error: error.message };
  }
}

// ─── Tenants / landlords ─────────────────────────────────────────────────────

exports.saveSubscription = async (userId, subscription) => {
  return await PushSubscription.findOneAndUpdate(
    { endpoint: subscription.endpoint },
    { userId, keys: subscription.keys },
    { upsert: true, new: true }
  );
};

exports.removeSubscription = async (endpoint) => {
  return await PushSubscription.findOneAndDelete({ endpoint });
};

exports.sendPushNotification = async (userId, payload) =>
  deliver(PushSubscription, { userId }, payload);

// ─── Shopkeepers ─────────────────────────────────────────────────────────────

/**
 * Upsert on ENDPOINT, not on merchant. A phone that is handed to a new
 * shopkeeper — which happens, these are shared devices — must move to the new
 * owner rather than keep pushing that shop's orders to the old one.
 */
exports.saveMerchantSubscription = async (merchantId, subscription, device = '') => {
  return await MerchantPushSubscription.findOneAndUpdate(
    { endpoint: subscription.endpoint },
    { merchantId, keys: subscription.keys, device: String(device || '').slice(0, 200) },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
};

exports.removeMerchantSubscription = async (endpoint) =>
  MerchantPushSubscription.findOneAndDelete({ endpoint });

exports.sendMerchantPush = async (merchantId, payload) =>
  deliver(MerchantPushSubscription, { merchantId }, payload);

exports.isConfigured = isConfigured;
exports.deliver = deliver;
