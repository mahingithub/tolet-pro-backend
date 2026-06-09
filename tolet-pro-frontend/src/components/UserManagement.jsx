import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Users, Search, ShieldCheck, ShieldAlert, ShieldX, CheckCircle2,
  XCircle, AlertTriangle, Ban, RotateCcw, FileImage, Eye, Clock,
  Filter, RefreshCw, BadgeCheck, Loader2,
} from 'lucide-react';
import {
  listUsers,
  listPendingVerification,
  listPendingLandlordVerification,
  verifyUser,
  verifyLandlord,
  rejectUser,
  rejectLandlord,
  banUser,
  unbanUser,
} from '../services/adminService';

/**
 * UserManagement.jsx
 * ────────────────────────────────────────────────────────────────────
 * One screen, two tabs:
 *
 *   1. "Pending Verification" — the KYC queue. Cards show the user's
 *      NID front/back, profile photo, profession proof, plus profile
 *      basics so the admin can spot-check before approving.
 *
 *   2. "All Users" — searchable directory with ban / unban controls
 *      and per-user status chips.
 *
 * Approve flips status → 'verified' + auto-grants the landlord role,
 * so a tenant who passes KYC doesn't have to re-submit when they
 * decide to host. That's the "verify once, never again" loop the
 * product asked for.
 */

const TABS = [
  { id: 'pending',          label: 'Tenant Verification' },
  { id: 'pending-landlord', label: 'Landlord Verification' },
  { id: 'all',              label: 'All Users' },
];

// ─── Small UI atoms ─────────────────────────────────────────────────
const StatusChip = ({ status }) => {
  const map = {
    verified:   { bg: 'bg-blue-50',    text: 'text-blue-700',    icon: BadgeCheck,   label: 'Verified' },
    pending:    { bg: 'bg-amber-50',   text: 'text-amber-700',   icon: Clock,        label: 'Pending' },
    rejected:   { bg: 'bg-red-50',     text: 'text-[#ba0036]',   icon: ShieldX,      label: 'Rejected' },
    unverified: { bg: 'bg-gray-100',   text: 'text-gray-500',    icon: ShieldAlert,  label: 'Unverified' },
  };
  const s = map[status] || map.unverified;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${s.bg} ${s.text}`}>
      <Icon size={11} />{s.label}
    </span>
  );
};

const DocPreview = ({ url, label }) => {
  if (!url) {
    return (
      <div className="aspect-[4/3] rounded-xl bg-gray-50 border border-dashed border-gray-200 flex items-center justify-center text-gray-300">
        <FileImage size={28} />
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block group relative">
      <img
        src={url}
        alt={label}
        className="aspect-[4/3] w-full object-cover rounded-xl shadow-[0_4px_15px_rgba(0,0,0,0.04)] group-hover:shadow-[0_8px_25px_rgba(0,0,0,0.08)] transition-shadow"
        onError={(e) => { e.currentTarget.style.opacity = 0.3; }}
      />
      <span className="absolute inset-0 rounded-xl bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
        <span className="bg-white/95 text-gray-900 text-[10px] font-black px-2.5 py-1 rounded-lg flex items-center gap-1">
          <Eye size={11} /> Open
        </span>
      </span>
      <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mt-1.5">{label}</p>
    </a>
  );
};

// ─── Small info row used inside the pending review card ────────────
const InfoRow = ({ label, value, mono }) => (
  <div className="flex items-start gap-3 py-2 border-b border-gray-100 last:border-b-0">
    <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 min-w-[110px] pt-0.5">
      {label}
    </span>
    <span className={`flex-1 text-sm font-bold text-gray-800 break-words ${mono ? 'font-mono' : ''}`}>
      {value || <span className="text-gray-300">—</span>}
    </span>
  </div>
);

// Pretty-prints the profession enum the modal stores ('student' →
// 'Student', 'self-employed' → 'Self-employed'). Falls back to whatever
// the user typed if it's not in the enum (e.g. 'other' with free text).
const PROFESSION_LABELS = {
  student:        'Student',
  employed:       'Employed',
  'self-employed':'Self-employed',
  other:          'Other',
};

const FAMILY_SIZE_LABELS = {
  '1':  '1 person',
  '2':  '2 people',
  '3':  '3 people',
  '4':  '4 people',
  '5+': '5+ people',
};

// ─── Pending verification card ──────────────────────────────────────
const PendingCard = ({ user, busyId, onApprove, onReject }) => {
  const v  = user.tenantProfile?.verification || {};
  const tp = user.tenantProfile || {};
  const lp = user.landlordProfile || {};
  const ec = tp.emergencyContact || {};
  const busy = busyId === user.id;
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState('');

  // Compute completeness counters so the reviewer sees at a glance
  // whether the user submitted everything we asked for.
  const docCount = [v.photoUrl, v.nidFrontUrl, v.nidBackUrl, v.professionProofUrl].filter(Boolean).length;
  const memberSince = user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  }) : '—';

  // Landlord profile is only worth showing when at least one field is
  // populated — keeps the card from rendering a useless empty section
  // for tenants who never opened the host flow.
  const hasLandlordData = !!(lp.fullName || lp.city || lp.address || (lp.preferredTenants || []).length);

  return (
    <div className="bg-white rounded-[2rem] p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_12px_30px_rgba(186,0,54,0.06)] transition-all">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="w-14 h-14 rounded-2xl overflow-hidden bg-gray-100 flex items-center justify-center shrink-0">
          {user.avatar ? (
            <img src={user.avatar} alt={user.name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-xl font-black text-[#ba0036]">{(user.name || '?').charAt(0)}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-black text-gray-900 truncate">{user.name}</h3>
          <p className="text-xs font-bold text-gray-500">{user.phone} {user.email ? `• ${user.email}` : ''}</p>
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-0.5">
            Joined {memberSince} · {docCount}/4 docs
          </p>
        </div>
        <StatusChip status={v.status || 'pending'} />
      </div>

      {/* Two-column profile review block.
          Left: profile facts (what the user typed).
          Right: identity documents (what they uploaded).
          The reviewer eyeballs both sides in parallel. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* ── Profile facts ─────────────────────────────────────────── */}
        <div className="bg-gray-50/60 rounded-2xl p-5">
          <h4 className="text-[10px] font-black uppercase tracking-widest text-[#ba0036] mb-3">
            Personal Information
          </h4>
          <div className="space-y-0">
            <InfoRow label="Full Name"      value={user.name} />
            <InfoRow label="Phone"          value={user.phone} mono />
            <InfoRow label="Email"          value={user.email} />
            <InfoRow label="Date of Birth"  value={user.dateOfBirth ? new Date(user.dateOfBirth).toLocaleDateString('en-GB') : ''} />
            <InfoRow label="Roles"          value={(user.roles || [user.role]).join(' · ')} />
            <InfoRow label="Trust Score"    value={`${tp.trustScore ?? 0}/100 · ${tp.trustTier || 'bronze'}`} />
          </div>

          <h4 className="text-[10px] font-black uppercase tracking-widest text-[#ba0036] mt-5 mb-3">
            Profession & Household
          </h4>
          <div className="space-y-0">
            <InfoRow label="Profession"     value={PROFESSION_LABELS[tp.professionType] || tp.professionType} />
            <InfoRow label="Workplace"      value={tp.workPlace} />
            <InfoRow label="Family Size"    value={FAMILY_SIZE_LABELS[tp.familySize] || tp.familySize} />
          </div>

          <h4 className="text-[10px] font-black uppercase tracking-widest text-[#ba0036] mt-5 mb-3">
            Emergency Contact
          </h4>
          <div className="space-y-0">
            <InfoRow label="Name"       value={ec.name} />
            <InfoRow label="Phone"      value={ec.phone} mono />
            <InfoRow label="Relation"   value={ec.relation} />
          </div>

          {hasLandlordData && (
            <>
              <h4 className="text-[10px] font-black uppercase tracking-widest text-[#ba0036] mt-5 mb-3">
                Landlord Profile
              </h4>
              <div className="space-y-0">
                <InfoRow label="Display Name"      value={lp.fullName} />
                <InfoRow label="City"              value={lp.city} />
                <InfoRow label="Address"           value={lp.address} />
                <InfoRow label="Preferred Tenants" value={(lp.preferredTenants || []).join(', ')} />
                <InfoRow label="House Rules"       value={(lp.houseRules || []).join(', ')} />
                <InfoRow label="Service Charge"    value={lp.serviceCharge != null ? `৳ ${lp.serviceCharge}` : ''} />
              </div>
            </>
          )}
        </div>

        {/* ── Identity documents ────────────────────────────────────── */}
        <div className="bg-gray-50/60 rounded-2xl p-5">
          <h4 className="text-[10px] font-black uppercase tracking-widest text-[#ba0036] mb-4">
            Identity Documents
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <DocPreview url={v.photoUrl}           label="Profile Photo" />
            <DocPreview url={v.professionProofUrl} label="Profession Proof" />
            <DocPreview url={v.nidFrontUrl}        label="NID Front" />
            <DocPreview url={v.nidBackUrl}         label="NID Back" />
          </div>

          {/* Reviewer checklist — visual cue for what to verify against
              the docs above. Pure presentation; admins are expected to
              mentally tick these off before clicking Approve. */}
          <h4 className="text-[10px] font-black uppercase tracking-widest text-[#ba0036] mt-5 mb-3">
            Reviewer Checklist
          </h4>
          <ul className="space-y-2 text-[12px] font-bold text-gray-700">
            <li className="flex items-start gap-2"><span className="text-[#ba0036] mt-0.5">▸</span> Name on NID matches "{user.name}"</li>
            <li className="flex items-start gap-2"><span className="text-[#ba0036] mt-0.5">▸</span> NID images are sharp + readable</li>
            <li className="flex items-start gap-2"><span className="text-[#ba0036] mt-0.5">▸</span> Profile photo shows a real face, not a logo</li>
            <li className="flex items-start gap-2"><span className="text-[#ba0036] mt-0.5">▸</span> Profession proof looks legitimate</li>
            <li className="flex items-start gap-2"><span className="text-[#ba0036] mt-0.5">▸</span> Workplace + emergency contact look genuine</li>
          </ul>
        </div>
      </div>

      {/* Reject reason input */}
      {showReject && (
        <div className="mb-4">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this submission being rejected? The user will see this message."
            rows={2}
            className="w-full px-4 py-3 rounded-xl bg-gray-50 border border-gray-200 focus:border-[#ba0036] focus:bg-white outline-none text-sm font-bold text-gray-800 placeholder:text-gray-400 transition-all"
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3">
        {showReject ? (
          <>
            <button
              onClick={() => { setShowReject(false); setReason(''); }}
              disabled={busy}
              className="flex-1 px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-black text-sm transition-all disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => onReject(user.id, reason.trim())}
              disabled={busy || !reason.trim()}
              className="flex-1 px-6 py-3 bg-[#ba0036] hover:bg-[#90002a] text-white rounded-xl font-black text-sm shadow-[0_4px_15px_rgba(186,0,54,0.2)] disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />}
              Send Rejection
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setShowReject(true)}
              disabled={busy}
              className="flex-1 px-6 py-3 bg-white border border-gray-200 hover:border-[#ba0036] text-gray-700 hover:text-[#ba0036] rounded-xl font-black text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <XCircle size={16} /> Reject
            </button>
            <button
              onClick={() => onApprove(user.id)}
              disabled={busy}
              className="flex-1 px-6 py-3 bg-gradient-to-r from-[#ba0036] to-[#d11147] text-white rounded-xl font-black text-sm shadow-[0_8px_20px_rgba(186,0,54,0.25)] hover:shadow-[0_12px_30px_rgba(186,0,54,0.35)] disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              Approve & Verify
            </button>
          </>
        )}
      </div>
    </div>
  );
};

// ─── User directory row ─────────────────────────────────────────────
const UserRow = ({ user, busyId, onBan, onUnban }) => {
  const status = user.tenantProfile?.verification?.status || 'unverified';
  const busy   = busyId === user.id;

  return (
    <div className="bg-white rounded-2xl p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_25px_rgba(186,0,54,0.05)] transition-all flex items-center gap-4">
      <div className="w-12 h-12 rounded-xl overflow-hidden bg-gray-100 flex items-center justify-center shrink-0">
        {user.avatar ? (
          <img src={user.avatar} alt={user.name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-base font-black text-[#ba0036]">{(user.name || '?').charAt(0)}</span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-sm font-black text-gray-900 truncate">{user.name}</h3>
          {user.isBanned && (
            <span className="text-[9px] font-black uppercase tracking-widest text-[#ba0036] bg-red-50 px-2 py-0.5 rounded">
              Banned
            </span>
          )}
        </div>
        <p className="text-[11px] font-bold text-gray-500 truncate">
          {user.phone}{user.email ? ` • ${user.email}` : ''}
        </p>
      </div>

      <div className="hidden md:flex items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
          {(user.roles || [user.role]).join(' · ')}
        </span>
        <StatusChip status={status} />
      </div>

      <div className="shrink-0">
        {user.isBanned ? (
          <button
            onClick={() => onUnban(user.id)}
            disabled={busy}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-black text-xs transition-all disabled:opacity-50 flex items-center gap-1.5"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
            Unban
          </button>
        ) : (
          <button
            onClick={() => onBan(user.id)}
            disabled={busy || user.role === 'super_admin'}
            title={user.role === 'super_admin' ? "Super admins can't be banned" : ''}
            className="px-4 py-2 bg-white border border-gray-200 hover:border-[#ba0036] text-gray-600 hover:text-[#ba0036] rounded-lg font-black text-xs transition-all disabled:opacity-30 flex items-center gap-1.5"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
            Ban
          </button>
        )}
      </div>
    </div>
  );
};

// ─── Landlord pending card — focuses on address + utility bill,
//    plus a glance at the tenant-side identity (for cross-checking
//    when the user is going through Path B). ──────────────────────
const LandlordPendingCard = ({ user, busyId, onApprove, onReject }) => {
  const lv = user.landlordProfile?.verification || {};
  const tv = user.tenantProfile?.verification || {};
  const tp = user.tenantProfile  || {};
  const lp = user.landlordProfile || {};
  const ec = tp.emergencyContact  || {};
  const busy = busyId === user.id;
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState('');

  // Path tag — which flow this submission came through.
  const tenantAlreadyVerified = tv.status === 'verified';
  const pathTag = tenantAlreadyVerified ? 'A — Upgrading Tenant' : 'B — Fresh Landlord';

  const submittedAt = lv.submittedAt
    ? new Date(lv.submittedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
    : '—';

  return (
    <div className="bg-white rounded-[2rem] p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_12px_30px_rgba(186,0,54,0.06)] transition-all">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="w-14 h-14 rounded-2xl overflow-hidden bg-gray-100 flex items-center justify-center shrink-0">
          {user.avatar ? (
            <img src={user.avatar} alt={user.name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-xl font-black text-[#ba0036]">{(user.name || '?').charAt(0)}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-black text-gray-900 truncate">{user.name}</h3>
          <p className="text-xs font-bold text-gray-500">{user.phone} {user.email ? `• ${user.email}` : ''}</p>
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-0.5">
            Submitted {submittedAt} · Path {pathTag}
          </p>
        </div>
        <StatusChip status={lv.status || 'pending'} />
      </div>

      {/* Two-column review: property info + documents.
          The "tenant identity carry-over" panel only shows on Path A
          so the reviewer can confirm what's already approved. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

        {/* ── Property details ─────────────────────────────────────── */}
        <div className="bg-gray-50/60 rounded-2xl p-5">
          <h4 className="text-[10px] font-black uppercase tracking-widest text-[#ba0036] mb-3">
            Property Details
          </h4>
          <div className="space-y-0">
            <InfoRow label="Property Address" value={lv.propertyAddress} />
            <InfoRow label="Display Name"     value={lp.fullName} />
            <InfoRow label="City"             value={lp.city} />
          </div>

          {tenantAlreadyVerified && (
            <>
              <h4 className="text-[10px] font-black uppercase tracking-widest text-emerald-700 mt-5 mb-3">
                Tenant Identity (Already Approved)
              </h4>
              <div className="space-y-0">
                <InfoRow label="Full Name"     value={user.name} />
                <InfoRow label="Phone"         value={user.phone} mono />
                <InfoRow label="Profession"    value={PROFESSION_LABELS[tp.professionType] || tp.professionType} />
                <InfoRow label="Workplace"     value={tp.workPlace} />
                <InfoRow label="Family Size"   value={FAMILY_SIZE_LABELS[tp.familySize] || tp.familySize} />
                <InfoRow label="Emergency"     value={ec.name && ec.phone ? `${ec.name} · ${ec.phone}` : ''} />
              </div>
              <p className="mt-3 text-[11px] font-bold text-emerald-700/80 flex items-start gap-1.5">
                <CheckCircle2 size={12} className="shrink-0 mt-0.5" />
                NID + profile photo + profession proof were already approved as part of tenant verification.
              </p>
            </>
          )}
        </div>

        {/* ── Documents ────────────────────────────────────────────── */}
        <div className="bg-gray-50/60 rounded-2xl p-5">
          <h4 className="text-[10px] font-black uppercase tracking-widest text-[#ba0036] mb-4">
            Submitted Documents
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <DocPreview url={lv.utilityBillUrl}    label="Utility Bill" />
            {!tenantAlreadyVerified && (
              <>
                <DocPreview url={tv.photoUrl}           label="Profile Photo" />
                <DocPreview url={tv.nidFrontUrl}        label="NID Front" />
                <DocPreview url={tv.nidBackUrl}         label="NID Back" />
                <DocPreview url={tv.professionProofUrl} label="Profession Proof" />
              </>
            )}
          </div>

          <h4 className="text-[10px] font-black uppercase tracking-widest text-[#ba0036] mt-5 mb-3">
            Reviewer Checklist
          </h4>
          <ul className="space-y-2 text-[12px] font-bold text-gray-700">
            <li className="flex items-start gap-2"><span className="text-[#ba0036] mt-0.5">▸</span> Bill address matches the property address typed above</li>
            <li className="flex items-start gap-2"><span className="text-[#ba0036] mt-0.5">▸</span> Utility bill is recent + legible</li>
            <li className="flex items-start gap-2"><span className="text-[#ba0036] mt-0.5">▸</span> Bill account holder matches the user's NID name</li>
            {!tenantAlreadyVerified && (
              <li className="flex items-start gap-2"><span className="text-[#ba0036] mt-0.5">▸</span> All Path B identity documents look genuine</li>
            )}
          </ul>
        </div>
      </div>

      {/* Reject reason input */}
      {showReject && (
        <div className="mb-4">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this landlord submission being rejected? The user will see this message."
            rows={2}
            className="w-full px-4 py-3 rounded-xl bg-gray-50 border border-gray-200 focus:border-[#ba0036] focus:bg-white outline-none text-sm font-bold text-gray-800 placeholder:text-gray-400 transition-all"
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3">
        {showReject ? (
          <>
            <button
              onClick={() => { setShowReject(false); setReason(''); }}
              disabled={busy}
              className="flex-1 px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-black text-sm transition-all disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => onReject(user.id, reason.trim())}
              disabled={busy || !reason.trim()}
              className="flex-1 px-6 py-3 bg-[#ba0036] hover:bg-[#90002a] text-white rounded-xl font-black text-sm shadow-[0_4px_15px_rgba(186,0,54,0.2)] disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />}
              Send Rejection
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setShowReject(true)}
              disabled={busy}
              className="flex-1 px-6 py-3 bg-white border border-gray-200 hover:border-[#ba0036] text-gray-700 hover:text-[#ba0036] rounded-xl font-black text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <XCircle size={16} /> Reject
            </button>
            <button
              onClick={() => onApprove(user.id)}
              disabled={busy}
              className="flex-1 px-6 py-3 bg-gradient-to-r from-[#ba0036] to-[#d11147] text-white rounded-xl font-black text-sm shadow-[0_8px_20px_rgba(186,0,54,0.25)] hover:shadow-[0_12px_30px_rgba(186,0,54,0.35)] disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              Approve as Landlord
            </button>
          </>
        )}
      </div>
    </div>
  );
};

// ─── Page ───────────────────────────────────────────────────────────
const UserManagement = () => {
  const [activeTab, setActiveTab] = useState('pending');
  const [pending,        setPending]        = useState([]);
  const [pendingLandlord, setPendingLandlord] = useState([]);
  const [allUsers,       setAllUsers]       = useState([]);
  const [loading,        setLoading]        = useState(false);
  const [busyId,         setBusyId]         = useState(null);
  const [error,          setError]          = useState('');
  const [search,         setSearch]         = useState('');
  const [roleFilter,     setRoleFilter]     = useState('');
  const [toast,          setToast]          = useState(null);

  const showToast = useCallback((message, kind = 'success') => {
    setToast({ message, kind });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (activeTab === 'pending') {
        const list = await listPendingVerification();
        setPending(list);
      } else if (activeTab === 'pending-landlord') {
        const list = await listPendingLandlordVerification();
        setPendingLandlord(list);
      } else {
        const data = await listUsers({ role: roleFilter, search });
        setAllUsers(data.users || []);
      }
    } catch (err) {
      setError(err?.message || 'Failed to load. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [activeTab, roleFilter, search]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleApprove = async (id) => {
    setBusyId(id);
    try {
      await verifyUser(id);
      setPending((prev) => prev.filter((u) => u.id !== id));
      showToast('User verified. Landlord role unlocked.');
    } catch (err) {
      showToast(err?.message || 'Approval failed.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (id, reason) => {
    setBusyId(id);
    try {
      await rejectUser(id, reason);
      setPending((prev) => prev.filter((u) => u.id !== id));
      showToast('Submission rejected. User has been notified.');
    } catch (err) {
      showToast(err?.message || 'Rejection failed.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  // ── Landlord-side handlers ───────────────────────────────────────
  const handleApproveLandlord = async (id) => {
    setBusyId(id);
    try {
      await verifyLandlord(id);
      setPendingLandlord((prev) => prev.filter((u) => u.id !== id));
      showToast('Landlord verified. Landlord role unlocked.');
    } catch (err) {
      showToast(err?.message || 'Approval failed.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleRejectLandlord = async (id, reason) => {
    setBusyId(id);
    try {
      await rejectLandlord(id, reason);
      setPendingLandlord((prev) => prev.filter((u) => u.id !== id));
      showToast('Landlord submission rejected. User has been notified.');
    } catch (err) {
      showToast(err?.message || 'Rejection failed.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleBan = async (id) => {
    setBusyId(id);
    try {
      const updated = await banUser(id, 'Banned by admin.');
      setAllUsers((prev) => prev.map((u) => (u.id === id ? updated : u)));
      showToast('User banned.');
    } catch (err) {
      showToast(err?.message || 'Ban failed.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleUnban = async (id) => {
    setBusyId(id);
    try {
      const updated = await unbanUser(id);
      setAllUsers((prev) => prev.map((u) => (u.id === id ? updated : u)));
      showToast('User restored.');
    } catch (err) {
      showToast(err?.message || 'Unban failed.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const pendingCount         = pending.length;
  const pendingLandlordCount = pendingLandlord.length;

  return (
    <div className="max-w-6xl mx-auto pt-4 pb-12 space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">User Management</h1>
          <p className="text-sm font-bold text-gray-500 mt-2">
            Approve verifications, manage roles, and moderate accounts.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 bg-white rounded-xl text-xs font-black text-gray-700 shadow-[0_4px_15px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_25px_rgba(186,0,54,0.08)] hover:text-[#ba0036] transition-all disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-white rounded-2xl p-1.5 shadow-[0_4px_20px_rgba(0,0,0,0.03)] w-fit">
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          let badge = null;
          if (tab.id === 'pending'          && pendingCount         > 0) badge = pendingCount;
          if (tab.id === 'pending-landlord' && pendingLandlordCount > 0) badge = pendingLandlordCount;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${
                active
                  ? 'bg-[#ba0036] text-white shadow-[0_4px_15px_rgba(186,0,54,0.25)]'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              {tab.label}
              {badge !== null && (
                <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-black ${
                  active ? 'bg-white text-[#ba0036]' : 'bg-[#ba0036]/10 text-[#ba0036]'
                }`}>
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Filters — only on All Users tab */}
      {activeTab === 'all' && (
        <div className="bg-white rounded-2xl p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)] flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, phone, or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-11 pr-4 py-3 bg-gray-50 rounded-xl outline-none text-sm font-bold text-gray-800 placeholder:text-gray-400 focus:bg-white focus:shadow-[0_4px_15px_rgba(186,0,54,0.05)] transition-all"
            />
          </div>
          <div className="flex gap-2">
            {['', 'tenant', 'landlord', 'super_admin'].map((r) => (
              <button
                key={r || 'all'}
                onClick={() => setRoleFilter(r)}
                className={`px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                  roleFilter === r
                    ? 'bg-[#ba0036] text-white shadow-[0_4px_15px_rgba(186,0,54,0.2)]'
                    : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                }`}
              >
                {r || 'All'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border border-red-100 text-[#ba0036] rounded-2xl p-4 text-sm font-bold flex items-center gap-2">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={28} className="text-[#ba0036] animate-spin" />
        </div>
      ) : activeTab === 'pending' ? (
        pending.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No pending tenant submissions"
            subtitle="When users submit identity documents, they'll appear here for review."
          />
        ) : (
          <div className="space-y-6">
            {pending.map((u) => (
              <PendingCard
                key={u.id}
                user={u}
                busyId={busyId}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            ))}
          </div>
        )
      ) : activeTab === 'pending-landlord' ? (
        pendingLandlord.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No pending landlord submissions"
            subtitle="Verified tenants who want to list properties — plus fresh landlord signups — appear here once they submit."
          />
        ) : (
          <div className="space-y-6">
            {pendingLandlord.map((u) => (
              <LandlordPendingCard
                key={u.id}
                user={u}
                busyId={busyId}
                onApprove={handleApproveLandlord}
                onReject={handleRejectLandlord}
              />
            ))}
          </div>
        )
      ) : (
        allUsers.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No users match"
            subtitle="Try a different search or clear the role filter."
          />
        ) : (
          <div className="space-y-3">
            {allUsers.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                busyId={busyId}
                onBan={handleBan}
                onUnban={handleUnban}
              />
            ))}
          </div>
        )
      )}

      {/* Toast — always-on-top with strong colour so admins don't miss
          confirmations after destructive actions (reject / ban). */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-5 py-4 rounded-2xl shadow-[0_20px_50px_-10px_rgba(0,0,0,0.3)] flex items-center gap-3 text-sm font-black min-w-[280px] animate-in fade-in slide-in-from-bottom-4 ${
          toast.kind === 'error'
            ? 'bg-[#ba0036] text-white'
            : 'bg-gradient-to-r from-emerald-500 to-green-600 text-white'
        }`}>
          {toast.kind === 'error'
            ? <AlertTriangle size={20} className="shrink-0" />
            : <CheckCircle2 size={20} className="shrink-0" />}
          <span className="flex-1">{toast.message}</span>
        </div>
      )}
    </div>
  );
};

const EmptyState = ({ icon: Icon, title, subtitle }) => (
  <div className="bg-white rounded-[2rem] p-12 text-center shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
    <div className="w-20 h-20 bg-[#ba0036]/5 text-[#ba0036] rounded-full flex items-center justify-center mx-auto mb-4">
      <Icon size={32} />
    </div>
    <h3 className="text-xl font-black text-gray-900">{title}</h3>
    <p className="text-gray-500 font-bold mt-2">{subtitle}</p>
  </div>
);

export default UserManagement;