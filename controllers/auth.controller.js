'use strict';

const authService = require('../services/auth.service');
const refreshTokenService = require('../services/refreshToken.service');
const loginHistory = require('../services/loginHistory.service');
const refreshCookie = require('../utils/refreshCookie');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

exports.signupStart = asyncH(async (req, res) => {
  const out = await authService.startSignup(req.body, req);
  res.status(202).json({
    code: 'OTP_SENT_SUCCESS',
    message: 'OTP sent. Please check your phone.',
    expiresAt: out.expiresAt,
    // Include abuse protection status for client-side handling
    enforcementLevel: out.enforcementLevel,
    requiresCaptcha: out.requiresCaptcha,
  });
});

exports.signupVerify = asyncH(async (req, res) => {
  // Body is now { phoneNumber, otp } (validated + normalised by the validator).
  const { token, user } = await authService.verifySignup(req.body, req);
  
  // Issue refresh token for the session
  const sessionId = user.sessions && user.sessions.length > 0 
    ? user.sessions[user.sessions.length - 1].sessionId 
    : null;
  
  let refreshToken = null;
  if (sessionId) {
    refreshToken = await refreshTokenService.issueRefreshToken({
      userId: user._id,
      sessionId,
      ipAddress: req.ip || '0.0.0.0',
      userAgent: req.headers['user-agent'],
    });
    
    // Set refresh token as httpOnly cookie (30 days)
    res.cookie('refreshToken', refreshToken, refreshCookie.setOptions());
    
    // Record login in history
    await loginHistory.safeLog(
      loginHistory.recordSuccessfulLogin,
      req, user, sessionId, { loginType: 'signup' }
    );
  }
  
  res.status(201).json({
    code: 'ACCOUNT_CREATED_SUCCESS',
    message: 'Account created successfully!',
    token, // Short-lived access token (15m)
    user,
  });
});

exports.login = asyncH(async (req, res) => {
  const payload = {
    ...req.body,
    device: req.headers['user-agent'] || 'Unknown device',
    ipAddress: req.ip || '0.0.0.0'
  };
  const { token, user } = await authService.login(payload);
  
  // Issue refresh token for the session
  const sessionId = user.sessions && user.sessions.length > 0 
    ? user.sessions[user.sessions.length - 1].sessionId 
    : null;
  
  let refreshToken = null;
  if (sessionId) {
    refreshToken = await refreshTokenService.issueRefreshToken({
      userId: user._id,
      sessionId,
      ipAddress: req.ip || '0.0.0.0',
      userAgent: req.headers['user-agent'],
    });
    
    // Set refresh token as httpOnly cookie (30 days)
    res.cookie('refreshToken', refreshToken, refreshCookie.setOptions());
    
    // Record login in history
    await loginHistory.safeLog(
      loginHistory.recordSuccessfulLogin,
      req, user, sessionId, { loginType: 'password' }
    );
  }
  
  res.json({ 
    token, // Short-lived access token (15m)
    user 
  });
});

// ─── Forgot password (OTP via sms.net.bd) ───────────────────────────────────
// Step 1: request an OTP. Body: { phoneNumber, captchaToken? }.
exports.forgotPassword = asyncH(async (req, res) => {
  await authService.forgotPassword(req.body, req);
  // Constant response — never reveal whether the account exists.
  res.status(202).json({
    code: 'FORGOT_OTP_SENT',
    message: 'If the account exists, an OTP has been sent.',
  });
});

// Step 2: verify OTP + set the new password. Body: { phoneNumber, otp, newPassword }.
exports.resetPassword = asyncH(async (req, res) => {
  await authService.resetPassword(req.body, req);
  res.json({
    code: 'PASSWORD_RESET_SUCCESS',
    message: 'Password reset successful. Please log in again.',
  });
});

exports.me = asyncH(async (req, res) => {
  res.json({ user: req.user });
});

exports.logout = asyncH(async (req, res) => {
  // Revoke the current session server-side so the token can't be replayed.
  // This matches the admin logout flow and prevents token reuse after logout.
  if (req.sessionId && Array.isArray(req.user.sessions)) {
    req.user.sessions = req.user.sessions.filter((s) => s.sessionId !== req.sessionId);
    await req.user.save();
    
    // Also revoke any refresh tokens for this session
    await refreshTokenService.revokeSessionTokens(req.sessionId);
    
    // Record logout in history
    await loginHistory.safeLog(loginHistory.recordLogout, req.sessionId);
  }
  
  // Clear refresh token cookie
  res.clearCookie('refreshToken', refreshCookie.clearOptions());
  
  res.json({ ok: true });
});

exports.logoutAll = asyncH(async (req, res) => {
  // Revoke ALL sessions — useful when the user suspects their account is
  // compromised or wants to forcibly sign out all devices (e.g., after
  // changing password, or from a "Sessions" management page).
  const sessionIds = (req.user.sessions || []).map(s => s.sessionId);
  
  req.user.sessions = [];
  await req.user.save();
  
  // Also revoke all refresh tokens for this user
  await refreshTokenService.revokeAllUserTokens(req.user._id);
  
  // Record logout in history for all active sessions
  await Promise.all(
    sessionIds.map(sid => loginHistory.safeLog(loginHistory.recordLogout, sid))
  );
  
  // Clear refresh token cookie
  res.clearCookie('refreshToken', refreshCookie.clearOptions());
  
  res.json({ 
    ok: true, 
    message: 'All sessions revoked. Please log in again on all devices.',
    code: 'all_sessions_revoked'
  });
});
