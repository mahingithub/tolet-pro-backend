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
 */

const express = require('express');

const requireAuth = require('../middleware/requireAuth');
const ctl = require('../controllers/serviceRequest.controller');

const router = express.Router();
router.use(requireAuth);

router.post('/', ctl.create);
router.get('/', ctl.listMine);
router.get('/:id', ctl.getMine);
router.post('/:id/cancel', ctl.cancelByTenant);

module.exports = router;
