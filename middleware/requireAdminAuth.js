'use strict';

const User = require('../models/User');
const tokenService = require('../services/token.service');
const ApiError = require('../utils/ApiError');

// Must stay in sync with services/auth.service ADMIN_ROLES and
// middleware/requireAdmin.
const ADMIN_ROLES = new Set(['support_agent', 'moderator', 'super_admin']);

/**
 * requireAdminAuth — the single gate for the standalone admin console.
 *
 * It replaces the old `requireAuth + requireAdmin` pair on admin routes and is
 * strictly tighter:
 *   1. The Bearer token MUST verify against the ADMIN audience
 *      ('tolet-pro-admin') and carry `scope: 'admin'` — a public-app token
 *      cannot pass here, so the two frontends are cryptographically isolated.
 *   2. The account is loaded fresh and re-checked for an admin role on EVERY
 *      request (role could have been revoked after the token was minted).
 *   3. Session revocation, password-change invalidation, and ban checks are
 *      enforced exactly like the public auth gate.
 *
 * On success it attaches `req.user` (the admin document) and `req.sessionId`.
 */
module.exports = async function requireAdminAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw ApiError.unauthorized('Admin token নেই।', { code: 'missing_token' });
    }

    let decoded;
    try {
      decoded = tokenService.verifyAdminToken(token);
    } catch (err) {
      // Same split as requireAuth: an expired admin token is refreshable, an
      // invalid one is not. Collapsing both into `invalid_token` left the
      // console unable to tell them apart, so it logged the admin out either way.
      const expired = err?.name === 'TokenExpiredError';
      throw ApiError.unauthorized(
        expired ? 'Admin token-এর মেয়াদ শেষ।' : 'Admin token অবৈধ।',
        { code: expired ? 'token_expired' : 'invalid_token' },
      );
    }

    const user = await User.findById(decoded.sub);
    if (!user) throw ApiError.unauthorized('অ্যাকাউন্ট পাওয়া যায়নি।', { code: 'user_missing' });

    // Token minted before a password change is dead.
    if (user.passwordChangedAt && decoded.iat * 1000 < user.passwordChangedAt.getTime()) {
      throw ApiError.unauthorized('পাসওয়ার্ড পরিবর্তিত হয়েছে। আবার লগইন করুন।', {
        code: 'password_changed',
      });
    }

    // Session revocation: the sessionId embedded in the token must still exist
    // on the user (logout / "sign out everywhere" removes it).
    if (decoded.sessionId) {
      const sessionExists = user.sessions.some((s) => s.sessionId === decoded.sessionId);
      if (!sessionExists) {
        throw ApiError.unauthorized('সেশন মেয়াদ শেষ বা বাতিল হয়েছে। আবার লগইন করুন।', {
          code: 'session_revoked',
        });
      }
      req.sessionId = decoded.sessionId;
    }

    // Re-verify RBAC against the live account — never trust the token's claim
    // alone. A demoted admin is locked out immediately, not at token expiry.
    const roles = Array.isArray(user.roles) && user.roles.length
      ? user.roles
      : (user.role ? [user.role] : []);
    if (!roles.some((r) => ADMIN_ROLES.has(r))) {
      throw ApiError.forbidden('অ্যাডমিন অ্যাক্সেস প্রয়োজন।', { code: 'admin_required' });
    }

    // A banned admin is fully locked out of the console (unlike public users,
    // who keep read-only access to see their ban notice).
    if (user.isBanned) {
      throw ApiError.forbidden('আপনার অ্যাকাউন্ট স্থগিত।', { code: 'account_banned' });
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};
