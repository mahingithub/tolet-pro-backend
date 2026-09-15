'use strict';

const { z } = require('zod');
const { mobileCountryOf } = require('../utils/phoneCountries');

// E.164 (+ followed by 8-15 digits). The frontend should always send phone in this form.
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'ফোন নম্বর সঠিক ফরম্যাটে দিন। উদাঃ +8801XXXXXXXXX');

// Phone verification only supports the app's listed countries: Bangladesh by
// the code our server texts, the rest through Firebase — whose SMS region
// policy must allow the same list, because clients request that SMS from
// Firebase directly. Password login keeps the general E.164 rule, so no
// existing account is locked out.
const otpPhoneSchema = phoneSchema.refine((p) => Boolean(mobileCountryOf(p)), {
  message: 'এই নম্বরে কোড পাঠানো যায় না। বাংলাদেশ বা তালিকার কোনো দেশের মোবাইল নম্বর দিন।',
});

const passwordSchema = z
  .string()
  .min(8, 'পাসওয়ার্ড অন্তত ৮ অক্ষরের হতে হবে।')
  .max(128, 'পাসওয়ার্ড অনেক বড়।')
  .regex(/[A-Za-z]/, 'পাসওয়ার্ডে অন্তত একটি অক্ষর থাকতে হবে।')
  .regex(/\d/, 'পাসওয়ার্ডে অন্তত একটি সংখ্যা থাকতে হবে।');

const nameSchema = z.string().trim().min(2, 'নাম অন্তত ২ অক্ষরের হতে হবে।').max(80);

const roleSchema = z.enum(['tenant', 'landlord']).optional();

// 6-digit numeric OTP texted by our server via sms.net.bd (Bangladesh).
const otpSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'OTP অবশ্যই ৬ সংখ্যার হতে হবে।');

// What proves the phone: the texted OTP for Bangladesh, or — abroad — a
// Firebase ID token plus the server-issued challenge id it is redeemed against.
const proofShape = {
  otp: otpSchema.optional(),
  firebaseIdToken: z.string().min(1).max(16384).optional(),
  verificationId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
};
const captchaTokenSchema = z.string().max(4096).optional();

/** The proof must be the kind this number's channel issues — never the other. */
function proofMatchesChannel(d) {
  const bangladeshi = mobileCountryOf(d.phoneNumber || d.phone)?.iso === 'BD';
  if (bangladeshi) return Boolean(d.otp) && !d.firebaseIdToken && !d.verificationId;
  return Boolean(d.firebaseIdToken && d.verificationId) && !d.otp;
}

/**
 * The OTP endpoints accept the phone under `phoneNumber` (preferred, matches
 * the Otp model) OR `phone` (alias, matches the rest of the app). This helper
 * builds a schema that requires one of them plus the given extra fields, and
 * normalises the output to always carry `phoneNumber` so the service layer has
 * a single field to read. `proof: true` adds the OTP / Firebase proof fields.
 */
function phoneOtpSchema(extraShape = {}, { phone = phoneSchema, proof = false } = {}) {
  let schema = z
    .object({
      phone: phone.optional(),
      phoneNumber: phone.optional(),
      ...(proof ? proofShape : {}),
      ...extraShape,
    })
    .refine((d) => d.phoneNumber || d.phone, {
      message: 'ফোন নম্বর দিন।',
      path: ['phoneNumber'],
    })
    .refine((d) => !d.phone || !d.phoneNumber || d.phone === d.phoneNumber, {
      message: 'ফোন নম্বর দুটি একই হতে হবে।',
      path: ['phoneNumber'],
    });
  if (proof) {
    schema = schema.refine(proofMatchesChannel, {
      message: 'যাচাইয়ের তথ্য সঠিক নয়। নতুন কোড নিয়ে আবার চেষ্টা করুন।',
      path: ['otp'],
    });
  }
  return schema.transform(({ phone: p, phoneNumber, ...rest }) => ({
    phoneNumber: phoneNumber || p,
    ...rest,
  }));
}

module.exports = {
  signupStart: z.object({
    name: nameSchema,
    phone: otpPhoneSchema,
    password: passwordSchema,
    role: roleSchema,
    captchaToken: captchaTokenSchema,
  }),

  // { phoneNumber | phone, otp } (BD) or { …, firebaseIdToken, verificationId } (abroad)
  signupVerify: phoneOtpSchema({}, { phone: otpPhoneSchema, proof: true }),

  login: z.object({
    phone: phoneSchema,
    password: z.string().min(1, 'পাসওয়ার্ড দিন।'),
  }),

  // { phoneNumber | phone }  → normalised to { phoneNumber }
  forgotPassword: phoneOtpSchema({ captchaToken: captchaTokenSchema }, { phone: otpPhoneSchema }),

  // { phoneNumber | phone, <proof>, newPassword }  → normalised
  resetPassword: phoneOtpSchema({ newPassword: passwordSchema }, { phone: otpPhoneSchema, proof: true }),
};
