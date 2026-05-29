import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Sparkles, Check, Zap, ArrowLeft, Crown, BellRing,
  Calendar, Wallet, TrendingUp, Folder, ShieldCheck, Clock,
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { subscriptionService, PLANS, PREMIUM_FEATURES } from '../services/subscriptionService';

/**
 * /subscription — pricing + upgrade flow for the host portal.
 *
 * Showcases the 3-month trial, the live trial countdown, the two paid
 * plans, and a CTA. When the host arrives here with `?from=<featureId>`
 * (set by HostDashboard when they tap a locked tab), the matching
 * feature is highlighted at the top so they understand exactly why the
 * paywall fired.
 *
 * Mock-mode payment: clicking Subscribe runs subscriptionService.subscribe
 * which flips the local record to `tier: 'pro'`. When the backend ships,
 * the only swap is inside subscriptionService — this page never sees
 * billing internals.
 */

const FEATURE_META = {
  analytics:   { icon: TrendingUp, en: 'Analytics',       bn: 'অ্যানালিটিক্স',     descEn: 'KPIs, revenue chart, tenant scorecards', descBn: 'KPI, রেভিনিউ চার্ট, ভাড়াটিয়া স্কোরকার্ড' },
  documents:   { icon: Folder,     en: 'Home Management', bn: 'হোম ম্যানেজমেন্ট',   descEn: 'Lease, IDs, receipts, utility vault',     descBn: 'লিজ, আইডি, রসিদ, ইউটিলিটি ভল্ট' },
  bookings:    { icon: Calendar,   en: 'Bookings',        bn: 'বুকিং',              descEn: 'Lease stages: Draft → Active → Done',     descBn: 'লিজ স্টেজ: ড্রাফট → অ্যাক্টিভ → শেষ' },
  rent:        { icon: Wallet,     en: 'Rent Collection', bn: 'ভাড়া কালেকশন',     descEn: 'Shared ledger, dues, partial payments',  descBn: 'শেয়ার্ড লেজার, বকেয়া, পার্শিয়াল পেমেন্ট' },
  smartAlerts: { icon: BellRing,   en: 'Smart Alerts',    bn: 'স্মার্ট অ্যালার্টস', descEn: 'Auto reminders for rent, expiry, leads', descBn: 'ভাড়া, মেয়াদ, লিডসের অটো রিমাইন্ডার' },
  aiInsights:  { icon: Sparkles,   en: 'AI Insights',     bn: 'এআই ইনসাইটস',       descEn: 'Pricing tips, demand forecasts',          descBn: 'প্রাইসিং টিপস, ডিমান্ড ফোরকাস্ট' },
};

const SubscriptionPage = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { language = 'English' } = useLanguage() || {};
  const isBn = language === 'বাংলা';
  const fromFeature = params.get('from');

  const [status, setStatus] = useState(() => subscriptionService.getStatus());
  const [busyPlan, setBusyPlan] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    subscriptionService.fetchStatus();
    const off = subscriptionService.onChange(() => setStatus(subscriptionService.getStatus()));
    return off;
  }, []);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2400); };

  const handleSubscribe = async (planId) => {
    setBusyPlan(planId);
    try {
      await subscriptionService.subscribe(planId);
      showToast(isBn ? 'সাবস্ক্রিপশন অ্যাক্টিভ! সব ফিচার আনলকড।' : 'Subscription active! All features unlocked.');
      setTimeout(() => navigate('/host-dashboard'), 900);
    } catch (e) {
      showToast(e.message);
    } finally {
      setBusyPlan(null);
    }
  };

  // Status banner copy varies by tier. We keep the language inline so
  // translators only have to touch this file.
  const banner = (() => {
    if (status.isPaid) {
      return {
        accent: 'from-emerald-500 to-green-600',
        title: isBn ? 'আপনি প্রো সদস্য' : "You're on Pro",
        body: isBn
          ? `আপনার সাবস্ক্রিপশন ${status.daysRemaining} দিন বাকি আছে।`
          : `${status.daysRemaining} day${status.daysRemaining === 1 ? '' : 's'} of Pro access remaining.`,
        icon: Crown,
      };
    }
    if (status.isExpired) {
      return {
        accent: 'from-[#ba0036] to-[#ff004c]',
        title: isBn ? 'আপনার ট্রায়াল শেষ' : 'Your free trial has ended',
        body: isBn
          ? 'প্রিমিয়াম ফিচারগুলো আবার আনলক করতে যেকোনো প্ল্যান বেছে নিন।'
          : 'Pick a plan below to unlock premium features again.',
        icon: ShieldCheck,
      };
    }
    // Trial
    return {
      accent: 'from-blue-500 to-indigo-600',
      title: isBn ? 'ফ্রি ট্রায়াল চলছে' : 'Free trial in progress',
      body: isBn
        ? `আপনার ৩-মাসের ট্রায়ালের ${status.daysRemaining} দিন বাকি আছে — কোনো কার্ডের প্রয়োজন নেই।`
        : `${status.daysRemaining} day${status.daysRemaining === 1 ? '' : 's'} left in your 3-month trial — no card required.`,
      icon: Clock,
    };
  })();

  const BannerIcon = banner.icon;

  return (
    <div className="min-h-screen bg-[#eaeff5] font-sans relative overflow-hidden text-gray-900">
      <div className="fixed top-[-20%] left-[-10%] w-[50vw] h-[50vw] bg-gradient-to-br from-[#ba0036]/10 to-transparent rounded-full blur-[120px] pointer-events-none z-0" />
      <div className="fixed bottom-[-20%] right-[-10%] w-[50vw] h-[50vw] bg-gradient-to-tl from-blue-600/5 to-transparent rounded-full blur-[120px] pointer-events-none z-0" />

      {/* Toast */}
      <div className={`fixed top-8 left-1/2 -translate-x-1/2 z-[100] transition-all duration-500 ease-out ${toast ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-10 scale-95 pointer-events-none'}`}>
        <div className="bg-gray-900/90 backdrop-blur-2xl text-white px-5 py-3 rounded-full shadow-[0_20px_40px_rgba(0,0,0,0.2)] border border-white/10 flex items-center gap-3">
          <Check size={14} className="text-green-400" />
          <span className="text-xs font-bold tracking-wide">{toast}</span>
        </div>
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-4 md:px-8 pt-6 md:pt-10 pb-24">
        <Link to="/host-dashboard" className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-gray-500 hover:text-[#ba0036] transition-colors">
          <ArrowLeft size={14} /> {isBn ? 'ড্যাশবোর্ডে ফিরে যান' : 'Back to Dashboard'}
        </Link>

        {/* Status banner */}
        <div className={`mt-5 rounded-[2rem] p-6 md:p-8 text-white shadow-[0_20px_60px_rgba(0,0,0,0.12)] bg-gradient-to-br ${banner.accent}`}>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5">
            <div className="w-14 h-14 rounded-2xl bg-white/15 backdrop-blur-md flex items-center justify-center shrink-0">
              <BannerIcon size={26} />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl md:text-3xl font-black tracking-tight">{banner.title}</h1>
              <p className="text-sm md:text-base font-bold text-white/90 mt-1">{banner.body}</p>
            </div>
            {!status.isPaid && (
              <div className="text-right hidden sm:block">
                <p className="text-[10px] font-black uppercase tracking-widest text-white/70">{isBn ? 'কোনো কার্ড লাগবে না' : 'No card required'}</p>
                <p className="text-sm font-black text-white">{isBn ? '৩ মাস ফ্রি' : '3 months free'}</p>
              </div>
            )}
          </div>
        </div>

        {/* "Why we sent you here" — only shown when a locked feature triggered it */}
        {fromFeature && FEATURE_META[fromFeature] && (
          <div className="mt-5 bg-white border border-[#ba0036]/15 rounded-[1.5rem] p-5 md:p-6 shadow-sm flex flex-col sm:flex-row gap-4 items-start">
            <div className="w-12 h-12 rounded-2xl bg-[#ba0036]/10 text-[#ba0036] flex items-center justify-center shrink-0">
              {(() => {
                const Icon = FEATURE_META[fromFeature].icon;
                return <Icon size={20} />;
              })()}
            </div>
            <div className="flex-1">
              <p className="text-[10px] font-black text-[#ba0036] uppercase tracking-widest">{isBn ? 'প্রিমিয়াম ফিচার' : 'Premium feature'}</p>
              <h3 className="text-lg md:text-xl font-black text-gray-900 mt-0.5">{isBn ? FEATURE_META[fromFeature].bn : FEATURE_META[fromFeature].en}</h3>
              <p className="text-sm font-bold text-gray-500 mt-1">{isBn ? FEATURE_META[fromFeature].descBn : FEATURE_META[fromFeature].descEn}</p>
            </div>
          </div>
        )}

        {/* All premium features */}
        <div className="mt-8">
          <h2 className="text-xl md:text-2xl font-black text-gray-900 tracking-tight">{isBn ? 'প্রো প্ল্যানে কী আছে' : "What's in Pro"}</h2>
          <p className="text-sm font-bold text-gray-500 mt-1">{isBn ? 'ট্রায়ালের সময় সবগুলো ফিচার ব্যবহার করুন। ৩ মাস পর প্রো প্ল্যান বেছে নিন।' : 'Use everything during the trial. After 3 months, pick a Pro plan to keep going.'}</p>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {PREMIUM_FEATURES.map(id => {
              const meta = FEATURE_META[id];
              const Icon = meta.icon;
              return (
                <div key={id} className="bg-white rounded-[1.25rem] p-4 border border-gray-100 shadow-sm flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#ba0036]/8 text-[#ba0036] flex items-center justify-center shrink-0">
                    <Icon size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-black text-gray-900 leading-tight truncate">{isBn ? meta.bn : meta.en}</p>
                    <p className="text-[11px] font-bold text-gray-500 mt-0.5 leading-snug">{isBn ? meta.descBn : meta.descEn}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Plans */}
        <div className="mt-10">
          <h2 className="text-xl md:text-2xl font-black text-gray-900 tracking-tight">{isBn ? 'প্ল্যান বেছে নিন' : 'Choose a plan'}</h2>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            {PLANS.map(plan => (
              <div
                key={plan.id}
                className={`relative bg-white rounded-[1.75rem] p-6 md:p-7 shadow-[0_4px_20px_rgba(0,0,0,0.04)] border ${plan.popular ? 'border-[#ba0036]/30' : 'border-gray-100'} transition-all hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)] hover:-translate-y-0.5`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 right-6 bg-[#ba0036] text-white text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-full shadow-md">
                    {isBn ? 'জনপ্রিয়' : 'Most popular'}
                  </div>
                )}
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{isBn ? plan.name.bn : plan.name.en}</p>
                <div className="mt-2 flex items-end gap-1">
                  <span className="text-4xl md:text-5xl font-black text-gray-900 tracking-tighter">{plan.currency === 'BDT' ? '৳' : plan.currency} {plan.price.toLocaleString('en-IN')}</span>
                  <span className="text-sm font-bold text-gray-400 pb-1.5">{isBn ? plan.intervalLabel.bn : plan.intervalLabel.en}</span>
                </div>
                {plan.savings && (
                  <p className="mt-1 inline-block bg-emerald-50 text-emerald-700 text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full">{isBn ? plan.savings.bn : plan.savings.en}</p>
                )}
                <ul className="mt-5 space-y-2">
                  {(isBn ? plan.benefits.bn : plan.benefits.en).map(line => (
                    <li key={line} className="flex items-center gap-2 text-sm font-bold text-gray-700">
                      <Check size={14} className="text-emerald-500 shrink-0" />
                      {line}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => handleSubscribe(plan.id)}
                  disabled={busyPlan === plan.id}
                  className={`mt-6 w-full py-3.5 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all ${plan.popular ? 'bg-[#ba0036] text-white hover:shadow-[0_12px_30px_rgba(186,0,54,0.35)] hover:-translate-y-0.5' : 'bg-gray-900 text-white hover:bg-gray-800'} ${busyPlan === plan.id ? 'opacity-60 cursor-wait' : ''}`}
                >
                  {busyPlan === plan.id ? (
                    <>
                      <Zap size={14} className="animate-pulse" /> {isBn ? 'প্রসেসিং…' : 'Processing…'}
                    </>
                  ) : (
                    <>
                      <Sparkles size={14} /> {isBn ? 'সাবস্ক্রাইব করুন' : 'Subscribe'}
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Reassurance footer */}
        <div className="mt-8 bg-white rounded-[1.5rem] p-5 md:p-6 border border-gray-100 flex flex-col sm:flex-row items-start sm:items-center gap-3 text-sm font-bold text-gray-700">
          <ShieldCheck size={18} className="text-emerald-500 shrink-0" />
          {isBn
            ? 'আপনার ৩-মাসের ট্রায়াল চলাকালীন কখনোই কার্ডের তথ্য চাওয়া হবে না। যেকোনো সময় বাতিল করতে পারেন।'
            : 'No card info is requested during your 3-month trial. Cancel anytime — Pro features stay on until the end of your paid period.'}
        </div>
      </div>
    </div>
  );
};

export default SubscriptionPage;
