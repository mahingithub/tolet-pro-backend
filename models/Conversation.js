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

    // ── Block ──────────────────────────────────────────────────────────────
    // userIds who have blocked THIS conversation/peer. If user A is in
    // `blockedBy`, A has blocked the other participant → the other participant
    // may not send messages to A, and A's UI shows the "You blocked X" state.
    blockedBy: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      default: [],
    },

    // ── Mute ───────────────────────────────────────────────────────────────
    // Map<userIdString, ISO/date until which the chat is muted>. A value of
    // 'always' (stored as a far-future date) means muted indefinitely. Absence
    // of a key means not muted.
    mutedUntil: { type: Map, of: Date, default: () => new Map() },

    // ── Pinned messages ──────────────────────────────────────────────────
    // Message ids pinned in this thread (WhatsApp/Telegram style). Shared by
    // both participants so a pinned banner shows for everyone in the thread.
    pinnedMessageIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Message' }],
      default: [],
    },

    // ── Per-user "Delete conversation" (soft, WhatsApp-style) ─────────────
    // A user who deletes the chat is added here; listConversations hides the
    // thread for anyone listed. A NEW message revives it (we clear this array
    // whenever a message is added), matching WhatsApp behaviour.
    deletedBy: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      default: [],
    },
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
    if (ret.mutedUntil instanceof Map) {
      ret.mutedUntil = Object.fromEntries(ret.mutedUntil);
    }
    return ret;
  },
});

module.exports = mongoose.model('Conversation', ConversationSchema);
