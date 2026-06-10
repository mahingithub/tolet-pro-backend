'use strict';

/**
 * Admin routes. Every route is protected by requireAuth + requireAdmin
 * so anyone who isn't a 'support_agent' / 'moderator' / 'super_admin'
 * gets a 403 — the auth gate sits at the router level so individual
 * handlers don't have to repeat the check.
 *
 * Mount in src/server.js:
 *   app.use('/api/admin', require('./routes/admin.routes'));
 */

const express = require('express');
const ctl = require('../controllers/admin.controller');
const requireAuth  = require('../middleware/requireAuth');
const requireAdmin = require('../middleware/requireAdmin');

const router = express.Router();

// Every endpoint below is admin-only.
router.use(requireAuth);
router.use(requireAdmin);

// ─── Dashboard ──────────────────────────────────────────────────────────────
router.get('/overview', ctl.getOverview);

// ─── Tenant identity verification (NID + photo + profession proof) ──────────
// Queue + approve/reject for the personal identity submission. Approving
// here does NOT grant the landlord role — that's a separate flow below.
router.get ('/users',                                ctl.listUsers);
router.get ('/users/pending-verification',           ctl.listPendingVerification);
router.post('/users/:id/verify',                     ctl.verifyUser);
router.post('/users/:id/reject',                     ctl.rejectUser);

// ─── Landlord property verification (address + utility bill) ────────────────
// Approving here grants the landlord role and the "Verified Landlord"
// badge. Reachable to any user — whether they hold the landlord role
// already or are signing up landlord-first.
router.get ('/users/pending-landlord-verification',  ctl.listPendingLandlordVerification);
router.post('/users/:id/verify-landlord',            ctl.verifyLandlord);
router.post('/users/:id/reject-landlord',            ctl.rejectLandlord);

// ─── Account moderation ────────────────────────────────────────────────────
router.post('/users/:id/ban',               ctl.banUser);
router.post('/users/:id/unban',             ctl.unbanUser);
router.delete('/users/:id',                 ctl.deleteUser);

// ─── Property moderation ───────────────────────────────────────────────────
// /api/admin/properties               — list all listings (filterable)
// /api/admin/properties/:id/moderate  — { action: 'approve'|'reject'|'remove' }
// /api/admin/properties/:id           — DELETE permanently
router.get ('/properties',                  ctl.listAllProperties);
router.post('/properties/:id/moderate',     ctl.moderateProperty);
router.delete('/properties/:id',            ctl.deleteProperty);

module.exports = router;
