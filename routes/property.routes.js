'use strict';

const express = require('express');
const ctl = require('../controllers/property.controller');
const v = require('../validators/property.validators');
const validate = require('../middleware/validate');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// ─── Public reads ──────────────────────────────────────────────────────────
// Anyone can browse properties — no auth needed. Search + filters come in via
// querystring, validated inside the controller.
router.get('/',    ctl.getProperties);
router.get('/:id', ctl.getPropertyById);

// ─── Host-scoped writes ────────────────────────────────────────────────────
// Auth required. Ownership is enforced inside the service so a stolen JWT for
// User A cannot mutate User B's listings.
router.post('/',       requireAuth, validate(v.createProperty),  ctl.createProperty);
router.patch('/:id',   requireAuth, validate(v.updateProperty),  ctl.updateProperty);
router.delete('/:id',  requireAuth,                              ctl.deleteProperty);

module.exports = router;
