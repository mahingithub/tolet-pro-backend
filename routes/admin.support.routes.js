'use strict';

const express      = require('express');
const ctl          = require('../controllers/admin.support.controller');
const requireAuth  = require('../middleware/requireAuth');
const requireAdmin = require('../middleware/requireAdmin');

const router = express.Router();

router.use(requireAuth, requireAdmin);

router.get('/tickets', ctl.listAllTickets);
router.get('/tickets/:id', ctl.getTicketWithContext);
router.post('/tickets/:id/messages', ctl.sendAdminMessage);
router.post('/tickets/:id/assign', ctl.assignTicket);
router.post('/tickets/:id/resolve', ctl.resolveTicket);
router.post('/tickets/:id/reopen', ctl.reopenTicket);

module.exports = router;
