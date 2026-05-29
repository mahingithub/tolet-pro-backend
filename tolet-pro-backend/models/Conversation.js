'use strict';

/**
 * Conversation model
 * ──────────────────────────────────────────────────────────────────────────
 * A 1-to-1 chat thread between two users. Optionally scoped to a property
 * (so e.g. tenants can have separate threads with the same landlord across
 * different listings).
 *
 * `participants` is ALWAYS stored sorted by ObjectId ascending so the
 * "find or create" lookup is a single index hit on (participants[0],
 * participants[1], propertyId).
 *
 * `unreadCounts` is a small Map keyed by stringified userId. We bump it
 * on every incoming message except for the sender, and zero it when the
 * recipient calls /api/conversations/:id/read.
 *
 * `lastMessageText` is denormalised here purely so the sidebar list can
 * render the preview without an extra round-trip per row.
 */

const mongoose = require('mongoose');

const ConversationSchema = new mongoose.Schema(
  {
    participants: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length === 2,
        message:   '`participants` must contain exactly two userIds.',
      },
    },

    propertyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', default: null, index: true },
    inquiryId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Inquiry',  default: null, index: true },

    lastMessageText: { type: String, default: '', maxlength: 600 },
    lastMessageAt:   { type: Date,   default: null, index: true },
    lastSenderId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Map<userIdString, unreadCount>
    unreadCounts: { type: Map, of: Number, default: () => new Map() },
  },
  { timestamps: true },
);

ConversationSchema.index({ participants: 1, propertyId: 1 });

ConversationSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    // Convert Map → plain object for the frontend.
    if (ret.unreadCounts instanceof Map) {
      ret.unreadCounts = Object.fromEntries(ret.unreadCounts);
    }
    return ret;
  },
});

module.exports = mongoose.model('Conversation', ConversationSchema);
