'use strict';

const User = require('../models/User');
const tokenService = require('../services/token.service');
const ApiError = require('../utils/ApiError');

/**
 * Extracts a Bearer token, verifies it, loads the user, and attaches it as
 * `req.user`. Honors `passwordChangedAt` to invalidate tokens issued before
 * a password reset.
 */
module.exports = async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw ApiError.unauthorized('Token নেই।', { code: 'missing_token' });
    }
    let decoded;
    try {
      decoded = tokenService.verifyAccessToken(token);
    } catch (err) {
      // Expiry and genuine invalidity used to collapse into one `invalid_token`
      // code, so a client had no way to tell "refresh me" from "give up and log
      // out". An expired access token is the NORMAL state 15 minutes after
      // login — it must never be read as a dead session.
      const expired = err?.name === 'TokenExpiredError';
      throw ApiError.unauthorized(
        expired ? 'Token-এর মেয়াদ শেষ।' : 'Token অবৈধ।',
        { code: expired ? 'token_expired' : 'invalid_token' },
      );
    }
    const user = await User.findById(decoded.sub);
    if (!user) throw ApiError.unauthorized('অ্যাকাউন্ট পাওয়া যায়নি।', { code: 'user_missing' });
    if (user.passwordChangedAt && decoded.iat * 1000 < user.passwordChangedAt.getTime()) {
      throw ApiError.unauthorized('পাসওয়ার্ড পরিবর্তিত হয়েছে। আবার লগইন করুন।', {
        code: 'password_changed',
      });
    }

    // Phase 7: Session revocation check
    if (decoded.sessionId) {
      const sessionExists = user.sessions.some(s => s.sessionId === decoded.sessionId);
      if (!sessionExists) {
        throw ApiError.unauthorized('সেশন মেয়াদ শেষ বা বাতিল হয়েছে। আবার লগইন করুন।', {
          code: 'session_revoked',
        });
      }
      req.sessionId = decoded.sessionId; // Attach to request for endpoints that need it
    }

    // Banned users may still log in (so they see the in-app rejection
    // notice) but any state-mutating request must be refused. Read-only
    // requests (GET / HEAD) stay allowed so the user can view their own
    // dashboard and read the ban reason. Anything that writes — POST,
    // PUT, PATCH, DELETE — is blocked with 403.
    const isReadOnly = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (user.isBanned && !isReadOnly) {
      throw ApiError.forbidden(
        user.banReason
          ? `আপনার অ্যাকাউন্ট স্থগিত: ${user.banReason}`
          : 'আপনার অ্যাকাউন্ট স্থগিত। সাপোর্টের সাথে যোগাযোগ করুন।',
        { code: 'account_banned' },
      );
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};
