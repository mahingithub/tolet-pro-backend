'use strict';

const authService = require('../services/auth.service');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

exports.signupStart = asyncH(async (req, res) => {
  const out = await authService.startSignup(req.body);
  res.status(202).json({
    message: 'OTP পাঠানো হয়েছে। ফোনে চেক করুন।',
    expiresAt: out.expiresAt,
  });
});

exports.signupVerify = asyncH(async (req, res) => {
  const { token, user } = await authService.verifySignup(req.body);
  res.status(201).json({
    message: 'অ্যাকাউন্ট তৈরি সফল হয়েছে!',
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

exports.forgotStart = asyncH(async (req, res) => {
  await authService.startForgotPassword(req.body);
  // Constant response — never reveal whether the account exists.
  res.status(202).json({ message: 'যদি অ্যাকাউন্ট থাকে, OTP পাঠানো হয়েছে।' });
});

exports.forgotVerify = asyncH(async (req, res) => {
  const { resetToken } = await authService.verifyForgotPassword(req.body);
  res.json({ resetToken });
});

exports.resetPassword = asyncH(async (req, res) => {
  await authService.resetPassword(req.body);
  res.json({ message: 'পাসওয়ার্ড পরিবর্তন সফল হয়েছে। আবার লগইন করুন।' });
});

exports.me = asyncH(async (req, res) => {
  res.json({ user: req.user });
});

exports.logout = asyncH(async (_req, res) => {
  // Stateless JWT — the client just drops the token.
  res.json({ ok: true });
});
