'use strict';

/**
 * tenantSelfOnboarding.js — what a tenant filling in their OWN record owes.
 * ──────────────────────────────────────────────────────────────────────────
 * THE ASYMMETRY THIS FILE EXISTS TO HOLD
 * booking.controller's sanitiseTenantProfile says, correctly, that nothing on a
 * tenant profile is required: "a tenant with no NID, no student ID and no
 * permanent address is a completely valid record". That is the rule for a
 * LANDLORD, who is writing down what they know about somebody else, and it does
 * not change — the day it starts refusing saves is the day the landlord goes
 * back to the খাতা.
 *
 * A tenant filling in their own record through a QR / invite link is the other
 * situation. They are not recalling someone else's details; they are holding
 * their own NID, on their own phone, and collecting exactly what a landlord can
 * never get right second-hand is the whole reason the link exists. The landlord
 * asked for all of it, and a half-filled self-submission is worse than none: it
 * reaches the approval queue looking finished, gets approved in one tap, and
 * the empty NID surfaces months later.
 *
 * So this is the strict list, and it is enforced HERE rather than only in the
 * browser, because the form's own validation is a courtesy — the endpoint is
 * open to anything that can send JSON with a bearer token.
 *
 * KEEP IN STEP WITH THE FRONTEND
 * The mirror is `SELF_ONBOARD_REQUIRED` / `validateSelfOnboarding()` in
 * tolet-pro-frontend/src/utils/tenantFields.js. The two lists are meant to be
 * read side by side; a field added to one belongs in the other, or the tenant
 * gets a form that submits and a server that refuses it.
 *
 * WHAT IS NOT HERE
 *   • `name` and `phone` — checked by the caller, because they live on the
 *     booking / member rather than the profile (the same reason
 *     TENANT_PROFILE_KEYS leaves them out) and already have their own messages.
 *   • The room / seat — the caller resolves and validates the unit first.
 *   • The SHIFT path. A tenant moving from 301 to 204 carries the profile they
 *     already gave; holding them to fields nobody ever asked them for would
 *     strand every tenant who joined before this rule existed, in a flow that
 *     has no form to fix them in.
 */

const ApiError = require('./ApiError');

// The profile keys a self-submission must carry. Anything not listed stays
// optional on this form too: marital status, department, and the emergency
// contact's ADDRESS — in an emergency someone is phoned, not written to.
const SELF_ONBOARD_REQUIRED = [
  'photoUrl',
  'fatherName', 'dob', 'permanentAddress',
  'tenantType', 'organization', 'professionalIdNumber',
  'govtIdType', 'govtIdNumber',
  'emergencyName', 'emergencyRelation', 'emergencyPhone',
];

// What the organization and the professional ID are CALLED depends on the
// profession — mirrors TENANT_TYPES in the frontend's tenantFields.js, so the
// error names the same box the form does.
const PROFESSION_LABELS = {
  student:    { org: 'শিক্ষাপ্রতিষ্ঠান / বিশ্ববিদ্যালয়', id: 'স্টুডেন্ট আইডি' },
  employee:   { org: 'প্রতিষ্ঠানের নাম',                   id: 'এমপ্লয়ি আইডি' },
  business:   { org: 'ব্যবসা / কোম্পানির নাম',              id: 'ট্রেড লাইসেন্স / বিজনেস আইডি' },
  freelancer: { org: 'প্রতিষ্ঠান',                          id: 'প্রফেশনাল আইডি' },
  other:      { org: 'প্রতিষ্ঠান',                          id: 'আইডি নম্বর' },
};

const LABELS = {
  moveInDate:           'কবে থেকে থাকছেন',
  photoUrl:             'আপনার ছবি',
  fatherName:           'পিতার নাম',
  dob:                  'জন্ম তারিখ',
  permanentAddress:     'স্থায়ী ঠিকানা',
  tenantType:           'পেশা',
  tenantTypeOther:      'আপনার পেশা',
  organization:         'প্রতিষ্ঠান',
  professionalIdNumber: 'পেশার আইডি',
  govtIdType:           'পরিচয়পত্র — কোনটি',
  govtIdNumber:         'NID / পাসপোর্ট নম্বর',
  emergencyName:        'জরুরি যোগাযোগ — নাম',
  emergencyRelation:    'জরুরি যোগাযোগ — সম্পর্ক',
  emergencyPhone:       'জরুরি যোগাযোগ — মোবাইল',
};

function labelFor(key, profile) {
  const p = PROFESSION_LABELS[profile?.tenantType];
  if (p && key === 'organization') return p.org;
  if (p && key === 'professionalIdNumber') return p.id;
  return LABELS[key] || key;
}

// Mirrors isValidNid / isValidPassport in the frontend's tenantFields.js. A BD
// NID is 10 digits (smart card), 13, or 17 (old, with the birth year in front);
// a passport is 9 characters, one or two letters then digits. The point is to
// catch a slipped digit, not to reject an unusual but genuine document — but a
// mistyped ID number is worse than a blank one, because it looks answered.
const isValidNid = (v) => /^(\d{10}|\d{13}|\d{17})$/.test(String(v || '').replace(/\D/g, ''));
const isValidPassport = (v) => /^(?=[A-Z\d]{9}$)[A-Z]{1,2}\d{7,8}$/i
  .test(String(v || '').replace(/[\s-]/g, ''));

const digits = (v) => String(v || '').replace(/\D/g, '');

/**
 * Everything a self-submitted profile is still missing, as Bangla labels.
 * Empty array = complete. Takes the profile AFTER sanitiseTenantProfile, so
 * enum junk has already become '' and is reported as unanswered rather than
 * accepted.
 */
function missingSelfOnboardingFields(profile = {}, { moveInDate } = {}) {
  const blank = (k) => !String(profile?.[k] ?? '').trim();
  const missing = SELF_ONBOARD_REQUIRED.filter(blank);

  // A date the form always sends. Absent means the request did not come from
  // the form, and a defaulted "today" would silently invent a lease start.
  if (!moveInDate || Number.isNaN(new Date(moveInDate).getTime())) missing.unshift('moveInDate');

  // "অন্যান্য" says the profession is one we did not list, so the box under it
  // is the actual answer — same promise as an ID status of 'has'.
  if (profile.tenantType === 'other' && blank('tenantTypeOther')) missing.push('tenantTypeOther');

  return [...new Set(missing)].map((k) => labelFor(k, profile));
}

/**
 * Refuse an incomplete or malformed self-submission. Throws ApiError.badRequest
 * with a Bangla message naming the boxes; returns nothing when the profile is
 * good. Shape errors are reported one at a time and before the missing list,
 * because "this number is wrong" is a different instruction from "this is
 * empty" and running them together reads as noise.
 */
function assertSelfOnboardingProfile(profile = {}, { moveInDate } = {}) {
  const missing = missingSelfOnboardingFields(profile, { moveInDate });
  if (missing.length) {
    throw ApiError.badRequest(
      `বাড়িওয়ালার জন্য এই তথ্যগুলো দিতে হবে: ${missing.join(', ')}।`,
      { code: 'INCOMPLETE_TENANT_PROFILE', details: { missing } },
    );
  }

  if (profile.govtIdType === 'nid' && !isValidNid(profile.govtIdNumber)) {
    throw ApiError.badRequest('NID নম্বরটি ঠিক নয় — ১০, ১৩ অথবা ১৭ সংখ্যার হতে হবে।', {
      code: 'INVALID_GOVT_ID',
    });
  }
  if (profile.govtIdType === 'passport' && !isValidPassport(profile.govtIdNumber)) {
    throw ApiError.badRequest('পাসপোর্ট নম্বরটি ঠিক নয় — যেমন A01234567।', {
      code: 'INVALID_GOVT_ID',
    });
  }

  // Only ever used in the one situation where it has to work.
  if (digits(profile.emergencyPhone).length < 10) {
    throw ApiError.badRequest('জরুরি যোগাযোগের মোবাইল নম্বরটি ঠিক নয়।', {
      code: 'INVALID_EMERGENCY_PHONE',
    });
  }
}

module.exports = {
  SELF_ONBOARD_REQUIRED,
  missingSelfOnboardingFields,
  assertSelfOnboardingProfile,
  // exported for tests
  isValidNid,
  isValidPassport,
};
