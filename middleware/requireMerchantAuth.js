'use strict';

const Merchant = require('../models/Merchant');
const tokenService = require('../services/token.service');
const ApiError = require('../utils/ApiError');

/**
 * requireMerchantAuth — the single gate for the provider app.
 *
 * Mirrors requireAdminAuth, against a DIFFERENT collection:
 *   1. The Bearer token must verify against the MERCHANT audience
 *      ('tolet-pro-provider') and carry `scope: 'merchant'`. A tenant's token
 *      cannot pass here and a merchant's cannot pass requireAuth, so the
 *      rental system and the provider system are cryptographically isolated —
 *      not merely separated by a role check.
 *   2. `decoded.sub` is a Merchant._id, never a User._id. The two collections
 *      have independent id spaces, so a token that somehow crossed audiences
 *      would resolve to nobody rather than to the wrong somebody.
 *   3. Session revocation, password-change invalidation and ban checks work
 *      exactly as they do on the other two surfaces.
 *
 * On success it attaches `req.merchant` — deliberately NOT `req.user`. A
 * handler that reaches for `req.user` here should fail loudly rather than
 * silently operate on an object from the wrong system.
 */
module.exports = async function requireMerchantAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw ApiError.unauthorized('Token নেই।', { code: 'missing_token' });
    }

    let decoded;
    try {
      decoded = tokenService.verifyMerchantToken(token);
    } catch (err) {
      // An expired access token is the NORMAL state minutes after login and is
      // refreshable; an invalid one is not. Collapsing the two would sign a
      // shopkeeper out several times a day on these networks.
      const expired = err?.name === 'TokenExpiredError';
      throw ApiError.unauthorized(
        expired ? 'Token-এর মেয়াদ শেষ।' : 'Token অবৈধ।',
        { code: expired ? 'token_expired' : 'invalid_token' },
      );
    }

    // `sessions` is select:false on the model (it holds refresh hashes), so
    // revocation checking has to ask for it explicitly.
    const merchant = await Merchant.findById(decoded.sub).select('+sessions');
    if (!merchant) {
      throw ApiError.unauthorized('অ্যাকাউন্ট পাওয়া যায়নি।', { code: 'merchant_missing' });
    }

    if (tokenService.isTokenStaleAfterPasswordChange(decoded, merchant.passwordChangedAt)) {
      throw ApiError.unauthorized('পাসওয়ার্ড পরিবর্তিত হয়েছে। আবার লগইন করুন।', {
        code: 'password_changed',
      });
    }

    if (decoded.sessionId) {
      const alive = merchant.sessions.some((s) => s.sessionId === decoded.sessionId);
      if (!alive) {
        throw ApiError.unauthorized('সেশন মেয়াদ শেষ বা বাতিল হয়েছে। আবার লগইন করুন।', {
          code: 'session_revoked',
        });
      }
      req.sessionId = decoded.sessionId;
    }

    if (merchant.isBanned) {
      throw ApiError.forbidden(
        merchant.banReason || 'আপনার অ্যাকাউন্ট স্থগিত করা হয়েছে।',
        { code: 'account_banned' },
      );
    }

    req.merchant = merchant;
    return next();
  } catch (err) {
    return next(err);
  }
};
