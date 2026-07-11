'use strict';

const ApiError = require('../utils/ApiError');

/**
 * requireSuperAdmin — narrows access to super_admins only.
 *
 * MUST run AFTER requireAdminAuth (which verifies the admin token, loads
 * req.user, and enforces that the caller holds *some* admin role). This gate
 * is for the highest-privilege actions — chiefly the admin-team management
 * endpoints, where one admin grants/revokes admin access for others. A
 * support_agent or moderator hitting these gets a clean 403.
 */
module.exports = function requireSuperAdmin(req, _res, next) {
  const roles = Array.isArray(req.user?.roles) && req.user.roles.length
    ? req.user.roles
    : (req.user?.role ? [req.user.role] : []);

  if (!roles.includes('super_admin')) {
    return next(
      ApiError.forbidden('শুধুমাত্র সুপার অ্যাডমিন এই কাজ করতে পারে।', {
        code: 'super_admin_required',
      }),
    );
  }
  return next();
};
