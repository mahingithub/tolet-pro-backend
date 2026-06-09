import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, MapPin, Home as HomeIcon, Wallet, ChevronDown, Check, X, ArrowLeft, Navigation,
  CheckCircle2, Clock, HeadphonesIcon, ArrowRight, Star, ShieldCheck, Map, Users, Building,
  Mail, Phone, Zap, TrendingUp, Tag, Sparkles, PlusCircle
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT DATA
// ─────────────────────────────────────────────────────────────────────────────
const popularCities = [
  { id: 'dhaka',      name: 'Dhaka',      desc: 'Central Hub',       image: 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=800&q=80' },
  { id: 'chittagong', name: 'Chattogram', desc: 'Port City',         image: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&q=80' },
  { id: 'sylhet',     name: 'Sylhet',     desc: 'Tea Gardens',       image: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=800&q=80' },
  { id: 'rajshahi',   name: 'Rajshahi',   desc: 'Silk City',         image: 'https://images.unsplash.com/photo-1449844908441-8829872d2607?w=800&q=80' },
  { id: 'khulna',     name: 'Khulna',     desc: 'Mangrove Forest',   image: 'https://images.unsplash.com/photo-1479839672679-a46483c0e7c8?w=800&q=80' },
  { id: 'barishal',   name: 'Barishal',   desc: 'City of Rivers',    image: 'https://images.unsplash.com/photo-1588600878108-578307a3cc9d?w=800&q=80' },
];

const dhakaFinest = [
  { id: 'gulshan',     name: 'Gulshan',     properties: '1,240+', price: '50k - 2L',   image: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&q=80',   tag: 'Ultra Premium' },
  { id: 'banani',      name: 'Banani',      properties: '980+',   price: '40k - 1.5L', image: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&q=80',   tag: 'Luxury' },
  { id: 'dhanmondi',   name: 'Dhanmondi',   properties: '1,500+', price: '30k - 1L',   image: 'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?w=800&q=80',   tag: 'Family Hub' },
  { id: 'bashundhara', name: 'Bashundhara', properties: '2,100+', price: '20k - 1.2L', image: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=800&q=80', tag: 'Modern Living' },
  { id: 'uttara',      name: 'Uttara',      properties: '3,200+', price: '15k - 80k',  image: 'https://images.unsplash.com/photo-1449844908441-8829872d2607?w=800&q=80',  tag: 'Planned City' },
  { id: 'mirpur',      name: 'Mirpur',      properties: '4,500+', price: '10k - 50k',  image: 'https://images.unsplash.com/photo-1479839672679-a46483c0e7c8?w=800&q=80',  tag: 'Budget Friendly' },
];

const allSuggestions = [
  { id: 'gulshan',      title: 'Gulshan, Dhaka',        type: 'Premium Area',   category: 'area' },
  { id: 'banani',       title: 'Banani, Dhaka',         type: 'Popular Search', category: 'area' },
  { id: 'dhanmondi',    title: 'Dhanmondi, Dhaka',      type: 'Family Hub',     category: 'area' },
  { id: 'bashundhara',  title: 'Bashundhara R/A',       type: 'Residential',    category: 'area' },
  { id: 'uttara',       title: 'Uttara, Dhaka',         type: 'Planned City',   category: 'area' },
  { id: 'mirpur',       title: 'Mirpur, Dhaka',         type: 'Budget Friendly',category: 'area' },
  { id: 'mohammadpur',  title: 'Mohammadpur, Dhaka',    type: 'Residential',    category: 'area' },
  { id: 'rampura',      title: 'Rampura, Dhaka',        type: 'Area',           category: 'area' },
  { id: 'malibagh',     title: 'Malibagh, Dhaka',       type: 'Area',           category: 'area' },
  { id: 'khilgaon',     title: 'Khilgaon, Dhaka',       type: 'Area',           category: 'area' },
  { id: 'badda',        title: 'Badda, Dhaka',          type: 'Area',           category: 'area' },
  { id: 'tejgaon',      title: 'Tejgaon, Dhaka',        type: 'Commercial Zone',category: 'area' },
  { id: 'shyamoli',     title: 'Shyamoli, Dhaka',       type: 'Residential',    category: 'area' },
  { id: 'lalmatia',     title: 'Lalmatia, Dhaka',       type: 'Residential',    category: 'area' },
  { id: 'wari',         title: 'Wari, Dhaka',           type: 'Old Town',       category: 'area' },
  { id: 'azimpur',      title: 'Azimpur, Dhaka',        type: 'Residential',    category: 'area' },
  { id: 'jigatola',     title: 'Jigatola, Dhaka',       type: 'Area',           category: 'area' },
  { id: 'nawabganj',    title: 'Nawabganj, Dhaka',      type: 'District',       category: 'district' },
  { id: 'sylhet',       title: 'Sylhet City',           type: 'Division',       category: 'city' },
  { id: 'chittagong',   title: 'Chattogram City',       type: 'Division',       category: 'city' },
  { id: 'rajshahi',     title: 'Rajshahi City',         type: 'Division',       category: 'city' },
  { id: 'khulna',       title: 'Khulna City',           type: 'Division',       category: 'city' },
  { id: 'barishal',     title: 'Barishal City',         type: 'Division',       category: 'city' },
  { id: 'rangpur',      title: 'Rangpur City',          type: 'Division',       category: 'city' },
  { id: 'mymensingh',   title: 'Mymensingh City',       type: 'Division',       category: 'city' },
  { id: 'ps_family',    title: 'Family Apartment Dhaka',type: 'Popular Search', category: 'search' },
  { id: 'ps_bach',      title: 'Bachelor Flat Mirpur',  type: 'Popular Search', category: 'search' },
  { id: 'ps_sublet',    title: 'Sublet Room Dhanmondi', type: 'Popular Search', category: 'search' },
  { id: 'ps_office',    title: 'Office Space Gulshan',  type: 'Popular Search', category: 'search' },
];

const popularSearchChips = [
  'Dhanmondi', 'Gulshan', 'Banani', 'Uttara', 'Bashundhara', 'Mirpur',
];

const rentBuyChips = ['Dhanmondi', 'Gulshan', 'Banani', 'Uttara', 'Mirpur'];
const commercialChips = ['Motijheel', 'Kawran Bazar', 'Dilkusha', 'Gulshan Avenue', 'Banani Block C'];

// ─── DYNAMIC PROPERTY TYPES ──────────────────────────────────────────────────
// ⚠️  IDs here MUST match `rentalCategory` values in propertyService.js
const residentialTypes = [
  { id: 'any',            label: { en: 'Any Property',        bn: 'যেকোনো প্রপার্টি' } },
  { id: 'family',         label: { en: 'Family Apartment',    bn: 'ফ্যামিলি বাসা' } },
  { id: 'bachelor_male',  label: { en: 'Bachelor (Male)',     bn: 'ব্যাচেলর (ছেলে)' } },
  { id: 'bachelor_female',label: { en: 'Bachelor (Female)',   bn: 'ব্যাচেলর (মেয়ে)' } },
  { id: 'sublet',         label: { en: 'Sublet / Room',       bn: 'সাবলেট / রুম' } },
  { id: 'student',        label: { en: 'Student',             bn: 'ছাত্র/ছাত্রী' } },
];

const commercialTypes = [
  { id: 'any_commercial', label: { en: 'Any Commercial', bn: 'যেকোনো কমার্শিয়াল' } },
  { id: 'office',         label: { en: 'Office Space',    bn: 'অফিস স্পেস' } },
  { id: 'shop',           label: { en: 'Shop / Retail',   bn: 'দোকান / রিটেইল' } },
  { id: 'warehouse',      label: { en: 'Warehouse',       bn: 'গুদাম ঘর' } },
  { id: 'restaurant',     label: { en: 'Restaurant Space',bn: 'রেস্টুরেন্ট স্পেস' } },
];

const buyTypes = [
  { id: 'any_buy',    label: { en: 'Any Property',        bn: 'যেকোনো প্রপার্টি' } },
  { id: 'apartment',  label: { en: 'Apartment / Flat',    bn: 'অ্যাপার্টমেন্ট / ফ্ল্যাট' } },
  { id: 'house',      label: { en: 'Independent / Duplex',bn: 'বাড়ি / ডুপ্লেক্স' } },
  { id: 'land',       label: { en: 'Land / Plot',         bn: 'জমি / প্লট' } },
  { id: 'commercial', label: { en: 'Commercial Space',    bn: 'কমার্শিয়াল স্পেস' } },
];

const budgetRanges = [
  { id: 'any',        label: { en: 'Any Budget',            bn: 'যেকোনো বাজেট' } },
  { id: 'under_10k',  label: { en: 'Under 10,000 BDT',      bn: '১০,০০০ টাকার নিচে' } },
  { id: '10k_20k',    label: { en: '10,000 – 20,000 BDT',   bn: '১০,০০০ – ২০,০০০ টাকা' } },
  { id: '20k_50k',    label: { en: '20,000 – 50,000 BDT',   bn: '২০,০০০ – ৫০,০০০ টাকা' } },
  { id: 'above_50k',  label: { en: 'Above 50,000 BDT',      bn: '৫০,০০০ টাকার উপরে' } },
];

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
const HeroSection = () => {
  const langContext  = useLanguage() || {};
  const t            = langContext.t || {};
  const language     = langContext.language || 'English';
  const langKey      = language === 'বাংলা' ? 'bn' : 'en';
  const navigate     = useNavigate();

  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const bgImages = [
    "https://besacenter.org/wp-content/uploads/2024/09/%D7%9C%D7%95%D7%A8%D7%9F-%D7%93%D7%92%D7%9F-%D7%91%D7%A0%D7%92%D7%9C%D7%93%D7%A9-scaled.jpg", 
  ];
  useEffect(() => {
    const iv = setInterval(() => setCurrentImageIndex(i => (i + 1) % bgImages.length), 5000);
    return () => clearInterval(iv);
  }, []);

  const [searchType,     setSearchType]     = useState('rent');
  const [location,       setLocation]       = useState('');
  const [selectedType,   setSelectedType]   = useState(residentialTypes[0]);
  const [selectedBudget, setSelectedBudget] = useState(budgetRanges[0]);
  const [customMin,      setCustomMin]      = useState('');
  const [customMax,      setCustomMax]      = useState('');

  const [isLocationOpen,      setIsLocationOpen]      = useState(false);
  const [isMobileLocationOpen, setIsMobileLocationOpen] = useState(false);
  const [isTypeOpen,          setIsTypeOpen]          = useState(false);
  const [isBudgetOpen,        setIsBudgetOpen]        = useState(false);
  const [isMobileTypeOpen,    setIsMobileTypeOpen]    = useState(false);
  const [isMobileBudgetOpen,  setIsMobileBudgetOpen]  = useState(false);

  const [activeIndex,       setActiveIndex]       = useState(-1);
  const [mobileActiveIndex, setMobileActiveIndex] = useState(-1);

  const locationRef       = useRef(null);
  const mobileLocationRef = useRef(null);
  const typeRef           = useRef(null);
  const budgetRef         = useRef(null);

  // Dynamic Logic Variables
  const currentPlaceholder = searchType === 'commercial' 
    ? 'Search commercial zone, building, or landmark...' 
    : searchType === 'buy'
    ? 'Search city, neighborhood, or property to buy...'
    : (t?.locationPlaceholder || 'Where do you want to live?');
    
  const activeChips = searchType === 'commercial' ? commercialChips : rentBuyChips;
  
  // DYNAMIC PROPERTY TYPE ARRAYS
  const activePropertyTypes = searchType === 'commercial' 
    ? commercialTypes 
    : searchType === 'buy' 
    ? buyTypes 
    : residentialTypes;

  // Whenever the tab changes, reset the property type to the correct array's default
  useEffect(() => {
    if (searchType === 'commercial') {
      setSelectedType(commercialTypes[0]);
    } else if (searchType === 'buy') {
      setSelectedType(buyTypes[0]);
    } else {
      setSelectedType(residentialTypes[0]);
    }
  }, [searchType]);

  const [liveSuggestions, setLiveSuggestions] = useState([]);

  useEffect(() => {
    const raw = location.trim();
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
        console.error('Autocomplete fetch error:', err);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [location]);

  const filteredSuggestions = useCallback((properties = []) => {
    const raw = location.trim();
    if (!raw) return allSuggestions.slice(0, 7);

    const q = raw.toLowerCase();
    const staticMatches = allSuggestions.filter(s =>
      s.title.toLowerCase().includes(q)
    );

    const propMatches = properties.flatMap(p => {
      const entries = [];
      if (p?.location && p.location.toLowerCase().includes(q))
        entries.push({ id: `ploc-${p.id}`, title: p.location, type: 'Property Area', category: 'area' });
      if (p?.area && p.area.toLowerCase().includes(q))
        entries.push({ id: `parea-${p.id}`, title: p.area, type: 'Area', category: 'area' });
      if (p?.title && p.title.toLowerCase().includes(q))
        entries.push({ id: `ptitle-${p.id}`, title: p.title, type: 'Property', category: 'search' });
      return entries;
    });

    const merged = [...staticMatches, ...propMatches].filter(
      (s, i, arr) => arr.findIndex(x => x.title.toLowerCase() === s.title.toLowerCase()) === i
    );

    if (merged.length === 0) {
      return [
        {
          id: `dynamic-${q}`,
          title: raw,
          type: t?.searchAnywhere || 'Search Anywhere',
          category: 'search',
        },
        {
          id: `dynamic-bd-${q}`,
          title: `${raw}, Bangladesh`,
          type: t?.locationText || 'Location',
          category: 'city',
        },
      ];
    }

    return merged.slice(0, 9);
  }, [location, t]);

  const suggestions = filteredSuggestions(liveSuggestions);

  useEffect(() => {
    const handleClickOutside = e => {
      if (locationRef.current       && !locationRef.current.contains(e.target))       { setIsLocationOpen(false); setActiveIndex(-1); }
      if (mobileLocationRef.current && !mobileLocationRef.current.contains(e.target)) { setIsMobileLocationOpen(false); setMobileActiveIndex(-1); }
      if (typeRef.current           && !typeRef.current.contains(e.target))           setIsTypeOpen(false);
      if (budgetRef.current         && !budgetRef.current.contains(e.target))         setIsBudgetOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const isOpen = isMobileTypeOpen || isMobileBudgetOpen;
    if (isOpen) {
      const scrollY = window.scrollY;
      document.body.style.overflow    = 'hidden';
      document.body.style.position    = 'fixed';
      document.body.style.top         = `-${scrollY}px`;
      document.body.style.width       = '100%';
      document.body.style.touchAction = 'none';
    } else {
      const top = document.body.style.top;
      document.body.style.overflow    = '';
      document.body.style.position    = '';
      document.body.style.top         = '';
      document.body.style.width       = '';
      document.body.style.touchAction = '';
      if (top) window.scrollTo({ top: -parseInt(top, 10), behavior: 'instant' });
    }
    return () => {
      document.body.style.overflow    = '';
      document.body.style.position    = '';
      document.body.style.top         = '';
      document.body.style.width       = '';
      document.body.style.touchAction = '';
    };
  }, [isMobileTypeOpen, isMobileBudgetOpen]);

  const handleSearch = e => {
    e?.preventDefault();
    setIsLocationOpen(false);
    setIsMobileLocationOpen(false);
    setIsTypeOpen(false);
    setIsBudgetOpen(false);
    setActiveIndex(-1);
    setMobileActiveIndex(-1);
    const queryParams = new URLSearchParams({
      purpose:  searchType,
      // ── 'category' maps to prop.rentalCategory (family / bachelor_male / etc.)
      // ── This is intentionally separate from 'type' (apartment / studio / etc.)
      category: selectedType.id,
      budget:   customMin && customMax ? `${customMin}-${customMax}` : selectedBudget.id,
    }).toString();
    const targetLocation = location.trim() ? location.toLowerCase().replace(/,?\s+/g, '-') : 'all';
    navigate(`/properties/${targetLocation}?${queryParams}`);
  };

  const handleLocationSelect = title => {
    setLocation(title);
    setIsLocationOpen(false);
    setIsMobileLocationOpen(false);
    setActiveIndex(-1);
    setMobileActiveIndex(-1);
  };

  const handleDesktopKeyDown = e => {
    if (!isLocationOpen) { if (e.key === 'ArrowDown') { setIsLocationOpen(true); setActiveIndex(0); } return; }
    if (e.key === 'ArrowDown')  { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, -1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && suggestions[activeIndex]) handleLocationSelect(suggestions[activeIndex].title);
      else handleSearch();
    }
    else if (e.key === 'Escape') { setIsLocationOpen(false); setActiveIndex(-1); }
  };

  const handleMobileKeyDown = e => {
    if (!isMobileLocationOpen) { if (e.key === 'ArrowDown') { setIsMobileLocationOpen(true); setMobileActiveIndex(0); } return; }
    if (e.key === 'ArrowDown')  { e.preventDefault(); setMobileActiveIndex(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setMobileActiveIndex(i => Math.max(i - 1, -1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (mobileActiveIndex >= 0 && suggestions[mobileActiveIndex]) handleLocationSelect(suggestions[mobileActiveIndex].title);
      else handleSearch();
    }
    else if (e.key === 'Escape') { setIsMobileLocationOpen(false); setMobileActiveIndex(-1); }
  };

  const SuggestionIcon = ({ category }) => {
    if (category === 'search') return <TrendingUp size={13} className="text-crimson-400" />;
    if (category === 'city')   return <Building   size={13} className="text-blue-400" />;
    return                            <MapPin     size={13} className="text-emerald-500" />;
  };

  const sliderItems = [...popularCities, ...popularCities];

  return (
    <>
      <div className="w-full bg-slate-50 min-h-screen font-sans flex flex-col pb-0">

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* 1. HERO SECTION                                                */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <section className="w-full max-w-[1400px] mx-auto px-4 md:px-6 pt-4">
          <div className="relative w-full h-[240px] md:h-[300px] lg:h-[380px] rounded-[1.5rem] md:rounded-[2.5rem] overflow-hidden shadow-sm flex flex-col justify-center items-center text-center">
            {bgImages.map((img, index) => (
              <div
                key={index}
                className={`absolute inset-0 w-full h-full bg-cover bg-center transition-opacity duration-1000 ease-in-out ${index === currentImageIndex ? 'opacity-100 scale-105' : 'opacity-0 scale-100'}`}
                style={{ backgroundImage: `url(${img})` }}
              />
            ))}
            <div className="absolute inset-0 bg-gradient-to-b from-slate-900/60 via-slate-900/40 to-slate-900/80" />
            <div className="relative z-20 px-4 -mt-8 md:-mt-12">
              <h1 className="text-3xl md:text-5xl lg:text-6xl font-black text-white tracking-tight leading-[1.1] mb-3 drop-shadow-2xl">
                {t?.heroTitle1 || 'Find Your Next'} <br className="md:hidden" /> {t?.heroTitle2 || 'Perfect Home'}
              </h1>
              <p className="text-[12px] md:text-base font-bold text-slate-200 max-w-xl mx-auto drop-shadow-md hidden md:block">
                {t?.heroSubtext || 'Discover premium apartments, duplexes, and commercial spaces across Bangladesh.'}
              </p>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* 2. SEARCH CARD                                                 */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <section className="relative z-[60] -mt-10 md:-mt-28 w-full max-w-[1000px] mx-auto px-4 md:px-8 overflow-visible">

          {/* ──────────────────── MOBILE SEARCH UI ─────────────────────── */}
          <div className="flex md:hidden flex-col bg-gradient-to-br from-white/60 via-white/30 to-white/50 backdrop-blur-[24px] backdrop-saturate-[180%] rounded-3xl shadow-[inset_0_1.5px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(255,255,255,0.25),0_22px_60px_rgba(15,23,42,0.30)] border border-white/60 p-3 relative z-[100] ring-1 ring-inset ring-white/25">

            <div className="flex bg-white/35 backdrop-blur-md p-1 rounded-full w-full mb-3 border border-white/55 ring-1 ring-inset ring-white/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
              {[{ id: 'rent', label: t?.tabRent || 'Rent' }, { id: 'buy', label: t?.tabBuy || 'Buy' }, { id: 'commercial', label: t?.tabCommercial || 'Commercial' }].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setSearchType(tab.id)}
                  className={`flex-1 py-2 rounded-full text-[11px] font-black uppercase tracking-widest transition-all duration-200 ${searchType === tab.id ? 'bg-[#ba0036] text-white shadow-[0_4px_12px_rgba(186,0,54,0.3)]' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-2">
              <div className="relative w-full" ref={mobileLocationRef}>
                <div className="w-full flex items-center px-3 py-3 bg-white/45 backdrop-blur-md rounded-2xl border border-white/55 ring-1 ring-inset ring-white/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_4px_14px_rgba(15,23,42,0.08)]">
                  <div className="bg-white p-1.5 rounded-lg shadow-sm mr-2.5 shrink-0">
                    <MapPin size={16} className="text-crimson-500" />
                  </div>
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">{t?.searchLocation || 'Location'}</span>
                    <input
                      type="text"
                      placeholder={currentPlaceholder}
                      value={location}
                      onChange={e => { setLocation(e.target.value); setIsMobileLocationOpen(true); setMobileActiveIndex(-1); }}
                      onFocus={() => setIsMobileLocationOpen(true)}
                      onKeyDown={handleMobileKeyDown}
                      className="bg-transparent border-none outline-none focus:ring-0 font-bold text-sm text-slate-900 placeholder-slate-400 w-full"
                      autoComplete="off"
                    />
                  </div>
                  {location && (
                    <button
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => { setLocation(''); setIsMobileLocationOpen(false); setMobileActiveIndex(-1); }}
                      className="ml-1 shrink-0 p-1"
                    >
                      <X size={13} className="text-slate-400" />
                    </button>
                  )}
                </div>

                {isMobileLocationOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1.5 bg-white rounded-2xl shadow-[0_10px_30px_rgba(0,0,0,0.13)] border border-slate-100 z-[300] overflow-hidden">
                    {!location && (
                      <div className="px-3 pt-2.5 pb-1">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">{t?.popular || 'Popular'}</p>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {popularSearchChips.map(chip => (
                            <button
                              key={chip}
                              onMouseDown={e => e.preventDefault()}
                              onClick={() => handleLocationSelect(chip + ', Dhaka')}
                              className="text-[10px] font-bold text-slate-700 bg-slate-100 hover:bg-crimson-50 hover:text-crimson-600 px-2.5 py-1 rounded-full transition-colors border border-transparent hover:border-crimson-200"
                            >
                              {chip}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="max-h-[200px] overflow-y-auto overscroll-contain">
                      {!location && (
                        <div
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => handleLocationSelect(t?.useCurrentLocation || 'Current Location')}
                          className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-crimson-50 cursor-pointer transition-colors border-b border-slate-50"
                        >
                          <div className="bg-crimson-100 p-1.5 rounded-lg text-crimson-600 shrink-0"><Navigation size={14} /></div>
                          <span className="font-bold text-sm text-crimson-600">{t?.useCurrentLocation || 'Use current location'}</span>
                        </div>
                      )}
                      {location && (
                        <div
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => { setIsMobileLocationOpen(false); handleSearch(); }}
                          className="flex items-center gap-2.5 px-3 py-2.5 bg-crimson-50/70 cursor-pointer transition-colors border-b border-slate-100"
                        >
                          <div className="bg-crimson-500 p-1.5 rounded-lg text-white shrink-0"><Search size={14} /></div>
                          <span className="font-bold text-sm text-crimson-700 truncate">{t?.searchFor || 'Search for'} "{location}"</span>
                        </div>
                      )}
                      {!location && <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-3 pt-1 pb-1">{t?.allAreas || 'All Areas'}</div>}
                      {location   && <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-3 pt-1 pb-1">{t?.suggestions || 'Suggestions'}</div>}
                      {suggestions.map((s, idx) => (
                        <div
                          key={s.id}
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => handleLocationSelect(s.title)}
                          className={`flex items-center justify-between px-3 py-2.5 cursor-pointer transition-colors ${mobileActiveIndex === idx ? 'bg-crimson-50' : 'hover:bg-slate-50'}`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <SuggestionIcon category={s.category} />
                            <span className="font-bold text-sm text-slate-800 truncate">{s.title}</span>
                          </div>
                          <span className="text-[9px] font-black text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md uppercase tracking-wider shrink-0 ml-2">{s.type}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-2 w-full">
                <button
                  type="button"
                  onClick={() => setIsMobileTypeOpen(true)}
                  className="flex-1 flex flex-col items-start px-3 py-2.5 bg-white/45 hover:bg-white/60 backdrop-blur-md rounded-2xl border border-white/55 ring-1 ring-inset ring-white/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_4px_14px_rgba(15,23,42,0.08)] transition-colors cursor-pointer min-w-0 text-left"
                >
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5 flex items-center gap-1">
                    <HomeIcon size={10} className="text-slate-400" /> {t?.typeLabel || 'Type'}
                  </span>
                  <span className="font-bold text-xs text-slate-900 w-full truncate leading-snug">{selectedType.label[langKey]}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsMobileBudgetOpen(true)}
                  className="flex-1 flex flex-col items-start px-3 py-2.5 bg-white/45 hover:bg-white/60 backdrop-blur-md rounded-2xl border border-white/55 ring-1 ring-inset ring-white/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_4px_14px_rgba(15,23,42,0.08)] transition-colors cursor-pointer min-w-0 text-left"
                >
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5 flex items-center gap-1">
                    <Wallet size={10} className="text-slate-400" /> {t?.budgetLabel || 'Budget'}
                  </span>
                  <span className="font-bold text-xs text-slate-900 w-full truncate leading-snug">
                    {customMin && customMax ? `${customMin / 1000}k–${customMax / 1000}k` : selectedBudget.label[langKey]}
                  </span>
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSearch}
              className="w-full mt-3 bg-[#ba0036] hover:bg-[#a0002d] text-white py-3.5 rounded-full font-black text-sm uppercase tracking-widest active:scale-95 transition-all flex items-center justify-center gap-2 shadow-[0_8px_24px_rgba(186,0,54,0.35)] border-none"
            >
              <Search size={15} /> {t?.searchProperties || 'Search Properties'}
            </button>
          </div>

          {/* ──────────────────── DESKTOP SEARCH UI ────────────────────── */}
          <div className="hidden md:flex flex-col items-center w-full relative z-[100]">

            <div className="flex bg-white/85 backdrop-blur-[24px] backdrop-saturate-[180%] p-1 rounded-full mb-4 mx-auto transition-all shadow-[0_8px_28px_rgba(15,23,42,0.15),0_0_0_3px_rgba(255,255,255,0.6)]">
              {[{ id: 'rent', label: t?.tabRent || 'RENT' }, { id: 'buy', label: t?.tabBuy || 'BUY' }, { id: 'commercial', label: t?.tabCommercial || 'COMMERCIAL' }].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setSearchType(tab.id)}
                  className={`px-6 py-2.5 rounded-full text-xs font-black uppercase tracking-widest transition-all duration-200 ${searchType === tab.id ? 'bg-[#ba0036] text-white shadow-[0_4px_12px_rgba(186,0,54,0.3)]' : 'text-slate-700 hover:text-slate-900 hover:bg-white/60'}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="bg-white/85 backdrop-blur-[24px] backdrop-saturate-[180%] p-1.5 rounded-full shadow-[0_22px_60px_rgba(15,23,42,0.20),0_0_0_3px_rgba(255,255,255,0.6)] flex flex-row items-center w-full transition-all hover:bg-white/95">
              <div className="flex flex-row flex-1 divide-x-2 divide-slate-100/80">

                <div
                  className="flex-[1.4] flex items-center px-5 w-full relative group min-w-0 hover:bg-slate-50/60 rounded-l-full transition-colors"
                  ref={locationRef}
                >
                  <div className="bg-crimson-50 p-2.5 rounded-2xl mr-3 shrink-0 shadow-sm border border-crimson-100"><MapPin size={18} className="text-crimson-500" /></div>
                  <div className="flex flex-col flex-1 text-left min-w-0">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-0.5">{t?.searchLocation || 'Location'}</label>
                    <input
                      type="text"
                      placeholder={currentPlaceholder}
                      value={location}
                      onChange={e => { setLocation(e.target.value); setIsLocationOpen(true); setActiveIndex(-1); }}
                      onFocus={() => setIsLocationOpen(true)}
                      onKeyDown={handleDesktopKeyDown}
                      className="bg-transparent border-none outline-none focus:ring-0 font-bold text-sm text-slate-900 placeholder-slate-400 w-full truncate"
                      autoComplete="off"
                    />
                  </div>
                  {location && (
                    <button
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => { setLocation(''); setIsLocationOpen(true); setActiveIndex(-1); }}
                      className="ml-1 shrink-0 p-1"
                    >
                      <X size={12} className="text-slate-400 hover:text-slate-600 transition-colors" />
                    </button>
                  )}

                  {isLocationOpen && (
                    <div className="absolute top-[calc(100%+12px)] left-0 w-[340px] bg-white shadow-[0_20px_50px_rgba(0,0,0,0.15)] rounded-2xl z-[300] border border-slate-100 overflow-hidden">
                      {!location && (
                        <div className="px-3 pt-3 pb-2 border-b border-slate-50">
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">{t?.popularAreas || 'Popular Areas'}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {popularSearchChips.map(chip => (
                              <button
                                key={chip}
                                onMouseDown={e => e.preventDefault()}
                                onClick={() => handleLocationSelect(chip + ', Dhaka')}
                                className="text-[10px] font-bold text-slate-700 bg-slate-100 hover:bg-crimson-50 hover:text-crimson-600 px-2.5 py-1 rounded-full transition-colors border border-transparent hover:border-crimson-200"
                              >
                                {chip}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="max-h-[240px] overflow-y-auto overscroll-contain">
                        {!location && (
                          <div
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => handleLocationSelect(t?.useCurrentLocation || 'Current Location')}
                            className="flex items-center gap-3 px-3 py-2.5 hover:bg-crimson-50 cursor-pointer transition-colors"
                          >
                            <div className="bg-crimson-100 p-1.5 rounded-lg text-crimson-600 shrink-0"><Navigation size={14} /></div>
                            <span className="font-bold text-sm text-crimson-600">{t?.useCurrentLocation || 'Use current location'}</span>
                          </div>
                        )}
                        {location && (
                          <div
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => { setIsLocationOpen(false); handleSearch(); }}
                            className="flex items-center gap-3 px-3 py-2.5 bg-crimson-50/70 cursor-pointer transition-colors"
                          >
                            <div className="bg-crimson-500 p-1.5 rounded-lg text-white shrink-0"><Search size={14} /></div>
                            <span className="font-bold text-sm text-crimson-700 truncate">{t?.searchFor || 'Search for'} "{location}"</span>
                          </div>
                        )}

                        <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-3 pt-2 pb-1">
                          {location ? (t?.matchingSuggestions || 'Matching Suggestions') : (t?.browseAllAreas || 'Browse All Areas')}
                        </div>
                        {suggestions.map((s, idx) => (
                          <div
                            key={s.id}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => handleLocationSelect(s.title)}
                            className={`flex items-center justify-between px-3 py-2.5 cursor-pointer transition-colors ${activeIndex === idx ? 'bg-crimson-50' : 'hover:bg-slate-50'}`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <SuggestionIcon category={s.category} />
                              <span className="font-bold text-sm text-slate-800 truncate">{s.title}</span>
                            </div>
                            <span className="text-[9px] font-black text-slate-500 bg-slate-100 px-2 py-1 rounded-md uppercase tracking-wider shrink-0 ml-3">{s.type}</span>
                          </div>
                        ))}
                        {location && suggestions.length === 0 && (
                          <div className="px-4 py-4 text-sm font-bold text-slate-400 text-center">{t?.noPropsFound || 'No results found'}</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div
                  className="flex-1 flex items-center px-4 w-full cursor-pointer relative group min-w-0 hover:bg-slate-50/60 transition-colors"
                  ref={typeRef}
                  onClick={() => setIsTypeOpen(!isTypeOpen)}
                >
                  <div className="bg-emerald-50 p-2.5 rounded-2xl mr-3 shrink-0 shadow-sm border border-emerald-100"><HomeIcon size={17} className="text-emerald-600" /></div>
                  <div className="flex flex-col flex-1 text-left min-w-0">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-0.5 cursor-pointer">{t?.typeLabel || 'Type'}</label>
                    <div className="flex justify-between items-center w-full">
                      <span className="font-bold text-sm text-slate-900 truncate pr-2">{selectedType.label[langKey]}</span>
                      <ChevronDown size={12} className={`text-slate-400 shrink-0 transition-transform duration-300 ${isTypeOpen ? 'rotate-180' : ''}`} />
                    </div>
                  </div>
                  {isTypeOpen && (
                    <div className="absolute top-[calc(100%+12px)] left-0 w-full min-w-[220px] max-h-[220px] overflow-y-auto bg-white shadow-[0_20px_50px_rgba(0,0,0,0.15)] rounded-2xl p-2 z-[300] border border-slate-100">
                      {activePropertyTypes.map(type => (
                        <div
                          key={type.id}
                          onClick={e => { e.stopPropagation(); setSelectedType(type); setIsTypeOpen(false); }}
                          className={`px-4 py-2.5 cursor-pointer rounded-xl transition-all text-sm font-bold flex items-center justify-between ${selectedType.id === type.id ? 'bg-emerald-50 text-emerald-700' : 'hover:bg-slate-50 text-slate-700'}`}
                        >
                          {type.label[langKey]}
                          {selectedType.id === type.id && <Check size={14} className="text-emerald-600" />}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div
                  className="flex-1 flex items-center px-4 w-full cursor-pointer relative group min-w-0 hover:bg-slate-50/60 rounded-r-full transition-colors"
                  ref={budgetRef}
                  onClick={e => { if (!e.target.closest('.custom-budget-inputs')) setIsBudgetOpen(!isBudgetOpen); }}
                >
                  <div className="bg-amber-50 p-2.5 rounded-2xl mr-3 shrink-0 shadow-sm border border-amber-100"><Wallet size={17} className="text-amber-500" /></div>
                  <div className="flex flex-col flex-1 text-left min-w-0">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-0.5 cursor-pointer">{t?.budgetLabel || 'Budget'}</label>
                    <div className="flex justify-between items-center w-full">
                      <span className="font-bold text-sm text-slate-900 truncate pr-2">
                        {customMin && customMax ? `${customMin / 1000}k – ${customMax / 1000}k BDT` : selectedBudget.label[langKey]}
                      </span>
                      <ChevronDown size={12} className={`text-slate-400 shrink-0 transition-transform duration-300 ${isBudgetOpen ? 'rotate-180' : ''}`} />
                    </div>
                  </div>
                  {isBudgetOpen && (
                    <div className="absolute top-[calc(100%+12px)] right-0 w-full min-w-[260px] max-h-[300px] overflow-y-auto bg-white shadow-[0_20px_50px_rgba(0,0,0,0.15)] rounded-2xl p-3 z-[300] border border-slate-100 custom-budget-inputs cursor-default">
                      {budgetRanges.map(budget => (
                        <div
                          key={budget.id}
                          onClick={() => { setSelectedBudget(budget); setCustomMin(''); setCustomMax(''); setIsBudgetOpen(false); }}
                          className={`px-4 py-2.5 cursor-pointer rounded-xl transition-all text-sm font-bold flex items-center justify-between mb-1 ${selectedBudget.id === budget.id && !customMin ? 'bg-amber-50 text-amber-700' : 'hover:bg-slate-50 text-slate-700'}`}
                        >
                          {budget.label[langKey]}
                          {selectedBudget.id === budget.id && !customMin && <Check size={14} className="text-amber-600" />}
                        </div>
                      ))}
                      <div className="mt-2 pt-3 border-t border-slate-100 px-1">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">{t?.customRange || 'Custom Range (BDT)'}</span>
                        <div className="flex items-center gap-2 mb-2">
                          <input type="number" placeholder="Min" value={customMin} onChange={e => setCustomMin(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-crimson-500 transition-colors" />
                          <span className="text-slate-300 font-bold">–</span>
                          <input type="number" placeholder="Max" value={customMax} onChange={e => setCustomMax(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-crimson-500 transition-colors" />
                        </div>
                        <button onClick={() => setIsBudgetOpen(false)} className="w-full bg-slate-900 text-white py-2 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-colors">{t?.applyRange || 'Apply Range'}</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="pl-2.5 shrink-0">
                <button
                  onClick={handleSearch}
                  className="h-[56px] bg-[#ba0036] hover:bg-[#a0002d] text-white px-8 rounded-full font-black text-sm uppercase tracking-widest active:scale-95 flex items-center justify-center gap-2 transition-all shadow-[0_10px_24px_rgba(186,0,54,0.35)]"
                >
                  <Search size={16} /> {t?.searchBtn || 'Search'}
                </button>
              </div>
            </div>
          </div>

          {/* ── Trust badges ── */}
          <div className="flex items-stretch justify-center gap-3 md:gap-4 mt-5 md:mt-6 flex-wrap relative z-10">
            <div className="flex items-center gap-3 px-5 py-3.5 md:px-6 md:py-4 bg-white/80 backdrop-blur-xl rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.12)] border border-white/70 hover:border-emerald-300 hover:bg-emerald-50/90 hover:shadow-[0_6px_28px_rgba(16,185,129,0.2)] cursor-pointer transition-all duration-200 group min-w-[140px] md:min-w-[170px]">
              <div className="w-9 h-9 md:w-10 md:h-10 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0 group-hover:bg-emerald-200 transition-colors">
                <ShieldCheck size={18} className="text-emerald-600" />
              </div>
              <div className="flex flex-col">
                <span className="text-xs md:text-sm font-black text-slate-800 whitespace-nowrap leading-tight">{t?.verifiedHosts || 'Verified Hosts'}</span>
                <span className="text-[10px] md:text-[11px] font-semibold text-slate-500 whitespace-nowrap">100% Trusted</span>
              </div>
            </div>
            <div className="flex items-center gap-3 px-5 py-3.5 md:px-6 md:py-4 bg-white/80 backdrop-blur-xl rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.12)] border border-white/70 hover:border-blue-300 hover:bg-blue-50/90 hover:shadow-[0_6px_28px_rgba(59,130,246,0.2)] cursor-pointer transition-all duration-200 group min-w-[140px] md:min-w-[170px]">
              <div className="w-9 h-9 md:w-10 md:h-10 rounded-xl bg-blue-100 flex items-center justify-center shrink-0 group-hover:bg-blue-200 transition-colors">
                <Zap size={18} className="text-blue-600" />
              </div>
              <div className="flex flex-col">
                <span className="text-xs md:text-sm font-black text-slate-800 whitespace-nowrap leading-tight">{t?.instantBooking || 'Instant Booking'}</span>
                <span className="text-[10px] md:text-[11px] font-semibold text-slate-500 whitespace-nowrap">Book in seconds</span>
              </div>
            </div>
            <div className="flex items-center gap-3 px-5 py-3.5 md:px-6 md:py-4 bg-white/80 backdrop-blur-xl rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.12)] border border-white/70 hover:border-amber-300 hover:bg-amber-50/90 hover:shadow-[0_6px_28px_rgba(245,158,11,0.2)] cursor-pointer transition-all duration-200 group min-w-[140px] md:min-w-[170px]">
              <div className="w-9 h-9 md:w-10 md:h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0 group-hover:bg-amber-200 transition-colors">
                <HeadphonesIcon size={18} className="text-amber-600" />
              </div>
              <div className="flex flex-col">
                <span className="text-xs md:text-sm font-black text-slate-800 whitespace-nowrap leading-tight">{t?.support247 || '24/7 Support'}</span>
                <span className="text-[10px] md:text-[11px] font-semibold text-slate-500 whitespace-nowrap">Always here for you</span>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* APP PROMO BANNER                                              */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <section className="w-full max-w-[1400px] mx-auto px-4 md:px-6 mt-6 md:mt-10">
          <div className="w-full rounded-[1.75rem] overflow-hidden relative shadow-xl border border-white/5">
            <div className="absolute inset-0 bg-gradient-to-br from-[#0d0d14] via-[#1a0a14] to-[#0d0d20]" />
            <div className="absolute top-0 right-0 w-[420px] h-[420px] bg-[#ba0036]/25 rounded-full blur-[90px] pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-[260px] h-[260px] bg-blue-600/10 rounded-full blur-[70px] pointer-events-none" />

            <div className="relative z-10 flex flex-col md:flex-row items-center gap-6 px-6 py-8 md:px-14 md:py-10">
              <div className="flex-1 text-center md:text-left">
                <div className="inline-flex items-center gap-2 bg-[#ba0036] text-white text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full mb-4 shadow-[0_0_16px_rgba(186,0,54,0.5)]">
                  <Sparkles size={11} className="fill-white" /> {t?.limitedTimeOffer || 'Limited Time Offer'}
                </div>
                <h3 className="text-2xl md:text-3xl font-black text-white leading-tight mb-2">
                  {language === 'বাংলা' ? (
                    <>১০ গুণ দ্রুত খুঁজুন <span className="text-[#ff4d7d]">স্বপ্নের বাড়ি</span></>
                  ) : (
                    <>Find your dream home <span className="text-[#ff4d7d]">10× faster</span></>
                  )}
                </h3>
                <p className="text-slate-300 text-xs md:text-sm font-medium max-w-md leading-relaxed">
                  {t?.promoBannerDesc || 'Download the TO-LET PRO app and get instant alerts when a property matching your criteria goes live. Zero brokerage fees.'}
                </p>
              </div>

              <div className="shrink-0 flex flex-col sm:flex-row md:flex-col gap-3 items-center">
                <div className="flex items-center gap-4 bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl px-5 py-3.5 shadow-inner">
                  <div className="flex flex-col items-start">
                    <span className="text-[9px] text-slate-300 font-bold uppercase tracking-widest leading-none mb-0.5">{t?.availableOn || 'Available on'}</span>
                    <span className="text-white font-black text-sm leading-tight">iOS & Android</span>
                  </div>
                  <div className="h-9 w-px bg-white/25" />
                  <div className="flex flex-col items-center">
                    <span className="text-[9px] text-slate-300 font-bold uppercase tracking-widest leading-none mb-0.5">{t?.priceLabel || 'Price'}</span>
                    <span className="text-3xl font-black text-white leading-none">{language === 'বাংলা' ? 'ফ্রি' : 'FREE'}</span>
                  </div>
                </div>
                <button
                  onClick={() => navigate('/download')}
                  className="bg-[#ba0036] hover:bg-[#d4004a] text-white px-7 py-3.5 rounded-full font-black text-xs uppercase tracking-widest shadow-[0_8px_24px_rgba(186,0,54,0.45)] hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
                >
                  <Zap size={13} /> {t?.getApp || 'Get the App'}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* 3. POPULAR DISTRICTS (Marquee Slider)                         */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <section className="w-full mt-12 md:mt-24 overflow-hidden relative">
          <div className="max-w-[1400px] mx-auto px-4 md:px-6 mb-6">
            <h2 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">{t?.exploreDivisions || 'Explore Divisions'}</h2>
            <p className="text-sm font-bold text-slate-500 mt-1">{t?.exploreDivisionsDesc || 'Discover properties across all major cities'}</p>
          </div>

          <style>{`
            @keyframes scroll-x { 0% { transform: translateX(0); } 100% { transform: translateX(calc(-50% - 0.5rem)); } }
            .animate-marquee { animation: scroll-x 40s linear infinite; display: flex; width: max-content; }
            .animate-marquee:hover { animation-play-state: paused; }
            .custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
            .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
            .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #cbd5e1; border-radius: 20px; }
          `}</style>

          <div className="relative w-full flex overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-16 md:w-32 bg-gradient-to-r from-slate-50 to-transparent z-10 pointer-events-none" />
            <div className="absolute right-0 top-0 bottom-0 w-16 md:w-32 bg-gradient-to-l from-slate-50 to-transparent z-10 pointer-events-none" />
            <div className="animate-marquee gap-4 px-4">
              {sliderItems.map((div, idx) => (
                <div
                  key={idx}
                  onClick={() => navigate(`/properties/${div.id}`)}
                  className="group w-[260px] md:w-[320px] h-[300px] md:h-[360px] rounded-[1.5rem] md:rounded-[2rem] overflow-hidden relative cursor-pointer shadow-[0_10px_30px_rgba(0,0,0,0.04)] hover:shadow-[0_20px_40px_rgba(186,0,54,0.15)] transition-all duration-500 shrink-0 bg-white"
                >
                  <div className="absolute inset-0 bg-cover bg-center group-hover:scale-110 transition-transform duration-700 ease-out" style={{ backgroundImage: `url(${div.image})` }} />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
                  <div className="absolute bottom-6 left-6 pr-6">
                    <span className="bg-white/20 backdrop-blur-md text-white text-[9px] md:text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full border border-white/20 mb-3 block w-max shadow-sm">
                      {t?.cityTags?.[div.id] || div.desc}
                    </span>
                    <h3 className="text-2xl md:text-3xl font-black text-white group-hover:-translate-y-1 transition-transform duration-300">
                      {t?.cities?.[div.id] || div.name}
                    </h3>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* HOST PROMOTIONAL BANNER (Futuristic Landlord CTA)             */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <section className="w-full max-w-[1400px] mx-auto px-4 md:px-6 mt-12 md:mt-20">
          <div className="w-full bg-[#0a0a0f] rounded-[2.5rem] p-8 md:p-14 flex flex-col md:flex-row items-center justify-between relative overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.2)] border border-white/10 group">
            
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />
            <div className="absolute top-0 right-1/4 w-[400px] md:w-[600px] h-[400px] md:h-[600px] bg-[#ba0036]/20 rounded-full blur-[100px] md:blur-[130px] -translate-y-1/2 pointer-events-none transition-transform duration-700 group-hover:scale-110" />
            <div className="absolute bottom-0 right-0 w-[300px] h-[300px] bg-blue-500/10 rounded-full blur-[100px] translate-y-1/3 translate-x-1/3 pointer-events-none" />
            
            <div className="absolute left-0 top-1/2 w-1.5 h-32 bg-gradient-to-b from-transparent via-[#ba0036] to-transparent -translate-y-1/2 opacity-80 shadow-[0_0_15px_#ba0036]" />

            <div className="relative z-10 md:max-w-3xl text-center md:text-left mb-10 md:mb-0">
              <div className="inline-flex items-center gap-2 bg-white/5 backdrop-blur-xl text-white text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-full border border-white/10 mb-6 shadow-sm">
                <Building size={14} className="text-[#ba0036]" /> 
                {language === 'বাংলা' ? 'ল্যান্ডলর্ড ও প্রপার্টি মালিকদের জন্য' : 'For Landlords & Property Owners'}
              </div>
              
              <h2 className="text-3xl md:text-5xl lg:text-[54px] font-black text-white mb-5 leading-[1.15] tracking-tight">
                {language === 'বাংলা' ? (
                  <>সঠিক ভাড়াটিয়া খুঁজুন <br className="hidden md:block" /> <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#ff4d7d] to-[#ba0036]">আরও দ্রুত। ১০০% ফ্রি।</span></>
                ) : (
                  <>Find Reliable Tenants <br className="hidden md:block" /> <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#ff4d7d] to-[#ba0036]">Faster. Smarter. 100% Free.</span></>
                )}
              </h2>
              
              <p className="text-slate-400 font-medium text-sm md:text-base mb-8 max-w-xl leading-relaxed mx-auto md:mx-0">
                {language === 'বাংলা' ? 'দালালের ঝামেলা এড়িয়ে চলুন। আমাদের এআই-চালিত প্ল্যাটফর্মে লিস্ট করে হাজারো ভেরিফাইড ভাড়াটিয়ার কাছে পৌঁছান।' : 'Skip the hassle of brokers. List your property on our AI-powered platform to reach thousands of verified tenants instantly. Total control, zero hidden charges.'}
              </p>

              <div className="flex flex-wrap justify-center md:justify-start items-center gap-3">
                {[
                  { icon: <ShieldCheck size={14} className="text-emerald-400" />, text: language === 'বাংলা' ? 'যাচাইকৃত লিড' : 'Verified Leads' },
                  { icon: <Zap size={14} className="text-amber-400" />, text: language === 'বাংলা' ? 'এআই ম্যাচমেকিং' : 'AI Matchmaking' },
                  { icon: <Wallet size={14} className="text-[#ff4d7d]" />, text: language === 'বাংলা' ? 'কোনো ব্রোকারেজ নেই' : 'Zero Brokerage' }
                ].map((f, i) => (
                  <div key={i} className="flex items-center gap-1.5 bg-white/5 border border-white/10 px-3.5 py-2 rounded-xl backdrop-blur-md hover:bg-white/10 transition-colors cursor-default">
                    {f.icon}
                    <span className="text-xs font-bold text-slate-300">{f.text}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative z-10 shrink-0 flex flex-col items-center md:items-end gap-4">
              <button
                onClick={() => navigate('/list-property')}
                className="group/btn relative overflow-hidden bg-white text-slate-900 px-8 py-4 md:px-10 md:py-5 rounded-2xl font-black text-sm md:text-base uppercase tracking-widest shadow-[0_0_40px_rgba(255,255,255,0.15)] hover:shadow-[0_0_60px_rgba(186,0,54,0.4)] hover:-translate-y-1 active:scale-95 transition-all duration-300 flex items-center gap-3 border border-white"
              >
                <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-[#ba0036] to-[#ff4d7d] opacity-0 group-hover/btn:opacity-100 transition-opacity duration-300 z-0" />
                <PlusCircle size={20} className="relative z-10 group-hover/btn:text-white transition-colors" /> 
                <span className="relative z-10 group-hover/btn:text-white transition-colors">
                  {language === 'বাংলা' ? 'ফ্রি লিস্টিং শুরু করুন' : 'Start Listing Free'}
                </span>
              </button>
              
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </span>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  {language === 'বাংলা' ? '৩ মিনিটেরও কম সময় লাগে' : 'Takes less than 3 minutes'}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* 4. DHAKA'S FINEST DISTRICTS                                   */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <section className="w-full max-w-[1400px] mx-auto mt-16 md:mt-24">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 px-4 md:px-6 gap-4">
            <div>
              <h2 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight">{t?.dhakasFinest || "Dhaka's Finest"}</h2>
              <p className="text-sm md:text-base font-bold text-slate-500 mt-2">{t?.dhakasFinestDesc || 'Premium living spaces in top-tier neighborhoods'}</p>
            </div>
            <button onClick={() => navigate('/properties/dhaka')} className="hidden md:flex items-center gap-2 text-sm font-bold text-crimson-500 hover:text-crimson-600 transition-colors">
              {t?.exploreAll || 'Explore All'} <ArrowRight size={16} />
            </button>
          </div>

          <div className="flex overflow-x-auto gap-4 md:gap-6 pb-6 px-4 md:px-6 snap-x snap-mandatory scroll-px-4 md:scroll-px-6 custom-scrollbar md:grid md:grid-cols-2 lg:grid-cols-3 md:pb-0 md:overflow-visible">
            {dhakaFinest.map((area, idx) => (
              <div
                key={idx}
                onClick={() => navigate(`/properties/${area.id}`)}
                className="shrink-0 w-[85vw] snap-center md:w-auto group relative h-[300px] md:h-[320px] rounded-[2rem] overflow-hidden cursor-pointer bg-white shadow-[0_8px_30px_rgba(0,0,0,0.04)] hover:shadow-[0_20px_40px_rgba(186,0,54,0.1)] transition-all duration-500 hover:-translate-y-1 border border-slate-100"
              >
                <div className="absolute inset-0 bg-cover bg-center group-hover:scale-105 transition-transform duration-700 ease-out" style={{ backgroundImage: `url(${area.image})` }} />
                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/80" />
                <div className="absolute top-5 right-5 bg-white/90 backdrop-blur-md text-slate-900 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full shadow-sm">
                  {area.tag}
                </div>
                <div className="absolute bottom-4 left-4 right-4 bg-white/20 backdrop-blur-xl border border-white/30 p-4 rounded-3xl flex items-center justify-between group-hover:bg-white/30 transition-colors">
                  <div>
                    <h3 className="text-xl font-black text-white">{t?.districtNames?.[area.id] || area.name}</h3>
                    <p className="text-xs font-bold text-white/80 mt-0.5">{area.properties} {t?.properties || 'Properties'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold text-white/70 uppercase tracking-widest mb-0.5">{t?.avgRent || 'Avg. Rent'}</p>
                    <p className="text-sm font-black text-white">{area.price}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* 5. SOCIAL PROOF — stats + testimonials                        */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <section className="w-full bg-white mt-16 md:mt-32 py-14 md:py-24 border-t border-slate-100">
          <div className="max-w-[1400px] mx-auto px-4 md:px-6">

            <div className="text-center max-w-2xl mx-auto mb-10 md:mb-16">
              <div className="inline-flex items-center gap-2 bg-amber-50 text-amber-600 text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full border border-amber-200 mb-4">
                <Star size={11} className="fill-amber-500" /> {t?.trustedByBD || 'Trusted by Bangladesh'}
              </div>
              <h2 className="text-xl md:text-5xl font-black text-slate-900 tracking-tight mb-2 md:mb-4">{t?.poweredByTrust || 'Powered by Trust'}</h2>
              <p className="text-xs md:text-base font-bold text-slate-500">{t?.poweredByTrustDesc || 'The largest, most secure, and technologically advanced property rental network in Bangladesh — loved by real people.'}</p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5 mb-10 md:mb-14">
              {[
                { icon: <MapPin size={20} className="text-[#ba0036]" />, bg: 'bg-rose-50', border: 'border-rose-100', value: '64+', label: t?.districtsCovered || 'Districts Covered', sub: t?.nationwideNetworkSub || 'Nationwide network' },
                { icon: <Users size={20} className="text-emerald-600" />, bg: 'bg-emerald-50', border: 'border-emerald-100', value: '1M+', label: t?.statActiveUsers || 'Active Users', sub: t?.growingDaily || 'And growing daily' },
                { icon: <Building size={20} className="text-amber-500" />, bg: 'bg-amber-50', border: 'border-amber-100', value: '100k+', label: t?.statVerifiedHomes || 'Verified Homes', sub: t?.zeroFakeListings || 'Zero fake listings' },
                { icon: <Star size={20} className="text-violet-500 fill-violet-500" />, bg: 'bg-violet-50', border: 'border-violet-100', value: '4.9★', label: t?.statAppRating || 'App Rating', sub: t?.reviewsCount || '12,000+ reviews' },
              ].map((s, i) => (
                <div key={i} className={`${s.bg} ${s.border} border rounded-[1.5rem] p-5 md:p-6 flex flex-col gap-3 hover:-translate-y-1 transition-transform duration-300`}>
                  <div className="w-9 h-9 bg-white rounded-xl shadow-sm flex items-center justify-center">{s.icon}</div>
                  <div>
                    <p className="text-2xl md:text-3xl font-black text-slate-900 leading-none">{s.value}</p>
                    <p className="text-xs font-black text-slate-700 mt-1">{s.label}</p>
                    <p className="text-[10px] font-medium text-slate-400 mt-0.5">{s.sub}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-col md:flex-row items-center justify-between gap-6 bg-slate-50 border border-slate-100 rounded-[1.5rem] px-6 py-5 md:px-10 md:py-7 mb-10 md:mb-12">
              <div className="text-center md:text-left">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{t?.overallRating || 'Overall Rating'}</p>
                <div className="flex items-center gap-3">
                  <span className="text-5xl md:text-6xl font-black text-slate-900">4.9</span>
                  <div className="flex flex-col gap-1">
                    <div className="flex gap-0.5">{[1,2,3,4,5].map(s => <Star key={s} size={18} className="text-amber-400 fill-amber-400" />)}</div>
                    <span className="text-xs font-bold text-slate-500">{t?.basedOnReviews || 'Based on 12,400+ verified reviews'}</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2 w-full md:w-[340px]">
                {[['5 star', 84], ['4 star', 11], ['3 star', 3], ['2 star', 1], ['1 star', 1]].map(([label, pct]) => (
                  <div key={label} className="flex items-center gap-3">
                    <span className="text-[10px] font-bold text-slate-500 w-10 shrink-0">{label}</span>
                    <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[10px] font-black text-slate-600 w-8 text-right">{pct}%</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-col items-center gap-2 shrink-0">
                <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-4 py-2.5 shadow-sm">
                  <svg viewBox="0 0 24 24" className="w-5 h-5 text-slate-800 fill-current"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
                  <div><p className="text-[8px] text-slate-400 font-bold uppercase">{t?.appStore || 'App Store'}</p><p className="text-xs font-black text-slate-800">4.9 / 5.0</p></div>
                </div>
                <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-4 py-2.5 shadow-sm">
                  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" style={{color:'#3ddc84'}}><path d="M17.523 15.341 14.26 9.69l-3.63 3.63 3.336 5.77c.498.86 1.6 1.16 2.46.66.86-.5 1.16-1.6.66-2.46l.437.051zm-11.046 0c-.5.86-.2 1.96.66 2.46.86.5 1.96.2 2.46-.66l3.336-5.77-3.63-3.63-2.826 4.6zm5.523-8.842 3.63 3.63 2.826-4.6c.5-.86.2-1.96-.66-2.46-.86-.5-1.96-.2-2.46.66L12 6.499zM8.524 4.729c-.5-.86-1.6-1.16-2.46-.66-.86.5-1.16 1.6-.66 2.46L8.23 9.69l3.63-3.63-3.336-1.331z"/></svg>
                  <div><p className="text-[8px] text-slate-400 font-bold uppercase">{t?.googlePlay || 'Google Play'}</p><p className="text-xs font-black text-slate-800">4.8 / 5.0</p></div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
              {[
                {
                  name: t?.testimonial1Name || 'Farhan Ahmed',
                  role: t?.testimonial1Role || 'Software Engineer · Dhaka',
                  avatar: 'FA',
                  avatarBg: 'bg-emerald-500',
                  stars: 5,
                  badge: t?.testimonial1Badge || 'Found home in 2 days',
                  badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                  text: t?.testimonial1Text || 'I moved to Dhaka for work and found a perfect furnished apartment in Banani within two days. The verified host feature gave me so much confidence — no broker, no hassle.',
                  area: t?.testimonial1Area || 'Banani, Dhaka',
                  type: t?.testimonial1Type || 'Family Apartment',
                },
                {
                  name: t?.testimonial2Name || 'Nusrat Jahan',
                  role: t?.testimonial2Role || 'University Student · Chittagong',
                  avatar: 'NJ',
                  avatarBg: 'bg-violet-500',
                  stars: 5,
                  badge: t?.testimonial2Badge || 'Saved ৳15,000 in fees',
                  badgeColor: 'bg-violet-50 text-violet-700 border-violet-200',
                  text: t?.testimonial2Text || 'As a female student, safety was my top priority. TO-LET PRO showed only verified female-friendly sublets. The live chat with hosts before visiting was a game-changer.',
                  area: t?.testimonial2Area || 'GEC Circle, Chattogram',
                  type: t?.testimonial2Type || 'Sublet Room',
                },
                {
                  name: t?.testimonial3Name || 'Rakibul Islam',
                  role: t?.testimonial3Role || 'Entrepreneur · Sylhet',
                  avatar: 'RI',
                  avatarBg: 'bg-amber-500',
                  stars: 5,
                  badge: t?.testimonial3Badge || 'Office found in 1 week',
                  badgeColor: 'bg-amber-50 text-amber-700 border-amber-200',
                  text: t?.testimonial3Text || 'Listed my commercial space and got three serious inquiries the same day. The platform is incredibly professional. I\'ve recommended it to every business owner I know.',
                  area: t?.testimonial3Area || 'Zindabazar, Sylhet',
                  type: t?.testimonial3Type || 'Commercial Space',
                },
              ].map((testimonial, i) => (
                <div key={i} className="flex flex-col bg-white border border-slate-100 rounded-[1.5rem] p-6 shadow-[0_4px_20px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)] hover:-translate-y-1 transition-all duration-300">
                  <div className="flex gap-0.5 mb-3">{[...Array(testimonial.stars)].map((_, s) => <Star key={s} size={14} className="text-amber-400 fill-amber-400" />)}</div>
                  <div className={`inline-flex items-center gap-1.5 self-start border text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full mb-3 ${testimonial.badgeColor}`}>
                    <CheckCircle2 size={10} /> {testimonial.badge}
                  </div>
                  <p className="text-sm font-medium text-slate-600 leading-relaxed flex-1 mb-5">"{testimonial.text}"</p>
                  <div className="border-t border-slate-50 pt-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 ${testimonial.avatarBg} rounded-xl flex items-center justify-center text-white text-xs font-black shrink-0`}>{testimonial.avatar}</div>
                      <div>
                        <p className="text-xs font-black text-slate-900">{testimonial.name}</p>
                        <p className="text-[10px] font-medium text-slate-400">{testimonial.role}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{testimonial.type}</p>
                      <p className="text-[10px] font-bold text-slate-600 flex items-center gap-1 justify-end mt-0.5"><MapPin size={9} className="text-[#ba0036]" />{testimonial.area}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 md:mt-6 bg-slate-900 rounded-[1.5rem] md:rounded-[2rem] p-6 md:p-8 border border-slate-800 relative overflow-hidden flex flex-col md:flex-row items-center gap-6">
              <div className="absolute top-0 right-0 w-48 h-48 md:w-72 md:h-72 bg-[#ba0036]/15 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />
              <div className="relative z-10 w-14 h-14 bg-white/10 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/10 shrink-0">
                <Zap size={24} className="text-[#ff4d7d]" />
              </div>
              <div className="relative z-10 text-center md:text-left flex-1">
                <h3 className="text-xl md:text-2xl font-black text-white mb-1">{t?.smartAITitle || 'Smart AI-Powered Search'}</h3>
                <p className="text-xs md:text-sm font-medium text-slate-400">{t?.smartAIDesc || "Our NLP engine learns your preferences and surfaces the exact homes you'd love — before you even finish typing."}</p>
              </div>
              <div className="relative z-10 flex items-center gap-3 shrink-0">
                <div className="flex -space-x-2">{['bg-emerald-400','bg-blue-400','bg-violet-400','bg-amber-400'].map((c,i) => <div key={i} className={`w-8 h-8 ${c} rounded-full border-2 border-slate-900`} />)}</div>
                <p className="text-xs font-black text-slate-300">{t?.happyUsers || '+1M happy users'}</p>
              </div>
            </div>

          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* FOOTER                                                        */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <footer className="w-full bg-slate-950 border-t border-white/10 pt-10 md:pt-24 pb-6 md:pb-8 font-sans">
          <div className="max-w-[1400px] mx-auto px-4 md:px-6">
            <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-8 mb-8 md:mb-16">

              <div className="col-span-2 md:col-span-1 flex flex-col gap-3 md:gap-6">
                <a href="/" className="flex items-center gap-2">
                  <div className="bg-crimson-500 p-1.5 rounded-lg"><HomeIcon className="text-white w-4 h-4 md:w-5 md:h-5" /></div>
                  <h1 className="font-black text-base md:text-2xl tracking-tighter text-white">TO-LET <span className="text-crimson-500">PRO</span></h1>
                </a>
                <p className="text-[11px] md:text-sm font-medium text-slate-400 leading-relaxed max-w-[280px]">
                  {t?.footerDesc || "Bangladesh's most trusted property rental platform. Designed for the modern era, built for your comfort."}
                </p>
                <div className="flex items-center gap-3 text-slate-400">
                  <a href="#" className="hover:text-crimson-500 transition-colors">
                    <svg fill="currentColor" viewBox="0 0 24 24" className="w-4 h-4"><path d="M22.675 0h-21.35c-.732 0-1.325.593-1.325 1.325v21.351c0 .731.593 1.324 1.325 1.324h11.495v-9.294h-3.128v-3.622h3.128v-2.671c0-3.1 1.893-4.788 4.659-4.788 1.325 0 2.463.099 2.795.143v3.24l-1.918.001c-1.504 0-1.795.715-1.795 1.763v2.312h3.587l-.467 3.622h-3.12v9.293h6.116c.73 0 1.323-.593 1.323-1.325v-21.35c0-.732-.593-1.325-1.325-1.325z" /></svg>
                  </a>
                  <a href="#" className="hover:text-crimson-500 transition-colors">
                    <svg fill="currentColor" viewBox="0 0 24 24" className="w-4 h-4"><path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z" /></svg>
                  </a>
                  <a href="#" className="hover:text-crimson-500 transition-colors">
                    <svg fill="currentColor" viewBox="0 0 24 24" className="w-4 h-4"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" /></svg>
                  </a>
                </div>
              </div>

              <div>
                <h4 className="text-white font-black uppercase tracking-widest text-[9px] md:text-xs mb-3 md:mb-6">{t?.exploreFooter || 'Explore'}</h4>
                <ul className="flex flex-col gap-2 md:gap-4 text-[11px] md:text-sm font-bold text-slate-400">
                  <li><a href="#" className="hover:text-white transition-colors">{t?.allProperties || 'All Properties'}</a></li>
                  <li><a href="#" className="hover:text-white transition-colors">{t?.popularDistrictsFooter || 'Popular Districts'}</a></li>
                  <li><a href="#" className="hover:text-white transition-colors">{t?.commercialSpaces || 'Commercial Spaces'}</a></li>
                  <li><a href="#" className="hover:text-white transition-colors">{t?.hostDashboard || 'Host Dashboard'}</a></li>
                </ul>
              </div>

              <div>
                <h4 className="text-white font-black uppercase tracking-widest text-[9px] md:text-xs mb-3 md:mb-6">{t?.legalFooter || 'Legal'}</h4>
                <ul className="flex flex-col gap-2 md:gap-4 text-[11px] md:text-sm font-bold text-slate-400">
                  <li><a href="#" className="hover:text-white transition-colors">{t?.termsOfService || 'Terms of Service'}</a></li>
                  <li><a href="#" className="hover:text-white transition-colors">{t?.privacyPolicy || 'Privacy Policy'}</a></li>
                  <li><a href="#" className="hover:text-white transition-colors">{t?.trustSafety || 'Trust & Safety'}</a></li>
                  <li><a href="#" className="hover:text-white transition-colors">{t?.refundPolicy || 'Refund Policy'}</a></li>
                </ul>
              </div>

              <div>
                <h4 className="text-white font-black uppercase tracking-widest text-[9px] md:text-xs mb-3 md:mb-6">{t?.contactUs || 'Contact Us'}</h4>
                <ul className="flex flex-col gap-2 md:gap-4 text-[11px] md:text-sm font-bold text-slate-400">
                  <li className="flex items-center gap-2"><Mail size={13} className="text-crimson-500 shrink-0" /> support@toletpro.com</li>
                  <li className="flex items-center gap-2"><Phone size={13} className="text-crimson-500 shrink-0" /> +880 1234 567890</li>
                  <li className="flex items-center gap-2"><MapPin size={13} className="text-crimson-500 shrink-0" /> Banani, Dhaka, Bangladesh</li>
                </ul>
              </div>
            </div>

            <div className="pt-5 md:pt-8 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-2 text-center md:text-left">
              <p className="text-[10px] md:text-xs font-bold text-slate-500">&copy; {new Date().getFullYear()} TO-LET PRO. All rights reserved.</p>
              <div className="flex items-center gap-1.5 text-[10px] md:text-xs font-bold text-slate-500">
                {t?.builtInBD || 'Built with love in Bangladesh'} <ShieldCheck size={11} className="text-emerald-500" />
              </div>
            </div>
          </div>
        </footer>

      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* MOBILE BOTTOM SHEET — Property Type                           */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {isMobileTypeOpen && (
        <div className="fixed inset-0 h-[100dvh] z-[9999] flex flex-col justify-end md:hidden font-sans">
          <div
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm touch-none"
            onClick={() => setIsMobileTypeOpen(false)}
          />
          <div className="bg-white w-full rounded-t-[1.5rem] p-5 pb-10 relative z-10 shadow-[0_-10px_40px_rgba(0,0,0,0.15)] will-change-transform">
            <div className="w-10 h-1.5 bg-slate-200 rounded-full mx-auto mb-4" />
            <h2 className="text-base font-black text-slate-900 mb-3 text-center">
              {language === 'বাংলা' ? 'প্রপার্টির ধরন' : 'Property Type'}
            </h2>
            <div className="flex flex-col gap-1.5 max-h-[60dvh] overflow-y-auto overscroll-contain">
              {activePropertyTypes.map(type => (
                <button
                  key={type.id}
                  onClick={() => { setSelectedType(type); setIsMobileTypeOpen(false); }}
                  className={`p-3 rounded-xl text-sm font-bold flex justify-between items-center transition-all ${selectedType.id === type.id ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border border-transparent'}`}
                >
                  {type.label[langKey]} {selectedType.id === type.id && <Check size={15} />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* MOBILE BOTTOM SHEET — Budget                                  */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {isMobileBudgetOpen && (
        <div className="fixed inset-0 h-[100dvh] z-[9999] flex flex-col justify-end md:hidden font-sans">
          <div
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm touch-none"
            onClick={() => setIsMobileBudgetOpen(false)}
          />
          <div className="bg-white w-full rounded-t-[1.5rem] p-5 pb-10 relative z-10 shadow-[0_-10px_40px_rgba(0,0,0,0.15)] will-change-transform">
            <div className="w-10 h-1.5 bg-slate-200 rounded-full mx-auto mb-4" />
            <h2 className="text-base font-black text-slate-900 mb-3 text-center">
              {language === 'বাংলা' ? 'আপনার বাজেট' : 'Budget Range'}
            </h2>
            <div className="flex flex-col gap-1.5 mb-4 max-h-[40dvh] overflow-y-auto overscroll-contain">
              {budgetRanges.map(budget => (
                <button
                  key={budget.id}
                  onClick={() => { setSelectedBudget(budget); setCustomMin(''); setCustomMax(''); setIsMobileBudgetOpen(false); }}
                  className={`p-3 rounded-xl text-sm font-bold flex justify-between items-center transition-all ${selectedBudget.id === budget.id && !customMin ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border border-transparent'}`}
                >
                  {budget.label[langKey]} {selectedBudget.id === budget.id && !customMin && <Check size={15} />}
                </button>
              ))}
            </div>
            <div className="pt-3 border-t border-slate-100">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">{t?.customRange || 'Custom Range (BDT)'}</span>
              <div className="flex items-center gap-2 mb-3">
                <input type="number" placeholder="Min" value={customMin} onChange={e => setCustomMin(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-crimson-500 transition-colors" />
                <span className="text-slate-300 font-bold">–</span>
                <input type="number" placeholder="Max" value={customMax} onChange={e => setCustomMax(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-crimson-500 transition-colors" />
              </div>
              <button onClick={() => setIsMobileBudgetOpen(false)} className="w-full bg-slate-900 text-white py-3 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-colors shadow-md">
                {t?.applyRange || 'Apply Range'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default HeroSection;
