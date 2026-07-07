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

// 6-digit numeric OTP delivered via sms.net.bd.
const otpSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'OTP অবশ্যই ৬ সংখ্যার হতে হবে।');

/**
 * The OTP endpoints accept the phone under `phoneNumber` (preferred, matches
 * the Otp model) OR `phone` (alias, matches the rest of the app). This helper
 * builds a schema that requires exactly one of them plus the given extra
 * fields, and normalises the output to always carry `phoneNumber` so the
 * service layer has a single field to read.
 */
function phoneOtpSchema(extraShape = {}) {
  return z
    .object({
      phone: phoneSchema.optional(),
      phoneNumber: phoneSchema.optional(),
      ...extraShape,
    })
    .refine((d) => d.phoneNumber || d.phone, {
      message: 'ফোন নম্বর দিন।',
      path: ['phoneNumber'],
    })
    .transform(({ phone, phoneNumber, ...rest }) => ({
      phoneNumber: phoneNumber || phone,
      ...rest,
    }));
}

module.exports = {
  signupStart: z.object({
    name: nameSchema,
    phone: phoneSchema,
    password: passwordSchema,
    role: roleSchema,
  }),

  // { phoneNumber | phone, otp }  → normalised to { phoneNumber, otp }
  signupVerify: phoneOtpSchema({ otp: otpSchema }),

  login: z.object({
    phone: phoneSchema,
    password: z.string().min(1, 'পাসওয়ার্ড দিন।'),
  }),

  // { phoneNumber | phone }  → normalised to { phoneNumber }
  forgotPassword: phoneOtpSchema(),

  // { phoneNumber | phone, otp, newPassword }  → normalised
  resetPassword: phoneOtpSchema({
    otp: otpSchema,
    newPassword: passwordSchema,
  }),
};
