'use strict';

const router = require('express').Router();
const landlordController = require('../controllers/landlord.controller');

// Public — anyone can view a landlord's profile card.
router.get('/:id', landlordController.getLandlord);

module.exports = router;
