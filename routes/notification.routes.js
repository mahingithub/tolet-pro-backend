'use strict';

const express     = require('express');
const ctl         = require('../controllers/notification.controller');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

router.use(requireAuth);

router.get('/',              ctl.list);
router.get('/unread-count',  ctl.unreadCount);
router.post('/read-all',     ctl.markAllRead);
// Phase Call-6: FCM device + call-notification preference
router.post('/register-device',   ctl.registerDevice);
router.post('/unregister-device', ctl.unregisterDevice);
router.post('/call-pref',         ctl.setCallNotifications);
router.post('/:id/read',     ctl.markRead);
router.delete('/:id',        ctl.remove);

module.exports = router;
