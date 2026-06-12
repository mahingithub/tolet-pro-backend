'use strict';

const Conversation = require('../models/Conversation');
const User = require('../models/User');

const verifyConversationAccess = async (req, res, next) => {
  try {
    const requestingUserId = req.user.id; // From requireAuth
    // The route params might be :id for the conversation ID, or it might be in the body.
    const conversationId = req.params.id || req.body.conversationId;
    const peerUserId = req.body.peerUserId; // For opening a new conversation

    if (conversationId) {
      const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: { $in: [requestingUserId] }
      });

      if (!conversation) {
        return res.status(403).json({
          error: 'Access denied. You are not a participant in this conversation.'
        });
      }
      // Attach it to req if needed by the controller
      req.conversation = conversation;
      return next();
    }

    if (peerUserId) {
      const peerUser = await User.findById(peerUserId);
      if (!peerUser) {
        return res.status(404).json({ error: 'Peer user not found.' });
      }
      return next();
    }

    // If neither conversationId nor peerUserId is provided, just proceed (e.g. for listing conversations)
    next();
  } catch (err) {
    console.error('verifyConversationAccess error:', err);
    res.status(500).json({ error: 'Server error during access verification.' });
  }
};

module.exports = verifyConversationAccess;
