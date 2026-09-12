'use strict';

/**
 * ledger.routes.js — mounted at /api/ledger.
 *
 * তালি খাতা: the shopkeeper's own credit book and daily cash page. Everything
 * here is private to one merchant — there is no shared ledger, no double entry
 * and nothing a tenant or an admin can read.
 *
 *   GET  /summary                 পাবেন / দেবেন + today's বিক্রি ও খরচ
 *   GET  /parties                 ?q= ?owing=1
 *   POST /parties                 create (returns the existing page on a
 *                                 duplicate phone rather than a rival one)
 *   GET  /parties/:id             the page + its lines
 *   PATCH /parties/:id            name, phone, note, reminder consent
 *   POST /parties/:id/remind      gated — see ledger.controller → canRemind
 *   GET  /entries                 ?dayKey= ?kind= ?cashOnly=1
 *   POST /entries                 দিলাম / পেলাম / বিক্রি / খরচ
 *   POST /entries/:id/void        crossed out, never erased
 */

const express = require('express');

const requireMerchantAuth = require('../middleware/requireMerchantAuth');
const ctl = require('../controllers/ledger.controller');

const router = express.Router();

// The whole book belongs to the merchant making the request. The controller
// re-checks ownership on every document; this establishes who is asking.
router.use(requireMerchantAuth);

router.get('/summary', ctl.summary);

// Literal sub-paths before '/:id' would ever be asked to match them.
router.get('/parties', ctl.listParties);
router.post('/parties', ctl.createParty);
router.get('/parties/:id', ctl.getParty);
router.patch('/parties/:id', ctl.updateParty);
router.post('/parties/:id/remind', ctl.remind);

router.get('/entries', ctl.listEntries);
router.post('/entries', ctl.createEntry);
router.post('/entries/:id/void', ctl.voidEntry);

module.exports = router;
