'use strict';

/**
 * rentPayment.routes — tenant manual rent submissions + landlord verification.
 * Screenshot proof uploads use multer memoryStorage → Cloudinary.
 */

const express     = require('express');
const multer      = require('multer');
const router      = express.Router();
const requireAuth = require('../middleware/requireAuth');
const ctrl        = require('../controllers/rentPayment.controller');

// Payment screenshot — images only, memory storage → Cloudinary.
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|jpg|png|webp)$/.test(file.mimetype || '');
    if (ok) return cb(null, true);
    cb(new Error('শুধু ছবি (JPG/PNG/WEBP) আপলোড করা যাবে।'));
  },
});

function handleUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'ছবি সর্বোচ্চ ৮MB হতে পারে।'
        : (err.message || 'আপলোড ব্যর্থ হয়েছে।');
      return res.status(400).json({ message: msg, code: err.code || 'upload_error' });
    }
    next();
  });
}

// Tenant.
router.post('/',                  requireAuth, ctrl.submitPayment);
router.post('/:id/screenshot',    requireAuth, handleUpload, ctrl.uploadScreenshot);
router.get('/tenant',             requireAuth, ctrl.listTenantSubmissions);

// Landlord.
router.get('/host',               requireAuth, ctrl.listHostSubmissions);
router.post('/:id/approve',       requireAuth, ctrl.approveSubmission);
router.post('/:id/reject',        requireAuth, ctrl.rejectSubmission);
router.delete('/:id',             requireAuth, ctrl.deleteSubmission);

module.exports = router;
