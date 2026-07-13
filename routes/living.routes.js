'use strict';

/**
 * living.routes — connected "Roommate Wallet" (Household) API.
 * All routes require auth; every handler is scoped to the caller's household.
 */

const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const ctrl = require('../controllers/living.controller');

router.use(requireAuth);

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

module.exports = router;
