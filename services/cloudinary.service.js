'use strict';

/**
 * cloudinary.service.js
 * ─────────────────────────────────────────────────────────────────────────
 * Thin wrapper around the Cloudinary Node SDK. Centralised so every
 * controller that needs to push a verification document, avatar, or
 * property photo to object storage goes through the same code path
 * (consistent folders, consistent transformation defaults, easy rotation
 * of credentials).
 *
 * Why upload from the *server* and not the browser?
 *   • Secrets stay server-side — never in client bundles or DevTools.
 *   • We can validate file size / mime-type before paying for storage.
 *   • Same controller can also delete on replace, so we never leak
 *     orphaned NID scans into our Cloudinary quota.
 */

const cloudinary = require('cloudinary').v2;
const env = require('../config/env');

// Boot-time config. Throws *only* if the credentials look obviously wrong,
// so a misconfigured dev server fails fast instead of silently 500-ing on
// the first upload.
function configure() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || env.cloudinaryCloudName;
  const apiKey    = process.env.CLOUDINARY_API_KEY    || env.cloudinaryApiKey;
  const apiSecret = process.env.CLOUDINARY_API_SECRET || env.cloudinaryApiSecret;
  if (!cloudName || !apiKey || !apiSecret) {
    // We log a warning instead of throwing — the server can still serve
    // every non-upload route. Uploads themselves will surface a clear
    // 503 from the controller layer below.
    console.warn('[cloudinary] credentials missing — upload routes will return 503');
    return false;
  }
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
  return true;
}
const isConfigured = configure();

/**
 * Upload a buffer (from multer's memoryStorage) to Cloudinary.
 *
 * @param {Buffer} buffer  - raw file bytes
 * @param {object} opts
 * @param {string} opts.folder        - Cloudinary folder, e.g. 'tolet-pro/verification/<userId>'
 * @param {string} [opts.publicId]    - deterministic public_id so re-uploads overwrite, e.g. 'nid_front'
 * @param {string} [opts.resourceType='image']
 * @param {string} [opts.type]        - Cloudinary delivery type. Omit for a
 *        normal public asset; pass 'authenticated' for identity documents that
 *        must not be readable without a signature. This parameter used to be
 *        accepted by callers but silently dropped here, which meant NID scans
 *        uploaded through the multipart route were stored PUBLICLY despite the
 *        call site asking for private.
 * @returns {Promise<{secureUrl:string, publicId:string, bytes:number, format:string, type:string}>}
 */
function uploadBuffer(buffer, { folder, publicId, resourceType = 'image', transformation, type } = {}) {
  if (!isConfigured) {
    const err = new Error('Cloudinary is not configured on this server.');
    err.status = 503;
    err.code = 'cloudinary_not_configured';
    throw err;
  }
  // Default transformation (used by avatar/property/verification uploads).
  // Callers can pass `transformation: null` to upload the raw file with NO
  // transformation — needed for chat media, where strict-transform / video
  // resources reject a transformed upload with a 403.
  const tx = transformation === undefined
    ? [{ quality: 'auto:good', fetch_format: 'auto' }]
    : transformation;
  return new Promise((resolve, reject) => {
    // upload_stream lets us pipe a Buffer straight into Cloudinary
    // without first writing to /tmp — important on serverless hosts.
    const uploadOpts = {
      folder,
      public_id: publicId,
      overwrite: true,        // a replace = same public_id = new version, old bytes garbage-collected
      resource_type: resourceType,
    };
    // Only attach transformation when we actually have one (skip for chat).
    if (tx) uploadOpts.transformation = tx;
    // Non-public delivery type, when the caller asked for one. Left undefined
    // for everything else so ordinary uploads keep their public URLs.
    if (type) uploadOpts.type = type;

    const stream = cloudinary.uploader.upload_stream(
      uploadOpts,
      (err, result) => {
        if (err) return reject(err);
        resolve({
          secureUrl: result.secure_url,
          publicId:  result.public_id,
          bytes:     result.bytes,
          format:    result.format,
          // Echo the delivery type back so callers can tell whether the URL
          // they just received is publicly loadable or needs signing.
          type:      result.type || 'upload',
        });
      },
    );
    stream.end(buffer);
  });
}

/**
 * Delete a single asset by its public_id. Used when a user replaces an
 * existing verification doc — we don't want stale NID scans to keep
 * eating into our 25 GB Cloudinary quota.
 *
 * `type` MUST match how the asset was uploaded. Cloudinary scopes public_ids by
 * delivery type, so destroying an 'authenticated' asset with the default
 * 'upload' type reports "not found" and quietly leaves the file in place — the
 * failure mode that matters here, because a retired tenant photo has to
 * actually be gone, not just unreferenced.
 */
async function destroy(publicId, { resourceType = 'image', type = 'upload' } = {}) {
  if (!isConfigured || !publicId) return { result: 'skipped' };
  try {
    return await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, type });
  } catch (err) {
    // Non-fatal — a stale asset is a quota leak, not a user-facing bug.
    console.warn('[cloudinary] destroy failed for', publicId, err.message);
    return { result: 'error', error: err.message };
  }
}


/**
 * Generate a signed upload signature for direct browser-to-Cloudinary uploads.
 * The frontend calls this endpoint to get a one-time signature, then uploads
 * directly to Cloudinary with that signature — the file never touches our server.
 *
 * @param {object} opts
 * @param {string} opts.folder        - Cloudinary folder path
 * @param {string} [opts.publicId]    - Optional deterministic public_id
 * @param {string} [opts.resourceType='image']
 * @returns {{ signature, timestamp, cloudName, apiKey, folder, publicId }}
 */
function generateSignature({ folder, publicId, resourceType = 'image' } = {}) {
  if (!isConfigured) {
    const err = new Error('Cloudinary is not configured on this server.');
    err.status = 503;
    err.code = 'cloudinary_not_configured';
    throw err;
  }
  const timestamp = Math.round(Date.now() / 1000);
  const params = { folder, timestamp };
  if (publicId) params.public_id = publicId;

  const signature = cloudinary.utils.api_sign_request(
    params,
    process.env.CLOUDINARY_API_SECRET || env.cloudinaryApiSecret,
  );

  return {
    signature,
    timestamp,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || env.cloudinaryCloudName,
    apiKey:    process.env.CLOUDINARY_API_KEY    || env.cloudinaryApiKey,
    folder,
    publicId:  publicId || undefined,
    resourceType,
  };
}

/**
 * Generate a signed upload signature for AUTHENTICATED (private) assets.
 * Authenticated assets require a signed URL to view — perfect for NID scans,
 * identity documents, and other sensitive files that must not be publicly
 * accessible.
 *
 * @param {object} opts
 * @param {string} opts.folder
 * @param {string} [opts.publicId]
 * @returns {{ signature, timestamp, cloudName, apiKey, folder, publicId, type }}
 */
function generateAuthenticatedSignature({ folder, publicId } = {}) {
  if (!isConfigured) {
    const err = new Error('Cloudinary is not configured on this server.');
    err.status = 503;
    err.code = 'cloudinary_not_configured';
    throw err;
  }
  const timestamp = Math.round(Date.now() / 1000);
  const params = { folder, timestamp, type: 'authenticated' };
  if (publicId) params.public_id = publicId;

  const signature = cloudinary.utils.api_sign_request(
    params,
    process.env.CLOUDINARY_API_SECRET || env.cloudinaryApiSecret,
  );

  return {
    signature,
    timestamp,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || env.cloudinaryCloudName,
    apiKey:    process.env.CLOUDINARY_API_KEY    || env.cloudinaryApiKey,
    folder,
    publicId: publicId || undefined,
    type: 'authenticated',
  };
}

/**
 * Read the DELIVERY TYPE back out of a stored Cloudinary URL.
 *
 * Cloudinary URLs are shaped
 *   https://res.cloudinary.com/<cloud>/<resource_type>/<type>/<version>/<public_id>
 * e.g. /image/upload/…        → public asset, no signature needed
 *      /image/authenticated/… → needs sign_url to view
 *      /image/private/…       → original only via private_download_url
 *
 * We need this because our uploads are deliberately MIXED: NID scans go up as
 * `authenticated`, while the profile photo is public (it doubles as the user's
 * avatar). The stored secure_url is the only record of which is which, so it's
 * the source of truth rather than an assumption.
 *
 * @param {string} url
 * @returns {string} 'upload' | 'authenticated' | 'private' | 'fetch' | '' when unparseable
 */
function deliveryTypeFromUrl(url) {
  const m = /\/(?:image|video|raw)\/([a-z_]+)\//i.exec(String(url || ''));
  return m ? m[1].toLowerCase() : '';
}

/**
 * Generate a signed URL for viewing a NON-PUBLIC asset.
 *
 * @param {string} publicId
 * @param {object} [opts]
 * @param {string} [opts.resourceType='image']
 * @param {string} [opts.type='authenticated'] — MUST match how the asset was
 *        uploaded. Signing a public `upload` asset as `authenticated` produces
 *        a URL for an object that doesn't exist, which Cloudinary answers with
 *        401/404 — it does not silently fall back to the public copy.
 * @returns {string} signed URL, or '' when Cloudinary isn't configured
 */
function generateSignedViewUrl(publicId, { resourceType = 'image', type = 'authenticated' } = {}) {
  if (!isConfigured || !publicId) return '';
  return cloudinary.url(publicId, {
    sign_url: true,
    type,
    resource_type: resourceType,
    secure: true,
    // Note: sign_url produces a signature that is permanently valid for this
    // exact publicId + transformation. For genuine expiry use
    // cloudinary.utils.private_download_url and serve it through an endpoint.
  });
}

/**
 * Resolve a stored document URL into something an <img> can actually load.
 *
 * This is the function callers should reach for. It signs only what needs
 * signing and passes public assets straight through, which is the bug it was
 * written to fix: the admin console used to sign EVERY verification document as
 * `authenticated`, so the NID tiles worked (they really are authenticated) while
 * the profile photo and the landlord's utility bill — both public `upload`
 * assets — rendered as broken images.
 *
 * @param {object} args
 * @param {string} [args.publicId] — Cloudinary public_id, if we recorded one
 * @param {string} [args.url]      — the stored secure_url; carries the type
 * @param {string} [args.resourceType='image']
 * @returns {string} a loadable URL ('' when we have nothing at all)
 */
function signedViewUrlFor({ publicId, url, resourceType = 'image' } = {}) {
  const stored = String(url || '');
  if (!publicId) return stored;

  const type = deliveryTypeFromUrl(stored);

  // Public asset — the stored URL already works. Signing it would break it.
  if (type === 'upload' || type === 'fetch') return stored;

  // Non-public, or an unparseable/absent URL. Fall back to 'authenticated',
  // which is what every private upload path in this codebase produces.
  const signed = generateSignedViewUrl(publicId, {
    resourceType,
    type: type === 'private' ? 'private' : 'authenticated',
  });
  return signed || stored;
}

module.exports = {
  uploadBuffer,
  destroy,
  isConfigured,
  generateSignature,
  generateAuthenticatedSignature,
  generateSignedViewUrl,
  signedViewUrlFor,
  deliveryTypeFromUrl,
};