'use strict';

/**
 * Admin controller — verification approval + user moderation.
 *
 * All routes here are protected by requireAuth + requireAdmin in
 * routes/admin.routes.js, so every handler can assume req.user is a
 * 'support_agent', 'moderator', or 'super_admin'.
 *
 * Endpoints exposed here:
 *   GET   /api/admin/overview                         — dashboard stats
 *   GET   /api/admin/users                            — list with filters
 *   GET   /api/admin/users/pending-verification       — kyc queue
 *   POST  /api/admin/users/:id/verify                 — approve identity
 *   POST  /api/admin/users/:id/reject                 — reject with reason
 *   POST  /api/admin/users/:id/ban                    — soft-disable
 *   POST  /api/admin/users/:id/unban                  — re-enable
 *
 * Property moderation lives in property.controller.js — admin endpoints
 * delegate there to keep moderation logic in one place.
 */

const User = require('../models/User');
const adminRoles = require('../utils/adminRoles');
const auditLog = require('../services/auditLog.service');
const cloud = require('../services/cloudinary.service');
const cache = require('../config/redis');
const invalidate = require('../services/cacheInvalidation');

// ─── Helpers ────────────────────────────────────────────────────────────────
function pickPublicUser(u) {
  // Full admin-side view. The KYC reviewer needs more than just the
  // verification documents — they cross-check the user's profile against
  // the NID (does the name match? does the workplace look real? is the
  // emergency contact a real Bangladesh number? etc), so we expose every
  // field a reviewer plausibly needs in one payload. Sensitive auth-only
  // fields (password, firebaseUid, loginAttempts) are already stripped by
  // the schema's toJSON transform.
  const j = u.toJSON ? u.toJSON() : u;
  const tp = j.tenantProfile || {};
  const lp = j.landlordProfile || {};

  // ── Make the document URLs loadable for the reviewer ────────────────────
  // Our verification uploads are deliberately MIXED: NID scans are Cloudinary
  // `type: authenticated` (useless without a signature), while the profile
  // photo is a public `upload` asset because it doubles as the user's avatar.
  // The landlord's utility bill is public too.
  //
  // This used to call generateSignedViewUrl() on all four, which hardcoded
  // type:'authenticated'. Signing a PUBLIC asset as authenticated yields a URL
  // for an object that doesn't exist — Cloudinary returns 401/404 rather than
  // falling back — so the NID tiles rendered while the Profile Photo and
  // Utility Bill tiles came through broken. signedViewUrlFor() reads the real
  // delivery type back out of the stored URL and signs only what needs it.
  const tv = tp.verification || {};
  if (tv.nidFrontPublicId) tv.nidFrontUrl = cloud.signedViewUrlFor({ publicId: tv.nidFrontPublicId, url: tv.nidFrontUrl });
  if (tv.nidBackPublicId)  tv.nidBackUrl  = cloud.signedViewUrlFor({ publicId: tv.nidBackPublicId,  url: tv.nidBackUrl });
  if (tv.photoPublicId)    tv.photoUrl    = cloud.signedViewUrlFor({ publicId: tv.photoPublicId,    url: tv.photoUrl });

  const lv = lp.verification || {};
  if (lv.utilityBillPublicId) lv.utilityBillUrl = cloud.signedViewUrlFor({ publicId: lv.utilityBillPublicId, url: lv.utilityBillUrl });

  return {
    // ── Identity ─────────────────────────────────────────────────────
    id:             String(u._id || j.id),
    name:           j.name,
    phone:          j.phone,
    email:          j.email || '',
    avatar:         j.avatar || '',
    dateOfBirth:    j.dateOfBirth || null,

    // ── Roles + auth state ───────────────────────────────────────────
    role:           j.role,
    roles:          j.roles || [],
    phoneVerified:  !!j.phoneVerified,
    isBanned:       !!j.isBanned,
    banReason:      j.banReason || '',
    bannedAt:       j.bannedAt || null,
    // Suspected flag (softer than a ban — set from a user report).
    isSuspected:     !!j.isSuspected,
    suspectedReason: j.suspectedReason || '',
    suspectedAt:     j.suspectedAt || null,

    // ── Account meta — used by the reviewer to spot fresh signups vs
    //     long-standing users. lastLoginAt is null for first-time logins.
    createdAt:      j.createdAt,
    updatedAt:      j.updatedAt,
    lastLoginAt:    j.lastLoginAt || null,

    // ── Tenant-side profile (everything the verification reviewer needs
    //     to cross-check against the NID + supporting docs).
    tenantProfile: {
      professionType:   tp.professionType   || '',
      workPlace:        tp.workPlace        || '',
      workPlaceId:      tp.workPlaceId      || '',
      familySize:       tp.familySize       || '',
      emergencyContact: tp.emergencyContact || { name: '', phone: '', relation: '' },
      publicVisible:    tp.publicVisible !== false,
      memberSinceYear:  tp.memberSinceYear  || null,
      // The verification sub-doc already carries the Cloudinary URLs
      // and the per-doc boolean flags admins toggle through.
      verification:     tv,
      trustScore:       tp.trustScore       ?? 0,
      trustTier:        tp.trustTier        || 'bronze',
    },

    // ── Landlord-side profile. We expose it for tenants too because a
    //     user can hold both roles after verification; the admin UI just
    //     hides it when it's empty.
    landlordProfile: {
      fullName:         lp.fullName         || '',
      city:             lp.city             || '',
      address:          lp.address          || '',
      preferredTenants: lp.preferredTenants || [],
      communication:    lp.communication    || [],
      houseRules:       lp.houseRules       || [],
      serviceCharge:    lp.serviceCharge    ?? null,
      verification:     lv,
      trustScore:       lp.trustScore       ?? 0,
      trustTier:        lp.trustTier        || 'bronze',
    },
  };
}

// ─── GET /api/admin/overview ────────────────────────────────────────────────
// Real numbers for the dashboard. Replaces the hard-coded "2,845 users"
// placeholder shown in AdminOverview.jsx.
/**
 * GET /api/admin/overview — CACHE-ASIDE, 15 min TTL.
 *
 * Thirteen countDocuments in one request. On a free M0 Atlas tier an unindexed
 * count is a collection scan, and the admin dashboard polls this on every
 * visit — the single most expensive read in the app per call.
 *
 * Not user-specific: these are global platform totals, identical for every
 * admin, so one shared key serves all of them.
 *
 * ── WHY A LONG TTL IS SAFE HERE ──────────────────────────────────────────
 * The numbers move from two directions. The admin's OWN actions (verify,
 * reject, ban, role change, delete, property moderation) invalidate the key
 * explicitly, so the dashboard updates the instant they act on something —
 * which is the only freshness an admin actually perceives. Background drift
 * (anonymous sell-interest leads, cron-created records) is bounded by the TTL
 * instead, because invalidating on those would mean clearing this key on
 * ordinary public traffic and never getting a hit.
 */
async function getOverview(req, res, next) {
  try {
    const stats = await cache.getOrSet(
      cache.KEY.adminStats('default'),
      cache.TTL.ADMIN_STATS,
      () => buildOverviewStats(),
    );
    return res.json({ stats });
  } catch (err) {
    return next(err);
  }
}

async function buildOverviewStats() {
  {
    const Property = require('../models/Property');
    const SellInterest = require('../models/SellInterest');
    const [
      totalUsers,
      totalLandlords,
      totalTenants,
      pendingKyc,
      pendingLandlordKyc,
      bannedUsers,
      activeProperties,
      pausedProperties,
      rentedProperties,
      draftProperties,
      totalProperties,
      sellInterestTotal,
      sellInterestRegistered,
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ roles: 'landlord' }),
      User.countDocuments({ roles: 'tenant' }),
      User.countDocuments({ 'tenantProfile.verification.status': 'pending' }),
      User.countDocuments({ 'landlordProfile.verification.status': 'pending' }),
      User.countDocuments({ isBanned: true }),
      Property.countDocuments({ status: 'active' }),
      Property.countDocuments({ status: 'paused' }),
      Property.countDocuments({ status: 'rented' }),
      Property.countDocuments({ status: 'draft' }),
      Property.countDocuments({}),
      SellInterest.countDocuments({ kind: 'sell' }),
      SellInterest.countDocuments({ kind: 'sell', userId: { $ne: null } }),
    ]);

    // "Pending moderation" surfaced on the overview is the sum of: tenant
    // KYC awaiting admin review + landlord KYC awaiting admin review.
    // (Listing moderation will be added once that flow exists; today
    // listings don't transition through a 'pending' state.)
    const pendingModeration = pendingKyc + pendingLandlordKyc;

    return {
      totalUsers,
      totalLandlords,
      totalTenants,
      pendingKyc,
      pendingLandlordKyc,
      bannedUsers,
      activeProperties,
      pausedProperties,
      rentedProperties,
      draftProperties,
      totalProperties,
      pendingModeration,
      // "Interested in selling" demand gauge (Coming Soon lead capture).
      sellInterestTotal,
      sellInterestRegistered,
      sellInterestGuests: sellInterestTotal - sellInterestRegistered,
      
      // "Interested in services" tracking
      serviceInterestTotal: await SellInterest.countDocuments({ kind: 'service' }),

      // Revenue is wired up once the subscription / billing pipeline
      // exists. Until then we return 0 honestly rather than fake a number.
      monthlyRevenueFormatted: '৳ 0',
    };
  }
}

// ─── GET /api/admin/users ───────────────────────────────────────────────────
// Filterable user directory. Filters live in query string:
//   ?role=tenant|landlord|super_admin
//   ?banned=true|false
//   ?verification=verified|pending|rejected|unverified
//   ?search=<name|phone|email substring>
//   ?page=1&limit=50
async function listUsers(req, res, next) {
  try {
    const {
      role,
      banned,
      verification,
      search = '',
      page = 1,
      limit = 50,
    } = req.query;

    const filter = {};
    if (role)            filter.roles = role;
    if (banned === 'true')  filter.isBanned = true;
    if (banned === 'false') filter.isBanned = { $ne: true };
    if (verification)    filter['tenantProfile.verification.status'] = verification;

    if (search && String(search).trim()) {
      const rx = new RegExp(String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { phone: rx }, { email: rx }];
    }

    const skip  = (Math.max(1, Number(page)) - 1) * Math.min(200, Number(limit));
    const lim   = Math.min(200, Math.max(1, Number(limit)));

    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(lim),
      User.countDocuments(filter),
    ]);

    return res.json({
      users: users.map(pickPublicUser),
      total,
      page: Number(page),
      limit: lim,
    });
  } catch (err) {
    return next(err);
  }
}

// ─── GET /api/admin/users/pending-verification ──────────────────────────────
// The KYC queue — every user who hit "Submit for review" in the
// verification modal lands here until an admin approves or rejects.
async function listPendingVerification(req, res, next) {
  try {
    const users = await User.find({
      'tenantProfile.verification.status': 'pending',
      'tenantProfile.verification.submittedForReview': true,
    }).sort({ 'tenantProfile.verification.submittedAt': 1, createdAt: 1 });

    return res.json({ users: users.map(pickPublicUser) });
  } catch (err) {
    return next(err);
  }
}

// ─── POST /api/admin/users/:id/verify ───────────────────────────────────────
// Approves the tenant-side identity submission. Flips status to
// 'verified' and stamps audit fields so we can answer "who approved
// this and when" later. IMPORTANT: this no longer grants the landlord
// role — landlord identity is a SEPARATE submission (address + utility
// bill) that goes through verify-landlord below. The user has to opt
// in to being a landlord; we can't unlock the role just because they
// proved their personal identity.
async function verifyUser(req, res, next) {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!user.tenantProfile) user.tenantProfile = {};
    if (!user.tenantProfile.verification) user.tenantProfile.verification = {};

    user.tenantProfile.verification.status          = 'verified';
    user.tenantProfile.verification.reviewedAt      = new Date();
    user.tenantProfile.verification.reviewedBy      = req.user._id;
    user.tenantProfile.verification.rejectionReason = '';

    // Mongoose's pre-save hook on User recomputes trust score from the
    // updated verification block, so we don't have to touch it manually.
    await user.save();
    // Refresh the dashboard counts this action moved (KYC queues, landlord /
    // tenant totals, banned users). Applied to EVERY admin user write rather
    // than only the ones that provably move a number: these endpoints fire a
    // handful of times a day, so a redundant invalidation costs nothing, and
    // the alternative is a per-field audit that silently rots the moment the
    // overview starts counting another field.
    await invalidate.onAdminStatsChanged();

    // Audit log
    await auditLog.safeLog(auditLog.logUserAction, req, {
      action: 'user.verify',
      targetId: user._id.toString(),
      targetName: user.name,
      description: `Verified user ${user.name} (${user.phone})`,
      metadata: {
        previousStatus: 'pending',
        newStatus: 'verified',
      },
    });

    return res.json({ user: pickPublicUser(user) });
  } catch (err) {
    return next(err);
  }
}

// ─── GET /api/admin/users/pending-landlord-verification ─────────────────────
// Landlord KYC queue. Users land here after they submit the
// address + utility bill via /me/landlord-verification/submit.
async function listPendingLandlordVerification(req, res, next) {
  try {
    const users = await User.find({
      'landlordProfile.verification.status': 'pending',
      'landlordProfile.verification.submittedForReview': true,
    }).sort({ 'landlordProfile.verification.submittedAt': 1, createdAt: 1 });

    return res.json({ users: users.map(pickPublicUser) });
  } catch (err) {
    return next(err);
  }
}

// ─── POST /api/admin/users/:id/verify-landlord ──────────────────────────────
// Approves the landlord-side submission AND grants the landlord role.
// This is where the "Verified Landlord" badge unlocks.
async function verifyLandlord(req, res, next) {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!user.landlordProfile) user.landlordProfile = {};
    if (!user.landlordProfile.verification) user.landlordProfile.verification = {};

    user.landlordProfile.verification.status          = 'verified';
    user.landlordProfile.verification.reviewedAt      = new Date();
    user.landlordProfile.verification.reviewedBy      = req.user._id;
    user.landlordProfile.verification.rejectionReason = '';

    // Grant the landlord role NOW — they've proven property ownership.
    if (!Array.isArray(user.roles)) user.roles = [user.role || 'tenant'];
    if (!user.roles.includes('landlord')) user.roles.push('landlord');

    await user.save();
    // Refresh the dashboard counts this action moved (KYC queues, landlord /
    // tenant totals, banned users). Applied to EVERY admin user write rather
    // than only the ones that provably move a number: these endpoints fire a
    // handful of times a day, so a redundant invalidation costs nothing, and
    // the alternative is a per-field audit that silently rots the moment the
    // overview starts counting another field.
    await invalidate.onAdminStatsChanged();

    return res.json({ user: pickPublicUser(user) });
  } catch (err) {
    return next(err);
  }
}

// ─── POST /api/admin/users/:id/reject-landlord ──────────────────────────────
async function rejectLandlord(req, res, next) {
  try {
    const { id } = req.params;
    const reason = String(req.body?.reason || '').trim() || 'Documents did not meet our standards.';

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!user.landlordProfile) user.landlordProfile = {};
    if (!user.landlordProfile.verification) user.landlordProfile.verification = {};

    user.landlordProfile.verification.status             = 'rejected';
    user.landlordProfile.verification.reviewedAt         = new Date();
    user.landlordProfile.verification.reviewedBy         = req.user._id;
    user.landlordProfile.verification.rejectionReason    = reason;
    user.landlordProfile.verification.submittedForReview = false;

    await user.save();
    // Refresh the dashboard counts this action moved (KYC queues, landlord /
    // tenant totals, banned users). Applied to EVERY admin user write rather
    // than only the ones that provably move a number: these endpoints fire a
    // handful of times a day, so a redundant invalidation costs nothing, and
    // the alternative is a per-field audit that silently rots the moment the
    // overview starts counting another field.
    await invalidate.onAdminStatsChanged();
    return res.json({ user: pickPublicUser(user) });
  } catch (err) {
    return next(err);
  }
}

// ─── POST /api/admin/users/:id/reject ───────────────────────────────────────
// Sends the user back to fix something. The reason surfaces in their
// dashboard so they know what to re-upload.
async function rejectUser(req, res, next) {
  try {
    const { id } = req.params;
    const reason = String(req.body?.reason || '').trim() || 'Documents did not meet our standards.';

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!user.tenantProfile) user.tenantProfile = {};
    if (!user.tenantProfile.verification) user.tenantProfile.verification = {};

    user.tenantProfile.verification.status             = 'rejected';
    user.tenantProfile.verification.reviewedAt         = new Date();
    user.tenantProfile.verification.reviewedBy         = req.user._id;
    user.tenantProfile.verification.rejectionReason    = reason;
    user.tenantProfile.verification.submittedForReview = false;

    await user.save();
    // Refresh the dashboard counts this action moved (KYC queues, landlord /
    // tenant totals, banned users). Applied to EVERY admin user write rather
    // than only the ones that provably move a number: these endpoints fire a
    // handful of times a day, so a redundant invalidation costs nothing, and
    // the alternative is a per-field audit that silently rots the moment the
    // overview starts counting another field.
    await invalidate.onAdminStatsChanged();
    
    // Audit log
    await auditLog.safeLog(auditLog.logUserAction, req, {
      action: 'user.verify',
      targetId: user._id.toString(),
      targetName: user.name,
      description: `Rejected verification for user ${user.name} (${user.phone})`,
      metadata: {
        reason,
        previousStatus: 'pending',
        newStatus: 'rejected',
      },
    });
    
    return res.json({ user: pickPublicUser(user) });
  } catch (err) {
    return next(err);
  }
}

// ─── POST /api/admin/users/:id/ban ──────────────────────────────────────────
async function banUser(req, res, next) {
  try {
    const { id } = req.params;
    const reason = String(req.body?.reason || '').trim() || 'Violation of platform policy.';

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Block self-ban and ban of fellow super_admins — keeps the platform
    // from getting locked out of its own admin tooling.
    if (String(user._id) === String(req.user._id)) {
      return res.status(400).json({ message: "You can't ban yourself." });
    }
    if (user.role === 'super_admin') {
      return res.status(403).json({ message: "Super admins can't be banned via this endpoint." });
    }

    user.isBanned  = true;
    user.banReason = reason;
    user.bannedAt  = new Date();
    user.bannedBy  = req.user._id;
    await user.save();
    // Refresh the dashboard counts this action moved (KYC queues, landlord /
    // tenant totals, banned users). Applied to EVERY admin user write rather
    // than only the ones that provably move a number: these endpoints fire a
    // handful of times a day, so a redundant invalidation costs nothing, and
    // the alternative is a per-field audit that silently rots the moment the
    // overview starts counting another field.
    await invalidate.onAdminStatsChanged();

    // Audit log
    await auditLog.safeLog(auditLog.logUserAction, req, {
      action: 'user.ban',
      targetId: user._id.toString(),
      targetName: user.name,
      description: `Banned user ${user.name} (${user.phone})`,
      metadata: { reason },
    });

    return res.json({ user: pickPublicUser(user) });
  } catch (err) {
    return next(err);
  }
}

// ─── POST /api/admin/users/:id/unban ────────────────────────────────────────
async function unbanUser(req, res, next) {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const previousReason = user.banReason;
    
    user.isBanned  = false;
    user.banReason = '';
    user.bannedAt  = null;
    user.bannedBy  = null;
    await user.save();
    // Refresh the dashboard counts this action moved (KYC queues, landlord /
    // tenant totals, banned users). Applied to EVERY admin user write rather
    // than only the ones that provably move a number: these endpoints fire a
    // handful of times a day, so a redundant invalidation costs nothing, and
    // the alternative is a per-field audit that silently rots the moment the
    // overview starts counting another field.
    await invalidate.onAdminStatsChanged();

    // Audit log
    await auditLog.safeLog(auditLog.logUserAction, req, {
      action: 'user.unban',
      targetId: user._id.toString(),
      targetName: user.name,
      description: `Unbanned user ${user.name} (${user.phone})`,
      metadata: { previousReason },
    });

    return res.json({ user: pickPublicUser(user) });
  } catch (err) {
    return next(err);
  }
}

// ─── PUT /api/admin/users/:id/role ──────────────────────────────────────────
// The User Management dropdown. Super-admin-only (gated on the route) and now
// subject to the SAME rails as the Admin Team page: you cannot change your own
// role, and the last super admin can never be demoted.
//
// Those guards used to live only in admin.team.controller, which made this
// endpoint a way around them — one flip of this dropdown could demote the last
// super admin, and since /api/admin/team/* is itself super-admin-only, that
// locked the platform out of its own admin tooling permanently.
async function updateUserRole(req, res, next) {
  try {
    const { id } = req.params;
    const { role } = req.body;
    if (!role) {
      return res.status(400).json({ message: 'Role is required.' });
    }

    const validRoles = ['tenant', 'landlord', 'support_agent', 'moderator', 'super_admin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ message: 'Invalid role specified.' });
    }

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    await adminRoles.assertRoleChangeAllowed(req.user, user, role);

    const previousRole = user.role;

    // Base roles (tenant/landlord) survive; only the admin role is swapped.
    // Rebuilding the array from scratch is how flipping someone to "Tenant"
    // used to silently revoke a landlord who had passed landlord KYC but had
    // no landlordProfile.fullName set.
    user.roles = adminRoles.withRole(user, role);
    user.role  = role;
    await user.save();
    // Refresh the dashboard counts this action moved (KYC queues, landlord /
    // tenant totals, banned users). Applied to EVERY admin user write rather
    // than only the ones that provably move a number: these endpoints fire a
    // handful of times a day, so a redundant invalidation costs nothing, and
    // the alternative is a per-field audit that silently rots the moment the
    // overview starts counting another field.
    await invalidate.onAdminStatsChanged();

    // Audit log
    await auditLog.safeLog(auditLog.logUserAction, req, {
      action: 'user.role.change',
      targetId: user._id.toString(),
      targetName: user.name,
      description: `Changed role for user ${user.name} (${user.phone})`,
      changes: {
        before: { role: previousRole },
        after: { role: user.role },
      },
    });

    return res.json({ user: pickPublicUser(user) });
  } catch (err) {
    return next(err);
  }
}

// ─── GET /api/admin/properties ─────────────────────────────────────────────
// Property moderation queue. Without a dedicated "pending" status on
// listings (the model defaults straight to 'active'), this acts as the
// full property table for the admin. Query string filters:
//   ?status=active|paused|inactive|rented|draft
//   ?search=<title|address|location substring>
//   ?page=1&limit=50
async function listAllProperties(req, res, next) {
  try {
    const Property = require('../models/Property');
    const { status, search } = req.query;
    const page  = Math.max(1, parseInt(req.query.page, 10)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));

    const filter = {};
    if (status) filter.status = String(status).toLowerCase();
    if (search && String(search).trim()) {
      const re = new RegExp(String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { title: re },
        { address: re },
        { location: re },
        { ownerName: re },
        { ownerPhone: re },
      ];
    }

    const [items, total] = await Promise.all([
      Property.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Property.countDocuments(filter),
    ]);

    return res.json({ properties: items, total, page, limit });
  } catch (err) {
    return next(err);
  }
}

// ─── POST /api/admin/properties/:id/moderate ───────────────────────────────
// Single action endpoint for the moderation page. Body: { action }, where
// action is one of:
//   'approve' → set status to 'active'
//   'reject'  → set status to 'inactive' (removes from public search)
//   'remove'  → soft-delete (status 'inactive') and stamp moderation audit
async function moderateProperty(req, res, next) {
  try {
    const Property = require('../models/Property');
    const { id } = req.params;
    const action = String(req.body?.action || '').trim().toLowerCase();
    const reason = String(req.body?.reason || '').trim();

    const prop = await Property.findById(id);
    if (!prop) return res.status(404).json({ message: 'Property not found' });

    const nextStatus = action === 'approve'
      ? 'active'
      : (action === 'reject' || action === 'remove')
        ? 'inactive'
        : null;
    if (!nextStatus) {
      return res.status(400).json({
        message: `Unknown moderation action: ${action}`,
        code:    'unknown_action',
      });
    }

    prop.status = nextStatus;
    if (reason) {
      prop.moderationReason = reason.slice(0, 500);
    }
    prop.moderatedAt = new Date();
    prop.moderatedBy = req.user._id;

    await prop.save();

    // Moderation flips status between 'active' and 'inactive', which decides
    // whether the listing appears in public search at all — the single most
    // important thing not to serve from a stale cache. Clears the detail entry
    // (id + slug), every cached search page, and the dashboard counts.
    await invalidate.onPropertyChanged({
      id: String(prop._id),
      slug: prop.slug,
      affectsCounts: true,
    });

    return res.json({ property: prop.toJSON ? prop.toJSON() : prop });
  } catch (err) {
    return next(err);
  }
}

// ─── DELETE /api/admin/properties/:id ──────────────────────────────────────
async function deleteProperty(req, res, next) {
  try {
    const Property = require('../models/Property');
    const { id } = req.params;

    const prop = await Property.findByIdAndDelete(id);
    if (!prop) return res.status(404).json({ message: 'Property not found' });

    // NOTE: this handler deletes the document directly instead of going through
    // propertyService.purgePropertyCascade, so it does NOT inherit that
    // function's invalidation (or its child-document cleanup — a pre-existing
    // gap worth fixing separately). Invalidate explicitly here.
    await invalidate.onPropertyChanged({
      id: String(prop._id),
      slug: prop.slug,
      affectsCounts: true,
    });

    return res.json({ message: 'Property permanently deleted', id });
  } catch (err) {
    return next(err);
  }
}

// ─── GET /api/admin/reports ─────────────────────────────────────────────────
// User-abuse reports raised from chat. Filterable by ?status=open|reviewed|dismissed
// and ?search=<reporter/reported name substring>. Newest first.
async function listReports(req, res, next) {
  try {
    const Report = require('../models/Report');
    const { status, search } = req.query;
    const page  = Math.max(1, parseInt(req.query.page, 10)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));

    const filter = {};
    if (status) filter.status = String(status).toLowerCase();
    if (search && String(search).trim()) {
      const rx = new RegExp(String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ reporterName: rx }, { reportedUserName: rx }, { reason: rx }];
    }

    const [items, total, openCount] = await Promise.all([
      Report.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit),
      Report.countDocuments(filter),
      Report.countDocuments({ status: 'open' }),
    ]);

    return res.json({ reports: items.map((r) => r.toJSON()), total, openCount, page, limit });
  } catch (err) {
    return next(err);
  }
}

// ─── POST /api/admin/reports/:id/status ─────────────────────────────────────
// Body: { status: 'reviewed' | 'dismissed' | 'open' }. Stamps who reviewed it.
async function updateReportStatus(req, res, next) {
  try {
    const Report = require('../models/Report');
    const status = String(req.body?.status || '').trim().toLowerCase();
    if (!['open', 'reviewed', 'dismissed'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status.', code: 'bad_status' });
    }
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ message: 'Report not found' });

    report.status     = status;
    report.reviewedAt = status === 'open' ? null : new Date();
    report.reviewedBy = status === 'open' ? null : req.user._id;
    await report.save();

    return res.json({ report: report.toJSON() });
  } catch (err) {
    return next(err);
  }
}

// ─── POST /api/admin/users/:id/suspect ──────────────────────────────────────
// Marks a user as "suspected" (soft flag, does not block them). Reachable from
// the reports queue.
async function suspectUser(req, res, next) {
  try {
    const { id } = req.params;
    const reason = String(req.body?.reason || '').trim() || 'Flagged from a user report.';

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.role === 'super_admin') {
      return res.status(403).json({ message: "Super admins can't be flagged." });
    }

    user.isSuspected     = true;
    user.suspectedReason = reason.slice(0, 500);
    user.suspectedAt     = new Date();
    user.suspectedBy     = req.user._id;
    await user.save();
    // Refresh the dashboard counts this action moved (KYC queues, landlord /
    // tenant totals, banned users). Applied to EVERY admin user write rather
    // than only the ones that provably move a number: these endpoints fire a
    // handful of times a day, so a redundant invalidation costs nothing, and
    // the alternative is a per-field audit that silently rots the moment the
    // overview starts counting another field.
    await invalidate.onAdminStatsChanged();

    return res.json({ user: pickPublicUser(user) });
  } catch (err) {
    return next(err);
  }
}

// ─── POST /api/admin/users/:id/unsuspect ────────────────────────────────────
async function unsuspectUser(req, res, next) {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.isSuspected     = false;
    user.suspectedReason = '';
    user.suspectedAt     = null;
    user.suspectedBy     = null;
    await user.save();
    // Refresh the dashboard counts this action moved (KYC queues, landlord /
    // tenant totals, banned users). Applied to EVERY admin user write rather
    // than only the ones that provably move a number: these endpoints fire a
    // handful of times a day, so a redundant invalidation costs nothing, and
    // the alternative is a per-field audit that silently rots the moment the
    // overview starts counting another field.
    await invalidate.onAdminStatsChanged();

    return res.json({ user: pickPublicUser(user) });
  } catch (err) {
    return next(err);
  }
}

// ─── DELETE /api/admin/users/:id ───────────────────────────────────────────
async function deleteUser(req, res, next) {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (String(user._id) === String(req.user._id)) {
      return res.status(400).json({ message: "You can't delete yourself." });
    }
    if (user.role === 'super_admin') {
      return res.status(403).json({ message: "Super admins can't be deleted." });
    }

    const userName = user.name;
    const userPhone = user.phone;

    // Cascade delete their properties
    const Property = require('../models/Property');
    const deletedPropertiesCount = await Property.countDocuments({ ownerId: id });
    await Property.deleteMany({ ownerId: id });

    // Delete the user
    await User.findByIdAndDelete(id);

    // Their listings are gone from search, and totalUsers moved. Pattern-wipe
    // the search namespace because a bulk delete gives us no single id to
    // target, and drop the deleted user's own cached surfaces.
    await Promise.all([
      invalidate.onPropertyChanged({ affectsCounts: true }),
      invalidate.onUserChanged(id),
    ]);

    // Audit log
    await auditLog.safeLog(auditLog.logUserAction, req, {
      action: 'user.delete',
      targetId: id,
      targetName: userName,
      description: `Permanently deleted user ${userName} (${userPhone})`,
      metadata: {
        deletedPropertiesCount,
      },
    });

    return res.json({ message: 'User and their properties permanently deleted', id });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getOverview,
  listUsers,
  listPendingVerification,
  listPendingLandlordVerification,
  verifyUser,
  verifyLandlord,
  rejectUser,
  rejectLandlord,
  banUser,
  unbanUser,
  updateUserRole,
  listAllProperties,
  moderateProperty,
  deleteProperty,
  deleteUser,
  listReports,
  updateReportStatus,
  suspectUser,
  unsuspectUser,
};
