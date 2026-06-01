'use strict';

/**
 * ─── DROP-IN ADDITIONS TO YOUR EXISTING auth.controller.js ──────────────────
 *
 * EC-01 FIX: emergencyContact whole-object payload no longer silently dropped
 * EC-02 FIX: trustScore + trustTier now persisted to DB after every PATCH /me
 */

const User = require('../models/User');
// Trust score is computed inside the User pre-save hook (see User.js).
// We don't import a separate helper here on purpose — duplicating that
// math at the controller layer was the source of the 500 in PATCH /me.

// Cloudinary helper — same one verification.controller.js uses.
// Path may differ in your repo — adjust if cloudinary.service.js is
// at a different location (commonly `../services/` or `../utils/`).
const cloudinary = require('../services/cloudinary.service');

// ─── Whitelisted top-level fields ──────────────────────────────────────────
const PATCH_ME_TOP_LEVEL = ['name', 'email', 'dateOfBirth', 'avatar'];

// ─── EC-01 FIX: expanded tenant sub-fields whitelist ───────────────────────
// Previously only had ['professionType', 'publicVisible'] — that's why
// workPlace, emergencyContact, fullName etc. were silently dropped.
const PATCH_ME_TENANT_FIELDS = [
  'professionType',
  'publicVisible',
  'fullName',
  'workPlace',
  'workPlaceId',
  'monthlyIncome',
  'familySize',
  'serviceCharge',
];

// Landlord sub-fields (flat). Keep this list aligned with
// LandlordProfileSchema in models/User.js — any field missing here is
// silently dropped on save, which manifests as "I clicked save but
// nothing happened" in the dashboard.
const PATCH_ME_LANDLORD_FIELDS = [
  'fullName',
  'city',
  'address',
  'serviceCharge',
  'preferredTenants',
  'communication',
  'houseRules',
];

// emergencyContact sub-fields — handled separately (whole-object payload)
const EMERGENCY_CONTACT_FIELDS = ['name', 'phone', 'relation'];

function pick(src, keys) {
  const out = {};
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
  }
  return out;
}

function isTenantProfileVerifiedEnough(tenantProfile) {
  const tp = tenantProfile?.toObject?.() || tenantProfile || {};
  const v  = tp.verification?.toObject?.() || tp.verification || {};
  const hasPhoto = !!v.photo;
  const hasNid   = !!(v.nidFront && v.nidBack);
  const profOk   = !!v.professionProof || tp.professionType === 'other';
  return hasPhoto && hasNid && profOk;
}

// ───────────────────────────────────────────────────────────────────────────
// PATCH /api/auth/me
// ───────────────────────────────────────────────────────────────────────────
async function patchMe(req, res, next) {
  try {
    const me = req.user;
    if (!me) return res.status(401).json({ message: 'Unauthenticated' });

    const body = req.body || {};

    // ── Top-level fields (name, email, dateOfBirth, avatar) ──────────────
    const patch = pick(body, PATCH_ME_TOP_LEVEL);
    Object.assign(me, patch);

    if (typeof patch.dateOfBirth === 'string' && patch.dateOfBirth) {
      me.dateOfBirth = new Date(patch.dateOfBirth);
    }

    // ── Tenant profile ────────────────────────────────────────────────────
    if (body.tenantProfile && typeof body.tenantProfile === 'object') {
      const existing = me.tenantProfile?.toObject?.() || me.tenantProfile || {};

      // Flat whitelisted fields
      const flatPatch = pick(body.tenantProfile, PATCH_ME_TENANT_FIELDS);

      // EC-01 FIX: emergencyContact whole-object handler
      // Previously the whole { name, phone, relation } object was dropped
      // because 'emergencyContact' wasn't in PATCH_ME_TENANT_FIELDS.
      // Now we walk its sub-fields and merge safely.
      let ecPatch = {};
      if (
        body.tenantProfile.emergencyContact &&
        typeof body.tenantProfile.emergencyContact === 'object'
      ) {
        ecPatch = pick(body.tenantProfile.emergencyContact, EMERGENCY_CONTACT_FIELDS);
      }

      const existingEc = existing.emergencyContact || {};

      me.tenantProfile = {
        ...existing,
        ...flatPatch,
        emergencyContact: { ...existingEc, ...ecPatch },
      };
    }

    // ── Landlord profile ──────────────────────────────────────────────────
    if (body.landlordProfile && typeof body.landlordProfile === 'object') {
      const existing = me.landlordProfile?.toObject?.() || me.landlordProfile || {};
      const flatPatch = pick(body.landlordProfile, PATCH_ME_LANDLORD_FIELDS);
      me.landlordProfile = { ...existing, ...flatPatch };
    }

    // ── Save ──────────────────────────────────────────────────────────────
    // The User.js pre-save hook computes tenantProfile.trustScore +
    // trustTier from the new state, so a single save() is enough. There
    // is no top-level `trustScore`/`trustTier` field on the schema — the
    // earlier "EC-02" double-save block referenced a non-existent
    // `computeTrustScore` helper and tried to write to fields that don't
    // exist, which is what crashed PATCH /me with a 500.
    await me.save();

    return res.json({ user: me.toJSON() });
  } catch (err) {
    return next(err);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// POST /api/auth/me/roles  { role: 'landlord' | 'tenant' | ... }
// ───────────────────────────────────────────────────────────────────────────
async function addRole(req, res, next) {
  try {
    const me = req.user;
    if (!me) return res.status(401).json({ message: 'Unauthenticated' });

    const requested = String(req.body?.role || '').trim();
    if (!User.ROLES.includes(requested)) {
      return res.status(400).json({ message: `Unknown role: ${requested}` });
    }

    const SELF_SERVE = new Set(['tenant', 'landlord']);
    if (!SELF_SERVE.has(requested)) {
      const callerIsPrivileged = (me.roles || []).some(
        (r) => r === 'super_admin' || r === 'moderator',
      );
      if (!callerIsPrivileged) {
        return res.status(403).json({ message: 'Insufficient privileges to grant this role.' });
      }
    }

    if (!Array.isArray(me.roles)) me.roles = [me.role || 'tenant'];

    if (requested === 'landlord' && !me.roles.includes('landlord')) {
      // Self-serve landlord role is GATED on an admin-approved landlord
      // verification — i.e. landlordProfile.verification.status must be
      // 'verified'. The user only flips that status to 'verified' via
      // POST /api/admin/users/:id/verify-landlord (admin.controller.js),
      // and that controller already grants the role atomically. So the
      // only legit path to hit this branch is for a user whose admin
      // approval just landed; for everyone else we refuse and tell them
      // to submit landlord verification.
      const lvStatus = me.landlordProfile?.verification?.status || 'unverified';
      if (lvStatus !== 'verified') {
        return res.status(403).json({
          message: 'Landlord হতে হলে আগে landlord verification (ঠিকানা + utility bill) জমা দিয়ে admin approval নিন।',
          code: 'landlord_verification_required',
        });
      }
    }

    if (!me.roles.includes(requested)) me.roles.push(requested);

    await me.save();
    return res.json({ user: me.toJSON() });
  } catch (err) {
    return next(err);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// POST /api/auth/me/active-role  { role: 'tenant' | 'landlord' }
// ───────────────────────────────────────────────────────────────────────────
async function setActiveRole(req, res, next) {
  try {
    const me = req.user;
    if (!me) return res.status(401).json({ message: 'Unauthenticated' });

    const next_ = String(req.body?.role || '').trim();
    if (!User.ROLES.includes(next_)) {
      return res.status(400).json({ message: `Unknown role: ${next_}` });
    }
    if (!Array.isArray(me.roles) || !me.roles.includes(next_)) {
      return res.status(403).json({ message: 'You do not have that role yet.' });
    }

    me.role = next_;
    await me.save();
    return res.json({ user: me.toJSON() });
  } catch (err) {
    return next(err);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// POST /api/auth/me/verification/submit
// ───────────────────────────────────────────────────────────────────────────
async function submitVerification(req, res, next) {
  try {
    const me = req.user;
    if (!me) return res.status(401).json({ message: 'Unauthenticated' });

    const v = req.body?.verification || {};
    const next_ = {
      photo:              !!v.photo,
      nidFront:           !!v.nidFront,
      nidBack:            !!v.nidBack,
      professionProof:    !!v.professionProof,
      submittedForReview: true,
      status:             'pending',
      reviewedAt:         null,
    };

    me.tenantProfile = me.tenantProfile || {};
    me.tenantProfile.verification = {
      ...(me.tenantProfile.verification?.toObject?.() || me.tenantProfile.verification || {}),
      ...next_,
    };

    // NOTE: submitting tenant identity docs does NOT grant the landlord
    // role. Identity verification proves who the person is; becoming a
    // landlord is a SEPARATE flow that also requires proving property
    // ownership (address + utility bill). The landlord role is granted
    // by an admin via POST /api/admin/users/:id/verify-landlord — see
    // admin.controller.js. We intentionally do not auto-promote here.

    await me.save();
    return res.json({ user: me.toJSON() });
  } catch (err) {
    return next(err);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// POST /api/auth/me/avatar
// Multipart upload: field name "file". Streams directly to Cloudinary
// under tolet-pro/avatars/<userId>/avatar, overwrites on re-upload so
// stale bytes get garbage-collected (no quota leak on every change).
//
// Why this lives in `additions.js` and not its own controller:
//   • Identical shape to patchMe/submitVerification — operates on `req.user`
//   • Avatar URL is just another field on the User doc; no separate model
//   • Keeps the avatar route binding in auth.routes.js next to /me/roles etc.
//
// Frontend mirrors with `authService.uploadAvatar()`, which uses XHR for
// real upload-progress events (fetch can't expose those yet).
// ───────────────────────────────────────────────────────────────────────────
async function uploadAvatar(req, res, next) {
  try {
    const me = req.user;
    if (!me) return res.status(401).json({ message: 'Unauthenticated' });
    if (!req.file) {
      return res.status(400).json({
        message: 'কোনো ফাইল পাঠানো হয়নি।',
        code:    'no_file',
      });
    }

    // Sanity checks — uploadMiddleware probably already enforces these
    // (5 MB cap, image mimes), but a belt-and-suspenders pass keeps the
    // controller honest in case the middleware gets swapped later.
    const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
    if (!ALLOWED_MIMES.includes(req.file.mimetype)) {
      return res.status(415).json({
        message: 'JPG, PNG বা WEBP ছবি ব্যবহার করুন।',
        code:    'invalid_mime',
      });
    }

    // Upload to Cloudinary. publicId is deterministic ('avatar') so each
    // user has at most ONE avatar file in storage — re-uploads overwrite
    // the bytes, Cloudinary garbage-collects old version.
    const result = await cloudinary.uploadBuffer(req.file.buffer, {
      folder:       `tolet-pro/avatars/${me._id}`,
      publicId:     'avatar',
      resourceType: 'image',
    });

    // Persist on user. avatarPublicId stored separately so a future
    // "delete avatar" flow can call cloudinary.destroy() cleanly.
    me.avatar         = result.secureUrl;
    me.avatarPublicId = result.publicId;

    // Fix: Mark verification photo as done so timeline ticks off
    me.tenantProfile = me.tenantProfile || {};
    me.tenantProfile.verification = me.tenantProfile.verification || {};
    me.tenantProfile.verification.photo = true;
    me.tenantProfile.verification.photoUrl = result.secureUrl;
    me.tenantProfile.verification.photoPublicId = result.publicId;

    await me.save();

    return res.json({ user: me.toJSON() });
  } catch (err) {
    // Cloudinary missing-config = 503 (set by cloudinary.service.js)
    if (err.status === 503) {
      return res.status(503).json({ message: err.message, code: err.code });
    }
    return next(err);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// POST /api/auth/me/landlord-verification/submit
//
// Dual-path KYC handler. The route accepts a multipart upload but the
// fields are role-aware so a verified tenant doesn't have to re-upload
// what they've already proven:
//
//   Path A — Upgrading Tenant (tenantProfile.verification.status === 'verified')
//     • body:  propertyAddress
//     • files: utilityBill          (only one)
//
//   Path B — Fresh Landlord (no prior tenant verification, OR rejected)
//     • body:  propertyAddress
//     • files: utilityBill, nidFront, nidBack, photo, professionProof
//
// We detect the path server-side from the user's existing
// tenantProfile.verification.status. If a Path B user sends a partial
// payload we 400 with the exact list of missing fields so the frontend
// can highlight them.
//
// Approve flow lives in admin.controller.js → verifyLandlord, which
// flips landlordProfile.verification.status to 'verified' AND grants
// the landlord role.
// ───────────────────────────────────────────────────────────────────────────
async function submitLandlordVerification(req, res, next) {
  try {
    const me = req.user;
    if (!me) return res.status(401).json({ message: 'Unauthenticated' });

    const propertyAddress = String(req.body?.propertyAddress || '').trim();
    if (!propertyAddress) {
      return res.status(400).json({
        message: 'প্রপার্টির ঠিকানা দিন।',
        code:    'address_required',
      });
    }

    // ── Decide Path A vs Path B ──────────────────────────────────────
    // Path A: tenant identity already approved by an admin. We reuse
    // their NID / photo / profession proof; only address + bill needed.
    const tv = me.tenantProfile?.verification || {};
    const isAlreadyTenantVerified = tv.status === 'verified';

    // multer's array/fields parser puts files at req.files when there
    // are multiple inputs. For uploadSingle (the original middleware)
    // we'd only get req.file — so the route must mount uploadMulti for
    // this handler. We accept both shapes for forward compat.
    const filesByField = {};
    if (req.files) {
      // req.files can be an array (uploadFields with .any) or an object
      // (uploadFields with named fields). Normalise to an object keyed
      // by fieldname.
      const arr = Array.isArray(req.files)
        ? req.files
        : Object.values(req.files).flat();
      for (const f of arr) filesByField[f.fieldname] = f;
    } else if (req.file) {
      // Backwards-compat: when the route is still using uploadSingle the
      // single file lands at req.file. Treat it as the utility bill.
      filesByField.utilityBill = req.file;
    }

    const utilityBill     = filesByField.utilityBill     || null;
    const nidFront        = filesByField.nidFront        || null;
    const nidBack         = filesByField.nidBack         || null;
    const photo           = filesByField.photo           || null;
    const professionProof = filesByField.professionProof || null;

    // ── Validate per path ────────────────────────────────────────────
    const missing = [];
    if (!utilityBill) missing.push('utilityBill');
    if (!isAlreadyTenantVerified) {
      // Path B: full identity required because we have nothing on file.
      // Exception: if any of these were previously uploaded (e.g. user
      // submitted, got rejected, is resubmitting) we honour the existing
      // URL so they don't have to re-attach an unchanged document.
      if (!nidFront        && !tv.nidFrontUrl)        missing.push('nidFront');
      if (!nidBack         && !tv.nidBackUrl)         missing.push('nidBack');
      if (!photo           && !tv.photoUrl)           missing.push('photo');
      if (!professionProof && !tv.professionProofUrl) missing.push('professionProof');
    }
    if (missing.length > 0) {
      return res.status(400).json({
        message: 'কিছু ডকুমেন্ট পাওয়া যায়নি।',
        code:    'missing_documents',
        missing,
        path:    isAlreadyTenantVerified ? 'A' : 'B',
      });
    }

    const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
    const assertMime = (f, label) => {
      if (f && !ALLOWED_MIMES.includes(f.mimetype)) {
        const err = new Error(`${label}: JPG, PNG বা WEBP ছবি ব্যবহার করুন।`);
        err.status = 415; err.code = 'invalid_mime';
        throw err;
      }
    };
    try {
      assertMime(utilityBill,     'Utility bill');
      assertMime(nidFront,        'NID front');
      assertMime(nidBack,         'NID back');
      assertMime(photo,           'Photo');
      assertMime(professionProof, 'Profession proof');
    } catch (e) {
      return res.status(e.status || 415).json({ message: e.message, code: e.code });
    }

    // ── Upload utility bill (always) ─────────────────────────────────
    const billResult = await cloudinary.uploadBuffer(utilityBill.buffer, {
      folder:       `tolet-pro/landlord-verification/${me._id}`,
      publicId:     'utility_bill',
      resourceType: 'image',
    });

    me.landlordProfile = me.landlordProfile || {};
    me.landlordProfile.verification = {
      ...(me.landlordProfile.verification?.toObject?.() || me.landlordProfile.verification || {}),
      propertyAddress,
      utilityBillUrl:      billResult.secureUrl,
      utilityBillPublicId: billResult.publicId,
      submittedForReview:  true,
      submittedAt:         new Date(),
      status:              'pending',
      reviewedAt:          null,
      rejectionReason:     '',
    };

    // ── Path B: also upload the tenant-side identity docs ────────────
    // We write them into tenantProfile.verification so they go through
    // the same admin queue + appear in the same trust-score formula.
    // Admin will see them in the landlord queue too (the controller
    // exposes both blocks via pickPublicUser).
    if (!isAlreadyTenantVerified) {
      me.tenantProfile = me.tenantProfile || {};
      me.tenantProfile.verification = me.tenantProfile.verification || {};

      const uploadIfPresent = async (file, kind, slot) => {
        if (!file) return;
        const r = await cloudinary.uploadBuffer(file.buffer, {
          folder:       `tolet-pro/verification/${me._id}`,
          publicId:     slot,
          resourceType: 'image',
        });
        me.tenantProfile.verification[`${kind}Url`]      = r.secureUrl;
        me.tenantProfile.verification[`${kind}PublicId`] = r.publicId;
        me.tenantProfile.verification[kind]              = true;
      };
      await uploadIfPresent(nidFront,        'nidFront',        'nid_front');
      await uploadIfPresent(nidBack,         'nidBack',         'nid_back');
      await uploadIfPresent(photo,           'photo',           'profile_photo');
      await uploadIfPresent(professionProof, 'professionProof', 'profession_proof');

      // Mark tenant-side as pending too so the admin can approve both
      // queues from the same dashboard pass.
      me.tenantProfile.verification.submittedForReview = true;
      me.tenantProfile.verification.status = 'pending';
      me.tenantProfile.verification.reviewedAt = null;
      me.tenantProfile.verification.rejectionReason = '';
    }

    await me.save();
    return res.json({
      user: me.toJSON(),
      path: isAlreadyTenantVerified ? 'A' : 'B',
    });
  } catch (err) {
    if (err.status === 503) {
      return res.status(503).json({ message: err.message, code: err.code });
    }
    return next(err);
  }
}

module.exports = {
  patchMe,
  addRole,
  setActiveRole,
  submitVerification,
  submitLandlordVerification,
  uploadAvatar,
};