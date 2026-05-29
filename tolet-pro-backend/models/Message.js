'use strict';

/**
 * Message model
 * ──────────────────────────────────────────────────────────────────────────
 * One chat message inside a Conversation. The frontend polls
 * /api/conversations/:id/messages?since=<iso> every 5 s and merges the
 * delta into the local stream.
 */

const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema(
  {
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    senderId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User',         required: true, index: true },
    text:           { type: String, trim: true, required: true, maxlength: 4000 },

    // userIds who have already read this message (used for the "read" tick).
    readBy: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
  },
  { timestamps: true },
);

MessageSchema.index({ conversationId: 1, createdAt: 1 });

MessageSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('Message', MessageSchema);
