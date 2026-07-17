'use strict';

const router = require('express').Router();
const reviewController = require('../controllers/review.controller');
const requireAuth = require('../middleware/requireAuth');
const { writeLimiter } = require('../middleware/rateLimiters');

// Every review endpoint requires login:
//   • reviews are visible to logged-in users only, and
//   • any logged-in user may leave one (no booking/relationship gate).
// writeLimiter guards the mutating routes against spam bursts.
router.get('/',       requireAuth, reviewController.listReviews);
router.post('/',      requireAuth, writeLimiter, reviewController.submitReview);
router.delete('/:id', requireAuth, writeLimiter, reviewController.deleteReview);

module.exports = router;
