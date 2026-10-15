'use strict';

const express     = require('express');
const ctl         = require('../controllers/billing.controller');
const requireAuth = require('../middleware/requireAuth');
const { uploadSingleImage } = require('../middleware/uploadMiddleware');

const router = express.Router();

router.get('/plans', ctl.getPlans);
// The wallet phone's SMS forwarder — its own key, not a user login.
router.post('/payments/sms', ctl.receivePaymentSms);

router.use(requireAuth);

router.get('/subscription', ctl.getMySubscription);
// Pay by bKash / Nagad Send Money, then submit the TrxID (+ optional screenshot).
router.get('/payments', ctl.listMyPayments);
router.post('/payments', uploadSingleImage, ctl.submitPayment);
router.post('/cancel', ctl.cancel);
// One-time free Pro trial earned by sharing the app (Free Pro Trial popup).
router.post('/share-trial', ctl.claimShareTrial);

module.exports = router;
