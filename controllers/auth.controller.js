'use strict';

const authService = require('../services/auth.service');
const refreshTokenService = require('../services/refreshToken.service');
const loginHistory = require('../services/loginHistory.service');
const refreshCookie = require('../utils/refreshCookie');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

exports.signupStart = asyncH(async (req, res) => {
  const out = await authService.startSignup(req.body, req);
  const firebase = out.provider === 'firebase';
  res.status(202).json({
    // Bangladesh: our server already texted the code. Abroad: the client now
    // asks Firebase for the SMS, bound to `verificationId`.
    code: firebase ? 'FIREBASE_PHONE_READY' : 'OTP_SENT_SUCCESS',
    message: firebase ? 'Continue with Firebase phone verification.' : 'OTP sent. Please check your phone.',
    provider: out.provider,
    verificationId: out.verificationId,
    expiresAt: out.expiresAt,
    // Include abuse protection status for client-side handling
    enforcementLevel: out.enforcementLevel,
    requiresCaptcha: out.requiresCaptcha,
  });
});

exports.signupVerify = asyncH(async (req, res) => {
  // A texted OTP (Bangladesh) or a Firebase ID token bound to its one-use
  // challenge (abroad) — either is verified server-side before an account exists.
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
    res.cookie('refreshToken', refreshToken, refreshCookie.setOptions(req));
    
    // Record login in history
    await loginHistory.safeLog(
      loginHistory.recordSuccessfulLogin,
      req, user, sessionId, {
        loginType: 'otp',
        metadata: { provider: authService.otpChannel(user.phone), action: 'signup' },
      }
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
    res.cookie('refreshToken', refreshToken, refreshCookie.setOptions(req));
    
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

// Step 1: Bangladesh — text a code if the account exists; abroad — issue a
// Firebase challenge. Constant per channel: never reveals whether the account exists.
exports.forgotPassword = asyncH(async (req, res) => {
  const out = await authService.forgotPassword(req.body, req);
  const firebase = out.provider === 'firebase';
  res.status(202).json({
    code: firebase ? 'FIREBASE_PHONE_READY' : 'FORGOT_OTP_SENT',
    message: firebase ? 'Continue with Firebase phone verification.' : 'If the account exists, an OTP has been sent.',
    provider: out.provider,
    verificationId: out.verificationId,
    expiresAt: out.expiresAt,
  });
});

// Step 2: verify the OTP or Firebase proof and set the new password.
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
  res.clearCookie('refreshToken', refreshCookie.clearOptions(req));
  
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
  res.clearCookie('refreshToken', refreshCookie.clearOptions(req));
  
  res.json({ 
    ok: true, 
    message: 'All sessions revoked. Please log in again on all devices.',
    code: 'all_sessions_revoked'
  });
});
