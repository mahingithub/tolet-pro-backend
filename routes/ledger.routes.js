'use strict';

/**
 * ledger.routes.js — mounted at /api/ledger.
 *
 * তালি খাতা: the shopkeeper's own credit book and daily cash page. Everything
 * here is private to one merchant — there is no shared ledger, no double entry
 * and nothing a tenant or an admin can read.
 *
 *   GET  /summary                 পাবেন / দেবেন + today's বিক্রি ও খরচ
 *   PATCH /settings               { autoReminders } — the shop-wide kill switch
 *   GET  /report                  ?from= ?to= — period totals, cash, receivable
 *   GET  /parties                 ?q= ?owing=1
 *   GET  /parties/:id/statement   ?from= ?to= — opening, running balance, closing
 *   POST /parties/:id/statement/send  WhatsApp it to the customer
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
// Shop-wide switches. Today: the kill for automated reminders.
router.patch('/settings', ctl.updateSettings);
// The period page: totals, cash position and what the book is owed, over any
// date range rather than only today.
router.get('/report', ctl.report);

// Literal sub-paths before '/:id' would ever be asked to match them.
router.get('/parties', ctl.listParties);
router.post('/parties', ctl.createParty);
router.get('/parties/:id', ctl.getParty);
// Opening balance, every line with the balance AFTER it, closing balance —
// the page he turns the phone around to show the customer.
router.get('/parties/:id/statement', ctl.partyStatement);
// The same statement, sent to the customer over WhatsApp — written from HIS
// side of the counter, not the shopkeeper's. See the controller.
router.post('/parties/:id/statement/send', ctl.sendStatement);
router.patch('/parties/:id', ctl.updateParty);
router.post('/parties/:id/remind', ctl.remind);

router.get('/entries', ctl.listEntries);
router.post('/entries', ctl.createEntry);
router.post('/entries/:id/void', ctl.voidEntry);

module.exports = router;
