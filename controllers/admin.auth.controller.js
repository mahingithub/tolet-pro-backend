'use strict';

/**
 * admin.auth.controller — endpoints backing the standalone admin console's
 * dedicated login flow (mounted at /api/admin/auth). These are intentionally
 * separate from the public auth controller so the admin surface can evolve its
 * own policy (shorter sessions, stricter RBAC, audit hooks) without touching
 * the consumer app's auth.
 */

const authService = require('../services/auth.service');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Shape the admin object sent to the client — never leak password/session
// internals or brute-force counters.
function toAdminDTO(user) {
  const roles = Array.isArray(user.roles) && user.roles.length
    ? user.roles
    : (user.role ? [user.role] : []);
  return {
    id: user._id.toString(),
    name: user.name,
    phone: user.phone,
    email: user.email || '',
    avatar: user.avatar || '',
    role: user.role,
    roles,
  };
}

// POST /api/admin/auth/login  { phone, password }
exports.login = asyncH(async (req, res) => {
  const { token, user } = await authService.adminLogin({
    phone: req.body.phone,
    password: req.body.password,
    device: req.headers['user-agent'] || 'Unknown device',
    ipAddress: req.ip || '0.0.0.0',
  });
  res.json({ token, admin: toAdminDTO(user) });
});

// GET /api/admin/auth/me  (requireAdminAuth) — validate token + hydrate admin.
exports.me = asyncH(async (req, res) => {
  res.json({ admin: toAdminDTO(req.user) });
});

// POST /api/admin/auth/logout (requireAdminAuth) — revoke THIS session so the
// token can't be replayed after logout (session check in requireAdminAuth).
exports.logout = asyncH(async (req, res) => {
  if (req.sessionId && Array.isArray(req.user.sessions)) {
    req.user.sessions = req.user.sessions.filter((s) => s.sessionId !== req.sessionId);
    await req.user.save();
  }
  res.json({ ok: true });
});
