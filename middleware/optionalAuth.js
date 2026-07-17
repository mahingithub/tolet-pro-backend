'use strict';

const User = require('../models/User');
const tokenService = require('../services/token.service');

/**
 * optionalAuth
 * ──────────────────────────────────────────────────────────────────────────
 * Attaches `req.user` when a VALID Bearer token is present, otherwise falls
 * through as an anonymous request. Unlike requireAuth it NEVER rejects — use it
 * on endpoints that must work for both guests and logged-in users (e.g.
 * recording "interested in selling" clicks, where guest demand still counts but
 * a logged-in user's identity lets the agency follow up).
 */
module.exports = async function optionalAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme === 'Bearer' && token) {
      try {
        const decoded = tokenService.verifyAccessToken(token);
        const user = await User.findById(decoded.sub);
        // Ignore banned accounts here too — treat them as guests rather than
        // blocking (this endpoint is non-sensitive).
        if (user && !user.isBanned) req.user = user;
      } catch {
        /* invalid / expired token → treat as an anonymous guest */
      }
    }
  } catch {
    /* never block on optional auth */
  }
  next();
};
