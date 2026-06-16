'use strict';

/**
 * Inquiry model
 * ──────────────────────────────────────────────────────────────────────────
 * This is the canonical shape consumed by Host Dashboard inquiry rows and
 * by the new public Tenant Profile route (`GET /api/tenants/:id`), which
 * uses the `inquirerUserId ↔ propertyOwnerId` relationship to decide
 * whether to unlock the tenant's phone/email on the trust card.
 *
 * If your existing project already ships an Inquiry model, MERGE the new
 * `inquirerUserId` + `propertyOwnerId` fields into it (rather than
 * replacing wholesale). The critical addition for this roadmap is the
 * `inquirerUserId` reference — everything else is the existing shape
 * preserved here for completeness.
 *
 * Migration note: legacy anonymous inquiries (submitted before the user
 * was logged in) will have `inquirerUserId = null`. We DO NOT back-fill
 * by phone match — that's a privacy decision pending user signoff
 * (see tolet-pro-tenant-roadmap-v2.md → "open questions").
 */

const mongoose = require('mongoose');

const InquirySchema = new mongoose.Schema(
  {
    // Property being inquired about + denormalised title so the host
    // dashboard doesn't have to JOIN every render.
    propertyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
    propTitle:  { type: String, trim: true, default: '', maxlength: 160 },

    // Owner of the property (= landlord receiving the inquiry).
    propertyOwnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // ─── Inquirer identity (the tenant) ──────────────────────────────────
    // `inquirerUserId` is NEW and is the linchpin of the public tenant
    // profile's privacy gate. It's nullable so anonymous-by-phone inquiries
    // still work — they just can't unlock the tenant's private fields.
    inquirerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    user:           { type: String, trim: true, default: '', maxlength: 80 },   // displayed name
    phone:          { type: String, trim: true, default: '', maxlength: 20 },

    msg:        { type: String, trim: true, default: '', maxlength: 2000 },
    messages:   [{ sender: String, senderId: mongoose.Schema.Types.ObjectId, text: String, createdAt: Date }],
    visitSchedule: { proposedBy: String, date: String, time: String, location: String, status: String, reminderSent: Boolean },

    leaseStart: { type: Date,   default: null },
    leaseEnd:   { type: Date,   default: null },

    status: {
      type: String,
      enum: ['sent', 'delivered', 'viewed', 'accepted', 'rejected', 'visit_scheduled', 'final_booking', 'rented'],
      default: 'sent',
      index: true,
    },
    statusHistory: [
      {
        status: String,
        changedAt: { type: Date, default: Date.now },
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      },
    ],
  },
  { timestamps: true },
);

InquirySchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('Inquiry', InquirySchema);