/**
 * VerifStep — one row in the verification block shared by:
 *   • TenantDashboard.jsx   (status + "submit" CTA for self)
 *   • HostDashboard.jsx     (status + "submit" CTA for self)
 *   • LandlordProfile.jsx   (read-only badge on the public card)
 *   • TenantProfile.jsx     (read-only badge on the public card)
 *
 * Roadmap-v2 §5 (Verification): each step maps to a field under
 * `user.verification` on the backend:
 *   • emailVerified         – auto via OTP/magic link
 *   • phoneVerified         – auto via SMS OTP
 *   • idVerified            – manual review (NID upload)
 *   • addressVerified       – manual review (utility bill upload)
 *   • employmentVerified    – tenant-only, optional, manual review
 *
 * Status values come straight from the DB:
 *   'unverified' | 'pending' | 'verified' | 'rejected'
 *
 * The component is intentionally dumb — never calls fetch itself. The parent
 * passes `onSubmit` which posts to /api/auth/me/verification/submit through
 * AuthContext.submitVerification().
 */

import React from 'react';
import { Check, Clock, X, Upload, Lock } from 'lucide-react';

const STATUS_STYLE = {
  verified:   { icon: Check,  chip: 'bg-emerald-50 text-emerald-600 border-emerald-100', label: 'Verified' },
  pending:    { icon: Clock,  chip: 'bg-amber-50   text-amber-700   border-amber-100',   label: 'Pending Review' },
  rejected:   { icon: X,      chip: 'bg-red-50     text-red-600     border-red-100',     label: 'Rejected — please re-submit' },
  unverified: { icon: Lock,   chip: 'bg-slate-50   text-slate-500   border-slate-200',   label: 'Not Verified' },
};

const VerifStep = ({
  title,
  description,
  status = 'unverified',
  readOnly = false,
  onSubmit,           // () => void — opens the upload modal / triggers OTP, etc.
  submitLabel = 'Submit',
}) => {
  const style = STATUS_STYLE[status] || STATUS_STYLE.unverified;
  const Icon  = style.icon;
  const canSubmit = !readOnly && (status === 'unverified' || status === 'rejected');

  return (
    <div className="flex items-center justify-between gap-4 py-3.5 px-4 border border-gray-100 rounded-2xl bg-white">
      <div className="flex-1 min-w-0">
        <p className="font-black text-sm text-slate-900 truncate">{title}</p>
        {description && (
          <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{description}</p>
        )}
      </div>

      <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border flex items-center gap-1 ${style.chip}`}>
        <Icon size={11} /> {style.label}
      </span>

      {canSubmit && onSubmit && (
        <button
          type="button"
          onClick={onSubmit}
          className="ml-2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900 text-white text-[11px] font-black uppercase tracking-widest hover:bg-slate-700 active:scale-95 transition-all"
        >
          <Upload size={11} /> {submitLabel}
        </button>
      )}
    </div>
  );
};

export default VerifStep;
