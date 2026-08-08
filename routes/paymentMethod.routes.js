'use strict';

/**
 * paymentMethod.routes — landlord manual-payment accounts (V1, no gateway).
 * QR image uploads use multer memoryStorage → Cloudinary (see controller).
 */

const express     = require('express');
const multer      = require('multer');
const router      = express.Router();
const requireAuth = require('../middleware/requireAuth');
const ctrl        = require('../controllers/paymentMethod.controller');

// Images only for the QR — memory storage, buffer piped to Cloudinary.
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|jpg|png|webp)$/.test(file.mimetype || '');
    if (ok) return cb(null, true);
    cb(new Error('শুধু ছবি (JPG/PNG/WEBP) আপলোড করা যাবে।'));
  },
});

// Wrap multer so size/type errors return a clean 400 instead of a raw 500.
function handleUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'ছবি সর্বোচ্চ ৫MB হতে পারে।'
        : (err.message || 'আপলোড ব্যর্থ হয়েছে।');
      return res.status(400).json({ message: msg, code: err.code || 'upload_error' });
    }
    next();
  });
}

// Tenant read (must come before '/:id' so it isn't shadowed).
router.get('/booking/:bookingId', requireAuth, ctrl.listForBooking);

// Landlord CRUD.
router.get('/',            requireAuth, ctrl.listMyMethods);
router.post('/',           requireAuth, ctrl.createMethod);
router.patch('/:id',       requireAuth, ctrl.updateMethod);
router.delete('/:id',      requireAuth, ctrl.deleteMethod);

// QR image.
router.post('/:id/qr',     requireAuth, handleUpload, ctrl.uploadQr);
router.post('/:id/direct-qr', requireAuth, ctrl.saveDirectQr);
router.delete('/:id/qr',   requireAuth, ctrl.deleteQr);

module.exports = router;
