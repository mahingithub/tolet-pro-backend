'use strict';

const express = require('express');
const ctl = require('../controllers/inquiry.controller');
const v = require('../validators/inquiry.validators');
const validate = require('../middleware/validate');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// Tenant sends an inquiry to a host. Auth required so we can attach the
// tenant's identity to the inquiry record.
router.post('/', requireAuth, validate(v.createInquiry), ctl.createInquiry);

// Tenant lists inquiries they've sent — useful for an "Inquiries" tab.
router.get('/mine', requireAuth, ctl.getMyInquiries);

// Host updates inquiry status: new → seen → replied → closed.
router.patch('/:id/status', requireAuth, validate(v.updateInquiry), ctl.updateInquiryStatus);

// Host deletes inquiry entirely
router.delete('/:id', requireAuth, ctl.deleteInquiry);

module.exports = router;
