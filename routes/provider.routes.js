'use strict';

/**
 * provider.routes.js — mounted at /api/providers.
 *
 * The provider's own business: registration, editing, and the open/closed
 * switch. Everything here is authenticated and scoped to the caller's own
 * documents — there is no public browse endpoint in this file. Tenant-facing
 * discovery (nearest providers in a category) is a separate, cacheable,
 * unauthenticated surface and will not share these handlers.
 *
 *   POST   /                 start a registration (draft)
 *   GET    /mine             my businesses
 *   GET    /:id              one of mine
 *   PATCH  /:id              a registration step
 *   PATCH  /:id/fields       the category-specific answers (?partial=1)
 *   POST   /:id/submit       draft → pending_review
 *   POST   /:id/open         খোলা / বন্ধ
 *
 * Note there is no route that sets `active`. Approval is an admin action and
 * lives on the admin surface; nothing a provider can call grants it.
 */

const express = require('express');

const requireMerchantAuth = require('../middleware/requireMerchantAuth');
const ctl = require('../controllers/provider.controller');
const contactCtl = require('../controllers/contactEvent.controller');

const router = express.Router();

// Every route below is the caller's own data. The controller re-checks
// ownership per document — this only establishes who is asking.
//
// requireMerchantAuth, NOT requireAuth: a tenant's token carries a different
// audience and cannot reach these handlers at all. The rental system and the
// provider system are isolated cryptographically, not by a role check.
router.use(requireMerchantAuth);

// `/mine` before `/:id`, or Express matches "mine" as an id and the handler
// 404s on a perfectly valid request.
router.get('/mine', ctl.listMine);

router.post('/', ctl.create);
router.get('/:id', ctl.getOne);
router.patch('/:id', ctl.update);
router.patch('/:id/fields', ctl.updateFields);
router.post('/:id/submit', ctl.submit);
router.post('/:id/open', ctl.setOpen);
// The Earnings screen. For contact-tier categories the call count is the
// ONLY evidence the registration fee bought anything.
router.get('/:id/stats', contactCtl.providerStats);

module.exports = router;
