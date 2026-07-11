'use strict';

/**
 * admin.team.controller — the "who is an admin" surface.
 *
 * Lets a SUPER ADMIN designate other users as admins/sub-admins and revoke
 * that access. Every route here is gated by requireAdminAuth + requireSuperAdmin
 * (see routes/admin.routes.js), so each handler can assume the caller is a
 * super_admin.
 *
 * Role model: a user has base roles (tenant/landlord) plus at most ONE admin
 * role. The admin roles, from least to most privileged:
 *   support_agent  → sub-admin: support tickets + AI guides
 *   moderator      → sub-admin: listing/user/report moderation
 *   super_admin    → full access, incl. managing the admin team
 *
 * Safety rails baked in:
 *   - You cannot change or revoke your OWN admin role (no self-lockout).
 *   - The LAST super_admin can never be demoted or revoked (platform can
 *     always be administered).
 * Both are also enforced live on every request by requireAdminAuth (which
 * re-reads the user's roles), so a revoked admin loses access immediately.
 */

const User = require('../models/User');
const ApiError = require('../utils/ApiError');

const ADMIN_ROLES = ['support_agent', 'moderator', 'super_admin'];
const isAdminRole = (r) => ADMIN_ROLES.includes(r);

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const rolesOf = (u) =>
  (Array.isArray(u.roles) && u.roles.length ? u.roles : (u.role ? [u.role] : []));

function pickAdmin(u) {
  const j = u.toJSON ? u.toJSON() : u;
  const roles = rolesOf(j);
  // Derive the admin role from BOTH the active `role` and the `roles[]` array.
  // Some legacy accounts have `role: 'super_admin'` while `roles[]` never got
  // synced — matching on both keeps them visible + correctly labelled.
  const adminRole = [j.role, ...roles].find(isAdminRole) || null;
  return {
    id: String(u._id || j.id),
    name: j.name,
    phone: j.phone,
    email: j.email || '',
    avatar: j.avatar || '',
    role: j.role,
    roles,
    adminRole,
    isBanned: !!j.isBanned,
    createdAt: j.createdAt,
    lastLoginAt: j.lastLoginAt || null,
  };
}

const isSuperAdmin = (u) => [u.role, ...rolesOf(u)].includes('super_admin');

// Count via EITHER field so a legacy `role`-only super admin still counts.
const countSuperAdmins = () =>
  User.countDocuments({ $or: [{ roles: 'super_admin' }, { role: 'super_admin' }] });

// GET /api/admin/team — everyone who currently holds an admin role (matched by
// `roles[]` OR the active `role`, so nobody with admin access is hidden).
exports.listTeam = asyncH(async (req, res) => {
  const admins = await User.find({
    $or: [{ roles: { $in: ADMIN_ROLES } }, { role: { $in: ADMIN_ROLES } }],
  }).sort({ createdAt: 1 });
  res.json({
    admins: admins.map(pickAdmin),
    currentUserId: String(req.user._id),
    superAdminCount: admins.filter(isSuperAdmin).length,
  });
});

// GET /api/admin/team/candidates?q= — search users to promote (name/phone/email).
exports.searchCandidates = asyncH(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ users: [] });

  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const users = await User.find({ $or: [{ name: rx }, { phone: rx }, { email: rx }] })
    .sort({ createdAt: -1 })
    .limit(20);
  res.json({ users: users.map(pickAdmin) });
});

/**
 * Set a user's SINGLE admin role, replacing any existing admin role and
 * preserving base roles (tenant/landlord). Shared by grant + role-change.
 * Enforces the self and last-super-admin guards.
 */
async function applyAdminRole(req, targetId, role) {
  if (!isAdminRole(role)) {
    throw ApiError.badRequest('অবৈধ অ্যাডমিন রোল।', { code: 'invalid_role' });
  }

  const user = await User.findById(targetId);
  if (!user) throw ApiError.notFound('ইউজার পাওয়া যায়নি।', { code: 'user_not_found' });

  if (String(user._id) === String(req.user._id)) {
    throw ApiError.badRequest('আপনি নিজের রোল পরিবর্তন করতে পারবেন না।', {
      code: 'cannot_modify_self',
    });
  }

  const current = rolesOf(user);
  const wasSuper = isSuperAdmin(user);
  if (wasSuper && role !== 'super_admin' && (await countSuperAdmins()) <= 1) {
    throw ApiError.conflict('শেষ সুপার অ্যাডমিনকে ডিমোট করা যাবে না।', {
      code: 'last_super_admin',
    });
  }

  const base = current.filter((r) => !isAdminRole(r));
  user.roles = [...new Set([...base, role])];
  user.role = role; // make the admin role active so their console reflects it
  await user.save();
  return user;
}

// POST /api/admin/team/grant  { userId, role } — promote a user to an admin role.
exports.grantAdmin = asyncH(async (req, res) => {
  const { userId, role } = req.body || {};
  if (!userId) throw ApiError.badRequest('userId প্রয়োজন।', { code: 'missing_user' });
  const user = await applyAdminRole(req, userId, role);
  res.json({ admin: pickAdmin(user) });
});

// PUT /api/admin/team/:id/role  { role } — change an existing admin's role.
exports.updateAdminRole = asyncH(async (req, res) => {
  const { role } = req.body || {};
  const user = await applyAdminRole(req, req.params.id, role);
  res.json({ admin: pickAdmin(user) });
});

// POST /api/admin/team/:id/revoke — strip ALL admin roles (back to base user).
exports.revokeAdmin = asyncH(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('ইউজার পাওয়া যায়নি।', { code: 'user_not_found' });

  if (String(user._id) === String(req.user._id)) {
    throw ApiError.badRequest('আপনি নিজের অ্যাডমিন অ্যাক্সেস বাতিল করতে পারবেন না।', {
      code: 'cannot_modify_self',
    });
  }

  const current = rolesOf(user);
  if (isSuperAdmin(user) && (await countSuperAdmins()) <= 1) {
    throw ApiError.conflict('শেষ সুপার অ্যাডমিনকে বাতিল করা যাবে না।', {
      code: 'last_super_admin',
    });
  }

  const base = current.filter((r) => !isAdminRole(r));
  user.roles = base.length ? [...new Set(base)] : ['tenant'];
  user.role = user.roles[0]; // guaranteed non-admin
  await user.save();
  res.json({ admin: pickAdmin(user) });
});
