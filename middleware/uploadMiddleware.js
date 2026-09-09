'use strict';

/**
 * uploadMiddleware.js
 * ─────────────────────────────────────────────────────────────────────────
 * multer in memoryStorage mode. We never touch the disk — the buffer is
 * piped straight to Cloudinary by `cloudinary.service.uploadBuffer`. This
 * works identically on local dev, Render, Railway, Fly.io etc.
 *
 * Two instances, because "one generous cap for everything" is wrong in both
 * directions: chat has to carry short video clips, while an avatar or a NID
 * photo is a still image that no honest client sends 20 MB of.
 *
 * When either cap trips, multer aborts the stream and raises a MulterError
 * with code LIMIT_FILE_SIZE, which errorHandler maps to 413 — see
 * middleware/errorHandler.js.
 */

const multer = require('multer');

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    // 22 MB safety net so short video clips (hard-capped at 20 MB in
    // chat.service) get through; images/voice/docs are capped tighter there.
    fileSize: 22 * 1024 * 1024,
    files: 1,
  },
});

// Stills only: avatars and KYC documents. Both controllers already hard-cap
// at 5 MB after the fact, but doing it here means an oversized upload is cut
// off mid-stream instead of being buffered into RAM in full and then thrown
// away — the request never reaches Cloudinary at all.
const imageUpload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
});

// Field name on the multipart form must be exactly `file`. The dashboard
// will use `formData.append('file', blob)` so this stays simple.
module.exports = {
  uploadSingle: upload.single('file'),
  uploadSingleImage: imageUpload.single('file'),
};