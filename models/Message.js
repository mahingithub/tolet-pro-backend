'use strict';

/**
 * Message model
 * ──────────────────────────────────────────────────────────────────────────
 * One chat message inside a Conversation. The frontend polls
 * /api/conversations/:id/messages?since=<iso> every 5 s and merges the
 * delta into the local stream.
 *
 * A message is ONE of three kinds (the `type` field):
 *   • 'text'  — plain text in `text`
 *   • 'image' — a photo; `mediaUrl` + `mediaPublicId` point at Cloudinary
 *   • 'audio' — a voice message; same media fields, plus optional duration
 *
 * `text` is no longer required at the schema level (an image/audio message
 * may have no caption). We validate per-type in chat.service instead.
 */

const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema(
  {
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    senderId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User',         required: true, index: true },

    // What kind of message this is. Defaults to 'text' so every existing
    // document (created before this field existed) reads back as a text message.
    type: { type: String, enum: ['text', 'image', 'audio'], default: 'text', index: true },

    // Text body (or optional caption for media). Not required — an image or
    // voice message can stand on its own.
    text: { type: String, trim: true, default: '', maxlength: 4000 },

    // ── Media fields (only set for type 'image' / 'audio') ──────────────────
    mediaUrl:      { type: String, default: null }, // Cloudinary secure_url
    mediaPublicId: { type: String, default: null }, // Cloudinary public_id (for deletion)
    mediaMeta: {
      // Small grab-bag of useful client-side hints. All optional.
      durationSec: { type: Number, default: null }, // voice message length
      width:       { type: Number, default: null }, // image width
      height:      { type: Number, default: null }, // image height
      bytes:       { type: Number, default: null },
      format:      { type: String, default: null }, // 'jpg', 'webm', etc.
    },

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
