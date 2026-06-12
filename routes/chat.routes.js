'use strict';

const express     = require('express');
const ctl         = require('../controllers/chat.controller');
const requireAuth = require('../middleware/requireAuth');
const verifyConversationAccess = require('../middleware/verifyConversationAccess');
const { uploadSingle } = require('../middleware/uploadMiddleware');

const router = express.Router();

router.use(requireAuth);

router.get ('/',                  ctl.listConversations);
router.post('/open',              verifyConversationAccess, ctl.openConversation);

router.get ('/messages/missed',   ctl.getMissedMessagesCount);

router.get ('/:id/messages',      verifyConversationAccess, ctl.listMessages);
router.post('/:id/messages',      verifyConversationAccess, ctl.sendMessage);
router.post('/:id/media',         verifyConversationAccess, uploadSingle, ctl.sendMedia);
router.post('/:id/read',          verifyConversationAccess, ctl.markRead);

module.exports = router;
