const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');
require('dotenv').config();

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    'mailto:support@toletpro.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
} else {
  console.warn('[push.service] Missing VAPID keys. Web push notifications will be disabled.');
}

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

/**
 * Deliver a web-push payload to every VAPID subscription a user has.
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
exports.sendPushNotification = async (userId, payload) => {
  const result = { sent: 0, failed: 0, pruned: 0, subscriptions: 0 };

  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return { ...result, skipped: true, reason: 'not_configured' };
  }
  try {
    const subscriptions = await PushSubscription.find({ userId });
    if (!subscriptions || subscriptions.length === 0) {
      return { ...result, skipped: true, reason: 'no_subscription' };
    }
    result.subscriptions = subscriptions.length;

    const notifications = subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: sub.keys
        }, JSON.stringify(payload));
        result.sent += 1;
      } catch (error) {
        result.failed += 1;
        if (error.statusCode === 404 || error.statusCode === 410) {
          console.log('Subscription expired/invalid, removing:', sub.endpoint);
          await PushSubscription.findOneAndDelete({ endpoint: sub.endpoint });
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
};
