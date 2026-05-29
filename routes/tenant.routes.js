'use strict';

const router = require('express').Router();
const tenantController = require('../controllers/tenant.controller');
const optionalAuth = require('../middleware/optionalAuth');

// ── Public tenant profile read ─────────────────────────────────────────────
// The privacy gate inside the controller depends on `req.user` being
// populated when a token is present (so it can unlock phone/email for the
// tenant themselves or for a landlord with an active inquiry against this
// tenant). `optionalAuth` populates `req.user` when a valid token is sent
// and silently ignores absent / invalid tokens.
router.get('/:id', optionalAuth, tenantController.getTenant);

module.exports = router;
