'use strict';

const express    = require('express');
const ctrl       = require('../controllers/receipt.controller');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

router.get('/tenant',      requireAuth, ctrl.listTenantReceipts);
router.get('/host',        requireAuth, ctrl.listHostReceipts);
router.patch('/:id/read',  requireAuth, ctrl.markReceiptRead);

module.exports = router;
