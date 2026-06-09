'use strict';

/**
 * verification.controller.js
 * ─────────────────────────────────────────────────────────────────────────
 * Handles the *honest* identity-verification flow:
 *   1. Tenant picks a real file (NID front/back, profile photo, profession proof).
 *   2. We upload it to Cloudinary under a per-user folder.
 *   3. We persist the secure URL + cloudinary public_id on the user doc.
 *   4. A separate flag (`verification.status`) flips to 'pending' on submit.
 *   5. An admin reviews and either approves (status: 'verified') or rejects
 *      (status: 'rejected' + rejectionReason). Approval is what unlocks the
 *      30 + 30 trust-score points in User.js / computeTenantTrust.
 *
 * Why one controller per "doc kind" instead of one giant /upload?
 *   • Per-kind validation (selfie ≠ NID — different size/mime expectations).
 *   • Per-kind cleanup (replacing NID front must not delete NID back).
 *   • Easier audit trail later ("who replaced what when").
 */

const User = require('../models/User');
const cloud = require('../services/cloudinary.service');
const ApiError = require('../utils/ApiError');

// ─── Config ───────────────────────────────────────────────────────────────
// Document slots a tenant can upload. The `field` is the key inside
// `user.tenantProfile.verification` that holds the URL + public_id.
const DOC_KINDS = {
  photo:           { field: 'photo',           publicId: 'profile_photo' },
  nidFront:        { field: 'nidFront',        publicId: 'nid_front' },
  nidBack:         { field: 'nidBack',         publicId: 'nid_back' },
};

// Allowed mime types.
const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — matches the Cloudinary preset cap

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ─── POST /api/auth/me/verification/upload/:kind ──────────────────────────
// multer middleware will populate req.file.buffer for us.
exports.uploadDoc = asyncH(async (req, res) => {
  const me = req.user;
  if (!me) throw ApiError.unauthorized('Unauthenticated');

  const kind = String(req.params.kind || '');
  const slot = DOC_KINDS[kind];
  if (!slot) throw ApiError.badRequest(`Unknown verification kind: ${kind}`);

  if (!req.file || !req.file.buffer) {
    throw ApiError.badRequest('No file was uploaded. Please pick a file and try again.');
  }
  if (req.file.size > MAX_BYTES) {
    throw ApiError.badRequest('File is too large. Maximum size is 5 MB.');
  }
  const allowed = ALLOWED_IMAGE_MIMES;
  if (!allowed.has(req.file.mimetype)) {
    throw ApiError.badRequest(
      `Unsupported file type: ${req.file.mimetype}. Use JPG, PNG, or WEBP.`,
    );
  }

  // ─── Replace flow ─────────────────────────────────────────────────────
  // If the user already has a doc for this slot, the deterministic public_id
  // means Cloudinary will overwrite it — but we still call destroy first to
  // free quota in the (rare) case the resource_type differs (image vs raw).
  const verif = me.tenantProfile?.verification?.toObject?.()
              || me.tenantProfile?.verification
              || {};
  const previousPublicId = verif[`${slot.field}PublicId`];
  if (previousPublicId) {
    await cloud.destroy(previousPublicId, {
      resourceType: 'image',
    });
  }

  // ─── Upload ───────────────────────────────────────────────────────────
  const folder = `tolet-pro/verification/${me._id}`;
  const result = await cloud.uploadBuffer(req.file.buffer, {
    folder,
    publicId: slot.publicId,
    resourceType: 'image',
  });

  // ─── Persist on the user doc ──────────────────────────────────────────
  // We store BOTH the URL (for display) and the public_id (for delete on
  // replace). The boolean flag (`photo`, `nidFront`, ...) flips to true so
  // existing dashboard code that checks the flag keeps working unchanged.
  me.tenantProfile = me.tenantProfile || {};
  if (kind === 'photo') me.avatar = result.secureUrl;
  me.tenantProfile.verification = {
    ...(verif),
    [slot.field]:                  true,
    [`${slot.field}Url`]:          result.secureUrl,
    [`${slot.field}PublicId`]:     result.publicId,
    // Any new upload after a rejection resets the review state so the
    // admin queue picks it up again on next submit.
    status: verif.status === 'rejected' ? 'unverified' : (verif.status || 'unverified'),
    submittedForReview: false,
    rejectionReason: '',
  };
  await me.save();

  res.json({
    ok: true,
    kind,
    url:      result.secureUrl,
    bytes:    result.bytes,
    format:   result.format,
    user:     me.toJSON(),
  });
});

// ─── DELETE /api/auth/me/verification/upload/:kind ───────────────────────
// Removes one slot. Used by the dashboard's "Remove" button.
exports.deleteDoc = asyncH(async (req, res) => {
  const me = req.user;
  if (!me) throw ApiError.unauthorized('Unauthenticated');

  const kind = String(req.params.kind || '');
  const slot = DOC_KINDS[kind];
  if (!slot) throw ApiError.badRequest(`Unknown verification kind: ${kind}`);

  const verif = me.tenantProfile?.verification?.toObject?.()
              || me.tenantProfile?.verification
              || {};
  const publicId = verif[`${slot.field}PublicId`];
  if (publicId) {
    await cloud.destroy(publicId, {
      resourceType: 'image',
    });
  }

  me.tenantProfile = me.tenantProfile || {};
  me.tenantProfile.verification = {
    ...(verif),
    [slot.field]:                  false,
    [`${slot.field}Url`]:          '',
    [`${slot.field}PublicId`]:     '',
  };
  await me.save();

  res.json({ ok: true, kind, user: me.toJSON() });
});