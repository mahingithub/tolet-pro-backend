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
const teamCtl = require('../controllers/admin.team.controller');
const requireAdminAuth = require('../middleware/requireAdminAuth');
const requireSuperAdmin = require('../middleware/requireSuperAdmin');

const router = express.Router();

// Every endpoint below is admin-only and consumed by the standalone admin
// console. requireAdminAuth demands an admin-scoped token (audience
// 'tolet-pro-admin'), re-checks the live role, and enforces session/ban — so
// a public-app token can never reach these handlers.
router.use(requireAdminAuth);

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
router.post('/users/:id/suspect',           ctl.suspectUser);
router.post('/users/:id/unsuspect',         ctl.unsuspectUser);
router.put ('/users/:id/role',              ctl.updateUserRole);
router.delete('/users/:id',                 ctl.deleteUser);

// ─── User reports (abuse reports raised from chat) ──────────────────────────
router.get ('/reports',                     ctl.listReports);
router.post('/reports/:id/status',          ctl.updateReportStatus);

// ─── Property moderation ───────────────────────────────────────────────────
// /api/admin/properties               — list all listings (filterable)
// /api/admin/properties/:id/moderate  — { action: 'approve'|'reject'|'remove' }
// /api/admin/properties/:id           — DELETE permanently
router.get ('/properties',                  ctl.listAllProperties);
router.post('/properties/:id/moderate',     ctl.moderateProperty);
router.delete('/properties/:id',            ctl.deleteProperty);

// ─── Admin team management (SUPER ADMIN ONLY) ───────────────────────────────
// Designate other users as admins/sub-admins and revoke that access. The
// extra requireSuperAdmin gate means a support_agent/moderator can reach the
// rest of the console but never manage the admin team.
router.get ('/team',                        requireSuperAdmin, teamCtl.listTeam);
router.get ('/team/candidates',             requireSuperAdmin, teamCtl.searchCandidates);
router.post('/team/grant',                  requireSuperAdmin, teamCtl.grantAdmin);
router.put ('/team/:id/role',               requireSuperAdmin, teamCtl.updateAdminRole);
router.post('/team/:id/revoke',             requireSuperAdmin, teamCtl.revokeAdmin);

module.exports = router;
