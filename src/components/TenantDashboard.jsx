import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  Building2, Search, Bell, Globe, LayoutDashboard, Heart,
  MessageSquare, MessageCircle, Settings, HelpCircle,
  ArrowRight, Trash2, MapPin, Receipt, CheckCheck, Download,
  CreditCard, Hourglass, X, UserCircle, BadgeCheck, ShieldAlert,
  Camera, ScanFace, Upload, Check, Edit3, User, Phone, Mail,
  Briefcase, GraduationCap, Building, Shield, ShieldCheck, FileText, AlertCircle,
  LogOut, CheckCircle2, Calendar, Clock, Eye, Send, ThumbsUp, ThumbsDown,
  Inbox, Home, Sparkles, KeyRound
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
// InquiryModal is the same shared modal used by PropertyDetails / PropertyListing.
// Adjust the import path if your file lives elsewhere — the API is unchanged.
import InquiryModal from './InquiryModal';

// 🟢 Shared localStorage key — written by HostDashboard when the landlord
// marks rent as paid, read here so the tenant sees an instant receipt.
const PAYMENT_RECEIPTS_KEY = 'tolet_payment_receipts';
const PAYMENT_RECEIPTS_EVENT = 'tolet-payment-receipts-updated';

// 🟢 Tenant profile schema — INTENTIONALLY MINIMAL.
// Real-world rule: every extra field cuts signup completion by ~10%.
// We only keep what's strictly needed for landlord trust:
//   - name + phone (already captured at signup)
//   - optional email + DOB (lightweight contact info)
//   - optional profession picker (drives the verification step 3)
//   - optional document verification (Photo, NID, Profession proof)
// Rental preferences, household details, references, addresses, etc. all
// happen at INQUIRY time (in the inquiry modal) — not as profile setup.
const TENANT_PROFILE_KEY = 'tolet_tenant_profile';
const TENANT_PROFILE_EVENT = 'tolet-tenant-profile-updated';

const DEFAULT_TENANT_PROFILE = {
  fullName: '',
  phone: '',                  // OTP-verified at signup, locked after
  email: '',                  // optional, verifiable
  dateOfBirth: '',            // optional
  professionType: '',         // 'student' | 'employed' | 'self-employed' | 'other'

  // ── VERIFICATION DOCUMENTS (boolean flags only — no real file persistence) ─
  // Backend swap: replace booleans with upload-IDs returned from POST /uploads.
  verification: {
    photo: false,
    nidFront: false,
    nidBack: false,
    professionProof: false,
    submittedForReview: false,
    status: 'unverified',     // 'unverified' | 'pending' | 'verified'
  },
};

// ╔════════════════════════════════════════════════════════════════════════╗
// ║  countVerificationSteps — used by the profile tab + overview nudge.    ║
// ║  Single source of truth for "how done are the *required* docs?".      ║
// ╚════════════════════════════════════════════════════════════════════════╝
const countVerificationSteps = (p) => {
  if (!p?.verification) return { done: 0, total: 3 };
  const v = p.verification;
  // Step 3 (profession proof) is N/A for "other" — auto-complete then.
  const skipStep3 = p.professionType === 'other' || p.professionType === '';
  const total = skipStep3 ? 2 : 3;
  let done = 0;
  if (v.photo) done += 1;
  if (v.nidFront && v.nidBack) done += 1;
  if (!skipStep3 && v.professionProof) done += 1;
  return { done, total };
};

const computeVerificationPct = (p) => {
  const { done, total } = countVerificationSteps(p);
  return Math.round((done / total) * 100);
};

// ╔════════════════════════════════════════════════════════════════════════╗
// ║  TRUST SCORE — gamified 0-100 score visible to both tenant + landlord. ║
// ║  Kept intentionally simple: 4 items, easy to reach 100 without filling ║
// ║  20+ fields. Profession proof auto-passes for "Other" so a tenant who  ║
// ║  doesn't fit the predefined buckets isn't penalised.                   ║
// ╚════════════════════════════════════════════════════════════════════════╝
const computeTrustScore = (p) => {
  if (!p) return { score: 0, tier: 'bronze', breakdown: [] };
  const v = p.verification || {};
  const items = [
    { key: 'phone',      labelEn: 'Phone OTP verified', labelBn: 'ফোন OTP ভেরিফাইড', pts: 20, done: !!p.phone },
    { key: 'photo',      labelEn: 'Profile photo',      labelBn: 'প্রোফাইল ছবি',     pts: 20, done: !!v.photo },
    { key: 'nid',        labelEn: 'NID verified',       labelBn: 'NID ভেরিফাইড',     pts: 30, done: !!(v.nidFront && v.nidBack) },
    { key: 'profession', labelEn: 'Profession proof',   labelBn: 'পেশার প্রমাণ',     pts: 30, done: !!v.professionProof || p.professionType === 'other' },
  ];
  const score = items.filter((i) => i.done).reduce((sum, i) => sum + i.pts, 0);
  let tier = 'bronze';
  if (score >= 90) tier = 'platinum';
  else if (score >= 70) tier = 'gold';
  else if (score >= 40) tier = 'silver';
  return { score, tier, breakdown: items };
};

const TenantDashboard = () => {
  const navigate = useNavigate();
  const location = useLocation();
  
  // 🔴 100% Connected to your Global LanguageContext from Navbar
  const { t, language, setLanguage } = useLanguage(); 

  const [activeTab, setActiveTab] = useState('overview');
  const [isProfileDrawerOpen, setIsProfileDrawerOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [isLangOpen, setIsLangOpen] = useState(false);
  
  const [savedProperties, setSavedProperties] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');

  // 🟢 NEW: Payment receipts pushed in by the landlord from HostDashboard.
  const [paymentReceipts, setPaymentReceipts] = useState([]);
  const [activeReceipt, setActiveReceipt] = useState(null);

  // 🟢 NEW: Inquiry modal — single shared modal opened from any "Inquire"
  // CTA in the dashboard (saved-property cards, inquiry rows). When the
  // user submits, your existing InquiryModal handles the network call;
  // wrap with onSubmitted later if you want to optimistically prepend a
  // new entry to the local inquiries list.
  const [inquiryProp, setInquiryProp] = useState(null);
  const openInquiry = (prop) => {
    if (!prop) return;
    // Normalise the shape so InquiryModal is happy regardless of source.
    setInquiryProp({
      id:       prop.id,
      title:    prop.title || prop.name || 'Property',
      price:    prop.price || prop.rent || 0,
      location: prop.location || prop.address || '',
      images:   prop.images || (prop.image ? [prop.image] : []),
      beds:     prop.beds  ?? prop.bedrooms ?? null,
      baths:    prop.baths ?? prop.bathrooms ?? null,
      sqft:     prop.sqft  ?? null,
    });
  };
  const inquiryLandlord = inquiryProp
    ? { name: inquiryProp.landlordName || 'Landlord', phone: inquiryProp.landlordPhone || '' }
    : null;

  // 🟢 NEW: One-time futuristic Welcome splash — fires on first dashboard
  // mount per browser session. Uses sessionStorage so it doesn't reappear
  // on tab navigation or component re-renders, but does reappear on a
  // fresh login or new browser session.
  const [showWelcome, setShowWelcome] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (window.sessionStorage.getItem('tolet_welcome_shown') === '1') return;
      window.sessionStorage.setItem('tolet_welcome_shown', '1');
    } catch {
      /* storage blocked — still show once for this mount */
    }
    setShowWelcome(true);
    const t1 = window.setTimeout(() => setShowWelcome(false), 3200);
    return () => window.clearTimeout(t1);
  }, []);

  // 🟢 Tenant profile state — lives entirely inside the dashboard now.
  // Synced to localStorage so it survives reloads and other tabs.
  const [tenantProfile, setTenantProfile] = useState(DEFAULT_TENANT_PROFILE);
  const [draftProfile, setDraftProfile] = useState(DEFAULT_TENANT_PROFILE);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileToast, setProfileToast] = useState(null);

  const verifPct = computeVerificationPct(tenantProfile);
  const { done: verifDone, total: verifTotal } = countVerificationSteps(tenantProfile);
  const trustScore = computeTrustScore(tenantProfile);
  const isVerified = tenantProfile?.verification?.status === 'verified';
  const verifPending = tenantProfile?.verification?.status === 'pending';

  const loggedInUser = tenantProfile?.fullName || localStorage.getItem('userName') || 'John';

  const notifRef = useRef(null);
  const langRef = useRef(null);

  useEffect(() => {
    window.scrollTo(0, 0);
    if (location.state && location.state.activeTab) {
      setActiveTab(location.state.activeTab);
    }
    
    const loadSaved = () => {
      const stored = JSON.parse(localStorage.getItem('savedProperties')) || [];
      setSavedProperties(stored);
    };
    loadSaved();
  }, [location]);

  // 🟢 NEW: Sync payment receipts (mount + cross-tab "storage" + same-tab custom event).
  useEffect(() => {
    const loadReceipts = () => {
      try {
        const stored = JSON.parse(localStorage.getItem(PAYMENT_RECEIPTS_KEY)) || [];
        setPaymentReceipts(stored);
      } catch {
        setPaymentReceipts([]);
      }
    };
    loadReceipts();
    const onStorage = (e) => { if (!e.key || e.key === PAYMENT_RECEIPTS_KEY) loadReceipts(); };
    const onCustom = () => loadReceipts();
    window.addEventListener('storage', onStorage);
    window.addEventListener(PAYMENT_RECEIPTS_EVENT, onCustom);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(PAYMENT_RECEIPTS_EVENT, onCustom);
    };
  }, []);

  // 🟢 Sync tenant profile (mount + storage event + same-tab custom event).
  // We seed `fullName`/`phone` from the legacy `userName` localStorage key on
  // first run so existing users don't see an empty card after this update.
  useEffect(() => {
    const loadProfile = () => {
      try {
        const stored = JSON.parse(localStorage.getItem(TENANT_PROFILE_KEY) || 'null');
        if (stored) {
          // Spread DEFAULT first so any new schema fields land with safe defaults.
          // Stored verification block wins over default if present.
          const merged = {
            ...DEFAULT_TENANT_PROFILE,
            ...stored,
            verification: { ...DEFAULT_TENANT_PROFILE.verification, ...(stored.verification || {}) },
          };
          // Drop legacy fields from earlier schema (Phase 5) that no longer exist.
          delete merged.gender;
          delete merged.maritalStatus;
          delete merged.bio;
          delete merged.nationality;
          delete merged.permanentAddress;
          delete merged.currentAddress;
          delete merged.professionDetail;
          delete merged.rentalPreferences;
          delete merged.household;
          delete merged.references;
          delete merged.emergencyContact;
          delete merged.preferences;
          setTenantProfile(merged);
          setDraftProfile(merged);
        } else {
          const seed = {
            ...DEFAULT_TENANT_PROFILE,
            fullName: localStorage.getItem('userName') || '',
          };
          setTenantProfile(seed);
          setDraftProfile(seed);
        }
      } catch {
        setTenantProfile(DEFAULT_TENANT_PROFILE);
        setDraftProfile(DEFAULT_TENANT_PROFILE);
      }
    };
    loadProfile();
    const onStorage = (e) => { if (!e.key || e.key === TENANT_PROFILE_KEY) loadProfile(); };
    const onCustom = () => loadProfile();
    window.addEventListener('storage', onStorage);
    window.addEventListener(TENANT_PROFILE_EVENT, onCustom);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(TENANT_PROFILE_EVENT, onCustom);
    };
  }, []);

  // Persist + broadcast to other tabs / dashboard subscribers.
  const persistProfile = (next) => {
    setTenantProfile(next);
    try {
      localStorage.setItem(TENANT_PROFILE_KEY, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent(TENANT_PROFILE_EVENT));
    } catch { /* ignore quota errors */ }
  };

  const showProfileToast = (msg) => {
    setProfileToast(msg);
    window.clearTimeout(showProfileToast._t);
    showProfileToast._t = window.setTimeout(() => setProfileToast(null), 2400);
  };

  const beginEditProfile = () => {
    setDraftProfile(tenantProfile);
    setIsEditingProfile(true);
  };

  const cancelEditProfile = () => {
    setDraftProfile(tenantProfile);
    setIsEditingProfile(false);
  };

  const saveProfile = () => {
    if (!draftProfile.fullName?.trim()) {
      showProfileToast(language === 'বাংলা' ? 'নাম আবশ্যক।' : 'Name is required.');
      return;
    }
    persistProfile(draftProfile);
    setIsEditingProfile(false);
    showProfileToast(language === 'বাংলা' ? 'প্রোফাইল সেভ হয়েছে।' : 'Profile saved.');
  };

  // Toggle a single verification document flag. The user's chosen profession
  // also clears step 3 (since the proof type changes when profession changes).
  const toggleVerifDoc = (key, value) => {
    const nextVerif = { ...tenantProfile.verification, [key]: value };
    // Reset "submitted" if they replace a doc after submitting.
    if (nextVerif.submittedForReview && nextVerif.status === 'pending') {
      nextVerif.submittedForReview = false;
      nextVerif.status = 'unverified';
    }
    persistProfile({ ...tenantProfile, verification: nextVerif });
    showProfileToast(value
      ? (language === 'বাংলা' ? 'ডকুমেন্ট আপলোড হয়েছে।' : 'Document uploaded.')
      : (language === 'বাংলা' ? 'ডকুমেন্ট সরানো হয়েছে।' : 'Document removed.'));
  };

  const submitVerification = () => {
    persistProfile({
      ...tenantProfile,
      verification: {
        ...tenantProfile.verification,
        submittedForReview: true,
        status: 'pending',
      },
    });
    showProfileToast(language === 'বাংলা' ? 'রিভিউয়ের জন্য সাবমিট করা হয়েছে।' : 'Submitted for review.');
  };

  const persistReceipts = (next) => {
    setPaymentReceipts(next);
    try {
      localStorage.setItem(PAYMENT_RECEIPTS_KEY, JSON.stringify(next));
    } catch {
      // ignore quota/serialization errors
    }
  };

  const markReceiptRead = (id) => {
    persistReceipts(paymentReceipts.map(r => r.id === id ? { ...r, read: true } : r));
  };

  const markAllReceiptsRead = () => {
    persistReceipts(paymentReceipts.map(r => ({ ...r, read: true })));
  };

  const unreadReceiptsCount = paymentReceipts.filter(r => !r.read).length;

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (notifRef.current && !notifRef.current.contains(event.target)) setIsNotifOpen(false);
      if (langRef.current && !langRef.current.contains(event.target)) setIsLangOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleUnsave = (id) => {
    const updatedSaves = savedProperties.filter(p => String(p.id) !== String(id));
    setSavedProperties(updatedSaves);
    localStorage.setItem('savedProperties', JSON.stringify(updatedSaves));
  };

  const filteredSavedProps = savedProperties.filter(p => 
    p.title?.toLowerCase().includes(searchQuery.toLowerCase()) || 
    p.location?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // 🔴 Updated Language Checks (Using 'বাংলা' and 'English' to match your Navbar)
  const menuItems = [
    { id: 'overview', icon: LayoutDashboard, label: t.overview || (language === 'বাংলা' ? 'ওভারভিউ' : 'Overview') },
    // 🟢 NEW: My Profile — in-dashboard tab (mirrors HostDashboard's Profile tab).
    { id: 'profile', icon: UserCircle, label: t.myProfile || (language === 'বাংলা' ? 'আমার প্রোফাইল' : 'My Profile') },
    { id: 'saved', icon: Heart, label: t.savedProperties || (language === 'বাংলা' ? 'সেভ করা প্রপার্টি' : 'Saved Properties') },
    // 🟢 Renamed from 'My Applications' → 'My Inquiries' to match the actual
    // tenant flow: tenants don't apply, they inquire. Mirrors the host's
    // 'Inquiries' tab so both sides of the conversation use the same word.
    { id: 'applications', icon: MessageCircle, label: language === 'বাংলা' ? 'আমার ইনকোয়ারি' : 'My Inquiries' },
    // 🟢 NEW: Payments tab — receipts pushed by the landlord live here.
    { id: 'payments', icon: Receipt, label: t.payments || (language === 'বাংলা' ? 'পেমেন্ট' : 'Payments'), badge: unreadReceiptsCount },
    { id: 'messages', icon: MessageSquare, label: t.messages || (language === 'বাংলা' ? 'মেসেজ' : 'Messages'), isLink: true, path: '/messages' },
    { id: 'settings', icon: Settings, label: t.accountSettings || (language === 'বাংলা' ? 'অ্যাকাউন্ট সেটিংস' : 'Account Settings') },
    { id: 'support', icon: HelpCircle, label: t.support || (language === 'বাংলা' ? 'হেল্প ও সাপোর্ট' : 'Help & Support') },
  ];

  return (
    // 🟢 SHELL — same architecture as HostDashboard so both portals feel like
    // the same app. Different content, identical skeleton & responsive grid.
    <div className="flex flex-col min-h-screen bg-[#eaeff5] font-sans relative overflow-hidden text-gray-900 selection:bg-[#ba0036] selection:text-white">

      {/* ✨ GLOWING ORBS ✨ — same decorative pattern as HostDashboard */}
      <div className="fixed top-[-20%] left-[-10%] w-[50vw] h-[50vw] bg-gradient-to-br from-[#ba0036]/10 to-transparent rounded-full blur-[120px] pointer-events-none z-0"></div>
      <div className="fixed bottom-[-20%] right-[-10%] w-[50vw] h-[50vw] bg-gradient-to-tl from-blue-600/5 to-transparent rounded-full blur-[120px] pointer-events-none z-0"></div>

      {/* TOP-CENTER TOAST PILL — identical pattern to HostDashboard. */}
      <div className={`fixed top-8 left-1/2 -translate-x-1/2 z-[100] transition-all duration-500 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] ${profileToast ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-10 scale-95 pointer-events-none'}`}>
        <div className="bg-gray-900/90 backdrop-blur-2xl text-white px-5 py-3 rounded-full shadow-[0_20px_40px_rgba(0,0,0,0.2)] border border-white/10 flex items-center gap-3">
          <div className="w-5 h-5 bg-green-500/20 rounded-full flex items-center justify-center">
            <CheckCircle2 size={12} className="text-green-400" />
          </div>
          <span className="text-xs font-bold tracking-wide">{profileToast}</span>
        </div>
      </div>

      {/* --- TOP HEADER — floating glass card identical to HostDashboard --- */}
      <div className="w-full max-w-[1600px] mx-auto z-40 relative">
        <header className="mx-4 md:mx-8 mt-4 bg-white/60 backdrop-blur-3xl border border-white/80 rounded-[2rem] px-4 md:px-8 py-3.5 flex items-center justify-between shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        {/* 🟢 GLOBAL LOGO — exact same block used in Navbar.jsx so the dashboard
            visually matches every other page. */}
        <Link to="/" className="flex items-center gap-2 md:gap-2.5 cursor-pointer group shrink-0 z-10">
          <div className="bg-[#ba0036] p-1.5 md:p-2 rounded-xl shadow-[0_4px_15px_rgba(186,0,54,0.3)] group-hover:scale-105 transition-transform duration-300">
            <Building2 className="text-white w-4 h-4 md:w-[18px] md:h-[18px]" />
          </div>
          <h1 className="font-black text-base md:text-lg lg:text-xl tracking-tighter">
            <span className="text-gray-900">TO-LET</span> <span className="text-[#ba0036]">PRO</span>
          </h1>
        </Link>

        {/* Search — same width / breakpoint as host (lg:flex). */}
        <div className="hidden lg:flex items-center gap-3 bg-white/50 px-5 py-2.5 rounded-2xl border border-white/80 w-full max-w-md focus-within:border-[#ba0036]/30 focus-within:bg-white focus-within:shadow-md transition-all">
          <Search size={16} className="text-gray-400" />
          <input
            type="text"
            placeholder={t.searchPlaceholder || (language === 'বাংলা' ? "সার্চ করুন..." : "Search saved properties, payments...")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent w-full outline-none text-[13px] font-bold text-gray-700 placeholder-gray-400"
          />
        </div>

        <div className="flex items-center gap-3 md:gap-4 z-10">
          {/* Language switcher — same chip style as host. */}
          <div className="relative" ref={langRef}>
            <button onClick={() => setIsLangOpen(!isLangOpen)} className="flex items-center gap-2 px-3 py-2 bg-white/60 rounded-xl hover:bg-white transition-all border border-white/80 shadow-sm group">
              <Globe size={16} className="text-gray-500 group-hover:text-[#ba0036] transition-colors" />
              <span className="md:hidden uppercase text-[10px] font-black text-gray-700">{language === 'বাংলা' ? 'BN' : 'EN'}</span>
              <span className="hidden md:block text-xs font-black text-gray-700">{language === 'বাংলা' ? 'বাংলা' : 'English'}</span>
            </button>
            {isLangOpen && (
              <div className="absolute top-full right-0 mt-3 w-32 bg-white/90 backdrop-blur-2xl border border-white shadow-[0_20px_40px_rgba(0,0,0,0.1)] rounded-2xl p-1.5 z-[100] animate-in fade-in zoom-in-95">
                <button onClick={() => { setLanguage('English'); setIsLangOpen(false); }} className={`w-full text-left px-3 py-2 rounded-xl text-xs font-black transition-colors ${language === 'English' ? 'bg-[#ba0036]/10 text-[#ba0036]' : 'text-gray-600 hover:bg-gray-50'}`}>English</button>
                <button onClick={() => { setLanguage('বাংলা'); setIsLangOpen(false); }} className={`w-full text-left px-3 py-2 rounded-xl text-xs font-black transition-colors ${language === 'বাংলা' ? 'bg-[#ba0036]/10 text-[#ba0036]' : 'text-gray-600 hover:bg-gray-50'}`}>বাংলা</button>
              </div>
            )}
          </div>

          {/* Notifications — host-style chip with ping. */}
          <div className="relative cursor-pointer" ref={notifRef}>
            <button onClick={() => setIsNotifOpen(!isNotifOpen)} className="p-2 bg-white/60 rounded-xl hover:bg-white transition-all border border-white/80 shadow-sm relative group">
              <Bell size={18} className="text-gray-500 group-hover:text-blue-600 transition-colors" />
              <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#ba0036] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#ba0036] border-2 border-white"></span>
              </span>
            </button>
            {isNotifOpen && (
              <div className="absolute top-full right-0 mt-3 w-72 bg-white/95 backdrop-blur-3xl border border-white shadow-[0_30px_60px_rgba(0,0,0,0.12)] rounded-[1.5rem] p-2 z-[100] animate-in fade-in zoom-in-95 origin-top-right">
                <div className="p-3 border-b border-gray-50 flex justify-between items-center">
                  <h3 className="text-[13px] font-black text-gray-900 tracking-tight">{t.notifications || (language === 'বাংলা' ? 'নোটিফিকেশন' : 'Notifications')}</h3>
                  <span className="bg-[#ba0036]/10 text-[#ba0036] px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest">1 {t.new || (language === 'বাংলা' ? 'নতুন' : 'New')}</span>
                </div>
                <div className="p-1.5 space-y-1.5">
                  <div className="p-3 rounded-2xl bg-gray-50 border border-gray-100 cursor-pointer hover:bg-white hover:shadow-sm transition-all group">
                    <p className="text-xs font-bold text-gray-800 leading-tight mb-1.5 group-hover:text-[#ba0036] transition-colors">Your tour request is approved.</p>
                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1"><span className="w-1 h-1 bg-[#ba0036] rounded-full"></span> {t.justNow || (language === 'বাংলা' ? 'এইমাত্র' : 'Just now')}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Avatar — opens right-drawer (replaces dropdown menu). */}
          <button onClick={() => setIsProfileDrawerOpen(true)} className="flex items-center gap-2 p-1 pr-3 bg-white/60 rounded-xl border border-white/80 shadow-sm hover:shadow-md hover:bg-white transition-all active:scale-95">
            <div className="relative">
              <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-sm border border-blue-100">
                {loggedInUser.charAt(0)}
              </div>
              {isVerified && (
                <div className="absolute -bottom-1 -right-1 bg-blue-500 rounded-full border-2 border-white text-white p-[1px] shadow-sm">
                  <BadgeCheck size={12} />
                </div>
              )}
            </div>
            <div className="hidden md:block text-left ml-1">
              <p className="text-xs font-black text-gray-800 leading-none truncate max-w-[80px]">{loggedInUser.split(' ')[0]}</p>
              <p className="text-[9px] font-bold text-blue-500 uppercase tracking-widest mt-0.5">{t.tenantPortal || (language === 'বাংলা' ? 'ভাড়াটিয়া পোর্টাল' : 'Tenant Portal')}</p>
            </div>
          </button>
        </div>
        </header>
      </div>

      {/* 🔵 RIGHT-DRAWER MENU (replaces dropdown) — identical mechanics to host. */}
      {isProfileDrawerOpen && <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[60] animate-in fade-in" onClick={() => setIsProfileDrawerOpen(false)}></div>}
      <div className={`fixed top-0 right-0 h-full w-full max-w-[280px] bg-[#fdfdfd] shadow-2xl z-[70] transform transition-transform duration-500 ease-in-out flex flex-col border-l border-gray-100 ${isProfileDrawerOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        {/* Profile preview at top — tap goes to profile tab */}
        <div className="p-5 pb-3 flex flex-col gap-4 relative">
          <button onClick={() => setIsProfileDrawerOpen(false)} className="absolute top-5 right-5 p-1.5 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors z-10"><X size={18} /></button>
          <div onClick={() => { setActiveTab('profile'); setIsProfileDrawerOpen(false); }} className="flex items-center gap-3 bg-gray-50 hover:bg-[#ba0036]/5 p-3 pr-8 rounded-2xl border border-gray-100 mt-2 cursor-pointer transition-all group">
            <div className="relative shrink-0">
              <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-lg border border-blue-100 group-hover:scale-105 transition-transform">{loggedInUser.charAt(0)}</div>
              {isVerified && <div className="absolute -bottom-1 -right-1 bg-blue-500 rounded-full border-2 border-white text-white p-[1px] shadow-sm"><BadgeCheck size={12} /></div>}
            </div>
            <div>
              <p className="text-[13px] font-black text-gray-900 leading-tight group-hover:text-[#ba0036] transition-colors truncate max-w-[120px]">{loggedInUser}</p>
              <p className="text-[9px] font-bold text-blue-500 uppercase tracking-widest mt-0.5">{t.tenantPortal || (language === 'বাংলা' ? 'ভাড়াটিয়া পোর্টাল' : 'TENANT PORTAL')}</p>
            </div>
          </div>
        </div>

        {/* Primary CTA — tenant equivalent of host's "Add New Listing". */}
        <div className="px-5 pb-2">
          <Link to="/properties/all" className="w-full relative group overflow-hidden bg-gradient-to-r from-[#ba0036] via-[#d11147] to-[#ff4d6d] text-white py-3.5 rounded-xl font-black text-xs shadow-[0_8px_20px_rgba(186,0,54,0.25)] flex items-center justify-center gap-2 hover:shadow-[0_12px_30px_rgba(186,0,54,0.4)] transition-all duration-500">
            <div className="absolute inset-0 bg-white/15 translate-y-full group-hover:translate-y-0 transition-transform duration-500 ease-out"></div>
            <Search size={16} className="relative z-10" />
            <span className="relative z-10 tracking-wide">{t.exploreRentals || (language === 'বাংলা' ? 'প্রপার্টি খুঁজুন' : 'Explore Rentals')}</span>
            <ArrowRight size={14} className="relative z-10 group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>

        {/* Menu items */}
        <nav className="flex-1 px-3 space-y-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {menuItems.map((item) => {
            const isActive = activeTab === item.id && !item.isLink;
            return (
              <button
                key={item.id}
                onClick={() => { if (item.isLink) navigate(item.path); else setActiveTab(item.id); setIsProfileDrawerOpen(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer font-bold text-xs text-left transition-all duration-300 ${isActive ? 'bg-red-50 text-[#ba0036]' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'}`}
              >
                <item.icon size={16} className={isActive ? "text-[#ba0036]" : "text-gray-400"} />
                <span className="flex-1 tracking-wide">{item.label}</span>
                {item.badge ? <span className="bg-[#ba0036] text-white text-[9px] font-black px-2 py-0.5 rounded-full min-w-[18px] text-center">{item.badge}</span> : null}
              </button>
            );
          })}
        </nav>

        {/* Bottom: upgrade + logout — same pattern as host. */}
        <div className="p-5 border-t border-gray-100 bg-gray-50/50 flex flex-col gap-3 mt-auto">
          <button onClick={() => showProfileToast(language === 'বাংলা' ? 'প্রিমিয়ামে আপগ্রেড হচ্ছে...' : 'Redirecting to Premium Upgrade...')} className="w-full bg-[#ba0036] hover:bg-[#90002a] text-white py-3 rounded-xl font-bold shadow-[0_8px_20px_rgba(186,0,54,0.25)] transition-all active:scale-95 text-[11px] tracking-wide uppercase">
            {language === 'বাংলা' ? 'প্রিমিয়ামে আপগ্রেড করুন' : 'Upgrade to Premium'}
          </button>
          <button onClick={() => showProfileToast(language === 'বাংলা' ? 'লগআউট হচ্ছে...' : 'Logging out...')} className="flex items-center justify-center gap-2 text-[#3b2a2a] hover:text-[#ba0036] font-bold transition-colors w-full py-1.5 group">
            <LogOut size={16} className="group-hover:-translate-x-1 transition-transform" />
            <span className="tracking-wider text-[11px] uppercase">{language === 'বাংলা' ? 'লগআউট' : 'Logout'}</span>
          </button>
        </div>
      </div>

      {/* --- MAIN CONTENT AREA — same container width / padding as host.
           Both the page title row and the descriptive subtitle have been
           removed per the user's request: each tab now opens directly
           into its content, no preamble copy at all. --- */}
      <main className="flex-1 w-full max-w-[1600px] mx-auto px-4 md:px-8 lg:px-12 pt-6 md:pt-10 relative z-10 pb-24 selection:bg-[#ba0036]/15 selection:text-[#ba0036]">

        {/* 🔴 TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <>
            {/* 🟢 NEW: Verification nudge — only shown until 100% verified.
                Tracks the same 3 (or 2, for "other") steps as the Profile tab. */}
            {!isVerified && (
              <div className="mb-8 bg-gradient-to-br from-white via-white to-rose-50/40 rounded-[2rem] border border-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.04)] p-6 md:p-8 flex flex-col md:flex-row items-start md:items-center gap-6 relative overflow-hidden">
                <div className="absolute -top-12 -right-12 w-48 h-48 bg-[#ba0036]/10 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute -bottom-16 -left-16 w-40 h-40 bg-orange-200/30 rounded-full blur-3xl pointer-events-none" />
                <div className={`relative z-10 w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 shadow-md ${
                  verifPending
                    ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white'
                    : 'bg-gradient-to-br from-[#ba0036] to-rose-500 text-white'
                }`}>
                  {verifPending ? <Hourglass size={26} strokeWidth={2.25} /> : <ShieldAlert size={26} strokeWidth={2.25} />}
                  {verifPending && (
                    <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-amber-400 border-2 border-white animate-pulse" />
                  )}
                </div>
                <div className="flex-1 relative z-10 w-full">
                  <p className="text-[10px] font-black text-[#ba0036] uppercase tracking-widest mb-1">
                    {language === 'বাংলা' ? 'আইডেন্টিটি ভেরিফিকেশন' : 'Identity Verification'}
                  </p>
                  <h3 className="text-lg md:text-xl font-black text-gray-900 mb-2">
                    {verifPending
                      ? (language === 'বাংলা' ? 'রিভিউয়ের জন্য সাবমিট হয়েছে' : 'Submitted for review')
                      : verifDone === 0
                        ? (language === 'বাংলা' ? 'আপনার অ্যাকাউন্ট ভেরিফাই করুন' : 'Verify your account')
                        : (language === 'বাংলা' ? `${verifDone}/${verifTotal} স্টেপ সম্পূর্ণ` : `${verifDone} of ${verifTotal} steps complete`)}
                  </h3>
                  <p className="text-xs md:text-sm font-bold text-gray-500 mb-3 leading-relaxed">
                    {verifPending
                      ? (language === 'বাংলা' ? 'আমরা আপনার ডকুমেন্ট যাচাই করছি। সাধারণত ২৪ ঘণ্টার মধ্যে শেষ হয়।' : 'We\u2019re reviewing your documents. Usually done within 24 hours.')
                      : (language === 'বাংলা' ? 'ভেরিফাইড ভাড়াটিয়ারা বাড়িওয়ালার কাছ থেকে দ্রুত অ্যাপ্রুভাল পান। নিচের ছোট স্টেপস শেষ করুন।' : 'Verified tenants get faster landlord approvals. Finish a few quick steps below.')}
                  </p>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 max-w-md h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[#ba0036] via-rose-500 to-[#ff4d6d] rounded-full transition-[width] duration-700 shadow-[0_0_8px_rgba(186,0,54,0.4)]"
                        style={{ width: `${verifPct}%` }}
                      />
                    </div>
                    <span className="text-[11px] font-black text-gray-700 tabular-nums shrink-0">{verifPct}%</span>
                  </div>
                </div>
                <button
                  onClick={() => setActiveTab('profile')}
                  className="shrink-0 px-5 py-3.5 bg-gradient-to-r from-[#ba0036] to-[#d11147] hover:from-[#90002a] hover:to-[#ba0036] text-white rounded-xl font-black text-xs shadow-[0_8px_20px_rgba(186,0,54,0.25)] hover:shadow-[0_12px_30px_rgba(186,0,54,0.4)] transition-all flex items-center gap-2 relative z-10 whitespace-nowrap group"
                >
                  {verifPending
                    ? (language === 'বাংলা' ? 'ডকুমেন্ট দেখুন' : 'Review documents')
                    : verifDone === 0
                      ? (language === 'বাংলা' ? 'শুরু করুন' : 'Get verified')
                      : (language === 'বাংলা' ? 'চালিয়ে যান' : 'Continue')}
                  <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                </button>
              </div>
            )}

            {/* 🟢 STATS BENTO — premium feel: subtle white→tinted gradient,
                large hover glow orb, "View →" affordance on hover so the user
                feels invited to drill in. Same 3-col responsive structure. */}
            <div className="grid grid-cols-3 gap-3 md:gap-5 mb-8 md:mb-10">
              {[
                {
                  icon: Heart,
                  cardGradient: 'bg-gradient-to-br from-white via-white to-rose-50/50',
                  bg: 'bg-gradient-to-br from-red-50 to-rose-100/60',
                  iconColor: 'text-[#ba0036]',
                  label: language === 'বাংলা' ? 'সেভ করা' : 'SAVED',
                  value: savedProperties.length,
                  shadow: 'shadow-[0_4px_20px_rgba(186,0,54,0.08)]',
                  hoverShadow: 'group-hover:shadow-[0_12px_40px_rgba(186,0,54,0.18)]',
                  indicator: 'bg-[#ba0036]',
                  onClick: () => setActiveTab('saved'),
                },
                {
                  icon: MessageCircle,
                  cardGradient: 'bg-gradient-to-br from-white via-white to-emerald-50/50',
                  bg: 'bg-gradient-to-br from-emerald-50 to-green-100/60',
                  iconColor: 'text-emerald-600',
                  label: language === 'বাংলা' ? 'ইনকোয়ারি' : 'INQUIRIES',
                  value: 2,
                  shadow: 'shadow-[0_4px_20px_rgba(16,185,129,0.08)]',
                  hoverShadow: 'group-hover:shadow-[0_12px_40px_rgba(16,185,129,0.18)]',
                  indicator: 'bg-emerald-500',
                  onClick: () => setActiveTab('applications'),
                },
                {
                  icon: Receipt,
                  cardGradient: 'bg-gradient-to-br from-white via-white to-violet-50/50',
                  bg: 'bg-gradient-to-br from-violet-50 to-purple-100/60',
                  iconColor: 'text-violet-600',
                  label: language === 'বাংলা' ? 'পেমেন্ট' : 'PAYMENTS',
                  value: paymentReceipts.length,
                  shadow: 'shadow-[0_4px_20px_rgba(124,58,237,0.08)]',
                  hoverShadow: 'group-hover:shadow-[0_12px_40px_rgba(124,58,237,0.18)]',
                  indicator: 'bg-violet-500',
                  badge: unreadReceiptsCount > 0 ? unreadReceiptsCount : null,
                  onClick: () => setActiveTab('payments'),
                },
              ].map((stat, i) => (
                <button
                  key={i}
                  onClick={stat.onClick}
                  className={`relative text-left ${stat.cardGradient} p-3 md:p-7 rounded-2xl md:rounded-[1.5rem] ${stat.shadow} ${stat.hoverShadow} border border-white/80 flex flex-col items-center md:items-start justify-center group hover:-translate-y-1 transition-all duration-300 overflow-hidden`}
                >
                  {/* Big blurred halo orb (top-right) — softens on hover for the glow effect */}
                  <div className={`absolute top-0 right-0 w-20 h-20 md:w-32 md:h-32 rounded-full -translate-y-1/3 translate-x-1/3 ${stat.bg} blur-3xl opacity-50 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none`}></div>
                  {/* Tiny "View" affordance on hover (md+) */}
                  <span className="hidden md:flex absolute top-4 right-4 items-center gap-1 text-[10px] font-black text-gray-400 group-hover:text-[#ba0036] opacity-0 group-hover:opacity-100 translate-x-2 group-hover:translate-x-0 transition-all">
                    {language === 'বাংলা' ? 'দেখুন' : 'View'} <ArrowRight size={10} />
                  </span>
                  <div className={`relative z-10 w-9 h-9 md:w-12 md:h-12 rounded-2xl ${stat.bg} flex items-center justify-center ${stat.iconColor} mb-2 md:mb-3 shrink-0 shadow-sm group-hover:scale-110 transition-transform duration-300`}>
                    <stat.icon size={16} className="md:w-[22px] md:h-[22px]" strokeWidth={2.25} />
                  </div>
                  <p className="relative z-10 text-[7px] md:text-[10px] font-black text-gray-400 uppercase tracking-widest text-center md:text-left leading-tight">{stat.label}</p>
                  <div className="relative z-10 flex items-end gap-1.5">
                    <h3 className="text-3xl md:text-[3.25rem] font-black text-gray-900 leading-none mt-0.5 md:mt-1 tabular-nums tracking-tight">{stat.value}</h3>
                    {stat.badge ? (
                      <span className="inline-flex items-center gap-1 bg-[#ba0036] text-white text-[8px] md:text-[10px] font-black px-1.5 md:px-2 py-0.5 rounded-full mb-1 md:mb-2 shadow-md">
                        <span className="w-1 h-1 bg-white rounded-full animate-pulse"></span>
                        {stat.badge} {language === 'বাংলা' ? 'নতুন' : 'NEW'}
                      </span>
                    ) : null}
                  </div>
                  <div className={`relative z-10 h-1 rounded-full mt-2 md:mt-3 ${stat.indicator} opacity-40 group-hover:opacity-80 transition-all duration-300 w-6 group-hover:w-12`}></div>
                </button>
              ))}
            </div>

            {/* 🟢 SEARCH SHORTCUT — fast path back to property browsing.
                Quick chips show popular Dhaka areas so a returning tenant can
                jump back into search in one click. */}
            <div className="mb-8 md:mb-10 bg-white/80 backdrop-blur-xl rounded-[2rem] border border-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.03)] p-6 md:p-8 relative overflow-hidden">
              <div className="absolute -top-16 -left-16 w-56 h-56 bg-[#ba0036]/8 rounded-full blur-3xl pointer-events-none" />
              <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-5 mb-5">
                <div>
                  <p className="text-[10px] font-black text-[#ba0036] uppercase tracking-widest mb-1">
                    {language === 'বাংলা' ? 'কুইক সার্চ' : 'Quick Search'}
                  </p>
                  <h3 className="text-xl md:text-2xl font-black text-gray-900">
                    {language === 'বাংলা' ? 'আপনার পরবর্তী বাড়ি খুঁজুন' : 'Find your next home'}
                  </h3>
                </div>
                <Link
                  to="/properties/all"
                  className="inline-flex items-center gap-2 px-5 py-3 bg-[#ba0036] hover:bg-[#90002a] text-white rounded-xl font-black text-xs shadow-md transition-all whitespace-nowrap self-start"
                >
                  <Search size={14} /> {language === 'বাংলা' ? 'সব প্রপার্টি দেখুন' : 'Browse all properties'} <ArrowRight size={14} />
                </Link>
              </div>
              <div className="relative z-10 flex flex-wrap gap-2">
                {[
                  { en: 'Dhanmondi',   bn: 'ধানমন্ডি',     query: 'dhanmondi' },
                  { en: 'Gulshan',     bn: 'গুলশান',       query: 'gulshan' },
                  { en: 'Banani',      bn: 'বনানী',         query: 'banani' },
                  { en: 'Mohammadpur', bn: 'মোহাম্মদপুর', query: 'mohammadpur' },
                  { en: 'Mirpur',      bn: 'মিরপুর',       query: 'mirpur' },
                  { en: 'Uttara',      bn: 'উত্তরা',       query: 'uttara' },
                ].map((area) => (
                  <Link
                    key={area.query}
                    to={`/properties/all?location=${area.query}`}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-gray-50 hover:bg-[#ba0036]/10 hover:text-[#ba0036] text-gray-700 border border-gray-200 hover:border-[#ba0036]/30 text-xs font-black transition-all"
                  >
                    <MapPin size={11} /> {language === 'বাংলা' ? area.bn : area.en}
                  </Link>
                ))}
              </div>
            </div>

            {/* 🟢 TRUST SCORE PEEK — slim cross-tab visibility of the score so
                a tenant doesn't have to dig into the Profile tab to know how
                "trustable" they look to landlords. Hidden at 0 to avoid noise. */}
            {trustScore.score > 0 && (
              <button
                onClick={() => setActiveTab('profile')}
                className="w-full text-left mb-8 md:mb-10 bg-gradient-to-br from-white to-blue-50/40 rounded-[2rem] border border-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.03)] p-5 md:p-6 flex items-center gap-5 hover:shadow-md hover:border-blue-100 transition-all group relative overflow-hidden"
              >
                <div className="absolute -bottom-8 -right-8 w-32 h-32 bg-blue-200/30 rounded-full blur-3xl pointer-events-none" />
                <div className="relative z-10 w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center shrink-0">
                  <ShieldCheck className="text-blue-600" size={26} />
                </div>
                <div className="relative z-10 flex-1 min-w-0">
                  <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-1">
                    {language === 'বাংলা' ? 'ট্রাস্ট স্কোর' : 'Trust Score'}
                  </p>
                  <p className="text-base md:text-lg font-black text-gray-900 leading-tight">
                    <span className="text-2xl md:text-3xl">{trustScore.score}</span>
                    <span className="text-gray-400 font-bold text-sm md:text-base"> /100</span>
                    <span className="ml-3 capitalize text-blue-700">{trustScore.tier}</span>
                  </p>
                  <p className="text-[11px] font-bold text-gray-500 mt-0.5">
                    {language === 'বাংলা' ? 'বাড়িওয়ালারা এই স্কোর দেখেন। উন্নত করতে প্রোফাইলে যান।' : 'Landlords see this score — open profile to improve it.'}
                  </p>
                </div>
                <ArrowRight className="relative z-10 shrink-0 text-gray-300 group-hover:text-[#ba0036] group-hover:translate-x-1 transition-all" size={20} />
              </button>
            )}

            {/* Upcoming Tours Section — futuristic refresh:
                gradient date tile, glow halo, time chip, multiple actions. */}
            <div className="relative bg-gradient-to-br from-white via-white to-rose-50/30 backdrop-blur-xl p-6 md:p-8 lg:p-10 rounded-[2rem] md:rounded-[2.5rem] border border-gray-100 shadow-[0_20px_60px_rgba(0,0,0,0.05)] overflow-hidden">
              {/* Soft brand-tinted halo */}
              <div className="absolute -top-24 -left-24 w-72 h-72 bg-[#ba0036]/8 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute -bottom-32 -right-32 w-80 h-80 bg-amber-200/20 rounded-full blur-3xl pointer-events-none" />

              <div className="relative z-10 flex items-center justify-between mb-6 md:mb-8">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#ba0036] to-rose-500 text-white flex items-center justify-center shadow-md">
                    <Calendar size={18} strokeWidth={2.5} />
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-[#ba0036] uppercase tracking-[0.18em]">
                      {language === 'বাংলা' ? 'ভিজিট সিডিউল' : 'TOUR SCHEDULE'}
                    </p>
                    <h3 className="text-lg md:text-xl font-black text-gray-900 leading-tight">
                      {t.upcomingTours || (language === 'বাংলা' ? 'আসন্ন ট্যুর' : 'Upcoming Tours')}
                    </h3>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-black uppercase tracking-widest border border-emerald-100">
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                  {language === 'বাংলা' ? 'এই সপ্তাহে' : 'This week'}
                </span>
              </div>

              <div className="relative z-10 group flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 md:gap-6 p-5 md:p-6 bg-white/80 backdrop-blur-sm border border-gray-100 rounded-2xl md:rounded-3xl hover:border-[#ba0036]/30 hover:shadow-[0_10px_30px_rgba(186,0,54,0.08)] hover:-translate-y-0.5 transition-all duration-300">
                {/* Left: gradient date tile + property + time chip */}
                <div className="flex items-center gap-4 md:gap-5 w-full min-w-0">
                  <div className="relative shrink-0">
                    <div className="bg-gradient-to-br from-[#ba0036] via-rose-500 to-orange-500 text-center p-3 md:p-4 rounded-2xl shadow-[0_8px_20px_rgba(186,0,54,0.25)] min-w-[68px] md:min-w-[80px]">
                      <p className="text-[9px] md:text-[10px] font-black text-white/90 uppercase tracking-[0.18em]">OCT</p>
                      <p className="text-2xl md:text-3xl font-black text-white leading-none mt-0.5 tabular-nums">25</p>
                      <p className="text-[8px] md:text-[9px] font-black text-white/80 uppercase tracking-widest mt-0.5">SUN</p>
                    </div>
                    {/* Pulse dot */}
                    <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 border-2 border-white shadow animate-pulse" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="text-base md:text-lg font-black text-gray-900 mb-1.5 truncate">
                      Elegant 3BHK with Skyline View
                    </h4>
                    <div className="flex flex-wrap items-center gap-2 md:gap-3 text-[11px] md:text-xs font-bold text-gray-500">
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin size={12} className="text-gray-400" /> Gulshan 2, Dhaka
                      </span>
                      <span className="hidden md:inline text-gray-300">·</span>
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                        <Clock size={10} /> 5:00 PM
                      </span>
                    </div>
                  </div>
                </div>
                {/* Right: dual actions */}
                <div className="flex items-stretch gap-2 shrink-0 w-full md:w-auto">
                  <button
                    onClick={() => navigate('/messages')}
                    className="flex-1 md:flex-none px-4 md:px-5 py-3 bg-white text-[#ba0036] border border-[#ba0036]/20 rounded-xl font-black text-xs hover:bg-[#ba0036] hover:text-white hover:border-[#ba0036] transition-all whitespace-nowrap flex items-center justify-center gap-1.5"
                  >
                    <MessageSquare size={14} /> {t.contactHost || (language === 'বাংলা' ? 'যোগাযোগ' : 'Contact')}
                  </button>
                  <button
                    onClick={() => showProfileToast(language === 'বাংলা' ? 'রিশিডিউল ফিচার শীঘ্রই আসছে।' : 'Reschedule coming soon.')}
                    className="hidden md:inline-flex px-4 py-3 bg-gray-50 text-gray-600 hover:bg-gray-100 rounded-xl font-black text-xs whitespace-nowrap items-center justify-center gap-1.5 transition-all"
                  >
                    <Edit3 size={13} /> {language === 'বাংলা' ? 'বদলান' : 'Reschedule'}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* 🟢 NEW TAB: MY PROFILE — bare-minimum personal info + optional, stepped
            identity verification. Mirrors HostDashboard's profile pattern so
            tenants and hosts share the same mental model. */}
        {activeTab === 'profile' && (
          // 🟢 PROFILE TAB — same xl:grid-cols-3 architecture as HostDashboard's
          // profile tab: 2-col main content (header + personal info + verification)
          // + 1-col sidebar (verification timeline). Identical breakpoints / gaps.
          <div className="w-full mb-10 animate-in fade-in zoom-in-95 duration-500">
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 md:gap-8">

              {/* === LEFT (2 cols on xl): Header + Personal Info + Verification Center === */}
              <div className="xl:col-span-2 space-y-6 md:space-y-8">
            {/* === HEADER CARD ====================================== */}
            <div className="relative bg-gradient-to-br from-white to-gray-50/50 rounded-[2rem] border border-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.04)] p-6 md:p-8 overflow-hidden">
              {/* Subtle red glow that hints at brand presence */}
              <div className="absolute -top-20 -left-20 w-56 h-56 bg-[#ba0036]/8 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-blue-200/30 rounded-full blur-3xl pointer-events-none" />
              <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center gap-6">
                {/* Avatar wrapped in a tier-aware gradient ring */}
                <div className="relative shrink-0">
                  <div className={`p-1 rounded-[1.75rem] bg-gradient-to-br ${
                    trustScore.tier === 'platinum' ? 'from-blue-400 via-cyan-400 to-blue-500' :
                    trustScore.tier === 'gold'     ? 'from-yellow-400 via-amber-400 to-orange-400' :
                    trustScore.tier === 'silver'   ? 'from-gray-300 via-gray-200 to-gray-400' :
                                                     'from-[#ba0036] via-rose-400 to-amber-300'
                  } shadow-lg`}>
                    <div className="w-20 h-20 md:w-24 md:h-24 rounded-[1.5rem] bg-white flex items-center justify-center">
                      <span className="font-black text-3xl md:text-4xl bg-gradient-to-br from-gray-800 to-gray-500 bg-clip-text text-transparent">
                        {(tenantProfile.fullName || 'T').charAt(0).toUpperCase()}
                      </span>
                    </div>
                  </div>
                  {isVerified && (
                    <div className="absolute -bottom-1 -right-1 bg-blue-500 rounded-full border-4 border-white text-white p-1 shadow-md">
                      <BadgeCheck size={18} />
                    </div>
                  )}
                  {verifPending && (
                    <div className="absolute -bottom-1 -right-1 bg-amber-500 rounded-full border-4 border-white text-white p-1 shadow-md">
                      <Hourglass size={16} />
                    </div>
                  )}
                </div>

                {/* Name + meta */}
                <div className="flex-1 w-full">
                  <div className="flex items-center gap-3 flex-wrap mb-1">
                    <h3 className="text-2xl md:text-3xl font-black text-gray-900">
                      {tenantProfile.fullName || (language === 'বাংলা' ? 'নাম যোগ করুন' : 'Add your name')}
                    </h3>
                    {isVerified && (
                      <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border border-blue-100">
                        <BadgeCheck size={12} /> {language === 'বাংলা' ? 'ভেরিফাইড' : 'Verified'}
                      </span>
                    )}
                    {verifPending && (
                      <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border border-amber-100">
                        <Hourglass size={12} /> {language === 'বাংলা' ? 'রিভিউ চলছে' : 'Under Review'}
                      </span>
                    )}
                    {!isVerified && !verifPending && (
                      <span className="inline-flex items-center gap-1 bg-gray-50 text-gray-600 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border border-gray-200">
                        <ShieldAlert size={12} /> {language === 'বাংলা' ? 'অভেরিফাইড' : 'Unverified'}
                      </span>
                    )}
                    {/* Trust tier pill — visible right alongside the verified pill. */}
                    {trustScore.score > 0 && (() => {
                      const tierMeta = {
                        bronze:   { cls: 'bg-amber-50 text-amber-700 border-amber-100',   en: 'Bronze',   bn: 'ব্রোঞ্জ' },
                        silver:   { cls: 'bg-gray-50 text-gray-700 border-gray-200',       en: 'Silver',   bn: 'সিলভার' },
                        gold:     { cls: 'bg-yellow-50 text-yellow-700 border-yellow-200', en: 'Gold',     bn: 'গোল্ড' },
                        platinum: { cls: 'bg-blue-50 text-blue-700 border-blue-100',       en: 'Platinum', bn: 'প্ল্যাটিনাম' },
                      }[trustScore.tier];
                      return (
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${tierMeta.cls}`}>
                          <ShieldCheck size={12} /> {language === 'বাংলা' ? tierMeta.bn : tierMeta.en}
                          <span className="opacity-60 normal-case tracking-normal text-[9px]">· {trustScore.score}/100</span>
                        </span>
                      );
                    })()}
                  </div>
                  <p className="text-sm font-bold text-gray-500 flex items-center gap-2 mb-3">
                    <Phone size={14} className="text-gray-400" />
                    {tenantProfile.phone || (language === 'বাংলা' ? 'সাইন-আপের সময় ফোন ভেরিফাই করা হয়েছিল' : 'Phone verified at signup')}
                  </p>
                  {/* Verification mini-progress */}
                  <div className="flex items-center gap-3">
                    <div className="flex-1 max-w-[280px] h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[#ba0036] to-[#ff4d6d] rounded-full transition-[width] duration-500"
                        style={{ width: `${verifPct}%` }}
                      />
                    </div>
                    <span className="text-xs font-black text-gray-700">
                      {verifDone}/{verifTotal} {language === 'বাংলা' ? 'স্টেপ' : 'steps'}
                    </span>
                  </div>
                </div>

                {/* Edit / Save / Cancel */}
                <div className="flex gap-2 shrink-0">
                  {!isEditingProfile ? (
                    <button
                      onClick={beginEditProfile}
                      className="px-5 py-3 bg-[#ba0036] hover:bg-[#90002a] text-white rounded-xl font-black text-xs shadow-md transition-all flex items-center gap-2"
                    >
                      <Edit3 size={14} /> {language === 'বাংলা' ? 'এডিট করুন' : 'Edit'}
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={cancelEditProfile}
                        className="px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-black text-xs transition-all flex items-center gap-2"
                      >
                        <X size={14} /> {language === 'বাংলা' ? 'বাতিল' : 'Cancel'}
                      </button>
                      <button
                        onClick={saveProfile}
                        className="px-5 py-3 bg-[#ba0036] hover:bg-[#90002a] text-white rounded-xl font-black text-xs shadow-md transition-all flex items-center gap-2"
                      >
                        <Check size={14} /> {language === 'বাংলা' ? 'সেভ' : 'Save'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* === PERSONAL INFO ==================================== */}
            <div className="bg-white rounded-[2rem] border border-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.04)] p-6 md:p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-[#ba0036]/10 flex items-center justify-center">
                  <User className="text-[#ba0036]" size={18} />
                </div>
                <div>
                  <h3 className="text-base md:text-lg font-black text-gray-900">
                    {language === 'বাংলা' ? 'ব্যক্তিগত তথ্য' : 'Personal Information'}
                  </h3>
                  <p className="text-xs font-bold text-gray-500">
                    {language === 'বাংলা' ? 'বাড়িওয়ালারা ইনকোয়ারির সময় এই তথ্য দেখেন।' : 'Landlords see this with every inquiry you send.'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Full name */}
                <div>
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                    <User size={11} /> {language === 'বাংলা' ? 'পূর্ণ নাম' : 'Full Name'}
                    <span className="text-[#ba0036]">*</span>
                  </label>
                  {isEditingProfile ? (
                    <input
                      type="text"
                      value={draftProfile.fullName}
                      onChange={(e) => setDraftProfile({ ...draftProfile, fullName: e.target.value })}
                      placeholder={language === 'বাংলা' ? 'যেমন: রাহিম আহমেদ' : 'e.g. Rahim Ahmed'}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-sm text-gray-900 focus:outline-none focus:border-[#ba0036] focus:bg-white transition-colors"
                    />
                  ) : (
                    <p className="px-4 py-3 bg-gray-50/50 border border-gray-100 rounded-xl font-bold text-sm text-gray-900">
                      {tenantProfile.fullName || <span className="text-gray-400">—</span>}
                    </p>
                  )}
                </div>

                {/* Phone — locked, OTP-verified at signup */}
                <div>
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                    <Phone size={11} /> {language === 'বাংলা' ? 'ফোন নম্বর' : 'Phone Number'}
                    <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full text-[9px] ml-1">
                      <BadgeCheck size={9} /> {language === 'বাংলা' ? 'ভেরিফাইড' : 'OTP Verified'}
                    </span>
                  </label>
                  <p className="px-4 py-3 bg-gray-50/50 border border-gray-100 rounded-xl font-bold text-sm text-gray-900 flex items-center justify-between">
                    {tenantProfile.phone || <span className="text-gray-400">—</span>}
                    <Shield size={14} className="text-blue-500" />
                  </p>
                </div>

                {/* Email — optional */}
                <div>
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                    <Mail size={11} /> {language === 'বাংলা' ? 'ইমেইল' : 'Email'}
                    <span className="text-gray-400 font-bold normal-case tracking-normal">({language === 'বাংলা' ? 'ঐচ্ছিক' : 'optional'})</span>
                  </label>
                  {isEditingProfile ? (
                    <input
                      type="email"
                      value={draftProfile.email}
                      onChange={(e) => setDraftProfile({ ...draftProfile, email: e.target.value })}
                      placeholder="rahim@example.com"
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-sm text-gray-900 focus:outline-none focus:border-[#ba0036] focus:bg-white transition-colors"
                    />
                  ) : (
                    <p className="px-4 py-3 bg-gray-50/50 border border-gray-100 rounded-xl font-bold text-sm text-gray-900">
                      {tenantProfile.email || <span className="text-gray-400">—</span>}
                    </p>
                  )}
                </div>

                {/* DOB — optional */}
                <div>
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                    {language === 'বাংলা' ? 'জন্ম তারিখ' : 'Date of Birth'}
                    <span className="text-gray-400 font-bold normal-case tracking-normal">({language === 'বাংলা' ? 'ঐচ্ছিক' : 'optional'})</span>
                  </label>
                  {isEditingProfile ? (
                    <input
                      type="date"
                      value={draftProfile.dateOfBirth}
                      onChange={(e) => setDraftProfile({ ...draftProfile, dateOfBirth: e.target.value })}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-sm text-gray-900 focus:outline-none focus:border-[#ba0036] focus:bg-white transition-colors"
                    />
                  ) : (
                    <p className="px-4 py-3 bg-gray-50/50 border border-gray-100 rounded-xl font-bold text-sm text-gray-900">
                      {tenantProfile.dateOfBirth || <span className="text-gray-400">—</span>}
                    </p>
                  )}
                </div>

              </div>

              {/* Profession picker — drives step 3 of verification */}
              <div className="mt-6 pt-6 border-t border-gray-100">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <Briefcase size={11} /> {language === 'বাংলা' ? 'আপনি কী করেন?' : 'What do you do?'}
                </label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {[
                    { id: 'student', icon: GraduationCap, en: 'Student', bn: 'ছাত্র/ছাত্রী' },
                    { id: 'employed', icon: Briefcase, en: 'Employed', bn: 'চাকরিজীবী' },
                    { id: 'self-employed', icon: Building, en: 'Self-Employed', bn: 'ব্যবসায়ী' },
                    { id: 'other', icon: User, en: 'Other', bn: 'অন্যান্য' },
                  ].map((opt) => {
                    const Icon = opt.icon;
                    const active = (isEditingProfile ? draftProfile.professionType : tenantProfile.professionType) === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={!isEditingProfile}
                        onClick={() => setDraftProfile({ ...draftProfile, professionType: opt.id })}
                        className={`flex items-center gap-2 px-3 py-3 rounded-xl border text-xs font-black transition-all ${
                          active
                            ? 'bg-[#ba0036] text-white border-[#ba0036] shadow-sm'
                            : 'bg-gray-50 text-gray-700 border-gray-200 hover:border-gray-300'
                        } ${!isEditingProfile ? 'cursor-default' : 'cursor-pointer'}`}
                      >
                        <Icon size={14} />
                        <span>{language === 'বাংলা' ? opt.bn : opt.en}</span>
                      </button>
                    );
                  })}
                </div>

                <p className="text-[10px] font-bold text-gray-400 mt-3 leading-relaxed">
                  {language === 'বাংলা' ? 'নিচের "পেশা ও আয়" সেকশনে বিস্তারিত যোগ করুন (ঐচ্ছিক)।' : 'Add full details in the "Profession & Income" section below (optional).'}
                </p>
              </div>
            </div>

            {/* === VERIFICATION CENTER ============================== */}
            <div className="bg-white rounded-[2rem] border border-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.04)] p-6 md:p-8">
              <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                    <ShieldCheck className="text-blue-600" size={18} />
                  </div>
                  <div>
                    <h3 className="text-base md:text-lg font-black text-gray-900">
                      {language === 'বাংলা' ? 'ভেরিফিকেশন সেন্টার' : 'Verification Center'}
                    </h3>
                    <p className="text-xs font-bold text-gray-500">
                      {language === 'বাংলা' ? 'ঐচ্ছিক — কিন্তু ভেরিফাইড হলে দ্রুত অ্যাপ্রুভাল পাবেন।' : 'Optional — but verified tenants get faster approvals.'}
                    </p>
                  </div>
                </div>
                <div className="text-xs font-black text-gray-700">
                  {verifDone}/{verifTotal} {language === 'বাংলা' ? 'স্টেপ সম্পূর্ণ' : 'steps complete'}
                </div>
              </div>

              {/* Step list */}
              <div className="space-y-4">
                {/* STEP 1 — Photo */}
                <VerifStep
                  index={1}
                  done={tenantProfile.verification.photo}
                  icon={Camera}
                  titleEn="Profile Photo"
                  titleBn="প্রোফাইল ছবি"
                  descEn="A clear selfie or portrait. Helps landlords recognise you on visit."
                  descBn="একটি স্পষ্ট সেলফি/ছবি। পরিদর্শনের সময় বাড়িওয়ালা আপনাকে চিনতে পারবেন।"
                  language={language}
                  onUpload={() => toggleVerifDoc('photo', true)}
                  onRemove={() => toggleVerifDoc('photo', false)}
                />

                {/* STEP 2 — NID */}
                <VerifStep
                  index={2}
                  done={tenantProfile.verification.nidFront && tenantProfile.verification.nidBack}
                  icon={ScanFace}
                  titleEn="National ID (front + back)"
                  titleBn="জাতীয় পরিচয়পত্র (সামনে + পিছনে)"
                  descEn="Upload both sides of your NID. We never share this with landlords."
                  descBn="আপনার NID-এর উভয় পাশ আপলোড করুন। বাড়িওয়ালার সাথে শেয়ার করা হবে না।"
                  language={language}
                  multi
                  multiState={[
                    { key: 'nidFront', labelEn: 'NID Front', labelBn: 'NID সামনে', done: tenantProfile.verification.nidFront },
                    { key: 'nidBack', labelEn: 'NID Back', labelBn: 'NID পিছনে', done: tenantProfile.verification.nidBack },
                  ]}
                  onMultiToggle={(key, val) => toggleVerifDoc(key, val)}
                />

                {/* STEP 3 — Profession Proof (conditional) */}
                {tenantProfile.professionType === '' ? (
                  <div className="border-2 border-dashed border-gray-200 rounded-2xl p-5 text-center">
                    <AlertCircle className="text-gray-400 mx-auto mb-2" size={20} />
                    <p className="text-xs font-bold text-gray-500">
                      {language === 'বাংলা' ? 'উপরে আপনার পেশা সিলেক্ট করলে এখানে স্টেপ ৩ আসবে।' : 'Pick a profession above to unlock step 3.'}
                    </p>
                  </div>
                ) : tenantProfile.professionType === 'other' ? (
                  <div className="border-2 border-dashed border-gray-200 rounded-2xl p-5 text-center">
                    <Check className="text-green-500 mx-auto mb-2" size={20} />
                    <p className="text-xs font-bold text-gray-500">
                      {language === 'বাংলা' ? '"অন্যান্য" সিলেক্ট করায় স্টেপ ৩ স্কিপ করা হয়েছে।' : 'Step 3 is skipped because you picked "Other".'}
                    </p>
                  </div>
                ) : (
                  <VerifStep
                    index={3}
                    done={tenantProfile.verification.professionProof}
                    icon={
                      tenantProfile.professionType === 'student' ? GraduationCap :
                      tenantProfile.professionType === 'self-employed' ? Building :
                      Briefcase
                    }
                    titleEn={
                      tenantProfile.professionType === 'student'
                        ? 'Student ID / Proof of Studentship'
                        : tenantProfile.professionType === 'self-employed'
                          ? 'Trade License / Business Document'
                          : 'Employment Proof'
                    }
                    titleBn={
                      tenantProfile.professionType === 'student'
                        ? 'ছাত্র পরিচয়পত্র / শিক্ষার্থী প্রমাণ'
                        : tenantProfile.professionType === 'self-employed'
                          ? 'ট্রেড লাইসেন্স / বিজনেস ডকুমেন্ট'
                          : 'চাকরির প্রমাণ'
                    }
                    descEn={
                      tenantProfile.professionType === 'student'
                        ? 'Student card, admission letter, or testimonial from your institution.'
                        : tenantProfile.professionType === 'self-employed'
                          ? 'Trade license, TIN certificate, or business registration document.'
                          : 'Company ID, offer letter, or recent salary slip.'
                    }
                    descBn={
                      tenantProfile.professionType === 'student'
                        ? 'স্টুডেন্ট কার্ড, ভর্তি পত্র, বা প্রতিষ্ঠানের প্রত্যয়ন।'
                        : tenantProfile.professionType === 'self-employed'
                          ? 'ট্রেড লাইসেন্স, TIN সার্টিফিকেট, বা বিজনেস রেজিস্ট্রেশন।'
                          : 'কোম্পানি আইডি, অফার লেটার, বা স্যালারি স্লিপ।'
                    }
                    language={language}
                    onUpload={() => toggleVerifDoc('professionProof', true)}
                    onRemove={() => toggleVerifDoc('professionProof', false)}
                  />
                )}

              </div>

              {/* Submit-for-review CTA */}
              {verifDone === verifTotal && !tenantProfile.verification.submittedForReview && tenantProfile.verification.status === 'unverified' && (
                <div className="mt-6 pt-6 border-t border-gray-100 flex flex-col md:flex-row items-start md:items-center gap-4 bg-blue-50/50 -mx-6 md:-mx-8 -mb-6 md:-mb-8 px-6 md:px-8 py-5 rounded-b-[2rem]">
                  <div className="flex-1">
                    <p className="text-sm font-black text-gray-900 mb-1">
                      {language === 'বাংলা' ? 'সব ডকুমেন্ট আপলোড সম্পূর্ণ!' : 'All documents uploaded!'}
                    </p>
                    <p className="text-xs font-bold text-gray-500">
                      {language === 'বাংলা' ? 'রিভিউয়ের জন্য সাবমিট করুন — সাধারণত ২৪ ঘণ্টার মধ্যে শেষ হয়।' : 'Submit for review — usually takes under 24 hours.'}
                    </p>
                  </div>
                  <button
                    onClick={submitVerification}
                    className="px-5 py-3 bg-[#ba0036] hover:bg-[#90002a] text-white rounded-xl font-black text-xs shadow-md transition-all flex items-center gap-2"
                  >
                    <Upload size={14} /> {language === 'বাংলা' ? 'রিভিউয়ের জন্য সাবমিট করুন' : 'Submit for Review'}
                  </button>
                </div>
              )}

              {tenantProfile.verification.submittedForReview && verifPending && (
                <div className="mt-6 pt-6 border-t border-gray-100 bg-amber-50/50 -mx-6 md:-mx-8 -mb-6 md:-mb-8 px-6 md:px-8 py-5 rounded-b-[2rem] flex items-center gap-3">
                  <Hourglass className="text-amber-600 shrink-0" size={20} />
                  <div>
                    <p className="text-sm font-black text-gray-900">
                      {language === 'বাংলা' ? 'রিভিউ চলছে' : 'Under review'}
                    </p>
                    <p className="text-xs font-bold text-gray-500">
                      {language === 'বাংলা' ? 'আমরা আপনার ডকুমেন্ট যাচাই করছি। সাধারণত ২৪ ঘণ্টা লাগে।' : 'We\u2019re reviewing your documents. Usually under 24 hours.'}
                    </p>
                  </div>
                </div>
              )}
            </div>

              </div>{/* === END LEFT COLUMN === */}

              {/* === RIGHT (1 col on xl): Trust Score + Timeline + Quick Wins === */}
              <div className="xl:col-span-1 space-y-6 md:space-y-8">

            {/* === TRUST SCORE GAUGE — headline metric landlords see === */}
            <TrustGauge
              score={trustScore.score}
              tier={trustScore.tier}
              breakdown={trustScore.breakdown}
              language={language}
            />

            {/* === QUICK WINS — top 3 highest-impact unfilled items === */}
            <QuickWinsCard
              breakdown={trustScore.breakdown}
              language={language}
              onJump={() => {
                // Currently scrolls to top of profile tab; user clicks Edit
                // to fill. Real wiring would scroll to the matching section.
                if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            />

            {/* === VERIFICATION TIMELINE =========================== */}
            <div className="bg-white rounded-[2rem] border border-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.04)] p-6 md:p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center">
                  <CheckCheck className="text-green-600" size={18} />
                </div>
                <div>
                  <h3 className="text-base md:text-lg font-black text-gray-900">
                    {language === 'বাংলা' ? 'ভেরিফিকেশন স্ট্যাটাস' : 'Verification Status'}
                  </h3>
                  <p className="text-xs font-bold text-gray-500">
                    {language === 'বাংলা' ? 'কোন ধাপে আছেন এক নজরে দেখুন।' : 'Track your verification progress at a glance.'}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <TimelineRow
                  done
                  icon={UserCircle}
                  textEn="Account created"
                  textBn="অ্যাকাউন্ট তৈরি"
                  language={language}
                />
                <TimelineRow
                  done={!!tenantProfile.phone}
                  icon={Phone}
                  textEn="Phone OTP verified"
                  textBn="ফোন OTP ভেরিফাইড"
                  language={language}
                />
                <TimelineRow
                  done={tenantProfile.verification.photo}
                  icon={Camera}
                  textEn="Profile photo uploaded"
                  textBn="প্রোফাইল ছবি আপলোড"
                  language={language}
                />
                <TimelineRow
                  done={tenantProfile.verification.nidFront && tenantProfile.verification.nidBack}
                  icon={ScanFace}
                  textEn="National ID uploaded"
                  textBn="NID আপলোড"
                  language={language}
                />
                {tenantProfile.professionType !== '' && tenantProfile.professionType !== 'other' && (
                  <TimelineRow
                    done={tenantProfile.verification.professionProof}
                    icon={FileText}
                    textEn="Profession proof uploaded"
                    textBn="পেশা প্রমাণ আপলোড"
                    language={language}
                  />
                )}
                <TimelineRow
                  done={verifPending || isVerified}
                  icon={Hourglass}
                  textEn="Submitted for admin review"
                  textBn="অ্যাডমিন রিভিউয়ের জন্য সাবমিট"
                  language={language}
                />
                <TimelineRow
                  done={isVerified}
                  icon={BadgeCheck}
                  textEn="Verified by To-Let Pro"
                  textBn="To-Let Pro দ্বারা ভেরিফাইড"
                  language={language}
                  isFinal
                />
              </div>
            </div>

              </div>{/* === END RIGHT COLUMN === */}
            </div>{/* === END xl:grid-cols-3 === */}
          </div>
        )}

        {/* 🔴 TAB 2: SAVED PROPERTIES */}
        {activeTab === 'saved' && (
          <div className="animate-in fade-in duration-500">
            {filteredSavedProps.length === 0 ? (
              <div className="text-center py-20 md:py-24 bg-white/40 backdrop-blur-md rounded-[2rem] md:rounded-[3rem] border border-white shadow-sm flex flex-col items-center px-6">
                <div className="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center mb-4">
                  <Heart className="text-[#ba0036]" size={36} />
                </div>
                <h3 className="text-xl font-black text-gray-700 mb-2">{t.noSavedProps || (language === 'বাংলা' ? 'কোনো প্রপার্টি সেভ করা নেই।' : 'No saved properties yet.')}</h3>
                <p className="text-sm font-bold text-gray-400 mb-6 max-w-md leading-relaxed">{t.saveFavoriteHomes || (language === 'বাংলা' ? 'প্রপার্টি কার্ডের ❤ আইকনে ক্লিক করলে সেগুলো এখানে সেভ হবে — পরে এক ক্লিকে আবার দেখতে পারবেন।' : 'Tap the heart on any property card to save it here — pick up where you left off in one click later.')}</p>
                <Link to="/properties/all" className="bg-[#ba0036] text-white px-8 py-3 rounded-xl text-sm font-black active:scale-95 transition-transform shadow-md hover:bg-[#90002a] inline-flex items-center gap-2">
                  <Search size={14} /> {t.exploreRentals || (language === 'বাংলা' ? 'প্রপার্টি খুঁজুন' : 'Explore properties')}
                </Link>
              </div>
            ) : (
              <>
                {/* Count + browse-more strip */}
                <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-rose-50 flex items-center justify-center text-[#ba0036] shadow-sm">
                      <Heart size={20} fill="currentColor" />
                    </div>
                    <div>
                      <p className="text-base font-black text-gray-900">
                        {filteredSavedProps.length} {language === 'বাংলা' ? 'সেভ করা প্রপার্টি' : `saved propert${filteredSavedProps.length === 1 ? 'y' : 'ies'}`}
                      </p>
                      <p className="text-[11px] font-bold text-gray-500">
                        {language === 'বাংলা' ? 'বাড়িওয়ালার সাথে সরাসরি কথা বলতে যেকোনো কার্ডে ইনকোয়ারি দিন।' : 'Inquire on any card to start a conversation with the landlord.'}
                      </p>
                    </div>
                  </div>
                  <Link
                    to="/properties/all"
                    className="self-start sm:self-auto inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 hover:border-[#ba0036] hover:text-[#ba0036] text-gray-600 rounded-xl text-[11px] font-black shadow-sm transition-all"
                  >
                    <Search size={12} /> {language === 'বাংলা' ? 'আরও খুঁজুন' : 'Find more'}
                  </Link>
                </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8 auto-rows-fr">
                {filteredSavedProps.map((prop) => (
                  <div key={prop.id} className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-gray-100 shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden flex flex-col group">
                    <div className="relative h-56 overflow-hidden bg-gray-900 cursor-pointer" onClick={() => navigate(`/property/${prop.id}`)}>
                      <div className="absolute inset-0 bg-cover bg-center transition-transform duration-[2s] group-hover:scale-110 opacity-90 group-hover:opacity-100" style={{ backgroundImage: `url(${prop.img || prop.images?.[0] || 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?q=80&w=500'})` }}></div>
                      
                      <button onClick={(e) => { e.stopPropagation(); handleUnsave(prop.id); }} className="absolute top-4 right-4 p-2.5 bg-white/90 backdrop-blur-md rounded-full shadow-sm hover:bg-white hover:scale-110 active:scale-95 transition-all z-10">
                         <Trash2 size={16} className="text-gray-400 hover:text-red-500" />
                      </button>

                      <div className="absolute -bottom-1 right-4 bg-white/95 backdrop-blur-xl px-4 py-2 rounded-t-xl font-black text-base text-gray-900 shadow-sm border border-white/50 border-b-0">
                        ৳ {prop.price}
                      </div>
                    </div>
                    <div className="p-6 flex-1 flex flex-col">
                      <h4 className="text-lg font-black text-gray-900 mb-2 leading-tight group-hover:text-[#ba0036] transition-colors cursor-pointer" onClick={() => navigate(`/property/${prop.id}`)}>{prop.title}</h4>
                      <p className="text-xs font-bold text-gray-500 flex items-center gap-1.5 mb-6"><MapPin size={14} className="text-gray-400" /> {prop.location}</p>
                      
                      <div className="mt-auto flex gap-2 pt-4 border-t border-gray-100">
                         <button onClick={() => navigate(`/property/${prop.id}`)} className="flex-1 bg-gray-50 hover:bg-gray-100 text-gray-700 py-3 rounded-xl text-xs font-bold transition-all border border-gray-200 active:scale-95">
                           {t.viewDetails || (language === 'বাংলা' ? 'বিস্তারিত' : 'View Details')}
                         </button>
                         <button onClick={() => openInquiry(prop)} className="flex-1 bg-gradient-to-r from-[#ba0036] to-[#d11147] text-white py-3 rounded-xl text-xs font-black shadow-[0_6px_18px_rgba(186,0,54,0.25)] hover:shadow-[0_10px_24px_rgba(186,0,54,0.4)] active:scale-95 transition-all flex items-center justify-center gap-1.5">
                           <MessageCircle size={13} /> {t.inquire || (language === 'বাংলা' ? 'ইনকোয়ারি' : 'Inquire')}
                         </button>
                      </div>
                    </div>
                  </div>
                ))}
                {/* When fewer than 3 saved on lg, fill remaining grid slots with
                    a dashed-border "discover more" prompt so the page never
                    looks half-empty. Hidden on mobile (single column) where
                    every card already takes a full row. */}
                {filteredSavedProps.length < 3 && Array.from({ length: 3 - filteredSavedProps.length }).map((_, i) => (
                  <Link
                    key={`fill-${i}`}
                    to="/properties/all"
                    className="hidden lg:flex flex-col items-center justify-center gap-3 rounded-[2rem] border-2 border-dashed border-gray-200 hover:border-[#ba0036]/40 bg-white/30 hover:bg-white/60 transition-all duration-300 p-8 text-center group min-h-[24rem]"
                  >
                    <div className="w-14 h-14 rounded-2xl bg-white border border-gray-100 flex items-center justify-center text-gray-400 group-hover:text-[#ba0036] group-hover:border-[#ba0036]/30 group-hover:scale-110 transition-all">
                      <Search size={22} />
                    </div>
                    <p className="text-sm font-black text-gray-500 group-hover:text-[#ba0036] transition-colors">
                      {language === 'বাংলা' ? 'আরও প্রপার্টি ব্রাউজ করুন' : 'Browse more properties'}
                    </p>
                    <p className="text-xs font-bold text-gray-400 max-w-[14rem] leading-relaxed">
                      {language === 'বাংলা' ? 'পছন্দ হলে ❤ আইকনে ক্লিক করুন — এখানে সেভ হবে।' : 'Tap the heart on any listing — it lands right here.'}
                    </p>
                  </Link>
                ))}
              </div>
              </>
            )}
          </div>
        )}

        {/* 🟢 NEW TAB: APPLICATIONS — pipeline of every inquiry the tenant
            sent. Real data lands here once the inquiry-storage backend is
            wired; for now we show seed examples so the tenant understands
            what this tab will contain. Each row uses a 4-stage pipeline
            (Sent → Viewed → Responded → Approved/Declined) plus a contact
            shortcut so the tenant can chase a slow landlord. */}
        {activeTab === 'applications' && (() => {
          // Seed examples — replace with `JSON.parse(localStorage.getItem('tolet_applications'))`
          // or a `fetch('/api/tenant/applications')` once backend is ready.
          const stages = [
            { id: 'sent',    icon: Send,         en: 'Sent',    bn: 'পাঠানো' },
            { id: 'viewed',  icon: Eye,          en: 'Viewed',  bn: 'দেখা হয়েছে' },
            { id: 'replied', icon: MessageCircle, en: 'Replied', bn: 'রিপ্লাই' },
            { id: 'closed',  icon: CheckCircle2, en: 'Closed',  bn: 'ক্লোজড' },
          ];
          const sampleApps = [
            { id: 'a1', title: 'Elegant 3BHK with Skyline View', location: 'Gulshan 2, Dhaka', price: '45,000', stageIdx: 2, outcome: 'pending', sentAt: 'Oct 22, 2025', img: 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?q=80&w=400' },
            { id: 'a2', title: 'Modern Bachelor Studio',          location: 'Mohammadpur, Dhaka', price: '12,000', stageIdx: 3, outcome: 'approved', sentAt: 'Oct 18, 2025', img: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?q=80&w=400' },
            { id: 'a3', title: 'Family Apartment near Metro',     location: 'Mirpur 10, Dhaka',  price: '28,000', stageIdx: 1, outcome: 'pending', sentAt: 'Oct 27, 2025', img: 'https://images.unsplash.com/photo-1493809842364-78817add7ffb?q=80&w=400' },
          ];
          if (sampleApps.length === 0) {
            return (
              <div className="text-center py-24 bg-white/40 backdrop-blur-md rounded-[3rem] border border-white shadow-sm flex flex-col items-center">
                <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mb-4">
                  <Inbox className="text-emerald-400" size={36} />
                </div>
                <h3 className="text-xl font-black text-gray-500 mb-2">
                  {language === 'বাংলা' ? 'কোনো ইনকোয়ারি নেই' : 'No inquiries yet'}
                </h3>
                <p className="text-sm font-bold text-gray-400 mb-6 max-w-md">
                  {language === 'বাংলা'
                    ? 'কোনো প্রপার্টিতে ইনকোয়ারি পাঠালে সেটার স্ট্যাটাস এখানে দেখাবে।'
                    : 'When you inquire about a property, it will appear here with live status.'}
                </p>
                <Link to="/properties/all" className="bg-gradient-to-r from-[#ba0036] to-[#d11147] text-white px-8 py-3 rounded-xl text-sm font-black active:scale-95 transition-transform shadow-[0_8px_20px_rgba(186,0,54,0.25)] hover:shadow-[0_12px_30px_rgba(186,0,54,0.4)]">
                  {language === 'বাংলা' ? 'প্রপার্টি ব্রাউজ করুন' : 'Browse properties'}
                </Link>
              </div>
            );
          }
          return (
            <div className="animate-in fade-in duration-500 space-y-4 md:space-y-5">
              {/* Counts strip */}
              <div className="grid grid-cols-3 md:grid-cols-4 gap-3 md:gap-4 mb-2">
                {[
                  { en: 'Total',     bn: 'মোট',       count: sampleApps.length,                                 cls: 'bg-gray-50 text-gray-700 border-gray-100' },
                  { en: 'In review', bn: 'রিভিউ',    count: sampleApps.filter((a) => a.outcome === 'pending').length, cls: 'bg-amber-50 text-amber-700 border-amber-100' },
                  { en: 'Approved',  bn: 'অ্যাপ্রুভড', count: sampleApps.filter((a) => a.outcome === 'approved').length, cls: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
                  { en: 'Declined',  bn: 'বাতিল',    count: sampleApps.filter((a) => a.outcome === 'declined').length, cls: 'hidden md:flex bg-red-50 text-red-700 border-red-100' },
                ].map((s, i) => (
                  <div key={i} className={`p-4 rounded-2xl border flex flex-col gap-1 ${s.cls}`}>
                    <span className="text-[10px] font-black uppercase tracking-widest opacity-80">{language === 'বাংলা' ? s.bn : s.en}</span>
                    <span className="text-2xl md:text-3xl font-black tabular-nums">{s.count}</span>
                  </div>
                ))}
              </div>

              {/* Application cards */}
              {sampleApps.map((app) => (
                <div key={app.id} className="bg-white/80 backdrop-blur-xl rounded-[1.5rem] md:rounded-[2rem] border border-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-md transition-all overflow-hidden">
                  <div className="flex flex-col md:flex-row gap-0 md:gap-6">
                    {/* Image */}
                    <div className="w-full md:w-48 h-40 md:h-auto bg-gray-100 shrink-0 relative">
                      <div
                        className="absolute inset-0 bg-cover bg-center"
                        style={{ backgroundImage: `url(${app.img})` }}
                      />
                      <div className="absolute top-3 left-3 bg-white/95 backdrop-blur-sm px-2.5 py-1 rounded-lg text-[11px] font-black text-gray-900">
                        ৳ {app.price}
                      </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 p-5 md:p-6 flex flex-col">
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
                        <div className="min-w-0">
                          <h4 className="text-base md:text-lg font-black text-gray-900 truncate">{app.title}</h4>
                          <p className="text-xs font-bold text-gray-500 flex items-center gap-1.5 mt-1">
                            <MapPin size={12} className="text-gray-400" /> {app.location}
                            <span className="text-gray-300">·</span>
                            <Clock size={11} className="text-gray-400" /> {language === 'বাংলা' ? 'পাঠানো:' : 'Sent:'} {app.sentAt}
                          </p>
                        </div>
                        {/* Outcome pill */}
                        <span className={`self-start md:self-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                          app.outcome === 'approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                          : app.outcome === 'declined' ? 'bg-red-50 text-red-700 border-red-100'
                          : 'bg-amber-50 text-amber-700 border-amber-100'
                        }`}>
                          {app.outcome === 'approved' ? <ThumbsUp size={11} /> : app.outcome === 'declined' ? <ThumbsDown size={11} /> : <Hourglass size={11} />}
                          {app.outcome === 'approved'
                            ? (language === 'বাংলা' ? 'অ্যাপ্রুভড' : 'Approved')
                            : app.outcome === 'declined'
                              ? (language === 'বাংলা' ? 'বাতিল' : 'Declined')
                              : (language === 'বাংলা' ? 'রিভিউ চলছে' : 'In review')}
                        </span>
                      </div>

                      {/* Pipeline */}
                      <div className="grid grid-cols-4 gap-2 mb-5">
                        {stages.map((st, i) => {
                          const reached = i <= app.stageIdx;
                          const isCurrent = i === app.stageIdx;
                          const Icon = st.icon;
                          return (
                            <div key={st.id} className="flex flex-col items-center gap-1.5 relative">
                              {/* connector line — solid green for past, dashed grey for future */}
                              {i < stages.length - 1 && (
                                i < app.stageIdx
                                  ? <span className="absolute top-4 left-[60%] right-[-40%] h-[2px] bg-emerald-400 rounded-full" />
                                  : <span className="absolute top-4 left-[60%] right-[-40%] h-[2px] border-t-2 border-dashed border-gray-200" />
                              )}
                              <div className={`relative z-10 w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all ${
                                reached
                                  ? (isCurrent
                                      ? 'bg-gradient-to-br from-[#ba0036] to-rose-500 text-white border-[#ba0036] shadow-[0_0_0_4px_rgba(186,0,54,0.15)]'
                                      : 'bg-gradient-to-br from-emerald-500 to-green-600 text-white border-emerald-500 shadow-sm')
                                  : 'bg-white text-gray-400 border-gray-200'
                              }`}>
                                <Icon size={13} strokeWidth={2.5} />
                              </div>
                              <span className={`text-[10px] font-black text-center leading-tight ${reached ? (isCurrent ? 'text-[#ba0036]' : 'text-gray-700') : 'text-gray-400'}`}>
                                {language === 'বাংলা' ? st.bn : st.en}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2 mt-auto pt-4 border-t border-gray-100">
                        <button
                          onClick={() => navigate(`/property/${app.id}`)}
                          className="flex-1 bg-gray-50 hover:bg-gray-100 text-gray-700 py-2.5 rounded-xl text-xs font-bold transition-all border border-gray-200 active:scale-95"
                        >
                          {language === 'বাংলা' ? 'প্রপার্টি' : 'Property'}
                        </button>
                        <button
                          onClick={() => openInquiry(app)}
                          className="flex-1 bg-white text-[#ba0036] border border-[#ba0036]/20 hover:bg-[#ba0036] hover:text-white hover:border-[#ba0036] py-2.5 rounded-xl text-xs font-black active:scale-95 transition-all flex items-center justify-center gap-1.5"
                        >
                          <MessageCircle size={13} /> {language === 'বাংলা' ? 'আবার ইনকোয়ারি' : 'Re-inquire'}
                        </button>
                        <button
                          onClick={() => navigate('/messages')}
                          className="flex-1 bg-gradient-to-r from-[#ba0036] to-[#d11147] text-white py-2.5 rounded-xl text-xs font-black shadow-[0_6px_18px_rgba(186,0,54,0.25)] hover:shadow-[0_10px_24px_rgba(186,0,54,0.4)] active:scale-95 transition-all flex items-center justify-center gap-1.5"
                        >
                          <MessageSquare size={13} /> {language === 'বাংলা' ? 'চ্যাট' : 'Chat'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Footer note */}
              <div className="mt-2 text-center">
                <p className="text-xs font-bold text-gray-400">
                  {language === 'বাংলা'
                    ? 'এগুলো ডেমো ইনকোয়ারি। ব্যাকএন্ড কানেক্ট হলে আপনার আসল ইনকোয়ারিগুলো এখানে দেখাবে।'
                    : 'Demo inquiries shown above — once the backend is connected, your real inquiries will appear here.'}
                </p>
              </div>
            </div>
          );
        })()}

        {/* 🟢 NEW TAB 3: PAYMENT BOX */}
        {activeTab === 'payments' && (
          <div className="animate-in fade-in duration-500">
            {paymentReceipts.length === 0 ? (
              <div className="text-center py-24 bg-white/40 backdrop-blur-md rounded-[3rem] border border-white shadow-sm flex flex-col items-center">
                <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mb-4">
                  <Receipt className="text-blue-400" size={36} />
                </div>
                <h3 className="text-xl font-black text-gray-500 mb-2">
                  {language === 'বাংলা' ? 'কোনো পেমেন্ট রিসিট নেই' : 'No payment receipts yet'}
                </h3>
                <p className="text-sm font-bold text-gray-400 mb-2 max-w-md mx-auto leading-relaxed">
                  {language === 'বাংলা'
                    ? 'বাড়িওয়ালা ভাড়া পেমেন্ট আপডেট করলে এখানে স্বয়ংক্রিয়ভাবে রিসিট চলে আসবে।'
                    : "When your landlord updates a rent payment, the receipt will appear here automatically."}
                </p>
              </div>
            ) : (
              <>
                {/* Header bar with summary + Mark all read */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-600 shadow-sm">
                      <Receipt size={22} />
                    </div>
                    <div>
                      <p className="text-base font-black text-gray-900">
                        {paymentReceipts.length} {language === 'বাংলা' ? 'রিসিট' : 'receipt' + (paymentReceipts.length > 1 ? 's' : '')}
                      </p>
                      <p className="text-[11px] font-bold text-gray-500">
                        {unreadReceiptsCount > 0
                          ? (language === 'বাংলা' ? `${unreadReceiptsCount}টি আনরিড` : `${unreadReceiptsCount} unread`)
                          : (language === 'বাংলা' ? 'সব পড়া হয়েছে' : 'All caught up')}
                      </p>
                    </div>
                  </div>
                  {unreadReceiptsCount > 0 && (
                    <button
                      onClick={markAllReceiptsRead}
                      className="self-start sm:self-auto px-4 py-2.5 bg-white border border-gray-100 hover:border-[#ba0036] hover:text-[#ba0036] text-gray-600 rounded-xl text-[11px] font-black shadow-sm transition-all active:scale-95"
                    >
                      {language === 'বাংলা' ? 'সব পড়া হিসেবে চিহ্নিত করুন' : 'Mark all as read'}
                    </button>
                  )}
                </div>

                {/* Receipt list */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-5">
                  {paymentReceipts.map(r => {
                    const isFull = r.status === 'full' || r.balance <= 0;
                    return (
                      <button
                        key={r.id}
                        onClick={() => { setActiveReceipt(r); markReceiptRead(r.id); }}
                        className={`text-left bg-white/80 backdrop-blur-xl p-6 rounded-[2rem] border shadow-sm hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 active:scale-[0.99] relative overflow-hidden ${
                          !r.read ? 'border-[#ba0036]/30 ring-2 ring-[#ba0036]/10' : 'border-gray-100'
                        }`}
                      >
                        {/* Status-tinted halo */}
                        <div className={`absolute -bottom-12 -right-12 w-40 h-40 rounded-full blur-3xl pointer-events-none ${
                          isFull ? 'bg-blue-200/30' : 'bg-amber-200/30'
                        }`} />

                        {!r.read && (
                          <span className="absolute top-4 right-4 inline-flex items-center gap-1 bg-[#ba0036] text-white text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest shadow-md z-10">
                            <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></span>
                            {language === 'বাংলা' ? 'নতুন' : 'New'}
                          </span>
                        )}

                        {/* Header */}
                        <div className="relative z-10 flex items-start gap-3 mb-4">
                          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-md ${
                            isFull ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white' : 'bg-gradient-to-br from-amber-400 to-orange-500 text-white'
                          }`}>
                            {isFull ? <CheckCheck size={22} strokeWidth={3} /> : <Hourglass size={22} strokeWidth={2.5} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-base font-black text-gray-900 leading-tight truncate">{r.propertyTitle}</p>
                            <p className="text-[11px] font-bold text-gray-500 mt-0.5 flex items-center gap-1.5">
                              <Calendar size={11} className="text-gray-400" />
                              {r.monthLabel || r.monthKey} · {r.date}
                            </p>
                          </div>
                        </div>

                        {/* Body — premium price block */}
                        <div className={`relative z-10 rounded-2xl p-4 mb-3 border ${
                          isFull
                            ? 'bg-gradient-to-br from-blue-50/80 to-indigo-50/60 border-blue-100/60'
                            : 'bg-gradient-to-br from-amber-50/80 to-orange-50/60 border-amber-100/60'
                        }`}>
                          <div className="flex items-baseline justify-between mb-1.5">
                            <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                              {language === 'বাংলা' ? 'পেইড' : 'Paid'}
                            </span>
                            <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md ${
                              isFull ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                            }`}>
                              {isFull
                                ? (language === 'বাংলা' ? 'পূর্ণ' : 'FULL')
                                : (language === 'বাংলা' ? 'আংশিক' : 'PARTIAL')}
                            </span>
                          </div>
                          <p className={`text-3xl md:text-[2rem] font-black flex items-center gap-2 leading-none tabular-nums tracking-tight ${
                            isFull
                              ? 'bg-gradient-to-br from-blue-600 to-indigo-700 bg-clip-text text-transparent'
                              : 'bg-gradient-to-br from-amber-600 to-orange-600 bg-clip-text text-transparent'
                          }`}>
                            ৳ {(r.totalPaid || 0).toLocaleString()}
                            {isFull && <CheckCheck size={22} strokeWidth={3} className="text-blue-600 shrink-0" />}
                          </p>
                          <div className="flex items-center justify-between mt-2.5 text-[11px] font-bold text-gray-500">
                            <span>{language === 'বাংলা' ? 'মোট বকেয়া' : 'Total Due'}: ৳{(r.totalDue || 0).toLocaleString()}</span>
                            <span className={r.balance > 0 ? 'text-[#ba0036]' : 'text-green-600'}>
                              {language === 'বাংলা' ? 'বাকি' : 'Balance'}: {r.balance > 0 ? `৳${r.balance.toLocaleString()}` : '✓'}
                            </span>
                          </div>
                        </div>

                        <div className="relative z-10 flex items-center justify-between text-[11px] font-bold">
                          <span className="text-gray-400 flex items-center gap-1.5">
                            <CreditCard size={12} className="text-gray-400" />
                            {language === 'বাংলা' ? 'রিসিট' : 'Receipt'} #{r.id?.slice(-6)}
                          </span>
                          <span className="text-[#ba0036] flex items-center gap-1 group">
                            {language === 'বাংলা' ? 'বিস্তারিত' : 'View'} <ArrowRight size={12} className="group-hover:translate-x-0.5 transition-transform" />
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

      </main>

      {/* 🟢 NEW: Inquiry Modal — shared with PropertyDetails / PropertyListing.
          Mounted at the dashboard root so any tab can trigger it. */}
      <InquiryModal
        isOpen={!!inquiryProp}
        onClose={() => setInquiryProp(null)}
        property={inquiryProp}
        landlord={inquiryLandlord}
      />

      {/* 🟢 NEW: Futuristic Welcome Splash — fires once per browser session.
          Animated home icon w/ concentric pulse rings, gradient bg,
          orbit dots, sparkle accents, Bn/En greeting, auto-dismiss ~3.2s. */}
      {showWelcome && (
        <div
          onClick={() => setShowWelcome(false)}
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 cursor-pointer animate-in fade-in duration-300"
          style={{ background: 'radial-gradient(ellipse at center, rgba(186,0,54,0.12) 0%, rgba(15,15,30,0.55) 60%, rgba(15,15,30,0.7) 100%)', backdropFilter: 'blur(12px)' }}
          role="dialog"
          aria-modal="true"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md mx-auto bg-gradient-to-br from-white via-white to-rose-50/40 rounded-[2.25rem] border border-white/80 shadow-[0_30px_80px_rgba(186,0,54,0.25)] p-8 md:p-10 overflow-hidden animate-in zoom-in-90 slide-in-from-bottom-6 duration-500"
          >
            {/* Background ambient orbs */}
            <div className="absolute -top-20 -right-20 w-56 h-56 bg-[#ba0036]/15 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-24 -left-20 w-64 h-64 bg-amber-200/30 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute top-10 right-12 text-[#ba0036]/40 animate-pulse" style={{ animationDuration: '2s' }}>
              <Sparkles size={16} />
            </div>
            <div className="absolute bottom-14 left-10 text-amber-400/50 animate-pulse" style={{ animationDuration: '2.4s', animationDelay: '0.4s' }}>
              <Sparkles size={12} />
            </div>
            <div className="absolute top-20 left-8 text-rose-300/60 animate-pulse" style={{ animationDuration: '2.8s', animationDelay: '0.8s' }}>
              <Sparkles size={10} />
            </div>

            {/* Close pill */}
            <button
              onClick={() => setShowWelcome(false)}
              className="absolute top-5 right-5 w-8 h-8 rounded-full bg-white/80 backdrop-blur border border-gray-100 text-gray-400 hover:text-[#ba0036] hover:border-[#ba0036]/30 flex items-center justify-center transition-all z-10"
              aria-label="Close welcome"
            >
              <X size={14} strokeWidth={2.5} />
            </button>

            <div className="relative z-10 flex flex-col items-center text-center">
              {/* Animated Home stack: concentric pulse rings + gradient tile + orbit dots */}
              <div className="relative w-32 h-32 md:w-36 md:h-36 mb-6 flex items-center justify-center">
                {/* outer pulse rings */}
                <span className="absolute inset-0 rounded-full bg-[#ba0036]/12 animate-ping" style={{ animationDuration: '2.4s' }} />
                <span className="absolute inset-2 rounded-full bg-[#ba0036]/15 animate-ping" style={{ animationDuration: '2.4s', animationDelay: '0.4s' }} />
                <span className="absolute inset-4 rounded-full bg-[#ba0036]/20 animate-ping" style={{ animationDuration: '2.4s', animationDelay: '0.8s' }} />
                {/* solid halo */}
                <span className="absolute inset-5 rounded-full bg-gradient-to-br from-[#ba0036]/15 to-amber-100/50 blur-md" />
                {/* the home tile */}
                <div className="relative w-20 h-20 md:w-24 md:h-24 rounded-[1.5rem] bg-gradient-to-br from-[#ba0036] via-rose-500 to-orange-400 shadow-[0_15px_40px_rgba(186,0,54,0.4)] flex items-center justify-center overflow-hidden">
                  {/* shimmer streak across tile */}
                  <span
                    className="absolute -inset-1 bg-gradient-to-r from-transparent via-white/30 to-transparent -skew-x-12 animate-[shimmer_2s_ease-in-out_infinite]"
                    style={{ animation: 'tdShimmer 2.4s ease-in-out infinite' }}
                  />
                  <Home className="relative text-white drop-shadow" size={42} strokeWidth={2.2} />
                </div>
                {/* orbit dots */}
                <span className="absolute top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-[#ba0036] shadow-[0_0_12px_rgba(186,0,54,0.7)] animate-bounce" style={{ animationDuration: '1.6s' }} />
                <span className="absolute bottom-1 right-3 w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.6)] animate-bounce" style={{ animationDuration: '1.8s', animationDelay: '0.3s' }} />
                <span className="absolute bottom-3 left-2 w-1.5 h-1.5 rounded-full bg-rose-300 animate-bounce" style={{ animationDuration: '2s', animationDelay: '0.6s' }} />
                {/* keyhole sparkle */}
                <span className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-white border border-rose-100 flex items-center justify-center shadow-md">
                  <KeyRound size={12} className="text-[#ba0036]" />
                </span>
              </div>

              {/* Eyebrow */}
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-50 border border-rose-100 text-[#ba0036] text-[10px] font-black uppercase tracking-[0.2em] mb-3">
                <Sparkles size={10} /> {language === 'বাংলা' ? 'টু-লেট প্রো' : 'To-Let Pro'}
              </span>

              {/* Greeting */}
              <h3 className="text-2xl md:text-3xl font-black text-gray-900 mb-1.5 bg-gradient-to-br from-gray-900 to-gray-600 bg-clip-text text-transparent">
                {language === 'বাংলা' ? `স্বাগতম, ${loggedInUser}` : `Welcome, ${loggedInUser}`}
              </h3>

              {/* Subtitle */}
              <p className="text-sm text-gray-500 max-w-xs leading-relaxed mb-5">
                {language === 'বাংলা'
                  ? 'আপনার পরবর্তী ভাড়া বাসা খুঁজে পেতে প্রস্তুত। চলুন শুরু করি।'
                  : 'Ready to find your next home. Let\u2019s get you settled in.'}
              </p>

              {/* Animated progress bar that fills as the splash plays */}
              <div className="w-32 h-1 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#ba0036] via-rose-500 to-orange-400 rounded-full"
                  style={{ animation: 'tdWelcomeBar 3.2s linear forwards' }}
                />
              </div>
              <p className="mt-3 text-[10px] font-bold text-gray-300 uppercase tracking-[0.2em]">
                {language === 'বাংলা' ? 'ট্যাপ করুন বন্ধ করতে' : 'tap anywhere to dismiss'}
              </p>
            </div>
          </div>

          {/* Local keyframes — scoped via inline <style> so we don't touch
              your tailwind config. */}
          <style>{`
            @keyframes tdShimmer {
              0%   { transform: translateX(-100%) skewX(-12deg); }
              60%  { transform: translateX(120%)  skewX(-12deg); }
              100% { transform: translateX(120%)  skewX(-12deg); }
            }
            @keyframes tdWelcomeBar {
              0%   { width: 0%; }
              100% { width: 100%; }
            }
          `}</style>
        </div>
      )}

      {/* 🟢 NEW: Receipt Detail Modal */}
      {activeReceipt && (
        <div
          className="fixed inset-0 z-[100] bg-gray-900/40 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setActiveReceipt(null)}
        >
          <div
            className="bg-white rounded-[2rem] w-full max-w-md shadow-[0_30px_80px_rgba(0,0,0,0.2)] overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className={`p-6 text-white relative overflow-hidden ${
              (activeReceipt.status === 'full' || activeReceipt.balance <= 0)
                ? 'bg-gradient-to-br from-blue-500 to-indigo-600'
                : 'bg-gradient-to-br from-amber-500 to-orange-600'
            }`}>
              <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-3xl"></div>
              <button
                onClick={() => setActiveReceipt(null)}
                className="absolute top-4 right-4 p-2 bg-white/15 hover:bg-white/25 rounded-full transition-all"
              >
                <X size={16} />
              </button>
              <div className="relative">
                <div className="w-14 h-14 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center mb-4 border border-white/30 shadow-lg">
                  {(activeReceipt.status === 'full' || activeReceipt.balance <= 0)
                    ? <CheckCheck size={26} strokeWidth={3} />
                    : <Hourglass size={26} strokeWidth={2.5} />}
                </div>
                <p className="text-[10px] font-black text-white/70 uppercase tracking-widest mb-1">
                  {language === 'বাংলা' ? 'ডিজিটাল রেন্ট রিসিট' : 'Digital Rent Receipt'}
                </p>
                <h3 className="text-2xl font-black tracking-tight">
                  ৳ {(activeReceipt.totalPaid || 0).toLocaleString()}
                </h3>
                <p className="text-[11px] font-bold text-white/80 mt-1">
                  {(activeReceipt.status === 'full' || activeReceipt.balance <= 0)
                    ? (language === 'বাংলা' ? 'পূর্ণ পেমেন্ট সম্পন্ন' : 'Full payment confirmed')
                    : (language === 'বাংলা' ? 'আংশিক পেমেন্ট রেকর্ড' : 'Partial payment recorded')}
                </p>
              </div>
            </div>

            {/* Body */}
            <div className="p-6 space-y-3">
              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'প্রপার্টি' : 'Property'}</span>
                <span className="text-sm font-black text-gray-900 text-right max-w-[220px] line-clamp-2">{activeReceipt.propertyTitle}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'মাস' : 'Month'}</span>
                <span className="text-sm font-black text-gray-900">{activeReceipt.monthLabel || activeReceipt.monthKey}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'মোট বকেয়া' : 'Total Due'}</span>
                <span className="text-sm font-black text-gray-900">৳ {(activeReceipt.totalDue || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'মোট পেইড' : 'Total Paid'}</span>
                <span className="text-sm font-black text-gray-900">৳ {(activeReceipt.totalPaid || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'বাকি' : 'Balance'}</span>
                <span className={`text-sm font-black ${activeReceipt.balance > 0 ? 'text-[#ba0036]' : 'text-green-600'}`}>
                  {activeReceipt.balance > 0 ? `৳ ${activeReceipt.balance.toLocaleString()}` : (language === 'বাংলা' ? 'ক্লিয়ার' : 'Cleared')}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'তারিখ' : 'Date'}</span>
                <span className="text-sm font-black text-gray-900">{activeReceipt.date}</span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'রিসিট আইডি' : 'Receipt ID'}</span>
                <span className="text-[11px] font-black text-gray-700 font-mono">{activeReceipt.id}</span>
              </div>

              {/* Action row — Reply takes the full top, Download / Close share a row below.
                  Reply navigates to /messages with the landlord's chatId in location.state
                  so ChatSystem.jsx (untouched) can hydrate the right thread.
                  We pre-fill `prefillMessage` with a context line about the receipt so the
                  tenant can ask "balance ৳X — when should I clear this?" in one tap. */}
              <div className="space-y-2 pt-2">
                {activeReceipt.landlordChatId && (
                  <button
                    onClick={() => {
                      const monthLbl = activeReceipt.monthLabel || activeReceipt.monthKey;
                      const isPartial = activeReceipt.balance > 0;
                      const prefill = isPartial
                        ? (language === 'বাংলা'
                            ? `${monthLbl} এর বাকি ৳${activeReceipt.balance.toLocaleString()} নিয়ে কথা বলতে চাই।`
                            : `Hi, about ${monthLbl} — when should I clear the remaining ৳${activeReceipt.balance.toLocaleString()}?`)
                        : (language === 'বাংলা'
                            ? `${monthLbl} এর রিসিট পেয়েছি, ধন্যবাদ।`
                            : `Got the ${monthLbl} receipt, thank you.`);
                      navigate('/messages', {
                        state: {
                          chatId: activeReceipt.landlordChatId,
                          source: 'tenant-receipt',
                          receiptId: activeReceipt.id,
                          propertyTitle: activeReceipt.propertyTitle,
                          monthKey: activeReceipt.monthKey,
                          prefillMessage: prefill,
                        },
                      });
                      setActiveReceipt(null);
                    }}
                    className={`w-full py-3 rounded-xl text-[11px] font-black transition-all active:scale-[0.98] flex items-center justify-center gap-2 text-white shadow-[0_8px_20px_rgba(0,0,0,0.12)] hover:-translate-y-0.5 ${
                      (activeReceipt.status === 'full' || activeReceipt.balance <= 0)
                        ? 'bg-gradient-to-br from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700'
                        : 'bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700'
                    }`}
                  >
                    <MessageCircle size={14} strokeWidth={3} />
                    {language === 'বাংলা' ? 'ল্যান্ডলর্ডকে রিপ্লাই' : 'Reply to Landlord'}
                  </button>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const text = [
                        `${language === 'বাংলা' ? 'TO-LET PRO রেন্ট রিসিট' : 'TO-LET PRO Rent Receipt'}`,
                        `Property: ${activeReceipt.propertyTitle}`,
                        `Month: ${activeReceipt.monthLabel || activeReceipt.monthKey}`,
                        `Total Due: ৳${(activeReceipt.totalDue || 0).toLocaleString()}`,
                        `Total Paid: ৳${(activeReceipt.totalPaid || 0).toLocaleString()}`,
                        `Balance: ${activeReceipt.balance > 0 ? '৳' + activeReceipt.balance.toLocaleString() : 'Cleared'}`,
                        `Method: ${activeReceipt.method || '—'}${activeReceipt.txnId ? ' · Txn ' + activeReceipt.txnId : ''}`,
                        `Date: ${activeReceipt.date}`,
                        `Receipt ID: ${activeReceipt.id}`,
                      ].join('\n');
                      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `receipt-${activeReceipt.id}.txt`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-[11px] font-black transition-all active:scale-95 flex items-center justify-center gap-1.5"
                  >
                    <Download size={14} /> {language === 'বাংলা' ? 'ডাউনলোড' : 'Download'}
                  </button>
                  <button
                    onClick={() => setActiveReceipt(null)}
                    className="flex-1 py-3 bg-gray-900 hover:bg-[#ba0036] text-white rounded-xl text-[11px] font-black transition-all active:scale-95"
                  >
                    {language === 'বাংলা' ? 'বন্ধ করুন' : 'Close'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* (Toast moved to the top of the shell — top-center pill mirroring HostDashboard.) */}
    </div>
  );
};

// ╔════════════════════════════════════════════════════════════════════════╗
// ║  Sub-components — kept in this file on purpose so it's still a single  ║
// ║  drop-in replacement for the user. No new files to create.             ║
// ╚════════════════════════════════════════════════════════════════════════╝

// Single verification step row. Used for "Profile photo" and "Profession proof".
// For the NID step we pass `multi` + `multiState` so it shows two sub-tiles.
const VerifStep = ({
  index, done, icon: Icon, titleEn, titleBn, descEn, descBn,
  language, onUpload, onRemove, multi = false, multiState, onMultiToggle,
}) => {
  const stateClass = done
    ? 'bg-green-50/60 border-green-200'
    : 'bg-gray-50/60 border-gray-200';
  return (
    <div className={`border rounded-2xl p-5 transition-colors ${stateClass}`}>
      <div className="flex items-start gap-4">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${done ? 'bg-green-500 text-white' : 'bg-white border border-gray-200 text-gray-500'}`}>
          {done ? <Check size={18} /> : <span className="text-sm font-black">{index}</span>}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Icon size={16} className={done ? 'text-green-700' : 'text-gray-700'} />
            <h4 className="text-sm font-black text-gray-900">
              {language === 'বাংলা' ? titleBn : titleEn}
            </h4>
          </div>
          <p className="text-xs font-bold text-gray-500 mb-3 leading-relaxed">
            {language === 'বাংলা' ? descBn : descEn}
          </p>

          {!multi ? (
            done ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1 bg-white border border-green-200 text-green-700 px-3 py-1.5 rounded-lg text-[11px] font-black">
                  <Check size={12} /> {language === 'বাংলা' ? 'আপলোড সম্পূর্ণ' : 'Uploaded'}
                </span>
                <button
                  onClick={onRemove}
                  className="text-[11px] font-black text-gray-500 hover:text-[#ba0036] underline-offset-2 hover:underline"
                >
                  {language === 'বাংলা' ? 'পরিবর্তন' : 'Replace'}
                </button>
              </div>
            ) : (
              <button
                onClick={onUpload}
                className="inline-flex items-center gap-2 bg-white hover:bg-[#ba0036] hover:text-white text-[#ba0036] border border-[#ba0036]/30 px-4 py-2 rounded-lg text-xs font-black transition-colors"
              >
                <Upload size={13} /> {language === 'বাংলা' ? 'আপলোড করুন' : 'Upload'}
              </button>
            )
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {multiState.map((item) => (
                <div
                  key={item.key}
                  className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border ${item.done ? 'bg-white border-green-200' : 'bg-white border-gray-200'}`}
                >
                  <span className="text-[11px] font-black text-gray-700 truncate">
                    {language === 'বাংলা' ? item.labelBn : item.labelEn}
                  </span>
                  {item.done ? (
                    <button
                      onClick={() => onMultiToggle(item.key, false)}
                      className="text-[10px] font-black text-gray-500 hover:text-[#ba0036]"
                    >
                      {language === 'বাংলা' ? 'পরিবর্তন' : 'Replace'}
                    </button>
                  ) : (
                    <button
                      onClick={() => onMultiToggle(item.key, true)}
                      className="inline-flex items-center gap-1 bg-[#ba0036]/10 hover:bg-[#ba0036] hover:text-white text-[#ba0036] px-2.5 py-1 rounded-md text-[10px] font-black transition-colors"
                    >
                      <Upload size={10} /> {language === 'বাংলা' ? 'আপলোড' : 'Upload'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Single timeline row for the "Verification Status" section. Mirrors the
// pattern in HostDashboard so the visual language is consistent across the app.
const TimelineRow = ({ done, icon: Icon, textEn, textBn, language, isFinal = false }) => (
  <div className="flex items-center gap-3">
    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
      done
        ? (isFinal ? 'bg-blue-500 text-white' : 'bg-green-500 text-white')
        : 'bg-gray-100 text-gray-400'
    }`}>
      {done ? (isFinal ? <BadgeCheck size={16} /> : <Check size={14} />) : <Icon size={14} />}
    </div>
    <p className={`text-sm font-black ${done ? 'text-gray-900' : 'text-gray-400'}`}>
      {language === 'বাংলা' ? textBn : textEn}
    </p>
  </div>
);

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  TrustGauge — circular 0-100 score with tier (Bronze/Silver/Gold/   ║
// ║  Platinum) + breakdown list. Lives in the right sidebar of the      ║
// ║  Profile tab. The headline metric landlords + tenants both see.     ║
// ╚══════════════════════════════════════════════════════════════════════╝
const TrustGauge = ({ score, tier, breakdown, language }) => {
  const r = 52;
  const c = 2 * Math.PI * r;
  const dash = (score / 100) * c;
  const tierMeta = {
    bronze:   { label: language === 'বাংলা' ? 'ব্রোঞ্জ' : 'Bronze',     color: '#a1764e', glow: 'rgba(161,118,78,0.20)' },
    silver:   { label: language === 'বাংলা' ? 'সিলভার' : 'Silver',     color: '#9ca3af', glow: 'rgba(156,163,175,0.20)' },
    gold:     { label: language === 'বাংলা' ? 'গোল্ড' : 'Gold',         color: '#d4a017', glow: 'rgba(212,160,23,0.25)' },
    platinum: { label: language === 'বাংলা' ? 'প্ল্যাটিনাম' : 'Platinum', color: '#3b82f6', glow: 'rgba(59,130,246,0.30)' },
  }[tier] || { label: 'Bronze', color: '#a1764e', glow: 'rgba(0,0,0,0.05)' };

  return (
    <div className="relative bg-gradient-to-br from-white to-gray-50/40 rounded-[2rem] border border-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.04)] p-6 md:p-8 overflow-hidden">
      {/* Tier-tinted halo for futuristic feel */}
      <div
        className="absolute -top-16 -right-16 w-48 h-48 rounded-full blur-3xl pointer-events-none"
        style={{ background: tierMeta.glow }}
      />
      <div className="relative z-10 flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-sm" style={{ background: `${tierMeta.color}18` }}>
          <ShieldCheck size={18} style={{ color: tierMeta.color }} />
        </div>
        <div>
          <h3 className="text-sm font-black text-gray-900">
            {language === 'বাংলা' ? 'ট্রাস্ট স্কোর' : 'Trust Score'}
          </h3>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
            {language === 'বাংলা' ? 'বাড়িওয়ালারা যা দেখে' : 'What landlords see'}
          </p>
        </div>
      </div>

      {/* Circular gauge */}
      <div className="relative z-10 flex flex-col items-center mb-6">
        <div className="relative" style={{ filter: `drop-shadow(0 8px 24px ${tierMeta.glow})` }}>
          <svg width="160" height="160" viewBox="0 0 160 160" className="-rotate-90">
            <defs>
              <linearGradient id={`grad-${tier}`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={tierMeta.color} stopOpacity="1" />
                <stop offset="100%" stopColor={tierMeta.color} stopOpacity="0.6" />
              </linearGradient>
            </defs>
            <circle cx="80" cy="80" r={r} fill="none" stroke="#f3f4f6" strokeWidth="11" />
            <circle
              cx="80" cy="80" r={r} fill="none"
              stroke={`url(#grad-${tier})`}
              strokeWidth="11"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${c}`}
              style={{ transition: 'stroke-dasharray 0.8s cubic-bezier(0.4, 0, 0.2, 1)' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {/* Big score with subtle gradient text — feels premium */}
            <div className="flex items-baseline gap-0.5">
              <span className="text-5xl font-black leading-none tabular-nums tracking-tight bg-gradient-to-br from-gray-900 to-gray-600 bg-clip-text text-transparent">{score}</span>
              <span className="text-base font-black text-gray-300 leading-none">/100</span>
            </div>
            <span className="text-[9px] font-black text-gray-400 uppercase tracking-[0.18em] mt-1.5">
              {language === 'বাংলা' ? 'স্কোর' : 'SCORE'}
            </span>
          </div>
        </div>
        <div
          className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border shadow-sm"
          style={{ background: `${tierMeta.color}15`, color: tierMeta.color, borderColor: `${tierMeta.color}30` }}
        >
          <BadgeCheck size={12} /> {tierMeta.label}
        </div>
      </div>

      {/* Breakdown list */}
      <div className="relative z-10 space-y-2">
        {breakdown.map((b) => (
          <div key={b.key} className="flex items-center justify-between text-[11px] font-bold">
            <span className={`flex items-center gap-2 ${b.done ? 'text-gray-700' : 'text-gray-400'}`}>
              <span className={`w-4 h-4 rounded-full flex items-center justify-center ${b.done ? 'bg-green-500 text-white shadow-[0_0_0_3px_rgba(34,197,94,0.12)]' : 'bg-gray-100'}`}>
                {b.done ? <Check size={10} /> : null}
              </span>
              {language === 'বাংলা' ? b.labelBn : b.labelEn}
            </span>
            <span className={`tabular-nums ${b.done ? 'text-green-600' : 'text-gray-300'}`}>+{b.pts}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  QuickWinsCard — top 3 unfilled high-impact items the user can      ║
// ║  knock out fastest to raise their Trust Score.                       ║
// ╚══════════════════════════════════════════════════════════════════════╝
const QuickWinsCard = ({ breakdown, language, onJump }) => {
  // Suggest the 3 highest-value unfilled items.
  const top = [...breakdown].filter((b) => !b.done).sort((a, b) => b.pts - a.pts).slice(0, 3);
  if (top.length === 0) {
    return (
      <div className="bg-gradient-to-br from-emerald-50 via-green-50 to-white rounded-[2rem] border border-emerald-100 shadow-[0_4px_20px_rgba(16,185,129,0.08)] p-6 md:p-8">
        <div className="flex items-center gap-3 mb-2">
          <BadgeCheck className="text-emerald-600" size={20} />
          <h3 className="text-sm font-black text-gray-900">{language === 'বাংলা' ? 'প্রোফাইল সম্পূর্ণ! 🎉' : 'Profile Complete! 🎉'}</h3>
        </div>
        <p className="text-xs font-bold text-gray-600 leading-relaxed">
          {language === 'বাংলা' ? 'অসাধারণ! আপনার প্রোফাইল ১০০% — বাড়িওয়ালাদের কাছে আপনি এখন প্ল্যাটিনাম।' : 'You hit max Trust Score. Landlords see you as Platinum tier.'}
        </p>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-[2rem] border border-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.04)] p-6 md:p-8">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-[#ba0036]/10 flex items-center justify-center">
          <Edit3 className="text-[#ba0036]" size={18} />
        </div>
        <div>
          <h3 className="text-sm font-black text-gray-900">{language === 'বাংলা' ? 'দ্রুত উন্নতি' : 'Quick Wins'}</h3>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'স্কোর বাড়ান' : 'Boost your score'}</p>
        </div>
      </div>
      <div className="space-y-2">
        {top.map((b) => (
          <button
            key={b.key}
            onClick={() => onJump && onJump(b.key)}
            className="w-full flex items-center justify-between p-3 rounded-xl bg-gray-50 hover:bg-[#ba0036]/5 border border-gray-100 hover:border-[#ba0036]/20 transition-all group text-left"
          >
            <span className="text-[12px] font-black text-gray-800 group-hover:text-[#ba0036] transition-colors">{language === 'বাংলা' ? b.labelBn : b.labelEn}</span>
            <span className="bg-[#ba0036]/10 text-[#ba0036] px-2 py-0.5 rounded-full text-[10px] font-black">+{b.pts}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default TenantDashboard;
