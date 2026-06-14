'use strict';

const express     = require('express');
const ctl         = require('../controllers/support.controller');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

router.use(requireAuth);

router.post('/cases', ctl.openTicket);
router.get('/cases', ctl.listMyTickets);
router.get('/cases/:id', ctl.getTicket);
router.post('/cases/:id/messages', ctl.sendMessage);
router.post('/cases/:id/close', ctl.closeTicket);

module.exports = router;
