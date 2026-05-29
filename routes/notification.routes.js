'use strict';

const express     = require('express');
const ctl         = require('../controllers/notification.controller');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

router.use(requireAuth);

router.get('/',              ctl.list);
router.get('/unread-count',  ctl.unreadCount);
router.post('/read-all',     ctl.markAllRead);
router.post('/:id/read',     ctl.markRead);

module.exports = router;
