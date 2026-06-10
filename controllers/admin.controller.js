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
      verification:     tp.verification     || {},
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
      trustScore:       lp.trustScore       ?? 0,
      trustTier:        lp.trustTier        || 'bronze',
    },
  };
}

// ─── GET /api/admin/overview ────────────────────────────────────────────────
// Real numbers for the dashboard. Replaces the hard-coded "2,845 users"
// placeholder shown in AdminOverview.jsx.
async function getOverview(req, res, next) {
  try {
    const Property = require('../models/Property');
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
    ]);

    // "Pending moderation" surfaced on the overview is the sum of: tenant
    // KYC awaiting admin review + landlord KYC awaiting admin review.
    // (Listing moderation will be added once that flow exists; today
    // listings don't transition through a 'pending' state.)
    const pendingModeration = pendingKyc + pendingLandlordKyc;

    return res.json({
      stats: {
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
        // Revenue is wired up once the subscription / billing pipeline
        // exists. Until then we return 0 honestly rather than fake a number.
        monthlyRevenueFormatted: '৳ 0',
      },
    });
  } catch (err) {
    return next(err);
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

    user.isBanned  = false;
    user.banReason = '';
    user.bannedAt  = null;
    user.bannedBy  = null;
    await user.save();

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

    return res.json({ message: 'Property permanently deleted', id });
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

    // Cascade delete their properties
    const Property = require('../models/Property');
    await Property.deleteMany({ ownerId: id });

    // Delete the user
    await User.findByIdAndDelete(id);

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
  listAllProperties,
  moderateProperty,
  deleteProperty,
  deleteUser,
};
