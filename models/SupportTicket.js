'use strict';

/**
 * Support Ticket model
 * ──────────────────────────────────────────────────────────────────────────
 * Stores support tickets and their nested messages.
 */

const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema(
  {
    author: { type: String, enum: ['user', 'admin', 'ai', 'system'], required: true },
    authorId: { type: String }, // optional for system/ai
    authorName: { type: String },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true, timestamps: false }
);

MessageSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    ret.createdAt = ret.createdAt.toISOString();
    delete ret._id;
    return ret;
  },
});

const SupportTicketSchema = new mongoose.Schema(
  {
    // Both lead compound indexes declared below, so neither needs its own.
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String, required: true },
    userPhone: { type: String, required: true },
    subject: { type: String, required: true },
    status: { type: String, enum: ['open', 'pending_user', 'resolved', 'closed'], default: 'open' },
    priority: { type: String, enum: ['low', 'normal', 'urgent'], default: 'normal' },
    
    assignedAdminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    assignedAdminName: { type: String, default: null },
    
    resolvedAt: { type: Date },
    resolutionSummary: { type: String },
    
    origin: {
      source: { type: String, enum: ['ai_widget', 'help_center', 'admin_created'], default: 'help_center' },
      aiTranscript: [MessageSchema], // Embed the AI context securely
    },
    
    messages: [MessageSchema],
  },
  { timestamps: true }
);

// ─── Indexes ────────────────────────────────────────────────────────────────
// Both ticket lists sort by updatedAt (most recently active first) and neither
// had an index that could do it, so each load sorted in memory. A ticket
// document embeds its whole message thread, which makes those sorts unusually
// expensive per row — the documents being shuffled are large.

// GET /api/support/tickets — the user's own tickets.
SupportTicketSchema.index({ userId: 1, updatedAt: -1 });

// The admin queue, optionally filtered to one status.
SupportTicketSchema.index({ status: 1, updatedAt: -1 });

SupportTicketSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    ret.createdAt = ret.createdAt.toISOString();
    ret.updatedAt = ret.updatedAt.toISOString();
    if (ret.resolvedAt) ret.resolvedAt = ret.resolvedAt.toISOString();
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('SupportTicket', SupportTicketSchema);
