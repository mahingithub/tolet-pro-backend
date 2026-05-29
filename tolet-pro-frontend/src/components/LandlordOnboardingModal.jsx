/**
 * LandlordOnboardingModal.jsx
 * ─────────────────────────────────────────────────────────────────────────
 * The "Become a Landlord" wizard. Reads the current user's tenant
 * verification status from AuthContext and renders one of two flows:
 *
 *   Path A — Upgrading Tenant (tenantProfile.verification.status === 'verified')
 *     Short form: just propertyAddress + utilityBill.
 *     Header says "You're already verified — we just need a few more
 *     details to set up your listings."
 *
 *   Path B — Fresh Landlord
 *     Full form: nidFront + nidBack + photo + professionProof +
 *     propertyAddress + utilityBill.
 *
 * Design follows the "Digital Curator" system used everywhere else
 * (TenantDashboard, AdminLayout): no hard 1px borders, tonal background
 * shifts + soft shadows, red accents (#ba0036) for action affordances.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Upload, CheckCircle2, AlertCircle, ShieldCheck, ImagePlus,
  FileText, Home, Loader2, MapPin, BadgeCheck, Trash2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { submitLandlordVerification } from '../services/landlordVerificationService.js';

// ─── File slot config — drives both UI rendering AND validation ──────
const PATH_A_SLOTS = [
  { key: 'utilityBill', labelBn: 'বিদ্যুৎ বিল', labelEn: 'Electricity bill',
    hintBn: 'প্রপার্টির ঠিকানা মিলিয়ে দেখানোর জন্য।',
    hintEn: 'Used to confirm the address you entered above.' },
];

const PATH_B_SLOTS = [
  { key: 'photo',           labelBn: 'প্রোফাইল ছবি',  labelEn: 'Profile photo',
    hintBn: 'সরাসরি মুখের পরিষ্কার ছবি।', hintEn: 'A clear photo of your face.' },
  { key: 'nidFront',        labelBn: 'NID — সামনের দিক', labelEn: 'NID — front',
    hintBn: 'জাতীয় পরিচয়পত্রের সামনের দিক।', hintEn: 'The front of your National ID.' },
  { key: 'nidBack',         labelBn: 'NID — পেছনের দিক', labelEn: 'NID — back',
    hintBn: 'জাতীয় পরিচয়পত্রের পেছনের দিক।', hintEn: 'The back of your National ID.' },
  { key: 'professionProof', labelBn: 'পেশার প্রমাণ',   labelEn: 'Profession proof',
    hintBn: 'অফার লেটার / স্টুডেন্ট আইডি / ব্যবসার ডকুমেন্ট।',
    hintEn: 'Offer letter, student ID, or business document.' },
  { key: 'utilityBill',     labelBn: 'বিদ্যুৎ বিল',    labelEn: 'Electricity bill',
    hintBn: 'প্রপার্টির ঠিকানা মিলিয়ে দেখানোর জন্য।',
    hintEn: 'Used to confirm the address you entered above.' },
];

// ─── File picker tile ────────────────────────────────────────────────
// No 1px borders — sits inside a tonal-shift card. Selected state uses
// a soft green wash + checkmark badge. Replace/remove controls float
// at the bottom so the preview image stays clean.
const FileTile = ({ slot, value, onPick, onRemove, isBn }) => {
  const inputRef = useRef(null);
  const handle   = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    onPick(slot.key, f);
  };

  return (
    <div className={`rounded-2xl p-4 transition-all ${
      value
        ? 'bg-emerald-50/60 shadow-[0_4px_15px_rgba(16,185,129,0.08)]'
        : 'bg-gray-50/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_2px_8px_rgba(0,0,0,0.02)] hover:bg-gray-100/80'
    }`}>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handle}
      />

      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-black text-gray-900 leading-tight">
            {isBn ? slot.labelBn : slot.labelEn}
          </h4>
          <p className="text-[11px] font-bold text-gray-500 mt-0.5 leading-snug">
            {isBn ? slot.hintBn : slot.hintEn}
          </p>
        </div>
        {value && (
          <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500 text-white text-[9px] font-black uppercase tracking-widest">
            <CheckCircle2 size={10} /> {isBn ? 'নেওয়া হয়েছে' : 'Added'}
          </span>
        )}
      </div>

      {value ? (
        <div className="space-y-2">
          <div className="aspect-[4/3] rounded-xl overflow-hidden bg-white shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
            <img
              src={URL.createObjectURL(value)}
              alt={slot.labelEn}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex-1 px-3 py-2 rounded-xl bg-white text-gray-700 hover:text-[#ba0036] text-[11px] font-black flex items-center justify-center gap-1.5 shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_15px_rgba(186,0,54,0.08)] transition-all"
            >
              <ImagePlus size={12} /> {isBn ? 'বদলান' : 'Replace'}
            </button>
            <button
              type="button"
              onClick={() => onRemove(slot.key)}
              className="px-3 py-2 rounded-xl bg-white text-gray-400 hover:text-[#ba0036] text-[11px] font-black shadow-[0_2px_8px_rgba(0,0,0,0.03)] transition-all"
              aria-label="Remove"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full aspect-[4/3] rounded-xl bg-white hover:bg-rose-50/40 flex flex-col items-center justify-center gap-2 text-gray-400 hover:text-[#ba0036] shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_20px_rgba(186,0,54,0.08)] transition-all"
        >
          <Upload size={20} />
          <span className="text-[11px] font-black uppercase tracking-widest">
            {isBn ? 'আপলোড করুন' : 'Upload'}
          </span>
          <span className="text-[10px] font-bold text-gray-300">JPG · PNG · WEBP</span>
        </button>
      )}
    </div>
  );
};

const LandlordOnboardingModal = ({ open, onClose, onSuccess, language = 'বাংলা' }) => {
  const isBn = language === 'বাংলা';
  const { user, refresh } = useAuth();

  // Decide path. Backend will re-verify (server stays the source of
  // truth), but we render the UI off the locally-cached status so the
  // form layout doesn't flash from "full form" to "short form".
  const isAlreadyTenantVerified = user?.tenantProfile?.verification?.status === 'verified';
  const path = isAlreadyTenantVerified ? 'A' : 'B';
  const slots = path === 'A' ? PATH_A_SLOTS : PATH_B_SLOTS;

  const [address, setAddress] = useState('');
  const [files, setFiles] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Reset when re-opened so a previous attempt's state doesn't bleed in.
  useEffect(() => {
    if (open) {
      setAddress(user?.landlordProfile?.verification?.propertyAddress || '');
      setFiles({});
      setError('');
      setProgress(0);
      setSuccess(false);
    }
  }, [open, user?.landlordProfile?.verification?.propertyAddress]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const pickFile   = (key, file) => setFiles((prev) => ({ ...prev, [key]: file }));
  const removeFile = (key)       => setFiles((prev) => { const n = { ...prev }; delete n[key]; return n; });

  const filledCount = slots.filter((s) => !!files[s.key]).length;
  const totalCount  = slots.length;
  const ready       = !!address.trim() && filledCount === totalCount;

  const handleSubmit = async () => {
    if (!ready || submitting) return;
    setError('');
    setSubmitting(true);
    setProgress(0);
    try {
      await submitLandlordVerification(
        { propertyAddress: address, ...files },
        { onProgress: setProgress },
      );
      setSuccess(true);
      // Refresh AuthContext so the dashboards immediately pick up the
      // new pending status.
      await refresh?.();
      // Auto-close after a beat so the user sees the success state.
      setTimeout(() => {
        onSuccess?.();
        onClose?.();
      }, 1400);
    } catch (err) {
      const msg = err?.missing?.length
        ? (isBn
            ? `কিছু ডকুমেন্ট মিসিং: ${err.missing.join(', ')}`
            : `Missing documents: ${err.missing.join(', ')}`)
        : (err?.message || (isBn ? 'সাবমিট ব্যর্থ — আবার চেষ্টা করুন।' : 'Submit failed — please retry.'));
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose?.(); }}
      className="fixed inset-0 z-[200] flex items-end md:items-center justify-center bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full md:max-w-2xl bg-white md:rounded-[2rem] rounded-t-[2rem] shadow-[0_30px_80px_rgba(0,0,0,0.25)] overflow-hidden flex flex-col max-h-[92vh]">

        {/* ── Header — soft gradient, no 1px lines ──────────────────── */}
        <div className="relative px-6 md:px-8 pt-7 pb-5 bg-gradient-to-br from-white via-rose-50/40 to-rose-50/20">
          <button
            onClick={onClose}
            disabled={submitting}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/80 hover:bg-white text-gray-400 hover:text-gray-700 flex items-center justify-center shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_15px_rgba(0,0,0,0.08)] transition-all disabled:opacity-50"
            aria-label="Close"
          >
            <X size={16} />
          </button>

          <div className="flex items-start gap-4">
            <div className="shrink-0 w-12 h-12 rounded-2xl bg-gradient-to-br from-[#ba0036] to-[#d11147] text-white flex items-center justify-center shadow-[0_8px_20px_rgba(186,0,54,0.25)]">
              <Home size={20} strokeWidth={2.4} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#ba0036] mb-1">
                {isBn ? 'বাড়িওয়ালা হোন' : 'Become a Landlord'}
              </p>
              <h2 className="text-xl md:text-2xl font-black text-gray-900 tracking-tight leading-tight">
                {path === 'A'
                  ? (isBn ? 'প্রপার্টির তথ্য দিন' : 'Tell us about the property')
                  : (isBn ? 'পরিচয় ও সম্পত্তি যাচাই' : 'Verify identity & property')}
              </h2>
              <p className="text-[12px] md:text-sm font-bold text-gray-500 mt-1 leading-snug">
                {path === 'A'
                  ? (isBn
                      ? 'আপনি ইতিমধ্যেই পরিচয় যাচাই সম্পন্ন করেছেন। এখন শুধু প্রপার্টির ঠিকানা ও বিদ্যুৎ বিল লাগবে।'
                      : 'Your identity is already verified — we just need the property address and a utility bill.')
                  : (isBn
                      ? 'বাড়ি ভাড়া দিতে চাইলে নিচের সব ডকুমেন্ট দরকার। অ্যাডমিন রিভিউ করে অনুমোদন দেবেন।'
                      : 'Listing a property requires every document below. An admin will review your submission.')}
              </p>
            </div>
          </div>

          {path === 'A' && (
            <div className="mt-5 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-black uppercase tracking-widest">
              <BadgeCheck size={12} /> {isBn ? 'ভাড়াটিয়া হিসেবে ভেরিফাইড' : 'Verified as tenant'}
            </div>
          )}
        </div>

        {/* ── Body — scrollable ─────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 md:px-8 py-5 bg-gradient-to-b from-white to-gray-50/50">

          {/* Success state takes over the whole body when active. */}
          {success ? (
            <div className="py-12 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center mx-auto mb-4 shadow-[0_4px_20px_rgba(16,185,129,0.2)]">
                <CheckCircle2 size={32} />
              </div>
              <h3 className="text-xl font-black text-gray-900">
                {isBn ? 'সাবমিশন গৃহীত!' : 'Submission received!'}
              </h3>
              <p className="text-sm font-bold text-gray-500 mt-2 max-w-sm mx-auto leading-snug">
                {isBn
                  ? '২৪-৪৮ ঘণ্টার মধ্যে অ্যাডমিন আপনার ডকুমেন্ট পরীক্ষা করবেন। অনুমোদনের পর আপনি বাড়িওয়ালা হিসেবে লিস্টিং করতে পারবেন।'
                  : "An admin will review your documents within 24-48 hours. You'll be able to list properties once approved."}
              </p>
            </div>
          ) : (
            <>
              {/* Step 1 — Address */}
              <section className="mb-6">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-[#ba0036] mb-2 flex items-center gap-1.5">
                  <MapPin size={11} /> {isBn ? 'প্রপার্টির ঠিকানা' : 'Property Address'}
                </h3>
                <div className="rounded-2xl bg-gray-50/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_2px_8px_rgba(0,0,0,0.02)] p-4">
                  <textarea
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder={isBn
                      ? 'যেমন: বাড়ি #১২, রোড #৭, ধানমন্ডি, ঢাকা'
                      : 'e.g. House #12, Road #7, Dhanmondi, Dhaka'}
                    rows={2}
                    className="w-full bg-transparent outline-none text-sm font-bold text-gray-800 placeholder:text-gray-400 resize-none"
                  />
                </div>
                <p className="text-[11px] font-bold text-gray-400 mt-1.5">
                  {isBn
                    ? 'বিদ্যুৎ বিলে যে ঠিকানা আছে সেটাই লিখুন।'
                    : 'Match the address shown on the utility bill.'}
                </p>
              </section>

              {/* Step 2 — File slots */}
              <section className="mb-2">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-[#ba0036] mb-3 flex items-center gap-1.5">
                  <FileText size={11} /> {isBn ? 'প্রয়োজনীয় ডকুমেন্ট' : 'Required Documents'}
                  <span className="ml-auto text-gray-400 tabular-nums">
                    {filledCount}/{totalCount}
                  </span>
                </h3>
                <div className={`grid gap-3 ${path === 'A' ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'}`}>
                  {slots.map((slot) => (
                    <FileTile
                      key={slot.key}
                      slot={slot}
                      value={files[slot.key]}
                      onPick={pickFile}
                      onRemove={removeFile}
                      isBn={isBn}
                    />
                  ))}
                </div>
              </section>

              {error && (
                <div className="mt-4 px-4 py-3 rounded-2xl bg-red-50 text-[#ba0036] flex items-start gap-2 text-sm font-bold shadow-[0_2px_10px_rgba(186,0,54,0.05)]">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Footer — sticky action bar ────────────────────────────── */}
        {!success && (
          <div className="px-6 md:px-8 py-4 bg-white shadow-[0_-8px_25px_rgba(0,0,0,0.03)]">
            {submitting && progress > 0 && (
              <div className="mb-3">
                <div className="h-1 w-full bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#ba0036] to-[#d11147] transition-all duration-200"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest text-right mt-1.5 tabular-nums">
                  {progress}% {isBn ? 'আপলোড হচ্ছে' : 'uploading'}
                </p>
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={onClose}
                disabled={submitting}
                className="sm:w-32 px-5 py-3.5 rounded-2xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-black text-sm transition-all disabled:opacity-50"
              >
                {isBn ? 'বাতিল' : 'Cancel'}
              </button>
              <button
                onClick={handleSubmit}
                disabled={!ready || submitting}
                className="flex-1 px-5 py-3.5 rounded-2xl bg-gradient-to-r from-[#ba0036] to-[#d11147] text-white font-black text-sm shadow-[0_8px_20px_rgba(186,0,54,0.25)] hover:shadow-[0_12px_30px_rgba(186,0,54,0.35)] hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-[0_8px_20px_rgba(186,0,54,0.25)] disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    {isBn ? 'সাবমিট হচ্ছে...' : 'Submitting...'}
                  </>
                ) : (
                  <>
                    <ShieldCheck size={16} />
                    {isBn ? 'রিভিউয়ের জন্য সাবমিট করুন' : 'Submit for Review'}
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LandlordOnboardingModal;