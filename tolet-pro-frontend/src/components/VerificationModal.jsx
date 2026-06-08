/**
 * VerificationModal.jsx
 * ─────────────────────────────────────────────────────────────────────────
 * Unified identity-verification wizard (Smart Version) — works for BOTH
 * tenants and landlords. Role is selected via the `role` prop:
 *
 *   <VerificationModal role="tenant"  ... />   ← default; existing flow
 *   <VerificationModal role="landlord" ... />  ← new flow
 *
 * Backwards-compat:
 *   The default export is still re-named `TenantVerificationModal` so
 *   every existing import (TenantDashboard, etc.) keeps working with
 *   zero changes. New code can import { VerificationModal } directly.
 *
 * Visual language unchanged — "Neo-glass" (strict green & red theme).
 * Only the step list, copy, and submission payload differ by role; the
 * visual frame, animations, and gauge are 100% shared.
 *
 * Role flows:
 *
 *   TENANT (unchanged)
 *     profession → workPlace → familySize → emergency → nid (opt) → review
 *
 *   LANDLORD (new)
 *     ownerType → propertyAddress → caretaker (opt) → nid (REQUIRED)
 *       → ownershipProof (opt) → review
 *
 * Why NID is OPTIONAL for tenants but REQUIRED for landlords:
 *   A landlord lists property — that's a financial transaction with
 *   strangers. We can't legally / ethically let unverified landlords
 *   take deposits. Tenants can browse + send inquiries without NID,
 *   they just don't get the blue "Verified" badge until they upload.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, ChevronLeft, ChevronRight, Check, CheckCircle2,
  Sparkles, Briefcase, GraduationCap, Store, Users,
  Building2, MapPin, Phone, IdCard, ShieldCheck,
  ImagePlus, Loader2, AlertCircle, Trash2, Heart,
  ArrowRight, Lock, Star, Award, Zap, Fingerprint,
  Edit3, KeySquare, UserCog, HandHeart, FileText,
} from 'lucide-react';

// ─── Constants ───────────────────────────────────────────────────────────
const MAX_BYTES   = 5 * 1024 * 1024;
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

// Tenant trust-score weights (unchanged from original modal).
const TENANT_POINTS = {
  profession:       15,
  workPlace:        15,
  familySize:        5,
  emergencyContact: 15,
  nidFront:         25,
  nidBack:          25,
};

// Landlord trust-score weights — geared toward identity, not preferences.
// Preferences (preferredTenants, communication, houseRules, serviceCharge)
// live in the inline-edit ProfileSection, not here.
const LANDLORD_POINTS = {
  ownerType:        10,
  propertyAddress:  10,
  caretakerPhone:    5,
  nidFront:         25,
  nidBack:          25,
  ownershipProof:   25,
};

// ─── Tenant options ──────────────────────────────────────────────────────
const PROFESSIONS = [
  { key: 'employed',      icon: Briefcase,     en: 'Salaried',   bn: 'চাকরিজীবী' },
  { key: 'self-employed', icon: Store,         en: 'Business',   bn: 'ব্যবসায়ী' },
  { key: 'student',       icon: GraduationCap, en: 'Student',    bn: 'ছাত্র/ছাত্রী' },
  { key: 'other',         icon: Users,         en: 'Other',      bn: 'অন্যান্য' },
];

const FAMILY_SIZES = [
  { key: 1, en: '1 person (Bachelor)',  bn: '১ জন (ব্যাচেলর)' },
  { key: 2, en: '2 people (Couple)',    bn: '২ জন (কাপল)' },
  { key: 4, en: '3–5 people',           bn: '৩-৫ জন' },
  { key: 6, en: '5+ people',            bn: '৫+ জন' },
];

// ─── Landlord options ────────────────────────────────────────────────────
// Drives which ownership-proof options we hint at in step 5. A "family
// property" landlord typically has different paperwork than an outright
// owner (e.g. tax bill in a relative's name), so we capture the intent
// upfront.
const OWNERSHIP_TYPES = [
  { key: 'owner',   icon: KeySquare, en: 'I own it',           bn: 'আমি মালিক' },
  { key: 'manager', icon: UserCog,   en: 'Authorised manager', bn: 'অনুমোদিত ব্যবস্থাপক' },
  { key: 'family',  icon: HandHeart, en: 'Family property',    bn: 'পারিবারিক সম্পত্তি' },
];

// ─── File reader helper ──────────────────────────────────────────────────
const readAsDataURL = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload  = () => resolve(r.result);
  r.onerror = () => reject(new Error('read'));
  r.readAsDataURL(file);
});

// ─── Step lists (per role) ───────────────────────────────────────────────
// `required` controls trust scoring + UI hints. `optional` shows the
// little "Optional" pill in the step header and the Skip button at
// bottom. Note: landlord NID is REQUIRED (no Skip), tenant NID is OPTIONAL.
const TENANT_STEPS = [
  { key: 'profession',  icon: Briefcase, required: true,  optional: false },
  { key: 'workPlace',   icon: Building2, required: true,  optional: false },
  { key: 'familySize',  icon: Users,     required: true,  optional: false },
  { key: 'emergency',   icon: Phone,     required: true,  optional: false },
  { key: 'nid',         icon: IdCard,    required: false, optional: true  },
  { key: 'review',      icon: Sparkles,  required: false, optional: false },
];

const LANDLORD_STEPS = [
  { key: 'ownerType',       icon: KeySquare,   required: true,  optional: false },
  { key: 'propertyAddress', icon: MapPin,      required: true,  optional: false },
  { key: 'caretaker',       icon: UserCog,     required: false, optional: true  },
  { key: 'nid',             icon: IdCard,      required: true,  optional: false }, // ← REQUIRED for landlord
  { key: 'ownershipProof',  icon: FileText,    required: false, optional: true  },
  { key: 'review',          icon: Sparkles,    required: false, optional: false },
];

// ─── Futuristic Chip ─────────────────────────────────────────────────────
const Chip = ({ active, onClick, icon: Icon, children }) => (
  <motion.button
    type="button"
    onClick={onClick}
    whileHover={{ scale: 1.03 }}
    whileTap={{ scale: 0.97 }}
    className={`relative px-4 py-3 rounded-2xl border text-sm font-bold transition-all overflow-hidden ${
      active
        ? 'bg-gradient-to-br from-[#ba0036]/20 via-[#ff4d6d]/15 to-[#ba0036]/20 border-[#ff4d6d]/40 text-white shadow-[0_0_25px_rgba(186,0,54,0.25)]'
        : 'bg-white/[0.03] hover:bg-white/[0.07] border-white/[0.08] text-white/60 hover:text-white/90 hover:border-white/[0.15]'
    }`}
  >
    {active && (
      <motion.div
        layoutId="chip-glow"
        className="absolute inset-0 bg-gradient-to-br from-[#ba0036]/10 to-[#ff4d6d]/5"
        transition={{ duration: 0.4 }}
      />
    )}
    <div className="relative flex items-center gap-2.5">
      {Icon && (
        <div className={`p-1.5 rounded-lg ${active ? 'bg-[#ff4d6d]/20' : 'bg-white/[0.04]'}`}>
          <Icon size={13} className={active ? 'text-[#ff4d6d]' : 'text-white/40'} />
        </div>
      )}
      <span>{children}</span>
      {active && <CheckCircle2 size={14} className="text-emerald-400 ml-auto" />}
    </div>
  </motion.button>
);

// ─── Animated Trust Score Gauge ─────────────────────────────────────────
const TrustScoreGauge = ({ score, isBn }) => {
  const tier =
    score >= 90 ? 'platinum' :
    score >= 70 ? 'gold'     :
    score >= 40 ? 'silver'   : 'bronze';
  const tierLabel = {
    platinum: isBn ? 'প্ল্যাটিনাম' : 'Platinum',
    gold:     isBn ? 'গোল্ড'       : 'Gold',
    silver:   isBn ? 'সিলভার'      : 'Silver',
    bronze:   isBn ? 'ব্রোঞ্জ'      : 'Bronze',
  }[tier];

  const R = 22;
  const C = 2 * Math.PI * R;
  const offset = C - (score / 100) * C;

  return (
    <div className="relative w-16 h-16 flex items-center justify-center">
      <svg width="64" height="64" className="-rotate-90">
        <defs>
          <linearGradient id="trustGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor="#ba0036" />
            <stop offset="50%"  stopColor="#ff4d6d" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
        <motion.circle
          cx="32" cy="32" r={R} fill="none"
          stroke="url(#trustGrad)" strokeWidth="4" strokeLinecap="round"
          strokeDasharray={C}
          initial={false}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[15px] font-black text-white leading-none tabular-nums">{score}</div>
        <div className="text-[7px] font-black text-white/40 uppercase tracking-widest mt-0.5">
          {isBn ? 'ট্রাস্ট' : 'Trust'}
        </div>
      </div>
    </div>
  );
};

// ─── Step Rail (visual progress) ────────────────────────────────────────
const StepRail = ({ steps, currentIdx, completed }) => (
  <div className="flex items-center gap-1 flex-wrap">
    {steps.map((s, i) => {
      const isDone    = completed[s.key];
      const isCurrent = i === currentIdx;
      const isPast    = i < currentIdx;
      const Icon      = s.icon;
      return (
        <React.Fragment key={s.key}>
          <motion.div
            className={`relative w-7 h-7 rounded-xl flex items-center justify-center border transition-all ${
              isCurrent
                ? 'bg-gradient-to-br from-[#ba0036] to-[#ff4d6d] border-[#ff4d6d] shadow-[0_0_15px_rgba(186,0,54,0.5)]'
                : isDone || isPast
                  ? 'bg-emerald-500/15 border-emerald-500/30'
                  : 'bg-white/[0.03] border-white/[0.08]'
            }`}
            initial={false}
            animate={isCurrent ? { scale: [1, 1.08, 1] } : { scale: 1 }}
            transition={{ duration: 1.4, repeat: isCurrent ? Infinity : 0 }}
          >
            {isDone || isPast ? (
              <Check size={12} className="text-emerald-400" />
            ) : (
              <Icon size={11} className={isCurrent ? 'text-white' : 'text-white/30'} />
            )}
          </motion.div>
          {i < steps.length - 1 && (
            <div
              className={`h-px w-3 transition-all ${
                isPast ? 'bg-emerald-500/40' : 'bg-white/[0.08]'
              }`}
            />
          )}
        </React.Fragment>
      );
    })}
  </div>
);

// ─── Step Frame ──────────────────────────────────────────────────────────
const StepFrame = ({ icon: Icon, titleBn, titleEn, hintBn, hintEn, optional, isBn, children }) => (
  <motion.div
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -12 }}
    transition={{ duration: 0.3, ease: 'easeOut' }}
  >
    <div className="flex items-start gap-3.5 mb-6">
      <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#ba0036]/20 to-[#ff4d6d]/10 border border-[#ba0036]/20 flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(186,0,54,0.15)]">
        <Icon size={18} className="text-[#ff4d6d]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h3 className="text-lg font-black text-white tracking-tight">
            {isBn ? titleBn : titleEn}
          </h3>
          {optional && (
            <span className="text-[9px] font-black px-2.5 py-0.5 rounded-full bg-[#ff4d6d]/10 text-[#ff4d6d] border border-[#ff4d6d]/20 uppercase tracking-widest">
              {isBn ? 'ঐচ্ছিক' : 'Optional'}
            </span>
          )}
        </div>
        <p className="text-[12px] text-white/40 font-medium mt-1 leading-relaxed">
          {isBn ? hintBn : hintEn}
        </p>
      </div>
    </div>
    {children}
  </motion.div>
);

// ─── NID / Image Upload Card ─────────────────────────────────────────────
// Renamed conceptually — also used for landlord ownershipProof, not just NID.
const ImageUploadCard = ({ value, inputRef, onPick, onRemove, emptyLabelBn, emptyLabelEn, aspect, isBn }) => (
  <div>
    <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onPick} />
    {value?.dataUrl ? (
      <div className={`relative ${aspect} rounded-2xl overflow-hidden border border-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.15)] group`}>
        <img src={value.dataUrl} alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
        <div className="absolute top-2 left-2">
          <div className="px-2 py-1 rounded-full bg-emerald-500/20 backdrop-blur-md border border-emerald-500/40 flex items-center gap-1">
            <CheckCircle2 size={10} className="text-emerald-400" />
            <span className="text-[9px] font-black text-emerald-300 uppercase tracking-widest">
              {isBn ? 'সম্পন্ন' : 'Done'}
            </span>
          </div>
        </div>
        <div className="absolute bottom-2 left-2 right-2 flex gap-1.5">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex-1 px-2.5 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-[10px] font-black text-white hover:bg-white/20 transition-all flex items-center justify-center gap-1"
          >
            <ImagePlus size={12} /> {isBn ? 'বদলান' : 'Replace'}
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="px-2.5 py-1.5 rounded-full bg-red-500/15 backdrop-blur-md border border-red-500/25 text-red-300 hover:bg-red-500/25 transition-all"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    ) : (
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={`${aspect} w-full rounded-2xl border-2 border-dashed border-white/[0.1] hover:border-[#ff4d6d]/40 bg-white/[0.02] hover:bg-[#ff4d6d]/[0.04] transition-all flex flex-col items-center justify-center gap-2 group active:scale-[0.98]`}
      >
        <div className="w-10 h-10 rounded-2xl bg-white/[0.04] group-hover:bg-[#ff4d6d]/10 border border-white/[0.06] group-hover:border-[#ff4d6d]/20 flex items-center justify-center transition-all">
          <ImagePlus size={16} className="text-white/30 group-hover:text-[#ff4d6d] transition-colors" />
        </div>
        <p className="text-[11px] font-black text-white/50">{isBn ? emptyLabelBn : emptyLabelEn}</p>
      </button>
    )}
  </div>
);

// ─── Summary Row (review step) ───────────────────────────────────────────
const SummaryRow = ({ icon: Icon, labelBn, labelEn, value, muted, isBn }) => (
  <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.05] transition-colors">
    <div className="w-8 h-8 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
      <Icon size={14} className="text-white/40" />
    </div>
    <div className="min-w-0 flex-1">
      <p className="text-[10px] font-black uppercase tracking-widest text-white/30">
        {isBn ? labelBn : labelEn}
      </p>
      <p className={`text-sm font-black truncate ${muted ? 'text-white/25' : 'text-white/90'}`}>
        {value || '—'}
      </p>
    </div>
  </div>
);

// ─── Main Modal ──────────────────────────────────────────────────────────
const VerificationModal = ({
  open,
  onClose,
  onSubmit,
  onEditProfile,
  role         = 'tenant',     // ← NEW. 'tenant' (default) | 'landlord'
  language     = 'বাংলা',
  initialData  = null,
}) => {
  const isBn        = language === 'বাংলা';
  const isLandlord  = role === 'landlord';
  const POINTS      = isLandlord ? LANDLORD_POINTS : TENANT_POINTS;
  const BASE_STEPS  = isLandlord ? LANDLORD_STEPS  : TENANT_STEPS;

  // ─── Form state ────────────────────────────────────────────────────
  // Single bag of state keyed by every possible field across both roles.
  // Keeps reset / hydration simple; unused fields just sit at default.
  const buildEmptyState = () => ({
    // Tenant
    profession:       '',
    workPlace:        '',
    familySize:       null,
    emergencyName:    '',
    emergencyPhone:   '+880',
    // Landlord
    ownerType:        '',
    propertyAddress:  '',
    caretakerName:    '',
    caretakerPhone:   '+880',
    ownershipProof:   null,
    // Shared
    nidFront:         null,
    nidBack:          null,
  });

  const [activeSteps, setActiveSteps] = useState(BASE_STEPS);
  const [stepIdx, setStepIdx]         = useState(0);
  const [data, setData]               = useState(buildEmptyState);
  const [submitting, setSubmitting]   = useState(false);
  const [error,      setError]        = useState('');

  // ─── Smart Hydration & Step Filtering ──────────────────────────────
  // When user re-opens the modal with existing data, skip the steps
  // they've already completed and land them on the first incomplete one.
  // Keep NID and Review in the active list regardless — they always
  // appear (re-confirming NID is fine; review is always last).
  useEffect(() => {
    if (!open) return;

    let seed = buildEmptyState();

    if (initialData && typeof initialData === 'object') {
      if (isLandlord) {
        seed = {
          ...seed,
          ownerType:       initialData.ownerType       || '',
          propertyAddress: initialData.address         || initialData.propertyAddress || '',
          caretakerName:   initialData.caretaker?.name  || initialData.caretakerName  || '',
          caretakerPhone:  initialData.caretaker?.phone || initialData.caretakerPhone || '+880',
          // NID + ownershipProof intentionally NOT hydrated — file objects
          // can't survive a JSON round-trip; if the user already uploaded
          // them, the backend will already have the URLs and won't ask
          // again at submission time.
        };
      } else {
        seed = {
          ...seed,
          profession:     initialData.professionType || '',
          workPlace:      initialData.workPlace      || '',
          familySize:     initialData.familySize     || null,
          emergencyName:  initialData.emergencyContact?.name  || '',
          emergencyPhone: initialData.emergencyContact?.phone || '+880',
        };
      }
    }

    const filtered = BASE_STEPS.filter((step) => {
      // Always keep NID, ownershipProof, and Review visible
      if (['nid', 'ownershipProof', 'review'].includes(step.key)) return true;
      // Drop completed tenant steps
      if (step.key === 'profession' && seed.profession)               return false;
      if (step.key === 'workPlace'  && seed.workPlace?.trim().length >= 2) return false;
      if (step.key === 'familySize' && seed.familySize !== null)      return false;
      if (step.key === 'emergency'  && seed.emergencyPhone?.replace(/\D/g, '').length >= 10) return false;
      // Drop completed landlord steps
      if (step.key === 'ownerType'       && seed.ownerType)            return false;
      if (step.key === 'propertyAddress' && seed.propertyAddress?.trim().length >= 5) return false;
      if (step.key === 'caretaker'       && seed.caretakerPhone?.replace(/\D/g, '').length >= 10) return false;
      return true;
    });

    setData(seed);
    setActiveSteps(filtered.length > 0 ? filtered : BASE_STEPS);
    setStepIdx(0);
    setError('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialData, role]);

  // ─── Live trust score (animated gauge) ─────────────────────────────
  const liveScore = useMemo(() => {
    let s = 0;
    if (isLandlord) {
      if (data.ownerType)                                          s += POINTS.ownerType;
      if (data.propertyAddress?.trim().length >= 5)                s += POINTS.propertyAddress;
      if (data.caretakerPhone?.replace(/\D/g, '').length >= 10)    s += POINTS.caretakerPhone;
      if (data.nidFront)                                           s += POINTS.nidFront;
      if (data.nidBack)                                            s += POINTS.nidBack;
      if (data.ownershipProof)                                     s += POINTS.ownershipProof;
    } else {
      if (data.profession)                                         s += POINTS.profession;
      if (data.workPlace?.trim().length >= 2)                      s += POINTS.workPlace;
      if (data.familySize)                                         s += POINTS.familySize;
      if (data.emergencyPhone?.replace(/\D/g, '').length >= 10)    s += POINTS.emergencyContact;
      if (data.nidFront)                                           s += POINTS.nidFront;
      if (data.nidBack)                                            s += POINTS.nidBack;
    }
    return Math.min(100, s);
  }, [data, isLandlord, POINTS]);

  // ─── Step validity ─────────────────────────────────────────────────
  const isStepValid = useCallback(() => {
    const step = activeSteps[stepIdx];
    if (!step) return false;
    switch (step.key) {
      // Tenant
      case 'profession':       return !!data.profession;
      case 'workPlace':        return data.workPlace.trim().length >= 2;
      case 'familySize':       return data.familySize !== null;
      case 'emergency':        return data.emergencyPhone?.replace(/\D/g, '').length >= 10;
      // Landlord
      case 'ownerType':        return !!data.ownerType;
      case 'propertyAddress':  return data.propertyAddress.trim().length >= 5;
      case 'caretaker':        return true; // optional — always valid (Skip allowed)
      case 'ownershipProof':   return true; // optional — always valid (Skip allowed)
      // Shared
      case 'nid':              return isLandlord
                                  ? !!(data.nidFront && data.nidBack)  // REQUIRED for landlord
                                  : true;                              // optional for tenant
      case 'review':           return true;
      default:                 return false;
    }
  }, [activeSteps, stepIdx, data, isLandlord]);

  // Visual completion map (for step rail)
  const completedMap = useMemo(() => {
    const map = {};
    activeSteps.forEach((s) => {
      map[s.key] =
        (s.key === 'profession'       && !!data.profession) ||
        (s.key === 'workPlace'        && data.workPlace.trim().length >= 2) ||
        (s.key === 'familySize'       && data.familySize !== null) ||
        (s.key === 'emergency'        && data.emergencyPhone?.replace(/\D/g, '').length >= 10) ||
        (s.key === 'ownerType'        && !!data.ownerType) ||
        (s.key === 'propertyAddress'  && data.propertyAddress.trim().length >= 5) ||
        (s.key === 'caretaker'        && data.caretakerPhone?.replace(/\D/g, '').length >= 10) ||
        (s.key === 'nid'              && !!(data.nidFront && data.nidBack)) ||
        (s.key === 'ownershipProof'   && !!data.ownershipProof);
    });
    return map;
  }, [activeSteps, data]);

  // ─── Navigation ────────────────────────────────────────────────────
  const goNext = () => {
    if (!isStepValid()) {
      // Custom per-step messages keep the flow feeling smart vs generic.
      const step = activeSteps[stepIdx];
      const msgs = {
        profession:       isBn ? 'একটি পেশা বাছাই করুন।'              : 'Pick a profession to continue.',
        workPlace:        isBn ? 'প্রতিষ্ঠানের নাম লিখুন।'             : 'Type the workplace name.',
        familySize:       isBn ? 'সদস্য সংখ্যা বাছাই করুন।'            : 'Pick a household size.',
        emergency:        isBn ? 'একটি বৈধ মোবাইল নাম্বার লিখুন।'     : 'Enter a valid mobile number.',
        ownerType:        isBn ? 'মালিকানার ধরন বাছাই করুন।'           : 'Pick how you relate to the property.',
        propertyAddress:  isBn ? 'সম্পত্তির ঠিকানা লিখুন।'              : 'Type the property address.',
        nid:              isBn ? 'NID-এর সামনে ও পিছনে আপলোড করুন।'   : 'Upload both NID front and back.',
      };
      setError(msgs[step?.key] || (isBn ? 'এই ধাপ পূরণ করুন।' : 'Please complete this step.'));
      return;
    }
    setError('');
    if (stepIdx < activeSteps.length - 1) setStepIdx((i) => i + 1);
  };

  const goBack = () => { setError(''); if (stepIdx > 0) setStepIdx((i) => i - 1); };

  // ─── File handling (NID + ownership proof) ─────────────────────────
  const nidFrontInputRef     = useRef(null);
  const nidBackInputRef      = useRef(null);
  const ownershipProofInput  = useRef(null);

  const handleFilePick = async (slot, e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!IMAGE_MIMES.includes(file.type)) {
      return setError(isBn ? 'JPG, PNG বা WEBP ফাইল ব্যবহার করুন।' : 'Please use a JPG, PNG or WEBP image.');
    }
    if (file.size > MAX_BYTES) {
      return setError(isBn ? 'ফাইলটি অনেক বড় (সর্বোচ্চ ৫ MB)।' : 'File is too large (max 5 MB).');
    }
    try {
      const dataUrl = await readAsDataURL(file);
      setData((d) => ({
        ...d,
        [slot]: { dataUrl, file, name: file.name, size: file.size, type: file.type },
      }));
    } catch {
      setError(isBn ? 'ফাইল পড়তে সমস্যা হয়েছে।' : 'Could not read file.');
    }
  };

  const removeFile = (slot) => setData((d) => ({ ...d, [slot]: null }));

  // ─── Submit ────────────────────────────────────────────────────────
  // Payload shape is role-aware so the backend can route by `role`
  // without sniffing field names. Keeps controller code obvious.
  const handleSubmit = async () => {
    setError('');
    setSubmitting(true);
    try {
      const payload = isLandlord
        ? {
            role: 'landlord',
            ownerType:       data.ownerType,
            address:         data.propertyAddress.trim(),
            caretaker: {
              name:  data.caretakerName.trim(),
              phone: data.caretakerPhone.trim(),
            },
            nidFront:        data.nidFront,
            nidBack:         data.nidBack,
            ownershipProof:  data.ownershipProof,
            liveScore,
          }
        : {
            role: 'tenant',
            professionType:  data.profession,
            workPlace:       data.workPlace.trim(),
            familySize:      data.familySize,
            emergencyContact: {
              name:  data.emergencyName.trim(),
              phone: data.emergencyPhone.trim(),
            },
            nidFront:        data.nidFront,
            nidBack:         data.nidBack,
            liveScore,
          };
      await onSubmit?.(payload);
    } catch (err) {
      setError(err?.message || (isBn ? 'জমা দিতে সমস্যা হয়েছে।' : 'Submission failed.'));
    } finally {
      setSubmitting(false);
    }
  };

  const current  = activeSteps[stepIdx];
  const isReview = current?.key === 'review';
  const TOTAL    = activeSteps.length;

  if (!open || !current) return null;

  // Role-aware header copy.
  const headerTitle = isLandlord
    ? (isBn ? 'মালিকানা যাচাই' : 'Owner verification')
    : (isBn ? 'পরিচয় যাচাই'   : 'Identity verification');
  const headerSubtitle = isLandlord
    ? (isBn ? 'সম্পত্তির বিবরণ দিন' : 'Tell us about your property')
    : (isBn ? 'নিজেকে পরিচিত করুন'  : 'Tell us about yourself');

  // ─── Render ────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-[100] flex items-stretch sm:items-center sm:justify-center p-0 sm:p-6"
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose?.(); }}
    >
      <div className="absolute inset-0 bg-[#0a0a14]/85 backdrop-blur-xl" />
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.8) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.98 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full sm:max-w-xl bg-[#0f0f1a] sm:rounded-[2rem] border border-white/[0.08] shadow-[0_0_60px_rgba(186,0,54,0.2)] flex flex-col max-h-[100dvh] sm:max-h-[90vh] overflow-hidden"
      >
        {/* Holographic gradient border (top) */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#ff4d6d]/40 to-transparent" />

        {/* ─── Header ─── */}
        <div className="relative px-5 sm:px-7 py-5 border-b border-white/[0.04] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <TrustScoreGauge score={liveScore} isBn={isBn} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-[15px] sm:text-base font-black text-white tracking-tight">
                  {headerTitle}
                </h2>
                <Fingerprint size={12} className="text-[#ff4d6d]" />
              </div>
              <p className="text-[11px] font-bold text-white/40 mt-0.5 truncate">
                {headerSubtitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="w-9 h-9 rounded-full bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/[0.12] flex items-center justify-center text-white/40 hover:text-white/90 transition-all active:scale-95 disabled:opacity-50 shrink-0"
          >
            <X size={15} />
          </button>
        </div>

        {/* ─── Step Rail ─── */}
        <div className="px-5 sm:px-7 py-3 border-b border-white/[0.04] bg-[#0a0a14]/50 shrink-0">
          <div className="flex items-center justify-between gap-3">
            <StepRail steps={activeSteps} currentIdx={stepIdx} completed={completedMap} />
            <span className="text-[10px] font-black text-white/30 uppercase tracking-widest tabular-nums">
              {isBn ? `ধাপ ${stepIdx + 1} / ${TOTAL}` : `Step ${stepIdx + 1} of ${TOTAL}`}
            </span>
          </div>
        </div>

        {/* ─── Step body ─── */}
        <div className="relative flex-1 overflow-y-auto px-5 sm:px-7 py-6">
          <AnimatePresence mode="wait">

            {/* ─────────────────────────────────────────────────────
                TENANT STEPS
                ───────────────────────────────────────────────────── */}
            {current.key === 'profession' && (
              <StepFrame
                key="profession"
                icon={Briefcase}
                titleBn="আপনি কী করেন?" titleEn="What do you do?"
                hintBn="বাড়িওয়ালা সাধারণত এটাই প্রথম জিজ্ঞেস করেন।"
                hintEn="This is usually a landlord's first question."
                isBn={isBn}
              >
                <div className="grid grid-cols-2 gap-2.5">
                  {PROFESSIONS.map((p) => (
                    <Chip
                      key={p.key}
                      icon={p.icon}
                      active={data.profession === p.key}
                      onClick={() => setData((d) => ({ ...d, profession: p.key }))}
                    >
                      {isBn ? p.bn : p.en}
                    </Chip>
                  ))}
                </div>
              </StepFrame>
            )}

            {current.key === 'workPlace' && (
              <StepFrame
                key="workPlace"
                icon={Building2}
                titleBn={data.profession === 'student' ? 'কোথায় পড়াশোনা করেন?' : 'কোথায় কাজ করেন?'}
                titleEn={data.profession === 'student' ? 'Where do you study?'    : 'Where do you work?'}
                hintBn="শুধু নাম লিখুন। কোনো আইডি কার্ড দরকার নেই।"
                hintEn="Just the name. No ID card required."
                isBn={isBn}
              >
                <div className="relative">
                  <Building2 size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/25" />
                  <input
                    type="text"
                    value={data.workPlace}
                    onChange={(e) => setData((d) => ({ ...d, workPlace: e.target.value }))}
                    placeholder={isBn
                      ? (data.profession === 'student' ? 'যেমন: ঢাকা ইউনিভার্সিটি' : 'যেমন: যমুনা ব্যাংক')
                      : (data.profession === 'student' ? 'e.g. Dhaka University'     : 'e.g. Jamuna Bank')}
                    className="w-full pl-12 pr-4 py-4 bg-white/[0.03] hover:bg-white/[0.05] focus:bg-white/[0.06] border border-white/[0.08] focus:border-emerald-500/40 rounded-2xl text-sm font-bold text-white placeholder:text-white/20 transition-all outline-none focus:shadow-[0_0_20px_rgba(16,185,129,0.1)] focus:ring-1 focus:ring-emerald-500/20"
                    autoFocus
                  />
                </div>
                <div className="mt-3.5 p-3.5 rounded-2xl bg-emerald-500/[0.06] border border-emerald-500/10 flex gap-2.5 items-start">
                  <Sparkles size={13} className="text-emerald-400 shrink-0 mt-0.5" />
                  <p className="text-[11px] font-bold text-emerald-300/70 leading-relaxed">
                    {isBn
                      ? 'বাড়িওয়ালারা একটা পরিচিত নাম দেখলেই আশ্বস্ত হন। আপনাকে কোনো প্রমাণ দিতে হবে না।'
                      : 'A familiar workplace name puts most landlords at ease. No proof required.'}
                  </p>
                </div>
              </StepFrame>
            )}

            {current.key === 'familySize' && (
              <StepFrame
                key="familySize"
                icon={Users}
                titleBn="পরিবারে কত জন?" titleEn="How many people?"
                hintBn="বাসায় মোট কত জন থাকবেন?"
                hintEn="Total number of people who'll be living there."
                isBn={isBn}
              >
                <div className="grid grid-cols-2 gap-2.5">
                  {FAMILY_SIZES.map((f) => (
                    <Chip
                      key={f.key}
                      active={data.familySize === f.key}
                      onClick={() => setData((d) => ({ ...d, familySize: f.key }))}
                    >
                      {isBn ? f.bn : f.en}
                    </Chip>
                  ))}
                </div>
              </StepFrame>
            )}

            {current.key === 'emergency' && (
              <StepFrame
                key="emergency"
                icon={Phone}
                titleBn="জরুরি যোগাযোগ" titleEn="Emergency contact"
                hintBn="বাবা-মা, ভাই-বোন বা একজন আত্মীয়ের নাম্বার।"
                hintEn="A parent, sibling, or close relative's number."
                isBn={isBn}
              >
                <div className="space-y-2.5">
                  <div className="relative">
                    <Heart size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/25" />
                    <input
                      type="text"
                      value={data.emergencyName}
                      onChange={(e) => setData((d) => ({ ...d, emergencyName: e.target.value }))}
                      placeholder={isBn ? 'নাম (ঐচ্ছিক) — যেমন: বাবা / ভাই' : 'Name (optional) — e.g. Father / Brother'}
                      className="w-full pl-11 pr-4 py-3.5 bg-white/[0.03] hover:bg-white/[0.05] focus:bg-white/[0.06] border border-white/[0.08] focus:border-[#ff4d6d]/40 rounded-2xl text-sm font-bold text-white placeholder:text-white/20 transition-all outline-none focus:shadow-[0_0_20px_rgba(186,0,54,0.1)] focus:ring-1 focus:ring-[#ff4d6d]/20"
                    />
                  </div>
                  <div className="relative">
                    <Phone size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/25" />
                    <input
                      type="tel"
                      inputMode="tel"
                      value={data.emergencyPhone}
                      onChange={(e) => setData((d) => ({ ...d, emergencyPhone: e.target.value }))}
                      placeholder={isBn ? 'মোবাইল নাম্বার (+880…)' : 'Mobile number (+880…)'}
                      className="w-full pl-11 pr-4 py-3.5 bg-white/[0.03] hover:bg-white/[0.05] focus:bg-white/[0.06] border border-white/[0.08] focus:border-emerald-500/40 rounded-2xl text-sm font-bold text-white placeholder:text-white/20 transition-all outline-none focus:shadow-[0_0_20px_rgba(16,185,129,0.1)] focus:ring-1 focus:ring-emerald-500/20"
                    />
                  </div>
                </div>
              </StepFrame>
            )}

            {/* ─────────────────────────────────────────────────────
                LANDLORD STEPS
                ───────────────────────────────────────────────────── */}
            {current.key === 'ownerType' && (
              <StepFrame
                key="ownerType"
                icon={KeySquare}
                titleBn="আপনি এই সম্পত্তির কে?" titleEn="How are you tied to this property?"
                hintBn="ভাড়াটেরা স্বচ্ছতা পছন্দ করেন।"
                hintEn="Tenants prefer transparency about who they're renting from."
                isBn={isBn}
              >
                <div className="grid grid-cols-1 gap-2.5">
                  {OWNERSHIP_TYPES.map((o) => (
                    <Chip
                      key={o.key}
                      icon={o.icon}
                      active={data.ownerType === o.key}
                      onClick={() => setData((d) => ({ ...d, ownerType: o.key }))}
                    >
                      {isBn ? o.bn : o.en}
                    </Chip>
                  ))}
                </div>
              </StepFrame>
            )}

            {current.key === 'propertyAddress' && (
              <StepFrame
                key="propertyAddress"
                icon={MapPin}
                titleBn="সম্পত্তির ঠিকানা" titleEn="Property address"
                hintBn="শহর + এলাকা। বিস্তারিত ঠিকানা ভাড়াটে confirm হলেই দেখবে।"
                hintEn="City + area is enough here. Full address only revealed after a tenant is confirmed."
                isBn={isBn}
              >
                <div className="relative">
                  <MapPin size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/25" />
                  <input
                    type="text"
                    value={data.propertyAddress}
                    onChange={(e) => setData((d) => ({ ...d, propertyAddress: e.target.value }))}
                    placeholder={isBn ? 'যেমন: ধানমন্ডি ৩২, ঢাকা' : 'e.g. Dhanmondi 32, Dhaka'}
                    className="w-full pl-12 pr-4 py-4 bg-white/[0.03] hover:bg-white/[0.05] focus:bg-white/[0.06] border border-white/[0.08] focus:border-emerald-500/40 rounded-2xl text-sm font-bold text-white placeholder:text-white/20 transition-all outline-none focus:shadow-[0_0_20px_rgba(16,185,129,0.1)] focus:ring-1 focus:ring-emerald-500/20"
                    autoFocus
                  />
                </div>
                <div className="mt-3.5 p-3.5 rounded-2xl bg-emerald-500/[0.06] border border-emerald-500/10 flex gap-2.5 items-start">
                  <Lock size={13} className="text-emerald-400 shrink-0 mt-0.5" />
                  <p className="text-[11px] font-bold text-emerald-300/70 leading-relaxed">
                    {isBn
                      ? 'বিস্তারিত ঠিকানা আমরা ভাড়াটেদের তখনই দেখাই যখন আপনি তাদের inquiry accept করেন।'
                      : 'Full address is revealed to a tenant only after you accept their inquiry.'}
                  </p>
                </div>
              </StepFrame>
            )}

            {current.key === 'caretaker' && (
              <StepFrame
                key="caretaker"
                icon={UserCog}
                titleBn="কেয়ারটেকার / ব্যাকআপ যোগাযোগ"
                titleEn="Caretaker / backup contact"
                hintBn="আপনি অনুপলব্ধ থাকলে যাকে ভাড়াটে কল করতে পারবে।"
                hintEn="Someone tenants can reach when you're unavailable."
                optional isBn={isBn}
              >
                <div className="space-y-2.5">
                  <div className="relative">
                    <UserCog size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/25" />
                    <input
                      type="text"
                      value={data.caretakerName}
                      onChange={(e) => setData((d) => ({ ...d, caretakerName: e.target.value }))}
                      placeholder={isBn ? 'নাম (ঐচ্ছিক)' : 'Name (optional)'}
                      className="w-full pl-11 pr-4 py-3.5 bg-white/[0.03] hover:bg-white/[0.05] focus:bg-white/[0.06] border border-white/[0.08] focus:border-[#ff4d6d]/40 rounded-2xl text-sm font-bold text-white placeholder:text-white/20 transition-all outline-none focus:shadow-[0_0_20px_rgba(186,0,54,0.1)] focus:ring-1 focus:ring-[#ff4d6d]/20"
                    />
                  </div>
                  <div className="relative">
                    <Phone size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/25" />
                    <input
                      type="tel"
                      inputMode="tel"
                      value={data.caretakerPhone}
                      onChange={(e) => setData((d) => ({ ...d, caretakerPhone: e.target.value }))}
                      placeholder={isBn ? 'মোবাইল নাম্বার (+880…)' : 'Mobile number (+880…)'}
                      className="w-full pl-11 pr-4 py-3.5 bg-white/[0.03] hover:bg-white/[0.05] focus:bg-white/[0.06] border border-white/[0.08] focus:border-emerald-500/40 rounded-2xl text-sm font-bold text-white placeholder:text-white/20 transition-all outline-none focus:shadow-[0_0_20px_rgba(16,185,129,0.1)] focus:ring-1 focus:ring-emerald-500/20"
                    />
                  </div>
                </div>
              </StepFrame>
            )}

            {current.key === 'ownershipProof' && (
              <StepFrame
                key="ownershipProof"
                icon={FileText}
                titleBn="মালিকানার প্রমাণ"
                titleEn="Ownership proof"
                hintBn={
                  data.ownerType === 'family'
                    ? 'যেকোনো একটা — হোল্ডিং ট্যাক্স, বিদ্যুৎ বিল, বা দলিলের ছবি।'
                    : 'দলিল, হোল্ডিং ট্যাক্স রসিদ, বা সর্বশেষ বিদ্যুৎ বিলের ছবি।'
                }
                hintEn={
                  data.ownerType === 'family'
                    ? 'Any one — holding tax bill, electricity bill, or deed photo.'
                    : 'Deed, holding tax receipt, or latest electricity bill.'
                }
                optional isBn={isBn}
              >
                <ImageUploadCard
                  value={data.ownershipProof}
                  inputRef={ownershipProofInput}
                  onPick={(e) => handleFilePick('ownershipProof', e)}
                  onRemove={() => removeFile('ownershipProof')}
                  emptyLabelBn="মালিকানার ছবি" emptyLabelEn="Ownership document"
                  isBn={isBn}
                  aspect="aspect-[4/3]"
                />
                <div className="mt-4 p-3.5 rounded-2xl bg-emerald-500/[0.06] border border-emerald-500/10 flex gap-2.5 items-start">
                  <ShieldCheck size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                  <p className="text-[11px] font-bold text-emerald-300/70 leading-relaxed">
                    {isBn
                      ? 'শুধু অ্যাডমিন এটা দেখবে। ভাড়াটেরা শুধু "Verified Owner" badge দেখে।'
                      : 'Only our admin team sees this. Tenants only see your "Verified Owner" badge.'}
                  </p>
                </div>
              </StepFrame>
            )}

            {/* ─────────────────────────────────────────────────────
                SHARED — NID (visible for both, behaviour role-aware)
                ───────────────────────────────────────────────────── */}
            {current.key === 'nid' && (
              <StepFrame
                key="nid"
                icon={IdCard}
                titleBn="NID যাচাই" titleEn="NID verification"
                hintBn={
                  isLandlord
                    ? 'মালিকদের জন্য NID আবশ্যক।'
                    : 'এখন না দিলেও চলবে। বাসা চূড়ান্ত করার সময় চাইব।'
                }
                hintEn={
                  isLandlord
                    ? 'NID is required for landlords.'
                    : "Skip for now if you'd rather not. We'll ask again when you finalise a property."
                }
                optional={!isLandlord} isBn={isBn}
              >
                <div className="grid grid-cols-2 gap-3">
                  <ImageUploadCard
                    value={data.nidFront}
                    inputRef={nidFrontInputRef}
                    onPick={(e) => handleFilePick('nidFront', e)}
                    onRemove={() => removeFile('nidFront')}
                    emptyLabelBn="NID — সামনে" emptyLabelEn="NID — Front"
                    isBn={isBn}
                    aspect="aspect-[4/3]"
                  />
                  <ImageUploadCard
                    value={data.nidBack}
                    inputRef={nidBackInputRef}
                    onPick={(e) => handleFilePick('nidBack', e)}
                    onRemove={() => removeFile('nidBack')}
                    emptyLabelBn="NID — পিছনে" emptyLabelEn="NID — Back"
                    isBn={isBn}
                    aspect="aspect-[4/3]"
                  />
                </div>
                <div className="mt-4 p-3.5 rounded-2xl bg-emerald-500/[0.06] border border-emerald-500/10 flex gap-2.5 items-start">
                  <Lock size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                  <p className="text-[11px] font-bold text-emerald-300/70 leading-relaxed">
                    {isBn
                      ? 'আপনার NID-এর ছবি কখনই public দেখানো হয় না। শুধু অ্যাডমিন review-এর জন্য।'
                      : 'Your NID images are never shown publicly — admin review only.'}
                  </p>
                </div>
              </StepFrame>
            )}

            {/* ─────────────────────────────────────────────────────
                SHARED — REVIEW
                ───────────────────────────────────────────────────── */}
            {isReview && (
              <StepFrame
                key="review"
                icon={Sparkles}
                titleBn="পর্যালোচনা" titleEn="Review"
                hintBn="সব ঠিক থাকলে জমা দিন।"
                hintEn="Looks good? Submit when ready."
                isBn={isBn}
              >
                {initialData && (
                  <div className="flex justify-end mb-3">
                    <button
                      type="button"
                      onClick={() => { onClose?.(); onEditProfile?.(); }}
                      className="px-3 py-1.5 rounded-full bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-white/60 hover:text-white transition-colors text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5"
                    >
                      <Edit3 size={12} />
                      {isBn ? 'প্রোফাইল এডিট করুন' : 'Edit Profile'}
                    </button>
                  </div>
                )}

                <div className="space-y-2.5">
                  {isLandlord ? (
                    <>
                      <SummaryRow icon={KeySquare} labelBn="মালিকানা" labelEn="Ownership" isBn={isBn}
                        value={OWNERSHIP_TYPES.find((o) => o.key === data.ownerType)?.[isBn ? 'bn' : 'en']} />
                      <SummaryRow icon={MapPin} labelBn="ঠিকানা" labelEn="Address" isBn={isBn}
                        value={data.propertyAddress} />
                      <SummaryRow icon={UserCog} labelBn="কেয়ারটেকার" labelEn="Caretaker" isBn={isBn}
                        value={data.caretakerPhone ? `${data.caretakerName || '—'} · ${data.caretakerPhone}` : ''}
                        muted={!data.caretakerPhone} />
                      <SummaryRow icon={IdCard} labelBn="NID" labelEn="NID" isBn={isBn}
                        value={(data.nidFront && data.nidBack)
                          ? (isBn ? 'যোগ করা হয়েছে' : 'Added')
                          : (isBn ? 'আবশ্যক' : 'Required')}
                        muted={!(data.nidFront && data.nidBack)} />
                      <SummaryRow icon={FileText} labelBn="মালিকানার প্রমাণ" labelEn="Ownership proof" isBn={isBn}
                        value={data.ownershipProof
                          ? (isBn ? 'যোগ করা হয়েছে' : 'Added')
                          : (isBn ? 'পরে যোগ করব' : 'Add later')}
                        muted={!data.ownershipProof} />
                    </>
                  ) : (
                    <>
                      <SummaryRow icon={Briefcase} labelBn="পেশা" labelEn="Profession" isBn={isBn}
                        value={PROFESSIONS.find((p) => p.key === data.profession)?.[isBn ? 'bn' : 'en']} />
                      <SummaryRow icon={Building2}
                        labelBn={data.profession === 'student' ? 'প্রতিষ্ঠান' : 'কাজের স্থান'}
                        labelEn={data.profession === 'student' ? 'Institution' : 'Workplace'}
                        isBn={isBn}
                        value={data.workPlace} />
                      <SummaryRow icon={Users} labelBn="সদস্য সংখ্যা" labelEn="Household size" isBn={isBn}
                        value={data.familySize ? (FAMILY_SIZES.find((f) => f.key === data.familySize)?.[isBn ? 'bn' : 'en']) : ''} />
                      <SummaryRow icon={Phone} labelBn="জরুরি যোগাযোগ" labelEn="Emergency contact" isBn={isBn}
                        value={data.emergencyPhone ? `${data.emergencyName || '—'} · ${data.emergencyPhone}` : ''} />
                      <SummaryRow icon={IdCard} labelBn="NID" labelEn="NID" isBn={isBn}
                        value={(data.nidFront && data.nidBack)
                          ? (isBn ? 'যোগ করা হয়েছে' : 'Added')
                          : (isBn ? 'পরে যোগ করব' : 'Add later')}
                        muted={!(data.nidFront && data.nidBack)} />
                    </>
                  )}
                </div>

                {/* Trust booster nudge — only when NID is still missing AND
                    role allows skipping it (tenants). Landlords can't reach
                    review without NID, so this card never shows for them. */}
                {!data.nidFront && !isLandlord && (
                  <div className="mt-5 p-4 rounded-2xl bg-gradient-to-br from-emerald-500/[0.06] to-[#ff4d6d]/[0.04] border border-emerald-500/10">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/15 flex items-center justify-center shrink-0">
                        <Award size={16} className="text-emerald-400" />
                      </div>
                      <div>
                        <p className="text-[12px] font-black text-emerald-300 mb-0.5">
                          {isBn ? 'NID যোগ করলে ট্রাস্ট স্কোর বাড়বে' : 'Add NID to boost Trust Score'}
                        </p>
                        <p className="text-[11px] font-bold text-emerald-400/50 leading-relaxed">
                          {isBn
                            ? 'ভেরিফায়েড টেনেন্টদের বাড়িওয়ালারা ৩x বেশি দ্রুত response দেন।'
                            : 'Verified tenants get a 3x faster response from landlords.'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </StepFrame>
            )}

          </AnimatePresence>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 p-3 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center gap-2"
            >
              <AlertCircle size={14} className="text-red-400 shrink-0" />
              <p className="text-[12px] font-bold text-red-300">{error}</p>
            </motion.div>
          )}
        </div>

        {/* ─── Footer (nav buttons) ─── */}
        <div className="relative px-5 sm:px-7 py-4 border-t border-white/[0.04] flex items-center justify-between gap-3 shrink-0 bg-[#0f0f1a]/60 backdrop-blur-sm">
          <button
            type="button"
            onClick={goBack}
            disabled={stepIdx === 0 || submitting}
            className="px-4 py-2.5 rounded-full text-sm font-bold text-white/40 hover:text-white/70 hover:bg-white/[0.05] disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5 transition-all border border-transparent hover:border-white/[0.06]"
          >
            <ChevronLeft size={15} /> {isBn ? 'পিছনে' : 'Back'}
          </button>

          {isReview ? (
            <motion.button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="relative px-7 py-3.5 rounded-full text-sm font-black text-white bg-gradient-to-r from-emerald-600 via-emerald-500 to-emerald-600 hover:shadow-[0_0_30px_rgba(16,185,129,0.4)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-[shimmer_2.5s_linear_infinite]" />
              {submitting ? (
                <><Loader2 size={15} className="relative z-10 animate-spin" /> <span className="relative z-10">{isBn ? 'জমা দেওয়া হচ্ছে…' : 'Submitting…'}</span></>
              ) : (
                <><span className="relative z-10">{isBn ? 'সম্পন্ন করুন' : 'Finish'}</span> <Check size={15} className="relative z-10" /></>
              )}
            </motion.button>
          ) : (
            <motion.button
              type="button"
              onClick={goNext}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="relative px-7 py-3.5 rounded-full text-sm font-black text-white bg-gradient-to-r from-[#ba0036] via-[#e0004d] to-[#ba0036] hover:shadow-[0_0_30px_rgba(186,0,54,0.4)] flex items-center gap-1.5 transition-all overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-[shimmer_2.5s_linear_infinite]" />
              <span className="relative z-10">
                {current.optional && !completedMap[current.key]
                  ? (isBn ? 'এড়িয়ে যান' : 'Skip')
                  : (isBn ? 'পরবর্তী' : 'Next')}
              </span>
              <ChevronRight size={15} className="relative z-10" />
            </motion.button>
          )}
        </div>
      </motion.div>

      <style>{`
        @keyframes shimmer {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
};

// ─── Exports ─────────────────────────────────────────────────────────────
// Default export keeps the old name so every existing
//   `import TenantVerificationModal from './TenantVerificationModal'`
// keeps working without any change. `VerificationModal` is also exported
// as a named export for new call sites that want explicit naming.
export default VerificationModal;
export { VerificationModal };
export const TenantVerificationModal = VerificationModal;