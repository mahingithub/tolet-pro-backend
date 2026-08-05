'use strict';

const express     = require('express');
const ctl         = require('../controllers/boost.controller');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

router.use(requireAuth);

// Credits remaining this month — read by the host dashboard's Boost button.
router.get('/status', ctl.getStatus);

// Spend a credit. Declared after the literal "/status" so it never shadows it.
router.post('/:propertyId', ctl.boost);

module.exports = router;
