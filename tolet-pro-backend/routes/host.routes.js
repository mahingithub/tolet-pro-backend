'use strict';

// Host-scoped read endpoints. The frontend expects these to live under the
// `/api/host` prefix rather than `/api/properties/host`, so we mount them as
// a dedicated router from server.js.
const express = require('express');
const propertyCtl = require('../controllers/property.controller');
const inquiryCtl  = require('../controllers/inquiry.controller');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

router.get('/properties', requireAuth, propertyCtl.getHostProperties);
router.get('/inquiries',  requireAuth, inquiryCtl.getHostInquiries);

module.exports = router;
