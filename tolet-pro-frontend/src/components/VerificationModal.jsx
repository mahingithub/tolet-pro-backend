/**
 * VerificationModal.jsx
 * ─────────────────────────────────────────────────────────────────────────
 * Unified identity-verification wizard — modularised into role-specific
 * sub-components. Only fields that DIRECTLY impact the backend Trust Score
 * (utils/trustScore.js) are collected. Everything else is discarded.
 *
 * Usage:
 *   <VerificationModal role="tenant"   ... />   ← default
 *   <VerificationModal role="landlord" ... />   ← host flow
 *
 * TENANT trust score items collected here (max 80 pts in modal):
 *   • professionType  → gates professionProof scoring  (30 pts)
 *   • photo           → profile photo                  (20 pts)
 *   • nidFront+Back   → NID                            (30 pts)
 *   • professionProof → profession proof doc            (30 pts)
 *   (phone 20 pts is already captured at signup — not re-asked)
 *
 * LANDLORD trust score items collected here (max 70 pts in modal):
 *   • photo             → selfie verification          (20 pts)
 *   • nidFront+Back     → NID                          (25 pts)
 *   • preferredTenants  → landlord preferences          (5 pts)
 *   • communication     → landlord preferences          (5 pts)
 *   • serviceCharge     → landlord preferences          (5 pts)
 *   • houseRules        → landlord preferences         (10 pts)
 *   (phone 20 pts + avatar 10 pts already captured elsewhere)
 *
 * Backwards-compat:
 *   Default export = VerificationModal
 *   Named exports: { VerificationModal, TenantVerificationModal }
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, ChevronLeft, ChevronRight, Check, CheckCircle2,
  Sparkles, Briefcase, GraduationCap, Store, Users,
  Building2, Phone, IdCard, ShieldCheck,
  ImagePlus, Loader2, AlertCircle, Trash2,
  ArrowRight, Lock, Award, Zap, Fingerprint,
  Edit3, Camera, MessageSquare, DollarSign, ScrollText,
  UserCog, HandHeart,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════
const MAX_BYTES   = 5 * 1024 * 1024;
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

// ── Tenant trust-score weights (mirrors backend computeTenantTrust) ──────
// phone(20) is NOT in the modal — already captured at signup.
const TENANT_POINTS = {
  photo:           30,
  nidFront:        25, // 50 total for nid, split visually
  nidBack:         25,
};

// ── Landlord trust-score weights (mirrors backend computeLandlordTrust) ──
// phone(20) + avatar(10) are NOT in the modal.
const LANDLORD_POINTS = {
  photo:            20,
  nidFront:         12, // 25 total for nid, split visually
  nidBack:          13,
  preferredTenants:  5,
  communication:     5,
  serviceCharge:     5,
  houseRules:       10,
};

// ═══════════════════════════════════════════════════════════════════════════
//  TENANT OPTIONS
// ═══════════════════════════════════════════════════════════════════════════
const PROFESSIONS = [
  { key: 'employed',      icon: Briefcase,     en: 'Salaried',   bn: 'চাকরিজীবী' },
  { key: 'self-employed', icon: Store,         en: 'Business',   bn: 'ব্যবসায়ী' },
  { key: 'student',       icon: GraduationCap, en: 'Student',    bn: 'ছাত্র/ছাত্রী' },
  { key: 'other',         icon: Users,         en: 'Other',      bn: 'অন্যান্য' },
];

// ═══════════════════════════════════════════════════════════════════════════
//  LANDLORD OPTIONS (all scoring fields from computeLandlordTrust)
// ═══════════════════════════════════════════════════════════════════════════
const TENANT_TYPE_OPTIONS = [
  { key: 'family',       icon: Users,         en: 'Family',       bn: 'পরিবার' },
  { key: 'bachelor_m',   icon: UserCog,       en: 'Bachelor (M)', bn: 'ব্যাচেলর (পুরুষ)' },
  { key: 'bachelor_f',   icon: UserCog,       en: 'Bachelor (F)', bn: 'ব্যাচেলর (মহিলা)' },
  { key: 'student',      icon: GraduationCap, en: 'Student',      bn: 'ছাত্র' },
  { key: 'job_holder',   icon: Briefcase,     en: 'Job Holder',   bn: 'চাকরিজীবী' },
  { key: 'anyone',       icon: HandHeart,     en: 'Anyone',       bn: 'যে কেউ' },
];

const COMM_OPTIONS = [
  { key: 'phone',        en: 'Phone call',  bn: 'ফোন কল' },
  { key: 'whatsapp',     en: 'WhatsApp',    bn: 'হোয়াটসঅ্যাপ' },
  { key: 'sms',          en: 'SMS',         bn: 'এসএমএস' },
  { key: 'app_only',     en: 'App Only',    bn: 'শুধু অ্যাপ' },
  { key: 'direct_call',  en: 'Direct Call', bn: 'সরাসরি কল' },
];

const HOUSE_RULES_OPTIONS = [
  { key: 'no_smoking',    en: 'No smoking',          bn: 'ধূমপান নিষেধ' },
  { key: 'no_pets',       en: 'No pets',             bn: 'পোষা প্রাণী নিষেধ' },
  { key: 'no_loud_music', en: 'No loud music',       bn: 'উচ্চ শব্দে গান নিষেধ' },
  { key: 'no_late_guest', en: 'No late guests',      bn: 'রাত ১১টার পর অতিথি নিষেধ' },
  { key: 'keep_clean',    en: 'Keep clean',          bn: 'পরিষ্কার রাখুন' },
  { key: 'no_sublet',     en: 'No subletting',       bn: 'সাবলেট নিষেধ' },
  { key: 'curfew_11pm',   en: 'Curfew 11 PM',        bn: 'রাত ১১টায় গেট বন্ধ' },
];

// ═══════════════════════════════════════════════════════════════════════════
//  STEP LISTS
// ═══════════════════════════════════════════════════════════════════════════
const TENANT_STEPS = [
  { key: 'profession',      icon: Briefcase,  required: true,  optional: false },
  { key: 'photo',           icon: Camera,     required: true,  optional: false },
  { key: 'nid',             icon: IdCard,     required: false, optional: true  },
  { key: 'review',          icon: Sparkles,   required: false, optional: false },
];

const LANDLORD_STEPS = [
  { key: 'preferredTenants', icon: Users,          required: true,  optional: false },
  { key: 'communication',    icon: MessageSquare,  required: true,  optional: false },
  { key: 'houseRules',       icon: ScrollText,     required: true,  optional: false },
  { key: 'serviceCharge',    icon: DollarSign,     required: true,  optional: false },
  { key: 'photo',            icon: Camera,         required: true,  optional: false },
  { key: 'nid',              icon: IdCard,         required: true,  optional: false },
  { key: 'review',           icon: Sparkles,       required: false, optional: false },
];

// ═══════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════════
const readAsDataURL = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload  = () => resolve(r.result);
  r.onerror = () => reject(new Error('read'));
  r.readAsDataURL(file);
});

// ═══════════════════════════════════════════════════════════════════════════
//  SHARED UI ATOMS
// ═══════════════════════════════════════════════════════════════════════════

// ── Chip (single-select or multi-select toggle) ─────────────────────────
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

// ── Trust Score Gauge ───────────────────────────────────────────────────
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

// ── Step Rail ───────────────────────────────────────────────────────────
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

// ── Step Frame ──────────────────────────────────────────────────────────
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

// ── Image Upload Card ───────────────────────────────────────────────────
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

// ── Summary Row ─────────────────────────────────────────────────────────
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


// ═══════════════════════════════════════════════════════════════════════════
//  <TenantFields> — renders step bodies for tenant-only scoring fields
// ═══════════════════════════════════════════════════════════════════════════
const TenantFields = ({ stepKey, data, setData, isBn, photoInputRef, handleFilePick, removeFile }) => {
  if (stepKey === 'profession') {
    return (
      <StepFrame
        key="profession"
        icon={Briefcase}
        titleBn="আপনি কী করেন?" titleEn="What do you do?"
        hintBn="পেশা বাছাই করুন — এটি ট্রাস্ট স্কোরে প্রভাব ফেলবে।"
        hintEn="Pick your profession — this affects your Trust Score."
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
        <div className="mt-3.5 p-3.5 rounded-2xl bg-emerald-500/[0.06] border border-emerald-500/10 flex gap-2.5 items-start">
          <Sparkles size={13} className="text-emerald-400 shrink-0 mt-0.5" />
          <p className="text-[11px] font-bold text-emerald-300/70 leading-relaxed">
            {isBn
              ? '"অন্যান্য" বাছাই করলেও পেশার প্রমাণ ছাড়াই ট্রাস্ট পয়েন্ট পাবেন।'
              : 'Choosing "Other" earns profession trust points without uploading proof.'}
          </p>
        </div>
      </StepFrame>
    );
  }

  if (stepKey === 'photo') {
    return (
      <StepFrame
        key="photo"
        icon={Camera}
        titleBn="প্রোফাইল ফটো" titleEn="Profile photo"
        hintBn="একটি পরিষ্কার ছবি আপলোড করুন — ট্রাস্ট স্কোরে ২০ পয়েন্ট যোগ হবে।"
        hintEn="Upload a clear photo — adds 20 points to your Trust Score."
        isBn={isBn}
      >
        <ImageUploadCard
          value={data.photo}
          inputRef={photoInputRef}
          onPick={(e) => handleFilePick('photo', e)}
          onRemove={() => removeFile('photo')}
          emptyLabelBn="ছবি আপলোড করুন" emptyLabelEn="Upload photo"
          isBn={isBn}
          aspect="aspect-square max-w-[200px] mx-auto"
        />
        <div className="mt-4 p-3.5 rounded-2xl bg-emerald-500/[0.06] border border-emerald-500/10 flex gap-2.5 items-start">
          <Lock size={14} className="text-emerald-400 shrink-0 mt-0.5" />
          <p className="text-[11px] font-bold text-emerald-300/70 leading-relaxed">
            {isBn
              ? 'আপনার ছবি শুধু অ্যাডমিন রিভিউয়ের জন্য — পাবলিকলি দেখানো হবে না।'
              : 'Your photo is for admin review only — never shown publicly.'}
          </p>
        </div>
      </StepFrame>
    );
  }



  return null;
};


// ═══════════════════════════════════════════════════════════════════════════
//  <HostFields> — renders step bodies for landlord-only scoring fields
// ═══════════════════════════════════════════════════════════════════════════
const HostFields = ({ stepKey, data, setData, isBn, photoInputRef, handleFilePick, removeFile }) => {

  // Multi-select toggle helper
  const toggleArray = (field, key) => {
    setData((d) => {
      const arr = d[field] || [];
      return {
        ...d,
        [field]: arr.includes(key) ? arr.filter((k) => k !== key) : [...arr, key],
      };
    });
  };

  if (stepKey === 'preferredTenants') {
    return (
      <StepFrame
        key="preferredTenants"
        icon={Users}
        titleBn="পছন্দের ভাড়াটিয়া" titleEn="Preferred tenants"
        hintBn="কাদের ভাড়া দিতে চান? একাধিক বাছাই করতে পারেন। (+৫ ট্রাস্ট)"
        hintEn="Who would you prefer to rent to? Select multiple. (+5 Trust)"
        isBn={isBn}
      >
        <div className="grid grid-cols-2 gap-2.5">
          {TENANT_TYPE_OPTIONS.map((o) => (
            <Chip
              key={o.key}
              icon={o.icon}
              active={(data.preferredTenants || []).includes(o.key)}
              onClick={() => toggleArray('preferredTenants', o.key)}
            >
              {isBn ? o.bn : o.en}
            </Chip>
          ))}
        </div>
      </StepFrame>
    );
  }

  if (stepKey === 'communication') {
    return (
      <StepFrame
        key="communication"
        icon={MessageSquare}
        titleBn="যোগাযোগের মাধ্যম" titleEn="Communication method"
        hintBn="ভাড়াটেরা আপনাকে কীভাবে যোগাযোগ করবে? (+৫ ট্রাস্ট)"
        hintEn="How should tenants reach you? (+5 Trust)"
        isBn={isBn}
      >
        <div className="grid grid-cols-2 gap-2.5">
          {COMM_OPTIONS.map((o) => (
            <Chip
              key={o.key}
              active={(data.communication || []).includes(o.key)}
              onClick={() => toggleArray('communication', o.key)}
            >
              {isBn ? o.bn : o.en}
            </Chip>
          ))}
        </div>
      </StepFrame>
    );
  }

  if (stepKey === 'houseRules') {
    return (
      <StepFrame
        key="houseRules"
        icon={ScrollText}
        titleBn="বাড়ির নিয়ম" titleEn="House rules"
        hintBn="কোন নিয়ম প্রযোজ্য? একাধিক বাছাই করতে পারেন। (+১০ ট্রাস্ট)"
        hintEn="Which rules apply? Select multiple. (+10 Trust)"
        isBn={isBn}
      >
        <div className="grid grid-cols-2 gap-2.5">
          {HOUSE_RULES_OPTIONS.map((o) => (
            <Chip
              key={o.key}
              active={(data.houseRules || []).includes(o.key)}
              onClick={() => toggleArray('houseRules', o.key)}
            >
              {isBn ? o.bn : o.en}
            </Chip>
          ))}
        </div>
      </StepFrame>
    );
  }

  if (stepKey === 'serviceCharge') {
    return (
      <StepFrame
        key="serviceCharge"
        icon={DollarSign}
        titleBn="সার্ভিস চার্জ" titleEn="Service charge"
        hintBn="মাসিক সার্ভিস চার্জ (৳) — ০ হলেও লিখুন। (+৫ ট্রাস্ট)"
        hintEn="Monthly service charge (৳) — enter 0 if none. (+5 Trust)"
        isBn={isBn}
      >
        <div className="relative">
          <DollarSign size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/25" />
          <input
            type="number"
            inputMode="numeric"
            min="0"
            value={data.serviceCharge}
            onChange={(e) => setData((d) => ({ ...d, serviceCharge: e.target.value }))}
            placeholder={isBn ? 'যেমন: ৩০০০' : 'e.g. 3000'}
            className="w-full pl-12 pr-4 py-4 bg-white/[0.03] hover:bg-white/[0.05] focus:bg-white/[0.06] border border-white/[0.08] focus:border-emerald-500/40 rounded-2xl text-sm font-bold text-white placeholder:text-white/20 transition-all outline-none focus:shadow-[0_0_20px_rgba(16,185,129,0.1)] focus:ring-1 focus:ring-emerald-500/20"
            autoFocus
          />
        </div>
        <div className="mt-3.5 p-3.5 rounded-2xl bg-emerald-500/[0.06] border border-emerald-500/10 flex gap-2.5 items-start">
          <Sparkles size={13} className="text-emerald-400 shrink-0 mt-0.5" />
          <p className="text-[11px] font-bold text-emerald-300/70 leading-relaxed">
            {isBn
              ? 'সার্ভিস চার্জ যোগ করলে ভাড়াটেরা স্বচ্ছতা দেখে আস্থা পান।'
              : 'Adding a service charge shows transparency and builds tenant trust.'}
          </p>
        </div>
      </StepFrame>
    );
  }

  if (stepKey === 'photo') {
    return (
      <StepFrame
        key="photo"
        icon={Camera}
        titleBn="সেলফি ভেরিফিকেশন" titleEn="Selfie verification"
        hintBn="একটি পরিষ্কার সেলফি আপলোড করুন — ট্রাস্ট স্কোরে ২০ পয়েন্ট যোগ হবে।"
        hintEn="Upload a clear selfie — adds 20 points to your Trust Score."
        isBn={isBn}
      >
        <ImageUploadCard
          value={data.photo}
          inputRef={photoInputRef}
          onPick={(e) => handleFilePick('photo', e)}
          onRemove={() => removeFile('photo')}
          emptyLabelBn="সেলফি আপলোড করুন" emptyLabelEn="Upload selfie"
          isBn={isBn}
          aspect="aspect-square max-w-[200px] mx-auto"
        />
        <div className="mt-4 p-3.5 rounded-2xl bg-emerald-500/[0.06] border border-emerald-500/10 flex gap-2.5 items-start">
          <ShieldCheck size={14} className="text-emerald-400 shrink-0 mt-0.5" />
          <p className="text-[11px] font-bold text-emerald-300/70 leading-relaxed">
            {isBn
              ? 'শুধু অ্যাডমিন দেখবে। ভাড়াটেরা শুধু "Verified Host" badge দেখে।'
              : 'Only our admin team sees this. Tenants only see your "Verified Host" badge.'}
          </p>
        </div>
      </StepFrame>
    );
  }

  return null;
};


// ═══════════════════════════════════════════════════════════════════════════
//  <TenantReview> — review summary rows for tenant
// ═══════════════════════════════════════════════════════════════════════════
const TenantReview = ({ data, isBn }) => (
  <div className="space-y-2.5">
    <SummaryRow icon={Briefcase} labelBn="পেশা" labelEn="Profession" isBn={isBn}
      value={PROFESSIONS.find((p) => p.key === data.profession)?.[isBn ? 'bn' : 'en']} />
    <SummaryRow icon={Camera} labelBn="প্রোফাইল ফটো" labelEn="Profile photo" isBn={isBn}
      value={data.photo ? (isBn ? 'যোগ করা হয়েছে' : 'Added') : (isBn ? 'যোগ করা হয়নি' : 'Not added')}
      muted={!data.photo} />

    <SummaryRow icon={IdCard} labelBn="NID" labelEn="NID" isBn={isBn}
      value={(data.nidFront && data.nidBack)
        ? (isBn ? 'যোগ করা হয়েছে' : 'Added')
        : (isBn ? 'পরে যোগ করব' : 'Add later')}
      muted={!(data.nidFront && data.nidBack)} />
  </div>
);


// ═══════════════════════════════════════════════════════════════════════════
//  <HostReview> — review summary rows for landlord
// ═══════════════════════════════════════════════════════════════════════════
const HostReview = ({ data, isBn }) => (
  <div className="space-y-2.5">
    <SummaryRow icon={Users} labelBn="পছন্দের ভাড়াটিয়া" labelEn="Preferred tenants" isBn={isBn}
      value={(data.preferredTenants || []).map(k => TENANT_TYPE_OPTIONS.find(o => o.key === k)?.[isBn ? 'bn' : 'en']).filter(Boolean).join(', ')}
      muted={(data.preferredTenants || []).length === 0} />
    <SummaryRow icon={MessageSquare} labelBn="যোগাযোগের মাধ্যম" labelEn="Communication" isBn={isBn}
      value={(data.communication || []).map(k => COMM_OPTIONS.find(o => o.key === k)?.[isBn ? 'bn' : 'en']).filter(Boolean).join(', ')}
      muted={(data.communication || []).length === 0} />
    <SummaryRow icon={ScrollText} labelBn="বাড়ির নিয়ম" labelEn="House rules" isBn={isBn}
      value={(data.houseRules || []).map(k => HOUSE_RULES_OPTIONS.find(o => o.key === k)?.[isBn ? 'bn' : 'en']).filter(Boolean).join(', ')}
      muted={(data.houseRules || []).length === 0} />
    <SummaryRow icon={DollarSign} labelBn="সার্ভিস চার্জ" labelEn="Service charge" isBn={isBn}
      value={data.serviceCharge !== '' && data.serviceCharge != null ? `৳ ${data.serviceCharge}` : ''}
      muted={data.serviceCharge === '' || data.serviceCharge == null} />
    <SummaryRow icon={Camera} labelBn="সেলফি" labelEn="Selfie" isBn={isBn}
      value={data.photo ? (isBn ? 'যোগ করা হয়েছে' : 'Added') : (isBn ? 'যোগ করা হয়নি' : 'Not added')}
      muted={!data.photo} />
    <SummaryRow icon={IdCard} labelBn="NID" labelEn="NID" isBn={isBn}
      value={(data.nidFront && data.nidBack) || data.nidVerified
        ? (isBn ? 'যোগ করা হয়েছে' : 'Added')
        : (isBn ? 'আবশ্যক' : 'Required')}
      muted={!(data.nidFront && data.nidBack) && !data.nidVerified} />
  </div>
);


// ═══════════════════════════════════════════════════════════════════════════
//  MAIN MODAL
// ═══════════════════════════════════════════════════════════════════════════
const VerificationModal = ({
  open,
  onClose,
  onSubmit,
  onEditProfile,
  role         = 'tenant',
  language     = 'বাংলা',
  initialData  = null,
}) => {
  const isBn        = language === 'বাংলা';
  const isLandlord  = role === 'landlord';
  const POINTS      = isLandlord ? LANDLORD_POINTS : TENANT_POINTS;
  const BASE_STEPS  = isLandlord ? LANDLORD_STEPS  : TENANT_STEPS;

  // ─── State (only trust-scoring fields) ─────────────────────────────
  const buildTenantState = () => ({
    profession:      '',
    photo:           null,
    nidFront:        null,
    nidBack:         null,
  });

  const buildHostState = () => ({
    preferredTenants: [],
    communication:    [],
    houseRules:       [],
    serviceCharge:    '',
    photo:            null,
    nidFront:         null,
    nidBack:          null,
  });

  const buildEmptyState = isLandlord ? buildHostState : buildTenantState;

  const [activeSteps, setActiveSteps] = useState(BASE_STEPS);
  const [stepIdx, setStepIdx]         = useState(0);
  const [data, setData]               = useState(buildEmptyState);
  const [submitting, setSubmitting]   = useState(false);
  const [error,      setError]        = useState('');

  // ─── Hydration ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;

    let seed = buildEmptyState();

    if (initialData && typeof initialData === 'object') {
      if (isLandlord) {
        seed = {
          ...seed,
          preferredTenants: initialData.preferredTenants || [],
          communication:    initialData.communication    || [],
          houseRules:       initialData.houseRules        || [],
          serviceCharge:    initialData.serviceCharge != null ? String(initialData.serviceCharge) : '',
        };
      } else {
        seed = {
          ...seed,
          profession: initialData.professionType || '',
        };
      }
      if (initialData.nidVerified) {
        seed.nidVerified = true;
      }
    }

    // Skip already-completed steps
    const filtered = BASE_STEPS.filter((step) => {
      if (step.key === 'review') return true;
      if (step.key === 'nid') return !seed.nidVerified;
      if (step.key === 'profession'       && seed.profession)                            return false;
      if (step.key === 'preferredTenants'  && (seed.preferredTenants || []).length > 0)   return false;
      if (step.key === 'communication'     && (seed.communication || []).length > 0)      return false;
      if (step.key === 'houseRules'        && (seed.houseRules || []).length > 0)         return false;
      if (step.key === 'serviceCharge'     && seed.serviceCharge !== '')                  return false;
      return true;
    });

    setData(seed);
    setActiveSteps(filtered.length > 0 ? filtered : BASE_STEPS);
    setStepIdx(0);
    setError('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialData, role]);

  // ─── Live trust score ──────────────────────────────────────────────
  const liveScore = useMemo(() => {
    let s = 0;
    if (isLandlord) {
      if (data.photo)                                              s += POINTS.photo;
      if (data.nidFront || data.nidVerified)                       s += POINTS.nidFront + POINTS.nidBack; // Assuming NID points total
      if ((data.preferredTenants || []).length > 0)                 s += POINTS.preferredTenants;
      if ((data.communication || []).length > 0)                    s += POINTS.communication;
      if (data.serviceCharge !== '' && data.serviceCharge != null)  s += POINTS.serviceCharge;
      if ((data.houseRules || []).length > 0)                       s += POINTS.houseRules;
    } else {
      if (data.photo)                                              s += POINTS.photo;
      if (data.nidFront || data.nidVerified)                       s += POINTS.nidFront + POINTS.nidBack;
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
      // Landlord
      case 'preferredTenants': return (data.preferredTenants || []).length > 0;
      case 'communication':    return (data.communication || []).length > 0;
      case 'houseRules':       return (data.houseRules || []).length > 0;
      case 'serviceCharge':    return data.serviceCharge !== '' && data.serviceCharge != null;
      // Shared
      case 'photo':            return !!data.photo;
      case 'nid':              return data.nidVerified || (isLandlord
                                  ? !!(data.nidFront && data.nidBack)
                                  : true); // optional for tenant
      case 'review':           return true;
      default:                 return false;
    }
  }, [activeSteps, stepIdx, data, isLandlord]);

  // ─── Completion map (step rail) ────────────────────────────────────
  const completedMap = useMemo(() => {
    const map = {};
    activeSteps.forEach((s) => {
      map[s.key] =
        (s.key === 'profession'       && !!data.profession) ||
        (s.key === 'photo'            && !!data.photo) ||
        (s.key === 'preferredTenants' && (data.preferredTenants || []).length > 0) ||
        (s.key === 'communication'    && (data.communication || []).length > 0) ||
        (s.key === 'houseRules'       && (data.houseRules || []).length > 0) ||
        (s.key === 'serviceCharge'    && data.serviceCharge !== '' && data.serviceCharge != null) ||
        (s.key === 'nid'              && (data.nidVerified || !!(data.nidFront && data.nidBack)));
    });
    return map;
  }, [activeSteps, data]);

  // ─── Navigation ────────────────────────────────────────────────────
  const goNext = () => {
    if (!isStepValid()) {
      const step = activeSteps[stepIdx];
      const msgs = {
        profession:       isBn ? 'একটি পেশা বাছাই করুন।'                     : 'Pick a profession to continue.',
        photo:            isBn ? 'একটি ছবি আপলোড করুন।'                     : 'Upload a photo to continue.',
        preferredTenants: isBn ? 'অন্তত একটি ভাড়াটিয়ার ধরন বাছাই করুন।'    : 'Select at least one tenant type.',
        communication:    isBn ? 'অন্তত একটি যোগাযোগ মাধ্যম বাছাই করুন।'    : 'Select at least one communication method.',
        houseRules:       isBn ? 'অন্তত একটি বাড়ির নিয়ম বাছাই করুন।'       : 'Select at least one house rule.',
        serviceCharge:    isBn ? 'সার্ভিস চার্জের পরিমাণ লিখুন।'              : 'Enter the service charge amount.',
        nid:              isBn ? 'NID-এর সামনে ও পিছনে আপলোড করুন।'        : 'Upload both NID front and back.',
      };
      setError(msgs[step?.key] || (isBn ? 'এই ধাপ পূরণ করুন।' : 'Please complete this step.'));
      return;
    }
    setError('');
    if (stepIdx < activeSteps.length - 1) setStepIdx((i) => i + 1);
  };

  const goBack = () => { setError(''); if (stepIdx > 0) setStepIdx((i) => i - 1); };

  // ─── File handling ─────────────────────────────────────────────────
  const nidFrontInputRef      = useRef(null);
  const nidBackInputRef       = useRef(null);
  const photoInputRef         = useRef(null);

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
  const handleSubmit = async () => {
    setError('');
    setSubmitting(true);
    try {
      const payload = isLandlord
        ? {
            role: 'landlord',
            preferredTenants: data.preferredTenants,
            communication:    data.communication,
            houseRules:       data.houseRules,
            serviceCharge:    data.serviceCharge !== '' ? Number(data.serviceCharge) : null,
            photo:            data.photo,
            nidFront:         data.nidFront,
            nidBack:          data.nidBack,
            liveScore,
          }
        : {
            role: 'tenant',
            professionType:  data.profession,
            photo:           data.photo,
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

  const headerTitle = isLandlord
    ? (isBn ? 'মালিক যাচাই' : 'Host verification')
    : (isBn ? 'পরিচয় যাচাই' : 'Identity verification');
  const headerSubtitle = isLandlord
    ? (isBn ? 'ট্রাস্ট স্কোর বাড়ান' : 'Boost your Trust Score')
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

            {/* ── Role-specific steps ── */}
            {!isLandlord && !['nid', 'review'].includes(current.key) && (
              <TenantFields
                stepKey={current.key}
                data={data}
                setData={setData}
                isBn={isBn}
                photoInputRef={photoInputRef}
                handleFilePick={handleFilePick}
                removeFile={removeFile}
              />
            )}

            {isLandlord && !['nid', 'review'].includes(current.key) && (
              <HostFields
                stepKey={current.key}
                data={data}
                setData={setData}
                isBn={isBn}
                photoInputRef={photoInputRef}
                handleFilePick={handleFilePick}
                removeFile={removeFile}
              />
            )}

            {/* ── Shared: NID ── */}
            {current.key === 'nid' && (
              <StepFrame
                key="nid"
                icon={IdCard}
                titleBn="NID যাচাই" titleEn="NID verification"
                hintBn={
                  isLandlord
                    ? 'মালিকদের জন্য NID আবশ্যক। (+২৫ ট্রাস্ট)'
                    : 'এখন না দিলেও চলবে — পরে চাইব। (+৩০ ট্রাস্ট)'
                }
                hintEn={
                  isLandlord
                    ? 'NID is required for hosts. (+25 Trust)'
                    : "Skip for now if you'd prefer. We'll ask later. (+30 Trust)"
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

            {/* ── Shared: Review ── */}
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

                {isLandlord ? <HostReview data={data} isBn={isBn} /> : <TenantReview data={data} isBn={isBn} />}

                {/* Trust booster nudge — only for tenants missing NID */}
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

        {/* ─── Footer ─── */}
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
export default VerificationModal;
export { VerificationModal };
export const TenantVerificationModal = VerificationModal;