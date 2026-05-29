/**
 * TenantProfileFields.jsx
 * ─────────────────────────────────────────────────────────────────────────
 * Declarative field-definition list for a tenant's editable profile.
 *
 * ProfileSection iterates this array and renders the right editor for
 * each entry (InlineField + WorkplaceAutocomplete / ChipSelector etc.).
 *
 * Why a config file, not JSX?
 *   • Adding a new field = one entry here, no JSX edits in 2 dashboards
 *   • Backend/migration parity — schema-shape lives next to its UI in code review
 *   • Reorderable — drag entries around to change visual order
 *   • Translatable — bn/en labels colocated with the field, never out of sync
 *
 * Field schema (every entry):
 *   key         : string                        — flat key (e.g. 'fullName')
 *                                                 or dotted path (e.g.
 *                                                 'emergencyContact.phone')
 *   label       : { bn, en }
 *   icon        : LucideComponent
 *   type        : 'text' | 'phone' | 'workplace'
 *                 | 'chip-single' | 'chip-multi' | 'number'
 *   validator?  : (value) => { ok, msg: {bn,en} }   — from utils/validators
 *   required?   : boolean                       — drives the red asterisk
 *   placeholder?: { bn, en }
 *   helpText?   : { bn, en }                    — small grey caption below
 *   options?    : [{ value, label: {bn,en}, icon? }]  — for chip-* types
 *   trustWeight?: number                        — informational, for QuickWins
 *
 * Trust-score weights mirror the backend `computeTrustScore` formula in
 * User.js so QuickWinsCard can show "+10 trust" hints without a server
 * round trip. Keep these two in sync. The blueprint spells out the
 * tenant weights:
 *   professionType +10   workPlace +10   familySize +5
 *   emergencyContact.phone +15
 */

import {
  GraduationCap, Briefcase, Building2, Store, User, UserCheck,
  Phone, Users, Heart, HandHeart, Home, Stethoscope,
} from 'lucide-react';
import { validators } from '../../utils/validators';

// ─── Option lists ───────────────────────────────────────────────────────
// Profession buckets matter for verification routing (a student
// uploads a university ID, a salaried worker uploads a job letter, etc).
// Order is intentional: most-common first.
export const PROFESSION_OPTIONS = [
  { value: 'student',  label: { bn: 'শিক্ষার্থী',   en: 'Student' },      icon: GraduationCap },
  { value: 'job',      label: { bn: 'চাকরিজীবী',     en: 'Job holder' },   icon: Briefcase },
  { value: 'business', label: { bn: 'ব্যবসায়ী',      en: 'Business' },     icon: Store },
  { value: 'doctor',   label: { bn: 'ডাক্তার',       en: 'Doctor' },        icon: Stethoscope },
  { value: 'other',    label: { bn: 'অন্যান্য',       en: 'Other' },         icon: User },
];

// Family-size is intentionally a chip group, not a free-form integer —
// landlords care about a bucket ("3-4 people"), not whether it's 3 or 4.
// "5+" handles the long tail without making the picker huge.
export const FAMILY_SIZE_OPTIONS = [
  { value: '1',  label: { bn: '১ জন',    en: '1 person'  } },
  { value: '2',  label: { bn: '২ জন',    en: '2 people'  } },
  { value: '3',  label: { bn: '৩ জন',    en: '3 people'  } },
  { value: '4',  label: { bn: '৪ জন',    en: '4 people'  } },
  { value: '5+', label: { bn: '৫+ জন',   en: '5+ people' } },
];

// Emergency-contact relation — keep the list short. Anything not listed
// can go in a 'guardian' bucket; the verification team can clarify.
export const RELATION_OPTIONS = [
  { value: 'parent',   label: { bn: 'বাবা/মা',    en: 'Parent'   }, icon: HandHeart },
  { value: 'spouse',   label: { bn: 'স্বামী/স্ত্রী', en: 'Spouse' }, icon: Heart },
  { value: 'sibling',  label: { bn: 'ভাই/বোন',     en: 'Sibling'  }, icon: Users },
  { value: 'guardian', label: { bn: 'অভিভাবক',     en: 'Guardian' }, icon: UserCheck },
  { value: 'other',    label: { bn: 'অন্যান্য',     en: 'Other'    }, icon: User },
];

// ─── Field list ────────────────────────────────────────────────────────
export const TENANT_FIELDS = [
  // 1. Full name — universal first field everywhere
  {
    key:         'fullName',
    label:       { bn: 'পূর্ণ নাম',         en: 'Full name' },
    icon:        User,
    type:        'text',
    validator:   validators.name,
    required:    true,
    placeholder: { bn: 'আপনার পূর্ণ নাম',  en: 'Your full name' },
  },
  // 2. Profession bucket — drives doc-type prompts downstream
  {
    key:         'professionType',
    label:       { bn: 'পেশা',                en: 'Profession' },
    icon:        Briefcase,
    type:        'chip-single',
    options:     PROFESSION_OPTIONS,
    required:    true,
    trustWeight: 10,
    helpText:    { bn: 'বাড়িওয়ালা মিল খুঁজতে এটা দেখে।',
                   en: 'Landlords use this to match suitable tenants.' },
  },
  // 3. Workplace / institution — uses the autocomplete component.
  //    Validator is workPlace (≥2 chars). The autocomplete itself can
  //    inject a known `workPlaceId` separately via onSelect.
  {
    key:         'workPlace',
    label:       { bn: 'প্রতিষ্ঠান',          en: 'Workplace / Institution' },
    icon:        Building2,
    type:        'workplace',
    validator:   validators.workPlace,
    trustWeight: 10,
    placeholder: { bn: 'যেমন: ঢাকা বিশ্ববিদ্যালয়',
                   en: 'e.g. Dhaka University' },
  },
  // 4. Family size
  {
    key:         'familySize',
    label:       { bn: 'পরিবারের সদস্য সংখ্যা', en: 'Family size' },
    icon:        Home,
    type:        'chip-single',
    options:     FAMILY_SIZE_OPTIONS,
    trustWeight: 5,
  },
  // 5-7. Emergency contact (nested object). The `path` array tells
  //      ProfileSection how to read/write a nested value with lodash-style
  //      get/set semantics.
  {
    key:         'emergencyContact.name',
    path:        ['emergencyContact', 'name'],
    label:       { bn: 'জরুরি যোগাযোগ — নাম',  en: 'Emergency contact — name' },
    icon:        User,
    type:        'text',
    validator:   validators.name,
    placeholder: { bn: 'কাউকে যোগ করুন',         en: 'Add a contact name' },
  },
  {
    key:         'emergencyContact.phone',
    path:        ['emergencyContact', 'phone'],
    label:       { bn: 'জরুরি যোগাযোগ — ফোন',  en: 'Emergency contact — phone' },
    icon:        Phone,
    type:        'phone',
    validator:   validators.phone,
    trustWeight: 15,
    placeholder: { bn: '+880…',                  en: '+880…' },
    helpText:    { bn: 'বাড়িওয়ালা পৌঁছাতে না পারলে যাঁকে ফোন করবে।',
                   en: 'Whom landlords call if they can\'t reach you.' },
  },
  {
    key:         'emergencyContact.relation',
    path:        ['emergencyContact', 'relation'],
    label:       { bn: 'জরুরি যোগাযোগ — সম্পর্ক', en: 'Emergency contact — relation' },
    icon:        HandHeart,
    type:        'chip-single',
    options:     RELATION_OPTIONS,
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────
// Read a (possibly nested) value out of the profile object using the
// field definition. Lives here next to TENANT_FIELDS so its semantics
// stay tied to the schema; ProfileSection doesn't reinvent it.
export function readFieldValue(profile, field) {
  if (!profile) return '';
  if (field.path) {
    return field.path.reduce(
      (obj, key) => (obj == null ? undefined : obj[key]),
      profile,
    ) ?? '';
  }
  return profile[field.key] ?? '';
}

// Build a patch object the backend can consume. For nested fields we
// emit a dotted-path key (e.g. `emergencyContact.phone`) so the
// PATCH /me endpoint can use Mongoose's `$set` semantics directly.
export function buildFieldPatch(field, value) {
  if (field.path) {
    return { [field.path.join('.')]: value };
  }
  return { [field.key]: value };
}

// Count completed fields for the completion meter. We treat a field as
// "complete" if its value is a non-empty string or a non-empty array.
export function countCompletedFields(profile, fields = TENANT_FIELDS) {
  let done = 0;
  for (const f of fields) {
    const v = readFieldValue(profile, f);
    if (Array.isArray(v) ? v.length > 0 : v !== '' && v != null) done += 1;
  }
  return { done, total: fields.length };
}