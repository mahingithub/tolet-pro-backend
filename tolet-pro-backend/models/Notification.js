'use strict';

/**
 * Notification model
 * ──────────────────────────────────────────────────────────────────────────
 * Per-user notification queue. Auto-populated by inquiry.service and
 * message.service when a relevant event happens. The frontend polls
 * /api/notifications every 15 s and shows unread count + dropdown list.
 *
 * Types currently emitted:
 *   - 'inquiry_new'      → landlord receives a new inquiry
 *   - 'inquiry_status'   → tenant's inquiry was updated (active / archived / rejected / converted)
 *   - 'message_new'      → counterpart sent a new chat message
 *
 * `data` is a free-form payload that lets the frontend deep-link without a
 * second round-trip — e.g. inquiryId, conversationId, propertyTitle.
 */

const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type:   {
      type: String,
      enum: ['inquiry_new', 'inquiry_status', 'message_new', 'system', 'rent_receipt'],
      required: true,
    },
    title:  { type: String, trim: true, default: '', maxlength: 160 },
    body:   { type: String, trim: true, default: '', maxlength: 600 },

    // free-form payload — keep it small.
    data:   { type: mongoose.Schema.Types.Mixed, default: {} },

    read:   { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);

NotificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

NotificationSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('Notification', NotificationSchema);
