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
 */

const express = require('express');

const requireMerchantAuth = require('../middleware/requireMerchantAuth');
const ctl = require('../controllers/serviceRequest.controller');

const router = express.Router();
router.use(requireMerchantAuth);

router.get('/', ctl.listForMerchant);
router.post('/:id/accept', ctl.accept);
router.post('/:id/decline', ctl.decline);
router.post('/:id/on-the-way', ctl.onTheWay);
router.post('/:id/complete', ctl.complete);
router.post('/:id/cancel', ctl.cancelByProvider);

module.exports = router;
