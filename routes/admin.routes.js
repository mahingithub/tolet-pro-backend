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
const usageCtl = require('../controllers/admin.usage.controller');
const subCtl = require('../controllers/admin.subscription.controller');
const teamCtl = require('../controllers/admin.team.controller');
const providerCtl = require('../controllers/admin.provider.controller');
const sellInterestCtl = require('../controllers/sellInterest.controller');
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

// ─── Feature usage tracking ────────────────────────────────────────────────
// How many landlords run the management system, how many buildings it keeps,
// and how many people are on each Living wallet (share vs solo). Counts only —
// the handler never projects an identity (see admin.usage.controller.js).
router.get('/usage', usageCtl.getUsage);

// ─── "Interested in selling" demand gauge (Coming Soon lead capture) ────────
// Count of people who tapped "I am interested in selling my property" + a
// recent follow-up list for the agency.
router.get('/sell-interest', sellInterestCtl.getStats);

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
// Role changes are super-admin-only, gated here rather than inside the handler
// so it reads the same way as /team below. The handler additionally refuses to
// let you change your own role or demote the last super admin.
router.put ('/users/:id/role',              requireSuperAdmin, ctl.updateUserRole);
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

// ─── Service provider verification ─────────────────────────────────────────
// The ONE point at which admin touches a provider. Identity is checked once,
// the registration fee is confirmed once, and after that every order runs
// provider↔tenant with nobody in between — nothing here is reachable per
// transaction, which is what stops the marketplace being capped by the size of
// the support team.
//
// NOTE the mount order: '/providers/stats' is declared BEFORE '/providers/:id',
// or Express matches "stats" as an id and the queue header 404s.
router.get ('/providers/stats',             providerCtl.getStats);
router.get ('/providers',                   providerCtl.listProviders);
router.get ('/providers/:id',               providerCtl.getProvider);
router.post('/providers/:id/approve',       providerCtl.approve);
router.post('/providers/:id/reject',        providerCtl.reject);
router.post('/providers/:id/payment',       providerCtl.confirmPayment);
router.post('/providers/:id/suspend',       providerCtl.suspend);
router.post('/providers/:id/unsuspend',     providerCtl.unsuspend);

// ─── Subscriptions + marketing ─────────────────────────────────────────────
// The plan/reachability table and the multi-channel "special offer" blast.
// Sending is gated to super admins: it spends real money (SMS) and reaches
// users outside the app, so it is not something a support agent should be
// able to trigger. Reading the table stays open to the whole console.
//
// NOTE the mount order: the two literal sub-paths are declared BEFORE
// '/subscriptions' would ever be asked to match them. Express matches in
// declaration order, and '/subscriptions/targets' is a different path from
// '/subscriptions', so this is not strictly required today — but adding a
// '/subscriptions/:id' route later would swallow both if they sat below it.
router.get ('/subscriptions/targets',    subCtl.listCampaignTargets);
router.get ('/subscriptions/links',      subCtl.listCampaignLinks);
router.get ('/subscriptions',            subCtl.listSubscriptions);
router.post('/subscriptions/send-offer', requireSuperAdmin, subCtl.sendOffer);

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
