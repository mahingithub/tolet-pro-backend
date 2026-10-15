'use strict';

/**
 * admin.team.controller — the "who is an admin" surface.
 *
 * Lets a SUPER ADMIN designate other users as admins/sub-admins and revoke
 * that access, create a staff login outright (phone + optional email +
 * password), and set a new password for a team member who forgot theirs. Every route here is gated by requireAdminAuth + requireSuperAdmin
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

const bcrypt = require('bcryptjs');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');
const auditLog = require('../services/auditLog.service');
const refreshTokenService = require('../services/refreshToken.service');
const { normalizePhone } = require('../utils/phone');
// Shared with admin.controller's PUT /users/:id/role — the other role editor —
// so both enforce the same self-lockout and last-super-admin rails.
const {
  ADMIN_ROLES, isAdminRole, rolesOf, isSuperAdmin, countSuperAdmins,
  withRole, assertRoleChangeAllowed, assertAdminEmailFree,
} = require('../utils/adminRoles');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

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

  await assertRoleChangeAllowed(req.user, user, role);
  // Their email becomes a console login — it can't be another admin's.
  await assertAdminEmailFree(user.email, user._id);

  user.roles = withRole(user, role);
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

const MIN_PASSWORD = 8;

function cleanEmail(raw) {
  const e = String(raw || '').trim().toLowerCase();
  if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    throw ApiError.badRequest('ইমেইল সঠিক নয়।', { code: 'invalid_email' });
  }
  return e.slice(0, 254);
}

function assertPassword(pw) {
  if (String(pw || '').length < MIN_PASSWORD) {
    throw ApiError.badRequest(`পাসওয়ার্ড কমপক্ষে ${MIN_PASSWORD} অক্ষরের হতে হবে।`, { code: 'weak_password' });
  }
}


// POST /api/admin/team/create  { name, phone, email?, password, role }
// A staff login made by the super admin. They sign in to the console with the
// phone or the email and this password, then change the password themselves
// (Account settings). Someone who already has an app account is promoted with
// /grant instead — one person, one account.
exports.createAdmin = asyncH(async (req, res) => {
  const { name, phone, email, password, role } = req.body || {};
  const cleanName = String(name || '').trim();
  if (cleanName.length < 2) throw ApiError.badRequest('নাম কমপক্ষে ২ অক্ষরের হতে হবে।', { code: 'invalid_name' });
  const e164 = normalizePhone(phone);
  if (!e164) throw ApiError.badRequest('ফোন নম্বর সঠিক নয় (যেমন 01712345678)।', { code: 'invalid_phone' });
  if (!isAdminRole(role)) throw ApiError.badRequest('অবৈধ অ্যাডমিন রোল।', { code: 'invalid_role' });
  assertPassword(password);
  const mail = cleanEmail(email);

  if (await User.exists({ phone: e164 })) {
    throw ApiError.conflict('এই নম্বরে আগে থেকেই একটি অ্যাকাউন্ট আছে — উপরের সার্চ থেকে তাকে রোল দিন।', { code: 'phone_taken' });
  }
  await assertAdminEmailFree(mail);

  const user = await User.create({
    name: cleanName.slice(0, 80),
    phone: e164,
    email: mail,
    password: await bcrypt.hash(String(password), env.bcryptRounds),
    role,
    roles: [role],
    // The super admin vouches for this number; there is no OTP step for staff.
    phoneVerified: true,
  });

  await auditLog.safeLog(auditLog.logAdminAction, req, {
    action: 'admin.create',
    targetType: 'admin',
    targetId: String(user._id),
    targetName: user.name,
    description: `Created ${role} account for ${user.name} (${e164}${mail ? `, ${mail}` : ''})`,
    metadata: { role },
  });
  res.status(201).json({ admin: pickAdmin(user) });
});

// POST /api/admin/team/:id/password  { password } — for a team member who
// forgot theirs. Signs them out everywhere. Your own password is changed in
// Account settings, where the current one is asked for.
exports.setAdminPassword = asyncH(async (req, res) => {
  const { password } = req.body || {};
  assertPassword(password);
  if (String(req.params.id) === String(req.user._id)) {
    throw ApiError.badRequest('নিজের পাসওয়ার্ড অ্যাকাউন্ট সেটিংস থেকে বদলান।', { code: 'cannot_modify_self' });
  }
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('ইউজার পাওয়া যায়নি।', { code: 'user_not_found' });
  if (!rolesOf(user).some(isAdminRole) && !isAdminRole(user.role)) {
    throw ApiError.badRequest('শুধু অ্যাডমিন টিমের সদস্যের পাসওয়ার্ড এখান থেকে সেট করা যায়।', { code: 'not_admin' });
  }

  user.password = await bcrypt.hash(String(password), env.bcryptRounds);
  user.passwordChangedAt = new Date();
  user.sessions = [];
  await user.save();
  await refreshTokenService.revokeAllUserTokens(user._id);

  await auditLog.safeLog(auditLog.logAdminAction, req, {
    action: 'admin.password.reset',
    targetType: 'admin',
    targetId: String(user._id),
    targetName: user.name,
    description: `Super admin set a new password for ${user.name}; all their sessions were signed out`,
    metadata: { allSessionsRevoked: true },
  });
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
