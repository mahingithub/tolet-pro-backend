'use strict';

const authService = require('../services/auth.service');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

exports.signupStart = asyncH(async (req, res) => {
  const out = await authService.startSignup(req.body);
  res.status(202).json({
    code: 'OTP_SENT_SUCCESS',
    message: 'OTP sent. Please check your phone.',
    expiresAt: out.expiresAt,
  });
});

exports.signupVerify = asyncH(async (req, res) => {
  // Body is now { phoneNumber, otp } (validated + normalised by the validator).
  const { token, user } = await authService.verifySignup(req.body);
  res.status(201).json({
    code: 'ACCOUNT_CREATED_SUCCESS',
    message: 'Account created successfully!',
    token,
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
  res.json({ token, user });
});

// ─── Forgot password (OTP via sms.net.bd) ───────────────────────────────────
// Step 1: request an OTP. Body: { phoneNumber }.
exports.forgotPassword = asyncH(async (req, res) => {
  await authService.forgotPassword(req.body);
  // Constant response — never reveal whether the account exists.
  res.status(202).json({
    code: 'FORGOT_OTP_SENT',
    message: 'If the account exists, an OTP has been sent.',
  });
});

// Step 2: verify OTP + set the new password. Body: { phoneNumber, otp, newPassword }.
exports.resetPassword = asyncH(async (req, res) => {
  await authService.resetPassword(req.body);
  res.json({
    code: 'PASSWORD_RESET_SUCCESS',
    message: 'Password reset successful. Please log in again.',
  });
});

exports.me = asyncH(async (req, res) => {
  res.json({ user: req.user });
});

exports.logout = asyncH(async (_req, res) => {
  // Stateless JWT — the client just drops the token.
  res.json({ ok: true });
});
