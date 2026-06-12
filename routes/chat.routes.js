'use strict';

const express     = require('express');
const ctl         = require('../controllers/chat.controller');
const requireAuth = require('../middleware/requireAuth');
const { uploadSingle } = require('../middleware/uploadMiddleware');

const router = express.Router();

router.use(requireAuth);

router.get ('/',                  ctl.listConversations);
router.post('/open',              ctl.openConversation);

router.get ('/messages/missed',  ctl.getMissedMessagesCount);

router.get ('/:id/messages',      ctl.listMessages);
router.post('/:id/messages',      ctl.sendMessage);
router.post('/:id/media',         uploadSingle, ctl.sendMedia);
router.post('/:id/read',          ctl.markRead);

module.exports = router;
