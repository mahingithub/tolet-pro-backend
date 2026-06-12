const express = require('express');
const router = express.Router();
const pushController = require('../controllers/push.controller');
const requireAuth = require('../middleware/requireAuth');

router.post('/subscribe', requireAuth, pushController.subscribe);
router.delete('/subscribe', requireAuth, pushController.unsubscribe);

module.exports = router;
