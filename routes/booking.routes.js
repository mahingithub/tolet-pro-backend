'use strict';

const express    = require('express');
const ctrl       = require('../controllers/booking.controller');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// All routes require authentication.
router.post('/',                          requireAuth, ctrl.createBooking);
router.get('/host',                       requireAuth, ctrl.listHostBookings);
router.get('/tenant',                     requireAuth, ctrl.listTenantBookings);

// A tenant self-joins a booking with an invite code (before the /:id routes so
// the literal 'join' isn't captured as an :id).
router.post('/join',                      requireAuth, ctrl.joinByInvite);

// Legacy single-tenant rent ledger (kept for backward compatibility).
router.patch('/:id/ledger/:monthKey',     requireAuth, ctrl.updateLedger);
router.delete('/:id/ledger/:monthKey',    requireAuth, ctrl.undoLedger);

// ── Multi-member occupants + per-member rent ledger ──
router.post('/:id/members',                              requireAuth, ctrl.addMember);
router.patch('/:id/members/:memberId',                   requireAuth, ctrl.updateMember);
router.delete('/:id/members/:memberId',                  requireAuth, ctrl.removeMember);
router.patch('/:id/members/:memberId/ledger/:monthKey',  requireAuth, ctrl.updateMemberLedger);
router.delete('/:id/members/:memberId/ledger/:monthKey', requireAuth, ctrl.undoMemberLedger);

router.patch('/:id',                      requireAuth, ctrl.updateBooking);
// "Delete / Exclude" a booking — SOFT delete (status → 'cancelled').
router.delete('/:id',                     requireAuth, ctrl.cancelBooking);

module.exports = router;