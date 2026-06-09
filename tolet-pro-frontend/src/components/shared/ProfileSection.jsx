/**
 * ProfileSection.jsx
 * ─────────────────────────────────────────────────────────────────────────
 * The unified, role-aware profile card. Renders inside both
 * TenantDashboard (role="tenant") and HostDashboard (role="landlord").
 *
 * What it owns:
 * • Identity header — avatar (with camera upload), name, phone, trust pill
 * • Personal Information — driven by TENANT_FIELDS / LANDLORD_FIELDS
 * • Verification CTA — primary button opens the existing modal
 *
 * What it does NOT own (parent keeps control):
 * • The right-column TrustGaugeLive, QuickWins, Timeline cards
 * • Tab switching, navigation
 * • The actual modal — parent passes onOpenVerification
 * • Network calls — parent passes onUpdate / onAvatarUpload
 *
 * Why structured this way:
 * The blueprint's golden rule is "one UI, two flows". The two dashboards
 * share *this card*; everything around it stays bespoke. ProfileSection
 * is a pure presentation layer over a profile-shaped object and a
 * handful of callbacks. No fetches, no localStorage, no router calls.
 *
 * Optimistic-save flow (Feature 4 of Blueprint v2):
 * 1. User edits an InlineField, presses Save
 * 2. ProfileSection calls onUpdate(patch) which the parent fires off
 * to the backend. The InlineField shows the green-check optimistic
 * state immediately — see InlineField.jsx for the visual.
 * 3. If onUpdate throws, InlineField rolls back and shows the error.
 *
 * Props:
 * role               : 'tenant' | 'landlord'
 * user               : full user object (need .name, .phone, .avatar)
 * profile            : tenantProfile or landlordProfile object
 * trustScore         : { score, tier }  — already computed by parent
 * verificationStatus : 'unverified' | 'pending' | 'verified'
 * onUpdate           : async (patchObj) => updatedUser
 * patchObj uses dotted-path keys for nested fields
 * onAvatarUpload     : async (file) => updatedUser     — optional
 * onOpenVerification : () => void
 * language           : 'বাংলা' | 'English'
 *
 * Loading state:
 * If `user` is null/undefined we render a skeleton — matches Feature 3
 * of Blueprint v2. Parents that already render a global page skeleton
 * can just gate this component on `user && profile`.
 */

import React from 'react';
import {
  BadgeCheck, Hourglass, ShieldAlert, ShieldCheck, Phone,
  User as UserIcon, ArrowRight, Sparkles,
} from 'lucide-react';

import AvatarUploader        from './Avataruploader';
import InlineField           from './Inlinefield';
import ChipSelector          from './Chipselector';
import WorkplaceAutocomplete from './Workplaceautocomplete';
import Skeleton              from './Skeleton';

import {
  TENANT_FIELDS,
  readFieldValue   as readTenantField,
  buildFieldPatch  as buildTenantPatch,
  countCompletedFields as countTenantCompleted,
} from '../profile/TenantProfileFields';

import {
  LANDLORD_FIELDS,
  readFieldValue   as readLandlordField,
  buildFieldPatch  as buildLandlordPatch,
  countCompletedFields as countLandlordCompleted,
} from '../profile/LandlordProfileFields';

// Role → helper bundle. Keeps the rest of the component blissfully
// ignorant of which fields file is in play. Adding a new role (e.g.
// 'agent') becomes a one-line entry here once that fields file exists.
const ROLE_HELPERS = {
  tenant: {
    fields:    TENANT_FIELDS,
    read:      readTenantField,
    buildPatch: buildTenantPatch,
    count:     countTenantCompleted,
  },
  landlord: {
    fields:    LANDLORD_FIELDS,
    read:      readLandlordField,
    buildPatch: buildLandlordPatch,
    count:     countLandlordCompleted,
  },
};

// ─── Status pill helper ────────────────────────────────────────────────
// Returns { Icon, cls, en, bn } describing the verification badge.
// Kept inline because it's only used in one place — promoting to its
// own file would just thrash imports.
function statusPillMeta(status) {
  switch (status) {
    case 'verified':
      return { Icon: BadgeCheck,  cls: 'bg-blue-50 text-blue-700 border-blue-100',     en: 'Verified',    bn: 'ভেরিফাইড' };
    case 'pending':
      return { Icon: Hourglass,   cls: 'bg-amber-50 text-amber-700 border-amber-100',  en: 'Under Review', bn: 'রিভিউ চলছে' };
    default:
      return { Icon: ShieldAlert, cls: 'bg-gray-50 text-gray-600 border-gray-200',     en: 'Unverified',   bn: 'অভেরিফাইড' };
  }
}

// ─── Tier pill helper ──────────────────────────────────────────────────
function tierPillMeta(tier) {
  return {
    bronze:   { cls: 'bg-amber-50 text-amber-700 border-amber-100',   en: 'Bronze',   bn: 'ব্রোঞ্জ'   },
    silver:   { cls: 'bg-gray-50 text-gray-700 border-gray-200',       en: 'Silver',   bn: 'সিলভার'   },
    gold:     { cls: 'bg-yellow-50 text-yellow-700 border-yellow-200', en: 'Gold',     bn: 'গোল্ড'    },
    platinum: { cls: 'bg-blue-50 text-blue-700 border-blue-100',       en: 'Platinum', bn: 'প্ল্যাটিনাম' },
  }[tier] || { cls: 'bg-gray-50 text-gray-700 border-gray-200', en: '', bn: '' };
}

// ─── Field wrapper for helpText / trustWeight ─────────────────────────
// The Session-1 InlineField does NOT support helpText or trustWeight
// props (its signature is { label, value, onSave, validator, icon,
// placeholder, type, language, required, renderEditor }). Rather than
// edit InlineField, we render these "extras" around it from here.
// Keeps Session 1 untouched — the Hyrum's-Law-friendly choice.
const FieldWithExtras = ({ children, helpText, trustWeight, language }) => {
  const isBn = language === 'বাংলা';
  if (!helpText && !trustWeight) return children;
  return (
    <div className="space-y-1.5">
      {children}
      {(helpText || trustWeight) && (
        <div className="flex items-center justify-between gap-2 px-1">
          {helpText ? (
            <p className="text-[11px] font-bold text-gray-500 flex-1">
              {isBn ? helpText.bn : helpText.en}
            </p>
          ) : <span />}
          {trustWeight && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-black text-[#ba0036] shrink-0">
              <Sparkles size={10} /> +{trustWeight}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Skeleton view (Blueprint v2 Feature 3) ───────────────────────────
function ProfileSectionSkeleton() {
  return (
    <div className="bg-gradient-to-br from-rose-50/40 via-white to-white rounded-[1.75rem] border border-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.04)] p-6 md:p-8 space-y-6">
      <div className="flex items-center gap-5">
        <Skeleton className="w-24 h-24 rounded-[1.5rem]" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-1/2" delay={120} />
          <Skeleton className="h-2 w-full" delay={240} />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-2xl" delay={i * 80} />
        ))}
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────
const ProfileSection = ({
  role = 'tenant',
  user,
  profile,
  trustScore = { score: 0, tier: 'bronze' },
  verificationStatus = 'unverified',
  onUpdate,
  onAvatarUpload,
  onOpenVerification,
  language = 'বাংলা',
}) => {
  const isBn = language === 'বাংলা';

  if (!user || !profile) return <ProfileSectionSkeleton />;

  // Pick the right helpers for this role. If an unknown role somehow
  // arrives we fall back to tenant rather than crashing — defensive,
  // matches the rest of the dashboards that also default to tenant.
  const helpers = ROLE_HELPERS[role] || ROLE_HELPERS.tenant;
  const { fields, read, buildPatch, count } = helpers;

  const statusMeta = statusPillMeta(verificationStatus);
  const tierMeta   = tierPillMeta(trustScore.tier);
  const StatusIcon = statusMeta.Icon;

  // Completion meter (Blueprint v2 — "60% complete" idea). We compute
  // it locally over the visible field set so it stays in sync even when
  // the parent hasn't refetched the user yet after a save.
  const { done, total } = count(profile, fields);
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  // ─── Per-field save handler ─────────────────────────────────────────
  // InlineField calls this. We build a backend-shaped patch (dotted
  // path for nested fields) and delegate to the parent's onUpdate. We
  // do NOT catch the error — the parent's promise rejection bubbles up
  // to InlineField, which already knows how to roll back and show an
  // error toast (validators.js helpers).
  const handleFieldSave = async (field, newValue) => {
    if (!onUpdate) return;
    const patch = buildPatch(field, newValue);
    await onUpdate(patch);
  };

  // ─── Field-type → editor mapper ─────────────────────────────────────
  // Each field type either uses InlineField directly with a custom
  // renderEditor, or composes a chip group below the InlineField.
  // We split the two patterns because chips don't fit the "tap to edit"
  // metaphor — they're always tappable, so they live outside the edit
  // gate. This matches Airbnb's profile UX.
  const renderField = (field) => {
    const value = read(profile, field);

    // Chips: always visible, no edit gate. Save fires on every click.
    if (field.type === 'chip-single' || field.type === 'chip-multi') {
      const Icon = field.icon;
      return (
        <div className="space-y-2" key={field.key}>
          <div className="flex items-center gap-2">
            {Icon && <Icon size={14} className="text-gray-500" />}
            <span className="text-xs font-black uppercase tracking-wider text-gray-600">
              {isBn ? field.label.bn : field.label.en}
              {field.required && <span className="text-[#ba0036] ml-1">*</span>}
            </span>
            {field.trustWeight && (
              <span className="ml-auto inline-flex items-center gap-0.5 text-[10px] font-black text-[#ba0036]">
                <Sparkles size={10} /> +{field.trustWeight}
              </span>
            )}
          </div>
          <ChipSelector
            options={field.options}
            value={value}
            mode={field.type === 'chip-multi' ? 'multi' : 'single'}
            language={language}
            onChange={(v) => handleFieldSave(field, v)}
          />
          {field.helpText && (
            <p className="text-[11px] font-bold text-gray-500">
              {isBn ? field.helpText.bn : field.helpText.en}
            </p>
          )}
        </div>
      );
    }

    // Workplace: InlineField with WorkplaceAutocomplete as the editor.
    if (field.type === 'workplace') {
      return (
        <FieldWithExtras
          key={field.key}
          helpText={field.helpText}
          trustWeight={field.trustWeight}
          language={language}
        >
          <InlineField
            label={field.label}
            value={value}
            icon={field.icon}
            required={field.required}
            validator={field.validator}
            placeholder={field.placeholder}
            language={language}
            onSave={(v) => handleFieldSave(field, v)}
            renderEditor={(p) => (
              <WorkplaceAutocomplete
                value={p.value}
                onChange={p.onChange}
                onCommit={p.onCommit}
                onCancel={p.onCancel}
                inputRef={p.inputRef}
                language={language}
                placeholder={
                  (field.placeholder && (isBn ? field.placeholder.bn : field.placeholder.en)) || ''
                }
              />
            )}
          />
        </FieldWithExtras>
      );
    }

    // Default: plain InlineField (text / phone / number).
    // Translate our field.type → InlineField's `type` prop (tel / email).
    const inputType =
      field.type === 'phone'  ? 'tel'
      : field.type === 'email' ? 'email'
      : field.type === 'number' ? 'number'
      : 'text';

    return (
      <FieldWithExtras
        key={field.key}
        helpText={field.helpText}
        trustWeight={field.trustWeight}
        language={language}
      >
        <InlineField
          label={field.label}
          value={value}
          icon={field.icon}
          type={inputType}
          required={field.required}
          validator={field.validator}
          placeholder={field.placeholder}
          language={language}
          onSave={(v) => handleFieldSave(field, v)}
        />
      </FieldWithExtras>
    );
  };

  return (
    <div className="bg-gradient-to-br from-rose-50/40 via-white to-white rounded-[1.75rem] border border-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.04)] p-6 md:p-8 space-y-8">

      {/* ═══ A) IDENTITY HEADER ═════════════════════════════════════ */}
      <header className="flex flex-col sm:flex-row sm:items-center gap-5">
        {/* AvatarUploader signature from Session 1:
              { src, name, size, onUpload, language, editable, className } */}
        <AvatarUploader
          src={user?.avatar}
          name={user?.name}
          size="lg"
          onUpload={async (file, source, onProgress) => {
            // Delegate to parent's onAvatarUpload prop. The parent
            // (TenantDashboard / HostDashboard) owns the backend call
            // because it also owns the cache invalidation, error toast,
            // and AuthContext refresh wiring. ProfileSection stays a
            // pure presentation component.
            if (!onAvatarUpload) {
              throw new Error(
                language === 'বাংলা'
                  ? 'আপলোড হ্যান্ডলার সেট করা হয়নি।'
                  : 'Upload handler not configured.',
              );
            }
            await onAvatarUpload(file, source, onProgress);
          }}
          language={language}
        />

        <div className="flex-1 min-w-0">
          {/* Name + badges row */}
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <h2 className="text-xl md:text-2xl font-black text-gray-900 truncate">
              {user.name || user.fullName || profile.fullName ||
                (isBn ? 'নাম যোগ করুন' : 'Add your name')}
            </h2>

            {/* Verification status pill */}
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${statusMeta.cls}`}>
              <StatusIcon size={11} />
              {isBn ? statusMeta.bn : statusMeta.en}
            </span>

            {/* Trust tier pill — shows the headline number too */}
            {trustScore.score > 0 && (
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${tierMeta.cls}`}>
                <ShieldCheck size={11} />
                {isBn ? tierMeta.bn : tierMeta.en}
                <span className="opacity-60 normal-case tracking-normal text-[9px]">· {trustScore.score}/100</span>
              </span>
            )}
          </div>

          {/* Phone — read-only, with a small lock affordance via the icon's
              dim colour. Phone changes are an OTP flow, never inline. */}
          <p className="text-sm font-bold text-gray-500 flex items-center gap-2 mb-3">
            <Phone size={13} className="text-gray-400" />
            <span className="truncate">
              {user.phone || profile.phone ||
                (isBn ? 'সাইন-আপের সময় ভেরিফাই করা হয়েছিল' : 'Verified at signup')}
            </span>
          </p>

          {/* Completion strip — animated width binding to pct. The trailing
              "+N more for Gold" copy is intentionally omitted here; the
              parent's QuickWinsCard already shows that, and duplicating
              it would feel naggy. */}
          <div className="flex items-center gap-3">
            <div className="flex-1 max-w-[280px] h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#ba0036] to-[#ff4d6d] rounded-full transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs font-black text-gray-700 whitespace-nowrap">
              {done}/{total} {isBn ? 'সম্পন্ন' : 'done'}
            </span>
          </div>
        </div>
      </header>

      {/* ═══ B) PERSONAL INFORMATION ═══════════════════════════════ */}
      <section>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-[#ba0036]/10 flex items-center justify-center">
            <UserIcon className="text-[#ba0036]" size={18} />
          </div>
          <div>
            <h3 className="text-base md:text-lg font-black text-gray-900">
              {isBn ? 'ব্যক্তিগত তথ্য' : 'Personal Information'}
            </h3>
            <p className="text-xs font-bold text-gray-500">
              {isBn
                ? 'বাড়িওয়ালারা ইনকোয়ারির সময় এই তথ্য দেখেন।'
                : 'Landlords see this with every inquiry you send.'}
            </p>
          </div>
        </div>

        {/* Field grid. md:grid-cols-2 lets two text fields sit side-by-side
            on tablet+, but chip groups (which can be wide) wrap naturally
            because flex-wrap handles overflow inside each cell. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
          {fields.length === 0 ? (
            <div className="md:col-span-2 text-center py-8 text-sm font-bold text-gray-400">
              {isBn
                ? 'এই ভূমিকার জন্য ফিল্ড সংজ্ঞায়িত হয়নি।'
                : 'No fields are defined for this role yet.'}
            </div>
          ) : (
            fields.map(renderField)
          )}
        </div>
      </section>

      {/* ═══ C) VERIFICATION CTA ═══════════════════════════════════ */}
      {/* When already verified we still show a tiny "you're verified"
          line — it's reassuring and doesn't push another action. When
          pending we show a calm "we're reviewing it" tone, no button.
          Only the unverified state gets a real call-to-action button. */}
      <section className="rounded-2xl border border-gray-100 bg-white/60 backdrop-blur p-5">
        {verificationStatus === 'verified' && (
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
              <BadgeCheck className="text-blue-600" size={20} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-black text-gray-900">
                {isBn ? 'আপনি ভেরিফাইড — দারুণ!' : 'You\'re verified — nice!'}
              </p>
              <p className="text-xs font-bold text-gray-500">
                {isBn
                  ? 'আপনার প্রোফাইলে নীল ব্যাজ ও বেশি ট্রাস্ট স্কোর আছে।'
                  : 'Your profile has the blue badge and a trust boost.'}
              </p>
            </div>
          </div>
        )}

        {verificationStatus === 'pending' && (
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
              <Hourglass className="text-amber-600" size={20} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-black text-gray-900">
                {isBn ? 'রিভিউ চলছে…' : 'Under review…'}
              </p>
              <p className="text-xs font-bold text-gray-500">
                {isBn
                  ? '২৪-৪৮ ঘণ্টার মধ্যে অ্যাডমিন আপনার ডকুমেন্ট পরীক্ষা করবে।'
                  : 'Our admins will check your documents within 24-48 hours.'}
              </p>
            </div>
          </div>
        )}

        {verificationStatus === 'unverified' && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-center gap-3 flex-1">
              <div className="w-10 h-10 rounded-xl bg-[#ba0036]/10 flex items-center justify-center shrink-0">
                <ShieldAlert className="text-[#ba0036]" size={20} />
              </div>
              <div>
                <p className="text-sm font-black text-gray-900">
                  {isBn ? 'এখনই ভেরিফাই করুন' : 'Verify your identity now'}
                </p>
                <p className="text-xs font-bold text-gray-500">
                  {isBn
                    ? 'NID + ছবি জমা দিন, +৩০ ট্রাস্ট পয়েন্ট পান।'
                    : 'Submit your NID & photo to earn +30 trust points.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenVerification}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-[#ba0036] hover:bg-[#90002a] text-white rounded-xl font-black text-xs shadow-md transition-all"
            >
              {isBn ? 'শুরু করুন' : 'Start verification'}
              <ArrowRight size={14} />
            </button>
          </div>
        )}
      </section>
    </div>
  );
};

export default ProfileSection;