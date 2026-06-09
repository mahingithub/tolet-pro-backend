import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Zap, TrendingUp, TrendingDown, BarChart2,
  MapPin, Home, DollarSign, Target, RefreshCw, Star,
  CheckCircle2, AlertCircle, ArrowUpRight, ArrowDownRight,
  Building, Users, Calendar, Activity, Eye, Lightbulb,
  ChevronRight, ShieldCheck, Clock
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

// ─── Data ─────────────────────────────────────────────────────────────────────
const marketOpportunities = [
  {
    id: 1, priority: 'high',
    area: 'Gulshan 2',
    property: 'Elegant 3BHK with Skyline View',
    currentRent: '85,000',
    marketAvg: '1,30,000',
    suggestedRent: '91,800',
    increasePercent: 8,
    confidence: 75,
    reasoning: 'Market average for comparable 3BHK units in Gulshan 2 is ৳1,30,000/mo. Your unit is priced below segment, offering headroom to raise rent by 8% at next renewal without risking occupancy.',
    impact: '+৳6,800/mo',
    tag: 'underpriced',
  },
  {
    id: 2, priority: 'high',
    area: 'Banani',
    property: 'Modern Duplex with Garden',
    currentRent: '1,20,000',
    marketAvg: '1,35,000',
    suggestedRent: '1,27,200',
    increasePercent: 6,
    confidence: 82,
    reasoning: 'Banani duplexes with garden access command a premium. Comparable units are listing at ৳1,35,000. A modest 6% increase at renewal would align you with market while retaining your current tenant.',
    impact: '+৳7,200/mo',
    tag: 'underpriced',
  },
  {
    id: 3, priority: 'medium',
    area: 'Baridhara',
    property: 'Executive Suite with Pool',
    currentRent: '4,00,000',
    marketAvg: '3,80,000',
    suggestedRent: '4,00,000',
    increasePercent: 0,
    confidence: 90,
    reasoning: 'Your executive suite is already priced slightly above the Baridhara market average, reflecting the pool amenity premium. Hold pricing to maintain competitive attractiveness and reduce vacancy risk.',
    impact: 'Maintain',
    tag: 'optimized',
  },
  {
    id: 4, priority: 'medium',
    area: 'Mirpur 10',
    property: 'Charming 2BHK Flat',
    currentRent: '35,000',
    marketAvg: '30,000',
    suggestedRent: '35,000',
    increasePercent: 0,
    confidence: 88,
    reasoning: 'Mirpur 10 demand has softened slightly due to new supply. Your current rate is already above average. Consider holding or offering a short-term incentive to attract quality tenants faster.',
    impact: 'Hold / Incentivize',
    tag: 'overpriced',
  },
];

const demandSignals = [
  { area: 'Gulshan 2', demand: 94, trend: 'up', icon: TrendingUp, color: 'text-green-400', bg: 'rgba(34,197,94,0.12)', label: 'Very High' },
  { area: 'Banani', demand: 87, trend: 'up', icon: TrendingUp, color: 'text-green-400', bg: 'rgba(34,197,94,0.10)', label: 'High' },
  { area: 'Dhanmondi', demand: 72, trend: 'stable', icon: Activity, color: 'text-blue-400', bg: 'rgba(59,130,246,0.10)', label: 'Moderate' },
  { area: 'Uttara', demand: 65, trend: 'up', icon: TrendingUp, color: 'text-blue-400', bg: 'rgba(59,130,246,0.08)', label: 'Moderate' },
  { area: 'Mirpur 10', demand: 48, trend: 'down', icon: TrendingDown, color: 'text-amber-400', bg: 'rgba(251,191,36,0.10)', label: 'Softening' },
  { area: 'Motijheel', demand: 40, trend: 'down', icon: TrendingDown, color: 'text-red-400', bg: 'rgba(239,68,68,0.08)', label: 'Low' },
];

const performanceMetrics = [
  { label: 'Avg. Occupancy Rate', value: '87%', sub: 'Across active listings', trend: '+3% vs last month', up: true },
  { label: 'Response Rate', value: '98%', sub: 'Inquiry responses', trend: 'Top 5% of hosts', up: true },
  { label: 'Avg. Days to Let', value: '11 days', sub: 'From listing to signed', trend: '-2 days vs avg', up: true },
  { label: 'Revenue This Month', value: '৳4,85,000', sub: 'Collected across 5 active', trend: '+৳35,000 vs Apr', up: true },
];

const quickWins = [
  { id: 1, icon: Target, title: 'Increase Gulshan 2 rent at next renewal', detail: '8% increase = +৳81,600/year', urgency: 'At renewal · May 2027', color: 'text-indigo-400', bg: 'rgba(99,102,241,0.15)' },
  { id: 2, icon: Lightbulb, title: 'Add professional photos to 3 listings', detail: 'Listings with pro photos let 40% faster', urgency: 'Action now · Low effort', color: 'text-yellow-300', bg: 'rgba(253,224,71,0.12)' },
  { id: 3, icon: Users, title: 'Enable instant inquiry auto-reply', detail: 'Reduces response lag, boosts ranking', urgency: '5-min setup', color: 'text-emerald-400', bg: 'rgba(52,211,153,0.12)' },
  { id: 4, icon: ShieldCheck, title: 'Verify 2 pending tenant documents', detail: 'Reduces legal risk on lease renewals', urgency: 'Recommended · Low effort', color: 'text-sky-400', bg: 'rgba(56,189,248,0.12)' },
];

const tagConfig = {
  underpriced: { label: 'Underpriced', color: 'text-green-400', bg: 'rgba(34,197,94,0.15)', border: 'rgba(34,197,94,0.25)' },
  overpriced:  { label: 'Above Market', color: 'text-amber-400', bg: 'rgba(251,191,36,0.15)', border: 'rgba(251,191,36,0.25)' },
  optimized:   { label: 'Optimized', color: '#a5b4fc', bg: 'rgba(99,102,241,0.15)', border: 'rgba(99,102,241,0.25)' },
};

export default function AIInsightsPage() {
  const navigate = useNavigate();
  const { language = 'English' } = useLanguage() || {};
  const bn = language === 'বাংলা';

  const [expandedId, setExpandedId] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);
  const [activeSection, setActiveSection] = useState('opportunities');

  const showToast = (msg) => { setToastMsg(msg); setTimeout(() => setToastMsg(null), 3000); };

  const SECTIONS = [
    { id: 'opportunities', label: bn ? 'সুযোগ' : 'Opportunities' },
    { id: 'demand', label: bn ? 'চাহিদা' : 'Demand' },
    { id: 'performance', label: bn ? 'পারফরম্যান্স' : 'Performance' },
    { id: 'wins', label: bn ? 'কুইক উইন' : 'Quick Wins' },
  ];

  const cardBase = {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
  };

  return (
    <div
      className="min-h-screen font-sans text-white selection:bg-indigo-500 selection:text-white relative overflow-x-hidden"
      style={{ background: 'linear-gradient(160deg, #080818 0%, #0b1130 45%, #0e0820 100%)' }}
    >
      {/* Ambient Orbs */}
      <div className="fixed top-[-10%] right-[-10%] w-[50vw] h-[50vw] rounded-full blur-[130px] pointer-events-none z-0" style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.2) 0%, transparent 70%)' }} />
      <div className="fixed bottom-[-10%] left-[-10%] w-[45vw] h-[45vw] rounded-full blur-[120px] pointer-events-none z-0" style={{ background: 'radial-gradient(circle, rgba(236,72,153,0.14) 0%, transparent 70%)' }} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60vw] h-[60vw] rounded-full blur-[200px] pointer-events-none z-0" style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.06) 0%, transparent 60%)' }} />

      {/* Grid overlay */}
      <div className="fixed inset-0 opacity-[0.025] pointer-events-none z-0" style={{ backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 40px, rgba(99,102,241,0.8) 40px, rgba(99,102,241,0.8) 41px), repeating-linear-gradient(90deg, transparent, transparent 40px, rgba(99,102,241,0.8) 40px, rgba(99,102,241,0.8) 41px)' }} />

      {/* Toast */}
      <div className={`fixed top-8 left-1/2 -translate-x-1/2 z-[100] transition-all duration-500 ${toastMsg ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-10 scale-95 pointer-events-none'}`}>
        <div className="bg-white/10 backdrop-blur-2xl text-white px-5 py-3 rounded-full shadow-xl border border-white/20 flex items-center gap-3">
          <CheckCircle2 size={14} className="text-green-400" />
          <span className="text-xs font-bold">{toastMsg}</span>
        </div>
      </div>

      <div className="relative z-10 w-full max-w-[960px] mx-auto px-4 md:px-8 pt-6 pb-28">

        {/* ── Header ── */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={() => navigate(-1)}
            className="w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-95"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
          >
            <ArrowLeft size={18} className="text-white/70" />
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #6366f1, #ec4899)', boxShadow: '0 0 16px rgba(99,102,241,0.5)' }}>
                <Zap size={14} className="text-white fill-white/30" />
              </div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight leading-none text-white">
                {bn ? 'এআই ইনসাইটস' : 'AI Insights'}
              </h1>
              <span
                className="text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest animate-pulse"
                style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.4), rgba(236,72,153,0.4))', border: '1px solid rgba(99,102,241,0.5)', color: '#a5b4fc' }}
              >
                LIVE
              </span>
            </div>
            <p className="text-xs font-medium mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
              {bn ? 'আপনার পোর্টফোলিওর জন্য রিয়েল-টাইম বাজার বিশ্লেষণ' : 'Real-time market intelligence for your portfolio'}
            </p>
          </div>
          <button
            onClick={() => showToast(bn ? 'ডেটা আপডেট হচ্ছে...' : 'Refreshing data...')}
            className="w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-95"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <RefreshCw size={15} style={{ color: 'rgba(255,255,255,0.5)' }} />
          </button>
        </div>

        {/* ── Performance Summary Strip ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {performanceMetrics.map((m, i) => (
            <div
              key={i}
              className="rounded-2xl p-3 md:p-4"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
            >
              <p className="text-[8px] md:text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: 'rgba(165,180,252,0.7)' }}>{m.label}</p>
              <p className="text-lg md:text-2xl font-black text-white leading-none">{m.value}</p>
              <div className="flex items-center gap-1 mt-1.5">
                {m.up ? <ArrowUpRight size={10} className="text-green-400 shrink-0" /> : <ArrowDownRight size={10} className="text-red-400 shrink-0" />}
                <p className="text-[9px] font-bold" style={{ color: m.up ? 'rgba(74,222,128,0.9)' : 'rgba(248,113,113,0.9)' }}>{m.trend}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Section Tabs ── */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1 scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className="shrink-0 px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-wide transition-all"
              style={activeSection === s.id
                ? { background: 'linear-gradient(135deg, #6366f1, #ec4899)', color: '#fff', boxShadow: '0 4px 14px rgba(99,102,241,0.4)' }
                : { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)' }
              }
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* ── SECTION: Market Opportunities ── */}
        {activeSection === 'opportunities' && (
          <div className="space-y-3">
            <p className="text-[10px] font-black uppercase tracking-widest px-1 mb-3" style={{ color: 'rgba(165,180,252,0.6)' }}>
              {bn ? `${marketOpportunities.length}টি প্রপার্টি বিশ্লেষণ` : `${marketOpportunities.length} properties analysed`}
            </p>

            {marketOpportunities.map(opp => {
              const isExpanded = expandedId === opp.id;
              const tag = tagConfig[opp.tag];
              return (
                <div
                  key={opp.id}
                  className="rounded-[1.5rem] overflow-hidden transition-all duration-300"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  {/* Row */}
                  <div
                    className="p-4 md:p-5 flex items-start gap-4 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : opp.id)}
                  >
                    {/* Confidence ring */}
                    <div className="shrink-0 w-12 h-12 rounded-xl flex flex-col items-center justify-center" style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.25)' }}>
                      <span className="text-[15px] font-black text-indigo-300 leading-none">{opp.confidence}%</span>
                      <span className="text-[7px] font-black uppercase tracking-widest mt-0.5" style={{ color: 'rgba(165,180,252,0.6)' }}>conf</span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-[12px] font-black text-white leading-tight">{opp.property}</p>
                            <span className="text-[8px] font-black px-2 py-0.5 rounded-full" style={{ background: tag.bg, border: `1px solid ${tag.border}`, color: tag.color }}>
                              {tag.label}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 mt-0.5">
                            <MapPin size={9} style={{ color: 'rgba(255,255,255,0.3)' }} />
                            <p className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.4)' }}>{opp.area}</p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          {opp.increasePercent > 0 ? (
                            <p className="text-[13px] font-black text-green-400">{opp.impact}</p>
                          ) : (
                            <p className="text-[11px] font-black" style={{ color: 'rgba(255,255,255,0.4)' }}>{opp.impact}</p>
                          )}
                          <ChevronRight size={13} className={`ml-auto text-white/20 transition-transform duration-300 ${isExpanded ? 'rotate-90' : ''}`} />
                        </div>
                      </div>

                      {/* Rent comparison bar */}
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-[9px] font-bold shrink-0" style={{ color: 'rgba(255,255,255,0.4)' }}>৳{opp.currentRent}</span>
                        <div className="flex-1 h-1.5 rounded-full relative" style={{ background: 'rgba(255,255,255,0.08)' }}>
                          <div
                            className="h-full rounded-full absolute left-0 top-0"
                            style={{ width: `${Math.min(100, (parseInt(opp.currentRent.replace(/,/g, '')) / parseInt(opp.marketAvg.replace(/,/g, ''))) * 100)}%`, background: opp.tag === 'underpriced' ? 'linear-gradient(90deg, #6366f1, #10b981)' : opp.tag === 'overpriced' ? 'linear-gradient(90deg, #6366f1, #f59e0b)' : 'linear-gradient(90deg, #6366f1, #ec4899)' }}
                          />
                        </div>
                        <span className="text-[9px] font-bold shrink-0" style={{ color: 'rgba(255,255,255,0.3)' }}>Avg ৳{opp.marketAvg}</span>
                      </div>
                    </div>
                  </div>

                  {/* Expanded */}
                  {isExpanded && (
                    <div className="px-4 md:px-5 pb-5 pt-2" style={{ background: 'rgba(255,255,255,0.02)', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                      <p className="text-[11px] font-medium leading-relaxed mb-4" style={{ color: 'rgba(255,255,255,0.6)' }}>{opp.reasoning}</p>

                      {opp.increasePercent > 0 && (
                        <div className="grid grid-cols-3 gap-2 mb-4">
                          {[
                            { label: bn ? 'বর্তমান ভাড়া' : 'Current Rent', value: `৳${opp.currentRent}` },
                            { label: bn ? 'বাজার গড়' : 'Market Avg', value: `৳${opp.marketAvg}` },
                            { label: bn ? 'পরামর্শ' : 'Suggested', value: `৳${opp.suggestedRent}`, highlight: true },
                          ].map((item, i) => (
                            <div key={i} className="rounded-xl p-2.5 text-center" style={{ background: item.highlight ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)', border: item.highlight ? '1px solid rgba(99,102,241,0.35)' : '1px solid rgba(255,255,255,0.06)' }}>
                              <p className="text-[8px] font-black uppercase tracking-widest mb-1" style={{ color: item.highlight ? '#a5b4fc' : 'rgba(255,255,255,0.3)' }}>{item.label}</p>
                              <p className={`text-[12px] font-black ${item.highlight ? 'text-indigo-300' : 'text-white/70'}`}>{item.value}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      <button
                        onClick={() => showToast(bn ? 'পরিকল্পনা সেভ হয়েছে!' : 'Action plan saved!')}
                        className="w-full py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wide transition-all active:scale-95"
                        style={{ background: 'linear-gradient(135deg, #6366f1, #ec4899)', boxShadow: '0 4px 14px rgba(99,102,241,0.3)' }}
                      >
                        {bn ? 'অ্যাকশন প্ল্যানে যোগ করুন' : 'Add to Action Plan'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── SECTION: Demand Signals ── */}
        {activeSection === 'demand' && (
          <div className="space-y-3">
            <p className="text-[10px] font-black uppercase tracking-widest px-1 mb-3" style={{ color: 'rgba(165,180,252,0.6)' }}>
              {bn ? 'ঢাকার মূল এলাকার চাহিদা সিগন্যাল' : 'Demand signals across key Dhaka areas'}
            </p>
            {demandSignals.map((d, i) => (
              <div
                key={i}
                className="rounded-2xl p-4 md:p-5 flex items-center gap-4"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: d.bg }}>
                  <d.icon size={18} className={d.color} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[13px] font-black text-white">{d.area}</p>
                    <span className={`text-[9px] font-black ${d.color}`}>{d.label}</span>
                  </div>
                  <div className="h-2 rounded-full w-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${d.demand}%`,
                        background: d.demand >= 80 ? 'linear-gradient(90deg, #10b981, #34d399)' : d.demand >= 60 ? 'linear-gradient(90deg, #6366f1, #818cf8)' : d.demand >= 40 ? 'linear-gradient(90deg, #f59e0b, #fcd34d)' : 'linear-gradient(90deg, #ef4444, #f87171)'
                      }}
                    />
                  </div>
                </div>
                <span className="text-xl font-black shrink-0" style={{ color: d.demand >= 80 ? '#4ade80' : d.demand >= 60 ? '#a5b4fc' : d.demand >= 40 ? '#fcd34d' : '#f87171' }}>
                  {d.demand}
                </span>
              </div>
            ))}

            <div className="mt-4 rounded-2xl p-4" style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)' }}>
              <p className="text-[9px] font-black uppercase tracking-widest mb-1.5" style={{ color: '#a5b4fc' }}>
                {bn ? 'ইনসাইট' : 'Insight'}
              </p>
              <p className="text-[12px] font-medium leading-relaxed" style={{ color: 'rgba(255,255,255,0.65)' }}>
                {bn
                  ? 'গুলশান ২ এবং বনানীতে চাহিদা সর্বোচ্চ। এই এলাকায় ভাড়া বাড়ানোর সুযোগ সবচেয়ে বেশি।'
                  : 'Gulshan 2 and Banani are showing the strongest tenant demand signals. These areas present the highest opportunity for rent optimization with minimal vacancy risk.'}
              </p>
            </div>
          </div>
        )}

        {/* ── SECTION: Performance ── */}
        {activeSection === 'performance' && (
          <div className="space-y-4">
            <p className="text-[10px] font-black uppercase tracking-widest px-1 mb-3" style={{ color: 'rgba(165,180,252,0.6)' }}>
              {bn ? 'আপনার পোর্টফোলিও পারফরম্যান্স' : 'Your portfolio performance vs. platform average'}
            </p>

            {/* Performance cards */}
            {[
              { label: bn ? 'অকুপ্যান্সি রেট' : 'Occupancy Rate', yours: 87, platform: 74, unit: '%', color: '#10b981' },
              { label: bn ? 'রেসপন্স রেট' : 'Response Rate', yours: 98, platform: 81, unit: '%', color: '#a5b4fc' },
              { label: bn ? 'গড় ভাড়ার মূল্য (হাজার ৳)' : 'Avg Rent Value (K ৳)', yours: 95, platform: 65, unit: 'K', color: '#f59e0b' },
              { label: bn ? 'ইনকোয়ারি কনভার্সন' : 'Inquiry Conversion', yours: 24, platform: 18, unit: '%', color: '#ec4899' },
            ].map((m, i) => (
              <div key={i} className="rounded-2xl p-4 md:p-5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[12px] font-black text-white">{m.label}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black" style={{ color: 'rgba(255,255,255,0.35)' }}>
                      {bn ? 'গড়' : 'Avg'}: {m.platform}{m.unit}
                    </span>
                    <span className="text-[12px] font-black" style={{ color: m.color }}>
                      {m.yours}{m.unit}
                    </span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[8px] font-black uppercase tracking-widest w-14 shrink-0" style={{ color: m.color }}>{bn ? 'আপনি' : 'You'}</span>
                    <div className="flex-1 h-2 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(m.yours, 100)}%`, background: m.color }} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[8px] font-black uppercase tracking-widest w-14 shrink-0" style={{ color: 'rgba(255,255,255,0.25)' }}>{bn ? 'গড়' : 'Avg'}</span>
                    <div className="flex-1 h-2 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.min(m.platform, 100)}%`, background: 'rgba(255,255,255,0.2)' }} />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── SECTION: Quick Wins ── */}
        {activeSection === 'wins' && (
          <div className="space-y-3">
            <p className="text-[10px] font-black uppercase tracking-widest px-1 mb-3" style={{ color: 'rgba(165,180,252,0.6)' }}>
              {bn ? 'সহজ পদক্ষেপ যা বড় ফলাফল দেবে' : 'Simple actions that can drive meaningful impact'}
            </p>
            {quickWins.map((w, i) => (
              <div
                key={w.id}
                className="rounded-2xl p-4 md:p-5 flex items-start gap-4 transition-all hover:scale-[1.01] cursor-pointer"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                onClick={() => showToast(bn ? 'অ্যাকশন প্ল্যানে যোগ হয়েছে!' : 'Added to your action plan!')}
              >
                <div className="shrink-0 w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: w.bg }}>
                  <w.icon size={18} className={w.color} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-black text-white leading-tight">{w.title}</p>
                  <p className="text-[10px] font-bold mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>{w.detail}</p>
                  <div className="mt-2 flex items-center gap-1.5">
                    <Clock size={9} style={{ color: 'rgba(165,180,252,0.6)' }} />
                    <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: 'rgba(165,180,252,0.6)' }}>{w.urgency}</span>
                  </div>
                </div>
                <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.3)' }}>
                  <ArrowUpRight size={13} style={{ color: '#a5b4fc' }} />
                </div>
              </div>
            ))}

            <div className="mt-2 rounded-2xl p-5" style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(236,72,153,0.10))', border: '1px solid rgba(99,102,241,0.2)' }}>
              <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: '#a5b4fc' }}>
                {bn ? 'মোট সম্ভাব্য আয় বৃদ্ধি' : 'Total Potential Revenue Uplift'}
              </p>
              <p className="text-2xl font-black text-white">+৳1,68,000</p>
              <p className="text-[11px] font-medium mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
                {bn ? 'প্রতি বছর, যদি সব পরামর্শ বাস্তবায়ন হয়' : 'per year if all recommendations are implemented'}
              </p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}