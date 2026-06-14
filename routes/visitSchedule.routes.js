'use strict';

const express = require('express');
const ctl = require('../controllers/visitSchedule.controller');
const requireAuth = require('../middleware/requireAuth');
const validate = require('../middleware/validate');
const vals = require('../validators/visitSchedule.validators');

const router = express.Router();

router.post('/', requireAuth, validate(vals.createVisitSchedule), ctl.createVisitSchedule);
router.post('/request', requireAuth, validate(vals.requestVisitSchedule), ctl.requestVisitSchedule);
router.patch('/:id/approve-request', requireAuth, validate(vals.approveVisitRequest), ctl.approveVisitRequest);
router.patch('/:id/complete', requireAuth, ctl.completeVisit);
router.patch('/:id/cancel', requireAuth, ctl.cancelVisit);
router.patch('/:id/reschedule', requireAuth, validate(vals.rescheduleVisit), ctl.rescheduleVisit);

module.exports = router;
