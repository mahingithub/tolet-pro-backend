'use strict';

const express = require('express');
const multer  = require('multer');
const ctl = require('../controllers/auth.controller');
const additions = require('../controllers/auth.controller.additions');
const { uploadDoc, deleteDoc } = require('../controllers/verification.controller');
const { uploadSingle } = require('../middleware/uploadMiddleware');
const v = require('../validators/auth.validators');
const validate = require('../middleware/validate');
const requireAuth = require('../middleware/requireAuth');
const rl = require('../middleware/rateLimit');

// Multi-file upload for the landlord-verification submit. We mount a
// dedicated multer instance here rather than extending uploadMiddleware
// so the original single-file flow stays untouched. memoryStorage keeps
// the buffer in RAM long enough for the controller to stream it to
// Cloudinary. 5MB ceiling matches the existing uploadSingle defaults.
const uploadLandlordVerificationFields = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },
}).fields([
  { name: 'utilityBill',     maxCount: 1 },
  { name: 'nidFront',        maxCount: 1 },
  { name: 'nidBack',         maxCount: 1 },
  { name: 'photo',           maxCount: 1 },
]);

const router = express.Router();

// ─── Signup (OTP via sms.net.bd) ────────────────────────────────────────────
// signup/start  → hashes password, saves SignupIntent, texts a 6-digit OTP.
// signup/verify → { phoneNumber, otp }; finalizes the User + logs in.
router.post('/signup/start', rl.signup, validate(v.signupStart), ctl.signupStart);
router.post('/signup/verify', rl.signup, validate(v.signupVerify), ctl.signupVerify);

// ─── Login (no OTP) ─────────────────────────────────────────────────────────
router.post('/login', rl.login, validate(v.login), ctl.login);

// ─── Forgot password (OTP via sms.net.bd) ───────────────────────────────────
// forgot-password → { phoneNumber }; texts an OTP (constant response).
// reset-password  → { phoneNumber, otp, newPassword }; verifies OTP + resets.
router.post('/forgot-password', rl.sendOtp, validate(v.forgotPassword), ctl.forgotPassword);
router.post('/reset-password', rl.reset, validate(v.resetPassword), ctl.resetPassword);

// ─── Session ───────────────────────────────────────────────────────────────
router.get('/me', requireAuth, ctl.me);
router.post('/logout', requireAuth, ctl.logout);

// ─── Profile + multi-role + verification (roadmap-v2 / tenant roadmap) ───────
// These were previously orphaned in `controllers/auth.controller.additions.js`
// without a route binding, which is why the Navbar's "Switch to Host / Tenant"
// button silently did nothing — the POST returned 404 and the optimistic UI
// state reverted. Wiring them here makes role switching + verification
// submission actually reach the backend and persist across reloads.
router.patch('/me',                     requireAuth, additions.patchMe);
router.post ('/me/roles',               requireAuth, additions.addRole);
router.post ('/me/active-role',         requireAuth, additions.setActiveRole);
router.post ('/me/verification/submit', requireAuth, additions.submitVerification);

// ─── Avatar upload (Cloudinary, multipart) ──────────────────────────────────
router.post ('/me/avatar',              requireAuth, uploadSingle, additions.uploadAvatar);

// ─── Landlord verification submission (Path A or B — see controller) ────────
// Multi-file upload. Path A (verified tenant) sends only utilityBill.
// Path B // Requires multipart/form-data: utilityBill, nidFront, nidBack, photo. The controller decides which path applies.
router.post(
  '/me/landlord-verification/submit',
  requireAuth,
  uploadLandlordVerificationFields,
  additions.submitLandlordVerification,
);

router.post ('/me/verification/upload/:kind', requireAuth, uploadSingle, uploadDoc);
router.delete('/me/verification/upload/:kind', requireAuth, deleteDoc);

module.exports = router;