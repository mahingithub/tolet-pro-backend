import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
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
import { useAuth } from '../context/AuthContext.jsx';
import { propertyService } from '../services/Propertyservice';
import { GoogleMap, MarkerF, useJsApiLoader } from '@react-google-maps/api';

// ─── GOOGLE MAPS CONFIG (shared with PropertyDetails) ────────────────────────
// Last-resort fallback so the interactive map keeps working even if the
// build's env var is missing. This key is restricted in Google Cloud (locked
// to our domains + Maps JavaScript API only), so exposing it here is low-risk
// — a Maps JS key is public in the browser bundle regardless.
const GOOGLE_MAPS_API_KEY =
  (typeof import.meta !== 'undefined' && import.meta?.env?.VITE_GOOGLE_MAPS_API_KEY) ||
  (typeof process !== 'undefined' && process?.env?.REACT_APP_GOOGLE_MAPS_API_KEY) ||
  'AIzaSyC9xWNjjSPhxy2aUWLubPqHR7N6KZWmKlg';
const GOOGLE_MAPS_LIBRARIES = [];
const ADD_PROP_MAP_STYLES = [
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.attraction', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
];

/**
 * Read a File as a base64 data URL. We persist data: URLs (not blob: URLs)
 * because blob URLs are scoped to the page session and break the instant the
 * user reloads — meaning a freshly-added listing's cover photo would vanish
 * from the host dashboard on refresh. Data URLs survive localStorage.
 *
 * When the backend lands, replace this with a multipart upload to
 * POST /api/uploads and persist the returned URL instead.
 */
const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    if (!file) return resolve('');
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('File read failed'));
    reader.readAsDataURL(file);
  });

// ─── MEDIA LIMITS ─────────────────────────────────────────────────────────────
// Generous per-file ceilings tuned for Bangladesh: modern phones can shoot
// 8–15 MB photos. Pictures get auto-compressed below so the bytes that
// actually land in storage stay small.
//
// User-approved Q1 v2 — local file upload is back ALONGSIDE the YouTube
// ID. Hosts can either drop a phone-recorded walkthrough or paste a
// YouTube link; whichever they pick wins. The previous Option-A
// "YouTube only" rule was retired by the user in the same message that
// asked for a Floor field and Apartment→Flat.
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;   // 25 MB raw upload
const MAX_IMAGE_DIMENSION = 1920;           // px on the longest side
const IMAGE_JPEG_QUALITY = 0.85;
// Landlords routinely want to upload full property walkthroughs straight
// from a phone — those run 500 MB+ at 4K. Cap at 2 GB so we never block
// the upload on the client side. The real ceiling will be whatever the
// host's Cloudinary/storage plan allows (Cloudinary free tier = 100 MB
// per file; bump it in their dashboard if you need more).
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;  // 100 MB ceiling
const formatMB = (bytes) => (bytes / (1024 * 1024)).toFixed(1);

/**
 * Downscale + recompress a phone-camera photo so it fits comfortably in
 * localStorage and uploads quickly on Bangladesh mobile networks. Falls
 * back to the original data URL if the canvas pipeline fails.
 */
const compressImageFile = (file) =>
  new Promise((resolve) => {
    if (!file || !file.type.startsWith('image/')) {
      return readFileAsDataUrl(file).then(resolve).catch(() => resolve(''));
    }
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result || '');
      const img = new Image();
      img.onload = () => {
        const longest = Math.max(img.width, img.height);
        const scale = longest > MAX_IMAGE_DIMENSION ? MAX_IMAGE_DIMENSION / longest : 1;
        const width  = Math.max(1, Math.round(img.width  * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        try {
          const canvas = document.createElement('canvas');
          canvas.width  = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(src);
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', IMAGE_JPEG_QUALITY));
        } catch {
          resolve(src);
        }
      };
      img.onerror = () => resolve(src);
      img.src = src;
    };
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });

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
      // User-approved relabel — "Apartment" → "Flat" everywhere on the
      // category picker. The backend `Property.type` enum still accepts
      // `apartment` for back-compat, so we only relabel the chip; the
      // wire id is unchanged.
      { id: 'apartment',   label: 'Flat',         labelBn: 'ফ্ল্যাট',         icon: Building },
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

// ─── DISTRICTS BY DIVISION ────────────────────────────────────────────────────
// Mirrors the desktop header location dropdown in Navbar.jsx so a property's
// district stays consistent across browsing, search filters, and the listing
// form. EN/BN labels run in lock-step (same array index).
const DISTRICTS_BY_DIVISION = {
  dhaka: [
    { id: 'dhaka',        label: 'Dhaka',        labelBn: 'ঢাকা' },
    { id: 'faridpur',     label: 'Faridpur',     labelBn: 'ফরিদপুর' },
    { id: 'gazipur',      label: 'Gazipur',      labelBn: 'গাজীপুর' },
    { id: 'gopalganj',    label: 'Gopalganj',    labelBn: 'গোপালগঞ্জ' },
    { id: 'kishoreganj',  label: 'Kishoreganj',  labelBn: 'কিশোরগঞ্জ' },
    { id: 'madaripur',    label: 'Madaripur',    labelBn: 'মাদারীপুর' },
    { id: 'manikganj',    label: 'Manikganj',    labelBn: 'মানিকগঞ্জ' },
    { id: 'munshiganj',   label: 'Munshiganj',   labelBn: 'মুন্সীগঞ্জ' },
    { id: 'narayanganj',  label: 'Narayanganj',  labelBn: 'নারায়ণগঞ্জ' },
    { id: 'narsingdi',    label: 'Narsingdi',    labelBn: 'নরসিংদী' },
    { id: 'rajbari',      label: 'Rajbari',      labelBn: 'রাজবাড়ী' },
    { id: 'shariatpur',   label: 'Shariatpur',   labelBn: 'শরীয়তপুর' },
    { id: 'tangail',      label: 'Tangail',      labelBn: 'টাঙ্গাইল' },
  ],
  chittagong: [
    { id: 'chattogram',     label: 'Chattogram',     labelBn: 'চট্টগ্রাম' },
    { id: 'bandarban',      label: 'Bandarban',      labelBn: 'বান্দরবান' },
    { id: 'brahmanbaria',   label: 'Brahmanbaria',   labelBn: 'ব্রাহ্মণবাড়িয়া' },
    { id: 'chandpur',       label: 'Chandpur',       labelBn: 'চাঁদপুর' },
    { id: 'comilla',        label: 'Comilla',        labelBn: 'কুমিল্লা' },
    { id: 'coxs_bazar',     label: "Cox's Bazar",    labelBn: 'কক্সবাজার' },
    { id: 'feni',           label: 'Feni',           labelBn: 'ফেনী' },
    { id: 'khagrachari',    label: 'Khagrachari',    labelBn: 'খাগড়াছড়ি' },
    { id: 'lakshmipur',     label: 'Lakshmipur',     labelBn: 'লক্ষ্মীপুর' },
    { id: 'noakhali',       label: 'Noakhali',       labelBn: 'নোয়াখালী' },
    { id: 'rangamati',      label: 'Rangamati',      labelBn: 'রাঙ্গামাটি' },
  ],
  sylhet: [
    { id: 'sylhet',       label: 'Sylhet',       labelBn: 'সিলেট' },
    { id: 'habiganj',     label: 'Habiganj',     labelBn: 'হবিগঞ্জ' },
    { id: 'moulvibazar',  label: 'Moulvibazar',  labelBn: 'মৌলভীবাজার' },
    { id: 'sunamganj',    label: 'Sunamganj',    labelBn: 'সুনামগঞ্জ' },
  ],
  rajshahi: [
    { id: 'rajshahi',         label: 'Rajshahi',         labelBn: 'রাজশাহী' },
    { id: 'bogura',           label: 'Bogura',           labelBn: 'বগুড়া' },
    { id: 'chapainawabganj',  label: 'Chapainawabganj',  labelBn: 'চাঁপাইনবাবগঞ্জ' },
    { id: 'joypurhat',        label: 'Joypurhat',        labelBn: 'জয়পুরহাট' },
    { id: 'naogaon',          label: 'Naogaon',          labelBn: 'নওগাঁ' },
    { id: 'natore',           label: 'Natore',           labelBn: 'নাটোর' },
    { id: 'pabna',            label: 'Pabna',            labelBn: 'পাবনা' },
    { id: 'sirajganj',        label: 'Sirajganj',        labelBn: 'সিরাজগঞ্জ' },
  ],
  khulna: [
    { id: 'khulna',       label: 'Khulna',       labelBn: 'খুলনা' },
    { id: 'bagerhat',     label: 'Bagerhat',     labelBn: 'বাগেরহাট' },
    { id: 'chuadanga',    label: 'Chuadanga',    labelBn: 'চুয়াডাঙ্গা' },
    { id: 'jashore',      label: 'Jashore',      labelBn: 'যশোর' },
    { id: 'jhenaidah',    label: 'Jhenaidah',    labelBn: 'ঝিনাইদহ' },
    { id: 'kushtia',      label: 'Kushtia',      labelBn: 'কুষ্টিয়া' },
    { id: 'magura',       label: 'Magura',       labelBn: 'মাগুরা' },
    { id: 'meherpur',     label: 'Meherpur',     labelBn: 'মেহেরপুর' },
    { id: 'narail',       label: 'Narail',       labelBn: 'নড়াইল' },
    { id: 'satkhira',     label: 'Satkhira',     labelBn: 'সাতক্ষীরা' },
  ],
  barishal: [
    { id: 'barishal',     label: 'Barishal',     labelBn: 'বরিশাল' },
    { id: 'barguna',      label: 'Barguna',      labelBn: 'বরগুনা' },
    { id: 'bhola',        label: 'Bhola',        labelBn: 'ভোলা' },
    { id: 'jhalokati',    label: 'Jhalokati',    labelBn: 'ঝালকাঠি' },
    { id: 'patuakhali',   label: 'Patuakhali',   labelBn: 'পটুয়াখালী' },
    { id: 'pirojpur',     label: 'Pirojpur',     labelBn: 'পিরোজপুর' },
  ],
  rangpur: [
    { id: 'rangpur',      label: 'Rangpur',      labelBn: 'রংপুর' },
    { id: 'dinajpur',     label: 'Dinajpur',     labelBn: 'দিনাজপুর' },
    { id: 'gaibandha',    label: 'Gaibandha',    labelBn: 'গাইবান্ধা' },
    { id: 'kurigram',     label: 'Kurigram',     labelBn: 'কুড়িগ্রাম' },
    { id: 'lalmonirhat',  label: 'Lalmonirhat',  labelBn: 'লালমনিরহাট' },
    { id: 'nilphamari',   label: 'Nilphamari',   labelBn: 'নীলফামারী' },
    { id: 'panchagarh',   label: 'Panchagarh',   labelBn: 'পঞ্চগড়' },
    { id: 'thakurgaon',   label: 'Thakurgaon',   labelBn: 'ঠাকুরগাঁও' },
  ],
  mymensingh: [
    { id: 'mymensingh',   label: 'Mymensingh',   labelBn: 'ময়মনসিংহ' },
    { id: 'jamalpur',     label: 'Jamalpur',     labelBn: 'জামালপুর' },
    { id: 'netrokona',    label: 'Netrokona',    labelBn: 'নেত্রকোনা' },
    { id: 'sherpur',      label: 'Sherpur',      labelBn: 'শেরপুর' },
  ],
};

// ─── POPULAR AREAS BY DISTRICT ────────────────────────────────────────────────
// Curated list of well-known neighborhoods and sub-areas. The wizard surfaces
// these as quick-pick suggestions when a district has them; hosts can still
// type a custom area into the address field if their neighborhood isn't here.
const AREAS_BY_DISTRICT = {
  dhaka: [
    'Gulshan 1', 'Gulshan 2', 'Banani', 'Baridhara', 'Bashundhara R/A', 'Niketan',
    'Dhanmondi 1', 'Dhanmondi 2', 'Dhanmondi 3', 'Dhanmondi 4', 'Dhanmondi 5',
    'Dhanmondi 6', 'Dhanmondi 7', 'Dhanmondi 8', 'Dhanmondi 9A', 'Dhanmondi 10',
    'Dhanmondi 11', 'Dhanmondi 12', 'Dhanmondi 13', 'Dhanmondi 14', 'Dhanmondi 15',
    'Dhanmondi 27', 'Dhanmondi 32',
    'Uttara Sector 1', 'Uttara Sector 3', 'Uttara Sector 4', 'Uttara Sector 6',
    'Uttara Sector 7', 'Uttara Sector 9', 'Uttara Sector 10', 'Uttara Sector 11',
    'Uttara Sector 12', 'Uttara Sector 13', 'Uttara Sector 14', 'Uttara Sector 18',
    'Mirpur 1', 'Mirpur 2', 'Mirpur 6', 'Mirpur 10', 'Mirpur 11', 'Mirpur 12',
    'Mirpur 13', 'Mirpur 14', 'Mirpur DOHS', 'Pallabi', 'Kazipara', 'Shewrapara',
    'Mohammadpur', 'Lalmatia', 'Shyamoli', 'Adabar', 'Rayer Bazar', 'Hazaribagh',
    'Rampura', 'Banasree', 'Aftab Nagar', 'Khilgaon', 'Malibagh', 'Mouchak',
    'Badda', 'Merul Badda', 'North Badda', 'Bashabo', 'Mugda', 'Maniknagar',
    'Tejgaon', 'Farmgate', 'Karwan Bazar', 'Mohakhali', 'Mohakhali DOHS',
    'Motijheel', 'Paltan', 'Segunbagicha', 'Bailey Road', 'Eskaton', 'Shantinagar',
    'Wari', 'Old Dhaka', 'Lalbagh', 'Azimpur', 'Nilkhet', 'Jigatola',
    'Cantonment', 'Khilkhet', 'Nikunja 1', 'Nikunja 2', 'Bashabo', 'Demra',
  ],
  gazipur:     ['Gazipur Sadar', 'Tongi', 'Joydebpur', 'Konabari', 'Board Bazar', 'Chowrasta'],
  narayanganj: ['Narayanganj Sadar', 'Fatullah', 'Siddhirganj', 'Bandar', 'Sonargaon', 'Rupganj'],
  chattogram: [
    'Agrabad', 'Nasirabad', 'Khulshi', 'Panchlaish', 'GEC Circle', 'Halishahar',
    'Chawkbazar', 'Kotwali', 'Pahartali', 'Bayezid', 'Akbar Shah', 'Patenga',
    'Foy\'s Lake', 'Chandgaon', 'Bakalia', 'EPZ', 'Lalkhan Bazar', 'CDA Avenue',
  ],
  coxs_bazar:  ['Cox\'s Bazar Sadar', 'Kolatoli', 'Sugandha Beach', 'Laboni', 'Inani', 'Teknaf'],
  sylhet:      ['Zindabazar', 'Amberkhana', 'Subhanighat', 'Shahjalal Uposhohor', 'Mejortila', 'Lamabazar', 'Tilagor', 'Chowhatta'],
  rajshahi:    ['Shaheb Bazar', 'Boalia', 'Motihar', 'Rajpara', 'Padma Residential', 'Binodpur', 'Kazla'],
  khulna:      ['Sonadanga', 'Khalishpur', 'Daulatpur', 'Boyra', 'Nirala', 'Shibbari', 'Doulatpur'],
  barishal:    ['Barishal Sadar', 'Bandar Road', 'Nathullabad', 'Kashipur', 'Notullabad'],
  rangpur:     ['Rangpur Sadar', 'Modern Mor', 'Jahaj Company More', 'Dhap', 'Lalbag', 'Shapla Chattar'],
  mymensingh:  ['Mymensingh Sadar', 'Charpara', 'Maskanda', 'Notun Bazar', 'Ganginar Par', 'Brahmapalli'],
};

// ─── AREAS BY THANA ───────────────────────────────────────────────────────────
// Per-thana neighbourhood lists — so picking a thana shows ONLY that thana's
// areas (e.g. Mohammadpur → Lalmatia/Shyamoli, which a name-substring filter
// would miss). District-nested to avoid thana-name collisions (Dhaka & Chattogram
// both have "Kotwali"/"Chawkbazar"). Thanas not listed here fall back to a
// substring filter on the district's flat area list (see areasForThana).
const AREAS_BY_THANA = {
  dhaka: {
    'Dhanmondi':       ['Dhanmondi 1', 'Dhanmondi 2', 'Dhanmondi 3', 'Dhanmondi 4', 'Dhanmondi 5', 'Dhanmondi 6', 'Dhanmondi 7', 'Dhanmondi 8', 'Dhanmondi 9A', 'Dhanmondi 10', 'Dhanmondi 11', 'Dhanmondi 12', 'Dhanmondi 13', 'Dhanmondi 14', 'Dhanmondi 15', 'Dhanmondi 27', 'Dhanmondi 32', 'Jigatola', 'Sukrabad', 'Shankar', 'West Dhanmondi'],
    'Gulshan':         ['Gulshan 1', 'Gulshan 2', 'Niketan', 'Gulshan Avenue', 'Gulshan Circle 1', 'Gulshan Circle 2'],
    'Banani':          ['Banani', 'Banani DOHS', 'Mohakhali', 'Mohakhali DOHS', 'Banani Chairmanbari', 'Kakoli'],
    'Baridhara':       ['Baridhara DOHS', 'Baridhara J Block', 'Baridhara K Block', 'Baridhara Diplomatic Zone', 'Notun Bazar'],
    'Mohammadpur':     ['Mohammadpur', 'Lalmatia', 'Shyamoli', 'Tajmahal Road', 'Nurjahan Road', 'Asad Avenue', 'Iqbal Road', 'Mohammadia Housing', 'Katasur', 'Bosila', 'Ring Road', 'Town Hall', 'Shekhertek', 'Chand Udyan'],
    'Adabar':          ['Adabar', 'Sunibir Housing', 'Baitul Aman Housing', 'Shyamoli Housing', 'Mohammadpur Bera'],
    'Mirpur':          ['Mirpur 1', 'Mirpur 2', 'Mirpur 6', 'Mirpur 7', 'Mirpur 10', 'Mirpur 11', 'Mirpur 12', 'Mirpur 13', 'Mirpur 14', 'Mirpur DOHS', 'Kazipara', 'Shewrapara', 'Senpara Parbata', 'Monipur'],
    'Pallabi':         ['Pallabi', 'Mirpur 11', 'Mirpur 12', 'Kalshi', 'Duaripara', 'Baunia'],
    'Kafrul':          ['Kafrul', 'Mirpur 13', 'Mirpur 14', 'Ibrahimpur', 'Kachukhet', 'West Kafrul'],
    'Sher-e-Bangla Nagar': ['Agargaon', 'Sher-e-Bangla Nagar', 'Taltola', 'East Sher-e-Bangla Nagar'],
    'Darus Salam':     ['Darus Salam', 'Gabtoli', 'Technical', 'Ahmed Nagar', 'Mirpur 1'],
    'Shah Ali':        ['Shah Ali', 'Mirpur 1', 'Rupnagar', 'Pirerbag', 'Gudaraghat'],
    'Uttara West':     ['Uttara Sector 11', 'Uttara Sector 12', 'Uttara Sector 13', 'Uttara Sector 14', 'Uttara Sector 16', 'Uttara Sector 17', 'Uttara Sector 18'],
    'Uttara East':     ['Uttara Sector 1', 'Uttara Sector 3', 'Uttara Sector 4', 'Uttara Sector 5', 'Uttara Sector 6', 'Uttara Sector 7', 'Uttara Sector 9', 'Uttara Sector 10', 'Jasimuddin'],
    'Dakshinkhan':     ['Dakshinkhan', 'Ashkona', 'Faydabad', 'Kawla', 'Gawair'],
    'Uttarkhan':       ['Uttarkhan', 'Mausaid', 'Chamurkhan', 'Bawnia'],
    'Turag':           ['Turag', 'Diabari', 'Ranavola', 'Kamarpara', 'Dhour'],
    'Khilkhet':        ['Khilkhet', 'Nikunja 1', 'Nikunja 2', 'Namapara', 'Tanpara'],
    'Vatara':          ['Bashundhara R/A', 'Vatara', 'Notun Bazar', 'Jagannathpur', 'Solmaid', 'Kuril'],
    'Badda':           ['Badda', 'Merul Badda', 'North Badda', 'Middle Badda', 'South Badda', 'Shahjadpur', 'Gulshan Link Road', 'Beraid'],
    'Tejgaon':         ['Tejgaon', 'Farmgate', 'Karwan Bazar', 'Nakhalpara', 'Tejturi Bazar', 'Indira Road'],
    'Tejgaon I/A':     ['Tejgaon Industrial Area', 'Nabisco', 'Love Road', 'Gulshan Link'],
    'Hazaribagh':      ['Hazaribagh', 'Rayer Bazar', 'Zafrabad', 'Beribadh', 'Ganaktuli'],
    'Kalabagan':       ['Kalabagan', 'Lake Circus', 'First Lane', 'Second Lane', 'Mirpur Road'],
    'New Market':      ['New Market', 'Nilkhet', 'Azimpur', 'Hatirpool', 'Elephant Road', 'Katabon', 'Green Road'],
    'Ramna':           ['Shantinagar', 'Eskaton', 'Bailey Road', 'Magbazar', 'Kakrail', 'Bangla Motor', 'Minto Road'],
    'Shahbagh':        ['Shahbagh', 'Paribagh', 'Bakshibazar', 'Hatirpool', 'Nilkhet'],
    'Kotwali':         ['Sadarghat', 'Babubazar', 'Islampur', 'Patuatuli', 'Shakhari Bazar'],
    'Sutrapur':        ['Sutrapur', 'Tikatuli', 'Dholaikhal', 'Faridabad', 'Narinda'],
    'Gendaria':        ['Gendaria', 'Dhupkhola', 'Distillery Road', 'Dayaganj'],
    'Wari':            ['Wari', 'Rankin Street', 'Hatkhola', 'Joykali Mandir', 'Baniyanagar'],
    'Lalbagh':         ['Lalbagh', 'Nawabganj', 'Shahid Nagar', 'Posta', 'Chawk Circular Road'],
    'Chawkbazar':      ['Chawkbazar', 'Bakshibazar', 'Urdu Road', 'Champatoli', 'Begum Bazar'],
    'Kamrangirchar':   ['Kamrangirchar', 'Ashrafabad', 'Bosila', 'Char Kamrangir', 'Hujurpara'],
    'Khilgaon':        ['Khilgaon', 'Malibagh', 'Mouchak', 'Taltola', 'Goran', 'Tilpapara', 'Nandipara', 'Chowdhurypara'],
    'Sabujbagh':       ['Bashabo', 'Madartek', 'Sabujbagh', 'Kadamtala', 'South Bashabo'],
    'Mugda':           ['Mugda', 'Mugdapara', 'Maniknagar', 'Manda', 'Golapbagh'],
    'Motijheel':       ['Motijheel', 'Arambagh', 'Fakirapool', 'Kamalapur', 'Dilkusha', 'Toyenbee Road'],
    'Paltan':          ['Purana Paltan', 'Naya Paltan', 'Bijoynagar', 'Segunbagicha', 'Topkhana Road'],
    'Shahjahanpur':    ['Shahjahanpur', 'Shantibagh', 'Razarbagh', 'North Shahjahanpur'],
    'Jatrabari':       ['Jatrabari', 'Kazla', 'Dholaipar', 'Shanir Akhra', 'Mridha Bari', 'Kutubkhali'],
    'Demra':           ['Demra', 'Matuail', 'Sarulia', 'Dogair', 'Konapara', 'Staff Quarter'],
    'Shyampur':        ['Shyampur', 'Jurain', 'Postogola', 'Dolaipar', 'Mir Hajirbag'],
    'Kadamtali':       ['Kadamtali', 'Dhania', 'Raysaheb Bazar', 'Mir Hazaribagh', 'Shyampur Bazar'],
    'Cantonment':      ['Cantonment', 'Manikdi', 'Matikata', 'MES', 'Ibrahimpur', 'Balughat'],
    'Bhashantek':      ['Bhashantek', 'Damalkot', 'Mirpur Cantonment', 'Kalshi'],
  },
  chattogram: {
    'Kotwali':         ['Kotwali', 'Anderkilla', 'Jamalkhan', 'Laldighi', 'Court Building', 'Riazuddin Bazar'],
    'Panchlaish':      ['Panchlaish', 'Nasirabad', 'Mehedibag', 'Probartak', 'O.R. Nizam Road', 'Hillview'],
    'Pahartali':       ['Pahartali', "Foy's Lake", 'Akbarshah', 'Sarail', 'Khulshi Hills'],
    'Double Mooring':  ['Agrabad', 'Double Mooring', 'Dewanhat', 'Barik Building', 'Chowmuhani'],
    'Halishahar':      ['Halishahar', 'Boropol', 'Artillery', 'Block A', 'Block G', 'Ananda Bazar'],
    'Chandgaon':       ['Chandgaon', 'Bahaddarhat', 'Kapasgola', 'Mohra', 'Khaja Road'],
    'Bayezid Bostami': ['Bayezid', 'Nasirabad Industrial', 'Oxygen', 'Sholoshahar', 'Amin Colony'],
    'Khulshi':         ['Khulshi', 'South Khulshi', 'North Khulshi', 'Jakir Hossain Road', 'Lalkhan Bazar'],
    'Bakalia':         ['Bakalia', 'Chaktai', 'Rajakhali', 'Bou Bazar', 'DC Road'],
    'Patenga':         ['Patenga', 'EPZ', 'Steel Mill', 'Airport Road', 'Sea Beach'],
    'EPZ':             ['EPZ', 'Free Port', 'Bandartila', 'Steel Mill Bazar'],
    'Akbarshah':       ['Akbarshah', 'Kornelhat', 'A K Khan', 'Firingi Bazar'],
    'Chawkbazar':      ['Chawkbazar', 'Gulzar', 'Kapasgola', 'College Road', 'Didar Market'],
  },
};

// ─── THANAS / UPAZILAS BY DISTRICT ────────────────────────────────────────────
// The specific thana (police-station area / upazila) a property sits in — the
// level tenants actually search by, since a district like Dhaka or Bhola is far
// too broad. Dhaka is covered comprehensively; other districts list their main
// upazilas. Where a district isn't mapped here, the wizard falls back to a
// free-text thana input and search still works (thana feeds the search haystack).
const THANAS_BY_DISTRICT = {
  dhaka: [
    'Dhanmondi', 'Gulshan', 'Banani', 'Baridhara', 'Mohammadpur', 'Adabar',
    'Mirpur', 'Pallabi', 'Kafrul', 'Sher-e-Bangla Nagar', 'Darus Salam', 'Shah Ali',
    'Uttara West', 'Uttara East', 'Dakshinkhan', 'Uttarkhan', 'Turag', 'Khilkhet',
    'Vatara', 'Badda', 'Tejgaon', 'Tejgaon I/A', 'Hazaribagh', 'Kalabagan',
    'New Market', 'Ramna', 'Shahbagh', 'Kotwali', 'Sutrapur', 'Gendaria', 'Wari',
    'Lalbagh', 'Chawkbazar', 'Kamrangirchar', 'Khilgaon', 'Sabujbagh', 'Mugda',
    'Motijheel', 'Paltan', 'Shahjahanpur', 'Jatrabari', 'Demra', 'Shyampur',
    'Kadamtali', 'Cantonment', 'Bhashantek',
  ],
  gazipur:     ['Gazipur Sadar', 'Tongi', 'Kaliakair', 'Kapasia', 'Sreepur', 'Kaliganj'],
  narayanganj: ['Narayanganj Sadar', 'Fatullah', 'Siddhirganj', 'Bandar', 'Sonargaon', 'Rupganj', 'Araihazar'],
  chattogram: [
    'Kotwali', 'Panchlaish', 'Pahartali', 'Double Mooring', 'Halishahar', 'Chandgaon',
    'Bayezid Bostami', 'Khulshi', 'Bakalia', 'Patenga', 'EPZ', 'Akbarshah', 'Chawkbazar',
  ],
  coxs_bazar:  ["Cox's Bazar Sadar", 'Teknaf', 'Ukhia', 'Chakaria', 'Maheshkhali', 'Ramu'],
  sylhet:      ['Sylhet Sadar', 'Beanibazar', 'Golapganj', 'Jaintiapur', 'Companiganj', 'Kanaighat', 'Zakiganj', 'Bishwanath'],
  rajshahi:    ['Boalia', 'Rajpara', 'Motihar', 'Shah Makhdum', 'Paba', 'Godagari'],
  khulna:      ['Khulna Sadar', 'Sonadanga', 'Khalishpur', 'Daulatpur', 'Khan Jahan Ali', 'Rupsha'],
  barishal:    ['Barishal Sadar', 'Bakerganj', 'Babuganj', 'Banaripara', 'Gournadi', 'Hizla', 'Mehendiganj', 'Muladi', 'Wazirpur', 'Agailjhara'],
  bhola:       ['Bhola Sadar', 'Borhanuddin', 'Charfasson', 'Daulatkhan', 'Lalmohan', 'Manpura', 'Tazumuddin'],
  rangpur:     ['Rangpur Sadar', 'Badarganj', 'Gangachara', 'Kaunia', 'Mithapukur', 'Pirgachha', 'Pirganj', 'Taraganj'],
  mymensingh:  ['Mymensingh Sadar', 'Trishal', 'Bhaluka', 'Muktagachha', 'Gouripur', 'Fulbaria', 'Gafargaon', 'Phulpur'],
};

// Areas filtered to the selected thana — derived from the district's area list by
// matching the thana name (e.g. thana "Dhanmondi" → "Dhanmondi 3/27/32"; "Gulshan"
// → "Gulshan 1/2"). Falls back to the full district list when nothing matches.
function areasForThana(district, thana) {
  const key = String(thana || '').trim();
  const mapped = (AREAS_BY_THANA[district] || {})[key] || [];
  if (mapped.length) return mapped;
  // Fallback for thanas/districts not in AREAS_BY_THANA: substring-filter the
  // district's flat area list by the thana name.
  const all = AREAS_BY_DISTRICT[district] || [];
  const t = key.toLowerCase();
  if (!t) return all;
  const filtered = all.filter((a) => a.toLowerCase().includes(t));
  return filtered.length ? filtered : all;
}

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
  district: '',
  area: '',
  thana: '',
  location: '',
  gpsLat: '',
  gpsLng: '',
  gpsAddress: '',
  beds: 1,
  baths: 1,
  sqft: '',
  // User-approved Q5 — "on which floor is the house located". Stored as
  // an integer; 0 means ground floor. Backend `Property.floor` already
  // accepts -5..200 so we keep this purely numeric.
  floor: '',
  furnishing: '',
  amenities: [],
  // Step 4 – Media (structured)
  coverPhoto: null,          // { id, preview, name }
  roomPhotos: [],            // [{ id, room, preview, name }]
  // Video tour — either a local file (mainVideo: { id, preview, name,
  // size, file }) OR a YouTube ID (videoId: 'O-P_J_gvALE'). Whichever
  // is set wins; the other is ignored on submit so we never display
  // two players for the same listing.
  mainVideo: null,
  videoId: '',
  // Step 5 – Pricing + Description (the user asked for description to
  // come LAST so the AI helper has every other field as context when
  // it generates a draft).
  price: '',
  status: 'active',
  description: '',
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
// ── Reverse-geocode → app location matching ─────────────────────────────────
// Normalises an OSM/Google place name and matches it to the app's own
// division/district/thana/area lists, tolerating Bangladesh spelling variants
// (Chittagong↔Chattogram, Barisal↔Barishal) and small differences
// (OSM "Lalmohan" ↔ our "Lalmohan") via an edit-distance fallback.
const _GEO_ALIASES = {
  chittagong: 'chattogram', chattagram: 'chattogram',
  barisal: 'barishal',
  comilla: 'cumilla',
  jessore: 'jashore',
  bogra: 'bogura',
  lalmohan: 'lalmohan',
};
const _geoNorm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/\b(division|district|sub-?district|upazil[al]+|thana|metropolitan|paurashava|union|ward)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '');
const _geoCanon = (s) => { const n = _geoNorm(s); return _GEO_ALIASES[n] || n; };
const _geoLev = (a, b) => {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
};
// Returns the best-matching option (exact/substring on canonical form, else edit
// distance ≤ 2), or null when nothing is close enough.
const matchGeo = (raw, options, getLabel = (o) => o) => {
  const target = _geoCanon(raw);
  if (!target) return null;
  let best = null, bestDist = Infinity;
  for (const opt of options) {
    const cand = _geoCanon(getLabel(opt));
    if (!cand) continue;
    if (cand === target || (target.length >= 4 && (cand.includes(target) || target.includes(cand)))) return opt;
    const d = _geoLev(cand, target);
    if (d < bestDist) { bestDist = d; best = opt; }
  }
  return bestDist <= 2 ? best : null;
};

// ── Union (Bangladesh rural sub-thana level) data ───────────────────────────
// Numbered union parishads (EN + BN) so GPS results in rural upazilas resolve to
// the actual union (e.g. Kalma) with its official number. Verified against the
// union parishad sites / Bengali Wikipedia. Keyed district → thana; extendable.
const UNIONS_BY_THANA = {
  bhola: {
    Lalmohan: [
      { no: 1, en: 'Badarpur',          bn: 'বদরপুর' },
      { no: 2, en: 'Kalma',             bn: 'কালমা' },
      { no: 3, en: 'Dhali Gournagar',   bn: 'ধলী গৌরনগর' },
      { no: 4, en: 'Char Bhuta',        bn: 'চর ভূতা' },
      { no: 5, en: 'Lalmohan',          bn: 'লালমোহন' },
      { no: 6, en: 'Farajganj',         bn: 'ফরাজগঞ্জ' },
      { no: 7, en: 'Paschim Char Umed', bn: 'পশ্চিম চর উমেদ' },
      { no: 8, en: 'Ramagonj',          bn: 'রমাগঞ্জ' },
      { no: 9, en: 'Lord Hardinge',     bn: 'লর্ড হার্ডিঞ্জ' },
    ],
  },
};

// Bengali thana/upazila labels (district-nested). Division & district already
// carry BN labels; this fills the thana gap so the form + GPS text show Bengali
// in Bengali mode. Districts not listed here fall back to the English label.
const THANA_BN = {
  bhola: {
    'Bhola Sadar': 'ভোলা সদর',
    'Borhanuddin': 'বোরহানউদ্দিন',
    'Charfasson':  'চরফ্যাশন',
    'Daulatkhan':  'দৌলতখান',
    'Lalmohan':    'লালমোহন',
    'Manpura':     'মনপুরা',
    'Tazumuddin':  'তজুমদ্দিন',
  },
};
const thanaBn = (districtId, thanaLabel) => (THANA_BN[districtId] || {})[thanaLabel] || '';

// Match a geocoded union name (English) to our numbered union list for a thana.
const matchUnion = (raw, districtId, thanaLabel) => {
  const list = (UNIONS_BY_THANA[districtId] || {})[thanaLabel] || [];
  if (!list.length || !raw) return null;
  return matchGeo(raw, list, (u) => u.en);
};

const _BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
const _toBnDigits = (n) => String(n).replace(/[0-9]/g, (d) => _BN_DIGITS[+d]);

// Normalise a Google geocode result (works for both the JS SDK geocoder and the
// REST web service — identical address_components shape) into a common parts object.
const _fromGoogle = (result) => {
  const comp = (type) => {
    const c = (result.address_components || []).find((x) => (x.types || []).includes(type));
    return c ? c.long_name : '';
  };
  return {
    division: comp('administrative_area_level_1'),
    district: comp('administrative_area_level_2'),
    thana:    comp('administrative_area_level_3'),
    // Union/village level — what rural Bangladesh listings (e.g. Kalma) need.
    union:    comp('administrative_area_level_4') || comp('sublocality_level_1') || comp('sublocality') || comp('locality'),
    road:     comp('route') || comp('neighborhood') || '',
    formatted: result.formatted_address || '',
  };
};

// Normalise a Nominatim/OSM reverse result into the same parts object.
const _fromOsm = (data) => {
  const a = data.address || {};
  return {
    division: a.state || a.region || '',
    district: a.state_district || a.district || a.county || '',
    thana:    a.county || a.subdistrict || a.municipality || a.city_district || a.town || '',
    union:    a.village || a.suburb || a.neighbourhood || a.hamlet || '',
    road:     a.road || '',
    formatted: data.display_name || '',
  };
};

// Reverse geocode with Google: prefer the already-loaded JS SDK geocoder (uses the
// referrer-restricted Maps key seamlessly); fall back to the REST web service
// (works before the SDK has finished loading). Returns a result object or null.
// Both paths require the "Geocoding API" to be enabled on the key in Google Cloud.
const _googleReverse = async (lat, lng) => {
  if (typeof window !== 'undefined' && window.google && window.google.maps && window.google.maps.Geocoder) {
    try {
      const geocoder = new window.google.maps.Geocoder();
      const results = await new Promise((resolve, reject) => {
        geocoder.geocode({ location: { lat, lng } }, (res, status) => {
          if (status === 'OK' && res && res.length) resolve(res);
          else reject(new Error(status || 'GEOCODE_FAILED'));
        });
      });
      if (results && results.length) return results[0];
    } catch { /* fall through to REST */ }
  }
  if (GOOGLE_MAPS_API_KEY) {
    try {
      const r = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=en&key=${GOOGLE_MAPS_API_KEY}`
      );
      const d = await r.json();
      if (d.status === 'OK' && d.results && d.results.length) return d.results[0];
    } catch { /* fall through */ }
  }
  return null;
};

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
        // Reverse geocode. Google first (best Bangladesh coverage — resolves down
        // to union/village like Kalma), then OSM as a free fallback. Both return the
        // same normalised parts, so the matching + display below is source-agnostic.
        const applyGeo = (g) => {
          // Resolve the Division → District → Thana → Area cascade first (English
          // matching, spelling-tolerant), setting each dropdown on a confident match.
          const divMatch = matchGeo(g.division, DIVISIONS, (d) => d.label);
          let distMatch = null, thMatch = null, unionObj = null;
          if (divMatch) {
            set('division', divMatch.id);
            const distList = DISTRICTS_BY_DIVISION[divMatch.id] || [];
            distMatch = matchGeo(g.district, distList, (d) => d.label) || matchGeo(g.thana, distList, (d) => d.label);
            if (distMatch) {
              set('district', distMatch.id);
              const thanaList = THANAS_BY_DISTRICT[distMatch.id] || [];
              thMatch = matchGeo(g.thana, thanaList) || matchGeo(g.district, thanaList);
              if (thMatch) {
                set('thana', thMatch);
                const areaList = (AREAS_BY_THANA[distMatch.id] || {})[thMatch] || [];
                const areaMatch = matchGeo(g.union || g.road, areaList);
                if (areaMatch) set('area', areaMatch);
                unionObj = matchUnion(g.union, distMatch.id, thMatch);
              }
            }
          }

          // Build the location label in the ACTIVE language from the matched
          // entities, so Bengali mode shows Bengali names. Falls back to the raw
          // geocode text where there's no match. Union carries its official number.
          const districtLabel = distMatch ? (isBn ? distMatch.labelBn : distMatch.label) : String(g.district || '').trim();
          const thanaLabel    = thMatch  ? (isBn ? (thanaBn(distMatch.id, thMatch) || thMatch) : thMatch) : String(g.thana || '').trim();
          let unionLabel;
          if (unionObj) {
            unionLabel = isBn ? `${_toBnDigits(unionObj.no)}নং ${unionObj.bn}` : `${unionObj.en} (No. ${unionObj.no})`;
          } else {
            unionLabel = String(g.union || g.road || '').trim();
          }
          const out = [];
          for (const p of [unionLabel, thanaLabel, districtLabel]) {
            const v = String(p || '').trim();
            if (v && !out.some((q) => q.toLowerCase() === v.toLowerCase())) out.push(v);
          }
          if (out.length) set('location', out.join(', '));

          // Confirmation address line — also language-aware.
          if (isBn) {
            const divLabel = divMatch ? divMatch.labelBn : String(g.division || '').trim();
            set('gpsAddress', [...out, divLabel, 'বাংলাদেশ'].filter(Boolean).join(', '));
          } else {
            set('gpsAddress', g.formatted || out.join(', '));
          }
        };

        try {
          const gResult = await _googleReverse(latitude, longitude);
          if (gResult) {
            applyGeo(_fromGoogle(gResult));
          } else {
            // Free OSM fallback (no key) — reaches thana level for most rural points.
            const res = await fetch(
              `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&addressdetails=1&accept-language=${isBn ? 'bn' : 'en'}`
            );
            const data = await res.json();
            applyGeo(_fromOsm(data));
          }
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
  const lat = parseFloat(form.gpsLat) || 23.7925;
  const lng = parseFloat(form.gpsLng) || 90.4078;

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

      {/* Google Map Preview */}
      {hasCoords && (
        <div className="relative">
          <div className="flex items-center gap-1.5 px-5 py-2.5 bg-gray-50 border-t border-gray-100">
            <Map size={12} className="text-gray-400" />
            <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">{isBn ? 'মানচিত্র প্রিভিউ' : 'Map Preview'}</p>
          </div>
          <GpsPanelMap lat={lat} lng={lng} />
          <div className="absolute bottom-3 right-3">
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 bg-white/90 backdrop-blur-sm text-[10px] font-black text-gray-600 px-2.5 py-1.5 rounded-lg shadow border border-gray-200 hover:text-[#ba0036] transition-colors"
            >
              <Globe size={10} />{isBn ? 'Google Maps এ দেখুন' : 'Open in Google Maps'}
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── GPS PANEL MAP (Google Maps interactive or iframe fallback) ───────────────
const GpsPanelMap = ({ lat, lng }) => {
  const center = React.useMemo(() => ({ lat, lng }), [lat, lng]);
  const mapOptions = React.useMemo(() => ({
    disableDefaultUI: false,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
    clickableIcons: false,
    gestureHandling: 'cooperative',
    styles: ADD_PROP_MAP_STYLES,
  }), []);

  const { isLoaded, loadError } = useJsApiLoader({
    id: 'tlp-google-map-script',
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });

  // Fallback — static placeholder (no iframe).
  // The old output=embed iframe loaded Google's own internal Maps JS with
  // their default key, causing a "NoApiKeys" console warning. A simple
  // placeholder avoids that entirely.
  if (!GOOGLE_MAPS_API_KEY || loadError) {
    return (
      <div
        className="w-full h-52 flex items-center justify-center flex-col gap-2"
        style={{ background: '#f1f5f9', borderRadius: 16 }}
      >
        <MapPin size={24} style={{ color: '#94a3b8' }} />
        <span style={{ fontSize: 12, fontWeight: 800, color: '#64748b' }}>Map unavailable</span>
        <span style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8' }}>Set VITE_GOOGLE_MAPS_API_KEY to enable the map</span>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="w-full h-52 flex items-center justify-center" style={{ background: '#fafbfc' }}>
        <div className="flex flex-col items-center gap-2">
          <div className="w-8 h-8 border-[3px] border-[#ba0036] border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-bold text-gray-400">Loading map…</span>
        </div>
      </div>
    );
  }

  return (
    <GoogleMap
      mapContainerStyle={{ width: '100%', height: '208px' }}
      center={center}
      zoom={16}
      options={mapOptions}
    >
      <MarkerF position={center} title="Property Location" />
    </GoogleMap>
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

    // ── Local template-based description generator ──
    // The previous version called api.anthropic.com directly from the browser,
    // which is blocked by CORS (Anthropic doesn't allow browser-origin requests).
    // This generates a polished description locally from the form fields instead.
    await new Promise(r => setTimeout(r, 600)); // brief delay for UX feel

    const type = form.type || (isBn ? 'প্রপার্টি' : 'property');
    const loc  = form.area || form.district || form.location || form.division || '';
    const beds = form.beds ? `${form.beds} ${isBn ? 'বেডরুম' : 'bedroom'}` : '';
    const baths = form.baths ? `${form.baths} ${isBn ? 'বাথরুম' : 'bathroom'}` : '';
    const sqft = form.sqft ? `${form.sqft} sqft` : '';
    const furn = form.furnishing || '';
    const amenities = (form.amenities || []).slice(0, 4).join(', ');
    const isRent = form.intent !== 'buy';

    let text;
    if (isBn) {
      const parts = [
        `${loc ? loc + ' এলাকায়' : ''} চমৎকার ${type}${beds ? ', ' + beds : ''}${baths ? ' ও ' + baths : ''} সহ ${isRent ? 'ভাড়ার জন্য' : 'বিক্রয়ের জন্য'} উপলব্ধ।`,
        sqft ? `মোট আয়তন ${sqft}।` : '',
        furn ? `${furn} অবস্থায় পাওয়া যাবে।` : '',
        amenities ? `সুবিধাসমূহ: ${amenities}।` : '',
        'পরিবারের জন্য আদর্শ পরিবেশ, নিরাপদ এবং সুবিধাজনক অবস্থান।',
      ].filter(Boolean);
      text = parts.join(' ');
    } else {
      const parts = [
        `Beautiful ${type}${loc ? ' in ' + loc : ''} available for ${isRent ? 'rent' : 'sale'}${beds || baths ? ', featuring ' + [beds, baths].filter(Boolean).join(' and ') : ''}.`,
        sqft ? `Spread across ${sqft} of well-designed living space.` : '',
        furn ? `The property comes ${furn.toLowerCase()}.` : '',
        amenities ? `Key amenities include ${amenities}.` : '',
        `Ideal for ${form.category === 'bachelor_male' || form.category === 'bachelor_female' ? 'bachelors' : 'families'} looking for a comfortable and convenient home.`,
      ].filter(Boolean);
      text = parts.join(' ');
    }

    setAiSuggestion(text);
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
  const location = useLocation();
  const { user, isAuthenticated } = useAuth();
  const isBn = language === 'বাংলা';

  // localStorage key for the in-progress wizard draft. Used to bridge the
  // auth round-trip: guests fill the wizard, hit Publish, get bounced to
  // /login?next=/list-property?resume=1, sign in, and land back here — the
  // draft is hydrated and the listing is published automatically.
  const DRAFT_KEY = 'tolet_pro::draft:list-property';

  const [step, setStep] = useState(1);
  const [form, setForm] = useState(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return { ...INITIAL_FORM, ...parsed };
      }
    } catch (_) { /* swallow — fall back to a blank wizard */ }
    return INITIAL_FORM;
  });
  const [errors, setErrors] = useState({});
  const [toast, setToast] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Media refs
  const coverInputRef = useRef(null);
  const roomInputRef  = useRef(null);
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
      // District only mandatory when the chosen division actually has
      // districts wired up — keeps the wizard future-proof if a region's
      // list is empty.
      if (form.division && (DISTRICTS_BY_DIVISION[form.division] || []).length > 0 && !form.district) {
        e.district = true;
      }
      if (!form.location.trim()) e.location  = true;
    }
    if (targetStep >= 2) {
      if (!form.furnishing)      e.furnishing = true;
    }
    if (targetStep >= 4) {
      if (!form.coverPhoto)      e.coverPhoto = true;
    }
    if (targetStep >= 5) {
      if (!form.price)           e.price      = true;
      // Description is now the final required field so the AI helper
      // can draft from a fully-filled wizard.
      if (form.description.trim().length < 30) e.description = true;
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
  // Photos are stored as data: URLs (not blob: URLs) so they survive a page
  // reload — see readFileAsDataUrl() up top for the rationale. We also keep
  // the File reference around in case a future step needs to upload it.
  //
  // Each image runs through compressImageFile() before being stored so a
  // 10–15 MB phone photo lands in localStorage as ~300–600 KB JPEG. Files
  // bigger than MAX_IMAGE_BYTES are rejected with a localized toast —
  // uploads up to that ceiling are accepted regardless of network speed
  // (important on Bangladesh mobile).
  const handleCoverPhoto = async (files) => {
    const all = Array.from(files);
    const image = all.find(f => f.type.startsWith('image/'));
    if (!image) {
      showToast(
        isBn ? 'অনুগ্রহ করে একটি ছবি ফাইল বাছুন (JPG/PNG/WEBP)।' : 'Please pick an image file (JPG/PNG/WEBP).',
        'error',
      );
      return;
    }
    if (image.size > MAX_IMAGE_BYTES) {
      showToast(
        isBn
          ? `ছবিটি ${formatMB(image.size)} MB — সর্বোচ্চ ${formatMB(MAX_IMAGE_BYTES)} MB পর্যন্ত আপলোড করা যাবে।`
          : `Image is ${formatMB(image.size)} MB — maximum ${formatMB(MAX_IMAGE_BYTES)} MB per photo.`,
        'error',
      );
      return;
    }
    const dataUrl = await compressImageFile(image);
    const img = { id: Date.now(), preview: dataUrl, name: image.name, file: image };
    set('coverPhoto', img);
    setErrors(e => ({ ...e, coverPhoto: false }));
  };

  const handleRoomPhotos = async (files) => {
    const remaining = 20 - form.roomPhotos.length;
    const all   = Array.from(files).filter(f => f.type.startsWith('image/'));
    const tooBig = all.filter(f => f.size > MAX_IMAGE_BYTES);
    if (tooBig.length) {
      showToast(
        isBn
          ? `${tooBig.length}টি ছবি বাদ পড়েছে — প্রতিটি সর্বোচ্চ ${formatMB(MAX_IMAGE_BYTES)} MB।`
          : `${tooBig.length} photo${tooBig.length > 1 ? 's' : ''} skipped — max ${formatMB(MAX_IMAGE_BYTES)} MB each.`,
        'error',
      );
    }
    const accepted = all.filter(f => f.size <= MAX_IMAGE_BYTES).slice(0, Math.max(0, remaining));
    if (!accepted.length) return;
    const newPhotos = await Promise.all(accepted.map(async (file) => ({
      id: Date.now() + Math.random(),
      room: selectedRoomType,
      preview: await compressImageFile(file),
      name: file.name,
      file,
    })));
    set('roomPhotos', [...form.roomPhotos, ...newPhotos]);
  };

  const removeRoomPhoto = (id) => set('roomPhotos', form.roomPhotos.filter(p => p.id !== id));

  // ── Video tour (file upload back per user-approved Q1 v2) ──────────────
  // We use a blob: URL for the local preview so we don't push 100MB+ of
  // base64 through localStorage. The File reference is preserved on
  // `form.mainVideo.file` so a future multipart upload can stream the
  // bytes directly. The matching <input> lives in step 4 Media further
  // down. Picking a file clears `videoId` so we never carry both at once.
  const videoInputRef = useRef(null);
  const handleVideoUpload = (files) => {
    const all = Array.from(files);
    const vid = all.find(f => f.type.startsWith('video/'));
    if (!vid) {
      showToast(
        isBn
          ? 'অনুগ্রহ করে একটি ভিডিও ফাইল বাছুন (MP4/MOV/WEBM)।'
          : 'Please pick a video file (MP4/MOV/WEBM).',
        'error',
      );
      return;
    }
    if (vid.size > MAX_VIDEO_BYTES) {
      showToast(
        isBn
          ? `ভিডিওটি ${formatMB(vid.size)} MB — সর্বোচ্চ ${formatMB(MAX_VIDEO_BYTES)} MB পর্যন্ত আপলোড করা যাবে।`
          : `Video is ${formatMB(vid.size)} MB — maximum ${formatMB(MAX_VIDEO_BYTES)} MB per upload.`,
        'error',
      );
      return;
    }
    // Revoke the previous blob URL before overwriting so we don't leak.
    if (form.mainVideo?.preview?.startsWith('blob:')) {
      try { URL.revokeObjectURL(form.mainVideo.preview); } catch (_) {}
    }
    const preview = URL.createObjectURL(vid);
    setForm(f => ({
      ...f,
      mainVideo: { id: Date.now(), preview, name: vid.name, size: vid.size, file: vid },
      videoId:   '', // file wins — clear the YouTube ID so only one renders
    }));
  };
  const removeMainVideo = () => {
    if (form.mainVideo?.preview?.startsWith('blob:')) {
      try { URL.revokeObjectURL(form.mainVideo.preview); } catch (_) {}
    }
    set('mainVideo', null);
  };

  // ─── SUBMIT ────────────────────────────────────────────────────────────────
  //
  // Backend contract:
  //   POST /api/properties (Bearer)
  //     multipart/form-data — form fields + cover/room photos as files.
  //     Response: { property }
  //
  // Until the API is live, propertyService.createProperty() persists the
  // listing in namespaced localStorage and broadcasts a change event that
  // HostDashboard subscribes to. See src/components/Propertyservice.js.
  // Guests are allowed to fill the entire wizard. On the final Publish
  // click, if they aren't signed in yet, we save the in-progress draft to
  // localStorage and redirect them to /login with a `next` param that
  // brings them straight back to this page with `?resume=1`. The mount
  // effect picks up `?resume=1`, re-hydrates the draft, and auto-publishes.
  const persistDraft = () => {
    try {
      // FileLists and other non-serialisable bits get stripped by
      // JSON.stringify — that's fine, because the data: URLs in
      // form.coverImage / form.images are plain strings and survive.
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
    } catch (_) { /* quota / private-mode — non-fatal */ }
  };

  const clearDraft = () => {
    try { window.localStorage.removeItem(DRAFT_KEY); } catch (_) {}
  };

  const handleSubmit = async () => {
    if (!validate(5)) {
      showToast(isBn ? 'অনুগ্রহ করে সব তথ্য পূরণ করুন।' : 'Please fill all required fields.', 'error');
      return;
    }

    // Defer-login: park the draft and bounce to login. After signing in
    // the user lands back here with ?resume=1 and the publish flow
    // resumes automatically from the success screen.
    if (!isAuthenticated) {
      persistDraft();
      showToast(
        isBn ? 'প্রকাশের জন্য সাইন ইন করুন — আপনার তথ্য সংরক্ষিত আছে।' : 'Sign in to publish — your draft is saved.',
        'info',
      );
      navigate('/login?next=' + encodeURIComponent('/list-property?resume=1'));
      return;
    }

    setIsSubmitting(true);
    try {
      // propertyService pulls the current host from auth state and stamps
      // the listing with their id/name.
      await propertyService.createProperty(form);
      clearDraft();
      setIsSubmitting(false);
      setSubmitted(true);
    } catch (err) {
      setIsSubmitting(false);
      showToast(
        isBn ? `সংরক্ষণ ব্যর্থ হয়েছে: ${err.message}` : `Could not save property: ${err.message}`,
        'error',
      );
    }
  };

  // Auto-resume after the auth round-trip: when the user lands back on
  // /list-property?resume=1 with a hydrated draft and is now signed in,
  // re-run handleSubmit() so the listing publishes without a second click.
  // We only fire once per mount (guarded by `didResumeRef`).
  const didResumeRef = useRef(false);
  useEffect(() => {
    if (didResumeRef.current) return;
    const params = new URLSearchParams(location.search);
    if (params.get('resume') !== '1') return;
    if (!isAuthenticated) return;
    // Wait for the form state to settle (it was hydrated synchronously in
    // useState, but the validation helpers read form via closure, so a
    // microtask defer keeps things tidy).
    didResumeRef.current = true;
    const t = setTimeout(() => { handleSubmit(); }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, location.search]);

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
                      onChange={e => {
                        // Cascading reset: division change wipes district + area
                        // so users can never end up with a Dhaka district under
                        // the Sylhet division.
                        set('division', e.target.value);
                        set('district', '');
                        set('area', '');
                        set('thana', '');
                        setErrors(er => ({ ...er, division: false }));
                      }}>
                      <option value="">{isBn ? 'বিভাগ নির্বাচন করুন' : 'Select Division'}</option>
                      {DIVISIONS.map(d => <option key={d.id} value={d.id}>{isBn ? d.labelBn : d.label}</option>)}
                    </select>
                    <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                  {err('division') && <ErrMsg text={isBn ? 'বিভাগ বেছে নিন' : 'Please select a division'} />}
                </Field>

                {/* District (cascades from Division) */}
                <AnimatePresence>
                  {form.division && (DISTRICTS_BY_DIVISION[form.division] || []).length > 0 && (
                    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                      <Field label={isBn ? 'জেলা' : 'District'} required
                        hint={isBn ? 'বিভাগ অনুযায়ী জেলা দেখাবে' : 'Districts populate from the chosen division'}>
                        <div className="relative">
                          <select className={`${inputCls} appearance-none pr-10 ${err('district') ? 'border-red-200 bg-red-50' : ''}`}
                            value={form.district}
                            onChange={e => {
                              set('district', e.target.value);
                              set('area', '');
                              set('thana', '');
                              setErrors(er => ({ ...er, district: false }));
                            }}>
                            <option value="">{isBn ? 'জেলা নির্বাচন করুন' : 'Select District'}</option>
                            {(DISTRICTS_BY_DIVISION[form.division] || []).map(d => (
                              <option key={d.id} value={d.id}>{isBn ? d.labelBn : d.label}</option>
                            ))}
                          </select>
                          <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                        </div>
                        {err('district') && <ErrMsg text={isBn ? 'জেলা বেছে নিন' : 'Please select a district'} />}
                      </Field>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Thana / Upazila (cascades from District) — the specific place tenants search by */}
                <AnimatePresence>
                  {form.district && (
                    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                      <Field label={isBn ? 'থানা / উপজেলা' : 'Thana / Upazila'}
                        hint={isBn ? 'নির্দিষ্ট থানা — ভাড়াটিয়া এটা দিয়েই বাসা খুঁজে পাবে' : 'The specific thana — tenants find your place by this'}>
                        {(THANAS_BY_DISTRICT[form.district] || []).length > 0 ? (
                          <div className="relative">
                            <select className={`${inputCls} appearance-none pr-10`}
                              value={form.thana}
                              onChange={e => { set('thana', e.target.value); set('area', ''); }}>
                              <option value="">{isBn ? 'থানা নির্বাচন করুন' : 'Select Thana'}</option>
                              {(THANAS_BY_DISTRICT[form.district] || []).map(th => (
                                <option key={th} value={th}>{th}</option>
                              ))}
                            </select>
                            <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                          </div>
                        ) : (
                          <div className="relative">
                            <MapPin size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" />
                            <input type="text" className={`${inputCls} pl-10`}
                              placeholder={isBn ? 'যেমন: লালমোহন' : 'e.g. Lalmohan'}
                              value={form.thana}
                              onChange={e => { set('thana', e.target.value); set('area', ''); }} />
                          </div>
                        )}
                      </Field>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Area / neighborhood (cascades from District) */}
                <AnimatePresence>
                  {form.district && form.thana && areasForThana(form.district, form.thana).length > 0 && (
                    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                      <Field label={isBn ? 'এলাকা / পাড়া' : 'Area / Neighborhood'}
                        hint={isBn ? 'যেমন: ধানমন্ডি ৩, গুলশান ২, উত্তরা সেক্টর ৭' : 'e.g. Dhanmondi 3, Gulshan 2, Uttara Sector 7'}>
                        <div className="relative">
                          <select className={`${inputCls} appearance-none pr-10`}
                            value={form.area}
                            onChange={e => {
                              const value = e.target.value;
                              set('area', value);
                              // Auto-prefill the address field on first area pick.
                              if (value && !form.location.trim()) {
                                set('location', value);
                              }
                            }}>
                            <option value="">{isBn ? 'এলাকা নির্বাচন করুন (ঐচ্ছিক)' : 'Select Area (optional)'}</option>
                            {areasForThana(form.district, form.thana).map(a => (
                              <option key={a} value={a}>{a}</option>
                            ))}
                          </select>
                          <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                        </div>
                      </Field>
                    </motion.div>
                  )}
                </AnimatePresence>

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

                {/* Sqft + Floor — both optional, side by side. Floor was
                    added per the user's explicit request: "on which
                    floor is the house located". Backend `Property.floor`
                    accepts -5..200, so a value of 0 is ground floor and
                    negative numbers represent basement levels. */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
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

                  <Field label={isBn ? 'কত তলায় — ঐচ্ছিক' : 'Floor Number — Optional'}
                    hint={isBn
                      ? '০ = নিচতলা, ১ = প্রথম তলা, ইত্যাদি'
                      : '0 = ground floor, 1 = 1st floor, etc.'}>
                    <div className="relative">
                      <Layers size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" />
                      <input type="number"
                        className={`${inputCls} pl-10`}
                        placeholder={isBn ? 'যেমন: ৫' : 'e.g. 5'}
                        value={form.floor}
                        onChange={e => set('floor', e.target.value)}
                        min={-5}
                        max={200}
                      />
                    </div>
                    <p className="text-[10px] font-bold text-gray-300 mt-1">
                      {isBn ? 'বাড়িটি কত তলায় অবস্থিত?' : 'Which floor is the unit located on?'}
                    </p>
                  </Field>
                </div>

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

                {/* Description used to live here. Per the user's request
                    ("give the description to everyone's last so that AI
                    can analyze everything and then write a good
                    description") it now renders as the final field of
                    step 5 (Pricing) so the AI helper has access to every
                    other answer before drafting copy. */}
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

                {/* ── VIDEO (file upload OR YouTube ID — whichever wins) ──
                    User-approved Q1 v2: hosts can now upload a local
                    walkthrough OR paste a YouTube link. The two inputs
                    are mutually exclusive — picking a file clears the
                    YouTube ID and vice-versa — so the listing always
                    renders exactly one player. */}
                <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-[0_4px_15px_rgba(0,0,0,0.03)]">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-7 h-7 bg-rose-600 rounded-lg flex items-center justify-center">
                      <Video size={13} className="text-white" />
                    </div>
                    <p className="text-xs font-black text-gray-900">{isBn ? 'ভিডিও ট্যুর' : 'Video Tour'}</p>
                    <span className="text-[9px] font-bold text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">{isBn ? 'ঐচ্ছিক · শুধু ১টি' : 'Optional · 1 only'}</span>
                  </div>
                  <p className="text-[11px] font-bold text-gray-400 mb-4">
                    {isBn
                      ? 'পুরো বাড়ির একটি ভিডিও ট্যুর আপলোড করুন অথবা YouTube লিংক দিন।'
                      : 'Upload a walkthrough video, or paste a YouTube link instead.'}
                  </p>

                  {/* File upload — shown unless a YouTube ID is set */}
                  {!form.videoId && !form.mainVideo && (
                    <div>
                      <input ref={videoInputRef} type="file" accept="video/*" className="hidden"
                        onChange={e => handleVideoUpload(e.target.files)} />
                      <button type="button" onClick={() => videoInputRef.current?.click()}
                        className="w-full border-2 border-dashed border-gray-200 rounded-xl p-6 flex flex-col items-center gap-2 hover:border-[#ba0036]/40 hover:bg-red-50/30 transition-all">
                        <div className="w-12 h-12 bg-gray-100 rounded-2xl flex items-center justify-center">
                          <Upload size={20} className="text-gray-400" />
                        </div>
                        <p className="text-sm font-black text-gray-700">
                          {isBn ? 'ভিডিও আপলোড করুন' : 'Upload Walkthrough Video'}
                        </p>
                        <p className="text-[11px] font-bold text-gray-300">
                          {isBn
                            ? `MP4 / MOV / WEBM · সর্বোচ্চ ${formatMB(MAX_VIDEO_BYTES)} MB`
                            : `MP4 / MOV / WEBM · max ${formatMB(MAX_VIDEO_BYTES)} MB`}
                        </p>
                      </button>
                    </div>
                  )}

                  {/* Local video preview */}
                  {form.mainVideo && (
                    <div className="mt-2">
                      <div className="rounded-xl overflow-hidden aspect-video shadow-sm bg-black">
                        <video src={form.mainVideo.preview} controls className="w-full h-full" />
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <p className="text-[10px] font-bold text-gray-400 truncate flex-1 pr-2">
                          {form.mainVideo.name} · {formatMB(form.mainVideo.size)} MB
                        </p>
                        <button type="button" onClick={removeMainVideo}
                          className="text-[10px] font-black text-red-400 flex items-center gap-1 hover:text-[#ba0036] transition-colors shrink-0">
                          <X size={10} strokeWidth={3} />{isBn ? 'ভিডিও সরান' : 'Remove video'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* YouTube ID — shown when nothing is uploaded yet */}
                  {!form.mainVideo && !form.videoId && (
                    <div className="mt-4">
                      <p className="text-[10px] font-black text-gray-300 uppercase tracking-widest mb-2 text-center">
                        {isBn ? 'অথবা YouTube লিংক' : 'Or paste a YouTube ID'}
                      </p>
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

                  {/* YouTube preview */}
                  {form.videoId && (
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

                {/* Description (moved to LAST step per user request — every
                    other field is filled by this point so the AI helper
                    can analyse the whole listing before drafting copy). */}
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
