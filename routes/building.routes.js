'use strict';

/**
 * building.routes.js — Building → Unit (room) structure.
 * ──────────────────────────────────────────────────────────────────────────
 * Rooms are created independently of tenants, so these live apart from
 * /api/bookings: a room exists, then people come and go from its seats.
 */

const express     = require('express');
const ctrl        = require('../controllers/building.controller');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

router.post('/',    requireAuth, ctrl.createBuilding);
router.get('/',     requireAuth, ctrl.listBuildings);
router.patch('/:id', requireAuth, ctrl.updateBuilding);
// Soft — archived, never destroyed; historic leases still resolve their building.
router.delete('/:id', requireAuth, ctrl.archiveBuilding);

// Rooms live under their building.
router.post('/:id/units', requireAuth, ctrl.createUnit);
router.get('/:id/units',  requireAuth, ctrl.listUnits);

module.exports = router;

// Unit-scoped edits, mounted separately at /api/units so a room can be reached
// without knowing its building.
const unitRouter = express.Router();
unitRouter.patch('/:unitId',  requireAuth, ctrl.updateUnit);
unitRouter.delete('/:unitId', requireAuth, ctrl.archiveUnit);

// Tenants live INSIDE a unit. These two never create a room, and never create a
// second booking for a room that already has one — a hostel room's occupants
// are members of its ONE booking, each with their own rent ledger.
unitRouter.post('/:unitId/tenants', requireAuth, ctrl.addTenantToUnit);
// Same seat, new person: the unit, its rent and the seat are untouched.
unitRouter.post('/:unitId/tenants/:memberId/replace', requireAuth, ctrl.replaceTenantInUnit);

module.exports.unitRouter = unitRouter;
