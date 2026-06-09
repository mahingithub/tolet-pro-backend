import React, { useState, useEffect, useRef } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import {
  ChevronDown, User, Globe, Home, Building2,
  Check, X, LogOut, LayoutDashboard, Heart, MessageSquare,
  RefreshCw, ShieldAlert, ArrowRight, Search, ChevronRight,
  Bell, Sparkles, PlusCircle, BarChart2,
  UserCircle, MapPin, SlidersHorizontal,
  FileText, Phone, BookOpen, PenLine, HelpCircle,
  Settings as SettingsIcon, LifeBuoy
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext.jsx';
import NotificationBell from './NotificationBell';

const languages = [{ code: 'en', name: 'English' }, { code: 'bn', name: 'বাংলা' }];

const locationData = {
  en: [
    { id: 'dhaka',      name: 'DHAKA',      districts: ['Dhaka','Faridpur','Gazipur','Gopalganj','Kishoreganj','Madaripur','Manikganj','Munshiganj','Narayanganj','Narsingdi','Rajbari','Shariatpur','Tangail'] },
    { id: 'chittagong', name: 'CHITTAGONG', districts: ["Chattogram","Bandarban","Brahmanbaria","Chandpur","Comilla","Cox's Bazar","Feni","Khagrachari","Lakshmipur","Noakhali","Rangamati"] },
    { id: 'sylhet',     name: 'SYLHET',     districts: ['Sylhet','Habiganj','Moulvibazar','Sunamganj'] },
    { id: 'rajshahi',   name: 'RAJSHAHI',   districts: ['Rajshahi','Bogura','Chapainawabganj','Joypurhat','Naogaon','Natore','Pabna','Sirajganj'] },
    { id: 'khulna',     name: 'KHULNA',     districts: ['Khulna','Bagerhat','Chuadanga','Jashore','Jhenaidah','Kushtia','Magura','Meherpur','Narail','Satkhira'] },
    { id: 'barishal',   name: 'BARISHAL',   districts: ['Barishal','Barguna','Bhola','Jhalokati','Patuakhali','Pirojpur'] },
    { id: 'rangpur',    name: 'RANGPUR',    districts: ['Rangpur','Dinajpur','Gaibandha','Kurigram','Lalmonirhat','Nilphamari','Panchagarh','Thakurgaon'] },
    { id: 'mymensingh', name: 'MYMENSINGH', districts: ['Mymensingh','Jamalpur','Netrokona','Sherpur'] },
  ],
  bn: [
    { id: 'dhaka',      name: 'ঢাকা',      districts: ['ঢাকা','ফরিদপুর','গাজীপুর','গোপালগঞ্জ','কিশোরগঞ্জ','মাদারীপুর','মানিকগঞ্জ','মুন্সীগঞ্জ','নারায়ণগঞ্জ','নরসিংদী','রাজবাড়ী','শরীয়তপুর','টাঙ্গাইল'] },
    { id: 'chittagong', name: 'চট্টগ্রাম', districts: ['চট্টগ্রাম','বান্দরবান','ব্রাহ্মণবাড়িয়া','চাঁদপুর','কুমিল্লা','কক্সবাজার','ফেনী','খাগড়াছড়ি','লক্ষ্মীপুর','নোয়াখালী','রাঙ্গামাটি'] },
    { id: 'sylhet',     name: 'সিলেট',     districts: ['সিলেট','হবিগঞ্জ','মৌলভীবাজার','সুনামগঞ্জ'] },
    { id: 'rajshahi',   name: 'রাজশাহী',   districts: ['রাজশাহী','বগুড়া','চাঁপাইনবাবগঞ্জ','জয়পুরহাট','নওগাঁ','নাটোর','পাবনা','সিরাজগঞ্জ'] },
    { id: 'khulna',     name: 'খুলনা',     districts: ['খুলনা','বাগেরহাট','চুয়াডাঙ্গা','যশোর','ঝিনাইদহ','কুষ্টিয়া','মাগুরা','মেহেরপুর','নড়াইল','সাতক্ষীরা'] },
    { id: 'barishal',   name: 'বরিশাল',    districts: ['বরিশাল','বরগুনা','ভোলা','ঝালকাঠি','পটুয়াখালী','পিরোজপুর'] },
    { id: 'rangpur',    name: 'রংপুর',     districts: ['রংপুর','দিনাজপুর','গাইবান্ধা','কুড়িগ্রাম','লালমনিরহাট','নীলফামারী','পঞ্চগড়','ঠাকুরগাঁও'] },
    { id: 'mymensingh', name: 'ময়মনসিংহ', districts: ['ময়মনসিংহ','জামালপুর','নেত্রকোনা','শেরপুর'] },
  ],
};

const allSuggestions = [
  { id: 'gulshan',      title: 'Gulshan, Dhaka',        type: 'Premium Area',    category: 'area' },
  { id: 'banani',       title: 'Banani, Dhaka',         type: 'Popular Search',  category: 'area' },
  { id: 'dhanmondi',    title: 'Dhanmondi, Dhaka',      type: 'Family Hub',      category: 'area' },
  { id: 'bashundhara',  title: 'Bashundhara R/A',       type: 'Residential',     category: 'area' },
  { id: 'uttara',       title: 'Uttara, Dhaka',         type: 'Planned City',    category: 'area' },
  { id: 'mirpur',       title: 'Mirpur, Dhaka',         type: 'Budget Friendly', category: 'area' },
  { id: 'mohammadpur',  title: 'Mohammadpur, Dhaka',    type: 'Residential',     category: 'area' },
  { id: 'rampura',      title: 'Rampura, Dhaka',        type: 'Area',            category: 'area' },
  { id: 'malibagh',     title: 'Malibagh, Dhaka',       type: 'Area',            category: 'area' },
  { id: 'khilgaon',     title: 'Khilgaon, Dhaka',       type: 'Area',            category: 'area' },
  { id: 'badda',        title: 'Badda, Dhaka',          type: 'Area',            category: 'area' },
  { id: 'tejgaon',      title: 'Tejgaon, Dhaka',        type: 'Commercial Zone', category: 'area' },
  { id: 'shyamoli',     title: 'Shyamoli, Dhaka',       type: 'Residential',     category: 'area' },
  { id: 'lalmatia',     title: 'Lalmatia, Dhaka',       type: 'Residential',     category: 'area' },
  { id: 'nawabganj',    title: 'Nawabganj, Dhaka',      type: 'District',        category: 'district' },
  { id: 'sylhet',       title: 'Sylhet City',           type: 'Division',        category: 'city' },
  { id: 'chittagong',   title: 'Chattogram City',       type: 'Division',        category: 'city' },
  { id: 'rajshahi',     title: 'Rajshahi City',         type: 'Division',        category: 'city' },
  { id: 'khulna',       title: 'Khulna City',           type: 'Division',        category: 'city' },
  { id: 'barishal',     title: 'Barishal City',         type: 'Division',        category: 'city' },
  { id: 'rangpur',      title: 'Rangpur City',          type: 'Division',        category: 'city' },
  { id: 'mymensingh',   title: 'Mymensingh City',       type: 'Division',        category: 'city' },
  { id: 'pabna',        title: 'Pabna',                 type: 'District',        category: 'district' },
  { id: 'bogura',       title: 'Bogura',                type: 'District',        category: 'district' },
  { id: 'comilla',      title: 'Comilla',               type: 'District',        category: 'district' },
  { id: 'noakhali',     title: 'Noakhali',              type: 'District',        category: 'district' },
  { id: 'gazipur',      title: 'Gazipur',               type: 'District',        category: 'district' },
  { id: 'narayanganj',  title: 'Narayanganj',           type: 'District',        category: 'district' },
  { id: 'tangail',      title: 'Tangail',               type: 'District',        category: 'district' },
  { id: 'ps_family',    title: 'Family Apartment Dhaka',type: 'Popular Search',  category: 'search' },
  { id: 'ps_bach',      title: 'Bachelor Flat Mirpur',  type: 'Popular Search',  category: 'search' },
  { id: 'ps_sublet',    title: 'Sublet Room Dhanmondi', type: 'Popular Search',  category: 'search' },
  { id: 'ps_office',    title: 'Office Space Gulshan',  type: 'Popular Search',  category: 'search' },
];

const exploreLinks = [
  { Icon: Home,          color: 'text-[#ba0036]', bg: 'bg-red-50',      label: 'Home',            path: '/' },
  { Icon: Search,        color: 'text-blue-500',  bg: 'bg-blue-50',     label: 'All Properties',  path: '/properties/all' },
  { Icon: PlusCircle,    color: 'text-[#ba0036]', bg: 'bg-red-50',      label: 'List a Property', path: '/list-property', protected: true },
];
const toolLinks = [
  { Icon: Sparkles,      color: 'text-[#ba0036]', bg: 'bg-red-50',      label: 'AI Insights',      path: '/ai-insights',  badge: 'NEW' },
  { Icon: Bell,          color: 'text-amber-500', bg: 'bg-amber-50',    label: 'Smart Alerts',     path: '/smart-alerts' },
  { Icon: MessageSquare, color: 'text-blue-500',  bg: 'bg-blue-50',     label: 'Chat & Inquiries', path: '/inquiry' },
  { Icon: BarChart2,     color: 'text-violet-500',bg: 'bg-violet-50',   label: 'Market Insights',  path: '/ai-insights' },
];
const tenantLinks = [
  { Icon: LayoutDashboard, color: 'text-blue-600',  bg: 'bg-blue-50',   label: 'Tenant Dashboard',  path: '/tenant-dashboard' },
  { Icon: Heart,           color: 'text-rose-500',  bg: 'bg-rose-50',   label: 'Saved Properties',  path: '/saved-properties' },
  { Icon: MessageSquare,   color: 'text-blue-500',  bg: 'bg-blue-50',   label: 'My Inquiries',      path: '/inquiry' },
  { Icon: Bell,            color: 'text-amber-500', bg: 'bg-amber-50',  label: 'My Alerts',         path: '/smart-alerts' },
];
const hostLinks = [
  { Icon: LayoutDashboard, color: 'text-[#ba0036]',  bg: 'bg-red-50',    label: 'Host Dashboard',    path: '/host-dashboard' },
  { Icon: PlusCircle,      color: 'text-emerald-600', bg: 'bg-emerald-50',label: 'Add Property',      path: '/list-property' },
  { Icon: BarChart2,       color: 'text-violet-500',  bg: 'bg-violet-50', label: 'Listing Analytics', path: '/ai-insights' },
  { Icon: MessageSquare,   color: 'text-blue-500',    bg: 'bg-blue-50',   label: 'Tenant Messages',   path: '/inquiry' },
];

// Mobile-only "Footer" rows mirrored from the Canva mockup so the drawer feels
// like a complete app shell rather than a half-baked menu. These reuse the
// same Row component (icon + label + chevron). Routes fall back to the
// homepage where target pages don't exist yet — the drawer still feels complete.
const footerLinks = [
  { Icon: FileText,  color: 'text-gray-600',   bg: 'bg-gray-100',    label: 'Guest policy', path: '/' },
  { Icon: Phone,     color: 'text-emerald-600',bg: 'bg-emerald-50',  label: 'Call us',      path: '/' },
  { Icon: BookOpen,  color: 'text-blue-500',   bg: 'bg-blue-50',     label: 'Our story',    path: '/' },
  { Icon: PenLine,   color: 'text-violet-500', bg: 'bg-violet-50',   label: 'Blogs',        path: '/' },
  { Icon: HelpCircle,color: 'text-amber-600',  bg: 'bg-amber-50',    label: 'FAQs',         path: '/' },
];

// Bottom "Settings" pair the user expects at the very end of every drawer.
const settingsLinks = [
  { Icon: SettingsIcon, color: 'text-gray-700', bg: 'bg-gray-100',  label: 'Account Settings', path: '/' },
  { Icon: LifeBuoy,     color: 'text-[#ba0036]',bg: 'bg-red-50',    label: 'Help & Support',   path: '/' },
];

const Navbar = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const langContext  = useLanguage() || {};
  const t            = langContext.t || {};
  const language     = langContext.language || 'English';
  const setLanguage  = langContext.setLanguage || (() => {});
  const langCode     = language === 'বাংলা' ? 'bn' : 'en';
  const currentData  = locationData[langCode] || locationData['en'];

  // Single source of truth: the AuthContext. The desktop "Login / Signup"
  // button used to be tied to a separate local `isLoggedIn` boolean that
  // never flipped after authentication, so the header never swapped to the
  // profile chip. We now derive every displayed identity from `auth.user`
  // directly so the header reacts the instant login/logout/cross-tab sync
  // fires.
  const auth = useAuth?.() || {};
  const isAuthed   = !!auth.isAuthenticated;
  const isLoggedIn = isAuthed;
  const authUser   = auth.user || null;
  const userName   = authUser?.name || authUser?.fullName || (isAuthed ? 'My Account' : '');
  const userEmail  = authUser?.email || authUser?.phone || '';

  // `userRole` mirrors the active role on the server (auth.activeRole).
  // Switching the pill calls into the AuthContext so the change is
  // persisted across tabs / page reloads — the old local-only toggle
  // would lose the choice the moment the user navigated away.
  const activeRoleFromAuth = auth.activeRole
    || ((authUser?.role === 'landlord' || authUser?.role === 'host') ? 'landlord' : 'tenant');
  const [userRole, setUserRole] = useState(activeRoleFromAuth);
  useEffect(() => { setUserRole(activeRoleFromAuth); }, [activeRoleFromAuth]);

  // Switch the active role. If the user hasn't unlocked the destination
  // role yet (e.g. they're a tenant who has never posted a listing),
  // call addRole() first so the server-side roles[] gets `landlord`
  // appended before we activate it. Errors are swallowed deliberately —
  // the pill is a quality-of-life toggle, not a blocking flow.
  //
  // After a successful switch we ALWAYS navigate to the destination
  // role's dashboard and close the profile dropdown — otherwise the
  // pill flips silently and the user sees "nothing happens" (the exact
  // complaint in the screen recording at frame 1: profile menu open,
  // "Switch to Tenant" clicked, no visible change).
  const handleSwitchRole = async () => {
    const target = userRole === 'tenant' ? 'landlord' : 'tenant';

    // Intercept action: Evaluate the user's current verification status
    if (target === 'landlord') {
      const isVerified = authUser?.tenantProfile?.verification?.status === 'verified' || authUser?.landlordProfile?.verification?.status === 'verified';
      
      // Failure Scenario: If NOT Verified, block role switch and open Verification Modal
      if (!isVerified) {
        closeAll();
        setShowVerificationModal(true);
        return;
      }
    }

    // Success Scenario (If Verified): optimistic switch and proceed
    setUserRole(target);
    try {
      const owns = Array.isArray(auth.roles) && auth.roles.includes(target);
      if (!owns) await auth.addRole?.(target);
      await auth.setActiveRole?.(target);
      // Tear down any open menus before navigating so the destination
      // page isn't half-hidden by a leftover dropdown.
      closeAll();
      navigate(target === 'landlord' ? '/host-dashboard' : '/tenant-dashboard');
    } catch (err) {
      // Revert optimistic switch on any other error
      setUserRole(userRole);
      if (err?.code === 'verification_required') {
        closeAll();
        setShowVerificationModal(true);
      }
    }
  };

  /** Bell icon target: guests are routed to /login with a next-param so
   *  they bounce back to /smart-alerts after authentication. */
  const handleNotificationClick = () => {
    if (isAuthed) navigate('/smart-alerts');
    else          navigate('/login?next=%2Fsmart-alerts');
  };

  // Centralized logout that talks to the real auth context. Falls back to
  // a navigate('/login') so the user is never left in a half-logged-out
  // state if the service throws.
  const handleLogout = async () => {
    try { await auth.logout?.(); }
    catch { /* swallow — we still want to close the menu */ }
    closeAll();
  };

  const [showAuthModal,     setShowAuthModal]     = useState(false);
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [isLangMenuOpen,    setIsLangMenuOpen]    = useState(false);
  const [isMobileMenuOpen,  setIsMobileMenuOpen]  = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [expandedDiv,       setExpandedDiv]       = useState(null);

  const [isScrolled,    setIsScrolled]    = useState(false);
  const [navLoc,        setNavLoc]        = useState('');
  const [navLocOpen,    setNavLocOpen]    = useState(false);
  const [navTypeOpen,   setNavTypeOpen]   = useState(false);
  const [navType,       setNavType]       = useState({ id: 'any', label: 'Any Property' });

  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const [mobileNavLoc,       setMobileNavLoc]       = useState('');
  const [mobileNavLocOpen,   setMobileNavLocOpen]   = useState(false);
  
  const mobileNavLocRef = useRef(null);
  const navLocRef  = useRef(null);
  const navTypeRef = useRef(null);
  // Separate refs for the desktop and mobile language pickers — both render
  // simultaneously (one is just `display:none` at its non-target breakpoint),
  // so sharing a single ref made the outside-click handler always see the
  // *last* assignment (the mobile one). Result: the desktop dropdown was
  // closed on every click and never actually toggled languages.
  const langRef       = useRef(null);
  const mobileLangRef = useRef(null);
  const profileRef = useRef(null);

  // ⚠️  IDs must match `rentalCategory` values in propertyService.js
  const navPropertyTypes = [
    { id: 'any',            label: 'Any Property' },
    { id: 'family',         label: 'Family Apt.' },
    { id: 'bachelor_male',  label: 'Bachelor (M)' },
    { id: 'bachelor_female',label: 'Bachelor (F)' },
    { id: 'sublet',         label: 'Sublet / Room' },
    { id: 'commercial',     label: 'Commercial' },
  ];

  useEffect(() => {
    const handler = e => {
      // Close the language menu only if the click is outside BOTH the
      // desktop trigger and the mobile pill — otherwise clicking the
      // visible trigger at one breakpoint looks "outside" the other one.
      const insideLang =
        (langRef.current       && langRef.current.contains(e.target)) ||
        (mobileLangRef.current && mobileLangRef.current.contains(e.target));
      if (!insideLang) setIsLangMenuOpen(false);
      if (profileRef.current && !profileRef.current.contains(e.target)) setIsProfileMenuOpen(false);
      if (navLocRef.current  && !navLocRef.current.contains(e.target))  setNavLocOpen(false);
      if (navTypeRef.current && !navTypeRef.current.contains(e.target)) setNavTypeOpen(false);
      if (mobileNavLocRef.current && !mobileNavLocRef.current.contains(e.target)) setMobileNavLocOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Sync navbar search state from URL whenever the route changes ────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // 'category' is used by HeroSection for rental category (family/bachelor_male/…)
    const urlCategory = params.get('category');
    if (urlCategory) {
      const match = navPropertyTypes.find(t => t.id === urlCategory);
      if (match) setNavType(match);
    }
    // Pre-fill the location input ONLY for the plural /properties/:area listing
    // route. The singular /property/:id details route carries a numeric ID, not
    // a location — so we must skip it (otherwise the navbar shows "14" etc.).
    if (!location.pathname.startsWith('/properties/')) return;
    const pathParts = window.location.pathname.split('/');
    const divisionSegment = pathParts[pathParts.length - 1];
    const KNOWN_DIVISIONS = ['dhaka','chittagong','sylhet','rajshahi','khulna','barishal','rangpur','mymensingh','all'];
    // Defensive: never echo a purely-numeric segment into the location input.
    if (divisionSegment && !KNOWN_DIVISIONS.includes(divisionSegment) && !/^\d+$/.test(divisionSegment)) {
      // Custom area search like "dhanmondi-dhaka" — show nicely in navbar
      setNavLoc(divisionSegment.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // Line 175 remains the same
}, [location.pathname, location.search]);

// Replace lines 176 to 187 with this correct block:
useEffect(() => {
  let ticking = false;
  
  const onScroll = () => {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        setIsScrolled(window.scrollY > 400);
        ticking = false;
      });
      ticking = true;
    }
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  
  return () => window.removeEventListener('scroll', onScroll);
}, []);

// Line 188 onwards remains the same
useEffect(() => {
  if (isMobileMenuOpen || showAuthModal) {
      const sy = window.scrollY;
      document.body.style.cssText = `overflow:hidden;position:fixed;top:-${sy}px;width:100%`;
    } else {
      const top = document.body.style.top;
      document.body.style.cssText = '';
      if (top) window.scrollTo({ top: -parseInt(top, 10), behavior: 'instant' });
    }
    return () => { document.body.style.cssText = ''; };
  }, [isMobileMenuOpen, showAuthModal, showVerificationModal]);

  // The bottom-nav Profile tab opens this drawer for logged-out users. It
  // dispatches a 'open-mobile-menu' custom event on window; we listen for it
  // here so we don't need a shared context.
  useEffect(() => {
    const handler = () => setIsMobileMenuOpen(true);
    window.addEventListener('open-mobile-menu', handler);
    return () => window.removeEventListener('open-mobile-menu', handler);
  }, []);

  const closeAll = () => { setIsMobileMenuOpen(false); setIsProfileMenuOpen(false); setShowVerificationModal(false); };

  const go = path => { navigate(path); closeAll(); };

  const handleProtected = path => {
    if (isLoggedIn) go(path);
    else { setShowAuthModal(true); setIsMobileMenuOpen(false); }
  };

  const initials = name => {
    const n = (name || '').trim();
    if (!n) return 'U';
    return n.split(/\s+/).map(p => p[0] || '').join('').slice(0, 2).toUpperCase() || 'U';
  };

  const hiddenPaths = ['/inquire', '/success', '/login', '/host-dashboard', '/tenant-dashboard', '/list-property'];
  if (hiddenPaths.some(p => location.pathname.includes(p))) return null;

  // `compactHeader` keeps the centred search bar visible by default on the
  // properties LISTING route (e.g. /properties/dhaka) where users actively
  // search. On the singular /property/:id DETAILS route we deliberately let
  // the bar follow the same scroll-reveal behaviour as the home page — i.e.
  // it stays hidden until the user scrolls (matches the mobile pattern the
  // designer asked for).
  const compactHeader = /^\/properties\/[^/]+/.test(location.pathname) && !location.pathname.includes('/properties/all');

  const Row = ({ Icon, color, bg, label, path, badge, onClick }) => (
    <button
      onClick={onClick ?? (() => go(path))}
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white active:scale-[0.98] transition-all text-left w-full group"
    >
      <div className={`w-8 h-8 rounded-xl ${bg} flex items-center justify-center shrink-0`}>
        <Icon size={16} className={color} />
      </div>
      <span className="font-bold text-sm text-gray-800 flex-1">{label}</span>
      {badge && <span className="text-[8px] font-black bg-[#ba0036] text-white px-1.5 py-0.5 rounded-full uppercase tracking-widest">{badge}</span>}
      <ChevronRight size={13} className="text-gray-300 shrink-0" />
    </button>
  );

  const [liveSuggestions, setLiveSuggestions] = useState([]);
  const [mobileLiveSuggestions, setMobileLiveSuggestions] = useState([]);

  useEffect(() => {
    const raw = navLoc.trim();
    if (raw.length < 2) {
      setLiveSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';
        const res = await fetch(`${API}/properties/suggestions?q=${encodeURIComponent(raw)}`);
        if (res.ok) {
          const data = await res.json();
          setLiveSuggestions(data.suggestions || []);
        }
      } catch (err) {
        console.error('Navbar autocomplete fetch error:', err);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [navLoc]);

  useEffect(() => {
    const raw = mobileNavLoc.trim();
    if (raw.length < 2) {
      setMobileLiveSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';
        const res = await fetch(`${API}/properties/suggestions?q=${encodeURIComponent(raw)}`);
        if (res.ok) {
          const data = await res.json();
          setMobileLiveSuggestions(data.suggestions || []);
        }
      } catch (err) {
        console.error('Mobile Navbar autocomplete fetch error:', err);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [mobileNavLoc]);

  const getFilteredSuggestions = (q, liveData) => {
    const staticMatches = allSuggestions.filter(s => s.title.toLowerCase().includes(q));
    const dynMatches = liveData.flatMap(p => {
      const entries = [];
      if (p?.location && p.location.toLowerCase().includes(q))
        entries.push({ id: `nloc-${p.id}`, title: p.location, type: 'Property Area', category: 'area' });
      if (p?.area && p.area.toLowerCase().includes(q))
        entries.push({ id: `narea-${p.id}`, title: p.area, type: 'Area', category: 'area' });
      if (p?.title && p.title.toLowerCase().includes(q))
        entries.push({ id: `ntitle-${p.id}`, title: p.title, type: 'Property', category: 'search' });
      return entries;
    });

    return [...staticMatches, ...dynMatches].filter(
      (s, i, arr) => arr.findIndex(x => x.title.toLowerCase() === s.title.toLowerCase()) === i
    );
  };

  return (
    <>
      {/* z-[60] keeps this global header (and its city dropdowns) ABOVE every
          route-level sticky bar (e.g. the PropertyDetails page nav at z-30),
          regardless of any wrapper that React Router or animation libs may
          add between the navbar and the routed page. */}
      <header className={`w-full bg-white/95 backdrop-blur-2xl font-sans sticky top-0 z-[60] transition-all duration-300 ease-in-out ${isScrolled ? 'shadow-[0_4px_24px_rgba(0,0,0,0.10)] border-b border-gray-100/80' : 'border-b border-gray-100 shadow-[0_2px_12px_rgba(0,0,0,0.03)]'}`}>

        <div className="w-full max-w-[1400px] mx-auto px-3 sm:px-4 lg:px-6 flex items-center gap-2.5 md:gap-4 h-[56px] md:h-[64px]">

          <a href="/" className="flex items-center gap-2 md:gap-2.5 cursor-pointer group shrink-0">
            <div className="bg-[#ba0036] p-1.5 md:p-2 rounded-xl shadow-[0_4px_15px_rgba(186,0,54,0.3)] group-hover:scale-105 transition-transform duration-300">
              <Building2 className="text-white w-4 h-4 md:w-[18px] md:h-[18px]" />
            </div>
            <h1 className="font-black text-base md:text-lg lg:text-xl tracking-tighter">
              <span className="text-gray-900">TO-LET</span> <span className="text-[#ba0036]">PRO</span>
            </h1>
            {/* Beta badge (Phase 7) — signals the app is in beta testing. */}
            <span className="ml-1 px-1.5 py-0.5 text-[9px] md:text-[10px] font-black uppercase tracking-wider text-[#ba0036] bg-red-50 border border-[#ba0036]/30 rounded-md leading-none self-center">
              Beta
            </span>
          </a>

          <div className={`hidden md:flex flex-1 justify-center transition-all duration-300 ${(isScrolled || compactHeader) ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 -translate-y-2 pointer-events-none absolute'}`}>
            <div className="w-full max-w-[580px] flex items-center bg-gradient-to-br from-white via-slate-50/80 to-white backdrop-blur-xl backdrop-saturate-[180%] border border-slate-200/80 rounded-full shadow-[inset_0_1.5px_0_rgba(255,255,255,1),inset_0_-1px_0_rgba(15,23,42,0.04),0_10px_28px_rgba(15,23,42,0.10)] hover:shadow-[inset_0_1.5px_0_rgba(255,255,255,1),inset_0_-1px_0_rgba(15,23,42,0.04),0_14px_36px_rgba(186,0,54,0.18)] hover:border-[#ba0036]/40 transition-all duration-200 overflow-visible">

              <div className="flex-1 flex items-center gap-2.5 pl-5 pr-3 py-0 relative min-w-0 rounded-l-full" ref={navLocRef}>
                <MapPin size={14} className="text-[#ba0036] shrink-0" />
                <input
                  type="text"
                  value={navLoc}
                  onChange={e => { setNavLoc(e.target.value); setNavLocOpen(true); }}
                  onFocus={() => setNavLocOpen(true)}
                  onKeyDown={e => {
                    if (e.key === 'Enter')  { setNavLocOpen(false); const slug = navLoc.trim() ? navLoc.trim().toLowerCase().replace(/,?\s+/g, '-') : 'all'; navigate(`/properties/${slug}?category=${navType.id}`); }
                    if (e.key === 'Escape') setNavLocOpen(false);
                  }}
                  placeholder="Area, district, city…"
                  className="bg-transparent outline-none border-none w-full text-sm font-bold text-gray-900 placeholder-gray-400 py-3 min-w-0"
                  autoComplete="off"
                />
                {navLoc && (
                  <button onMouseDown={e => e.preventDefault()} onClick={() => { setNavLoc(''); setNavLocOpen(false); }} className="shrink-0">
                    <X size={12} className="text-gray-400 hover:text-gray-600" />
                  </button>
                )}

                {navLocOpen && (
                  <div className="absolute top-[calc(100%+8px)] left-0 w-[320px] bg-white rounded-2xl shadow-[0_16px_48px_rgba(0,0,0,0.12)] border border-gray-100 z-[500] overflow-hidden">
                    {!navLoc && (
                      <div className="px-3 pt-3 pb-2 border-b border-gray-50">
                        <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2">Popular Areas</p>
                        <div className="flex flex-wrap gap-1.5">
                          {['Dhanmondi','Gulshan','Banani','Uttara','Mirpur'].map(chip => (
                            <button key={chip} onMouseDown={e => e.preventDefault()} onClick={() => { setNavLoc(chip + ', Dhaka'); setNavLocOpen(false); }}
                              className="text-[10px] font-bold text-gray-700 bg-gray-100 hover:bg-red-50 hover:text-[#ba0036] px-2.5 py-1 rounded-full transition-colors">
                              {chip}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {navLoc && (() => {
                      const q = navLoc.trim().toLowerCase();
                      const matches = getFilteredSuggestions(q, liveSuggestions);
                      const results = matches.length > 0 ? matches.slice(0, 7) : [
                        { id: `dyn-${q}`, title: navLoc.trim(), type: 'Search Anywhere', category: 'search' },
                        { id: `dyn-bd-${q}`, title: `${navLoc.trim()}, Bangladesh`, type: 'Location', category: 'city' },
                      ];
                      return (
                        <div className="py-1 max-h-[240px] overflow-y-auto">
                          {results.map(s => (
                            <button key={s.id} onMouseDown={e => e.preventDefault()}
                              onClick={() => { setNavLoc(s.title); setNavLocOpen(false); }}
                              className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-red-50 transition-colors text-left">
                              <div className={`p-1.5 rounded-lg shrink-0 ${s.category === 'city' ? 'bg-blue-50' : s.category === 'search' ? 'bg-red-50' : 'bg-emerald-50'}`}>
                                {s.category === 'city'   ? <Building2 size={12} className="text-blue-500" /> :
                                 s.category === 'search' ? <Search    size={12} className="text-[#ba0036]" /> :
                                                           <MapPin    size={12} className="text-emerald-600" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-bold text-sm text-gray-900 truncate">{s.title}</p>
                                <p className="text-[10px] font-medium text-gray-400">{s.type}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                    {navLoc && (
                      <button onMouseDown={e => e.preventDefault()} onClick={() => { setNavLocOpen(false); const slug = navLoc.trim() ? navLoc.trim().toLowerCase().replace(/,?\s+/g, '-') : 'all'; navigate(`/properties/${slug}?category=${navType.id}`); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-red-50 transition-colors text-left border-t border-gray-50">
                        <div className="bg-[#ba0036] p-1.5 rounded-lg text-white shrink-0"><Search size={12} /></div>
                        <span className="font-bold text-sm text-[#ba0036] truncate">Search for "{navLoc}"</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="w-px h-5 bg-gray-200/80 shrink-0" />

              <div className="relative shrink-0" ref={navTypeRef}>
                <button onClick={() => setNavTypeOpen(v => !v)}
                  className="flex items-center gap-1.5 px-4 py-3 text-sm font-bold text-gray-700 hover:text-gray-900 transition-colors whitespace-nowrap">
                  <SlidersHorizontal size={13} className="text-gray-400" />
                  <span className="max-w-[90px] truncate">{navType.label}</span>
                  <ChevronDown size={11} className={`text-gray-400 transition-transform duration-200 ${navTypeOpen ? 'rotate-180' : ''}`} />
                </button>
                {navTypeOpen && (
                  <div className="absolute top-[calc(100%+8px)] right-0 w-[190px] bg-white/95 backdrop-blur-xl rounded-2xl shadow-[0_16px_40px_rgba(15,23,42,0.14)] border border-white/80 ring-1 ring-inset ring-white/50 p-1.5 z-[500]">
                    {navPropertyTypes.map(t => (
                      <button key={t.id} onClick={() => { setNavType(t); setNavTypeOpen(false); }}
                        className={`w-full text-left px-3 py-2 rounded-full text-sm font-bold flex items-center justify-between transition-colors ${navType.id === t.id ? 'bg-[#ba0036] text-white' : 'text-gray-700 hover:bg-gray-100'}`}>
                        {t.label}
                        {navType.id === t.id && <Check size={13} className="text-white" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={() => {
                  const slug = navLoc.trim() ? navLoc.trim().toLowerCase().replace(/,?\s+/g, '-') : 'all';
                  navigate(`/properties/${slug}?category=${navType.id}`);
                }}
                className="shrink-0 m-1.5 bg-[#ba0036] hover:bg-[#a0002d] text-white px-5 py-2 rounded-full font-black text-xs flex items-center gap-1.5 transition-all active:scale-95 whitespace-nowrap shadow-[0_6px_18px_rgba(186,0,54,0.3)] border-none"
              >
                <Search size={13} /> Search
              </button>
            </div>
          </div>

          <div className={`hidden md:flex items-center gap-3 text-sm font-bold text-gray-700 ${(isScrolled || compactHeader) ? '' : 'ml-auto'}`}>

            {/* Desktop notification bell with unread badge + dropdown. */}
            {isAuthed && <NotificationBell isAuthed={isAuthed} />}

            {/* List Property Desktop Button (Always Visible) */}
            <button
              onClick={() => handleProtected('/list-property')}
              className="group relative flex items-center gap-2.5 overflow-hidden rounded-full pl-1.5 pr-4 py-1.5 font-black text-xs whitespace-nowrap text-white transition-all duration-300 active:scale-95 shadow-[0_6px_20px_-4px_rgba(186,0,54,0.5)] hover:shadow-[0_12px_30px_-6px_rgba(186,0,54,0.65)] hover:-translate-y-0.5"
              style={{ background: 'linear-gradient(135deg,#e8004e 0%,#ba0036 100%)' }}
            >
              {/* brighten on hover */}
              <span className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ background: 'linear-gradient(135deg,#ff2168 0%,#cc003c 100%)' }} />
              {/* top gloss highlight for depth */}
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
              {/* subtle shine sweep on hover */}
              <span className="pointer-events-none absolute -inset-y-3 -left-12 w-10 -skew-x-12 bg-white/25 blur-md transition-all duration-700 ease-out group-hover:left-[115%]" />
              <span className="relative z-10 flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 ring-1 ring-white/30 shrink-0 transition-all duration-300 group-hover:bg-white/30 group-hover:scale-105">
                  <PlusCircle size={15} className="text-white" strokeWidth={2.5} />
                </span>
                {t?.listProperty || 'Post Property'}
                <span className="rounded-full bg-white px-2 py-[3px] text-[10px] font-extrabold leading-none tracking-wider text-[#ba0036] shadow-sm">FREE</span>
              </span>
            </button>

            <div className="relative" ref={langRef}>
              <div onClick={() => setIsLangMenuOpen(!isLangMenuOpen)} className="flex items-center gap-2 cursor-pointer hover:text-[#ba0036] transition-colors">
                <Globe size={16} /> <span>{language}</span>
                <ChevronDown size={14} className={`transition-transform duration-300 ${isLangMenuOpen ? 'rotate-180' : ''}`} />
              </div>
              {isLangMenuOpen && (
                <div className="absolute top-full right-0 mt-4 w-40 bg-white/95 backdrop-blur-3xl border border-white shadow-[0_20px_40px_rgba(0,0,0,0.1)] rounded-2xl p-2 z-[70]">
                  {languages.map(lang => (
                    <div key={lang.code} onClick={() => { if (setLanguage) setLanguage(lang.name); setIsLangMenuOpen(false); }}
                      className={`px-4 py-3 cursor-pointer rounded-xl text-sm font-bold flex items-center justify-between transition-all ${language === lang.name ? 'bg-red-50 text-[#ba0036]' : 'hover:bg-gray-50 text-gray-600'}`}>
                      {lang.name} {language === lang.name && <Check size={16} />}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="relative pl-2 border-l border-gray-200" ref={profileRef}>
              {isLoggedIn ? (
                <>
                  <div onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
                    className="flex items-center gap-3 cursor-pointer p-1.5 pr-4 bg-white hover:bg-gray-50 rounded-full border border-gray-200 shadow-sm transition-all">
                    <div className={`w-8 h-8 rounded-full overflow-hidden flex items-center justify-center text-white text-xs font-black ${userRole === 'landlord' ? 'bg-[#ba0036]' : 'bg-blue-500'}`}>
                      {authUser?.avatar ? (
                        <img
                          src={authUser.avatar}
                          alt={userName}
                          className="w-full h-full object-cover"
                          // Avatar URL সাময়িকভাবে 404 দিলে initials fallback দেখাবে,
                          // broken image icon না।
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          draggable={false}
                        />
                      ) : (
                        initials(userName)
                      )}
                    </div>
                    <span className="text-sm font-black text-gray-800">{(userName || '').split(' ')[0] || 'My Account'}</span>
                    <ChevronDown size={14} className={`text-gray-400 transition-transform duration-300 ${isProfileMenuOpen ? 'rotate-180' : ''}`} />
                  </div>

                  {isProfileMenuOpen && (
                    <div className="absolute top-full right-0 mt-3 w-64 bg-white/95 backdrop-blur-3xl border border-white shadow-[0_30px_60px_rgba(0,0,0,0.12)] rounded-[2rem] p-2 z-[70] overflow-hidden">
                      <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/50 rounded-t-[1.5rem] mb-2">
                        <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${userRole === 'landlord' ? 'text-[#ba0036]' : 'text-blue-500'}`}>
                          {userRole === 'landlord' ? 'Host Portal' : 'Tenant Portal'}
                        </p>
                        <p className="text-sm font-bold text-gray-900">{userName}</p>
                        <p className="text-xs text-gray-400">{userEmail}</p>
                      </div>

                      {userRole === 'landlord' ? (
                        <>
                          <Link to="/host-dashboard" onClick={closeAll} className="flex items-center gap-3 px-5 py-3 text-sm font-bold text-gray-600 hover:bg-red-50 hover:text-[#ba0036] rounded-xl transition-colors"><LayoutDashboard size={17} /> Host Dashboard</Link>
                          <button onClick={() => handleProtected('/list-property')} className="w-full flex items-center gap-3 px-5 py-3 text-sm font-bold text-gray-600 hover:bg-red-50 hover:text-[#ba0036] rounded-xl transition-colors text-left"><PlusCircle size={17} /> Add Property</button>
                        </>
                      ) : (
                        <>
                          <Link to="/tenant-dashboard" onClick={closeAll} className="flex items-center gap-3 px-5 py-3 text-sm font-bold text-gray-600 hover:bg-blue-50 hover:text-blue-600 rounded-xl transition-colors"><LayoutDashboard size={17} /> Tenant Dashboard</Link>
                          <Link to="/saved-properties" onClick={closeAll} className="flex items-center gap-3 px-5 py-3 text-sm font-bold text-gray-600 hover:bg-blue-50 hover:text-blue-600 rounded-xl transition-colors"><Heart size={17} /> Saved Properties</Link>
                          <Link to="/inquiry" onClick={closeAll} className="flex items-center gap-3 px-5 py-3 text-sm font-bold text-gray-600 hover:bg-blue-50 hover:text-blue-600 rounded-xl transition-colors"><MessageSquare size={17} /> My Inquiries</Link>
                        </>
                      )}

                      <Link to="/smart-alerts" onClick={closeAll} className="flex items-center gap-3 px-5 py-3 text-sm font-bold text-gray-600 hover:bg-amber-50 hover:text-amber-600 rounded-xl transition-colors"><Bell size={17} /> Smart Alerts</Link>

                      <button onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-5 py-3 text-sm font-black text-red-500 hover:bg-red-50 rounded-xl transition-colors text-left mt-1 border-t border-gray-50">
                        <LogOut size={17} /> Log Out
                      </button>

                      <div className="px-3 py-3 bg-gray-900 mt-2 rounded-[1.2rem]">
                        {/* Mode pill — wired to AuthContext.setActiveRole so the
                            switch survives reloads and is mirrored across tabs.
                            Calls addRole() first if the destination role hasn't
                            been unlocked yet (e.g. a brand-new tenant becoming
                            a host for the first time). */}
                        <button onClick={handleSwitchRole}
                          className="w-full flex items-center justify-center gap-2 text-[10px] font-black text-white uppercase tracking-widest py-1 hover:scale-105 transition-transform">
                          <RefreshCw size={13} /> Switch to {userRole === 'tenant' ? 'Host' : 'Tenant'}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <Link to="/login" className="bg-[#ba0036] text-white px-5 py-2 rounded-xl font-bold text-xs lg:text-sm shadow-[0_8px_20px_rgba(186,0,54,0.25)] hover:bg-[#a0002d] hover:shadow-[0_10px_25px_rgba(186,0,54,0.35)] transition-all active:scale-95 flex items-center gap-2 border-none">
                <User size={16} /> {t?.login || 'Login / Signup'}
              </Link>
              )}
            </div>
          </div>

          {/* Mobile header right-side — language pill + bell.
              ── The slide-out menu drawer is now opened from the bottom-nav
              Profile tab (see MobileBottomNav.jsx), not from the bell. Bell
              now strictly opens notifications.
              ── A custom 'open-mobile-menu' window event is the bridge: the
              Profile tab dispatches it, this Navbar listens (see useEffect
              elsewhere in this file) and flips `isMobileMenuOpen`. */}
          <div className="md:hidden flex items-center gap-2 ml-auto">
            {/* Language pill (English ↔ বাংলা) */}
            <div className="relative" ref={mobileLangRef}>
              <button
                onClick={() => setIsLangMenuOpen(v => !v)}
                aria-label="Language"
                className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-gray-700 bg-white/70 backdrop-blur-md border border-white/60 shadow-sm hover:text-[#ba0036] hover:bg-red-50 hover:border-red-100 transition-all"
              >
                <Globe size={15} strokeWidth={2.4} />
                <span className="text-[12px] font-black leading-none">{language}</span>
                <ChevronDown size={12} className={`transition-transform duration-300 ${isLangMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {isLangMenuOpen && (
                <div className="absolute top-full right-0 mt-2 w-44 bg-white rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.12)] border border-gray-100 p-1.5 z-[65] animate-[slideDown_0.2s_ease]">
                  {languages.map(lang => (
                    <div key={lang.code} onClick={() => { if (setLanguage) setLanguage(lang.name); setIsLangMenuOpen(false); }}
                      className={`px-3 py-2.5 cursor-pointer rounded-xl text-[13px] font-bold flex items-center justify-between transition-all ${language === lang.name ? 'bg-red-50 text-[#ba0036]' : 'hover:bg-gray-50 text-gray-700'}`}>
                      {lang.name} {language === lang.name && <Check size={14} />}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Bell — polls /api/notifications/unread-count every 15s and
                opens an inline dropdown with the latest notifications. */}
            {isAuthed && <NotificationBell isAuthed={isAuthed} />}
          </div>
        </div>

        {/* Desktop district bar — Hover cut off issue fixed with overflow-visible */}
        <div className={`hidden md:block border-t border-gray-100 bg-[#f8f9fa]/90 backdrop-blur-xl transition-all duration-300 ${(isScrolled || compactHeader) ? 'max-h-0 opacity-0 pointer-events-none overflow-hidden' : 'max-h-[38px] opacity-100 overflow-visible'}`}>
          <div className="w-full max-w-[1400px] mx-auto px-4 lg:px-6 h-[38px] flex items-center justify-between">
            
            {/* OYO এর মতো সমানভাবে স্পেস নেওয়ার জন্য ম্যাপ করা আইটেমগুলোকে সরাসরি justify-between কন্টেইনারে রাখা হয়েছে */}
            {currentData.map((division, divIndex) => (
              <div key={division.id} className="group relative h-full flex items-center">
                {/* টেক্সট সাইজ ছোট করা হয়েছে এবং uppercase বজায় রাখা হয়েছে */}
                <span className="flex items-center gap-1 text-[10px] lg:text-[11px] font-bold text-gray-600 uppercase hover:text-gray-900 transition-colors cursor-pointer">
                  {division.name} <ChevronDown size={14} className="group-hover:rotate-180 transition-transform duration-300 text-gray-400 group-hover:text-gray-700" />
                </span>
                
                {/* Dynamic Dropdown Box Layout */}
                {/* z-[70] inside the z-[60] header keeps the city/district
                    dropdown above any other element on the page that might
                    be rendered later in the DOM. */}
                <div className={`absolute top-full w-max bg-white/95 backdrop-blur-3xl border border-white rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.1)] p-4 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 translate-y-3 group-hover:translate-y-1 z-[70] ${divIndex > 4 ? 'right-0' : 'left-0'}`}>
                  <div className={`grid gap-2 max-h-[350px] overflow-y-auto pr-1 ${division.districts.length <= 4 ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-3'}`}>
                    {division.districts.map((district, idx) => {
                      const param = locationData['en'].find(d => d.id === division.id).districts[idx].toLowerCase().replace(/\s+/g, '-');
                      return (
                        <div key={idx} onClick={() => navigate(`/properties/${param}`)}
                          className="h-9 w-[120px] flex items-center justify-center bg-gray-50 border border-gray-100 rounded-lg hover:bg-red-50 hover:border-red-200 hover:text-[#ba0036] transition-all cursor-pointer px-2 group/d">
                          <span className="text-[11px] font-bold text-gray-700 group-hover/d:text-[#ba0036] truncate text-center w-full">{district}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}

            <Link to="/properties/all" className="flex items-center gap-1 text-[11px] lg:text-xs font-bold text-gray-600 uppercase hover:text-gray-900 transition-colors shrink-0">
              ALL CITIES <ArrowRight size={14} className="text-gray-400" />
            </Link>
          </div>
        </div>
      </header>

      {/* MOBILE SEARCH PANEL */}
      {isMobileSearchOpen && (
        <div className="md:hidden fixed top-[56px] inset-x-0 z-[55] bg-white/85 backdrop-blur-xl backdrop-saturate-[180%] border-b border-white/70 shadow-[0_8px_30px_rgba(15,23,42,0.10)] px-4 py-3 animate-[slideDown_0.2s_ease]">
          <div className="flex items-center gap-2" ref={mobileNavLocRef}>
            <div className="flex-1 flex items-center gap-2 bg-gradient-to-br from-white via-slate-50/80 to-white backdrop-blur-md border border-slate-200/80 rounded-full px-4 py-2.5 relative shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_-1px_0_rgba(15,23,42,0.04),0_4px_14px_rgba(15,23,42,0.08)]">
              <MapPin size={14} className="text-[#ba0036] shrink-0" />
              <input
                type="text"
                value={mobileNavLoc}
                onChange={e => { setMobileNavLoc(e.target.value); setMobileNavLocOpen(true); }}
                onFocus={() => setMobileNavLocOpen(true)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { setMobileNavLocOpen(false); setIsMobileSearchOpen(false); const slug = mobileNavLoc.trim() ? mobileNavLoc.trim().toLowerCase().replace(/,?\s+/g, '-') : 'all'; navigate(`/properties/${slug}?category=${navType.id}`); }
                  if (e.key === 'Escape') { setMobileNavLocOpen(false); setIsMobileSearchOpen(false); }
                }}
                placeholder="Area, district, city…"
                className="bg-transparent outline-none border-none text-sm font-bold text-gray-900 placeholder-gray-400 w-full"
                autoComplete="off"
                autoFocus
              />
              {mobileNavLoc && (
                <button onMouseDown={e => e.preventDefault()} onClick={() => { setMobileNavLoc(''); setMobileNavLocOpen(false); }}>
                  <X size={12} className="text-gray-400" />
                </button>
              )}

              {mobileNavLocOpen && (
                <div className="absolute top-[calc(100%+6px)] left-0 right-0 bg-white rounded-2xl shadow-[0_16px_48px_rgba(0,0,0,0.14)] border border-gray-100 z-[500] overflow-hidden">
                  {!mobileNavLoc && (
                    <div className="px-3 pt-3 pb-2 border-b border-gray-50">
                      <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2">Popular Areas</p>
                      <div className="flex flex-wrap gap-1.5">
                        {['Dhanmondi','Gulshan','Banani','Uttara','Mirpur'].map(chip => (
                          <button key={chip} onMouseDown={e => e.preventDefault()}
                            onClick={() => { setMobileNavLoc(chip + ', Dhaka'); setMobileNavLocOpen(false); }}
                            className="text-[10px] font-bold text-gray-700 bg-gray-100 hover:bg-red-50 hover:text-[#ba0036] px-2.5 py-1 rounded-full transition-colors">
                            {chip}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {mobileNavLoc && (() => {
                    const q = mobileNavLoc.trim().toLowerCase();
                    const matches = getFilteredSuggestions(q, mobileLiveSuggestions);
                    const results = matches.length > 0 ? matches.slice(0, 6) : [
                      { id: `mdyn-${q}`, title: mobileNavLoc.trim(), type: 'Search Anywhere', category: 'search' },
                      { id: `mdyn-bd-${q}`, title: `${mobileNavLoc.trim()}, Bangladesh`, type: 'Location', category: 'city' },
                    ];
                    return (
                      <div className="py-1 max-h-[220px] overflow-y-auto">
                        {results.map(s => (
                          <button key={s.id} onMouseDown={e => e.preventDefault()}
                            onClick={() => { setMobileNavLoc(s.title); setMobileNavLocOpen(false); }}
                            className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-red-50 transition-colors text-left">
                            <div className={`p-1.5 rounded-lg shrink-0 ${s.category === 'city' ? 'bg-blue-50' : s.category === 'search' ? 'bg-red-50' : 'bg-emerald-50'}`}>
                              {s.category === 'city'   ? <Building2 size={12} className="text-blue-500" /> :
                               s.category === 'search' ? <Search    size={12} className="text-[#ba0036]" /> :
                                                         <MapPin    size={12} className="text-emerald-600" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-sm text-gray-900 truncate">{s.title}</p>
                              <p className="text-[10px] font-medium text-gray-400">{s.type}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                  {mobileNavLoc && (
                    <button onMouseDown={e => e.preventDefault()}
                      onClick={() => { setMobileNavLocOpen(false); setIsMobileSearchOpen(false); const slug = mobileNavLoc.trim() ? mobileNavLoc.trim().toLowerCase().replace(/,?\s+/g, '-') : 'all'; navigate(`/properties/${slug}?category=${navType.id}`); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-red-50 transition-colors text-left border-t border-gray-50">
                      <div className="bg-[#ba0036] p-1.5 rounded-lg text-white shrink-0"><Search size={12} /></div>
                      <span className="font-bold text-sm text-[#ba0036] truncate">Search for "{mobileNavLoc}"</span>
                    </button>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={() => { setIsMobileSearchOpen(false); const slug = mobileNavLoc.trim() ? mobileNavLoc.trim().toLowerCase().replace(/,?\s+/g, '-') : 'all'; navigate(`/properties/${slug}?category=${navType.id}`); }}
              className="shrink-0 bg-[#ba0036] hover:bg-[#a0002d] text-white px-4 py-2.5 rounded-full font-black text-xs flex items-center gap-1.5 transition-all active:scale-95 shadow-[0_6px_18px_rgba(186,0,54,0.3)] border-none"
            >
              <Search size={14} /> Go
            </button>
            <button onClick={() => setIsMobileSearchOpen(false)} className="shrink-0 p-2.5 text-gray-400 hover:text-gray-600 transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      {/* MOBILE DRAWER */}
      <div className={`md:hidden fixed inset-x-0 top-[56px] bg-white h-[calc(100dvh-56px)] z-[55] overflow-y-auto overscroll-contain shadow-2xl transition-transform duration-500 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] ${isMobileMenuOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex flex-col px-5 pt-6 pb-28 gap-5">

          {isLoggedIn ? (
            <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-[1.75rem] p-5 flex items-center gap-4 shadow-lg relative overflow-hidden">
              <div className={`w-14 h-14 rounded-2xl overflow-hidden flex items-center justify-center text-white font-black text-lg shadow-md shrink-0 ${userRole === 'landlord' ? 'bg-[#ba0036]' : 'bg-blue-500'}`}>
                {authUser?.avatar ? (
                  <img
                    src={authUser.avatar}
                    alt={userName}
                    className="w-full h-full object-cover"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    draggable={false}
                  />
                ) : (
                  initials(userName)
                )}
              </div>
              <div className="relative z-10 flex-1 min-w-0">
                <p className={`text-[9px] font-black uppercase tracking-widest mb-0.5 ${userRole === 'landlord' ? 'text-[#ba0036]' : 'text-blue-400'}`}>
                  {userRole === 'landlord' ? '🏠 Host Portal' : '👤 Tenant Portal'}
                </p>
                <h3 className="text-white font-black text-base leading-tight truncate">{userName}</h3>
                <p className="text-gray-400 text-[10px] font-medium truncate">{userEmail}</p>
              </div>
            </div>
          ) : (
            <div className="bg-gradient-to-br from-[#ba0036] to-[#e60045] p-6 rounded-[1.75rem] shadow-[0_10px_30px_rgba(186,0,54,0.3)] text-white relative overflow-hidden">
              <div className="absolute -top-8 -right-8 w-28 h-28 bg-white/10 rounded-full blur-3xl" />
              <UserCircle size={44} className="mx-auto mb-3 opacity-90 block text-center" />
              <h3 className="text-xl font-black mb-1 text-center">Join TO-LET PRO</h3>
              <p className="text-xs font-medium text-red-100 mb-5 text-center leading-relaxed">Dashboards, saved searches, alerts & more</p>
              
              <div className="flex gap-3">
                <button onClick={() => { navigate('/login'); setIsMobileMenuOpen(false); }}
                  className="flex-1 bg-white text-[#ba0036] py-3 rounded-xl font-black text-sm shadow-lg active:scale-95 transition-transform">
                  Log In
                </button>
                <button onClick={() => { navigate('/login', { state: { isLoginMode: false } }); setIsMobileMenuOpen(false); }}
                  className="flex-1 bg-white/20 backdrop-blur-md text-white border border-white/30 py-3 rounded-xl font-black text-sm active:scale-95 transition-transform">
                  Sign Up
                </button>
              </div>
            </div>
          )}

          <div>
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest px-1 mb-1.5">Explore</p>
            <div className="bg-gray-50 border border-gray-100 rounded-2xl p-2 flex flex-col gap-0.5">
              {exploreLinks.map(item => (
                <Row key={item.label} {...item} onClick={item.protected ? () => handleProtected(item.path) : undefined} />
              ))}
            </div>
          </div>

          <div>
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest px-1 mb-1.5">AI & Tools</p>
            <div className="bg-gray-50 border border-gray-100 rounded-2xl p-2 flex flex-col gap-0.5">
              {toolLinks.map(item => <Row key={item.label} {...item} />)}
            </div>
          </div>

          {isLoggedIn && (
            <div>
              <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest px-1 mb-1.5">My Account</p>
              <div className="bg-gray-50 border border-gray-100 rounded-2xl p-2 flex flex-col gap-0.5">
                {(userRole === 'landlord' ? hostLinks : tenantLinks).map(item => <Row key={item.label} {...item} />)}
                <button onClick={handleSwitchRole}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white transition-all text-left w-full">
                  <div className="w-8 h-8 rounded-xl bg-gray-200 flex items-center justify-center shrink-0"><RefreshCw size={15} className="text-gray-500" /></div>
                  <span className="font-bold text-sm text-gray-500 flex-1">Switch to {userRole === 'tenant' ? 'Host' : 'Tenant'}</span>
                </button>
                <button onClick={async () => { await handleLogout(); setIsMobileMenuOpen(false); }}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-red-50 transition-all text-left w-full border-t border-gray-100 mt-1">
                  <div className="w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center shrink-0"><LogOut size={15} className="text-red-500" /></div>
                  <span className="font-bold text-sm text-red-500 flex-1">Log Out</span>
                </button>
              </div>
            </div>
          )}

          {/* ─── FOOTER LINKS (Guest policy · Call us · Our story · Blogs · FAQs) ───
              Mirrors the Canva mockup — gives the drawer a sense of completion
              and surfaces support / brand pages where users naturally look. */}
          <div>
            <div className="bg-gray-50 border border-gray-100 rounded-2xl p-2 flex flex-col gap-0.5">
              {footerLinks.map(item => <Row key={item.label} {...item} />)}
            </div>
          </div>

          {/* ─── SETTINGS + HELP (always visible at the bottom of the drawer) ─── */}
          <div className="bg-gray-50 border border-gray-100 rounded-2xl p-2 flex flex-col gap-0.5">
            {settingsLinks.map(item => <Row key={item.label} {...item} />)}
          </div>

          <div>
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest px-1 mb-1.5">Browse by District</p>
            <div className="flex flex-col gap-2">
              {currentData.map(div => (
                <div key={div.id}>
                  <button
                    onClick={() => setExpandedDiv(expandedDiv === div.id ? null : div.id)}
                    className={`w-full border py-3 px-4 rounded-xl text-xs font-bold flex items-center justify-between transition-colors ${expandedDiv === div.id ? 'bg-red-50 border-red-100 text-[#ba0036]' : 'bg-gray-50 border-gray-100 text-gray-700'}`}
                  >
                    {div.name}
                    <ChevronDown size={14} className={`transition-transform duration-300 ${expandedDiv === div.id ? 'rotate-180' : ''}`} />
                  </button>
                  <div className={`grid grid-cols-2 gap-2 overflow-hidden transition-all duration-300 ${expandedDiv === div.id ? 'max-h-[800px] opacity-100 mt-2' : 'max-h-0 opacity-0'}`}>
                    {div.districts.map((district, idx) => {
                      const param = locationData['en'].find(d => d.id === div.id).districts[idx].toLowerCase().replace(/\s+/g, '-');
                      return (
                        <div key={idx} onClick={() => { navigate(`/properties/${param}`); setIsMobileMenuOpen(false); }}
                          className="h-10 flex items-center justify-center bg-white border border-gray-100 rounded-lg hover:bg-red-50 hover:border-red-100 hover:text-[#ba0036] cursor-pointer px-2 shadow-sm transition-all">
                          <span className="text-[11px] font-bold text-gray-600 truncate text-center">{district}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest px-1 mb-1.5">Language</p>
            <div className="flex gap-3 bg-gray-50 border border-gray-100 p-1.5 rounded-2xl">
              {languages.map(lang => (
                <button key={lang.code}
                  onClick={() => { if (setLanguage) setLanguage(lang.name); setIsMobileMenuOpen(false); }}
                  className={`flex-1 py-3 rounded-xl font-black text-sm transition-all ${language === lang.name ? 'bg-white text-[#ba0036] border border-gray-200 shadow-sm' : 'text-gray-500'}`}>
                  {lang.name}
                </button>
              ))}
            </div>
          </div>

        </div>
      </div>

      {/* AUTH MODAL */}
      {showAuthModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 font-sans">
          <div className="absolute inset-0 bg-gray-900/60 backdrop-blur-md" onClick={() => setShowAuthModal(false)} />
          <div className="bg-white/95 backdrop-blur-3xl border border-white shadow-[0_40px_80px_rgba(0,0,0,0.2)] rounded-[3rem] p-8 md:p-10 max-w-sm w-full relative overflow-hidden">
            <div className="absolute -top-10 -right-10 w-40 h-40 bg-[#ba0036]/10 rounded-full blur-3xl pointer-events-none" />
            <button onClick={() => setShowAuthModal(false)} className="absolute top-6 right-6 text-gray-400 hover:text-red-500 bg-gray-50 hover:bg-red-50 border border-gray-100 rounded-full p-2.5 transition-all shadow-sm">
              <X size={20} />
            </button>
            <div className="flex flex-col items-center text-center mt-4">
              <div className="w-20 h-20 bg-red-50 rounded-3xl flex items-center justify-center mb-6 shadow-inner border border-red-100">
                <ShieldAlert size={36} className="text-[#ba0036]" />
              </div>
              <h3 className="text-2xl font-black text-gray-900 mb-3 tracking-tight">Login Required</h3>
              <p className="text-sm font-bold text-gray-500 mb-8 leading-relaxed px-2">
                Sign in to list properties, manage your dashboard, and access all platform features.
              </p>
              <div className="w-full flex flex-col gap-3">
                <button onClick={() => { setShowAuthModal(false); navigate('/login'); }}
                  className="w-full bg-gradient-to-r from-[#ba0036] to-[#e60045] text-white py-4 rounded-2xl font-black text-sm shadow-[0_10px_20px_rgba(186,0,54,0.2)] hover:-translate-y-0.5 active:scale-95 transition-all flex items-center justify-center gap-2">
                  Sign In to Continue <ArrowRight size={18} />
                </button>
                <button onClick={() => setShowAuthModal(false)}
                  className="w-full bg-white border border-gray-200 text-gray-600 py-4 rounded-2xl font-black text-sm hover:bg-gray-50 transition-all active:scale-95">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Verification Required Modal */}
      {showVerificationModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity" 
            onClick={() => setShowVerificationModal(false)}
          />
          
          {/* Modal Content */}
          <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-[slideUp_0.3s_ease-out]">
            <div className="p-6 sm:p-8">
              <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mb-6 shadow-sm">
                <ShieldAlert size={32} className="text-[#ba0036]" />
              </div>
              
              <h3 className="text-xl sm:text-2xl font-black text-gray-900 mb-3 tracking-tight">
                {language === 'বাংলা' ? 'ভেরিফিকেশন প্রয়োজন' : 'Verification Required'}
              </h3>
              
              <p className="text-sm sm:text-base text-gray-600 mb-8 leading-relaxed">
                {language === 'বাংলা' 
                  ? 'বাড়িওয়ালা হিসেবে প্রপার্টি লিস্টিং করতে হলে আপনাকে আগে নিজের প্রোফাইল ভেরিফাই করতে হবে। দয়া করে আপনার এনআইডি এবং প্রয়োজনীয় তথ্য জমা দিন।' 
                  : 'To become a host and list properties, you must first verify your profile. Please submit your NID and required documents to complete the verification process.'}
              </p>
              
              <div className="flex flex-col gap-3">
                <button 
                  onClick={() => {
                    setShowVerificationModal(false);
                    navigate('/tenant-dashboard?openVerify=1&reason=host_upgrade');
                  }}
                  className="w-full bg-[#ba0036] hover:bg-[#9a002d] text-white py-3.5 rounded-xl font-bold transition-colors shadow-lg shadow-red-500/30 flex items-center justify-center gap-2"
                >
                  {language === 'বাংলা' ? 'ভেরিফিকেশন শুরু করুন' : 'Start Verification'} <ArrowRight size={18} />
                </button>
                <button 
                  onClick={() => setShowVerificationModal(false)}
                  className="w-full bg-gray-50 hover:bg-gray-100 text-gray-700 py-3.5 rounded-xl font-bold transition-colors"
                >
                  {language === 'বাংলা' ? 'পরে করব' : 'Maybe Later'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Navbar;
