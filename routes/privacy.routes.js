'use strict';

const express     = require('express');
const ctl         = require('../controllers/privacy.controller');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

router.use(requireAuth);

router.get('/export', ctl.exportMyData);
router.post('/delete', ctl.requestAccountDeletion);
router.post('/delete/cancel', ctl.cancelAccountDeletion);

router.get('/sessions', ctl.listMySessions);
router.delete('/sessions/:id', ctl.revokeSession);
router.delete('/sessions', ctl.revokeAllOtherSessions);

router.get('/preferences', ctl.getPreferences);
router.patch('/preferences', ctl.setPreferences);

module.exports = router;
