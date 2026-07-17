'use strict';

const mongoose = require('mongoose');

// ─── PERSON-TO-PERSON REVIEW ────────────────────────────────────────────────
// A review is written by `reviewerId` ABOUT `revieweeId`, scoped to the role
// the reviewee is being rated in (`revieweeRole`): a landlord profile collects
// 'landlord' reviews, a tenant profile collects 'tenant' reviews. A user who is
// both a landlord AND a tenant therefore keeps two independent reputations.
//
// Product decision (confirmed): NO booking/relationship gate — any logged-in
// user may review any OTHER user. Spam is bounded structurally by the unique
// (reviewer, reviewee, role) index below: one review per pair per role, edited
// in place on re-submit rather than stacked.
const ReviewSchema = new mongoose.Schema(
  {
    reviewerId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    revieweeId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    revieweeRole: { type: String, enum: ['landlord', 'tenant'], required: true, index: true },

    rating:  { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, default: '', maxlength: 1000 },

    // Reviewer identity SNAPSHOT, captured at write time so the review list
    // renders without a per-row JOIN and stays stable even if the reviewer
    // later changes their display name or avatar.
    reviewerName:   { type: String, default: '', trim: true, maxlength: 120 },
    reviewerAvatar: { type: String, default: '', maxlength: 600 },
  },
  { timestamps: true },
);

// One review per (reviewer → reviewee, role). Re-submitting UPDATES the row
// (see review.controller upsert) instead of creating duplicates.
ReviewSchema.index({ reviewerId: 1, revieweeId: 1, revieweeRole: 1 }, { unique: true });
// Profile read path: newest reviews for a given person + role first.
ReviewSchema.index({ revieweeId: 1, revieweeRole: 1, createdAt: -1 });

// Average rating + count for a person in a role. Rounded to 1 decimal so the
// UI can render "4.5" directly. Returns { avg: 0, count: 0 } when none exist.
// Computed on read (no denormalised aggregate on the User doc → no drift).
ReviewSchema.statics.summaryFor = async function summaryFor(revieweeId, revieweeRole) {
  if (!mongoose.Types.ObjectId.isValid(String(revieweeId))) return { avg: 0, count: 0 };
  const rows = await this.aggregate([
    { $match: {
        revieweeId:   new mongoose.Types.ObjectId(String(revieweeId)),
        revieweeRole: revieweeRole,
    } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  const r = rows[0];
  return {
    avg:   r ? Math.round(r.avg * 10) / 10 : 0,
    count: r ? r.count : 0,
  };
};

ReviewSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('Review', ReviewSchema);
