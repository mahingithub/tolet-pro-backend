'use strict';

const express     = require('express');
const ctrl        = require('../controllers/hostStats.controller');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// GET /api/host-stats  → real performance metrics for the logged-in host.
router.get('/', requireAuth, ctrl.getHostStats);

module.exports = router;
