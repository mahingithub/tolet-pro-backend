'use strict';

const express      = require('express');
const ctl          = require('../controllers/admin.support.controller');
const requireAdminAuth = require('../middleware/requireAdminAuth');

const router = express.Router();

// Admin helpdesk console — admin-scoped tokens only (see requireAdminAuth).
router.use(requireAdminAuth);

router.get('/cases', ctl.listAllTickets);
router.get('/cases/:id', ctl.getTicketWithContext);
router.post('/cases/:id/messages', ctl.sendAdminMessage);
router.post('/cases/:id/assign', ctl.assignTicket);
router.post('/cases/:id/resolve', ctl.resolveTicket);
router.post('/cases/:id/reopen', ctl.reopenTicket);


module.exports = router;
