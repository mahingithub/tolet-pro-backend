'use strict';

/**
 * Report model
 * ──────────────────────────────────────────────────────────────────────────
 * A user-to-user abuse report raised from a chat thread ("Report" in the chat
 * header menu / contact screen). Reports are surfaced to admins, who can review
 * them and optionally mark the reported user as "suspected".
 *
 * One report per (reporter, reported, conversation) is de-duped at the service
 * layer by updating the existing open report instead of creating a duplicate.
 */

const mongoose = require('mongoose');

const ReportSchema = new mongoose.Schema(
  {
    reporterId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reporterName: { type: String, default: '', maxlength: 120 },

    reportedUserId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reportedUserName: { type: String, default: '', maxlength: 120 },

    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', default: null },

    reason:  { type: String, default: '', maxlength: 120 },
    details: { type: String, default: '', maxlength: 1000 },

    // open      → newly filed, awaiting admin review
    // reviewed  → an admin looked at it (and possibly acted)
    // dismissed → admin decided no action is needed
    status: {
      type: String,
      enum: ['open', 'reviewed', 'dismissed'],
      default: 'open',
      index: true,
    },

    // How many times this pair/thread has been reported (bumped on de-dupe).
    reportCount: { type: Number, default: 1 },

    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

ReportSchema.index({ reportedUserId: 1, status: 1, createdAt: -1 });

ReportSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('Report', ReportSchema);
