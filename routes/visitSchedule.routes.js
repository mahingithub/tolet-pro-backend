'use strict';

const express = require('express');
const ctl = require('../controllers/visitSchedule.controller');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

router.post('/', requireAuth, ctl.createVisitSchedule);
router.post('/request', requireAuth, ctl.requestVisitSchedule);
router.patch('/:id/approve-request', requireAuth, ctl.approveVisitRequest);
router.patch('/:id/complete', requireAuth, ctl.completeVisit);
router.patch('/:id/cancel', requireAuth, ctl.cancelVisit);
router.patch('/:id/reschedule', requireAuth, ctl.rescheduleVisit);

module.exports = router;
