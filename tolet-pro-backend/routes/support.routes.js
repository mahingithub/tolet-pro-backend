'use strict';

const express     = require('express');
const ctl         = require('../controllers/support.controller');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

router.use(requireAuth);

router.post('/tickets', ctl.openTicket);
router.get('/tickets', ctl.listMyTickets);
router.get('/tickets/:id', ctl.getTicket);
router.post('/tickets/:id/messages', ctl.sendMessage);
router.post('/tickets/:id/close', ctl.closeTicket);

module.exports = router;
