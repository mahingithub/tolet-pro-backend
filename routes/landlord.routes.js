'use strict';

const router = require('express').Router();
const landlordController = require('../controllers/landlord.controller');
const optionalAuth = require('../middleware/optionalAuth');

// Public — anyone can view a landlord's profile card, but auth unlocks private fields.
router.get('/:id', optionalAuth, landlordController.getLandlord);

module.exports = router;
