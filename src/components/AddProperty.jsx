import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, MapPin, BedDouble, Bath,
  Square, Wifi, Snowflake, Car, Zap, ShieldCheck, Home, Users,
  Upload, Image as ImageIcon, Video, X, Plus, Info,
  Building, Sparkles, DollarSign, FileText, Camera,
  ChevronDown, Globe, Star, Play, Layers, Eye,
  LayoutDashboard, Navigation, Map, Wand2, RefreshCw,
  ShoppingBag, Briefcase, Store
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

// ─── LISTING INTENT ─────────────────────────────────────────────────────────
const LISTING_INTENTS = [
  {
    id: 'rent',
    label: 'Rent',
    labelBn: 'ভাড়া',
    icon: Home,
    desc: 'List your property for rent',
    descBn: 'ভাড়ার জন্য প্রপার্টি তালিকাভুক্ত করুন',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    accent: '#2563eb',
  },
  {
    id: 'purchase',
    label: 'Purchase / Buy',
    labelBn: 'কিনুন / ক্রয়',
    icon: ShoppingBag,
    desc: 'Sell your property',
    descBn: 'বিক্রির জন্য প্রপার্টি তালিকাভুক্ত করুন',
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    accent: '#059669',
  },
  {
    id: 'commercial',
    label: 'Commercial',
    labelBn: 'বাণিজ্যিক',
    icon: Briefcase,
    desc: 'Office, shop, or commercial space',
    descBn: 'অফিস, দোকান বা বাণিজ্যিক স্থান',
    color: 'text-violet-600',
    bg: 'bg-violet-50',
    accent: '#7c3aed',
  },
];

// ─── PROPERTY TYPES & CATEGORIES BY INTENT ───────────────────────────────────
const INTENT_DATA = {
  rent: {
    types: [
      { id: 'apartment',   label: 'Apartment',    labelBn: 'অ্যাপার্টমেন্ট', icon: Building },
      { id: 'sublet',      label: 'Sublet',       labelBn: 'সাবলেট',          icon: Layers },
      { id: 'hostel',      label: 'Hostel',       labelBn: 'হোস্টেল',         icon: Users },
      { id: 'single_room', label: 'Single Room',  labelBn: 'একক রুম',         icon: Square },
    ],
    categories: [
      { id: 'family',          label: 'Family',          labelBn: 'পারিবারিক',        emoji: '👨‍👩‍👧‍👦' },
      { id: 'bachelor_male',   label: 'Bachelor (Male)', labelBn: 'ব্যাচেলর (পুরুষ)', emoji: '👨' },
      { id: 'bachelor_female', label: 'Bachelor (Female)',labelBn: 'ব্যাচেলর (মহিলা)',emoji: '👩' },
      { id: 'student',         label: 'Student',         labelBn: 'ছাত্র / ছাত্রী',   emoji: '🎓' },
    ],
    typeLabel: 'Property Type',
    typeLabelBn: 'প্রপার্টির ধরন',
    catLabel: 'Property Category',
    catLabelBn: 'প্রপার্টির ক্যাটাগরি',
    priceLabel: 'Monthly Rent (BDT)',
    priceLabelBn: 'মাসিক ভাড়া (BDT)',
    pricePlaceholder: 'e.g. 25000',
    pricePlaceholderBn: 'যেমন: ২৫০০০',
  },
  purchase: {
    types: [
      { id: 'flat',     label: 'Flat',        labelBn: 'ফ্ল্যাট',       icon: Building },
      { id: 'house',    label: 'House',       labelBn: 'বাড়ি',           icon: Home },
      { id: 'land',     label: 'Land / Plot', labelBn: 'জমি / প্লট',    icon: Map },
      { id: 'building', label: 'Building',   labelBn: 'বিল্ডিং',       icon: Layers },
    ],
    categories: [
      { id: 'ready_flat',   label: 'Ready Flat',    labelBn: 'রেডি ফ্ল্যাট',    emoji: '🏢' },
      { id: 'used',         label: 'Used Property', labelBn: 'ব্যবহৃত প্রপার্টি',emoji: '🏠' },
      { id: 'new_project',  label: 'New Project',   labelBn: 'নতুন প্রজেক্ট',   emoji: '🏗️' },
      { id: 'investment',   label: 'Investment',    labelBn: 'বিনিয়োগ',          emoji: '💹' },
    ],
    typeLabel: 'Property Type',
    typeLabelBn: 'প্রপার্টির ধরন',
    catLabel: 'Property Category',
    catLabelBn: 'প্রপার্টির ক্যাটাগরি',
    priceLabel: 'Sale Price (BDT)',
    priceLabelBn: 'বিক্রয় মূল্য (BDT)',
    pricePlaceholder: 'e.g. 5000000',
    pricePlaceholderBn: 'যেমন: ৫০০০০০০',
  },
  commercial: {
    types: [
      { id: 'office',      label: 'Office',     labelBn: 'অফিস',       icon: Briefcase },
      { id: 'shop',        label: 'Shop',       labelBn: 'দোকান',      icon: Store },
      { id: 'showroom',    label: 'Showroom',   labelBn: 'শোরুম',      icon: Building },
      { id: 'restaurant',  label: 'Restaurant', labelBn: 'রেস্তোরাঁ',  icon: Home },
    ],
    categories: [
      { id: 'corporate', label: 'Corporate', labelBn: 'কর্পোরেট',  emoji: '🏛️' },
      { id: 'startup',   label: 'Startup',   labelBn: 'স্টার্টআপ', emoji: '🚀' },
      { id: 'retail',    label: 'Retail',    labelBn: 'খুচরা',     emoji: '🛍️' },
      { id: 'warehouse', label: 'Warehouse', labelBn: 'গুদামঘর',   emoji: '🏭' },
    ],
    typeLabel: 'Commercial Type',
    typeLabelBn: 'বাণিজ্যিক ধরন',
    catLabel: 'Business Category',
    catLabelBn: 'ব্যবসার ক্যাটাগরি',
    priceLabel: 'Monthly Rent / Price (BDT)',
    priceLabelBn: 'ভাড়া / মূল্য (BDT)',
    pricePlaceholder: 'e.g. 50000',
    pricePlaceholderBn: 'যেমন: ৫০০০০',
  },
};

const DIVISIONS = [
  { id: 'dhaka',      label: 'Dhaka',      labelBn: 'ঢাকা' },
  { id: 'chittagong', label: 'Chittagong', labelBn: 'চট্টগ্রাম' },
  { id: 'sylhet',     label: 'Sylhet',     labelBn: 'সিলেট' },
  { id: 'rajshahi',   label: 'Rajshahi',   labelBn: 'রাজশাহী' },
  { id: 'khulna',     label: 'Khulna',     labelBn: 'খুলনা' },
  { id: 'barishal',   label: 'Barishal',   labelBn: 'বরিশাল' },
  { id: 'rangpur',    label: 'Rangpur',    labelBn: 'রংপুর' },
  { id: 'mymensingh', label: 'Mymensingh', labelBn: 'ময়মনসিংহ' },
];

const FURNISHING_OPTIONS = [
  { id: 'Furnished',      label: 'Furnished',      labelBn: 'সম্পূর্ণ আসবাবপত্র', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' },
  { id: 'Semi-Furnished', label: 'Semi-Furnished', labelBn: 'আংশিক আসবাবপত্র',   color: 'text-amber-600',   bg: 'bg-amber-50 border-amber-200'   },
  { id: 'Unfurnished',    label: 'Unfurnished',    labelBn: 'আসবাবপত্র ছাড়া',     color: 'text-gray-600',    bg: 'bg-gray-50 border-gray-200'     },
];

const AMENITIES_LIST = [
  { id: 'Central AC',       label: 'Central AC',       labelBn: 'সেন্ট্রাল এসি',       icon: Snowflake,  color: 'text-blue-500',    bg: 'bg-blue-50'    },
  { id: 'Parking',          label: 'Parking',          labelBn: 'পার্কিং',              icon: Car,        color: 'text-gray-600',    bg: 'bg-gray-100'   },
  { id: 'High-Speed WiFi',  label: 'High-Speed WiFi',  labelBn: 'হাই-স্পিড ওয়াইফাই',  icon: Wifi,       color: 'text-green-500',   bg: 'bg-green-50'   },
  { id: 'Generator Backup', label: 'Generator Backup', labelBn: 'জেনারেটর ব্যাকআপ',    icon: Zap,        color: 'text-yellow-500',  bg: 'bg-yellow-50'  },
  { id: '24/7 Security',    label: '24/7 Security',    labelBn: '২৪/৭ নিরাপত্তা',     icon: ShieldCheck,color: 'text-[#ba0036]',   bg: 'bg-red-50'     },
  { id: 'CCTV',             label: 'CCTV',             labelBn: 'সিসিটিভি',             icon: ShieldCheck,color: 'text-[#ba0036]',   bg: 'bg-red-50'     },
  { id: 'Gym Access',       label: 'Gym Access',       labelBn: 'জিম সুবিধা',           icon: Home,       color: 'text-purple-500',  bg: 'bg-purple-50'  },
  { id: 'Rooftop Lounge',   label: 'Rooftop Lounge',   labelBn: 'রুফটপ লাউঞ্জ',         icon: Star,       color: 'text-indigo-500',  bg: 'bg-indigo-50'  },
  { id: 'Private Garden',   label: 'Private Garden',   labelBn: 'প্রাইভেট গার্ডেন',     icon: Home,       color: 'text-green-600',   bg: 'bg-green-50'   },
  { id: 'Concierge',        label: 'Concierge',        labelBn: 'কনসিয়ার্জ সেবা',      icon: Users,      color: 'text-orange-500',  bg: 'bg-orange-50'  },
  { id: 'Home Theater',     label: 'Home Theater',     labelBn: 'হোম থিয়েটার',          icon: Play,       color: 'text-pink-500',    bg: 'bg-pink-50'    },
  { id: 'Pool Access',      label: 'Pool Access',      labelBn: 'সুইমিং পুল',           icon: Sparkles,   color: 'text-cyan-500',    bg: 'bg-cyan-50'    },
  { id: 'Study Room',       label: 'Study Room',       labelBn: 'স্টাডি রুম',            icon: FileText,   color: 'text-teal-500',    bg: 'bg-teal-50'    },
  { id: 'Shared Kitchen',   label: 'Shared Kitchen',   labelBn: 'শেয়ার্ড কিচেন',        icon: Home,       color: 'text-rose-500',    bg: 'bg-rose-50'    },
  { id: 'Intercom',         label: 'Intercom',         labelBn: 'ইন্টারকম',              icon: Globe,      color: 'text-sky-500',     bg: 'bg-sky-50'     },
  { id: 'Balcony',          label: 'Balcony',          labelBn: 'বারান্দা',              icon: Eye,        color: 'text-violet-500',  bg: 'bg-violet-50'  },
];

// ─── STEP DEFINITIONS ─────────────────────────────────────────────────────────
const STEPS = [
  { id: 1, key: 'basics',    icon: Building,    label: 'Basics',    labelBn: 'মূল তথ্য'   },
  { id: 2, key: 'details',   icon: FileText,    label: 'Details',   labelBn: 'বিবরণ'      },
  { id: 3, key: 'amenities', icon: CheckCircle2,label: 'Amenities', labelBn: 'সুবিধাদি'   },
  { id: 4, key: 'media',     icon: ImageIcon,   label: 'Media',     labelBn: 'মিডিয়া'     },
  { id: 5, key: 'pricing',   icon: DollarSign,  label: 'Pricing',   labelBn: 'মূল্য'      },
];

// ─── INITIAL FORM STATE ───────────────────────────────────────────────────────
const INITIAL_FORM = {
  intent: '',
  type: '',
  category: '',
  title: '',
  division: '',
  location: '',
  gpsLat: '',
  gpsLng: '',
  gpsAddress: '',
  beds: 1,
  baths: 1,
  sqft: '',
  furnishing: '',
  description: '',
  amenities: [],
  // Step 4 – Media (structured)
  coverPhoto: null,          // { id, preview, name }
  roomPhotos: [],            // [{ id, room, preview, name }]
  mainVideo: null,           // { id, preview, name } or youtube id
  videoId: '',
  // Step 5 – Pricing
  price: '',
  status: 'active',
};

// Room photo categories
const ROOM_TYPES = [
  { id: 'bedroom',    label: 'Bedroom',     labelBn: 'শোবার ঘর',  emoji: '🛏️' },
  { id: 'bathroom',   label: 'Bathroom',    labelBn: 'বাথরুম',    emoji: '🚿' },
  { id: 'living',     label: 'Living Room', labelBn: 'বসার ঘর',   emoji: '🛋️' },
  { id: 'kitchen',    label: 'Kitchen',     labelBn: 'রান্নাঘর',  emoji: '🍳' },
  { id: 'other',      label: 'Other',       labelBn: 'অন্যান্য',  emoji: '📷' },
];

// ─── HELPER: Input Field ──────────────────────────────────────────────────────
const Field = ({ label, required, children, hint }) => (
  <div>
    <div className="flex items-center gap-1.5 mb-2">
      <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.12em]">{label}</label>
      {required && <span className="text-[#ba0036] text-[10px] font-black">*</span>}
      {hint && (
        <div className="group relative">
          <Info size={11} className="text-gray-300 cursor-help" />
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block w-44 bg-gray-900 text-white text-[10px] font-bold rounded-lg px-3 py-2 shadow-xl z-10 leading-relaxed">{hint}</div>
        </div>
      )}
    </div>
    {children}
  </div>
);

const inputCls = "w-full p-4 bg-gray-50 border border-transparent rounded-xl text-sm font-bold text-gray-900 outline-none placeholder-gray-300 focus:bg-white focus:border-[#ba0036]/20 focus:shadow-[0_4px_20px_rgba(186,0,54,0.07)] transition-all duration-200";

// ─── COUNTER INPUT ────────────────────────────────────────────────────────────
const CounterInput = ({ value, onChange, min = 0, max = 20 }) => (
  <div className="flex items-center gap-0 rounded-xl overflow-hidden border border-gray-100 bg-gray-50 w-fit">
    <button type="button" onClick={() => onChange(Math.max(min, value - 1))}
      className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-[#ba0036] hover:bg-red-50 transition-all font-bold text-xl active:scale-90">−</button>
    <span className="w-10 text-center text-sm font-black text-gray-900 select-none">{value}</span>
    <button type="button" onClick={() => onChange(Math.min(max, value + 1))}
      className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-[#ba0036] hover:bg-red-50 transition-all font-bold text-xl active:scale-90">+</button>
  </div>
);

// ─── SECTION HEADER ───────────────────────────────────────────────────────────
const SectionHeader = ({ icon: Icon, title, subtitle }) => (
  <div className="flex items-start gap-4 mb-2">
    <div className="w-12 h-12 bg-gradient-to-br from-[#ba0036] to-rose-500 rounded-2xl flex items-center justify-center shrink-0 shadow-[0_6px_16px_rgba(186,0,54,0.25)]">
      <Icon size={22} className="text-white" />
    </div>
    <div>
      <h2 className="text-xl font-black text-gray-900 leading-tight">{title}</h2>
      <p className="text-sm font-bold text-gray-400 mt-0.5">{subtitle}</p>
    </div>
  </div>
);

const ErrMsg = ({ text }) => (
  <p className="text-[10px] font-black text-[#ba0036] mt-1.5 flex items-center gap-1">
    <X size={10} strokeWidth={3} />{text}
  </p>
);

// ─── GPS LOCATION PANEL ───────────────────────────────────────────────────────
const GpsPanel = ({ form, set, isBn }) => {
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError]     = useState('');
  const [mapReady, setMapReady]     = useState(false);

  const detectLocation = () => {
    if (!navigator.geolocation) {
      setGpsError(isBn ? 'আপনার ব্রাউজার GPS সাপোর্ট করে না।' : 'Geolocation is not supported by your browser.');
      return;
    }
    setGpsLoading(true);
    setGpsError('');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        set('gpsLat', latitude.toFixed(6));
        set('gpsLng', longitude.toFixed(6));
        // Reverse geocode using nominatim (free, no key required)
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`
          );
          const data = await res.json();
          const addr = data.display_name || `${latitude}, ${longitude}`;
          set('gpsAddress', addr);
          if (!form.location) set('location', addr.split(',').slice(0, 3).join(',').trim());
        } catch {
          set('gpsAddress', `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
        }
        setGpsLoading(false);
        setMapReady(true);
      },
      (err) => {
        setGpsLoading(false);
        setGpsError(
          err.code === 1
            ? (isBn ? 'লোকেশন অ্যাক্সেসের অনুমতি দিন।' : 'Please allow location access in your browser.')
            : (isBn ? 'লোকেশন পাওয়া যায়নি। আবার চেষ্টা করুন।' : 'Could not get location. Please try again.')
        );
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const hasCoords = form.gpsLat && form.gpsLng;
  const mapSrc = hasCoords
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${(+form.gpsLng - 0.005).toFixed(6)},${(+form.gpsLat - 0.003).toFixed(6)},${(+form.gpsLng + 0.005).toFixed(6)},${(+form.gpsLat + 0.003).toFixed(6)}&layer=mapnik&marker=${form.gpsLat},${form.gpsLng}`
    : null;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_4px_15px_rgba(0,0,0,0.03)] overflow-hidden">
      <div className="p-5">
        <div className="flex items-center gap-2 mb-1">
          <Navigation size={16} className="text-[#ba0036]" />
          <p className="text-xs font-black text-gray-700">{isBn ? 'GPS লোকেশন' : 'GPS Location'}</p>
          <span className="text-[10px] bg-blue-50 text-blue-500 font-black px-2 py-0.5 rounded-full">{isBn ? 'ঐচ্ছিক' : 'Optional'}</span>
        </div>
        <p className="text-[11px] text-gray-400 font-bold mb-4">
          {isBn ? 'GPS বাটন চাপলে আপনার বর্তমান অবস্থান স্বয়ংক্রিয়ভাবে সেট হবে এবং মানচিত্রে দেখাবে।' : 'Tap the GPS button to auto-fill your current location and see it on the map.'}
        </p>

        <button
          type="button"
          onClick={detectLocation}
          disabled={gpsLoading}
          className="flex items-center gap-2.5 px-5 py-3 rounded-xl bg-[#ba0036] text-white text-xs font-black shadow-[0_6px_16px_rgba(186,0,54,0.25)] hover:shadow-[0_10px_24px_rgba(186,0,54,0.35)] hover:-translate-y-0.5 transition-all active:scale-95 disabled:opacity-60 disabled:pointer-events-none"
        >
          {gpsLoading ? (
            <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full" />
          ) : (
            <Navigation size={14} />
          )}
          {gpsLoading
            ? (isBn ? 'লোকেশন খোঁজা হচ্ছে...' : 'Detecting location...')
            : (isBn ? 'আমার লোকেশন সেট করুন' : 'Use My Current Location')}
        </button>

        {gpsError && (
          <p className="text-[11px] font-bold text-red-500 mt-2 flex items-center gap-1">
            <X size={11} strokeWidth={3} />{gpsError}
          </p>
        )}

        {hasCoords && (
          <div className="mt-4 space-y-2">
            <div className="flex items-start gap-2 p-3 bg-green-50 rounded-xl border border-green-100">
              <Check size={14} className="text-green-600 shrink-0 mt-0.5" strokeWidth={3} />
              <div>
                <p className="text-[10px] font-black text-green-700 uppercase tracking-widest mb-0.5">{isBn ? 'লোকেশন সেট হয়েছে' : 'Location Detected'}</p>
                <p className="text-xs font-bold text-green-800 leading-relaxed">{form.gpsAddress || `${form.gpsLat}, ${form.gpsLng}`}</p>
                <p className="text-[10px] text-green-600 font-bold mt-1">
                  {isBn ? 'স্থানাঙ্ক: ' : 'Coords: '}{form.gpsLat}, {form.gpsLng}
                </p>
              </div>
            </div>

            {/* Manual adjust */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">{isBn ? 'অক্ষাংশ' : 'Latitude'}</p>
                <input type="number" step="0.000001" className={inputCls}
                  value={form.gpsLat}
                  onChange={e => set('gpsLat', e.target.value)}
                  placeholder="23.7925" />
              </div>
              <div>
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">{isBn ? 'দ্রাঘিমাংশ' : 'Longitude'}</p>
                <input type="number" step="0.000001" className={inputCls}
                  value={form.gpsLng}
                  onChange={e => set('gpsLng', e.target.value)}
                  placeholder="90.4078" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Map Preview */}
      {mapSrc && (
        <div className="relative">
          <div className="flex items-center gap-1.5 px-5 py-2.5 bg-gray-50 border-t border-gray-100">
            <Map size={12} className="text-gray-400" />
            <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">{isBn ? 'মানচিত্র প্রিভিউ' : 'Map Preview'}</p>
          </div>
          <iframe
            src={mapSrc}
            className="w-full h-52"
            style={{ border: 0 }}
            title="Location map"
            loading="lazy"
          />
          <div className="absolute bottom-3 right-3">
            <a
              href={`https://www.openstreetmap.org/?mlat=${form.gpsLat}&mlon=${form.gpsLng}#map=16/${form.gpsLat}/${form.gpsLng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 bg-white/90 backdrop-blur-sm text-[10px] font-black text-gray-600 px-2.5 py-1.5 rounded-lg shadow border border-gray-200 hover:text-[#ba0036] transition-colors"
            >
              <Globe size={10} />{isBn ? 'বড় মানচিত্রে দেখুন' : 'Open full map'}
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── AI DESCRIPTION HELPER ────────────────────────────────────────────────────
const AiDescriptionHelper = ({ form, value, onChange, isBn, err: hasError }) => {
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState('');
  const intentData = INTENT_DATA[form.intent] || {};

  const generateSuggestion = async () => {
    setAiLoading(true);
    setAiSuggestion('');
    // Build a prompt with the form context
    const ctx = [
      form.intent && `Listing type: ${form.intent}`,
      form.type && `Property type: ${form.type}`,
      form.category && `Category: ${form.category}`,
      form.division && `Division: ${form.division}`,
      form.location && `Location: ${form.location}`,
      form.beds && `Bedrooms: ${form.beds}`,
      form.baths && `Bathrooms: ${form.baths}`,
      form.sqft && `Area: ${form.sqft} sqft`,
      form.furnishing && `Furnishing: ${form.furnishing}`,
      form.amenities.length && `Amenities: ${form.amenities.join(', ')}`,
    ].filter(Boolean).join('. ');

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [{
            role: 'user',
            content: `Write a professional, attractive real estate listing description for a property in Bangladesh with these details: ${ctx}. 
Write 3–4 engaging sentences (60–120 words) that highlight the best features and appeal to prospective ${form.intent === 'rent' ? 'tenants' : 'buyers'}. 
Use a warm, premium tone. Do not add extra headings. Respond with only the description text.`
          }]
        })
      });
      const data = await res.json();
      const text = data?.content?.[0]?.text || '';
      setAiSuggestion(text.trim());
    } catch {
      setAiSuggestion(isBn
        ? 'AI সাজেশন লোড করা যায়নি। আবার চেষ্টা করুন।'
        : 'Could not load AI suggestion. Please try again.');
    }
    setAiLoading(false);
  };

  const applyAiSuggestion = () => {
    if (aiSuggestion) {
      onChange(aiSuggestion);
      setAiSuggestion('');
    }
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <textarea
          rows={5}
          className={`${inputCls} resize-none ${hasError ? 'border-red-200 bg-red-50' : ''}`}
          placeholder={isBn
            ? 'আপনার প্রপার্টির বৈশিষ্ট্য, সুবিধা এবং কাছের স্থানগুলো সম্পর্কে লিখুন...'
            : 'Describe your property features, nearby landmarks, and what makes it special...'}
          value={value}
          onChange={e => onChange(e.target.value)}
          maxLength={800}
        />
        <div className="flex justify-between mt-1.5">
          {hasError
            ? <ErrMsg text={isBn ? 'কমপক্ষে ৩০ অক্ষর লিখুন' : 'Minimum 30 characters required'} />
            : <span />}
          <span className={`text-[10px] font-bold ${value.length < 30 ? 'text-red-300' : 'text-gray-300'}`}>
            {value.length}/800
          </span>
        </div>
      </div>

      {/* AI Suggestion Button */}
      <div className="flex items-center gap-2 p-3.5 bg-gradient-to-r from-violet-50 to-purple-50 border border-violet-100 rounded-xl">
        <div className="w-8 h-8 bg-gradient-to-br from-violet-500 to-purple-600 rounded-lg flex items-center justify-center shrink-0">
          <Wand2 size={14} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-black text-violet-700 uppercase tracking-widest">
            {isBn ? 'AI সহায়তা' : 'AI Writing Assistant'}
          </p>
          <p className="text-[11px] font-bold text-violet-500 leading-tight">
            {isBn ? 'AI আপনার প্রপার্টির জন্য সুন্দর বিবরণ লিখে দেবে' : 'Let AI write a compelling description based on your inputs'}
          </p>
        </div>
        <button
          type="button"
          onClick={generateSuggestion}
          disabled={aiLoading}
          className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-black rounded-lg transition-all active:scale-95 disabled:opacity-60 whitespace-nowrap shrink-0"
        >
          {aiLoading
            ? <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full" />
            : <Sparkles size={12} />}
          {aiLoading ? (isBn ? 'লেখা হচ্ছে...' : 'Writing...') : (isBn ? 'AI দিয়ে লিখুন' : 'Generate')}
        </button>
      </div>

      {/* AI Suggestion Preview */}
      <AnimatePresence>
        {aiSuggestion && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="p-4 bg-white border border-violet-100 rounded-xl shadow-[0_4px_16px_rgba(124,58,237,0.08)]"
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-black text-violet-600 uppercase tracking-widest flex items-center gap-1">
                <Sparkles size={10} />{isBn ? 'AI সাজেশন' : 'AI Suggestion'}
              </p>
              <button type="button" onClick={() => setAiSuggestion('')}
                className="text-gray-300 hover:text-gray-500">
                <X size={14} />
              </button>
            </div>
            <p className="text-xs font-bold text-gray-700 leading-relaxed mb-3">{aiSuggestion}</p>
            <div className="flex gap-2">
              <button type="button" onClick={applyAiSuggestion}
                className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 text-white text-[10px] font-black rounded-lg hover:bg-violet-700 transition-colors active:scale-95">
                <Check size={11} strokeWidth={3} />{isBn ? 'এটি ব্যবহার করুন' : 'Use This'}
              </button>
              <button type="button" onClick={generateSuggestion}
                className="flex items-center gap-1.5 px-3 py-2 bg-violet-50 text-violet-700 text-[10px] font-black rounded-lg hover:bg-violet-100 transition-colors active:scale-95">
                <RefreshCw size={11} />{isBn ? 'আবার তৈরি করুন' : 'Regenerate'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
const AddProperty = () => {
  const { language = 'English' } = useLanguage() || {};
  const navigate = useNavigate();
  const isBn = language === 'বাংলা';

  const [step, setStep] = useState(1);
  const [form, setForm] = useState(INITIAL_FORM);
  const [errors, setErrors] = useState({});
  const [toast, setToast] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Media refs
  const coverInputRef = useRef(null);
  const roomInputRef  = useRef(null);
  const videoInputRef = useRef(null);
  const [selectedRoomType, setSelectedRoomType] = useState('bedroom');

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const err = (key) => errors[key];

  const currentIntentData = INTENT_DATA[form.intent] || {};

  // ─── TOAST ─────────────────────────────────────────────────────────────────
  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ─── VALIDATION ────────────────────────────────────────────────────────────
  const validate = (targetStep) => {
    const e = {};
    if (targetStep >= 1) {
      if (!form.intent)          e.intent    = true;
      if (!form.type)            e.type      = true;
      if (!form.category)        e.category  = true;
      if (!form.title.trim())    e.title     = true;
      if (!form.division)        e.division  = true;
      if (!form.location.trim()) e.location  = true;
    }
    if (targetStep >= 2) {
      if (!form.furnishing)      e.furnishing = true;
      if (form.description.trim().length < 30) e.description = true;
    }
    if (targetStep >= 4) {
      if (!form.coverPhoto)      e.coverPhoto = true;
    }
    if (targetStep >= 5) {
      if (!form.price)           e.price      = true;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => {
    if (!validate(step)) {
      showToast(isBn ? 'অনুগ্রহ করে সব তথ্য পূরণ করুন।' : 'Please fill all required fields.', 'error');
      return;
    }
    setStep(s => Math.min(5, s + 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBack = () => {
    setStep(s => Math.max(1, s - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleAmenity = (id) => {
    set('amenities', form.amenities.includes(id)
      ? form.amenities.filter(a => a !== id)
      : [...form.amenities, id]);
  };

  // ─── MEDIA HANDLERS ────────────────────────────────────────────────────────
  const handleCoverPhoto = (files) => {
    const file = Array.from(files).find(f => f.type.startsWith('image/'));
    if (!file) return;
    const img = { id: Date.now(), preview: URL.createObjectURL(file), name: file.name };
    set('coverPhoto', img);
    setErrors(e => ({ ...e, coverPhoto: false }));
  };

  const handleRoomPhotos = (files) => {
    const validFiles = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, 20 - form.roomPhotos.length);
    const newPhotos = validFiles.map(file => ({
      id: Date.now() + Math.random(),
      room: selectedRoomType,
      preview: URL.createObjectURL(file),
      name: file.name,
    }));
    set('roomPhotos', [...form.roomPhotos, ...newPhotos]);
  };

  const removeRoomPhoto = (id) => set('roomPhotos', form.roomPhotos.filter(p => p.id !== id));

  const handleVideoUpload = (files) => {
    const file = Array.from(files).find(f => f.type.startsWith('video/'));
    if (!file) return;
    const vid = { id: Date.now(), preview: URL.createObjectURL(file), name: file.name, isFile: true };
    set('mainVideo', vid);
    set('videoId', '');
  };

  // ─── SUBMIT ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!validate(5)) {
      showToast(isBn ? 'অনুগ্রহ করে সব তথ্য পূরণ করুন।' : 'Please fill all required fields.', 'error');
      return;
    }
    setIsSubmitting(true);
    await new Promise(r => setTimeout(r, 1800));
    setIsSubmitting(false);
    setSubmitted(true);
  };

  const progress = ((step - 1) / (STEPS.length - 1)) * 100;

  // ─── SUCCESS SCREEN ────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="min-h-screen bg-[#eaeff5] flex items-center justify-center px-4 font-sans">
        <div className="fixed top-[-20%] left-[-10%] w-[50vw] h-[50vw] bg-gradient-to-br from-[#ba0036]/10 to-transparent rounded-full blur-[120px] pointer-events-none" />
        <div className="fixed bottom-[-20%] right-[-10%] w-[50vw] h-[50vw] bg-gradient-to-tl from-blue-600/5 to-transparent rounded-full blur-[120px] pointer-events-none" />
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', damping: 20, stiffness: 200 }}
          className="bg-white rounded-[2rem] shadow-[0_32px_80px_rgba(0,0,0,0.08)] p-10 max-w-sm w-full text-center relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-[#ba0036] via-rose-400 to-[#ba0036] bg-[length:200%_100%] animate-[shimmer_2s_linear_infinite]" />
          <motion.div
            initial={{ scale: 0 }} animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', damping: 12, stiffness: 200 }}
            className="w-24 h-24 bg-gradient-to-br from-[#ba0036] to-rose-500 rounded-[1.5rem] flex items-center justify-center mx-auto mb-6 shadow-[0_12px_32px_rgba(186,0,54,0.35)]"
          >
            <Check size={40} className="text-white" strokeWidth={3} />
          </motion.div>
          <h2 className="text-2xl font-black text-gray-900 mb-2">{isBn ? 'প্রপার্টি যুক্ত হয়েছে!' : 'Property Listed!'}</h2>
          <p className="text-gray-400 font-bold text-sm mb-6">{isBn ? 'আপনার প্রপার্টি সফলভাবে যোগ করা হয়েছে।' : 'Your property has been successfully submitted for review.'}</p>
          <div className="bg-gray-50 rounded-2xl p-4 mb-8 text-left space-y-2">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">{isBn ? 'সারাংশ' : 'Summary'}</p>
            <p className="text-sm font-black text-gray-900 truncate">{form.title || '—'}</p>
            <p className="text-xs font-bold text-gray-400 flex items-center gap-1"><MapPin size={11} />{form.location}, {form.division}</p>
            <p className="text-sm font-black text-[#ba0036]">৳ {Number(form.price).toLocaleString('en-IN')}</p>
          </div>
          <div className="flex flex-col gap-3">
            <button onClick={() => navigate('/host-dashboard', { state: { activeTab: 'properties' } })}
              className="w-full bg-[#ba0036] text-white py-4 rounded-xl font-black shadow-[0_8px_20px_rgba(186,0,54,0.25)] hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(186,0,54,0.35)] transition-all text-sm flex items-center justify-center gap-2">
              <LayoutDashboard size={16} />{isBn ? 'ড্যাশবোর্ডে যান' : 'Go to Dashboard'}
            </button>
            <button onClick={() => { setForm(INITIAL_FORM); setStep(1); setSubmitted(false); }}
              className="w-full py-4 rounded-xl font-black text-gray-400 hover:text-gray-700 text-sm transition-colors">
              {isBn ? 'আরেকটি যোগ করুন' : 'Add Another Property'}
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // ─── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#eaeff5] font-sans relative overflow-x-hidden text-gray-900 selection:bg-[#ba0036] selection:text-white">

      {/* Glowing Orbs */}
      <div className="fixed top-[-20%] left-[-10%] w-[50vw] h-[50vw] bg-gradient-to-br from-[#ba0036]/10 to-transparent rounded-full blur-[120px] pointer-events-none z-0" />
      <div className="fixed bottom-[-20%] right-[-10%] w-[50vw] h-[50vw] bg-gradient-to-tl from-blue-600/5 to-transparent rounded-full blur-[120px] pointer-events-none z-0" />

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            className={`fixed top-20 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-xs font-black shadow-xl flex items-center gap-2
              ${toast.type === 'error' ? 'bg-[#ba0036] text-white' : 'bg-gray-900 text-white'}`}
          >
            {toast.type === 'error' ? <X size={13} strokeWidth={3} /> : <Check size={13} strokeWidth={3} />}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="fixed top-0 left-0 right-0 z-40 bg-white/90 backdrop-blur-2xl border-b border-gray-100 shadow-[0_2px_16px_rgba(0,0,0,0.04)]">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-[#ba0036] to-rose-500 rounded-xl flex items-center justify-center shadow-[0_4px_10px_rgba(186,0,54,0.25)]">
              <Building size={15} className="text-white" />
            </div>
            <div>
              <p className="text-xs font-black text-gray-900 leading-tight">{isBn ? 'প্রপার্টি যোগ করুন' : 'List Property'}</p>
              <p className="text-[10px] font-bold text-gray-400">{isBn ? `ধাপ ${step} / ${STEPS.length}` : `Step ${step} of ${STEPS.length}`}</p>
            </div>
          </div>
          <span className="text-[10px] font-black text-[#ba0036] bg-red-50 px-3 py-1.5 rounded-full">{Math.round(progress)}%</span>
        </div>
        {/* Progress bar */}
        <div className="h-0.5 bg-gray-100 relative overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-[#ba0036] to-rose-400"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5, ease: 'easeInOut' }}
          />
        </div>
      </div>

      {/* Step Indicators */}
      <div className="max-w-2xl mx-auto px-4 pt-24">
        <div className="flex items-center justify-between relative">
          <div className="absolute top-5 left-5 right-5 h-px bg-gray-200 z-0" />
          <div className="absolute top-5 left-5 h-px bg-gradient-to-r from-[#ba0036] to-rose-400 z-0 transition-all duration-500"
            style={{ width: `calc(${(step - 1) / (STEPS.length - 1) * 100}% - 10px)` }} />
          {STEPS.map((s) => {
            const Icon = s.icon;
            const isDone    = step > s.id;
            const isCurrent = step === s.id;
            return (
              <div key={s.id} className="flex flex-col items-center gap-1.5 z-10">
                <motion.div
                  animate={isCurrent ? { scale: [1, 1.1, 1] } : {}}
                  transition={{ duration: 0.5, repeat: Infinity, repeatDelay: 2 }}
                  className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 shadow-sm
                    ${isDone    ? 'bg-[#ba0036] border-[#ba0036] text-white shadow-[0_4px_12px_rgba(186,0,54,0.3)]' : ''}
                    ${isCurrent ? 'bg-white border-[#ba0036] text-[#ba0036] shadow-[0_4px_16px_rgba(186,0,54,0.2)]' : ''}
                    ${!isDone && !isCurrent ? 'bg-white border-gray-200 text-gray-300' : ''}
                  `}>
                  {isDone ? <Check size={16} strokeWidth={3} /> : <Icon size={16} />}
                </motion.div>
                <span className={`text-[9px] font-black uppercase tracking-wider hidden sm:block
                  ${isCurrent ? 'text-[#ba0036]' : isDone ? 'text-gray-500' : 'text-gray-300'}`}>
                  {isBn ? s.labelBn : s.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Form Content */}
      <div className="max-w-2xl mx-auto px-4 py-6 pb-32">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          >

            {/* ════════ STEP 1: BASICS ════════ */}
            {step === 1 && (
              <div className="space-y-6">
                <SectionHeader icon={Building}
                  title={isBn ? 'প্রপার্টির মূল তথ্য' : 'Property Basics'}
                  subtitle={isBn ? 'ভাড়া, ক্রয় বা বাণিজ্যিক — আপনার উদ্দেশ্য বেছে নিন' : 'Choose your listing intent, then type and category'} />

                {/* ── INTENT SELECTOR ── */}
                <Field label={isBn ? 'আপনি কী করতে চান?' : 'What are you listing for?'} required>
                  <div className="grid grid-cols-3 gap-3">
                    {LISTING_INTENTS.map(({ id, label, labelBn, icon: Icon, desc, descBn, color, bg }) => (
                      <button key={id} type="button"
                        onClick={() => {
                          set('intent', id);
                          set('type', '');
                          set('category', '');
                          setErrors(e => ({ ...e, intent: false, type: false, category: false }));
                        }}
                        className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all duration-200 active:scale-95 text-center
                          ${form.intent === id
                            ? 'bg-[#ba0036] border-[#ba0036] text-white shadow-[0_8px_20px_rgba(186,0,54,0.25)]'
                            : `bg-white border-gray-100 ${color} hover:border-[#ba0036]/30`}`}
                      >
                        <Icon size={22} />
                        <span className="text-xs font-black leading-tight">{isBn ? labelBn : label}</span>
                        <span className={`text-[10px] font-bold leading-tight ${form.intent === id ? 'text-white/70' : 'text-gray-400'}`}>
                          {isBn ? descBn : desc}
                        </span>
                      </button>
                    ))}
                  </div>
                  {err('intent') && <ErrMsg text={isBn ? 'উদ্দেশ্য বেছে নিন' : 'Please select a listing intent'} />}
                </Field>

                {/* ── PROPERTY TYPE (conditional on intent) ── */}
                <AnimatePresence>
                  {form.intent && (
                    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                      <Field label={isBn ? currentIntentData.typeLabelBn : currentIntentData.typeLabel} required>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          {(currentIntentData.types || []).map(({ id, label, labelBn, icon: Icon }) => (
                            <button key={id} type="button"
                              onClick={() => { set('type', id); setErrors(e => ({ ...e, type: false })); }}
                              className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all duration-200 active:scale-95
                                ${form.type === id
                                  ? 'bg-[#ba0036] border-[#ba0036] text-white shadow-[0_8px_20px_rgba(186,0,54,0.25)]'
                                  : 'bg-white border-gray-100 text-gray-400 hover:border-[#ba0036]/30 hover:text-gray-700'}
                                ${err('type') && form.type !== id ? 'border-red-200' : ''}
                              `}>
                              <Icon size={22} />
                              <span className="text-xs font-black text-center leading-tight">{isBn ? labelBn : label}</span>
                            </button>
                          ))}
                        </div>
                        {err('type') && <ErrMsg text={isBn ? 'ধরন বেছে নিন' : 'Please select a property type'} />}
                      </Field>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* ── PROPERTY CATEGORY (conditional on intent) ── */}
                <AnimatePresence>
                  {form.intent && (
                    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                      <Field label={isBn ? currentIntentData.catLabelBn : currentIntentData.catLabel} required>
                        <div className="grid grid-cols-2 gap-3">
                          {(currentIntentData.categories || []).map(({ id, label, labelBn, emoji }) => (
                            <button key={id} type="button"
                              onClick={() => { set('category', id); setErrors(e => ({ ...e, category: false })); }}
                              className={`flex items-center gap-3 p-3.5 rounded-2xl border-2 transition-all duration-200 active:scale-95
                                ${form.category === id
                                  ? 'bg-[#ba0036] border-[#ba0036] text-white shadow-[0_8px_20px_rgba(186,0,54,0.25)]'
                                  : 'bg-white border-gray-100 text-gray-500 hover:border-[#ba0036]/30'}
                              `}>
                              <span className="text-xl">{emoji}</span>
                              <span className="text-xs font-black leading-tight">{isBn ? labelBn : label}</span>
                            </button>
                          ))}
                        </div>
                        {err('category') && <ErrMsg text={isBn ? 'ক্যাটাগরি বেছে নিন' : 'Please select a category'} />}
                      </Field>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Title */}
                <Field label={isBn ? 'প্রপার্টির শিরোনাম' : 'Property Title'} required
                  hint={isBn ? 'আকর্ষণীয় এবং পরিষ্কার শিরোনাম দিন' : 'Give a clear, attractive title that stands out'}>
                  <input type="text"
                    className={`${inputCls} ${err('title') ? 'border-red-200 bg-red-50' : ''}`}
                    placeholder={isBn ? 'যেমন: গুলশানে বিলাসবহুল ৩BHK অ্যাপার্টমেন্ট' : 'e.g. Luxurious 3BHK Apartment in Gulshan'}
                    value={form.title}
                    onChange={e => { set('title', e.target.value); setErrors(er => ({ ...er, title: false })); }}
                    maxLength={80}
                  />
                  <div className="flex justify-between mt-1.5">
                    {err('title') ? <ErrMsg text={isBn ? 'শিরোনাম দিন' : 'Title is required'} /> : <span />}
                    <span className="text-[10px] text-gray-300 font-bold">{form.title.length}/80</span>
                  </div>
                </Field>

                {/* Division */}
                <Field label={isBn ? 'বিভাগ' : 'Division'} required>
                  <div className="relative">
                    <select className={`${inputCls} appearance-none pr-10 ${err('division') ? 'border-red-200 bg-red-50' : ''}`}
                      value={form.division}
                      onChange={e => { set('division', e.target.value); setErrors(er => ({ ...er, division: false })); }}>
                      <option value="">{isBn ? 'বিভাগ নির্বাচন করুন' : 'Select Division'}</option>
                      {DIVISIONS.map(d => <option key={d.id} value={d.id}>{isBn ? d.labelBn : d.label}</option>)}
                    </select>
                    <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                  {err('division') && <ErrMsg text={isBn ? 'বিভাগ বেছে নিন' : 'Please select a division'} />}
                </Field>

                {/* Location */}
                <Field label={isBn ? 'সম্পূর্ণ ঠিকানা' : 'Full Address'} required
                  hint={isBn ? 'রাস্তা নম্বর, এলাকা সহ লিখুন' : 'Include road no., area for better visibility'}>
                  <div className="relative">
                    <MapPin size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" />
                    <input type="text"
                      className={`${inputCls} pl-10 ${err('location') ? 'border-red-200 bg-red-50' : ''}`}
                      placeholder={isBn ? 'যেমন: রোড ১২, গুলশান ২, ঢাকা' : 'e.g. Road 12, Gulshan 2, Dhaka'}
                      value={form.location}
                      onChange={e => { set('location', e.target.value); setErrors(er => ({ ...er, location: false })); }}
                    />
                  </div>
                  {err('location') && <ErrMsg text={isBn ? 'ঠিকানা দিন' : 'Address is required'} />}
                </Field>

                {/* GPS Panel */}
                <GpsPanel form={form} set={set} isBn={isBn} />
              </div>
            )}

            {/* ════════ STEP 2: DETAILS ════════ */}
            {step === 2 && (
              <div className="space-y-6">
                <SectionHeader icon={FileText}
                  title={isBn ? 'প্রপার্টির বিবরণ' : 'Property Details'}
                  subtitle={isBn ? 'রুম এবং আয়তনের তথ্য দিন' : 'Provide room counts, size, and description'} />

                {/* Beds / Baths */}
                <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-[0_4px_15px_rgba(0,0,0,0.03)]">
                  <div className="grid grid-cols-2 gap-6">
                    <Field label={isBn ? 'শোবার ঘর' : 'Bedrooms'} required>
                      <div className="flex items-center gap-3 mt-1">
                        <BedDouble size={18} className="text-gray-300 shrink-0" />
                        <CounterInput value={form.beds} onChange={v => set('beds', v)} min={1} max={12} />
                      </div>
                    </Field>
                    <Field label={isBn ? 'বাথরুম' : 'Bathrooms'} required>
                      <div className="flex items-center gap-3 mt-1">
                        <Bath size={18} className="text-gray-300 shrink-0" />
                        <CounterInput value={form.baths} onChange={v => set('baths', v)} min={1} max={12} />
                      </div>
                    </Field>
                  </div>
                </div>

                {/* Sqft — optional */}
                <Field label={isBn ? 'আয়তন (বর্গফুট) — ঐচ্ছিক' : 'Area (sq. ft.) — Optional'}>
                  <div className="relative">
                    <Square size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" />
                    <input type="number"
                      className={`${inputCls} pl-10`}
                      placeholder={isBn ? 'যেমন: ১৫০০' : 'e.g. 1500'}
                      value={form.sqft}
                      onChange={e => set('sqft', e.target.value)}
                      min={0}
                    />
                  </div>
                  <p className="text-[10px] font-bold text-gray-300 mt-1">
                    {isBn ? 'জানা না থাকলে ফাঁকা রাখুন।' : 'Leave blank if unknown.'}
                  </p>
                </Field>

                {/* Furnishing */}
                <Field label={isBn ? 'আসবাবপত্রের অবস্থা' : 'Furnishing Status'} required>
                  <div className="grid grid-cols-3 gap-3">
                    {FURNISHING_OPTIONS.map(({ id, label, labelBn, color, bg }) => (
                      <button key={id} type="button"
                        onClick={() => { set('furnishing', id); setErrors(er => ({ ...er, furnishing: false })); }}
                        className={`py-3 px-2 rounded-2xl border-2 text-xs font-black transition-all active:scale-95 text-center
                          ${form.furnishing === id
                            ? `${bg} border-current ${color} shadow-sm`
                            : 'bg-white border-gray-100 text-gray-400 hover:border-gray-200'}`}>
                        {isBn ? labelBn : label}
                      </button>
                    ))}
                  </div>
                  {err('furnishing') && <ErrMsg text={isBn ? 'অবস্থা বেছে নিন' : 'Furnishing status required'} />}
                </Field>

                {/* Description with AI helper */}
                <Field label={isBn ? 'বিস্তারিত বিবরণ' : 'Detailed Description'} required
                  hint={isBn ? 'কমপক্ষে ৩০ অক্ষর লিখুন' : 'Minimum 30 characters required'}>
                  <AiDescriptionHelper
                    form={form}
                    value={form.description}
                    onChange={(val) => { set('description', val); setErrors(er => ({ ...er, description: false })); }}
                    isBn={isBn}
                    err={err('description')}
                  />
                </Field>
              </div>
            )}

            {/* ════════ STEP 3: AMENITIES ════════ */}
            {step === 3 && (
              <div className="space-y-6">
                <SectionHeader icon={CheckCircle2}
                  title={isBn ? 'সুবিধাদি' : 'Amenities & Features'}
                  subtitle={isBn ? 'প্রপার্টিতে যা আছে তা সিলেক্ট করুন' : 'Select all features available in your property'} />

                <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-[0_4px_15px_rgba(0,0,0,0.03)]">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{isBn ? 'সুবিধাদি নির্বাচন করুন' : 'Select Available Amenities'}</p>
                    <span className="text-[10px] font-black text-[#ba0036] bg-red-50 px-2 py-1 rounded-full">{form.amenities.length} {isBn ? 'টি নির্বাচিত' : 'selected'}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {AMENITIES_LIST.map(({ id, label, labelBn, icon: Icon, color, bg }) => {
                      const isSelected = form.amenities.includes(id);
                      return (
                        <motion.button key={id} type="button"
                          whileTap={{ scale: 0.96 }}
                          onClick={() => toggleAmenity(id)}
                          className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all duration-150 text-left
                            ${isSelected
                              ? 'bg-[#ba0036] border-[#ba0036] text-white shadow-[0_4px_12px_rgba(186,0,54,0.2)]'
                              : 'bg-gray-50 border-transparent text-gray-500 hover:bg-white hover:border-gray-200'}`}
                        >
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isSelected ? 'bg-white/20' : bg}`}>
                            <Icon size={15} className={isSelected ? 'text-white' : color} />
                          </div>
                          <span className="text-xs font-black leading-tight">{isBn ? labelBn : label}</span>
                          {isSelected && <Check size={13} className="ml-auto shrink-0 text-white/80" strokeWidth={3} />}
                        </motion.button>
                      );
                    })}
                  </div>
                </div>

                {form.amenities.length === 0 && (
                  <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-100 rounded-2xl">
                    <Info size={16} className="text-amber-500 shrink-0" />
                    <p className="text-xs font-bold text-amber-700">
                      {isBn ? 'কোনো সুবিধা না থাকলেও এগিয়ে যেতে পারেন।' : 'You can proceed without amenities, but listings with amenities get more inquiries.'}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ════════ STEP 4: MEDIA ════════ */}
            {step === 4 && (
              <div className="space-y-6">
                <SectionHeader icon={ImageIcon}
                  title={isBn ? 'ছবি ও ভিডিও' : 'Photos & Video'}
                  subtitle={isBn ? 'প্রথমে মূল ছবি, তারপর রুম অনুযায়ী ছবি যোগ করুন' : 'Add cover photo first, then room-by-room photos'} />

                {/* ── COVER PHOTO (1 only) ── */}
                <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-[0_4px_15px_rgba(0,0,0,0.03)]">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-7 h-7 bg-[#ba0036] rounded-lg flex items-center justify-center">
                      <Star size={13} className="text-white" />
                    </div>
                    <p className="text-xs font-black text-gray-900">{isBn ? 'মূল কভার ছবি' : 'Main Cover Photo'}</p>
                    <span className="text-[9px] font-black bg-red-50 text-[#ba0036] px-2 py-0.5 rounded-full">{isBn ? 'প্রয়োজনীয়' : 'Required'}</span>
                    <span className="text-[9px] font-bold text-gray-400 ml-auto">{isBn ? 'শুধুমাত্র ১টি' : 'Only 1 allowed'}</span>
                  </div>
                  <p className="text-[11px] font-bold text-gray-400 mb-4">
                    {isBn ? 'বাড়ির সামনের বা সেরা কোণের ছবি দিন — এটি প্রথমে দেখাবে।' : 'Upload the best front-facing or exterior shot — this appears as the thumbnail.'}
                  </p>

                  {!form.coverPhoto ? (
                    <div>
                      <input ref={coverInputRef} type="file" accept="image/*" className="hidden"
                        onChange={e => handleCoverPhoto(e.target.files)} />
                      <button type="button" onClick={() => coverInputRef.current?.click()}
                        className={`w-full border-2 border-dashed rounded-xl p-8 flex flex-col items-center gap-2 transition-all
                          ${err('coverPhoto') ? 'border-red-300 bg-red-50' : 'border-gray-200 hover:border-[#ba0036]/40 hover:bg-red-50/30'}`}>
                        <div className="w-12 h-12 bg-gray-100 rounded-2xl flex items-center justify-center">
                          <Camera size={22} className="text-gray-400" />
                        </div>
                        <p className="text-sm font-black text-gray-700">{isBn ? 'কভার ছবি আপলোড করুন' : 'Upload Cover Photo'}</p>
                        <p className="text-[11px] font-bold text-gray-300">{isBn ? 'JPG, PNG, WEBP সাপোর্টেড' : 'JPG, PNG, WEBP supported'}</p>
                      </button>
                      {err('coverPhoto') && <ErrMsg text={isBn ? 'কভার ছবি প্রয়োজন' : 'Cover photo is required'} />}
                    </div>
                  ) : (
                    <div className="relative rounded-xl overflow-hidden aspect-video shadow-sm group">
                      <img src={form.coverPhoto.preview} alt="cover" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all" />
                      <div className="absolute top-2 left-2 bg-[#ba0036] text-white text-[10px] font-black px-2 py-1 rounded-lg flex items-center gap-1">
                        <Star size={10} />{isBn ? 'কভার ছবি' : 'Cover Photo'}
                      </div>
                      <button type="button" onClick={() => set('coverPhoto', null)}
                        className="absolute top-2 right-2 w-7 h-7 bg-black/60 hover:bg-[#ba0036] text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all">
                        <X size={13} />
                      </button>
                      <button type="button" onClick={() => coverInputRef.current?.click()}
                        className="absolute bottom-2 right-2 flex items-center gap-1 bg-white/90 backdrop-blur-sm text-[10px] font-black text-gray-700 px-2.5 py-1.5 rounded-lg shadow opacity-0 group-hover:opacity-100 transition-all">
                        <RefreshCw size={10} />{isBn ? 'পরিবর্তন করুন' : 'Change'}
                      </button>
                      <input ref={coverInputRef} type="file" accept="image/*" className="hidden"
                        onChange={e => handleCoverPhoto(e.target.files)} />
                    </div>
                  )}
                </div>

                {/* ── ROOM PHOTOS ── */}
                <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-[0_4px_15px_rgba(0,0,0,0.03)]">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-7 h-7 bg-gray-700 rounded-lg flex items-center justify-center">
                      <ImageIcon size={13} className="text-white" />
                    </div>
                    <p className="text-xs font-black text-gray-900">{isBn ? 'রুম অনুযায়ী ছবি' : 'Room Photos'}</p>
                    <span className="text-[9px] font-bold text-gray-400 ml-auto">{form.roomPhotos.length}/20</span>
                  </div>
                  <p className="text-[11px] font-bold text-gray-400 mb-4">
                    {isBn ? 'শোবার ঘর, বাথরুম, বসার ঘর ইত্যাদির ছবি আলাদাভাবে যোগ করুন।' : 'Add photos for each room — bedroom, bathroom, living room, etc.'}
                  </p>

                  {/* Room type tabs */}
                  <div className="flex gap-2 flex-wrap mb-4">
                    {ROOM_TYPES.map(rt => (
                      <button key={rt.id} type="button"
                        onClick={() => setSelectedRoomType(rt.id)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-black transition-all
                          ${selectedRoomType === rt.id
                            ? 'bg-gray-900 text-white shadow-sm'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                        <span>{rt.emoji}</span>
                        {isBn ? rt.labelBn : rt.label}
                        <span className="text-[9px] font-black opacity-60">
                          ({form.roomPhotos.filter(p => p.room === rt.id).length})
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Upload area */}
                  <input ref={roomInputRef} type="file" accept="image/*" multiple className="hidden"
                    onChange={e => handleRoomPhotos(e.target.files)} />
                  {form.roomPhotos.length < 20 && (
                    <button type="button" onClick={() => roomInputRef.current?.click()}
                      className="w-full border-2 border-dashed border-gray-200 rounded-xl p-5 flex items-center gap-3 hover:border-[#ba0036]/40 hover:bg-red-50/20 transition-all mb-4">
                      <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center shrink-0">
                        <Plus size={18} className="text-gray-400" />
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-black text-gray-700">
                          {isBn
                            ? `${ROOM_TYPES.find(r => r.id === selectedRoomType)?.labelBn} এর ছবি যোগ করুন`
                            : `Add ${ROOM_TYPES.find(r => r.id === selectedRoomType)?.label} photos`}
                        </p>
                        <p className="text-[11px] font-bold text-gray-300">{isBn ? 'একাধিক ছবি একসাথে যোগ করতে পারবেন' : 'Multiple photos at once'}</p>
                      </div>
                    </button>
                  )}

                  {/* Photos grid (filtered by selected room type) */}
                  {form.roomPhotos.filter(p => p.room === selectedRoomType).length > 0 && (
                    <div className="grid grid-cols-3 gap-2">
                      {form.roomPhotos.filter(p => p.room === selectedRoomType).map((photo) => (
                        <motion.div key={photo.id} initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }}
                          className="relative aspect-square rounded-xl overflow-hidden group shadow-sm">
                          <img src={photo.preview} alt={photo.name} className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all" />
                          <button type="button" onClick={() => removeRoomPhoto(photo.id)}
                            className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/60 hover:bg-[#ba0036] text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all">
                            <X size={11} />
                          </button>
                        </motion.div>
                      ))}
                    </div>
                  )}

                  {form.roomPhotos.length === 0 && (
                    <p className="text-[11px] font-bold text-gray-300 text-center py-2">
                      {isBn ? 'এখনো কোনো রুম ছবি যোগ করা হয়নি।' : 'No room photos added yet.'}
                    </p>
                  )}
                </div>

                {/* ── VIDEO (1 only: file or YouTube) ── */}
                <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-[0_4px_15px_rgba(0,0,0,0.03)]">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-7 h-7 bg-rose-600 rounded-lg flex items-center justify-center">
                      <Video size={13} className="text-white" />
                    </div>
                    <p className="text-xs font-black text-gray-900">{isBn ? 'ভিডিও ট্যুর' : 'Video Tour'}</p>
                    <span className="text-[9px] font-bold text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">{isBn ? 'ঐচ্ছিক · শুধু ১টি' : 'Optional · 1 only'}</span>
                  </div>
                  <p className="text-[11px] font-bold text-gray-400 mb-4">
                    {isBn ? 'পুরো বাড়ির একটি ভিডিও ট্যুর আপলোড করুন অথবা YouTube লিংক দিন।' : 'Upload one full property walkthrough video, or provide a YouTube link.'}
                  </p>

                  {/* Option: Upload file */}
                  {!form.mainVideo && !form.videoId && (
                    <div className="space-y-3">
                      <input ref={videoInputRef} type="file" accept="video/*" className="hidden"
                        onChange={e => handleVideoUpload(e.target.files)} />
                      <button type="button" onClick={() => videoInputRef.current?.click()}
                        className="w-full border-2 border-dashed border-gray-200 rounded-xl p-5 flex items-center gap-3 hover:border-rose-300 hover:bg-rose-50/20 transition-all">
                        <div className="w-10 h-10 bg-rose-50 rounded-xl flex items-center justify-center shrink-0">
                          <Upload size={18} className="text-rose-400" />
                        </div>
                        <div className="text-left">
                          <p className="text-sm font-black text-gray-700">{isBn ? 'ভিডিও আপলোড করুন' : 'Upload Video File'}</p>
                          <p className="text-[11px] font-bold text-gray-300">MP4, MOV, AVI supported</p>
                        </div>
                      </button>

                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-px bg-gray-100" />
                        <span className="text-[10px] font-black text-gray-300">{isBn ? 'অথবা' : 'OR'}</span>
                        <div className="flex-1 h-px bg-gray-100" />
                      </div>

                      {/* YouTube ID */}
                      <Field label={isBn ? 'YouTube ভিডিও ID' : 'YouTube Video ID'}
                        hint="e.g. O-P_J_gvALE from youtube.com/watch?v=O-P_J_gvALE">
                        <div className="relative">
                          <Play size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" />
                          <input type="text"
                            className={`${inputCls} pl-10`}
                            placeholder="e.g. O-P_J_gvALE"
                            value={form.videoId}
                            onChange={e => set('videoId', e.target.value.trim())}
                          />
                        </div>
                      </Field>
                    </div>
                  )}

                  {/* Uploaded video preview */}
                  {form.mainVideo && (
                    <div className="relative rounded-xl overflow-hidden bg-black group">
                      <video src={form.mainVideo.preview} className="w-full h-48 object-contain" controls />
                      <button type="button" onClick={() => set('mainVideo', null)}
                        className="absolute top-2 right-2 w-7 h-7 bg-black/70 hover:bg-[#ba0036] text-white rounded-full flex items-center justify-center">
                        <X size={13} />
                      </button>
                      <div className="absolute top-2 left-2 bg-rose-600 text-white text-[10px] font-black px-2 py-1 rounded-lg">
                        {isBn ? 'ভিডিও ট্যুর' : 'Video Tour'}
                      </div>
                    </div>
                  )}

                  {/* YouTube preview */}
                  {form.videoId && !form.mainVideo && (
                    <div>
                      <div className="mt-2 rounded-xl overflow-hidden aspect-video shadow-sm relative">
                        <iframe
                          src={`https://www.youtube.com/embed/${form.videoId}`}
                          className="w-full h-full"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                          title="Property video preview"
                        />
                      </div>
                      <button type="button" onClick={() => set('videoId', '')}
                        className="mt-2 text-[10px] font-black text-red-400 flex items-center gap-1 hover:text-[#ba0036] transition-colors">
                        <X size={10} strokeWidth={3} />{isBn ? 'ভিডিও সরান' : 'Remove video'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ════════ STEP 5: PRICING ════════ */}
            {step === 5 && (
              <div className="space-y-6">
                <SectionHeader icon={DollarSign}
                  title={isBn ? 'মূল্য নির্ধারণ' : 'Pricing'}
                  subtitle={isBn ? 'আপনার প্রপার্টির মূল্য এবং স্ট্যাটাস সেট করুন' : 'Set your price and listing status'} />

                {/* Pricing */}
                <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-[0_4px_15px_rgba(0,0,0,0.03)] space-y-4">
                  <Field
                    label={isBn ? currentIntentData.priceLabelBn : currentIntentData.priceLabel}
                    required>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-black text-gray-400">৳</span>
                      <input type="number"
                        className={`${inputCls} pl-9 ${err('price') ? 'border-red-200 bg-red-50' : ''}`}
                        placeholder={isBn ? currentIntentData.pricePlaceholderBn : currentIntentData.pricePlaceholder}
                        value={form.price}
                        onChange={e => { set('price', e.target.value); setErrors(er => ({ ...er, price: false })); }}
                        min={0}
                      />
                    </div>
                    {err('price') && <ErrMsg text={isBn ? 'মূল্য দিন' : 'Price is required'} />}
                    {form.price && (
                      <p className="text-[11px] font-bold text-gray-400 mt-1.5">
                        {isBn ? 'সংখ্যায়: ' : 'In words: '}
                        <span className="text-gray-700 font-black">৳ {Number(form.price).toLocaleString('en-IN')}</span>
                      </p>
                    )}
                  </Field>
                </div>

                {/* Listing Status */}
                <Field label={isBn ? 'লিস্টিং স্ট্যাটাস' : 'Listing Status'}>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { id: 'active', label: 'Active',  labelBn: 'সক্রিয়',  color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-300', dot: 'bg-emerald-500' },
                      { id: 'paused', label: 'Paused',  labelBn: 'বিরতি',   color: 'text-amber-600',   bg: 'bg-amber-50 border-amber-300',     dot: 'bg-amber-500'   },
                      { id: 'rented', label: form.intent === 'purchase' ? 'Sold' : 'Rented',
                        labelBn: form.intent === 'purchase' ? 'বিক্রিত' : 'ভাড়া',
                        color: 'text-blue-600', bg: 'bg-blue-50 border-blue-300', dot: 'bg-blue-500' },
                    ].map(s => (
                      <button key={s.id} type="button"
                        onClick={() => set('status', s.id)}
                        className={`flex items-center justify-center gap-2 py-3 rounded-xl border-2 text-xs font-black transition-all
                          ${form.status === s.id ? `${s.bg} ${s.color}` : 'bg-white border-gray-100 text-gray-400 hover:border-gray-200'}`}>
                        <span className={`w-2 h-2 rounded-full ${form.status === s.id ? s.dot : 'bg-gray-200'}`} />
                        {isBn ? s.labelBn : s.label}
                      </button>
                    ))}
                  </div>
                </Field>

                {/* Summary Preview */}
                <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-5 text-white shadow-[0_12px_32px_rgba(0,0,0,0.15)] overflow-hidden relative">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-[#ba0036]/20 rounded-full blur-3xl pointer-events-none" />
                  <div className="flex items-center gap-2 mb-4">
                    <Eye size={14} className="text-white/60" />
                    <p className="text-[10px] font-black text-white/60 uppercase tracking-widest">{isBn ? 'প্রিভিউ' : 'Listing Preview'}</p>
                  </div>
                  {form.coverPhoto && (
                    <img src={form.coverPhoto.preview} alt="preview" className="w-full h-32 object-cover rounded-xl mb-4 opacity-80" />
                  )}
                  <p className="font-black text-white text-sm leading-tight mb-1 truncate">{form.title || (isBn ? 'প্রপার্টির শিরোনাম' : 'Property Title')}</p>
                  <p className="text-white/50 text-[11px] font-bold flex items-center gap-1 mb-3 truncate">
                    <MapPin size={10} />{form.location || '—'}{form.division ? `, ${form.division}` : ''}
                  </p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 text-white/60 text-[11px] font-bold">
                      {form.beds > 0 && <span className="flex items-center gap-1"><BedDouble size={12} />{form.beds}</span>}
                      {form.baths > 0 && <span className="flex items-center gap-1"><Bath size={12} />{form.baths}</span>}
                      {form.sqft && <span className="flex items-center gap-1"><Square size={12} />{Number(form.sqft).toLocaleString()} sqft</span>}
                    </div>
                    <p className="text-white font-black text-sm">
                      {form.price ? `৳ ${Number(form.price).toLocaleString('en-IN')}` : '৳ —'}
                    </p>
                  </div>
                </div>
              </div>
            )}

          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom Nav */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/90 backdrop-blur-2xl border-t border-gray-100 shadow-[0_-8px_24px_rgba(0,0,0,0.06)]">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          {step > 1 ? (
            <button onClick={handleBack}
              className="flex items-center gap-2 px-5 py-4 rounded-xl bg-gray-50 hover:bg-gray-100 font-black text-gray-500 text-sm transition-all active:scale-95 shrink-0">
              <ArrowLeft size={16} />{isBn ? 'পেছনে' : 'Back'}
            </button>
          ) : (
            <button onClick={() => navigate(-1)}
              className="flex items-center gap-2 px-5 py-4 rounded-xl bg-gray-50 hover:bg-gray-100 font-black text-gray-500 text-sm transition-all active:scale-95 shrink-0">
              <X size={16} />{isBn ? 'বাতিল' : 'Cancel'}
            </button>
          )}

          {step < 5 ? (
            <button onClick={handleNext}
              className="flex-1 flex items-center justify-center gap-2 py-4 rounded-xl bg-[#ba0036] text-white font-black text-sm shadow-[0_8px_20px_rgba(186,0,54,0.25)] hover:shadow-[0_12px_28px_rgba(186,0,54,0.35)] hover:-translate-y-0.5 transition-all active:scale-95">
              {isBn ? 'পরবর্তী' : 'Next Step'}<ArrowRight size={16} />
            </button>
          ) : (
            <motion.button
              onClick={handleSubmit}
              disabled={isSubmitting}
              whileTap={{ scale: 0.97 }}
              className="flex-1 flex items-center justify-center gap-2 py-4 rounded-xl bg-[#ba0036] text-white font-black text-sm shadow-[0_8px_20px_rgba(186,0,54,0.25)] hover:shadow-[0_12px_28px_rgba(186,0,54,0.35)] hover:-translate-y-0.5 transition-all disabled:opacity-60 disabled:pointer-events-none"
            >
              {isSubmitting ? (
                <>
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
                  {isBn ? 'সাবমিট হচ্ছে...' : 'Submitting...'}
                </>
              ) : (
                <><Sparkles size={16} />{isBn ? 'প্রপার্টি যোগ করুন' : 'List My Property'}</>
              )}
            </motion.button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AddProperty;