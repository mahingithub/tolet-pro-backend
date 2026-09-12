'use strict';

/**
 * merchantPush.routes.js — mounted at /api/merchant/push.
 *
 * The shopkeeper's own device registry. Behind requireMerchantAuth, against its
 * own collection: a tenant's token cannot reach these handlers and a merchant's
 * cannot reach /api/push, because the audiences differ.
 *
 *   POST   /subscribe   { subscription, device? }
 *   DELETE /subscribe   { endpoint }
 *   GET    /key         the VAPID public key, so the client never bundles it
 */

const express = require('express');

const requireMerchantAuth = require('../middleware/requireMerchantAuth');
const ctl = require('../controllers/merchantPush.controller');

const router = express.Router();

// Public: it IS a public key, and the provider app needs it before it can ask
// the browser for permission. Serving it rather than baking it into the bundle
// means rotating VAPID keys does not require a frontend deploy.
router.get('/key', ctl.publicKey);

router.use(requireMerchantAuth);
router.post('/subscribe', ctl.subscribe);
router.delete('/subscribe', ctl.unsubscribe);

module.exports = router;
