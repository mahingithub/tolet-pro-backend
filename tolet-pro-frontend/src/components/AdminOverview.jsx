import React, { useEffect, useMemo, useState } from 'react';
import {
  Users, Building, DollarSign, Activity, TrendingUp,
  ShieldAlert, CheckCircle2, ArrowUpRight, AlertCircle, Clock,
} from 'lucide-react';
import { getOverviewStats } from '../services/adminService';

// Formatter for big counts. We do NOT abbreviate small numbers — a
// "Total Users" of 8 should read "8", not "8.0K". Numbers ≥ 100k round to
// a single decimal "K"; ≥ 1M round to a single decimal "M".
const fmtCount = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 100_000)   return `${(v / 1_000).toFixed(0)}K`;
  if (v >= 10_000)    return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString('en-IN');
};

const AdminOverview = () => {
  const [stats, setStats]   = useState(null);
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      try {
        const data = await getOverviewStats();
        if (cancelled) return;
        setStats(data);
        setError('');
      } catch (err) {
        if (cancelled) return;
        setError(err?.message || 'Failed to load admin overview.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    hydrate();
    // Refresh every 60 s so the dashboard stays roughly fresh without
    // forcing the admin to reload the page.
    const interval = setInterval(hydrate, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Render-ready stat cards from the live backend response. Falls back
  // gracefully when the API hasn't responded yet (`—`).
  const statCards = useMemo(() => {
    const s = stats || {};
    const pendingMod = s.pendingModeration ?? 0;
    return [
      {
        id: 1,
        label: 'Total Users',
        value: stats ? fmtCount(s.totalUsers ?? 0) : '—',
        sub:   stats ? `${fmtCount(s.totalLandlords ?? 0)} landlords · ${fmtCount(s.totalTenants ?? 0)} tenants` : '',
        icon:  Users,
        color: 'text-blue-500',
        bg:    'bg-blue-50',
      },
      {
        id: 2,
        label: 'Active Properties',
        value: stats ? fmtCount(s.activeProperties ?? 0) : '—',
        sub:   stats ? `${fmtCount(s.totalProperties ?? 0)} total · ${fmtCount(s.rentedProperties ?? 0)} rented` : '',
        icon:  Building,
        color: 'text-indigo-500',
        bg:    'bg-indigo-50',
      },
      {
        id: 3,
        label: 'Monthly Revenue',
        value: stats ? (s.monthlyRevenueFormatted || '৳ 0') : '—',
        sub:   'Subscriptions + fees',
        icon:  DollarSign,
        color: 'text-emerald-500',
        bg:    'bg-emerald-50',
      },
      {
        id: 4,
        label: 'Pending Moderation',
        value: stats ? fmtCount(pendingMod) : '—',
        sub:   pendingMod > 0 ? 'Action needed' : 'All clear',
        icon:  ShieldAlert,
        color: 'text-[#ba0036]',
        bg:    'bg-[#ba0036]/10',
        urgent: pendingMod > 0,
      },
    ];
  }, [stats]);

  return (
    <div className="max-w-6xl mx-auto pt-4 pb-12 space-y-8">

      {/* ── হেডার ── */}
      <div>
        <h1 className="text-3xl font-black text-gray-900 tracking-tight">System Overview</h1>
        <p className="text-sm font-bold text-gray-500 mt-2">
          Welcome back, Admin. Here is what's happening across TO-LET PRO today.
        </p>
        {loading ? (
          <p className="text-xs font-bold text-gray-400 mt-2 flex items-center gap-1.5">
            <Clock size={11} /> Loading live stats…
          </p>
        ) : null}
        {error ? (
          <p className="text-xs font-bold text-red-600 mt-2 flex items-center gap-1.5" role="alert">
            <AlertCircle size={11} /> {error}
          </p>
        ) : null}
      </div>

      {/* ── ১. স্ট্যাটস গ্রিড (Top Row) ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((stat) => (
          <div key={stat.id} className="bg-white p-6 rounded-[2rem] shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_12px_30px_rgba(186,0,54,0.06)] transition-all duration-300 group">
            <div className="flex items-start justify-between mb-4">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${stat.bg}`}>
                <stat.icon size={22} className={stat.color} />
              </div>
              {stat.sub ? (
                <span className={`text-[10px] font-black px-2.5 py-1 rounded-lg uppercase tracking-widest ${stat.urgent ? 'bg-[#ba0036]/10 text-[#ba0036]' : 'bg-gray-50 text-gray-500'}`}>
                  {stat.sub}
                </span>
              ) : null}
            </div>
            <h3 className="text-3xl font-black text-gray-900 mb-1">{stat.value}</h3>
            <p className="text-sm font-bold text-gray-500">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* ── ২. বেন্টো গ্রিড লেআউট (Bottom Section) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Revenue & Growth Chart Placeholder (Spans 2 columns) */}
        <div className="lg:col-span-2 bg-white rounded-[2rem] p-8 shadow-[0_4px_20px_rgba(0,0,0,0.03)] flex flex-col">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-xl font-black text-gray-900">Revenue Growth</h3>
              <p className="text-xs font-bold text-gray-400 mt-1 uppercase tracking-widest">Premium Subscriptions & Fees</p>
            </div>
            <button className="flex items-center gap-2 text-[#ba0036] bg-[#ba0036]/5 hover:bg-[#ba0036]/10 px-4 py-2 rounded-xl text-xs font-black transition-all">
              Detailed Report <ArrowUpRight size={14} />
            </button>
          </div>

          {/* Revenue chart placeholder. Once the subscription pipeline
              lands, this becomes a real time-series chart driven by the
              monthlyRevenue values returned from the API. */}
          <div className="flex-1 w-full bg-[#eaeff5]/50 rounded-2xl flex items-end justify-center p-6 min-h-[250px]">
            <p className="text-sm font-bold text-gray-400 text-center max-w-xs">
              Revenue charting will activate once the subscription pipeline
              starts collecting payments. Live total currently shows in the
              "Monthly Revenue" card above.
            </p>
          </div>
        </div>

        {/* Action Center & Alerts (1 column) */}
        <div className="bg-[#ba0036] rounded-[2rem] p-8 shadow-[0_10px_30px_rgba(186,0,54,0.2)] text-white relative overflow-hidden flex flex-col">
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/20 blur-3xl rounded-full"></div>

          <h3 className="text-xl font-black mb-6 relative z-10 flex items-center gap-2">
            <Activity size={22} className="text-white/80" /> Action Center
          </h3>

          <div className="space-y-4 relative z-10 flex-1">
            <div className="bg-white/10 hover:bg-white/20 backdrop-blur-md p-4 rounded-2xl cursor-pointer transition-all border border-white/5">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                  <AlertCircle size={16} />
                </div>
                <h4 className="font-bold text-sm">
                  {stats ? `${fmtCount(stats.pendingKyc ?? 0)} pending tenant KYC` : 'Pending tenant KYC'}
                </h4>
              </div>
              <p className="text-xs text-white/70 font-bold">Identity submissions awaiting your approval.</p>
            </div>

            <div className="bg-white/10 hover:bg-white/20 backdrop-blur-md p-4 rounded-2xl cursor-pointer transition-all border border-white/5">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                  <ShieldAlert size={16} />
                </div>
                <h4 className="font-bold text-sm">
                  {stats ? `${fmtCount(stats.pendingLandlordKyc ?? 0)} pending landlord KYC` : 'Pending landlord KYC'}
                </h4>
              </div>
              <p className="text-xs text-white/70 font-bold">Address + utility bill submissions to review.</p>
            </div>

            <div className="bg-white/10 hover:bg-white/20 backdrop-blur-md p-4 rounded-2xl cursor-pointer transition-all border border-white/5">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                  <CheckCircle2 size={16} />
                </div>
                <h4 className="font-bold text-sm">
                  {stats ? `${fmtCount(stats.bannedUsers ?? 0)} banned accounts` : 'Banned accounts'}
                </h4>
              </div>
              <p className="text-xs text-white/70 font-bold">Refused all mutations until lifted.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminOverview;
