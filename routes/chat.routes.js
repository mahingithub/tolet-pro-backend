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
// Presence for a comma-separated list of peer ids (?ids=a,b,c). No :id param,
// so this must sit BEFORE the /:id routes below.
router.get ('/presence',          ctl.getPresence);

// Forward a message into THIS conversation (:id = target). Placed before the
// generic /:id/messages POST is not required (different path), but kept grouped.
router.post  ('/:id/messages/forward',     verifyConversationAccess, ctl.forwardMessage);

router.get   ('/:id/messages',             verifyConversationAccess, ctl.listMessages);
router.post  ('/:id/messages',             verifyConversationAccess, ctl.sendMessage);
// Delete-for-everyone. `:id` is the conversation id (matches the middleware,
// which reads req.params.id) → full path: DELETE /api/conversations/:id/messages/:messageId
router.delete('/:id/messages/:messageId',  verifyConversationAccess, ctl.deleteMessage);
router.post  ('/:id/messages/:messageId/react', verifyConversationAccess, ctl.reactMessage);
router.post  ('/:id/messages/:messageId/pin',   verifyConversationAccess, ctl.pinMessage);
router.post  ('/:id/media',                verifyConversationAccess, uploadSingle, ctl.sendMedia);
router.post  ('/:id/read',                 verifyConversationAccess, ctl.markRead);

// ── Contact-level actions (block / mute / report) ──────────────────────────
router.post  ('/:id/block',                verifyConversationAccess, ctl.blockConversation);
router.post  ('/:id/unblock',              verifyConversationAccess, ctl.unblockConversation);
router.post  ('/:id/mute',                 verifyConversationAccess, ctl.muteConversation);
router.post  ('/:id/report',               verifyConversationAccess, ctl.reportConversation);

module.exports = router;
