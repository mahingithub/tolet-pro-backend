'use strict';

/**
 * merchant.upload.routes.js — mounted at /api/merchant/upload.
 * ─────────────────────────────────────────────────────────────────────────────
 * The provider app's own signed-upload endpoint.
 *
 *   POST /signature   { folder, publicId?, resourceType? }
 *
 * ─── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
 * The provider app used to call /api/upload/signature, which is guarded by
 * `requireAuth` — the RENTAL surface. A merchant token carries the audience
 * 'tolet-pro-provider', so `verifyAccessToken` rejected it outright as
 * `invalid_token`, and the provider client treats that code as terminal
 * (services/apiClient.js → TERMINAL_AUTH_CODES). The result was not a failed
 * upload but a SIGNED-OUT SHOPKEEPER: tapping "ছবি তুলুন" on the last step of
 * registration ended the session, every time, and did it again after he logged
 * back in and tried the photo once more.
 *
 * The three surfaces are isolated by token audience on purpose. That isolation
 * is not something to work around with a dual-audience guard; it means each
 * surface brings its own routes. This is the provider's.
 *
 * ─── THE FOLDER ALLOWLIST ────────────────────────────────────────────────────
 * /api/upload/signature signs any folder the caller names. That is loose even
 * on the rental side, and it would be worse here: a signature is a write
 * credential, and without a constraint a shopkeeper's token could mint one for
 * `nid/` or any other folder holding somebody's identity documents. A merchant
 * has exactly two things to upload, so the list is short and closed.
 */

const express = require('express');

const requireMerchantAuth = require('../middleware/requireMerchantAuth');
const cloud = require('../services/cloudinary.service');
const ApiError = require('../utils/ApiError');

const router = express.Router();

/**
 * Folders a merchant token may be signed for. Matched as path prefixes so that
 * `providers/photos` and any future `providers/<something>` are covered, while
 * a leading-dot or parent-segment trick cannot climb out of them.
 */
const ALLOWED_FOLDERS = ['providers/', 'merchants/'];

const isAllowedFolder = (folder) => (
  typeof folder === 'string'
  && !folder.includes('..')
  && ALLOWED_FOLDERS.some((prefix) => folder.startsWith(prefix))
);

router.post('/signature', requireMerchantAuth, (req, res, next) => {
  try {
    const { folder, publicId, resourceType } = req.body || {};

    if (!folder || typeof folder !== 'string') {
      throw ApiError.badRequest('folder is required.', { code: 'missing_folder' });
    }
    if (!isAllowedFolder(folder)) {
      throw ApiError.forbidden('এই ফোল্ডারে আপলোড করা যাবে না।', {
        code: 'folder_not_allowed',
        details: { allowed: ALLOWED_FOLDERS },
      });
    }

    // `image` only. A merchant uploads a shopfront and a face, and leaving the
    // resource type caller-controlled would let the same credential be spent on
    // a video or a raw file.
    const sig = cloud.generateSignature({
      folder,
      publicId,
      resourceType: resourceType === 'image' ? 'image' : 'image',
    });
    return res.json(sig);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
module.exports.ALLOWED_FOLDERS = ALLOWED_FOLDERS;
