import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MapPin, Bed, Bath, Maximize2, Share2, Heart,
  Phone, MessageSquare, CheckCircle2, ChevronRight, ChevronLeft,
  Snowflake, Car, Wifi, ShieldCheck, ArrowLeft, Zap, X,
  Star, Play, Award, Calendar, Clock, Send,
  Shield, BadgeCheck, Home, Users, MessageCircle, Sparkles,
  Building, Building2, ShoppingBag, Briefcase, Store, Layers, Globe,
  Eye, FileText, Video, ShowerHead, Sofa, Utensils, Camera
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext.jsx';
// Single shared inquiry modal — same component the listing page uses, so the
// experience is identical regardless of where the user clicks "Inquire".
import InquiryModal from './InquiryModal';
// ─── DATA SOURCE: live property + landlord. NO demo data. ─────────────────────
import { propertyService } from '../services/Propertyservice.js';

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  GOOGLE MAPS                                                            ║
// ║                                                                         ║
// ║  Install once at the project root:                                      ║
// ║      npm i @react-google-maps/api                                       ║
// ║                                                                         ║
// ║  Add a Maps JavaScript API key to .env (depending on your bundler):     ║
// ║      Vite : VITE_GOOGLE_MAPS_API_KEY=AIza...                            ║
// ║      CRA  : REACT_APP_GOOGLE_MAPS_API_KEY=AIza...                       ║
// ║                                                                         ║
// ║  Behaviour:                                                             ║
// ║    • If the key is present → interactive Google Map with a single       ║
// ║      property marker (matches the listing-page Google Map experience).  ║
// ║    • If the key is missing → graceful iframe fallback so dev work isn't ║
// ║      blocked. This uses the public /maps embed (no key required) — i.e. ║
// ║      the same fallback the listing page uses, kept in sync.             ║
// ╚══════════════════════════════════════════════════════════════════════════╝
// NOTE: we import `MarkerF` (the *functional*, hooks-based marker) and not the
// legacy class-based `Marker`. Under React 18 + StrictMode, the legacy
// `<Marker />` double-mounts during dev and frequently fails to attach to the
// map — which is exactly why no pin was showing on the property details page.
// `MarkerF` is the canonical fix shipped by @react-google-maps/api for this.
import { GoogleMap, MarkerF, useJsApiLoader } from '@react-google-maps/api';

// Pull the API key from whichever bundler the host project uses. Comment the
// line that does NOT match your build tool — the other line stays.
// Last-resort fallback so the interactive map keeps working even if the
// build's env var is missing. This key is restricted in Google Cloud (locked
// to our domains + Maps JavaScript API only), so exposing it here is low-risk
// — a Maps JS key is public in the browser bundle regardless.
const GOOGLE_MAPS_API_KEY =
  (typeof import.meta !== 'undefined' && import.meta?.env?.VITE_GOOGLE_MAPS_API_KEY) ||
  (typeof process !== 'undefined' && process?.env?.REACT_APP_GOOGLE_MAPS_API_KEY) ||
  'AIzaSyC9xWNjjSPhxy2aUWLubPqHR7N6KZWmKlg';

// Loaded libraries (kept as a stable reference for useJsApiLoader). Add
// 'places' here if you wire up address autocomplete in the inquiry/edit flow.
const GOOGLE_MAPS_LIBRARIES = [];

// Light, Voyager-like map styling that mirrors the listing-page styling.
const MAP_STYLES = [
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.attraction', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
];

// ─────────────────────────────────────────────────────────────────────────────
// LIGHT THEME INJECTOR — White + neutral surfaces, bright red accent (#ba0036)
// ─────────────────────────────────────────────────────────────────────────────
const FuturisticTheme = () => {
  useEffect(() => {
    const styleEl = document.createElement('style');
    styleEl.id = 'pd-light-theme';
    styleEl.innerHTML = `
      @import url('https://fonts.googleapis.com/css2?family=Oxanium:wght@400;600;700;800&family=DM+Sans:wght@400;500;700&display=swap');
      .futuristic-root { font-family: 'DM Sans', sans-serif; color: #0f172a; }
      .futuristic-root h1, .futuristic-root h2, .futuristic-root h3,
      .futuristic-root h4, .futuristic-root .font-display { font-family: 'Oxanium', sans-serif; }
      .futuristic-bg {
        background: #ffffff;
        background-image:
          radial-gradient(ellipse 80% 60% at 20% 0%, rgba(186,0,54,0.04) 0%, transparent 60%),
          radial-gradient(ellipse 60% 50% at 80% 100%, rgba(186,0,54,0.025) 0%, transparent 60%);
      }
      .glass-card {
        background: #ffffff;
        border: 1px solid rgba(15,23,42,0.06);
        box-shadow: 0 1px 2px rgba(15,23,42,0.04), 0 6px 18px rgba(15,23,42,0.04);
      }
      .glass-card-light {
        background: #fafbfc;
        border: 1px solid rgba(15,23,42,0.05);
      }
      .neon-red { box-shadow: 0 8px 22px rgba(186,0,54,0.22); }
      .neon-border-red { border: 1px solid rgba(186,0,54,0.35); }
      .neon-text { color: #ba0036; }
      .scanline { display: none; }
      .futuristic-input {
        background: #ffffff;
        border: 1px solid rgba(15,23,42,0.1);
        color: #0f172a;
      }
      .futuristic-input::placeholder { color: rgba(15,23,42,0.4); }
      .futuristic-input:focus { border-color: rgba(186,0,54,0.5); outline: none; box-shadow: 0 0 0 3px rgba(186,0,54,0.1); }
      .badge-glow { box-shadow: 0 4px 12px rgba(186,0,54,0.18); }
      .cyber-btn {
        position: relative;
        overflow: hidden;
      }
      .cyber-btn::before {
        content: '';
        position: absolute;
        top: 0; left: -100%;
        width: 60%;
        height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.28), transparent);
        transition: left 0.6s ease;
      }
      .cyber-btn:hover::before { left: 150%; }
      .airbnb-grid-hover { transition: filter 0.3s ease, transform 0.3s ease; }
      .airbnb-grid-hover:hover { filter: brightness(1.04); transform: scale(1.005); }
    `;
    if (!document.getElementById('pd-light-theme')) {
      document.head.appendChild(styleEl);
    }
    return () => { const el = document.getElementById('pd-light-theme'); if (el) el.remove(); };
  }, []);
  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL TRANSLATIONS (fallback when LanguageContext doesn't provide them)
// ─────────────────────────────────────────────────────────────────────────────
const LOCAL_TRANSLATIONS = {
  en: {
    forRent: 'For Rent', forSale: 'For Sale', available: 'Available',
    rented: 'Rented', sold: 'Sold', paused: 'Paused',
    bedrooms: 'Bedrooms', bathrooms: 'Bathrooms', area: 'Area', floor: 'Floor', floorUnit: 'Fl',
    monthlyRent: 'Monthly Rent', salePrice: 'Sale Price',
    sendInquiry: 'Send Inquiry', inquireNow: 'Inquire Now',
    notAvailable: 'Not Available', verified: 'Verified',
    aboutProperty: 'About This Property', amenities: 'Amenities',
    location: 'Location', tenantReviews: 'Tenant Reviews',
    leaveReview: 'Leave a Review', submitReview: 'Submit Review',
    postingAs: 'Posting as',
    shareExperience: 'Share your experience...',
    readMore: 'Read More', showLess: 'Show Less',
    videoTour: 'Video Property Tour', watchFullTour: '▶ Watch Full Tour',
    showAllPhotos: 'Show all', sortedByRoom: 'Sorted by room',
    aboutLandlord: 'About the Landlord', viewProfile: 'View Full Landlord Profile',
    call: 'Call', message: 'Message', save: 'Save', saved: 'Saved', share: 'Share',
    back: 'Back', home: 'Home',
    photoTour: 'Photo tour', rooms: 'Rooms', allPhotos: 'All Photos',
    photo: 'photo', photos: 'photos',
    openInGoogleMaps: 'Open in Google Maps',
    howItWorks: 'How it works',
    safetyTips: 'Safety Tips',
    listedBy: 'Listed by',
    propertiesLabel: 'Properties', responseRate: 'Response Rate', avgReply: 'Avg. Reply',
    noReviewsYet: 'No reviews yet. Be the first!',
    thankYouReview: 'Thank you for your review!',
    coverPhoto: 'Cover Photo', videoTourLabel: 'Video Tour',
    watchFullWalkthrough: 'Watch the full walkthrough',
    callLandlord: 'Call Landlord', sendMessage: 'Send Message',
    chatWith: 'Chat with', connectWith: 'Connect with',
    secureLine: 'via TO-LET PRO Secure Line',
    startSecureCall: 'Start Secure Call', openChat: 'Open Chat',
    nextRecPills: 'Next', prevRecPills: 'Previous',
  },
  bn: {
    forRent: 'ভাড়ার জন্য', forSale: 'বিক্রয়ের জন্য', available: 'পাওয়া যাচ্ছে',
    rented: 'ভাড়া হয়েছে', sold: 'বিক্রি হয়েছে', paused: 'বিরতিতে',
    bedrooms: 'শয়নকক্ষ', bathrooms: 'বাথরুম', area: 'আয়তন', floor: 'তলা', floorUnit: 'তলা',
    monthlyRent: 'মাসিক ভাড়া', salePrice: 'বিক্রয় মূল্য',
    sendInquiry: 'তথ্য পাঠান', inquireNow: 'এখনই জিজ্ঞেস করুন',
    notAvailable: 'পাওয়া যাচ্ছে না', verified: 'যাচাইকৃত',
    aboutProperty: 'সম্পত্তি সম্পর্কে', amenities: 'সুযোগ-সুবিধা',
    location: 'অবস্থান', tenantReviews: 'ভাড়াটে পর্যালোচনা',
    leaveReview: 'পর্যালোচনা দিন', submitReview: 'পর্যালোচনা জমা দিন',
    postingAs: 'হিসেবে পোস্ট করছেন',
    shareExperience: 'আপনার অভিজ্ঞতা শেয়ার করুন...',
    readMore: 'আরো পড়ুন', showLess: 'কম দেখান',
    videoTour: 'ভিডিও ট্যুর', watchFullTour: '▶ সম্পূর্ণ ট্যুর দেখুন',
    showAllPhotos: 'সব', sortedByRoom: 'ঘর অনুযায়ী সাজানো',
    aboutLandlord: 'বাড়িওয়ালা সম্পর্কে', viewProfile: 'সম্পূর্ণ প্রোফাইল দেখুন',
    call: 'কল করুন', message: 'বার্তা', save: 'সংরক্ষণ', saved: 'সংরক্ষিত', share: 'শেয়ার',
    back: 'পিছনে', home: 'হোম',
    photoTour: 'ছবি ট্যুর', rooms: 'কক্ষ', allPhotos: 'সব ছবি',
    photo: 'ছবি', photos: 'ছবি',
    openInGoogleMaps: 'গুগল ম্যাপে দেখুন',
    howItWorks: 'কিভাবে কাজ করে',
    safetyTips: 'নিরাপত্তা টিপস',
    listedBy: 'তালিকাভুক্ত করেছেন',
    propertiesLabel: 'সম্পত্তি', responseRate: 'উত্তর হার', avgReply: 'গড় উত্তর',
    noReviewsYet: 'এখনও কোন পর্যালোচনা নেই। প্রথম হোন!',
    thankYouReview: 'আপনার পর্যালোচনার জন্য ধন্যবাদ!',
    coverPhoto: 'প্রচ্ছদ', videoTourLabel: 'ভিডিও ট্যুর',
    watchFullWalkthrough: 'সম্পূর্ণ ভিডিও দেখুন',
    callLandlord: 'বাড়িওয়ালাকে কল করুন', sendMessage: 'বার্তা পাঠান',
    chatWith: 'চ্যাট করুন', connectWith: 'যুক্ত হোন',
    secureLine: 'TO-LET PRO সুরক্ষিত লাইন এর মাধ্যমে',
    startSecureCall: 'সুরক্ষিত কল শুরু করুন', openChat: 'চ্যাট খুলুন',
    nextRecPills: 'পরবর্তী', prevRecPills: 'পূর্ববর্তী',
  },
  ar: {
    forRent: 'للإيجار', forSale: 'للبيع', available: 'متاح',
    rented: 'مؤجر', sold: 'مباع', paused: 'متوقف',
    bedrooms: 'غرف النوم', bathrooms: 'الحمامات', area: 'المساحة', floor: 'الطابق', floorUnit: 'طابق',
    monthlyRent: 'الإيجار الشهري', salePrice: 'سعر البيع',
    sendInquiry: 'إرسال استفسار', inquireNow: 'استفسر الآن',
    notAvailable: 'غير متاح', verified: 'موثق',
    aboutProperty: 'عن هذا العقار', amenities: 'المرافق',
    location: 'الموقع', tenantReviews: 'تقييمات المستأجرين',
    leaveReview: 'اترك تقييمًا', submitReview: 'إرسال التقييم',
    postingAs: 'النشر باسم',
    shareExperience: 'شارك تجربتك...',
    readMore: 'اقرأ المزيد', showLess: 'أظهر أقل',
    videoTour: 'جولة فيديو', watchFullTour: '▶ شاهد الجولة الكاملة',
    showAllPhotos: 'كل', sortedByRoom: 'مرتبة حسب الغرفة',
    aboutLandlord: 'عن المالك', viewProfile: 'عرض الملف الشخصي',
    call: 'اتصال', message: 'رسالة', save: 'حفظ', saved: 'محفوظ', share: 'مشاركة',
    back: 'رجوع', home: 'الرئيسية',
    photoTour: 'جولة الصور', rooms: 'الغرف', allPhotos: 'كل الصور',
    photo: 'صورة', photos: 'صور',
    openInGoogleMaps: 'فتح في خرائط جوجل',
    howItWorks: 'كيف يعمل',
    safetyTips: 'نصائح السلامة',
    listedBy: 'مدرج بواسطة',
    propertiesLabel: 'العقارات', responseRate: 'معدل الرد', avgReply: 'متوسط الرد',
    noReviewsYet: 'لا توجد تقييمات بعد. كن الأول!',
    thankYouReview: 'شكرًا على تقييمك!',
    coverPhoto: 'صورة الغلاف', videoTourLabel: 'جولة فيديو',
    watchFullWalkthrough: 'شاهد الجولة الكاملة',
    callLandlord: 'اتصل بالمالك', sendMessage: 'إرسال رسالة',
    chatWith: 'الدردشة مع', connectWith: 'تواصل مع',
    secureLine: 'عبر خط TO-LET PRO الآمن',
    startSecureCall: 'ابدأ مكالمة آمنة', openChat: 'فتح الدردشة',
    nextRecPills: 'التالي', prevRecPills: 'السابق',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// DATA — live properties come from `propertyService`; no demo property data is
// embedded in this component anymore. Reviews are still stored locally on the
// component (until a /api/properties/{id}/reviews endpoint exists) but they
// start empty for every property — no fake review history.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// NEARBY POIs — LIVE from OpenStreetMap Overpass API
// Fetches real nearby hospitals, schools, markets, mosques, bus stops, and
// parks based on the property's actual GPS coordinates. Works for ANY
// location in Bangladesh (or worldwide) — not limited to Dhaka.
// ─────────────────────────────────────────────────────────────────────────────

// Static labels + icons — drives the rendering order.
const NEARBY_PLACE_TYPES = [
  { label: 'Hospital', icon: '🏥', osmTags: '["amenity"="hospital"]' },
  { label: 'School',   icon: '🏫', osmTags: '["amenity"~"school|college"]' },
  { label: 'Market',   icon: '🛒', osmTags: '["shop"~"supermarket|mall|marketplace|convenience"]["name"]' },
  { label: 'Mosque',   icon: '🕌', osmTags: '["amenity"="place_of_worship"]["religion"="muslim"]' },
  { label: 'Bus Stop', icon: '🚌', osmTags: '["highway"="bus_stop"]' },
  { label: 'Park',     icon: '🌳', osmTags: '["leisure"="park"]' },
];

// Haversine — shortest distance over Earth's surface in kilometres.
const haversineKm = (a, b) => {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// Format distance in a human-friendly way (sub-km in metres, otherwise km).
const formatDistance = (km) => {
  if (!Number.isFinite(km)) return '—';
  if (km < 1) return `${Math.max(50, Math.round(km * 1000 / 10) * 10)} m`;
  return `${km.toFixed(1)} km`;
};

// Fetch REAL nearby places from OpenStreetMap's Overpass API using the
// property's actual GPS coordinates. Returns the same shape the UI consumes:
// [{ label, icon, name, distKm, dist }]
const fetchNearbyPlaces = async (lat, lng) => {
  const origin = { lat, lng };
  const radius = 3000; // 3 km search radius

  // Build a single Overpass query for ALL place types at once (efficient!)
  const unionParts = NEARBY_PLACE_TYPES.map(({ osmTags }, i) =>
    `node${osmTags}(around:${radius},${lat},${lng});`
  ).join('\n');

  const query = `
    [out:json][timeout:10];
    (
      ${unionParts}
    );
    out center body 20;
  `;

  try {
    // Routed through our own backend proxy (server-side Overpass call). The
    // browser can't hit overpass-api.de directly — CORS-blocked + 406 on the
    // browser User-Agent. The proxy returns Overpass JSON untouched, so the
    // parsing below is unchanged.
    const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
    const res = await fetch(`${API_BASE}/geo/overpass`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const elements = data.elements || [];

    // Categorize results by matching OSM tags back to our place types
    return NEARBY_PLACE_TYPES.map(({ label, icon, osmTags }) => {
      // Filter elements that belong to this category
      const matches = elements.filter(el => {
        const tags = el.tags || {};
        switch (label) {
          case 'Hospital':  return tags.amenity === 'hospital';
          case 'School':    return tags.amenity === 'school' || tags.amenity === 'college';
          case 'Market':    return ['supermarket', 'mall', 'marketplace', 'convenience'].includes(tags.shop) && tags.name;
          case 'Mosque':    return tags.amenity === 'place_of_worship' && tags.religion === 'muslim';
          case 'Bus Stop':  return tags.highway === 'bus_stop';
          case 'Park':      return tags.leisure === 'park';
          default:          return false;
        }
      });

      // Find nearest match
      let nearest = null;
      let nearestKm = Infinity;
      for (const el of matches) {
        const elLat = el.lat ?? el.center?.lat;
        const elLng = el.lon ?? el.center?.lon;
        if (elLat == null || elLng == null) continue;
        const d = haversineKm(origin, { lat: elLat, lng: elLng });
        if (d < nearestKm) {
          nearestKm = d;
          nearest = el;
        }
      }

      return {
        label,
        icon,
        name: nearest?.tags?.name || (nearest ? label : null),
        distKm: nearestKm,
        dist: formatDistance(nearestKm),
      };
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[NearbyPlaces] Overpass API failed, returning empty:', err.message);
    return NEARBY_PLACE_TYPES.map(({ label, icon }) => ({
      label,
      icon,
      name: null,
      distKm: Infinity,
      dist: '—',
    }));
  }
};

// ─── ROOM TYPES ───────────────────────────────────────────────────────────────
// Each room now carries BOTH a futuristic lucide Icon (used in the gallery
// overlays + stats cards) and an emoji (used by the Photo tour modal where
// the legacy emoji-led design still feels right).
const ROOM_TYPES = [
  { id: 'bedroom',  label: 'Bedroom',     emoji: '🛏️', Icon: Bed },
  { id: 'bathroom', label: 'Bathroom',    emoji: '🚿', Icon: ShowerHead },
  { id: 'living',   label: 'Living Room', emoji: '🛋️', Icon: Sofa },
  { id: 'kitchen',  label: 'Kitchen',     emoji: '🍳', Icon: Utensils },
  { id: 'other',    label: 'Other',       emoji: '📷', Icon: Camera },
];

// ─── INTENT CONFIG ────────────────────────────────────────────────────────────
const INTENT_CONFIG = {
  rent:       { label: 'For Rent',   icon: Home,        bg: 'bg-blue-50',    text: 'text-blue-700',    accent: '#2563eb', priceLabel: '/mo' },
  purchase:   { label: 'For Sale',   icon: ShoppingBag, bg: 'bg-emerald-50', text: 'text-emerald-700', accent: '#059669', priceLabel: ''    },
  commercial: { label: 'Commercial', icon: Briefcase,   bg: 'bg-violet-50',  text: 'text-violet-700',  accent: '#7c3aed', priceLabel: '/mo' },
};

// ─── CATEGORY LABELS ──────────────────────────────────────────────────────────
const CATEGORY_LABELS = {
  family:          { label: 'Family',           emoji: '👨‍👩‍👧‍👦' },
  bachelor_male:   { label: 'Bachelor (Male)',   emoji: '👨' },
  bachelor_female: { label: 'Bachelor (Female)', emoji: '👩' },
  student:         { label: 'Student',           emoji: '🎓' },
  ready_flat:      { label: 'Ready Flat',        emoji: '🏢' },
  used:            { label: 'Used Property',     emoji: '🏠' },
  new_project:     { label: 'New Project',       emoji: '🏗️' },
  investment:      { label: 'Investment',        emoji: '💹' },
  corporate:       { label: 'Corporate',         emoji: '🏛️' },
  startup:         { label: 'Startup',           emoji: '🚀' },
  retail:          { label: 'Retail',            emoji: '🛍️' },
  warehouse:       { label: 'Warehouse',         emoji: '🏭' },
};

// ─── STATUS CONFIG ────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  active: { label: 'Available', dot: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50 border border-emerald-200' },
  paused: { label: 'Paused',    dot: 'bg-amber-500',   text: 'text-amber-700',   bg: 'bg-amber-50 border border-amber-200'    },
  rented: { label: 'Rented',    dot: 'bg-slate-400',   text: 'text-slate-600',   bg: 'bg-slate-50 border border-slate-200'    },
  sold:   { label: 'Sold',      dot: 'bg-slate-400',   text: 'text-slate-600',   bg: 'bg-slate-50 border border-slate-200'    },
};

// ─── AMENITY ICONS MAP ────────────────────────────────────────────────────────
const amenityConfig = {
  'Central AC':       { icon: Snowflake,   color: 'text-cyan-600',    bg: 'bg-cyan-50'    },
  'Parking':          { icon: Car,         color: 'text-slate-600',   bg: 'bg-slate-100'  },
  '2 Parking Spots':  { icon: Car,         color: 'text-slate-600',   bg: 'bg-slate-100'  },
  '3 Parking Spots':  { icon: Car,         color: 'text-slate-600',   bg: 'bg-slate-100'  },
  'High-Speed WiFi':  { icon: Wifi,        color: 'text-emerald-600', bg: 'bg-emerald-50' },
  'WiFi':             { icon: Wifi,        color: 'text-emerald-600', bg: 'bg-emerald-50' },
  'Shared WiFi':      { icon: Wifi,        color: 'text-emerald-600', bg: 'bg-emerald-50' },
  'Generator Backup': { icon: Zap,         color: 'text-amber-600',   bg: 'bg-amber-50'   },
  '24/7 Security':    { icon: ShieldCheck, color: 'text-[#ba0036]',   bg: 'bg-red-50'     },
  'CCTV':             { icon: ShieldCheck, color: 'text-[#ba0036]',   bg: 'bg-red-50'     },
  'Gym Access':       { icon: Sparkles,    color: 'text-purple-600',  bg: 'bg-purple-50'  },
  'Rooftop Lounge':   { icon: Star,        color: 'text-indigo-600',  bg: 'bg-indigo-50'  },
  'Private Garden':   { icon: Home,        color: 'text-green-600',   bg: 'bg-green-50'   },
  'Concierge':        { icon: Users,       color: 'text-orange-600',  bg: 'bg-orange-50'  },
  'Home Theater':     { icon: Play,        color: 'text-pink-600',    bg: 'bg-pink-50'    },
  'Pool Access':      { icon: Sparkles,    color: 'text-cyan-600',    bg: 'bg-cyan-50'    },
  'Balcony':          { icon: Eye,         color: 'text-violet-600',  bg: 'bg-violet-50'  },
  'Intercom':         { icon: Globe,       color: 'text-sky-600',     bg: 'bg-sky-50'     },
};

// ─── STAR RATING INPUT ────────────────────────────────────────────────────────
const StarInput = ({ value, onChange }) => (
  <div className="flex gap-2">
    {[1, 2, 3, 4, 5].map((star) => (
      <button key={star} type="button" onClick={() => onChange(star)}
        className="transition-transform hover:scale-110 active:scale-95">
        <Star size={28} className={star <= value ? 'fill-yellow-400 text-yellow-400' : 'text-slate-300'} />
      </button>
    ))}
  </div>
);

// ─── BADGES ───────────────────────────────────────────────────────────────────
const IntentBadge = ({ intent }) => {
  const cfg = INTENT_CONFIG[intent] || INTENT_CONFIG.rent;
  const Icon = cfg.icon;
  return (
    <span style={{ background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.2)', color: '#1d4ed8' }}
      className="inline-flex items-center gap-1.5 text-[10px] font-black px-3 py-1.5 rounded-full uppercase tracking-widest">
      <Icon size={11} strokeWidth={2.5} />
      {cfg.label}
    </span>
  );
};

const CategoryBadge = ({ category }) => {
  const cfg = CATEGORY_LABELS[category];
  if (!cfg) return null;
  return (
    <span style={{ background: '#f8fafc', border: '1px solid rgba(15,23,42,0.08)', color: '#475569' }}
      className="inline-flex items-center gap-1.5 text-[10px] font-black px-3 py-1.5 rounded-full uppercase tracking-widest">
      <span className="text-sm leading-none">{cfg.emoji}</span>
      {cfg.label}
    </span>
  );
};

const StatusBadge = ({ status, intent }) => {
  const key = status === 'rented' && intent === 'purchase' ? 'sold' : status;
  const cfg = STATUS_CONFIG[key] || STATUS_CONFIG.active;
  return (
    <span className={`inline-flex items-center gap-1.5 ${cfg.bg} ${cfg.text} text-[10px] font-black px-3 py-1.5 rounded-full uppercase tracking-widest`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${key === 'active' ? 'animate-pulse' : ''}`} />
      {cfg.label}
    </span>
  );
};

// ─── UNAVAILABILITY OVERLAY ───────────────────────────────────────────────────
const UnavailableOverlay = ({ intent }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    className="absolute inset-0 z-20 flex items-center justify-center"
    style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)' }}
  >
    <div className="text-center px-6 py-5">
      <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3"
        style={{ background: 'rgba(255,255,255,0.95)', border: '1px solid rgba(255,255,255,0.4)' }}>
        <X size={28} className="text-slate-700" strokeWidth={3} />
      </div>
      <p className="text-white font-black text-xl tracking-tight drop-shadow" style={{ fontFamily: 'Oxanium, sans-serif' }}>Not Available</p>
      <p className="text-white/85 text-xs font-bold mt-1 uppercase tracking-widest drop-shadow">
        {intent === 'purchase' ? 'This property has been sold' : 'This property has been rented'}
      </p>
    </div>
  </motion.div>
);

// Hook to safely convert massive base64 video strings into streamable Blob URLs
// Browsers natively struggle (or completely fail) to seek/playback large
// data:video/... base64 strings directly in a <video src="..."> tag.
function useDataUrlToBlobUrl(dataUrl) {
  const [blobUrl, setBlobUrl] = useState(dataUrl);

  useEffect(() => {
    if (typeof dataUrl === 'string' && dataUrl.startsWith('data:video/')) {
      let active = true;
      let objectUrl = null;
      fetch(dataUrl)
        .then(res => res.blob())
        .then(blob => {
          if (!active) return;
          objectUrl = URL.createObjectURL(blob);
          setBlobUrl(objectUrl);
        })
        .catch(() => {
          if (active) setBlobUrl(dataUrl);
        });
      return () => {
        active = false;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    } else {
      setBlobUrl(dataUrl);
    }
  }, [dataUrl]);

  return blobUrl;
}

// ─────────────────────────────────────────────────────────────────────────────
// VIDEO PLAYER COMPONENT
// Supports: mainVideo (direct file URL/upload path) OR videoId (YouTube)
// Both can coexist — mainVideo takes priority if present
// ─────────────────────────────────────────────────────────────────────────────
const VideoPlayer = ({ mainVideo, videoId, coverPhoto, title }) => {
  const [showVideo, setShowVideo] = useState(false);
  const hasVideo = mainVideo || videoId;
  const safeMainVideoUrl = useDataUrlToBlobUrl(mainVideo?.preview || mainVideo);

  if (!hasVideo) return null;

  const isYouTube = !mainVideo && videoId;
  const isDirectVideo = !!mainVideo;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center neon-red"
          style={{ background: 'linear-gradient(135deg, #ba0036 0%, #7c0026 100%)' }}>
          <Play size={16} className="text-white fill-white ml-0.5" />
        </div>
        <div>
          <h3 className="text-lg font-black text-slate-900 leading-tight" style={{ fontFamily: 'Oxanium, sans-serif' }}>Video Property Tour</h3>
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">
            {isYouTube ? 'YouTube walkthrough' : 'Video walkthrough'}
          </p>
        </div>
      </div>

      {!showVideo ? (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowVideo(true); }}
          className="relative w-full overflow-hidden rounded-[1.5rem] group block cursor-pointer hover:scale-[1.005] active:scale-[0.995] transition-transform"
          style={{ aspectRatio: '16/9' }}
        >
          <img src={coverPhoto} alt="Video tour thumbnail"
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="relative">
              <div className="absolute inset-0 bg-white/20 rounded-full animate-ping scale-150" />
              <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-[0_20px_50px_rgba(0,0,0,0.5)] group-hover:scale-105 transition-transform relative">
                <Play size={30} className="text-[#ba0036] fill-[#ba0036] ml-1.5" />
              </div>
            </div>
          </div>
          <div className="absolute bottom-5 left-5 right-5 flex items-center justify-between">
            <div>
              <p className="text-white font-black text-sm" style={{ fontFamily: 'Oxanium, sans-serif' }}>▶ Watch Full Tour</p>
              <p className="text-white/60 text-[11px] font-bold mt-0.5">{title}</p>
            </div>
            {isYouTube && (
              <span className="bg-red-600 text-white text-[10px] font-black px-3 py-1.5 rounded-full flex items-center gap-1.5 uppercase tracking-widest">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.7 12 3.7 12 3.7s-7.5 0-9.4.4A3 3 0 0 0 .5 6.2 31.4 31.4 0 0 0 .1 12a31.4 31.4 0 0 0 .4 5.8 3 3 0 0 0 2.1 2.1c1.9.4 9.4.4 9.4.4s7.5 0 9.4-.4a3 3 0 0 0 2.1-2.1A31.4 31.4 0 0 0 24 12a31.4 31.4 0 0 0-.5-5.8z"/><polygon fill="white" points="9.7,15.5 15.8,12 9.7,8.5"/></svg>
                YouTube
              </span>
            )}
            {isDirectVideo && (
              <span className="text-white text-[10px] font-black px-3 py-1.5 rounded-full flex items-center gap-1.5 uppercase tracking-widest"
                style={{ background: 'rgba(186,0,54,0.85)', border: '1px solid rgba(255,255,255,0.2)' }}>
                <Video size={10} /> Video
              </span>
            )}
          </div>
        </button>
      ) : (
        <div className="relative rounded-[1.5rem] overflow-hidden" style={{ aspectRatio: '16/9' }}>
          {isDirectVideo ? (
            // muted + playsInline are required so browsers actually start playback
            // immediately after the click (autoplay policy blocks unmuted autoplay).
            <video src={safeMainVideoUrl} controls autoPlay muted playsInline
              className="w-full h-full object-cover" style={{ background: '#000' }} />
          ) : (
            // mute=1 is required so YouTube actually starts playback on autoplay.
            // playsinline=1 keeps it inline on iOS instead of opening fullscreen.
            <iframe
              src={`https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1`}
              title="Property Video Tour"
              className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          )}
          <button onClick={() => setShowVideo(false)}
            className="absolute top-4 right-4 w-10 h-10 bg-black/60 backdrop-blur-sm text-white rounded-full flex items-center justify-center hover:bg-black/80 transition-colors">
            <X size={18} />
          </button>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// INQUIRY MODAL — moved to ./InquiryModal.jsx (shared with PropertyListing).
// The previous inline copy was deleted to fix the bug where the listing page
// and the details page showed two different forms. See ./InquiryModal.jsx for
// the new unified flow (phone + AI-suggested message chips).
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// FULLSCREEN PHOTO VIEWER
// ─────────────────────────────────────────────────────────────────────────────
const FullscreenPhoto = ({ src, onClose }) => (
  <AnimatePresence>
    {src && (
      <motion.div
        className="fixed inset-0 z-[200] flex items-center justify-center"
        style={{ background: 'rgba(15,23,42,0.94)' }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <button onClick={onClose}
          className="absolute top-5 right-5 z-10 w-11 h-11 rounded-full flex items-center justify-center text-white transition-colors"
          style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)' }}>
          <X size={20} />
        </button>
        <img src={src} alt="Full view" className="max-w-full max-h-full object-contain px-4" onClick={e => e.stopPropagation()} />
      </motion.div>
    )}
  </AnimatePresence>
);

// ─────────────────────────────────────────────────────────────────────────────
// GALLERY BUILDER
// ─────────────────────────────────────────────────────────────────────────────
const GALLERY_ROOM_ORDER = ['bedroom', 'bathroom', 'living', 'kitchen', 'other'];

function buildGallery(property) {
  if (!property) return [];
  const items = [];
  if (property.coverPhoto) {
    items.push({ url: property.coverPhoto, room: 'cover', label: 'Cover Photo', emoji: '🏠', Icon: Home });
  }
  // Accept BOTH the form-time shape `{ room, preview }` AND the persisted /
  // API shape `{ room, url }`. The room category is preserved through the
  // entire pipeline so the gallery groups by bedroom / bathroom / kitchen
  // / living / other instead of dumping all photos in one bucket.
  for (const roomId of GALLERY_ROOM_ORDER) {
    const rt = ROOM_TYPES.find(r => r.id === roomId);
    const photos = (property.roomPhotos || []).filter(p => (p.room || 'other') === roomId);
    photos.forEach(p => {
      const url = p.preview || p.url;
      if (!url) return;
      items.push({ url, room: roomId, label: rt?.label || roomId, emoji: rt?.emoji || '📷', Icon: rt?.Icon || Camera });
    });
  }
  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE ANIMATION VARIANTS
// ─────────────────────────────────────────────────────────────────────────────
const slideVariants = {
  enter: (dir) => ({ x: dir > 0 ? '100%' : '-100%', opacity: 0 }),
  center: { x: 0, opacity: 1, transition: { duration: 0.5, ease: [0.32, 0.72, 0, 1] } },
  exit: (dir) => ({ x: dir > 0 ? '-30%' : '30%', opacity: 0, scale: 0.96, transition: { duration: 0.4, ease: [0.32, 0.72, 0, 1] } }),
};

// ─────────────────────────────────────────────────────────────────────────────
// HERO CAROUSEL — Mobile (Flatio-style full-width slider)
// ─────────────────────────────────────────────────────────────────────────────
const HeroCarousel = ({ images, isUnavailable, property, priceLabel, onShowAll, onPhotoClick }) => {
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState(1);
  const touchStartX = useRef(null);
  const total = images.length;

  const goPrev = useCallback(() => { setDir(-1); setIdx(i => (i - 1 + total) % total); }, [total]);
  const goNext = useCallback(() => { setDir(1); setIdx(i => (i + 1) % total); }, [total]);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [goPrev, goNext]);

  const handleTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchEnd = (e) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 50) { dx < 0 ? goNext() : goPrev(); }
    touchStartX.current = null;
  };

  if (total === 0) return null;
  const current = images[idx];

  return (
    <div className="mb-4">
      <div className="relative overflow-hidden group"
        style={{ aspectRatio: '4/3', borderRadius: '1.25rem' }}
        onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        <AnimatePresence initial={false} custom={dir}>
          <motion.img
            key={idx} src={current.url} alt={current.label} custom={dir}
            variants={slideVariants} initial="enter" animate="center" exit="exit"
            className="absolute inset-0 w-full h-full object-cover cursor-pointer"
            draggable={false}
            onClick={() => !isUnavailable && onPhotoClick && onPhotoClick(current.url)}
          />
        </AnimatePresence>
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />
        {isUnavailable && <UnavailableOverlay intent={property.intent} />}

        {/* Top-right counter — kept low-contrast & low z so it sits below sticky nav */}
        <div className="absolute top-3 right-3 z-[5]">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-white text-[10px] font-black select-none"
            style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.12)' }}>
            {current.Icon ? <current.Icon size={11} strokeWidth={2.4} /> : <span>{current.emoji}</span>}
            <span className="opacity-80">{idx + 1}</span>
            <span className="opacity-50">/</span>
            <span className="opacity-80">{total}</span>
          </div>
        </div>

        {/* Top-left room pill — futuristic glass chip with the room icon
            sitting in a neon dot beside the label. */}
        <div className="absolute top-3 left-3 z-[5]">
          <motion.span key={idx}
            initial={{ opacity: 0, y: -8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', damping: 18, stiffness: 260 }}
            className="inline-flex items-center gap-1.5 text-white text-[10px] font-black pl-1 pr-3 py-1 rounded-full uppercase tracking-widest"
            style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.14)' }}>
            <motion.span
              className="w-5 h-5 rounded-full flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg,#ba0036,#7c0026)', boxShadow: '0 0 10px rgba(186,0,54,0.7)' }}
              animate={{ rotate: [0, 6, -6, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            >
              {current.Icon ? <current.Icon size={11} className="text-white" strokeWidth={2.5} /> : <span className="text-[10px]">{current.emoji}</span>}
            </motion.span>
            {current.label}
          </motion.span>
        </div>

        {/* Bottom-right show-all photos chip only — title/location moved out of the image */}
        {!isUnavailable && total > 1 && (
          <div className="absolute bottom-3 right-3 z-[5]">
            <button onClick={(e) => { e.stopPropagation(); onShowAll(); }}
              className="text-white text-[10px] font-black px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-all active:scale-95"
              style={{ background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.15)' }}>
              <Layers size={11} className="text-[#ba0036]" />
              {total} photos
            </button>
          </div>
        )}

        {/* Arrows — stop propagation so clicking arrows doesn't open fullscreen */}
        {!isUnavailable && total > 1 && (
          <>
            <button onClick={(e) => { e.stopPropagation(); goPrev(); }} aria-label="Previous photo"
              className="absolute left-3 top-1/2 -translate-y-1/2 z-[5] w-9 h-9 text-white rounded-full flex items-center justify-center transition-all duration-200 active:scale-90"
              style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.12)' }}>
              <ChevronLeft size={18} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); goNext(); }} aria-label="Next photo"
              className="absolute right-3 top-1/2 -translate-y-1/2 z-[5] w-9 h-9 text-white rounded-full flex items-center justify-center transition-all duration-200 active:scale-90"
              style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.12)' }}>
              <ChevronRight size={18} />
            </button>
          </>
        )}

        {/* Progress dots */}
        {total > 1 && total <= 8 && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-[5] pointer-events-none">
            {images.map((_, i) => (
              <span key={i} className={`rounded-full transition-all duration-300 ${i === idx ? 'w-5 h-1.5 bg-white' : 'w-1.5 h-1.5 bg-white/50'}`} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// WIDE PHOTO CAROUSEL — Flatio-style single-image hero for DESKTOP.
// One full-width photo at a time with prev/next arrows on the sides, a small
// counter top-right, and the "Show all photos" pill anchored bottom-RIGHT.
// All overlay chrome is z-[5] so it never overlaps the sticky top nav.
// ─────────────────────────────────────────────────────────────────────────────
const WidePhotoCarousel = ({ images, isUnavailable, property, onShowAll, onPhotoClick, showAllLabel = 'Show all photos' }) => {
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState(1);
  const total = images.length;

  const goPrev = useCallback((e) => { e?.stopPropagation?.(); setDir(-1); setIdx(i => (i - 1 + total) % total); }, [total]);
  const goNext = useCallback((e) => { e?.stopPropagation?.(); setDir(1);  setIdx(i => (i + 1) % total); }, [total]);

  if (total === 0) return null;
  const current = images[idx];

  return (
    <div className="mb-6 relative">
      <div className="relative overflow-hidden group cursor-pointer"
        style={{ aspectRatio: '16/9', borderRadius: '1.5rem', background: '#0f172a' }}
        onClick={() => !isUnavailable && (onPhotoClick ? onPhotoClick(current.url) : onShowAll())}>
        <AnimatePresence initial={false} custom={dir}>
          <motion.img
            key={idx} src={current.url} alt={current.label} custom={dir}
            variants={slideVariants} initial="enter" animate="center" exit="exit"
            className="absolute inset-0 w-full h-full object-cover" draggable={false}
          />
        </AnimatePresence>
        <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent pointer-events-none" />
        {isUnavailable && <UnavailableOverlay intent={property.intent} />}

        {/* Cover photo / room label (top-left) — futuristic glass chip with
            an animated neon-dot icon beside the label. */}
        <div className="absolute top-4 left-4 z-[5]">
          <motion.span key={idx}
            initial={{ opacity: 0, y: -8, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', damping: 18, stiffness: 260 }}
            className="inline-flex items-center gap-2 text-white text-[11px] font-black pl-1.5 pr-3.5 py-1.5 rounded-full uppercase tracking-widest"
            style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.14)' }}>
            <motion.span
              className="w-6 h-6 rounded-full flex items-center justify-center relative"
              style={{ background: 'linear-gradient(135deg,#ba0036,#7c0026)', boxShadow: '0 0 12px rgba(186,0,54,0.65)' }}
              animate={{ rotate: [0, 8, -8, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            >
              {current.Icon ? <current.Icon size={12} className="text-white" strokeWidth={2.5} /> : <span className="text-[11px]">{current.emoji}</span>}
              <motion.span
                className="absolute inset-0 rounded-full pointer-events-none"
                style={{ border: '1px solid rgba(255,255,255,0.5)' }}
                animate={{ opacity: [0.2, 0.7, 0.2], scale: [1, 1.18, 1] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
              />
            </motion.span>
            {current.label}
          </motion.span>
        </div>

        {/* Photo counter (top-right) */}
        <div className="absolute top-4 right-4 z-[5]">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-white text-[11px] font-black select-none"
            style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.14)' }}>
            <Eye size={12} />
            <span className="opacity-90">{idx + 1}</span>
            <span className="opacity-50">/</span>
            <span className="opacity-90">{total}</span>
          </div>
        </div>

        {/* Prev/next arrows */}
        {!isUnavailable && total > 1 && (
          <>
            <button onClick={goPrev} aria-label="Previous photo"
              className="absolute left-4 top-1/2 -translate-y-1/2 z-[5] w-12 h-12 text-slate-900 rounded-full flex items-center justify-center transition-all duration-200 active:scale-90 opacity-80 hover:opacity-100"
              style={{ background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(8px)', border: '1px solid rgba(15,23,42,0.08)', boxShadow: '0 4px 14px rgba(15,23,42,0.12)' }}>
              <ChevronLeft size={22} />
            </button>
            <button onClick={goNext} aria-label="Next photo"
              className="absolute right-4 top-1/2 -translate-y-1/2 z-[5] w-12 h-12 text-slate-900 rounded-full flex items-center justify-center transition-all duration-200 active:scale-90 opacity-80 hover:opacity-100"
              style={{ background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(8px)', border: '1px solid rgba(15,23,42,0.08)', boxShadow: '0 4px 14px rgba(15,23,42,0.12)' }}>
              <ChevronRight size={22} />
            </button>
          </>
        )}

        {/* Show-all pill — anchored BOTTOM-RIGHT per request */}
        {total > 1 && !isUnavailable && (
          <button onClick={(e) => { e.stopPropagation(); onShowAll(); }}
            className="absolute bottom-4 right-4 z-[5] flex items-center gap-2 text-slate-900 text-[12px] font-black px-4 py-2.5 rounded-2xl transition-all active:scale-95"
            style={{ background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(12px)', border: '1px solid rgba(15,23,42,0.08)', boxShadow: '0 6px 18px rgba(15,23,42,0.16)' }}>
            <Layers size={14} className="text-[#ba0036]" />
            {showAllLabel} {total}
          </button>
        )}

        {/* Progress dots — center-bottom, kept tiny so they don't compete with the show-all pill */}
        {total > 1 && total <= 8 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 z-[5] pointer-events-none">
            {images.map((_, i) => (
              <span key={i} className={`rounded-full transition-all duration-300 ${i === idx ? 'w-5 h-1.5 bg-white' : 'w-1.5 h-1.5 bg-white/55'}`} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PHOTO GRID MODAL — "Show all photos" with room sections + video (Airbnb-style)
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// PHOTO GRID MODAL — Airbnb-style "Photo tour".
//   • Slides up from bottom with a smooth scale/opacity intro.
//   • Sticky LEFT rail (md+) lists rooms (Bedroom, Bathroom, Kitchen…) with
//     counts; clicking jumps to that section. The rail stays visible as you
//     scroll so users always know where they are.
//   • Sectioned content on the right: each room renders a "1 hero + 2-up"
//     responsive frame so the layout feels like a magazine, not a flat grid.
//   • Close button (X) is anchored TOP-RIGHT.
// ─────────────────────────────────────────────────────────────────────────────
const PhotoGridModal = ({ images, isOpen, onClose, onPhotoClick, property }) => {
  const modalVideoUrl = useDataUrlToBlobUrl(property?.mainVideo?.preview || property?.mainVideo);

  // Group by room — preserving the order rooms first appear in the gallery.
  const grouped = {};
  const orderedRooms = [];
  images.forEach((img) => {
    if (!grouped[img.room]) {
      grouped[img.room] = [];
      orderedRooms.push(img.room);
    }
    grouped[img.room].push(img);
  });
  const hasVideo = property?.videoId || property?.mainVideo;

  const [activeRoom, setActiveRoom] = useState(orderedRooms[0] || 'all');
  const sectionRefs = useRef({});
  const scrollContainerRef = useRef(null);

  // Reset state every time the modal opens so users don't get a stale
  // active-section highlight from a previous open.
  useEffect(() => {
    if (isOpen) {
      setActiveRoom(orderedRooms[0] || 'all');
      setTimeout(() => { if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0; }, 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const scrollToRoom = (room) => {
    setActiveRoom(room);
    const el = sectionRefs.current[room];
    if (el && scrollContainerRef.current) {
      const top = el.offsetTop - 12;
      scrollContainerRef.current.scrollTo({ top, behavior: 'smooth' });
    }
  };

  // Update active room indicator on scroll.
  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const scrollTop = container.scrollTop + 80;
    let current = orderedRooms[0];
    orderedRooms.forEach((room) => {
      const el = sectionRefs.current[room];
      if (el && el.offsetTop <= scrollTop) current = room;
    });
    if (current && current !== activeRoom) setActiveRoom(current);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[150] flex flex-col overflow-hidden"
          style={{ background: '#ffffff' }}
        >
          {/* ── Inner sheet that scales up smoothly from the bottom ── */}
          <motion.div
            initial={{ y: 40, opacity: 0, scale: 0.985 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0, scale: 0.985 }}
            transition={{ type: 'spring', damping: 30, stiffness: 240, mass: 0.9 }}
            className="flex flex-col flex-1 overflow-hidden"
          >
            {/* ── Sticky header ── */}
            <div className="shrink-0 px-5 md:px-10 py-4 md:py-5 flex items-center justify-between gap-3"
              style={{ borderBottom: '1px solid rgba(15,23,42,0.06)', background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(20px)' }}>
              <div className="min-w-0">
                <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest">Photo tour</p>
                <h2 className="text-slate-900 font-black text-lg md:text-xl tracking-tight leading-tight truncate" style={{ fontFamily: 'Oxanium, sans-serif' }}>
                  {property?.title || 'All Photos'}
                </h2>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="hidden md:inline-flex items-center gap-1.5 text-slate-700 text-[11px] font-black px-3 py-1.5 rounded-full"
                  style={{ background: '#f1f5f9', border: '1px solid rgba(15,23,42,0.06)' }}>
                  <Layers size={12} className="text-[#ba0036]" /> {images.length} photos
                </span>
                <button onClick={onClose} aria-label="Close photo tour"
                  className="w-11 h-11 text-slate-700 rounded-full flex items-center justify-center transition-colors active:scale-95"
                  style={{ background: '#f1f5f9', border: '1px solid rgba(15,23,42,0.06)' }}>
                  <X size={19} />
                </button>
              </div>
            </div>

            {/* ── Main split: left rail (rooms) + right content (photos) ── */}
            <div className="flex-1 overflow-hidden flex">
              {/* Sticky left rail — desktop only, keeps room list visible while scrolling */}
              <aside className="hidden md:flex md:w-64 lg:w-72 shrink-0 flex-col py-6 px-5 lg:px-7 overflow-y-auto"
                style={{ borderRight: '1px solid rgba(15,23,42,0.06)', scrollbarWidth: 'thin' }}>
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Rooms</p>
                <div className="flex flex-col gap-1">
                  {orderedRooms.map((room) => {
                    const rt = ROOM_TYPES.find(r => r.id === room) || { label: room === 'cover' ? 'Cover Photo' : room, emoji: '📷' };
                    const isActive = activeRoom === room;
                    return (
                      <button key={room}
                        onClick={() => scrollToRoom(room)}
                        className="text-left flex items-center justify-between gap-3 px-3 py-2.5 rounded-2xl transition-all"
                        style={isActive
                          ? { background: 'rgba(186,0,54,0.07)', border: '1px solid rgba(186,0,54,0.25)' }
                          : { background: '#ffffff', border: '1px solid transparent' }}>
                        <span className="flex items-center gap-2.5 min-w-0">
                          <span className="text-base shrink-0">{rt.emoji}</span>
                          <span className={`text-sm font-black truncate ${isActive ? 'text-[#ba0036]' : 'text-slate-700'}`}
                            style={{ fontFamily: 'Oxanium, sans-serif' }}>
                            {rt.label}
                          </span>
                        </span>
                        <span className="shrink-0 text-[10px] font-black px-2 py-0.5 rounded-full"
                          style={isActive
                            ? { background: 'rgba(186,0,54,0.15)', color: '#ba0036' }
                            : { background: '#f1f5f9', color: '#64748b' }}>
                          {grouped[room].length}
                        </span>
                      </button>
                    );
                  })}
                  {hasVideo && (
                    <button onClick={() => scrollToRoom('video')}
                      className="text-left flex items-center justify-between gap-3 px-3 py-2.5 rounded-2xl transition-all mt-2"
                      style={activeRoom === 'video'
                        ? { background: 'rgba(186,0,54,0.07)', border: '1px solid rgba(186,0,54,0.25)' }
                        : { background: '#ffffff', border: '1px solid transparent' }}>
                      <span className="flex items-center gap-2.5 min-w-0">
                        <span className="text-base shrink-0">🎬</span>
                        <span className={`text-sm font-black ${activeRoom === 'video' ? 'text-[#ba0036]' : 'text-slate-700'}`}
                          style={{ fontFamily: 'Oxanium, sans-serif' }}>Video Tour</span>
                      </span>
                      <span className="shrink-0 text-[10px] font-black px-2 py-0.5 rounded-full" style={{ background: '#f1f5f9', color: '#64748b' }}>1</span>
                    </button>
                  )}
                </div>
              </aside>

              {/* Mobile-only sticky scrolling chip-tabs */}
              <div className="md:hidden absolute top-[68px] left-0 right-0 z-[5] px-4 py-2.5 flex gap-2 overflow-x-auto"
                style={{ borderBottom: '1px solid rgba(15,23,42,0.05)', background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(16px)', scrollbarWidth: 'none' }}>
                {orderedRooms.map((room) => {
                  const rt = ROOM_TYPES.find(r => r.id === room) || { label: room === 'cover' ? 'Cover' : room, emoji: '📷' };
                  const isActive = activeRoom === room;
                  return (
                    <button key={room} onClick={() => scrollToRoom(room)}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-black whitespace-nowrap transition-all"
                      style={isActive
                        ? { background: 'rgba(186,0,54,0.08)', border: '1px solid rgba(186,0,54,0.3)', color: '#ba0036' }
                        : { background: '#f8fafc', border: '1px solid rgba(15,23,42,0.06)', color: '#64748b' }}>
                      <span>{rt.emoji}</span>
                      <span>{rt.label}</span>
                      <span className="px-1.5 py-0.5 rounded-full text-[9px]"
                        style={{ background: isActive ? 'rgba(186,0,54,0.15)' : 'rgba(15,23,42,0.06)' }}>
                        {grouped[room].length}
                      </span>
                    </button>
                  );
                })}
                {hasVideo && (
                  <button onClick={() => scrollToRoom('video')}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-black whitespace-nowrap"
                    style={activeRoom === 'video'
                      ? { background: 'rgba(186,0,54,0.08)', border: '1px solid rgba(186,0,54,0.3)', color: '#ba0036' }
                      : { background: '#f8fafc', border: '1px solid rgba(15,23,42,0.06)', color: '#64748b' }}>
                    <span>🎬</span><span>Video</span>
                  </button>
                )}
              </div>

              {/* Right content scroller */}
              <div ref={scrollContainerRef} onScroll={handleScroll}
                className="flex-1 overflow-y-auto px-4 md:px-8 lg:px-12 pt-16 md:pt-8 pb-24"
                style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e1 #ffffff' }}>

                {orderedRooms.map((room, sIdx) => {
                  const rt = ROOM_TYPES.find(r => r.id === room) || { label: room === 'cover' ? 'Cover Photo' : room, emoji: '📷' };
                  const roomImages = grouped[room] || [];
                  if (!roomImages.length) return null;
                  const [hero, ...rest] = roomImages;
                  return (
                    <motion.section key={room}
                      ref={(el) => { sectionRefs.current[room] = el; }}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(sIdx * 0.06, 0.3), duration: 0.35, ease: 'easeOut' }}
                      className={`${sIdx === 0 ? '' : 'mt-10 pt-10'}`}
                      style={sIdx === 0 ? {} : { borderTop: '1px solid rgba(15,23,42,0.06)' }}>
                      <div className="flex items-center gap-3 mb-5">
                        <span className="text-2xl md:text-3xl">{rt.emoji}</span>
                        <div>
                          <h3 className="text-slate-900 font-black text-xl md:text-2xl tracking-tight leading-none" style={{ fontFamily: 'Oxanium, sans-serif' }}>
                            {rt.label}
                          </h3>
                          <p className="text-slate-500 text-[11px] font-bold uppercase tracking-widest mt-1">
                            {roomImages.length} photo{roomImages.length !== 1 ? 's' : ''}
                          </p>
                        </div>
                      </div>

                      {/* Hero (full width) + remaining as 2-up / 3-up grid below */}
                      <div className="grid gap-3 md:gap-4">
                        <div onClick={() => onPhotoClick(hero.url)}
                          className="relative overflow-hidden cursor-pointer group"
                          style={{ aspectRatio: '16/9', borderRadius: '1.25rem', border: '1px solid rgba(15,23,42,0.06)' }}>
                          <img src={hero.url} alt={hero.label} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" loading="lazy" />
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                            <div className="w-12 h-12 rounded-full flex items-center justify-center"
                              style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(8px)' }}>
                              <Eye size={18} className="text-white" />
                            </div>
                          </div>
                        </div>

                        {rest.length > 0 && (
                          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4">
                            {rest.map((img, i) => (
                              <motion.div key={i}
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: Math.min(i * 0.04, 0.3), duration: 0.3, ease: 'easeOut' }}
                                onClick={() => onPhotoClick(img.url)}
                                className="relative overflow-hidden cursor-pointer group"
                                style={{ aspectRatio: '4/3', borderRadius: '1rem', border: '1px solid rgba(15,23,42,0.06)' }}>
                                <img src={img.url} alt={img.label} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" loading="lazy" />
                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                  <div className="w-10 h-10 rounded-full flex items-center justify-center"
                                    style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(8px)' }}>
                                    <Eye size={16} className="text-white" />
                                  </div>
                                </div>
                              </motion.div>
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.section>
                  );
                })}

                {/* Video section */}
                {hasVideo && (
                  <motion.section
                    ref={(el) => { sectionRefs.current.video = el; }}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3, duration: 0.35, ease: 'easeOut' }}
                    className="mt-10 pt-10"
                    style={{ borderTop: '1px solid rgba(15,23,42,0.06)' }}>
                    <div className="flex items-center gap-3 mb-5">
                      <span className="text-2xl md:text-3xl">🎬</span>
                      <div>
                        <h3 className="text-slate-900 font-black text-xl md:text-2xl tracking-tight leading-none" style={{ fontFamily: 'Oxanium, sans-serif' }}>Video Tour</h3>
                        <p className="text-slate-500 text-[11px] font-bold uppercase tracking-widest mt-1">Watch the full walkthrough</p>
                      </div>
                    </div>
                    {property?.mainVideo ? (
                      <div className="relative rounded-[1.25rem] overflow-hidden" style={{ aspectRatio: '16/9' }}>
                        <video src={modalVideoUrl} controls className="w-full h-full object-cover" style={{ background: '#000' }} />
                      </div>
                    ) : property?.videoId ? (
                      <div className="relative rounded-[1.25rem] overflow-hidden" style={{ aspectRatio: '16/9', border: '1px solid rgba(15,23,42,0.06)' }}>
                        <iframe
                          src={`https://www.youtube.com/embed/${property.videoId}?rel=0`}
                          title="Property Video Tour" className="w-full h-full"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen />
                      </div>
                    ) : null}
                  </motion.section>
                )}

                <div className="h-16" />
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// GLASS CARD WRAPPER
// ─────────────────────────────────────────────────────────────────────────────
const GlassCard = ({ children, className = '', style = {} }) => (
  <div className={`glass-card rounded-[2rem] ${className}`} style={style}>
    {children}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// PROPERTY LOCATION MAP (Google Maps)
// Single-marker map for the property's GPS coordinates. Falls back to the
// public /maps iframe embed when no API key is configured so the page still
// renders cleanly in dev / preview environments.
//
// BACKEND: pass `lat` / `lng` from the API response. The `title` is used as
// the marker tooltip and the iframe `<iframe title="...">` for a11y.
// ─────────────────────────────────────────────────────────────────────────────
const PropertyLocationMap = ({ lat, lng, title }) => {
  const center = useMemo(() => ({ lat, lng }), [lat, lng]);

  const mapOptions = useMemo(
    () => ({
      disableDefaultUI: false,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      clickableIcons: false,
      gestureHandling: 'cooperative',
      styles: MAP_STYLES,
    }),
    []
  );

  const { isLoaded, loadError } = useJsApiLoader({
    id: 'tlp-google-map-script',
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });

  // Fallback (no API key OR loader error) → static placeholder.
  // Previously this rendered a Google Maps output=embed iframe, but that
  // iframe loads Google's own internal Maps JS with their default key,
  // causing a "NoApiKeys" console warning and a second uncontrolled Maps
  // instance. A simple placeholder avoids that entirely.
  if (!GOOGLE_MAPS_API_KEY || loadError) {
    return (
      <div
        style={{ width: '100%', height: '100%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, borderRadius: 16 }}
      >
        <MapPin size={28} style={{ color: '#94a3b8' }} />
        <span style={{ fontSize: 13, fontWeight: 800, color: '#64748b' }}>Map unavailable</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8' }}>Set VITE_GOOGLE_MAPS_API_KEY to enable the map</span>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="w-full h-full flex items-center justify-center" style={{ background: '#fafbfc' }}>
        <div className="flex flex-col items-center gap-2">
          <div className="w-9 h-9 border-[3px] border-[#ba0036] border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-bold text-slate-400">Loading map…</span>
        </div>
      </div>
    );
  }

  return (
    <GoogleMap
      mapContainerStyle={{ width: '100%', height: '100%' }}
      center={center}
      zoom={16}
      options={mapOptions}
    >
      <MarkerF position={center} title={title} />
    </GoogleMap>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
const PropertyDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  // Auth-aware CTAs — guests can browse everything, but Inquire / Call /
  // Message are gated so the landlord only ever receives signed-in,
  // contactable leads. Guest taps redirect to /login with the current
  // property in the `next` param so the user lands back here after
  // signing in.
  const auth = useAuth();
  const requireAuthFor = (cb) => {
    if (auth?.isAuthenticated) { cb(); return; }
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    navigate(`/login?next=${next}`);
  };
  const langCtx = useLanguage();
  const ctxT = (langCtx && typeof langCtx.t === 'object' && langCtx.t) || null;
  const ctxLanguage = langCtx?.language || langCtx?.locale || 'en';
  const setLanguage = langCtx?.setLanguage || langCtx?.changeLanguage || langCtx?.setLocale || (() => {});

  // Map ('English'/'বাংলা'/'en'/'bn'/'ar') → local-translation bucket
  const langKey = (ctxLanguage === 'বাংলা' || ctxLanguage === 'bn') ? 'bn'
                : (ctxLanguage === 'ar') ? 'ar'
                : 'en';
  const lc = LOCAL_TRANSLATIONS[langKey] || LOCAL_TRANSLATIONS.en;

  // Maps our local keys → matching keys in the global LanguageContext (so
  // toggling EN ↔ বাংলা from the global switcher actually translates the page).
  const CTX_KEY_MAP = {
    back: 'backBtn', home: 'home', share: 'share', save: 'save',
    saved: 'save', call: 'callNow', message: 'messageBtn',
    bedrooms: 'bedrooms', area: 'sqft',
    aboutProperty: 'aboutProperty', amenities: 'amenities',
    location: 'locationText', verified: 'verified',
    monthlyRent: 'monthlyRentText', sendInquiry: 'sendInquiry',
    inquireNow: 'inquireNowBtn', viewProfile: 'viewProfile',
    forRent: 'tabRent', forSale: 'tabBuy',
  };
  const lt = (key) => {
    const cKey = CTX_KEY_MAP[key];
    if (cKey && ctxT && ctxT[cKey]) return ctxT[cKey];
    if (ctxT && ctxT[key]) return ctxT[key];
    return lc[key] || key;
  };

  // ── LIVE PROPERTY + LANDLORD FETCH ────────────────────────────────────────
  // Both come from propertyService (backend → localStorage fallback). While the
  // fetch is in flight we render an empty stub so hooks below don't blow up.
  const [property, setProperty] = useState(null);
  const [landlord, setLandlord] = useState(null);
  const [loadingProperty, setLoadingProperty] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingProperty(true);
    (async () => {
      const p = await propertyService.getPropertyById(id);
      if (cancelled) return;
      if (!p) {
        setProperty(null);
        setLandlord(null);
        setLoadingProperty(false);
        return;
      }
      // Synthesise a safe fallback landlord from the property's own contact
      // fields FIRST so the JSX (which reads many landlord.* fields) never
      // sees a null landlord. We then overwrite it with the registered
      // landlord record if one exists.
      const fallbackLandlord = {
        id:             p.landlordId || p.ownerUserId || `host-${p.id}`,
        name:           p.contactName || 'Property Owner',
        avatar:         `https://ui-avatars.com/api/?name=${encodeURIComponent(p.contactName || 'Owner')}&background=1a0510&color=ba0036`,
        phone:          p.contactPhone || '',
        email:          p.contactEmail || '',
        verified:       false,
        memberSince:    new Date(p.createdAt || Date.now()).getFullYear().toString(),
        rating:         0,
        totalReviews:   0,
        responseTime:   '—',
        badges:         [],
        bio:            '',
        totalProperties: 1,
        responseRate:   0,
      };
      setProperty(p);
      setLandlord(fallbackLandlord);
      setLoadingProperty(false);
      const ll = await propertyService.getLandlord(p.landlordId || p.ownerUserId);
      if (!cancelled && ll) setLandlord({ ...fallbackLandlord, ...ll });
    })();
    return () => { cancelled = true; };
  }, [id]);

  const isUnavailable = property?.status === 'rented' || property?.status === 'sold';
  const priceLabel = INTENT_CONFIG[property?.intent]?.priceLabel || '/mo';
  const galleryImages = useMemo(() => buildGallery(property), [property]);

  const [isSaved, setIsSaved] = useState(false);
  const [activeModal, setActiveModal] = useState(null);
  const [showInquiry, setShowInquiry] = useState(false);
  const [showPhotoGrid, setShowPhotoGrid] = useState(false);
  const [fullscreenPhoto, setFullscreenPhoto] = useState(null);
  // Reviews start empty for every property — no fake review history. They'll
  // come from /api/properties/{id}/reviews when that endpoint exists.
  const [reviews, setReviews] = useState([]);
  useEffect(() => { setReviews([]); }, [id]);
  // Reviewer name is sourced from the authenticated profile; the form no
  // longer asks for a name. Once auth is wired, replace 'You' with profile.name.
  const reviewerName = (langCtx?.user?.name) || 'You';
  const [newReview, setNewReview] = useState({ rating: 5, comment: '' });
  const [reviewDone, setReviewDone] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  const [expandAbout, setExpandAbout] = useState(false);

  // Sticky page navbar (Back | breadcrumb | Save/Share). Stays put while you
  // scroll — does NOT auto-hide. Only the visual surface intensifies a touch
  // once you've scrolled past the very top so it reads as "lifted".
  const [navScrolled, setNavScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
    const saved = JSON.parse(localStorage.getItem('savedProperties') || '[]');
    setIsSaved(saved.some((p) => String(p.id) === String(id)));
  }, [id]);

  const showToast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const handleSave = () => {
    let saved = JSON.parse(localStorage.getItem('savedProperties') || '[]');
    if (isSaved) {
      saved = saved.filter((p) => String(p.id) !== String(id));
      setIsSaved(false);
      showToast('Removed from saved list');
    } else {
      saved.push({ ...property, id });
      setIsSaved(true);
      showToast('Saved to favorites! ❤️');
    }
    localStorage.setItem('savedProperties', JSON.stringify(saved));
  };

  const handleShare = () => {
    const url = `https://toletpro.com/property/${id}`;
    if (navigator.share) {
      navigator.share({ title: property.title, url });
    } else {
      navigator.clipboard.writeText(url);
      showToast('Link copied! 🔗');
    }
  };

  const handleSubmitReview = (e) => {
    e.preventDefault();
    if (!newReview.comment.trim()) return;
    setReviews((prev) => [{
      id: Date.now(),
      name: reviewerName,
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(reviewerName)}&background=1a0510&color=ba0036`,
      rating: newReview.rating,
      date: new Date().toISOString().split('T')[0],
      comment: newReview.comment,
    }, ...prev]);
    setNewReview({ rating: 5, comment: '' });
    setReviewDone(true);
    showToast('Review submitted! Thank you 🙏');
    setTimeout(() => setReviewDone(false), 5000);
  };

  const avgRating = reviews.length > 0
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
    : (property?.rating || 0);

  const amenities = property?.amenities || [];
  const mapLat = parseFloat(property?.gpsLat) || 23.7925;
  const mapLng = parseFloat(property?.gpsLng) || 90.4078;

  // Fetch REAL nearby places from the Overpass API based on this property's
  // actual GPS coordinates. Shows loading state while fetching.
  const [nearbyPlaces, setNearbyPlaces] = useState(
    NEARBY_PLACE_TYPES.map(({ label, icon }) => ({ label, icon, name: null, distKm: Infinity, dist: '...' }))
  );
  useEffect(() => {
    let cancelled = false;
    fetchNearbyPlaces(mapLat, mapLng).then(places => {
      if (!cancelled) setNearbyPlaces(places);
    });
    return () => { cancelled = true; };
  }, [mapLat, mapLng]);

  // Shared input style for review form (light theme)
  const reviewInputStyle = {
    background: '#ffffff',
    border: '1px solid rgba(15,23,42,0.1)',
    color: '#0f172a',
  };

  // Suppress lint warnings for retained-but-currently-unused language vars (logic kept intact)
  void ctxLanguage; void setLanguage;

  // ── LOADING / NOT-FOUND STATES ────────────────────────────────────────────
  // While we wait for propertyService to resolve we render a lightweight
  // skeleton. If the fetch finishes and we still have no property record, we
  // show a friendly "not found" card pointing users back to search — which is
  // the right thing to do now that there is zero demo data in the codebase.
  if (loadingProperty) {
    return (
      <div className="w-full min-h-screen flex items-center justify-center futuristic-bg">
        <FuturisticTheme />
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full border-4 border-[#ba0036]/30 border-t-[#ba0036] animate-spin" />
          <p className="text-slate-600 text-sm font-semibold">{lt('loading') || 'Loading…'}</p>
        </div>
      </div>
    );
  }
  if (!property) {
    return (
      <div className="w-full min-h-screen flex items-center justify-center futuristic-bg p-6">
        <FuturisticTheme />
        <div className="max-w-md w-full bg-white rounded-2xl p-8 text-center shadow-xl"
          style={{ border: '1px solid rgba(15,23,42,0.08)' }}>
          <Home size={36} className="mx-auto mb-3 text-[#ba0036]" />
          <h2 className="text-xl font-black text-slate-900 mb-2">Property not found</h2>
          <p className="text-sm text-slate-600 mb-5">
            This listing is no longer available, or it hasn't been uploaded yet.
            Try browsing all available properties.
          </p>
          <button
            onClick={() => navigate('/properties')}
            className="px-5 py-2.5 rounded-full bg-[#ba0036] text-white text-sm font-black hover:bg-[#7c0026] transition-colors"
          >
            Browse properties
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen futuristic-bg futuristic-root relative">
      <FuturisticTheme />

      {/* ── TOAST ── */}
      <div className={`fixed top-20 left-1/2 -translate-x-1/2 z-[200] transition-all duration-500 pointer-events-none ${toastMsg ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'}`}>
        <div className="text-slate-900 px-5 py-2.5 rounded-full shadow-xl flex items-center gap-2.5 whitespace-nowrap"
          style={{ background: '#ffffff', border: '1px solid rgba(15,23,42,0.08)', boxShadow: '0 10px 30px rgba(15,23,42,0.12)' }}>
          <CheckCircle2 size={15} className="text-emerald-600" />
          <span className="text-sm font-bold">{toastMsg}</span>
        </div>
      </div>

      {/* ═══ STICKY PAGE NAV — matches reference video exactly ═══
          Layout (same on mobile and desktop):
            [ ← Back ]   HOME › Dhaka › Property Title   [♡] [⤴]
          • Stays sticky as you scroll
          • Does NOT auto-hide
          • No brand logo, no home brand button — just the page-level row
          • Light surface; subtle lift shadow once you've scrolled past 24px

          POSITIONING (important): sticky `top-[56px] md:top-[64px]` so this bar
          parks BELOW the compact global TopNav's top row and
          also `sticky top-0`). Without this offset both bars would stack at
          y=0 and this one would visually cover the global Navbar.

          Z-INDEX: z-30 so the global Navbar (z-[60]) and its city dropdowns
          (z-[70]) stay above this bar. */}
      <header
        className="sticky top-[56px] md:top-[64px] z-30"
        style={{
          background: '#ffffff',
          borderBottom: '1px solid rgba(15,23,42,0.06)',
          boxShadow: navScrolled ? '0 6px 18px rgba(15,23,42,0.06)' : 'none',
          transition: 'box-shadow 220ms ease',
        }}
      >
        <div className="max-w-[1400px] mx-auto px-3 md:px-6 lg:px-10 h-12 md:h-14 flex items-center justify-between gap-2 md:gap-4">

          {/* LEFT — Back button */}
          <motion.button
            onClick={() => navigate(-1)}
            whileTap={{ scale: 0.94 }}
            whileHover={{ x: -2 }}
            className="flex items-center gap-1.5 text-xs md:text-sm font-black text-[#ba0036] px-3 md:px-4 py-2 md:py-2.5 rounded-full transition-colors shrink-0"
            style={{ background: 'rgba(186,0,54,0.08)' }}
            aria-label={lt('back')}
          >
            <ArrowLeft size={15} strokeWidth={2.6} />
            <span>{lt('back')}</span>
          </motion.button>

          {/* CENTER — breadcrumb. Visible on every screen size; truncates on mobile */}
          <div className="flex items-center gap-1.5 md:gap-2 min-w-0 flex-1 justify-center text-[10px] md:text-[11px] font-black text-slate-500 uppercase tracking-widest">
            <Link to="/" className="hover:text-[#ba0036] transition-colors shrink-0">{lt('home')}</Link>
            <ChevronRight size={11} className="shrink-0 text-slate-400" />
            <span className="hover:text-[#ba0036] cursor-pointer transition-colors shrink-0 capitalize">{property.division}</span>
            <ChevronRight size={11} className="shrink-0 text-slate-400" />
            <span className="text-slate-800 truncate min-w-0">{property.title}</span>
          </div>

          {/* RIGHT — Save + Share */}
          <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
            <motion.button
              onClick={handleSave}
              whileTap={{ scale: 0.88 }}
              whileHover={{ scale: 1.05 }}
              aria-label={isSaved ? lt('saved') : lt('save')}
              className="relative w-10 h-10 md:w-11 md:h-11 rounded-full flex items-center justify-center transition-colors"
              style={isSaved
                ? { background: 'rgba(186,0,54,0.10)' }
                : { background: '#f1f5f9' }}
            >
              <Heart size={17} strokeWidth={2.4}
                className={isSaved ? 'text-[#ba0036]' : 'text-slate-600'}
                fill={isSaved ? '#ba0036' : 'none'} />
            </motion.button>

            <motion.button
              onClick={handleShare}
              whileTap={{ scale: 0.88 }}
              whileHover={{ scale: 1.05, rotate: -8 }}
              aria-label={lt('share')}
              className="w-10 h-10 md:w-11 md:h-11 rounded-full flex items-center justify-center transition-colors"
              style={{ background: '#f1f5f9' }}
            >
              <Share2 size={17} strokeWidth={2.4} className="text-slate-600" />
            </motion.button>
          </div>
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto px-4 md:px-6 lg:px-10 pt-4 pb-40 lg:pb-12">

        {/* ═══════════════════════════════════════════════════════════════════
            HERO — Flatio-style wide single-image carousel on desktop;
            full-bleed mobile carousel below md.
        ═══════════════════════════════════════════════════════════════════ */}

        {/* Desktop wide carousel */}
        <div className="hidden md:block">
          <WidePhotoCarousel
            images={galleryImages}
            isUnavailable={isUnavailable}
            property={property}
            onShowAll={() => setShowPhotoGrid(true)}
            showAllLabel={lt('showAllPhotos') || 'Show all photos'}
          />
        </div>

        {/* Mobile carousel */}
        <div className="md:hidden">
          <HeroCarousel
            images={galleryImages}
            isUnavailable={isUnavailable}
            property={property}
            priceLabel={priceLabel}
            onShowAll={() => setShowPhotoGrid(true)}
            onPhotoClick={(src) => setFullscreenPhoto(src)}
          />
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            TITLE STRIP + BADGES
        ═══════════════════════════════════════════════════════════════════ */}
        <div className="mb-6">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <IntentBadge intent={property.intent} />
            <CategoryBadge category={property.category} />
            <StatusBadge status={property.status} intent={property.intent} />
            {property.verified && (
              <span className="inline-flex items-center gap-1.5 text-emerald-700 text-[10px] font-black px-3 py-1.5 rounded-full uppercase tracking-widest"
                style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)' }}>
                <BadgeCheck size={11} /> {lt('verified')}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 text-amber-700 text-[10px] font-black px-3 py-1.5 rounded-full"
              style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
              <Star size={10} className="fill-yellow-400 text-yellow-400" />
              {avgRating} · {reviews.length} reviews
            </span>
            <span className="inline-flex items-center gap-1.5 text-blue-700 text-[10px] font-black px-3 py-1.5 rounded-full capitalize"
              style={{ background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.2)' }}>
              {property.furnishing}
            </span>
            <span className="inline-flex items-center gap-1.5 text-slate-600 text-[10px] font-black px-3 py-1.5 rounded-full capitalize"
              style={{ background: '#f1f5f9', border: '1px solid rgba(15,23,42,0.06)' }}>
              {property.type}
            </span>
          </div>

          {/* Title (mobile only) */}
          <h1 className="md:hidden text-xl sm:text-2xl font-black text-slate-900 tracking-tight leading-tight mb-2"
            style={{ fontFamily: 'Oxanium, sans-serif' }}>
            {property.title}
          </h1>
          {/* Title (desktop only) */}
          <h1 className="hidden md:block text-2xl lg:text-3xl font-black text-slate-900 tracking-tight leading-tight mb-2"
            style={{ fontFamily: 'Oxanium, sans-serif' }}>
            {property.title}
          </h1>
          {/* Location row — on mobile, a tiny price chip sits to the LEFT of the location so users see price without crowding the image */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="md:hidden inline-flex items-center text-[11px] font-black text-[#ba0036] px-2 py-0.5 rounded-md leading-none"
              style={{ background: 'rgba(186,0,54,0.07)', border: '1px solid rgba(186,0,54,0.2)', fontFamily: 'Oxanium, sans-serif' }}>
              ৳{Number(property.price).toLocaleString('en-IN')}{priceLabel && <span className="text-[9px] text-[#ba0036]/70 font-bold ml-0.5">{priceLabel}</span>}
            </span>
            <p className="flex items-center gap-1.5 text-slate-600 font-bold text-sm min-w-0">
              <MapPin size={14} className="text-[#ba0036] shrink-0" />
              <span className="truncate">{property.location}</span>
            </p>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            MAIN GRID
        ═══════════════════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">

          {/* ── LEFT COLUMN ── */}
          <div className="lg:col-span-8 flex flex-col gap-5">

            {/* STATS BAR — 4 futuristic tiles (Bedrooms / Bathrooms / SQFT / Floor)
                Each tile has its own motion entrance + a constantly-pulsing
                radial glow + an animated corner sparkle. Hover scales the
                whole tile and amplifies the glow. */}
            <GlassCard className="p-4 md:p-7">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
                {[
                  { icon: Bed,       label: lt('bedrooms'),  value: `${property.beds}`,  unit: 'Beds' },
                  { icon: Bath,      label: lt('bathrooms'), value: `${property.baths}`, unit: 'Baths' },
                  { icon: Maximize2, label: lt('area'),      value: Number(property.sqft).toLocaleString(), unit: 'sqft' },
                  { icon: Building2, label: lt('floor'),     value: `${property.floor ?? '—'}`, unit: lt('floorUnit') || 'Fl' },
                ].map((stat, i) => (
                  <motion.div key={i}
                    initial={{ opacity: 0, y: 14, scale: 0.94 }}
                    whileInView={{ opacity: 1, y: 0, scale: 1 }}
                    viewport={{ once: true, margin: '-40px' }}
                    transition={{ delay: i * 0.07, type: 'spring', damping: 16, stiffness: 220 }}
                    whileHover={{ y: -2 }}
                    className="group flex flex-col items-center sm:flex-row sm:items-center gap-2 sm:gap-3 p-3 sm:p-3.5 rounded-2xl relative overflow-hidden"
                    style={{
                      background: 'linear-gradient(160deg, rgba(186,0,54,0.04) 0%, rgba(186,0,54,0.01) 60%, transparent 100%)',
                      border: '1px solid rgba(186,0,54,0.10)',
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7)'
                    }}
                  >
                    {/* Diagonal shimmer sweep on hover */}
                    <span className="pointer-events-none absolute -inset-y-2 -left-12 w-12 rotate-12 opacity-0 group-hover:opacity-100 group-hover:translate-x-[150%] transition-all duration-700"
                      style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(186,0,54,0.18) 50%, transparent 100%)' }} />

                    {/* Icon tile */}
                    <motion.div
                      className="relative w-12 h-12 sm:w-13 sm:h-13 rounded-2xl flex items-center justify-center shrink-0 overflow-hidden"
                      style={{
                        width: '52px', height: '52px',
                        background: 'linear-gradient(135deg, rgba(186,0,54,0.16) 0%, rgba(186,0,54,0.06) 100%)',
                        border: '1px solid rgba(186,0,54,0.30)',
                        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.55), 0 6px 14px rgba(186,0,54,0.14)'
                      }}
                      whileHover={{ rotate: 4, scale: 1.05 }}
                      transition={{ type: 'spring', damping: 14, stiffness: 260 }}
                    >
                      {/* Pulsing radial glow */}
                      <motion.span aria-hidden
                        className="absolute inset-0 pointer-events-none"
                        style={{ background: 'radial-gradient(circle at 30% 25%, rgba(186,0,54,0.30) 0%, transparent 60%)' }}
                        animate={{ opacity: [0.35, 0.75, 0.35] }}
                        transition={{ duration: 3 + i * 0.3, repeat: Infinity, ease: 'easeInOut' }}
                      />
                      {/* Top-right sparkle */}
                      <motion.span aria-hidden
                        className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full"
                        style={{ background: '#ba0036', boxShadow: '0 0 6px rgba(186,0,54,0.8)' }}
                        animate={{ opacity: [0, 1, 0], scale: [0.5, 1.3, 0.5] }}
                        transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.6, ease: 'easeInOut' }}
                      />
                      <stat.icon className="text-[#ba0036] relative" size={22} strokeWidth={2.4} />
                    </motion.div>

                    {/* Label + value */}
                    <div className="text-center sm:text-left min-w-0 relative">
                      <p className="text-[9px] sm:text-[10px] font-black text-slate-500 uppercase tracking-widest">{stat.label}</p>
                      <p className="text-base md:text-lg font-black text-slate-900 leading-tight" style={{ fontFamily: 'Oxanium, sans-serif' }}>
                        {stat.value} <span className="text-[10px] md:text-xs font-bold text-slate-500">{stat.unit}</span>
                      </p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </GlassCard>

            {/* MOBILE PRICE + ACTIONS — removed.
                The mobile sticky bottom bar already shows the rent + price
                + Inquire/Call CTAs, so duplicating them here was crowding
                the page with the same "Monthly Rent" label multiple times. */}

            {/* VIDEO TOUR */}
            <GlassCard className="p-5 md:p-7">
              <VideoPlayer mainVideo={property.mainVideo} videoId={property.videoId} coverPhoto={property.coverPhoto} title={property.title} />
              {!property.mainVideo && !property.videoId && (
                <div className="text-center py-8">
                  <Play size={36} className="mx-auto mb-2 text-slate-300" />
                  <p className="font-bold text-sm text-slate-500">No video tour available for this property.</p>
                </div>
              )}
            </GlassCard>

            {/* ABOUT */}
            <GlassCard className="p-5 md:p-7">
              <h3 className="text-xl font-black text-slate-900 mb-4" style={{ fontFamily: 'Oxanium, sans-serif' }}>{lt('aboutProperty')}</h3>
              <p className={`text-slate-600 leading-relaxed font-medium text-sm md:text-base transition-all ${!expandAbout ? 'line-clamp-4' : ''}`}>
                {property.description}
              </p>
              <button onClick={() => setExpandAbout((p) => !p)}
                className="mt-3 text-[#ba0036] text-sm font-black flex items-center gap-1 hover:underline">
                {expandAbout ? lt('showLess') : lt('readMore')}
                <ChevronRight size={14} className={`transition-transform ${expandAbout ? 'rotate-90' : ''}`} />
              </button>
            </GlassCard>

            {/* AMENITIES */}
            <GlassCard className="p-5 md:p-7">
              <h3 className="text-xl font-black text-slate-900 mb-5" style={{ fontFamily: 'Oxanium, sans-serif' }}>{lt('amenities')}</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {amenities.map((amenity, i) => {
                  const cfg = amenityConfig[amenity] || { icon: CheckCircle2, color: 'text-[#ba0036]', bg: 'bg-red-50' };
                  return (
                    <div key={i} className="flex items-center gap-3 p-3 md:p-4 rounded-2xl transition-all group cursor-default"
                      style={{ background: '#fafbfc', border: '1px solid rgba(15,23,42,0.06)' }}>
                      <div className={`w-9 h-9 rounded-xl ${cfg.bg} flex items-center justify-center shrink-0`}>
                        <cfg.icon size={16} className={cfg.color} />
                      </div>
                      <span className="text-xs font-bold text-slate-700 leading-tight">{amenity}</span>
                    </div>
                  );
                })}
              </div>
            </GlassCard>

            {/* MAP + NEARBY */}
            <GlassCard className="p-5 md:p-7">
              <h3 className="text-xl font-black text-slate-900 mb-1" style={{ fontFamily: 'Oxanium, sans-serif' }}>{lt('location')}</h3>
              <p className="text-slate-600 font-bold text-sm mb-4 flex items-center gap-2">
                <MapPin size={13} className="text-[#ba0036]" /> {property.location}
              </p>
              {/* Google Map — interactive when VITE_GOOGLE_MAPS_API_KEY (or
                  REACT_APP_GOOGLE_MAPS_API_KEY) is set. Falls back to the
                  no-key /maps embed iframe so dev / preview environments still
                  render a real Google Map. See <PropertyLocationMap /> above. */}
              <div className="w-full h-[260px] md:h-[340px] rounded-[1.5rem] overflow-hidden relative z-0"
                style={{ border: '1px solid rgba(15,23,42,0.08)' }}>
                <PropertyLocationMap lat={mapLat} lng={mapLng} title={property.title} />
              </div>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${mapLat},${mapLng}`}
                target="_blank" rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-[#ba0036] text-xs font-black hover:underline"
              >
                <MapPin size={13} /> {lt('openInGoogleMaps') || 'Open in Google Maps'} <ChevronRight size={13} />
              </a>
              {/* "Nearby" grid — fetched LIVE from OpenStreetMap's Overpass
                  API using the property's actual GPS coordinates. Shows the
                  real nearest mosque, market, hospital, etc. for ANY location
                  — no longer limited to hardcoded Dhaka landmarks. */}
              <div className="mt-5 mb-2 flex items-center gap-2">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">What's nearby</span>
                <span className="flex-1 h-px bg-slate-200/70" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {nearbyPlaces.map((place, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-2xl"
                    style={{ background: '#fafbfc', border: '1px solid rgba(15,23,42,0.06)' }}>
                    <span className="text-xl shrink-0" aria-hidden>{place.icon}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-black text-slate-800 leading-tight">{place.label}</p>
                      {place.name && (
                        <p className="text-[10px] font-bold text-slate-600 truncate" title={place.name}>{place.name}</p>
                      )}
                      <p className="text-[10px] font-black text-[#ba0036] mt-0.5">{place.dist}</p>
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>

            {/* LANDLORD */}
            <GlassCard className="p-5 md:p-7">
              <h3 className="text-xl font-black text-slate-900 mb-5" style={{ fontFamily: 'Oxanium, sans-serif' }}>{lt('aboutLandlord')}</h3>
              <div className="flex gap-4 md:gap-5 items-start">
                <Link to={`/landlord/${landlord.id}`} className="shrink-0">
                  <img src={landlord.avatar} alt={landlord.name}
                    className="w-16 h-16 md:w-20 md:h-20 rounded-[1rem] hover:scale-105 transition-transform"
                    style={{ boxShadow: '0 6px 18px rgba(15,23,42,0.08)' }} />
                </Link>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <Link to={`/landlord/${landlord.id}`}>
                      <h4 className="text-lg font-black text-slate-900 hover:text-[#ba0036] transition-colors" style={{ fontFamily: 'Oxanium, sans-serif' }}>{landlord.name}</h4>
                    </Link>
                    {landlord.verified && <BadgeCheck size={17} className="text-blue-600 shrink-0" />}
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs font-bold text-slate-500 mb-3">
                    <span className="flex items-center gap-1"><Calendar size={11} /> Since {landlord.memberSince}</span>
                    <span className="flex items-center gap-1"><Star size={11} className="text-yellow-400 fill-yellow-400" /> {landlord.rating} ({landlord.totalReviews})</span>
                    <span className="flex items-center gap-1"><Clock size={11} /> {landlord.responseTime}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {landlord.badges?.map((badge, i) => (
                      <span key={i} className="text-[10px] font-black px-2 py-0.5 rounded-full text-[#ba0036] flex items-center gap-1"
                        style={{ background: 'rgba(186,0,54,0.07)', border: '1px solid rgba(186,0,54,0.2)' }}>
                        <Award size={9} /> {badge}
                      </span>
                    ))}
                  </div>
                  <p className="text-sm text-slate-600 font-medium leading-relaxed line-clamp-2">{landlord.bio}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 mt-5 pt-5" style={{ borderTop: '1px solid rgba(15,23,42,0.06)' }}>
                {[
                  { label: lt('propertiesLabel'), value: landlord.totalProperties },
                  { label: lt('responseRate'), value: `${landlord.responseRate}%` },
                  { label: lt('avgReply'), value: landlord.responseTime },
                ].map((stat, i) => (
                  <div key={i} className="text-center p-3 rounded-2xl"
                    style={{ background: '#fafbfc', border: '1px solid rgba(15,23,42,0.05)' }}>
                    <p className="text-lg md:text-xl font-black text-slate-900" style={{ fontFamily: 'Oxanium, sans-serif' }}>{stat.value}</p>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">{stat.label}</p>
                  </div>
                ))}
              </div>

              {(landlord?.preferredTenants?.length > 0 || landlord?.houseRules?.length > 0) && (
                <div className="mt-5 pt-5" style={{ borderTop: '1px solid rgba(15,23,42,0.06)' }}>
                  {landlord.preferredTenants?.length > 0 && (
                    <div className="mb-4">
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Preferred Tenants</p>
                      <div className="flex flex-wrap gap-2">
                        {landlord.preferredTenants.map((pt, i) => (
                          <span key={i} className="bg-blue-50 text-blue-700 border border-blue-100 px-2.5 py-1 rounded-lg text-[10px] font-bold capitalize">
                            {pt.replace('_', ' ')}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {landlord.houseRules?.length > 0 && (
                    <div>
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">House Rules</p>
                      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {landlord.houseRules.map((hr, i) => (
                          <li key={i} className="flex items-center gap-2 text-xs font-medium text-slate-600">
                            <CheckCircle2 size={12} className="text-[#ba0036]" />
                            <span className="capitalize">{hr.replace(/_/g, ' ')}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              <Link to={`/landlord/${landlord.id}`}
                className="cyber-btn mt-4 w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-black text-sm transition-all active:scale-95 text-slate-700"
                style={{ background: '#fafbfc', border: '1px solid rgba(15,23,42,0.08)' }}>
                {lt('viewProfile')} <ChevronRight size={15} />
              </Link>
            </GlassCard>

            {/* REVIEWS — heading removed per request; rating + count remain on the right edge for context */}
            <GlassCard className="p-5 md:p-7">
              <div className="flex items-center justify-end mb-5">
                <div className="flex items-center gap-2">
                  <Star size={17} className="fill-yellow-400 text-yellow-400" />
                  <span className="text-2xl font-black text-slate-900" style={{ fontFamily: 'Oxanium, sans-serif' }}>{avgRating}</span>
                  <span className="text-xs text-slate-500 font-bold">({reviews.length})</span>
                </div>
              </div>

              <div className="flex flex-col gap-3 mb-7">
                {reviews.length === 0 && (
                  <div className="text-center py-8">
                    <Star size={36} className="mx-auto mb-2 text-slate-300" />
                    <p className="font-bold text-sm text-slate-500">{lt('noReviewsYet')}</p>
                  </div>
                )}
                {reviews.map((review) => (
                  <motion.div key={review.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    className="p-4 rounded-2xl" style={{ background: '#fafbfc', border: '1px solid rgba(15,23,42,0.06)' }}>
                    <div className="flex items-start gap-3">
                      <img src={review.avatar} alt={review.name} className="w-10 h-10 rounded-full shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                          <div>
                            <p className="font-black text-slate-900 text-sm">{review.name}</p>
                            <p className="text-[10px] font-bold text-slate-500">
                              {new Date(review.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </p>
                          </div>
                          <div className="flex gap-0.5">
                            {[1, 2, 3, 4, 5].map((s) => (
                              <Star key={s} size={13} className={s <= review.rating ? 'fill-yellow-400 text-yellow-400' : 'text-slate-300'} />
                            ))}
                          </div>
                        </div>
                        <p className="text-sm text-slate-600 font-medium leading-relaxed">{review.comment}</p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Review form — name is sourced from the authenticated profile,
                  so we no longer ask for it. */}
              {!reviewDone ? (
                <form onSubmit={handleSubmitReview} className="flex flex-col gap-3 pt-5" style={{ borderTop: '1px solid rgba(15,23,42,0.06)' }}>
                  <h4 className="font-black text-slate-900 text-base" style={{ fontFamily: 'Oxanium, sans-serif' }}>{lt('leaveReview')}</h4>
                  <p className="text-xs font-bold text-slate-500">
                    {lt('postingAs') || 'Posting as'} <span className="text-[#ba0036]">{reviewerName}</span>
                  </p>
                  <StarInput value={newReview.rating} onChange={(r) => setNewReview(p => ({ ...p, rating: r }))} />
                  <textarea
                    style={reviewInputStyle}
                    className="futuristic-input w-full p-4 rounded-2xl text-sm font-bold resize-none transition-all"
                    rows={3}
                    placeholder={lt('shareExperience')}
                    value={newReview.comment}
                    onChange={e => setNewReview(p => ({ ...p, comment: e.target.value }))}
                  />
                  <button type="submit"
                    className="cyber-btn text-white py-4 rounded-2xl font-black text-sm flex items-center justify-center gap-2"
                    style={{ background: 'linear-gradient(135deg, #ba0036 0%, #7c0026 100%)', boxShadow: '0 8px 22px rgba(186,0,54,0.22)' }}>
                    <Send size={15} /> {lt('submitReview')}
                  </button>
                </form>
              ) : (
                <div className="text-center py-6 pt-5" style={{ borderTop: '1px solid rgba(15,23,42,0.06)' }}>
                  <CheckCircle2 size={32} className="text-emerald-500 mx-auto mb-2" />
                  <p className="font-black text-slate-700">{lt('thankYouReview')}</p>
                </div>
              )}
            </GlassCard>

          </div>

          {/* ── RIGHT COLUMN (desktop sticky sidebar) ── */}
          <div className="hidden lg:block lg:col-span-4 lg:pt-12">
            <div className="sticky top-[128px] flex flex-col gap-5">

              {/* Price card */}
              <div className="glass-card rounded-[2.5rem] p-7 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-[#ba0036] to-transparent" />

                {/* Unavailable banner */}
                {isUnavailable && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-[2.5rem]"
                    style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)' }}>
                    <div className="w-14 h-14 rounded-full flex items-center justify-center mb-3"
                      style={{ background: '#f1f5f9', border: '1px solid rgba(15,23,42,0.08)' }}>
                      <X size={24} className="text-slate-500" strokeWidth={3} />
                    </div>
                    <p className="font-black text-slate-900 text-lg" style={{ fontFamily: 'Oxanium, sans-serif' }}>Not Available</p>
                    <p className="text-slate-500 font-bold text-xs mt-1">
                      {property.intent === 'purchase' ? 'This property has been sold' : 'This property has been rented'}
                    </p>
                  </div>
                )}

                {/* Price */}
                <div className="mt-1 mb-5">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                    {property.intent === 'purchase' ? lt('salePrice') : lt('monthlyRent')}
                  </p>
                  <h2 className="text-4xl font-black text-slate-900 tracking-tighter" style={{ fontFamily: 'Oxanium, sans-serif' }}>
                    ৳{Number(property.price).toLocaleString('en-IN')}
                    {priceLabel && <span className="text-sm font-bold text-slate-500">{priceLabel}</span>}
                  </h2>
                  {landlord?.serviceCharge > 0 && (
                    <p className="text-xs font-bold text-slate-500 mt-1">
                      + ৳{Number(landlord.serviceCharge).toLocaleString('en-IN')} Service Charge
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2 mt-2">
                    <IntentBadge intent={property.intent} />
                    <CategoryBadge category={property.category} />
                  </div>
                </div>

                {/* Landlord mini */}
                <div className="rounded-2xl p-4 mb-5 flex items-center gap-4"
                  style={{ background: '#fafbfc', border: '1px solid rgba(15,23,42,0.06)' }}>
                  <Link to={`/landlord/${landlord.id}`} className="shrink-0">
                    <img src={landlord.avatar} alt={landlord.name}
                      className="w-14 h-14 rounded-[0.875rem] hover:scale-105 transition-transform"
                      style={{ boxShadow: '0 4px 12px rgba(15,23,42,0.06)' }} />
                  </Link>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-0.5">{lt('listedBy')}</p>
                    <Link to={`/landlord/${landlord.id}`}>
                      <h4 className="font-black text-slate-900 hover:text-[#ba0036] transition-colors truncate" style={{ fontFamily: 'Oxanium, sans-serif' }}>{landlord.name}</h4>
                    </Link>
                    <div className="flex items-center gap-2 mt-1">
                      <Star size={11} className="fill-yellow-400 text-yellow-400" />
                      <span className="text-xs font-bold text-slate-700">{landlord.rating}</span>
                      <span className="text-slate-300 text-xs">·</span>
                      <span className="text-xs font-bold text-emerald-700">{landlord.responseRate}% response</span>
                    </div>
                  </div>
                  {landlord.verified && <BadgeCheck size={18} className="text-blue-600 shrink-0" />}
                </div>

                {/* CTA buttons */}
                <button disabled={isUnavailable} onClick={() => !isUnavailable && requireAuthFor(() => setShowInquiry(true))}
                  className={`cyber-btn w-full text-white py-4 rounded-2xl font-black flex items-center justify-center gap-2 mb-3 transition-all active:scale-95 ${isUnavailable ? 'opacity-40 cursor-not-allowed' : ''}`}
                  style={{ background: 'linear-gradient(135deg, #ba0036 0%, #7c0026 100%)', boxShadow: isUnavailable ? 'none' : '0 8px 22px rgba(186,0,54,0.22)' }}>
                  <MessageCircle size={18} /> {isUnavailable ? lt('notAvailable') : lt('sendInquiry')}
                </button>

                <div className="flex gap-3 mb-5">
                  <button disabled={isUnavailable} onClick={() => !isUnavailable && requireAuthFor(() => setActiveModal('call'))}
                    className={`flex-1 py-3 rounded-2xl font-black text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all ${isUnavailable ? 'opacity-40 cursor-not-allowed text-slate-400' : 'text-emerald-700'}`}
                    style={{ background: '#ffffff', border: '1px solid rgba(15,23,42,0.08)' }}>
                    <Phone size={14} /> {lt('call')}
                  </button>
                  <button disabled={isUnavailable} onClick={() => !isUnavailable && requireAuthFor(() => setActiveModal('message'))}
                    className={`flex-1 py-3 rounded-2xl font-black text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all ${isUnavailable ? 'opacity-40 cursor-not-allowed text-slate-400' : 'text-blue-700'}`}
                    style={{ background: '#ffffff', border: '1px solid rgba(15,23,42,0.08)' }}>
                    <MessageSquare size={14} /> {lt('message')}
                  </button>
                </div>

                {/* How it works */}
                <div className="rounded-2xl p-4" style={{ background: '#fafbfc', border: '1px solid rgba(15,23,42,0.05)' }}>
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">{lt('howItWorks')}</p>
                  <div className="flex flex-col gap-2">
                    {[
                      { icon: '📩', title: 'You send an inquiry', sub: 'Your name, phone & message go to the landlord' },
                      { icon: '📞', title: 'Landlord contacts you', sub: `${landlord.name} will call or message you back` },
                      { icon: '🏠', title: 'Visit & deal directly', sub: 'Schedule a viewing and finalize everything together' },
                    ].map((step, i) => (
                      <div key={i} className={`flex items-start gap-3 py-2.5 ${i < 2 ? 'border-b' : ''}`}
                        style={i < 2 ? { borderColor: 'rgba(15,23,42,0.05)' } : {}}>
                        <span className="text-xl shrink-0 mt-0.5">{step.icon}</span>
                        <div>
                          <p className="text-xs font-black text-slate-800">{step.title}</p>
                          <p className="text-[11px] font-bold text-slate-500 mt-0.5 leading-relaxed">{step.sub}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Save + Share */}
                <div className="flex gap-2 mt-4">
                  <button onClick={handleSave}
                    className={`flex-1 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all ${isSaved ? 'text-[#ba0036]' : 'text-slate-600'}`}
                    style={isSaved
                      ? { background: 'rgba(186,0,54,0.07)', border: '1px solid rgba(186,0,54,0.22)' }
                      : { background: '#fafbfc', border: '1px solid rgba(15,23,42,0.06)' }}>
                    <Heart size={13} fill={isSaved ? '#ba0036' : 'none'} /> {isSaved ? lt('saved') : lt('save')}
                  </button>
                  <button onClick={handleShare}
                    className="flex-1 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 text-slate-600 active:scale-95 transition-all"
                    style={{ background: '#fafbfc', border: '1px solid rgba(15,23,42,0.06)' }}>
                    <Share2 size={13} /> {lt('share')}
                  </button>
                </div>
              </div>

              {/* Safety Tips */}
              <div className="rounded-[1.5rem] p-5" style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)' }}>
                <h4 className="font-black text-amber-700 text-sm flex items-center gap-2 mb-3" style={{ fontFamily: 'Oxanium, sans-serif' }}>
                  <Shield size={15} className="text-amber-600" /> {lt('safetyTips')}
                </h4>
                <ul className="flex flex-col gap-2">
                  {['Never pay before visiting', 'Verify landlord identity', 'Get a written agreement', 'Use secure payment channels'].map((tip, i) => (
                    <li key={i} className="text-xs font-bold text-amber-700 flex items-start gap-2">
                      <CheckCircle2 size={12} className="text-amber-500 shrink-0 mt-0.5" /> {tip}
                    </li>
                  ))}
                </ul>
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* ── MOBILE: FLOATING BOTTOM ACTION CARD ── */}
      {/* Sits above the 64px MobileBottomNav so it is never hidden behind it */}
      <div className="lg:hidden fixed left-3 right-3 z-40"
        style={{
          bottom: 'calc(18px + env(safe-area-inset-bottom))',
        }}>
        <motion.div
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', damping: 24, stiffness: 280, delay: 0.15 }}
          className="rounded-[1.5rem] flex items-center gap-2.5 px-3 py-2.5"
          style={{
            background: 'rgba(255,255,255,0.97)',
            backdropFilter: 'blur(22px) saturate(180%)',
            WebkitBackdropFilter: 'blur(22px) saturate(180%)',
            border: '1px solid rgba(15,23,42,0.08)',
            boxShadow: '0 12px 36px rgba(15,23,42,0.14), 0 4px 12px rgba(186,0,54,0.06), inset 0 1px 0 rgba(255,255,255,0.7)',
          }}>
          <div className="flex-1 min-w-0 pl-1">
            <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest leading-none">
              {property.intent === 'purchase' ? lt('salePrice') : lt('monthlyRent')}
            </p>
            <p className="text-base font-black text-slate-900 leading-tight mt-0.5 truncate" style={{ fontFamily: 'Oxanium, sans-serif' }}>
              ৳{Number(property.price).toLocaleString('en-IN')}
              {priceLabel && <span className="text-[10px] text-slate-500 font-bold ml-0.5">{priceLabel}</span>}
            </p>
            {landlord?.serviceCharge > 0 && (
              <p className="text-[9px] font-bold text-slate-500 mt-0.5">+ ৳{Number(landlord.serviceCharge).toLocaleString('en-IN')} SC</p>
            )}
          </div>
          <motion.button disabled={isUnavailable}
            whileTap={{ scale: 0.9 }}
            onClick={() => !isUnavailable && setActiveModal('call')}
            aria-label={lt('call')}
            className={`w-11 h-11 shrink-0 rounded-2xl flex items-center justify-center transition-colors ${isUnavailable ? 'opacity-30 cursor-not-allowed' : 'text-emerald-700'}`}
            style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)' }}>
            <Phone size={17} strokeWidth={2.4} />
          </motion.button>
          <motion.button disabled={isUnavailable}
            whileTap={{ scale: 0.96 }}
            onClick={() => !isUnavailable && requireAuthFor(() => setShowInquiry(true))}
            className={`shrink-0 px-4 py-3 rounded-2xl font-black text-[13px] flex items-center justify-center gap-1.5 transition-colors ${isUnavailable ? 'opacity-40 cursor-not-allowed text-slate-500' : 'text-white cyber-btn'}`}
            style={isUnavailable ? { background: '#f1f5f9' } : { background: 'linear-gradient(135deg, #ba0036 0%, #7c0026 100%)', boxShadow: '0 8px 22px rgba(186,0,54,0.30)' }}>
            <MessageCircle size={15} strokeWidth={2.5} /> {isUnavailable ? lt('notAvailable') : lt('inquireNow')}
          </motion.button>
        </motion.div>
      </div>

      {/* ── CALL / MESSAGE MODALS ── */}
      <AnimatePresence>
        {activeModal && (
          <motion.div
            className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4"
            style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(6px)' }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setActiveModal(null)}>
            <motion.div
              className="w-full sm:max-w-sm shadow-2xl overflow-hidden relative p-8 text-center rounded-t-[2.5rem] sm:rounded-[2rem]"
              style={{ background: '#ffffff', border: '1px solid rgba(15,23,42,0.06)' }}
              initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}>
              <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-[#ba0036] to-transparent" />
              <div className="absolute top-3 left-1/2 -translate-x-1/2 w-10 h-1 rounded-full sm:hidden"
                style={{ background: 'rgba(15,23,42,0.12)' }} />
              <button onClick={() => setActiveModal(null)} aria-label="Close"
                className="absolute top-5 right-5 p-2 rounded-full transition-colors"
                style={{ background: '#f1f5f9' }}>
                <X size={18} className="text-slate-600" />
              </button>

              {activeModal === 'call' && (
                <>
                  <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5 relative mt-4"
                    style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)' }}>
                    <div className="absolute inset-0 bg-emerald-400/10 rounded-full animate-ping" />
                    <Phone size={32} className="text-emerald-600" />
                  </div>
                  <h3 className="text-2xl font-black text-slate-900 mb-2" style={{ fontFamily: 'Oxanium, sans-serif' }}>Call Landlord</h3>
                  <p className="text-slate-600 font-bold text-sm mb-2">Connect with <span className="text-[#ba0036]">{landlord.name}</span></p>
                  <p className="text-slate-400 text-xs font-bold mb-8">via TO-LET PRO Secure Line</p>
                  <button
                    onClick={() => { setActiveModal(null); navigate('/messages', { state: { peerUserId: landlord?.id, propertyId: property.id, mode: 'call' } }); }}
                    className="cyber-btn w-full text-white py-4 rounded-2xl font-black transition-all flex items-center justify-center gap-2"
                    style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', boxShadow: '0 8px 22px rgba(16,185,129,0.22)' }}>
                    <Phone size={18} /> Start Secure Call
                  </button>
                </>
              )}

              {activeModal === 'message' && (
                <>
                  <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5 mt-4"
                    style={{ background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.25)' }}>
                    <MessageSquare size={32} className="text-blue-600" />
                  </div>
                  <h3 className="text-2xl font-black text-slate-900 mb-2" style={{ fontFamily: 'Oxanium, sans-serif' }}>Send Message</h3>
                  <p className="text-slate-600 font-bold text-sm mb-8">Chat with <span className="text-[#ba0036]">{landlord.name}</span></p>
                  <button
                    onClick={() => { setActiveModal(null); navigate('/messages', { state: { peerUserId: landlord?.id, propertyId: property.id, mode: 'message' } }); }}
                    className="cyber-btn w-full text-white py-4 rounded-2xl font-black transition-all flex items-center justify-center gap-2"
                    style={{ background: 'linear-gradient(135deg, #ba0036 0%, #7c0026 100%)', boxShadow: '0 8px 22px rgba(186,0,54,0.22)' }}>
                    <MessageSquare size={18} /> Open Chat
                  </button>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── INQUIRY MODAL ── */}
      <InquiryModal isOpen={showInquiry} onClose={() => setShowInquiry(false)} property={property} landlord={landlord} />

      {/* ── PHOTO GRID MODAL ── */}
      <PhotoGridModal
        images={galleryImages}
        isOpen={showPhotoGrid}
        onClose={() => setShowPhotoGrid(false)}
        property={property}
        onPhotoClick={(src) => {
          setShowPhotoGrid(false);
          setFullscreenPhoto(src);
        }}
      />

      {/* ── FULLSCREEN PHOTO ── */}
      <FullscreenPhoto src={fullscreenPhoto} onClose={() => setFullscreenPhoto(null)} />

    </div>
  );
};

export default PropertyDetails;
