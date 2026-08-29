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
// A whole floor in one go: "101 to 109". Existing rooms are skipped, not
// treated as errors, so extending a range later just adds the new ones.
router.post('/:id/units/bulk', requireAuth, ctrl.createUnitsBulk);

module.exports = router;

// Unit-scoped edits, mounted separately at /api/units so a room can be reached
// without knowing its building.
const unitRouter = express.Router();
unitRouter.patch('/:unitId',  requireAuth, ctrl.updateUnit);
unitRouter.delete('/:unitId', requireAuth, ctrl.archiveUnit);

// Tenants live INSIDE a unit. None of these ever creates a room, and none ever
// creates a second booking for a room that already has one — a hostel room's
// occupants are members of its ONE booking, each with their own rent ledger.
unitRouter.post('/:unitId/tenants', requireAuth, ctrl.addTenantToUnit);
// Same seat, NEW person: the unit, its rent and the seat are untouched.
unitRouter.post('/:unitId/tenants/:memberId/replace', requireAuth, ctrl.replaceTenantInUnit);
// SAME person, new room: 203 moves to 206. The mirror image of replace — there
// the room stays and the person changes; here the person stays and the room
// changes. `:memberId` may be the literal 'primary' for a legacy whole-unit
// tenancy that predates members[].
unitRouter.post('/:unitId/tenants/:memberId/shift', requireAuth, ctrl.shiftTenantToUnit);

module.exports.unitRouter = unitRouter;
