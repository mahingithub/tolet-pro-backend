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
    // Each of the three id fields here leads a compound index declared at the
    // bottom of the file, so none of them needs a standalone one.
    propertyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', required: true },
    propTitle:  { type: String, trim: true, default: '', maxlength: 160 },

    // Owner of the property (= landlord receiving the inquiry).
    propertyOwnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // ─── Inquirer identity (the tenant) ──────────────────────────────────
    // `inquirerUserId` is NEW and is the linchpin of the public tenant
    // profile's privacy gate. It's nullable so anonymous-by-phone inquiries
    // still work — they just can't unlock the tenant's private fields.
    inquirerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    user:           { type: String, trim: true, default: '', maxlength: 80 },   // displayed name
    phone:          { type: String, trim: true, default: '', maxlength: 20 },

    msg:        { type: String, trim: true, default: '', maxlength: 2000 },
    messages:   [{ sender: String, senderId: mongoose.Schema.Types.ObjectId, text: String, createdAt: Date }],
    visitSchedule: { proposedBy: String, date: String, time: String, location: String, status: String, reminderSent: Boolean },

    // ─── Deal type discriminator ─────────────────────────────────────────
    // Commercial (office / shop / showroom / restaurant) inquiries follow a
    // DISTINCT flow from residential rentals. Denormalised from the property's
    // `intent` at creation time so the host inbox + tenant timeline can badge
    // and branch without a JOIN. Legacy rows default to 'residential'.
    // Not indexed: dealType is a badge, not a filter — no query in the app uses
    // it as a predicate. It was costing a b-tree write per inquiry for nothing.
    dealType: {
      type: String,
      enum: ['residential', 'commercial'],
      default: 'residential',
    },

    leaseStart: { type: Date,   default: null },
    leaseEnd:   { type: Date,   default: null },

    // Not indexed on its own: `status` is never the only predicate. It narrows
    // an inbox that is already scoped to one landlord or one tenant, so it
    // earns its place inside those compound indexes instead.
    status: {
      type: String,
      enum: ['sent', 'delivered', 'viewed', 'accepted', 'rejected', 'visit_scheduled', 'final_booking', 'rented'],
      default: 'sent',
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

// ─── Indexes ────────────────────────────────────────────────────────────────
// Both inbox queries sort by `{ createdAt: -1, _id: -1 }` and neither had a
// matching index, so each one loaded the whole thread list into memory to sort
// it. _id trails createdAt in the index for the same reason it trails in the
// sort: it is the tie-break that keeps pagination stable when two inquiries
// land in the same millisecond.

// listHostInquiries — the landlord's inbox. `status` is OPTIONAL there, and
// that optionality is why this is two indexes rather than one:
// `{ propertyOwnerId, status, createdAt }` can only order by createdAt when
// `status` is pinned to a single value, so the unfiltered inbox — the common
// case, the one that loads when the host opens the page — fell back to sorting
// in memory. The first index below serves that; the second serves the
// filtered-by-status view.
InquirySchema.index({ propertyOwnerId: 1, createdAt: -1, _id: -1 });
InquirySchema.index({ propertyOwnerId: 1, status: 1, createdAt: -1, _id: -1 });

// listMyInquiries — the tenant's own timeline.
InquirySchema.index({ inquirerUserId: 1, createdAt: -1, _id: -1 });

// inquiry.service dedupe check — "has this tenant already got a live thread on
// this property?" — runs on every new inquiry before one is created.
InquirySchema.index({ propertyId: 1, inquirerUserId: 1, status: 1 });

// visitReminder.service sweep. Both fields are on the same subdocument, so this
// is the difference between seeking to the handful of accepted visits and
// reading every inquiry ever filed.
InquirySchema.index({ 'visitSchedule.status': 1, 'visitSchedule.reminderSent': 1 });

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