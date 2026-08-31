'use strict';

/**
 * living.routes — connected "Roommate Wallet" (Household) API.
 * All routes require auth; every handler is scoped to the caller's household.
 */

const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const ctrl = require('../controllers/living.controller');
const solo = require('../controllers/livingSolo.controller');

router.use(requireAuth);

// ── solo খাতা ───────────────────────────────────────────────────────────────
// The private, single-user wallet. Mounted ahead of the household routes so
// `/solo` can never be swallowed by a `/:id` pattern added below later.
router.get('/solo', solo.getSolo);
router.post('/solo/merge', solo.mergeSolo);
router.patch('/solo', solo.updateSolo);
router.delete('/solo', solo.resetSolo);
router.post('/solo/people', solo.addPerson);
router.patch('/solo/people/:id', solo.updatePerson);
router.delete('/solo/people/:id', solo.deletePerson);
router.post('/solo/entries', solo.addEntry);
router.patch('/solo/entries/:id', solo.updateEntry);
router.delete('/solo/entries/:id', solo.deleteEntry);

// ── household ──────────────────────────────────────────────────────────────
router.get('/household', ctrl.getHousehold);
router.post('/household', ctrl.createHousehold);
router.post('/household/join', ctrl.joinHousehold);
router.post('/household/leave', ctrl.leaveHousehold);
router.post('/household/regenerate-code', ctrl.regenerateCode);
router.patch('/household', ctrl.updateHousehold);

// ── members ────────────────────────────────────────────────────────────────
router.post('/members', ctrl.addMember);
router.delete('/members/:id', ctrl.removeMember);

// ── expenses ───────────────────────────────────────────────────────────────
router.post('/expenses', ctrl.addExpense);
router.patch('/expenses/:id', ctrl.updateExpense);
router.delete('/expenses/:id', ctrl.deleteExpense);

// ── bills ──────────────────────────────────────────────────────────────────
router.post('/bills', ctrl.addBill);
router.patch('/bills/:id', ctrl.updateBill);
router.delete('/bills/:id', ctrl.deleteBill);

// ── meals ──────────────────────────────────────────────────────────────────
router.put('/meals', ctrl.setMeal);

// ── groceries ──────────────────────────────────────────────────────────────
router.post('/groceries', ctrl.addGrocery);
router.delete('/groceries/:id', ctrl.deleteGrocery);

// ── settlements ────────────────────────────────────────────────────────────
router.post('/settlements', ctrl.addSettlement);
router.delete('/settlements/:id', ctrl.deleteSettlement);

// ── mess deposits (জমা) ──────────────────────────────────────────────────────
router.post('/deposits', ctrl.addDeposit);
router.delete('/deposits/:id', ctrl.deleteDeposit);

module.exports = router;
