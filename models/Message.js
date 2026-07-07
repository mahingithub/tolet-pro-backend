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
    type: { type: String, enum: ['text', 'image', 'audio', 'document'], default: 'text', index: true },

    // Text body (or optional caption for media). Not required — an image or
    // voice message can stand on its own.
    text: { type: String, trim: true, default: '', maxlength: 4000 },

    // ── Media fields (only set for type 'image' / 'audio' / 'document') ──────────────────
    mediaUrl:      { type: String, default: null }, // Cloudinary secure_url
    mediaPublicId: { type: String, default: null }, // Cloudinary public_id (for deletion)
    mediaMeta: {
      // Small grab-bag of useful client-side hints. All optional.
      originalName: { type: String, default: null }, // original filename (for documents)
      durationSec: { type: Number, default: null }, // voice message length
      width:       { type: Number, default: null }, // image width
      height:      { type: Number, default: null }, // image height
      bytes:       { type: Number, default: null },
      format:      { type: String, default: null }, // 'jpg', 'webm', 'pdf' etc.
    },

    // userIds who have already read this message (used for the "read" tick).
    readBy: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },

    // ── Reply ────────────────────────────────────────────────────────────────
    // The message this one is replying to (WhatsApp/Messenger quote). Null for
    // normal messages. We populate it on read/send so the receiver can render
    // the quoted snippet without a second round-trip.
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },

    // ── Delete for everyone ────────────────────────────────────────────────
    // Soft delete: the row is kept (so thread order + reply targets survive) but
    // its content is stripped and the UI shows "This message was deleted".
    isDeleted: { type: Boolean, default: false },

    // ── Emoji reactions ────────────────────────────────────────────────────
    // One reaction per user (WhatsApp style): a Map of userId → emoji. Stored
    // as a Map so upserts are O(1) and it serialises to a plain object in JSON.
    reactions: { type: Map, of: String, default: {} },
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
