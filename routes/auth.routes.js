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
const refreshTokenService = require('../services/refreshToken.service');
const loginHistory = require('../services/loginHistory.service');

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
router.post('/logout-all', requireAuth, ctl.logoutAll);

// ─── Refresh Token ─────────────────────────────────────────────────────────
// POST /api/auth/refresh (reads refreshToken from httpOnly cookie)
// Rotates refresh token and issues new access token
router.post('/refresh', rl.refresh, async (req, res, next) => {
  try {
    // Read refresh token from cookie (not body)
    const refreshToken = req.cookies?.refreshToken;
    
    if (!refreshToken) {
      return res.status(401).json({
        code: 'missing_refresh_token',
        message: 'Refresh token not found. Please log in again.',
      });
    }
    
    const result = await refreshTokenService.rotateRefreshToken(refreshToken, {
      ipAddress: req.ip || '0.0.0.0',
      userAgent: req.headers['user-agent'],
    });
    
    // Set new refresh token as httpOnly cookie
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });
    
    res.json({
      token: result.accessToken, // New short-lived access token (15m)
      user: result.user,
    });
  } catch (err) {
    // Clear cookie on error
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });
    next(err);
  }
});

// GET /api/auth/sessions (requires auth)
// Get all active sessions for current user
router.get('/sessions', requireAuth, async (req, res, next) => {
  try {
    const sessions = await refreshTokenService.getActiveSessions(req.user._id);
    
    res.json({
      sessions,
      currentSessionId: req.sessionId,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/auth/sessions/:sessionId (requires auth)
// Revoke a specific session
router.delete('/sessions/:sessionId', requireAuth, async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    
    // Verify ownership: check if this sessionId belongs to the current user
    const ownsSession = req.user.sessions && req.user.sessions.some(s => s.sessionId === sessionId);
    if (!ownsSession) {
      return res.status(403).json({
        code: 'forbidden',
        message: 'এই সেশনটি বাতিল করার অনুমতি আপনার নেই।',
      });
    }
    
    // Revoke all refresh tokens for this session
    const count = await refreshTokenService.revokeSessionTokens(sessionId);
    
    // Also remove session from User.sessions array
    req.user.sessions = req.user.sessions.filter(s => s.sessionId !== sessionId);
    await req.user.save();
    
    // Mark as logged out in login history
    await loginHistory.recordLogout(sessionId);
    
    res.json({
      ok: true,
      message: 'সেশন বাতিল করা হয়েছে।',
      revokedCount: count,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Login History ──────────────────────────────────────────────────────────
// GET /api/auth/login-history (requires auth)
// Get user's login history
router.get('/login-history', requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const history = await loginHistory.getUserHistory(req.user._id, limit);
    
    res.json({
      history,
      total: history.length,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/active-sessions (requires auth)
// Get user's active login sessions (from LoginHistory)
router.get('/active-sessions', requireAuth, async (req, res, next) => {
  try {
    const sessions = await loginHistory.getActiveSessions(req.user._id);
    
    res.json({
      sessions,
      currentSessionId: req.sessionId,
    });
  } catch (err) {
    next(err);
  }
});

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