import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, BellRing, AlertTriangle, Clock, CheckCircle2, 
  FileText, CreditCard, Calendar, Home, MessageSquare, X,
  ChevronRight, Filter, Bell, TrendingDown, Hourglass,
  CheckCheck, RefreshCw, MapPin, Phone, User, Building
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

// ─── Alert Data ───────────────────────────────────────────────────────────────
const allAlerts = [
  {
    id: 1, type: 'urgent', category: 'payment',
    title: "Sarah Islam's Rent Due",
    subtitle: 'Modern Duplex with Garden · Banani, Dhaka',
    detail: 'Monthly rent of ৳1,20,000 is due in 3 days. Last payment was received on time.',
    tenant: 'Sarah Islam', phone: '+880 1822 987654',
    property: 'Modern Duplex with Garden',
    dueDate: 'May 06, 2026', amount: '1,20,000',
    daysLeft: 3, icon: CreditCard,
    color: { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', badge: 'bg-orange-100 text-orange-700', dot: 'bg-orange-400', glow: 'shadow-[0_4px_20px_rgba(251,146,60,0.15)]' }
  },
  {
    id: 2, type: 'urgent', category: 'lease',
    title: "Rahim Uddin's Lease Expiring",
    subtitle: 'Cozy Studio Setup · Dhanmondi, Dhaka',
    detail: 'Lease agreement expires in 12 days. Tenant has not yet confirmed renewal. Consider reaching out.',
    tenant: 'Rahim Uddin', phone: '+880 1933 456789',
    property: 'Cozy Studio Setup',
    dueDate: 'May 15, 2026', amount: '45,000',
    daysLeft: 12, icon: FileText,
    color: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', badge: 'bg-red-100 text-red-700', dot: 'bg-[#ba0036]', glow: 'shadow-[0_4px_20px_rgba(186,0,54,0.12)]' }
  },
  {
    id: 3, type: 'medium', category: 'payment',
    title: "Mr. John Doe — Upcoming Rent",
    subtitle: 'Elegant 3BHK with Skyline View · Gulshan 2',
    detail: 'Rent of ৳85,000 is due in 18 days. Tenant has a strong payment history.',
    tenant: 'Mr. John Doe', phone: '+880 1711 234567',
    property: 'Elegant 3BHK with Skyline View',
    dueDate: 'May 21, 2026', amount: '85,000',
    daysLeft: 18, icon: CreditCard,
    color: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', badge: 'bg-blue-100 text-blue-700', dot: 'bg-blue-400', glow: 'shadow-[0_4px_20px_rgba(59,130,246,0.10)]' }
  },
  {
    id: 4, type: 'medium', category: 'maintenance',
    title: 'AC Service Needed',
    subtitle: 'Waterfront Villa · Purbachal, Dhaka',
    detail: 'Tenant reported AC unit not cooling effectively. Routine servicing recommended before summer peak.',
    tenant: 'Ahmed Hasan', phone: '+880 1933 456789',
    property: 'Waterfront Villa',
    dueDate: 'May 10, 2026', amount: null,
    daysLeft: 7, icon: Home,
    color: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-700', dot: 'bg-amber-400', glow: 'shadow-[0_4px_20px_rgba(245,158,11,0.10)]' }
  },
  {
    id: 5, type: 'low', category: 'inquiry',
    title: '3 Unanswered Inquiries',
    subtitle: 'Budget-Friendly 1BHK · Rampura · Luxury Penthouse',
    detail: 'You have 3 inquiries pending a response for more than 24 hours. Quick replies improve your host rating.',
    tenant: null, phone: null,
    property: 'Multiple Properties',
    dueDate: null, amount: null,
    daysLeft: null, icon: MessageSquare,
    color: { bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-700', badge: 'bg-violet-100 text-violet-700', dot: 'bg-violet-400', glow: 'shadow-[0_4px_20px_rgba(139,92,246,0.08)]' }
  },
  {
    id: 6, type: 'low', category: 'lease',
    title: 'Document Renewal Reminder',
    subtitle: 'Corporate Guest House · Tejgaon, Dhaka',
    detail: 'Tenant NID copy on file expires next month. Request updated documents proactively.',
    tenant: 'Karim Hossain', phone: '+880 1655 332211',
    property: 'Corporate Guest House',
    dueDate: 'Jun 01, 2026', amount: null,
    daysLeft: 29, icon: FileText,
    color: { bg: 'bg-teal-50', border: 'border-teal-200', text: 'text-teal-700', badge: 'bg-teal-100 text-teal-700', dot: 'bg-teal-400', glow: 'shadow-[0_4px_20px_rgba(20,184,166,0.08)]' }
  },
];

const resolvedAlerts = [
  { id: 7, title: "Fatima Rahman's April Rent", detail: 'Payment of ৳85,000 received on Apr 30.', resolvedOn: 'Apr 30, 2026', icon: CheckCheck, color: 'text-green-500' },
  { id: 8, title: 'Lease Renewed — Cozy Studio', detail: 'Rahim Uddin renewed for 12 months starting Jan 2025.', resolvedOn: 'Jan 02, 2025', icon: CheckCheck, color: 'text-green-500' },
  { id: 9, title: 'Maintenance Completed — Banani', detail: 'Plumbing issue resolved by technician.', resolvedOn: 'Apr 22, 2026', icon: CheckCheck, color: 'text-green-500' },
];

const FILTERS = ['all', 'urgent', 'medium', 'low'];
const CATEGORIES = ['all', 'payment', 'lease', 'maintenance', 'inquiry'];

const categoryLabel = { all: 'All', payment: 'Payment', lease: 'Lease', maintenance: 'Maintenance', inquiry: 'Inquiry' };

export default function SmartAlertsPage() {
  const navigate = useNavigate();
  const { language = 'English' } = useLanguage() || {};
  const bn = language === 'বাংলা';

  const [activeFilter, setActiveFilter] = useState('all');
  const [activeCategory, setActiveCategory] = useState('all');
  const [expandedId, setExpandedId] = useState(null);
  const [dismissed, setDismissed] = useState([]);
  const [toastMsg, setToastMsg] = useState(null);

  const showToast = (msg) => { setToastMsg(msg); setTimeout(() => setToastMsg(null), 3000); };
  const dismiss = (id) => { setDismissed(prev => [...prev, id]); showToast(bn ? 'অ্যালার্ট সরানো হয়েছে' : 'Alert dismissed'); };

  const visible = allAlerts.filter(a =>
    !dismissed.includes(a.id) &&
    (activeFilter === 'all' || a.type === activeFilter) &&
    (activeCategory === 'all' || a.category === activeCategory)
  );

  const urgentCount = allAlerts.filter(a => a.type === 'urgent' && !dismissed.includes(a.id)).length;
  const mediumCount = allAlerts.filter(a => a.type === 'medium' && !dismissed.includes(a.id)).length;
  const lowCount    = allAlerts.filter(a => a.type === 'low'    && !dismissed.includes(a.id)).length;

  return (
    <div className="min-h-screen bg-[#eaeff5] font-sans text-gray-900 selection:bg-[#ba0036] selection:text-white">
      {/* Orbs */}
      <div className="fixed top-[-15%] left-[-10%] w-[45vw] h-[45vw] bg-gradient-to-br from-[#ba0036]/10 to-transparent rounded-full blur-[100px] pointer-events-none z-0" />
      <div className="fixed bottom-[-15%] right-[-10%] w-[40vw] h-[40vw] bg-gradient-to-tl from-orange-400/6 to-transparent rounded-full blur-[100px] pointer-events-none z-0" />

      {/* Toast */}
      <div className={`fixed top-8 left-1/2 -translate-x-1/2 z-[100] transition-all duration-500 ${toastMsg ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-10 scale-95 pointer-events-none'}`}>
        <div className="bg-gray-900/90 backdrop-blur-xl text-white px-5 py-3 rounded-full shadow-xl border border-white/10 flex items-center gap-3">
          <CheckCircle2 size={14} className="text-green-400" />
          <span className="text-xs font-bold">{toastMsg}</span>
        </div>
      </div>

      <div className="relative z-10 w-full max-w-[900px] mx-auto px-4 md:px-8 pt-6 pb-24">

        {/* ── Header ── */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={() => navigate(-1)}
            className="w-10 h-10 bg-white border border-gray-100 rounded-full flex items-center justify-center text-gray-500 hover:text-[#ba0036] hover:border-[#ba0036]/30 hover:shadow-md transition-all active:scale-95 shrink-0"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl md:text-3xl font-black text-gray-900 tracking-tight leading-none">
              {bn ? 'স্মার্ট অ্যালার্টস' : 'Smart Alerts'}
            </h1>
            <p className="text-xs font-medium text-gray-500 mt-1">
              {bn ? 'আপনার সকল গুরুত্বপূর্ণ নোটিফিকেশন এক জায়গায়' : 'All your important notifications in one place'}
            </p>
          </div>
          <button
            onClick={() => showToast(bn ? 'রিফ্রেশ হচ্ছে...' : 'Refreshing alerts...')}
            className="w-9 h-9 bg-white border border-gray-100 rounded-full flex items-center justify-center text-gray-400 hover:text-[#ba0036] hover:border-[#ba0036]/20 transition-all active:scale-95"
          >
            <RefreshCw size={15} />
          </button>
        </div>

        {/* ── Summary Stats ── */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: bn ? 'জরুরি' : 'Urgent', count: urgentCount, bg: 'bg-gradient-to-br from-red-50 to-rose-100/60', border: 'border-red-200/60', text: 'text-[#ba0036]', dot: 'bg-[#ba0036]' },
            { label: bn ? 'মধ্যম' : 'Medium', count: mediumCount, bg: 'bg-gradient-to-br from-amber-50 to-orange-100/60', border: 'border-amber-200/60', text: 'text-amber-600', dot: 'bg-amber-400' },
            { label: bn ? 'সাধারণ' : 'Low', count: lowCount, bg: 'bg-gradient-to-br from-violet-50 to-purple-100/60', border: 'border-violet-200/60', text: 'text-violet-600', dot: 'bg-violet-400' },
          ].map((s, i) => (
            <div key={i} className={`${s.bg} border ${s.border} rounded-2xl p-3 md:p-5 flex flex-col items-center md:items-start`}>
              <div className={`w-2 h-2 rounded-full ${s.dot} mb-2 animate-pulse`} />
              <p className="text-[8px] md:text-[10px] font-black text-gray-400 uppercase tracking-widest">{s.label}</p>
              <p className={`text-2xl md:text-4xl font-black ${s.text} leading-none mt-0.5`}>{s.count}</p>
            </div>
          ))}
        </div>

        {/* ── Filters ── */}
        <div className="bg-white/70 backdrop-blur-sm rounded-2xl border border-white p-3 mb-5 flex flex-wrap gap-2">
          <div className="flex items-center gap-1.5 mr-2">
            <Filter size={12} className="text-gray-400" />
            <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">{bn ? 'ফিল্টার' : 'Filter'}</span>
          </div>
          {FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wide transition-all ${activeFilter === f ? 'bg-[#ba0036] text-white shadow-[0_4px_10px_rgba(186,0,54,0.25)]' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
            >
              {f === 'all' ? (bn ? 'সব' : 'All') : f === 'urgent' ? (bn ? 'জরুরি' : 'Urgent') : f === 'medium' ? (bn ? 'মধ্যম' : 'Medium') : (bn ? 'সাধারণ' : 'Low')}
            </button>
          ))}
          <div className="w-px h-5 bg-gray-200 self-center mx-1" />
          {CATEGORIES.map(c => (
            <button
              key={c}
              onClick={() => setActiveCategory(c)}
              className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wide transition-all ${activeCategory === c ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
            >
              {bn
                ? { all: 'সব', payment: 'পেমেন্ট', lease: 'লিজ', maintenance: 'মেইন্টেনেন্স', inquiry: 'ইনকোয়ারি' }[c]
                : categoryLabel[c]}
            </button>
          ))}
        </div>

        {/* ── Active Alerts ── */}
        <div className="space-y-3 mb-8">
          {visible.length === 0 && (
            <div className="bg-white rounded-[1.5rem] p-10 text-center border border-gray-50 shadow-sm">
              <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 size={28} className="text-green-500" />
              </div>
              <p className="text-base font-black text-gray-700">{bn ? 'কোনো অ্যালার্ট নেই!' : 'All clear!'}</p>
              <p className="text-xs text-gray-400 font-medium mt-1">{bn ? 'এই ফিল্টারে কোনো অ্যালার্ট নেই।' : 'No alerts match this filter.'}</p>
            </div>
          )}

          {visible.map(alert => {
            const isExpanded = expandedId === alert.id;
            return (
              <div
                key={alert.id}
                className={`bg-white rounded-[1.5rem] border ${alert.color.border} ${alert.color.glow} transition-all duration-300 overflow-hidden`}
              >
                {/* Main Row */}
                <div
                  className="p-4 md:p-5 flex items-start gap-4 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : alert.id)}
                >
                  {/* Icon */}
                  <div className={`shrink-0 w-11 h-11 rounded-xl ${alert.color.bg} border ${alert.color.border} flex items-center justify-center`}>
                    <alert.icon size={18} className={alert.color.text} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-black text-gray-900 leading-tight">{alert.title}</h3>
                          <span className={`text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest ${alert.color.badge}`}>
                            {alert.type === 'urgent' ? (bn ? 'জরুরি' : 'Urgent') : alert.type === 'medium' ? (bn ? 'মধ্যম' : 'Medium') : (bn ? 'সাধারণ' : 'Low')}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-400 font-medium mt-0.5 line-clamp-1">{alert.subtitle}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {alert.daysLeft !== null && (
                          <span className={`text-[9px] font-black ${alert.daysLeft <= 5 ? 'text-[#ba0036]' : 'text-gray-400'} whitespace-nowrap`}>
                            {alert.daysLeft}d {bn ? 'বাকি' : 'left'}
                          </span>
                        )}
                        <ChevronRight size={14} className={`text-gray-300 transition-transform duration-300 ${isExpanded ? 'rotate-90' : ''}`} />
                      </div>
                    </div>

                    {/* Progress bar for days */}
                    {alert.daysLeft !== null && (
                      <div className="mt-2.5 h-1 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${alert.daysLeft <= 5 ? 'bg-[#ba0036]' : alert.daysLeft <= 14 ? 'bg-amber-400' : 'bg-blue-400'}`}
                          style={{ width: `${Math.max(5, 100 - (alert.daysLeft / 30) * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div className={`px-4 md:px-5 pb-5 pt-1 ${alert.color.bg} border-t ${alert.color.border}`}>
                    <p className="text-[12px] font-medium text-gray-600 leading-relaxed mb-4">{alert.detail}</p>

                    <div className="grid grid-cols-2 gap-2 mb-4">
                      {alert.tenant && (
                        <div className="bg-white/70 rounded-xl p-3">
                          <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">{bn ? 'ভাড়াটিয়া' : 'Tenant'}</p>
                          <div className="flex items-center gap-1.5">
                            <User size={11} className="text-gray-500 shrink-0" />
                            <p className="text-[11px] font-black text-gray-800">{alert.tenant}</p>
                          </div>
                        </div>
                      )}
                      {alert.phone && (
                        <div className="bg-white/70 rounded-xl p-3">
                          <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">{bn ? 'ফোন' : 'Phone'}</p>
                          <div className="flex items-center gap-1.5">
                            <Phone size={11} className="text-gray-500 shrink-0" />
                            <p className="text-[11px] font-black text-gray-800">{alert.phone}</p>
                          </div>
                        </div>
                      )}
                      {alert.dueDate && (
                        <div className="bg-white/70 rounded-xl p-3">
                          <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">{bn ? 'তারিখ' : 'Due Date'}</p>
                          <div className="flex items-center gap-1.5">
                            <Calendar size={11} className="text-gray-500 shrink-0" />
                            <p className="text-[11px] font-black text-gray-800">{alert.dueDate}</p>
                          </div>
                        </div>
                      )}
                      {alert.amount && (
                        <div className="bg-white/70 rounded-xl p-3">
                          <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">{bn ? 'পরিমাণ' : 'Amount'}</p>
                          <div className="flex items-center gap-1.5">
                            <CreditCard size={11} className="text-gray-500 shrink-0" />
                            <p className="text-[11px] font-black text-gray-800">৳ {alert.amount}</p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => showToast(bn ? 'মেসেজ পাঠানো হচ্ছে...' : 'Opening chat...')}
                        className={`flex-1 py-2.5 rounded-xl text-[11px] font-black text-white transition-all active:scale-95 ${alert.type === 'urgent' ? 'bg-[#ba0036] shadow-[0_4px_12px_rgba(186,0,54,0.25)]' : 'bg-gray-800'} hover:opacity-90`}
                      >
                        {bn ? 'মেসেজ করুন' : 'Message Tenant'}
                      </button>
                      <button
                        onClick={() => dismiss(alert.id)}
                        className="px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-[11px] font-black text-gray-500 hover:bg-gray-50 transition-all active:scale-95"
                      >
                        {bn ? 'সরিয়ে দিন' : 'Dismiss'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Resolved Alerts ── */}
        <div>
          <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 px-1">
            {bn ? 'সমাধান হওয়া অ্যালার্টস' : 'Resolved Alerts'}
          </h3>
          <div className="space-y-2">
            {resolvedAlerts.map(r => (
              <div key={r.id} className="bg-white/60 backdrop-blur-sm border border-gray-100 rounded-2xl px-4 py-3 flex items-center gap-3">
                <div className="w-8 h-8 bg-green-50 rounded-xl flex items-center justify-center shrink-0">
                  <r.icon size={14} className={r.color} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-black text-gray-600 line-clamp-1">{r.title}</p>
                  <p className="text-[10px] text-gray-400 font-medium mt-0.5 line-clamp-1">{r.detail}</p>
                </div>
                <span className="text-[9px] font-bold text-gray-300 whitespace-nowrap shrink-0">{r.resolvedOn}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}