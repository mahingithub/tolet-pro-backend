'use strict';

/**
 * uploadMiddleware.js
 * ─────────────────────────────────────────────────────────────────────────
 * multer in memoryStorage mode. We never touch the disk — the buffer is
 * piped straight to Cloudinary by `cloudinary.service.uploadBuffer`. This
 * works identically on local dev, Render, Railway, Fly.io etc.
 *
 * Size cap is set generously here (8 MB) so multer doesn't reject the
 * request before the controller can return a friendlier per-mime-type
 * error. The real hard cap (5 MB) is enforced inside the controller.
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

// Field name on the multipart form must be exactly `file`. The dashboard
// will use `formData.append('file', blob)` so this stays simple.
module.exports = {
  uploadSingle: upload.single('file'),
};