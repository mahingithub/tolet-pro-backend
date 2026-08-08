'use strict';

/**
 * upload.routes.js — Cloudinary Direct Upload signature endpoints.
 * ──────────────────────────────────────────────────────────────────────────
 * These routes let the frontend request a one-time signed upload credential
 * so it can upload files directly from the browser/app to Cloudinary. The
 * actual file bytes NEVER touch our server — only the tiny JSON signature
 * request does. This eliminates the upload bottleneck and keeps server RAM
 * usage flat regardless of how many concurrent uploads are in flight.
 *
 *   POST /api/upload/signature          → signed credential for public assets
 *   POST /api/upload/signature/private  → signed credential for authenticated
 *                                         (NID, identity docs) assets
 */

const express = require('express');
const router  = express.Router();
const requireAuth = require('../middleware/requireAuth');
const cloud       = require('../services/cloudinary.service');

// ── POST /api/upload/signature ──────────────────────────────────────────────
// Body: { folder, publicId?, resourceType? }
// Returns the credential set the frontend needs for a signed direct upload.
router.post('/signature', requireAuth, (req, res, next) => {
  try {
    const { folder, publicId, resourceType } = req.body || {};
    if (!folder || typeof folder !== 'string') {
      return res.status(400).json({ message: 'folder is required.', code: 'missing_folder' });
    }
    const sig = cloud.generateSignature({ folder, publicId, resourceType });
    return res.json(sig);
  } catch (err) {
    return next(err);
  }
});

// ── POST /api/upload/signature/private ──────────────────────────────────────
// Same shape but produces an 'authenticated' type credential. Used for NID
// scans, identity documents, and other files that must NOT be publicly URL-
// accessible.
router.post('/signature/private', requireAuth, (req, res, next) => {
  try {
    const { folder, publicId } = req.body || {};
    if (!folder || typeof folder !== 'string') {
      return res.status(400).json({ message: 'folder is required.', code: 'missing_folder' });
    }
    const sig = cloud.generateAuthenticatedSignature({ folder, publicId });
    return res.json(sig);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
