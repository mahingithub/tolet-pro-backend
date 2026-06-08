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
 * @returns {Promise<{secureUrl:string, publicId:string, bytes:number, format:string}>}
 */
function uploadBuffer(buffer, { folder, publicId, resourceType = 'image', transformation } = {}) {
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

    const stream = cloudinary.uploader.upload_stream(
      uploadOpts,
      (err, result) => {
        if (err) return reject(err);
        resolve({
          secureUrl: result.secure_url,
          publicId:  result.public_id,
          bytes:     result.bytes,
          format:    result.format,
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
 */
async function destroy(publicId, { resourceType = 'image' } = {}) {
  if (!isConfigured || !publicId) return { result: 'skipped' };
  try {
    return await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (err) {
    // Non-fatal — a stale asset is a quota leak, not a user-facing bug.
    console.warn('[cloudinary] destroy failed for', publicId, err.message);
    return { result: 'error', error: err.message };
  }
}

module.exports = { uploadBuffer, destroy, isConfigured };