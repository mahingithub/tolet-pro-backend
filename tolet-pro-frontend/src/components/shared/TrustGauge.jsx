/**
 * TrustGauge — circular trust-score gauge shared by:
 *   • LandlordProfile.jsx (public landlord card)
 *   • TenantProfile.jsx   (public tenant card)
 *   • TenantDashboard.jsx (logged-in user viewing their own card)
 *   • HostDashboard.jsx   (host viewing their own card)
 *
 * Roadmap-v2 §6: trust score is a 0-100 integer computed server-side. This
 * component only knows how to render the number nicely — never to compute
 * it. The bucket → colour mapping mirrors the one in
 * backend/models/User.js (computeTenantTrust / computeLandlordTrust).
 */

import React from 'react';
import { ShieldCheck } from 'lucide-react';

const TIERS = [
  { min: 80, label: 'Trusted',  ring: 'stroke-emerald-500', text: 'text-emerald-600', chip: 'bg-emerald-50 text-emerald-600 border-emerald-100' },
  { min: 60, label: 'Verified', ring: 'stroke-blue-500',    text: 'text-blue-600',    chip: 'bg-blue-50 text-blue-600 border-blue-100' },
  { min: 40, label: 'Growing',  ring: 'stroke-amber-500',   text: 'text-amber-600',   chip: 'bg-amber-50 text-amber-700 border-amber-100' },
  { min: 0,  label: 'New',      ring: 'stroke-slate-400',   text: 'text-slate-500',   chip: 'bg-slate-50 text-slate-600 border-slate-100' },
];

const tierFor = (score) => TIERS.find(t => score >= t.min) || TIERS[TIERS.length - 1];

const TrustGauge = ({ score = 0, tier, size = 128, label = 'Trust Score' }) => {
  const safeScore = Math.max(0, Math.min(100, Math.round(score || 0)));
  const t = tierFor(safeScore);
  const r = (size / 2) - 8;
  const c = 2 * Math.PI * r;
  const offset = c - (safeScore / 100) * c;

  return (
    <div className="inline-flex flex-col items-center" style={{ width: size }}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            strokeWidth="8"
            className="stroke-slate-100 fill-none"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            strokeWidth="8"
            className={`${t.ring} fill-none transition-[stroke-dashoffset] duration-700`}
            strokeDasharray={c}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <ShieldCheck size={18} className={t.text} />
          <span className={`text-2xl font-black leading-none mt-1 ${t.text}`}>{safeScore}</span>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">/ 100</span>
        </div>
      </div>
      <span className="mt-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</span>
      <span className={`mt-1 text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border ${t.chip}`}>
        {tier || t.label}
      </span>
    </div>
  );
};

export default TrustGauge;
