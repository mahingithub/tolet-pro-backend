'use strict';

const express     = require('express');
const multer      = require('multer');
const router      = express.Router();
const requireAuth = require('../middleware/requireAuth');
const { uploadDocument, listDocuments, deleteDocument, saveDirectDocument } = require('../controllers/document.controller');

// Memory storage → hand the buffer straight to Cloudinary (no disk writes,
// works on Render's ephemeral filesystem).
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const ok = /^(image\/(jpeg|jpg|png|webp|gif)|application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document)$/
      .test(file.mimetype || '');
    if (ok) return cb(null, true);
    cb(new Error('শুধু PDF, DOCX বা ছবি (JPG/PNG) আপলোড করা যাবে।'));
  },
});

// Wrap multer so size/type errors return a clean 400 instead of a raw 500.
function handleUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'ফাইল সর্বোচ্চ ১০MB হতে পারে।'
        : (err.message || 'আপলোড ব্যর্থ হয়েছে।');
      return res.status(400).json({ message: msg, code: err.code || 'upload_error' });
    }
    next();
  });
}

router.get('/',        requireAuth, listDocuments);
router.post('/',       requireAuth, handleUpload, uploadDocument);
router.post('/direct', requireAuth, saveDirectDocument);
router.delete('/:id',  requireAuth, deleteDocument);

module.exports = router;