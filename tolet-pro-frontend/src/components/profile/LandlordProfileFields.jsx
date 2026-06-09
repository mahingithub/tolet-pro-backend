/**
 * LandlordProfileFields.jsx
 * ─────────────────────────────────────────────────────────────────────────
 * Declarative field-definition list for a landlord's editable profile.
 *
 * Mirrors TenantProfileFields.jsx exactly — same schema, same helper
 * functions, just a different set of fields. ProfileSection iterates
 * either array based on the `role` prop.
 *
 * Field rationale (why each one earns its trust weight):
 *   • preferredTenants — landlords with stated preferences get better
 *     matches; tenants self-select out, fewer wasted inquiries.
 *   • communication channels — knowing how the landlord wants to be
 *     reached cuts the "called, no answer" frustration loop.
 *   • serviceCharge — having a declared number signals transparency;
 *     it's the #1 source of post-booking disputes when undisclosed.
 *   • houseRules — explicit rules upfront, fewer evictions later.
 *
 * Trust-score weights below mirror the Blueprint v2 landlord formula in
 * Backend_PATCH.md → User.js computeTrustScore. Keep these in sync.
 *   preferredTenants (any) +15  · communication (any) +10
 *   serviceCharge != null  +10  · houseRules (any) +10
 *
 * That budget (45) plus the universal items (phoneVerified +20, avatar
 * +10, NID-verified +25 = 55) tops out at exactly 100 for a fully
 * filled, fully verified landlord.
 */

import {
  User, Building2, MapPin, Phone, Briefcase,
  Users, Heart, GraduationCap, UserCheck, Building,
  PhoneCall, MessageCircle, MessageSquare, Smartphone,
  Coins, Ban, Cigarette, PawPrint, Moon, Music, Wrench, Sparkles as SparklesIcon,
} from 'lucide-react';
import { validators } from '../../utils/validators';

// ─── Option lists ────────────────────────────────────────────────────────
// Preferred-tenant type. Multi-select — a landlord might happily take
// either families or working bachelors. "Anyone" is intentionally not
// an option: that's just leaving everything unchecked.
export const PREFERRED_TENANTS_OPTIONS = [
  { value: 'family',       label: { bn: 'পরিবার',           en: 'Family'              }, icon: Heart        },
  { value: 'bachelor_m',   label: { bn: 'ছাত্র/চাকরিজীবী (পু)', en: 'Bachelor (Male)'   }, icon: UserCheck    },
  { value: 'bachelor_f',   label: { bn: 'ছাত্রী/চাকরিজীবী (ম)', en: 'Bachelor (Female)' }, icon: UserCheck    },
  { value: 'student',      label: { bn: 'শিক্ষার্থী',         en: 'Student'             }, icon: GraduationCap},
  { value: 'job_holder',   label: { bn: 'চাকরিজীবী',          en: 'Job holder'          }, icon: Briefcase    },
  { value: 'business',     label: { bn: 'ব্যবসায়ী',            en: 'Business'            }, icon: Building     },
];

// Communication channels — multi-select. Most BD landlords pick phone
// + WhatsApp; SMS still matters for older landlords without smartphones.
export const COMMUNICATION_OPTIONS = [
  { value: 'phone',    label: { bn: 'ফোন কল',     en: 'Phone call' }, icon: PhoneCall      },
  { value: 'whatsapp', label: { bn: 'হোয়াটসঅ্যাপ', en: 'WhatsApp'   }, icon: MessageCircle  },
  { value: 'sms',      label: { bn: 'এসএমএস',    en: 'SMS'        }, icon: MessageSquare  },
  { value: 'imo',      label: { bn: 'IMO',        en: 'IMO'        }, icon: Smartphone     },
];

// House rules — multi-select. These are the things that come up most
// in real disputes in BD rental complaints (per the early TBD platform
// research the blueprint cites). Phrased as restrictions the tenant
// must accept, not policies the landlord must enforce.
export const HOUSE_RULES_OPTIONS = [
  { value: 'no_smoking',    label: { bn: 'ধূমপান নিষেধ',     en: 'No smoking'       }, icon: Cigarette },
  { value: 'no_pets',       label: { bn: 'পোষা প্রাণী নিষেধ',  en: 'No pets'          }, icon: PawPrint  },
  { value: 'no_late_guest', label: { bn: 'রাতে অতিথি নিষেধ',   en: 'No late-night guests' }, icon: Moon },
  { value: 'no_loud_music', label: { bn: 'উচ্চস্বরে বাজনা নিষেধ', en: 'No loud music' }, icon: Music },
  { value: 'no_alteration', label: { bn: 'কাঠামো পরিবর্তন নিষেধ', en: 'No alterations' }, icon: Wrench },
  { value: 'keep_clean',    label: { bn: 'কমন এরিয়া পরিষ্কার রাখুন', en: 'Keep common areas clean' }, icon: SparklesIcon },
];

// City list — same six BD divisional capitals as elsewhere in the app.
// Single-select. Free-form city would defeat the matching algorithm.
export const CITY_OPTIONS = [
  { value: 'Dhaka',      label: { bn: 'ঢাকা',         en: 'Dhaka'      } },
  { value: 'Chattogram', label: { bn: 'চট্টগ্রাম',     en: 'Chattogram' } },
  { value: 'Sylhet',     label: { bn: 'সিলেট',        en: 'Sylhet'     } },
  { value: 'Khulna',     label: { bn: 'খুলনা',         en: 'Khulna'     } },
  { value: 'Rajshahi',   label: { bn: 'রাজশাহী',      en: 'Rajshahi'   } },
  { value: 'Barishal',   label: { bn: 'বরিশাল',       en: 'Barishal'   } },
];

// ─── Field list ─────────────────────────────────────────────────────────
export const LANDLORD_FIELDS = [
  // 1. Full name — universal first field
  {
    key:         'fullName',
    label:       { bn: 'পূর্ণ নাম',         en: 'Full name' },
    icon:        User,
    type:        'text',
    validator:   validators.name,
    required:    true,
    placeholder: { bn: 'আপনার পূর্ণ নাম',  en: 'Your full name' },
  },
  // 2. City — single chip group. Decides which area-based matching
  //    bucket the listings will land in.
  {
    key:         'city',
    label:       { bn: 'শহর',                  en: 'City' },
    icon:        MapPin,
    type:        'chip-single',
    options:     CITY_OPTIONS,
    required:    true,
  },
  // 3. Street address — text. Not used for matching, only shown to
  //    tenants after a booking is confirmed so they know where to send
  //    documents. Validator is `text` (any non-empty, 2-200 chars) which
  //    we declare inline since validators.js doesn't have it yet.
  {
    key:         'address',
    label:       { bn: 'ঠিকানা',                en: 'Street address' },
    icon:        Building,
    type:        'text',
    validator:   (v) => ({
      ok: !!v && v.trim().length >= 2 && v.trim().length <= 200,
      msg: { bn: '২–২০০ অক্ষর', en: '2-200 characters' },
    }),
    placeholder: { bn: 'বাসা / সড়ক / এলাকা',  en: 'House / Road / Area' },
  },
  // 4. Preferred tenants — multi. Big trust weight because matching
  //    quality is what drives the platform's bottom line.
  {
    key:         'preferredTenants',
    label:       { bn: 'পছন্দের ভাড়াটিয়া',     en: 'Preferred tenants' },
    icon:        Users,
    type:        'chip-multi',
    options:     PREFERRED_TENANTS_OPTIONS,
    trustWeight: 15,
    helpText:    { bn: 'একাধিক বাছাই করতে পারেন। ভাড়াটিয়া এটা দেখে আবেদন করবে।',
                   en: 'Pick more than one. Tenants self-select against these.' },
  },
  // 5. Communication channels — multi. Defaults to none, but the
  //    QuickWins card will nudge the landlord to pick at least one.
  {
    key:         'communication',
    label:       { bn: 'যোগাযোগের মাধ্যম',     en: 'Communication channels' },
    icon:        PhoneCall,
    type:        'chip-multi',
    options:     COMMUNICATION_OPTIONS,
    trustWeight: 10,
    helpText:    { bn: 'ভাড়াটিয়া আপনাকে কীভাবে পৌঁছাবে।',
                   en: 'How tenants will reach out to you.' },
  },
  // 6. Service charge — number. Validator allows 0 (= no service
  //    charge) which is meaningfully different from "unanswered".
  {
    key:         'serviceCharge',
    label:       { bn: 'সার্ভিস চার্জ (টাকা/মাস)', en: 'Service charge (BDT/month)' },
    icon:        Coins,
    type:        'number',
    validator:   validators.serviceCharge,
    trustWeight: 10,
    placeholder: { bn: '০ – ১,০০,০০০',          en: '0 – 100,000' },
    helpText:    { bn: 'যদি না থাকে তাহলে ০ লিখুন।',
                   en: 'If there is none, write 0.' },
  },
  // 7. House rules — multi. Last because rules are the most negotiable
  //    field — landlords often skip it on first pass and come back.
  {
    key:         'houseRules',
    label:       { bn: 'বাড়ির নিয়ম',           en: 'House rules' },
    icon:        Ban,
    type:        'chip-multi',
    options:     HOUSE_RULES_OPTIONS,
    trustWeight: 10,
    helpText:    { bn: 'আগে জানালে পরে বিরোধ কম হয়।',
                   en: 'Stating these upfront prevents disputes later.' },
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────
// Identical implementations to TenantProfileFields.jsx so ProfileSection
// can call them interchangeably. We duplicate rather than re-export so
// each fields file is fully self-contained — easier to grep, no circular
// import risk if these files end up in different bundle chunks.
export function readFieldValue(profile, field) {
  if (!profile) return field.type === 'chip-multi' ? [] : '';
  if (field.path) {
    const v = field.path.reduce(
      (obj, key) => (obj == null ? undefined : obj[key]),
      profile,
    );
    return v ?? (field.type === 'chip-multi' ? [] : '');
  }
  const v = profile[field.key];
  return v ?? (field.type === 'chip-multi' ? [] : '');
}

export function buildFieldPatch(field, value) {
  if (field.path) return { [field.path.join('.')]: value };
  return { [field.key]: value };
}

// Multi-select "complete" = at least one option picked.
// Number 0 counts as complete (you DID answer "no service charge").
export function countCompletedFields(profile, fields = LANDLORD_FIELDS) {
  let done = 0;
  for (const f of fields) {
    const v = readFieldValue(profile, f);
    if (Array.isArray(v)) {
      if (v.length > 0) done += 1;
    } else if (typeof v === 'number') {
      // Any number including 0 counts as answered.
      done += 1;
    } else if (v !== '' && v != null) {
      done += 1;
    }
  }
  return { done, total: fields.length };
}