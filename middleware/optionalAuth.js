'use strict';

const User = require('../models/User');
const tokenService = require('../services/token.service');

/**
 * Optional-auth middleware.
 *
 * If the request carries a valid `Authorization: Bearer <token>` header, we
 * load the user and attach `req.user`. If the header is missing OR the
 * token is invalid/expired, we DO NOT reject — we simply leave `req.user`
 * unset and call `next()`. This is what powers the privacy gate on the
 * public tenant profile route (`GET /api/tenants/:id`):
 *
 *   • Anonymous caller          → req.user = undefined  → privacy gate stays
 *                                                          closed (no phone /
 *                                                          email exposed).
 *   • Tenant viewing own page   → req.user._id matches  → unlock.
 *   • Landlord with an inquiry  → req.user._id matches  → unlock via
 *                                                          inquiry-existence
 *                                                          check inside the
 *                                                          controller.
 *   • Anyone else logged in     → req.user is set but   → no special
 *                                                          treatment.
 *
 * NOTE: we intentionally swallow ALL errors here — a malformed token must
 * never break a public route. The downside is hidden token-rotation issues;
 * to debug those, hit any `requireAuth` route which surfaces the real error.
 */
module.exports = async function optionalAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) return next();

    let decoded;
    try {
      decoded = tokenService.verifyAccessToken(token);
    } catch {
      return next();
    }

    const user = await User.findById(decoded.sub);
    if (!user) return next();

    // Honour password-rotation: tokens minted before the last password
    // change are treated as anonymous.
    if (user.passwordChangedAt && decoded.iat * 1000 < user.passwordChangedAt.getTime()) {
      return next();
    }

    req.user = user;
    return next();
  } catch {
    return next();
  }
};
