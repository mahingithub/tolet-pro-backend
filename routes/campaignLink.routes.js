'use strict';

/**
 * campaignLink.routes.js — resolving a campaign short link.
 * ──────────────────────────────────────────────────────────────────────────
 * Mounted at /api/r. ONE public endpoint:
 *
 *   GET /api/r/:code  →  { path: '/subscription' }
 *
 * PUBLIC ON PURPOSE, and it must stay that way. The recipient of an SMS is
 * usually signed out — that is often the whole point of the campaign — and a
 * link that demands a session before it will even say where it goes is a link
 * that dead-ends for exactly the people being re-engaged. Sign-in happens
 * AFTER, at the destination, where RequireAuth bounces to /login?next=<path>
 * and returns them once they are in.
 *
 * `optionalAuth` is here only so the click can be counted as signed-in or not;
 * the response is identical either way, and no user data is read or returned.
 *
 * WHY THIS RETURNS JSON INSTEAD OF A 302
 * The link the recipient opens is https://www.toletpro.rent/r/<code> — the
 * FRONTEND host, not this API. It has to be, because that is the domain
 * assetlinks.json verifies, so on a phone with the app installed Android opens
 * the link in the app instead of a browser. The frontend's /r/:code route calls
 * this endpoint and navigates in-app, which keeps the session the app already
 * holds. A 302 from the API would have meant a browser hop and a lost session.
 */

const express = require('express');
const optionalAuth = require('../middleware/optionalAuth');
const svc = require('../services/campaignLink.service');

const router = express.Router();

router.get('/:code', optionalAuth, async (req, res) => {
  try {
    const hit = await svc.resolveAndCount(req.params.code, { signedIn: !!req.user });
    if (!hit) {
      // A dead or mistyped code. 404 rather than a redirect to '/', so the
      // frontend can decide what to show instead of silently pretending the
      // campaign pointed at the homepage.
      return res.status(404).json({ message: 'লিংকটি আর কাজ করছে না।', code: 'link_not_found' });
    }
    return res.json({ path: hit.targetPath, campaign: hit.campaign, channel: hit.channel });
  } catch (err) {
    // Never 500 a link a customer just tapped: send them to the homepage rather
    // than an error screen, and log for us.
    console.error('[campaignLink] resolve failed:', err?.message);
    return res.json({ path: '/', degraded: true });
  }
});

module.exports = router;
