'use strict';

/**
 * merchantRequest.routes.js — mounted at /api/merchant/requests.
 *
 * The PROVIDER's order inbox — the provider app's home screen. Behind
 * requireMerchantAuth, and every handler re-checks that the request belongs to
 * a business this merchant actually owns rather than trusting a providerId
 * from the body.
 *
 *   GET  /                  my inbox (open by default)
 *   POST /:id/accept
 *   POST /:id/decline       { reason }  — shown to the tenant verbatim
 *   POST /:id/on-the-way
 *   POST /:id/complete      { finalTotal? }
 *   POST /:id/cancel        { reason }
 *   GET  /reviews           reviews of my shops (?unanswered=1)
 *   POST /reviews/:id/reply { text }
 *   POST /:id/track         mint a courier tracking link
 *   GET  /:id/track         watch it
 *   POST /:id/track/end     stop it
 */

const express = require('express');

const requireMerchantAuth = require('../middleware/requireMerchantAuth');
const ctl = require('../controllers/serviceRequest.controller');
const reviewCtl = require('../controllers/providerReview.controller');
const trackCtl = require('../controllers/deliveryTrack.controller');

const router = express.Router();
router.use(requireMerchantAuth);

// Reviews of the shops he owns, and his right of reply. Declared BEFORE the
// '/:id/*' order routes below, or Express matches "reviews" as an order id.
router.get ('/reviews', reviewCtl.listForMerchant);
router.post('/reviews/:id/reply', reviewCtl.reply);

router.get('/', ctl.listForMerchant);
router.post('/:id/accept', ctl.accept);
router.post('/:id/decline', ctl.decline);
router.post('/:id/on-the-way', ctl.onTheWay);
router.post('/:id/complete', ctl.complete);
router.post('/:id/cancel', ctl.cancelByProvider);

// The delivery tracking link. Declared after the order actions above so the
// '/:id/track' paths cannot shadow them.
router.post('/:id/track',     trackCtl.create);
router.get ('/:id/track',     trackCtl.getForMerchant);
router.post('/:id/track/end', trackCtl.end);

module.exports = router;
