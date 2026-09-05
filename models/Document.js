'use strict';

/**
 * Document model — the landlord's "Document Vault".
 * ──────────────────────────────────────────────────────────────────────────
 * One record per uploaded file. The actual bytes live in Cloudinary; we only
 * keep the secure URL + public_id (needed to delete it later) plus a small
 * snapshot of which tenant the file belongs to so the list can render without
 * a join even if the booking is later removed.
 *
 * Folders mirror the four buckets the UI already shows:
 *   - 'agreements' → Rental Agreements
 *   - 'nids'       → Tenant NID / IDs
 *   - 'payments'   → Payment Records
 *   - 'legal'      → Legal Documents
 */

const mongoose = require('mongoose');

const DocumentSchema = new mongoose.Schema(
  {
    // Owner — every query is scoped to this so one landlord never sees another's files.
    // Prefix of { landlordId, folder, createdAt } below.
    landlordId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // Which tenant this file is about (optional — e.g. a legal doc may have none).
    tenantId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    tenantName:  { type: String, trim: true, default: '' },   // snapshot, survives booking deletion
    tenantPhone: { type: String, trim: true, default: '' },   // snapshot
    bookingId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null },

    // Not indexed alone: a folder is only ever opened inside one landlord's
    // drive, never across the platform.
    folder: {
      type: String,
      enum: ['agreements', 'nids', 'payments', 'legal'],
      default: 'legal',
    },

    fileName: { type: String, required: true, trim: true, maxlength: 200 },

    // Cloudinary.
    fileUrl:  { type: String, required: true },   // secure_url
    publicId: { type: String, required: true },   // public_id — REQUIRED to delete from Cloudinary

    fileType: { type: String, default: '' },      // mime type, e.g. 'application/pdf' / 'image/jpeg'
    fileSize: { type: Number, default: 0 },       // bytes
  },
  { timestamps: true },
);

// Fast listing: a landlord's files, newest first, optionally filtered by folder.
DocumentSchema.index({ landlordId: 1, folder: 1, createdAt: -1 });

DocumentSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('Document', DocumentSchema);