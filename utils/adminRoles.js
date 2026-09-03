'use strict';

/**
 * adminRoles — the admin role vocabulary plus the guards that protect it.
 *
 * These rails used to live only in admin.team.controller, so the OTHER role
 * editor — PUT /api/admin/users/:id/role, behind the User Management dropdown —
 * could do things the Admin Team page carefully forbids: demote the last super
 * admin, or demote yourself. Either one permanently locks the platform out of
 * its own admin tooling, because /api/admin/team/* is super-admin-only.
 *
 * Both endpoints now share assertRoleChangeAllowed(), so there is one place to
 * read (and one place to change) the answer to "is this role change safe?".
 */

const ApiError = require('./ApiError');

const ADMIN_ROLES = ['support_agent', 'moderator', 'super_admin'];
const ADMIN_ROLE_SET = new Set(ADMIN_ROLES);

const isAdminRole = (r) => ADMIN_ROLE_SET.has(r);

/**
 * A user's effective roles. `roles[]` is the source of truth; the singular
 * `role` is the legacy fallback for accounts that predate the array.
 */
const rolesOf = (u) =>
  (Array.isArray(u?.roles) && u.roles.length ? u.roles : (u?.role ? [u.role] : []));

/**
 * Super admin via EITHER field. Some legacy accounts carry
 * `role: 'super_admin'` while `roles[]` never got synced, and checking only one
 * field is how a super admin ends up looking demotable.
 */
const isSuperAdmin = (u) => [u?.role, ...rolesOf(u)].includes('super_admin');

/** Counted via EITHER field, for the same reason. */
const countSuperAdmins = () => {
  const User = require('../models/User');
  return User.countDocuments({ $or: [{ roles: 'super_admin' }, { role: 'super_admin' }] });
};

/**
 * Swap a user's admin role while PRESERVING their base roles (tenant/landlord).
 *
 * Base roles are earned — `landlord` comes from passing landlord KYC — so they
 * must survive an admin-role change. Rebuilding the array from scratch is how
 * flipping someone to "Tenant" used to silently revoke a verified landlord.
 */
function withRole(user, nextRole) {
  const base = rolesOf(user).filter((r) => !isAdminRole(r));
  const roles = new Set(base.length ? base : ['tenant']);
  roles.add(nextRole);
  return [...roles];
}

/**
 * Throw unless `actor` may set `target`'s role to `nextRole`.
 *
 * Two rails, both about not losing access to the platform:
 *   - You cannot change your own role (no self-lockout, no self-promotion).
 *   - The last super admin can never be demoted — someone must always be able
 *     to administer the platform.
 *
 * Error codes match what the admin console already maps to friendly copy.
 */
async function assertRoleChangeAllowed(actor, target, nextRole) {
  if (String(target._id) === String(actor._id)) {
    throw ApiError.badRequest('আপনি নিজের রোল পরিবর্তন করতে পারবেন না।', {
      code: 'cannot_modify_self',
    });
  }

  if (isSuperAdmin(target) && nextRole !== 'super_admin' && (await countSuperAdmins()) <= 1) {
    throw ApiError.conflict('শেষ সুপার অ্যাডমিনকে ডিমোট করা যাবে না।', {
      code: 'last_super_admin',
    });
  }
}

module.exports = {
  ADMIN_ROLES,
  isAdminRole,
  rolesOf,
  isSuperAdmin,
  countSuperAdmins,
  withRole,
  assertRoleChangeAllowed,
};
