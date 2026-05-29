'use strict';

/**
 * requireAdmin — middleware that lets a request through only if
 * req.user.role is one of the privileged roles. Always pair it with
 * requireAuth (which populates req.user from the JWT) — without that
 * this middleware can't tell who's calling.
 *
 * Usage:
 *   router.use(requireAuth);
 *   router.use(requireAdmin);
 */

const ADMIN_ROLES = new Set(['support_agent', 'moderator', 'super_admin']);

function requireAdmin(req, res, next) {
  const role = req.user?.role;
  if (!role || !ADMIN_ROLES.has(role)) {
    return res.status(403).json({
      message: 'Admin access required.',
      code: 'admin_required',
    });
  }
  return next();
}

module.exports = requireAdmin;
