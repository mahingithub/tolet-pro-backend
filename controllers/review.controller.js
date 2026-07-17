'use strict';

/**
 * Person-to-person review controller.
 *
 *   GET    /api/reviews?revieweeId=<id>&role=<landlord|tenant>[&limit=]
 *   POST   /api/reviews   { revieweeId, revieweeRole, rating, comment }
 *   DELETE /api/reviews/:id
 *
 * ALL endpoints require auth (middleware/requireAuth):
 *   • Reviews are only visible to logged-in users (product rule).
 *   • Any logged-in user may review any OTHER user — there is NO booking or
 *     inquiry relationship gate. Abuse is bounded by "one review per
 *     (reviewer, reviewee, role)" (unique index), self-review is blocked, and
 *     the reviewee must actually hold the role being rated.
 */

const mongoose = require('mongoose');
const Review   = require('../models/Review');
const User     = require('../models/User');
const ApiError = require('../utils/ApiError');

const ROLES = ['landlord', 'tenant'];

function isObjectId(v) {
  return mongoose.Types.ObjectId.isValid(String(v));
}

// GET /api/reviews — list a profile's reviews + aggregate + the caller's own.
async function listReviews(req, res, next) {
  try {
    const revieweeId = String(req.query.revieweeId || '');
    const role       = String(req.query.role || '');
    if (!isObjectId(revieweeId)) throw ApiError.badRequest('অবৈধ ব্যবহারকারী আইডি।', { code: 'invalid_reviewee' });
    if (!ROLES.includes(role))   throw ApiError.badRequest('অবৈধ রোল।', { code: 'invalid_role' });

    const limit = Math.min(Number(req.query.limit) || 50, 100);

    const [docs, summary] = await Promise.all([
      Review.find({ revieweeId, revieweeRole: role }).sort({ createdAt: -1 }).limit(limit),
      Review.summaryFor(revieweeId, role),
    ]);

    const callerId = String(req.user._id);
    const reviews  = docs.map((d) => d.toJSON());
    // Surface the caller's own review separately so the UI can pre-fill the
    // edit form and label it "Your review".
    const myReview = reviews.find((r) => String(r.reviewerId) === callerId) || null;

    return res.json({ reviews, summary, myReview });
  } catch (err) {
    return next(err);
  }
}

// POST /api/reviews — create OR update the caller's review for a person+role.
async function submitReview(req, res, next) {
  try {
    const reviewerId = req.user._id;
    const { revieweeId, revieweeRole, rating, comment } = req.body || {};

    if (!isObjectId(revieweeId))       throw ApiError.badRequest('অবৈধ ব্যবহারকারী আইডি।', { code: 'invalid_reviewee' });
    if (!ROLES.includes(revieweeRole)) throw ApiError.badRequest('অবৈধ রোল।', { code: 'invalid_role' });

    const numRating = Number(rating);
    if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5) {
      throw ApiError.badRequest('রেটিং ১ থেকে ৫ এর মধ্যে হতে হবে।', { code: 'invalid_rating' });
    }
    if (String(revieweeId) === String(reviewerId)) {
      throw ApiError.badRequest('আপনি নিজেকে রিভিউ দিতে পারবেন না।', { code: 'self_review' });
    }

    const reviewee = await User.findById(revieweeId).lean();
    if (!reviewee) throw ApiError.notFound('ব্যবহারকারী পাওয়া যায়নি।', { code: 'reviewee_missing' });

    // The reviewee must actually hold the role being reviewed — you can't rate
    // a tenant-only user "as a landlord".
    const revieweeRoles = Array.isArray(reviewee.roles) ? reviewee.roles : [reviewee.role];
    if (!revieweeRoles.includes(revieweeRole)) {
      throw ApiError.badRequest('এই ব্যবহারকারী একজন ' + revieweeRole + ' নন।', { code: 'role_mismatch' });
    }

    const cleanComment = String(comment || '').trim().slice(0, 1000);

    const review = await Review.findOneAndUpdate(
      { reviewerId, revieweeId, revieweeRole },
      {
        $set: {
          rating:         numRating,
          comment:        cleanComment,
          reviewerName:   req.user.name   || '',
          reviewerAvatar: req.user.avatar || '',
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    const summary = await Review.summaryFor(revieweeId, revieweeRole);
    return res.status(201).json({ review: review.toJSON(), summary });
  } catch (err) {
    // Unique-index race (two rapid submits) → re-read and return success so the
    // client never sees a spurious 500 for what is really an idempotent edit.
    if (err && err.code === 11000) {
      try {
        const { revieweeId, revieweeRole } = req.body || {};
        const existing = await Review.findOne({ reviewerId: req.user._id, revieweeId, revieweeRole });
        const summary  = await Review.summaryFor(revieweeId, revieweeRole);
        return res.status(200).json({ review: existing ? existing.toJSON() : null, summary });
      } catch (e2) { return next(e2); }
    }
    return next(err);
  }
}

// DELETE /api/reviews/:id — delete your OWN review only.
async function deleteReview(req, res, next) {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) throw ApiError.badRequest('অবৈধ রিভিউ আইডি।', { code: 'invalid_id' });

    const review = await Review.findById(id);
    if (!review) throw ApiError.notFound('রিভিউ পাওয়া যায়নি।', { code: 'review_missing' });
    if (String(review.reviewerId) !== String(req.user._id)) {
      throw ApiError.forbidden('আপনি শুধু নিজের রিভিউ মুছতে পারবেন।', { code: 'not_owner' });
    }

    const { revieweeId, revieweeRole } = review;
    await review.deleteOne();
    const summary = await Review.summaryFor(revieweeId, revieweeRole);
    return res.json({ ok: true, summary });
  } catch (err) {
    return next(err);
  }
}

module.exports = { listReviews, submitReview, deleteReview };
