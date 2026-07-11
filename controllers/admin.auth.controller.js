'use strict';

/**
 * admin.auth.controller — endpoints backing the standalone admin console's
 * dedicated login flow (mounted at /api/admin/auth). These are intentionally
 * separate from the public auth controller so the admin surface can evolve its
 * own policy (shorter sessions, stricter RBAC, audit hooks) without touching
 * the consumer app's auth.
 */

const bcrypt = require('bcryptjs');
const authService = require('../services/auth.service');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');

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

// PATCH /api/admin/auth/me (requireAdminAuth) — update the admin's own profile.
// Only name + email are editable here (phone/role are managed elsewhere).
exports.updateMe = asyncH(async (req, res) => {
  const { name, email } = req.body || {};
  const user = req.user;

  if (typeof name === 'string') {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      throw ApiError.badRequest('নাম কমপক্ষে ২ অক্ষরের হতে হবে।', { code: 'invalid_name' });
    }
    user.name = trimmed.slice(0, 80);
  }

  if (typeof email === 'string') {
    const e = email.trim().toLowerCase();
    if (e && !/^.+@.+\..+$/.test(e)) {
      throw ApiError.badRequest('ইমেইল সঠিক নয়।', { code: 'invalid_email' });
    }
    user.email = e.slice(0, 254);
  }

  await user.save();
  res.json({ admin: toAdminDTO(user) });
});

// POST /api/admin/auth/change-password (requireAdminAuth)
// { currentPassword, newPassword }. Verifies the current password, sets the
// new one, bumps passwordChangedAt, and revokes ALL sessions — so every
// existing token (including this one) dies and the admin must log in again.
exports.changePassword = asyncH(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    throw ApiError.badRequest('বর্তমান ও নতুন পাসওয়ার্ড দুটোই প্রয়োজন।', { code: 'missing_fields' });
  }
  if (String(newPassword).length < 8) {
    throw ApiError.badRequest('নতুন পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।', { code: 'weak_password' });
  }

  // req.user was loaded without the password (select:false) — reload with it.
  const user = await User.findById(req.user._id).select('+password');
  if (!user) throw ApiError.unauthorized('অ্যাকাউন্ট পাওয়া যায়নি।', { code: 'user_missing' });

  const ok = await bcrypt.compare(currentPassword, user.password);
  if (!ok) {
    throw ApiError.badRequest('বর্তমান পাসওয়ার্ড ভুল।', { code: 'wrong_password' });
  }

  user.password = await bcrypt.hash(newPassword, env.bcryptRounds);
  user.passwordChangedAt = new Date();
  user.sessions = []; // sign out everywhere for safety
  await user.save();

  res.json({ ok: true, code: 'password_changed' });
});
