'use strict';

const { z } = require('zod');

// E.164 (+ followed by 8-15 digits). The frontend should always send phone in this form.
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+\d{8,15}$/, 'ফোন নম্বর সঠিক ফরম্যাটে দিন। উদাঃ +8801XXXXXXXXX');

const passwordSchema = z
  .string()
  .min(8, 'পাসওয়ার্ড অন্তত ৮ অক্ষরের হতে হবে।')
  .max(128, 'পাসওয়ার্ড অনেক বড়।')
  .regex(/[A-Za-z]/, 'পাসওয়ার্ডে অন্তত একটি অক্ষর থাকতে হবে।')
  .regex(/\d/, 'পাসওয়ার্ডে অন্তত একটি সংখ্যা থাকতে হবে।');

const nameSchema = z.string().trim().min(2, 'নাম অন্তত ২ অক্ষরের হতে হবে।').max(80);

const roleSchema = z.enum(['tenant', 'landlord']).optional();

const idTokenSchema = z.string().min(20, 'Firebase ID token দেওয়া হয়নি।');

const resetTokenSchema = z.string().min(20, 'Reset token দেওয়া হয়নি।');

module.exports = {
  signupStart: z.object({
    name: nameSchema,
    phone: phoneSchema,
    password: passwordSchema,
    role: roleSchema,
  }),
  signupVerify: z.object({
    idToken: idTokenSchema,
  }),
  login: z.object({
    phone: phoneSchema,
    password: z.string().min(1, 'পাসওয়ার্ড দিন।'),
  }),
  forgotStart: z.object({
    phone: phoneSchema,
  }),
  forgotVerify: z.object({
    idToken: idTokenSchema,
  }),
  resetPassword: z.object({
    resetToken: resetTokenSchema,
    password: passwordSchema,
  }),
};
