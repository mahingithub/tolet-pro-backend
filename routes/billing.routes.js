'use strict';

const express     = require('express');
const ctl         = require('../controllers/billing.controller');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

router.get('/plans', ctl.getPlans);

router.use(requireAuth);

router.get('/subscription', ctl.getMySubscription);
router.post('/checkout', ctl.checkout);
router.post('/cancel', ctl.cancel);
// One-time free Pro trial earned by sharing the app (Free Pro Trial popup).
router.post('/share-trial', ctl.claimShareTrial);

module.exports = router;
