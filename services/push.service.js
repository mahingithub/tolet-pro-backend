const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');
require('dotenv').config();

webpush.setVapidDetails(
  'mailto:support@toletpro.com',
  process.env.VAPID_PUBLIC_KEY || '',
  process.env.VAPID_PRIVATE_KEY || ''
);

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

exports.sendPushNotification = async (userId, payload) => {
  try {
    const subscriptions = await PushSubscription.find({ userId });
    if (!subscriptions || subscriptions.length === 0) return;

    const notifications = subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: sub.keys
        }, JSON.stringify(payload));
      } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) {
          console.log('Subscription expired/invalid, removing:', sub.endpoint);
          await PushSubscription.findOneAndDelete({ endpoint: sub.endpoint });
        } else {
          console.error('Error sending push notification:', error);
        }
      }
    });

    await Promise.all(notifications);
  } catch (error) {
    console.error('Push notification error:', error);
  }
};
