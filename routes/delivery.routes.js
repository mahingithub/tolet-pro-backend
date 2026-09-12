'use strict';

/**
 * delivery.routes.js — mounted at /api/delivery.
 *
 * The COURIER's surface, and the only unauthenticated write path in the service
 * marketplace. No login, no account: the token in the URL is the whole
 * credential, because a shop's delivery boy is a teenager on a borrowed phone
 * who changes every few weeks and will never hold an account here.
 *
 * What makes that acceptable is what the token cannot do — see the headers on
 * models/DeliveryTrack.js and controllers/deliveryTrack.controller.js. It is
 * scoped to one order, exposes no tenant identity beyond a destination point,
 * cannot move the order's status, and expires the same day.
 *
 *   GET  /:token        where am I taking this
 *   POST /:token/ping   where I am now
 *   POST /:token/done   handed over
 */

const express = require('express');

const ctl = require('../controllers/deliveryTrack.controller');

const router = express.Router();

router.get('/:token', ctl.getByToken);
router.post('/:token/ping', ctl.ping);
router.post('/:token/done', ctl.finishByToken);

module.exports = router;
