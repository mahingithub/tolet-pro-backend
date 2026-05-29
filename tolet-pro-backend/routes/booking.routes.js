'use strict';

const express    = require('express');
const ctrl       = require('../controllers/booking.controller');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// All routes require authentication.
router.post('/',                          requireAuth, ctrl.createBooking);
router.get('/host',                       requireAuth, ctrl.listHostBookings);
router.get('/tenant',                     requireAuth, ctrl.listTenantBookings);
router.patch('/:id/ledger/:monthKey',     requireAuth, ctrl.updateLedger);
router.delete('/:id/ledger/:monthKey',    requireAuth, ctrl.undoLedger);
router.patch('/:id',                      requireAuth, ctrl.updateBooking);

module.exports = router;
