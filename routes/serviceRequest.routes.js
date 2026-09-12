'use strict';

/**
 * serviceRequest.routes.js — mounted at /api/service-requests.
 *
 * The TENANT's side of an order. The merchant's side is a separate surface
 * behind a separate gate (routes/merchantRequest.routes.js) because the two
 * live in different identity systems — a tenant's token cannot reach a
 * merchant route and vice versa.
 *
 *   POST /            place an order or a structured callback
 *   GET  /            my orders            (?open=1)
 *   GET  /:id
 *   POST /:id/cancel
 *   POST /reviews          rate a shop (gated on a completed order / a call)
 *   GET  /reviews/mine     have I already rated this shop?
 *   GET  /:id/track        where the delivery has got to
 */

const express = require('express');

const requireAuth = require('../middleware/requireAuth');
const ctl = require('../controllers/serviceRequest.controller');
const reviewCtl = require('../controllers/providerReview.controller');
const trackCtl = require('../controllers/deliveryTrack.controller');

const router = express.Router();
router.use(requireAuth);

// Reviews live under the tenant's order surface rather than under /services,
// because leaving one is something you do to an order you placed — and it is
// gated on exactly that. Declared BEFORE '/:id', or Express matches "reviews"
// as an order id and the handler 404s on a perfectly valid request.
router.get ('/reviews/mine', reviewCtl.getMine);
router.post('/reviews', reviewCtl.upsertMine);

router.post('/', ctl.create);
router.get('/', ctl.listMine);
router.get('/:id', ctl.getMine);
router.post('/:id/cancel', ctl.cancelByTenant);
// The tenant is the one waiting at the door, so they watch the same dot the
// shopkeeper does.
router.get('/:id/track', trackCtl.getForTenant);

module.exports = router;
