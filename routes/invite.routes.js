'use strict';

/**
 * invite.routes.js — tenant self-onboarding by QR / link.
 * ──────────────────────────────────────────────────────────────────────────
 * Two audiences on one router:
 *
 *   Landlord (auth)  — mint / revoke a share token, work the pending queue.
 *   Tenant           — resolve a token (PUBLIC), then submit a form (auth).
 *
 * `/resolve/:token` is the only unauthenticated route here, and it has to be:
 * the link lands on a phone that may not have the app or an account yet, and a
 * signup wall in front of "whose building is this?" is how a shared link dies
 * in a group chat. It returns a building name, a host name and a list of room
 * numbers with free seats — what the person holding the link was already told
 * by whoever sent it — and nothing about who lives in them.
 */

const express = require('express');
const ctrl    = require('../controllers/invite.controller');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// ── Landlord: share tokens ──────────────────────────────────────────────────
router.get('/building/:buildingId',           requireAuth, ctrl.getBuildingInvite);
router.patch('/building/:buildingId',         requireAuth, ctrl.setBuildingInviteEnabled);
router.post('/building/:buildingId/revoke',   requireAuth, ctrl.revokeBuildingInvite);

router.get('/unit/:unitId',                   requireAuth, ctrl.getUnitInvite);
router.post('/unit/:unitId/revoke',           requireAuth, ctrl.revokeUnitInvite);

// ── Landlord: the pending queue ─────────────────────────────────────────────
// Literal paths first, so 'onboardings' is never read as a :token.
router.get('/onboardings',                    requireAuth, ctrl.listOnboardings);
router.post('/onboardings/:id/approve',       requireAuth, ctrl.approveOnboarding);
router.post('/onboardings/:id/reject',        requireAuth, ctrl.rejectOnboarding);

// ── Tenant ──────────────────────────────────────────────────────────────────
router.get('/my-submissions',                 requireAuth, ctrl.listMySubmissions);
// PUBLIC — see the header. Guessing a token means guessing 128 bits, and the
// global /api limiter is the backstop against trying.
router.get('/resolve/:token',                 ctrl.resolveInvite);
// The completed form. Auth is what makes this attach a PERSON to a room rather
// than a name in a box.
router.post('/:token/submit',                 requireAuth, ctrl.submitOnboarding);

module.exports = router;
