const pushService = require('../services/push.service');

exports.subscribe = async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ message: 'Invalid subscription object' });
    }

    const userId = req.user && (req.user._id || req.user.id);
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    await pushService.saveSubscription(userId, subscription);
    res.status(200).json({ message: 'Subscribed successfully' });
  } catch (error) {
    console.error('Push subscribe error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.unsubscribe = async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      return res.status(400).json({ message: 'Endpoint is required' });
    }

    await pushService.removeSubscription(endpoint);
    res.status(200).json({ message: 'Unsubscribed successfully' });
  } catch (error) {
    console.error('Push unsubscribe error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
