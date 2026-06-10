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
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    userName: { type: String, required: true },
    userPhone: { type: String, required: true },
    subject: { type: String, required: true },
    status: { type: String, enum: ['open', 'pending_user', 'resolved', 'closed'], default: 'open', index: true },
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
