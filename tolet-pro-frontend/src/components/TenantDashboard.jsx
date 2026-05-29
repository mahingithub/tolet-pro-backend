import React, { useState, useEffect, useRef } from 'react';
import { uploadVerificationDoc, uploadAvatar, getCurrentToken } from '../services/authService';
import { listMyInquiries } from '../services/inquiryService.js';
import { listTenantReceipts } from '../services/receiptService.js';
import { listNotifications, getUnreadCount, markRead } from '../services/notificationService.js';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  Building2, Search, Bell, Globe, LayoutDashboard, Heart,
  MessageSquare, MessageCircle, Settings, HelpCircle,
  ArrowRight, Trash2, MapPin, Receipt, CheckCheck, Download,
  CreditCard, Hourglass, X, UserCircle, BadgeCheck, ShieldAlert,
  Camera, ScanFace, Upload, Check, Edit3, User, Phone, Mail,
  Briefcase, GraduationCap, Building, Shield, ShieldCheck, FileText, AlertCircle, Award,
  LogOut, CheckCircle2, Calendar, Clock, Eye, Send, ThumbsUp, ThumbsDown,
  Inbox, Home, Sparkles, KeyRound, CalendarCheck, DollarSign, Navigation,
  ChevronLeft, Filter, Zap, RefreshCw
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext.jsx';
// InquiryModal is the same shared modal used by PropertyDetails / PropertyListing.
// Adjust the import path if your file lives elsewhere — the API is unchanged.
import InquiryModal from './InquiryModal';
// Shared identity-verification wizard used by both tenant & host dashboards.
// Modal-style, role-aware (different final step for landlord). Phase 2:
// real Cloudinary upload wiring will land in this modal's onSubmit caller.
// Identity-verification flow — redesigned around the realities of Bangladesh:
// no scary "upload your NID now" gate, Bengali-friendly fields, deferred
// document uploads. Replaces the older VerificationWizardModal for tenants.
// (Landlords still use the older modal until the next session ships a host
// version with the same design language.)
import VerificationModal from './VerificationModal';
// 🆕 Session 2: shared profile primitives. ProfileSection is the
// new role-aware card that replaces the old "Personal Information"
// + header block. It handles avatar, inline-edit fields, and the
// verification CTA.
import ProfileSection from './shared/ProfileSection';
// 🟢 Wired-in standalone surfaces — these files exist under ./tenant/ but
// were never rendered. We now render them inline for the matching tabs
// ("Account Settings" + "Help & Support") so clicking them in the side
// drawer actually opens the screen.
import TenantSettings from './tenant/TenantSettings';
import TenantSupport from './tenant/TenantSupport';

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
// ⚠️ PRIVACY FIX — Per-user namespacing.
// The tenant profile (phone, NID flags, profession info, verification state)
// is browser-local until submitted to the backend. Storing it under a single
// global key meant that if Account A logged out and Account B logged in on
// the same browser, B saw A's profile — including A's phone number, which is
// exactly the cross-account leak we hit in production. The key is now scoped
// by user id so different accounts get isolated storage slots.
//
// The old global key 'tolet_tenant_profile' is intentionally abandoned. We
// purge it once on mount so any orphaned data sitting in browsers from
// before this fix doesn't linger forever.
const tenantProfileKey = (userId) =>
  `tolet_tenant_profile:${userId || 'anon'}`;
const LEGACY_TENANT_PROFILE_KEY = 'tolet_tenant_profile';
const TENANT_PROFILE_EVENT = 'tolet-tenant-profile-updated';

const DEFAULT_TENANT_PROFILE = {
  fullName: '',
  phone: '',
  email: '',
  dateOfBirth: '',
  professionType: '',

  // 🆕 Session 2 — Blueprint v2 fields. Backend will pick these up
  // once the new PATCH /me endpoint lands (Session 4-5).
  workPlace: '',                  // free text or matched from WORKPLACES
  workPlaceId: '',                // optional, set when matched
  familySize: '',                 // '1' | '2' | '3' | '4' | '5+'
  emergencyContact: {
    name: '',
    phone: '',
    relation: '',                 // 'parent' | 'spouse' | 'sibling' | ...
  },

  verification: {
    photo: false,
    nidFront: false,
    nidBack: false,
    professionProof: false,
    submittedForReview: false,
    status: 'unverified',
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

// ╔════════════════════════════════════════════════════════════════════════╗
// ║  POPULAR_AREAS — mini gazetteer used by the AI suggestion line.        ║
// ║  Each entry has a lat/lng centroid + the slug we already use in the    ║
// ║  listing route (`/properties/all?location=<slug>`). We pick the closest║
// ║  area to the tenant's coarse geolocation and surface it as the         ║
// ║  one-tap "homes near you" suggestion.                                  ║
// ║                                                                        ║
// ║  Backend contract: when you wire the real API, replace the in-memory   ║
// ║  closest-match below with `GET /api/locations/nearest?lat=&lng=`.      ║
// ╚════════════════════════════════════════════════════════════════════════╝
const POPULAR_AREAS = [
  { slug: 'gulshan',     en: 'Gulshan',     bn: 'গুলশান',      lat: 23.7925, lng: 90.4078 },
  { slug: 'banani',      en: 'Banani',      bn: 'বনানী',       lat: 23.7937, lng: 90.4066 },
  { slug: 'dhanmondi',   en: 'Dhanmondi',   bn: 'ধানমন্ডি',    lat: 23.7461, lng: 90.3742 },
  { slug: 'mohammadpur', en: 'Mohammadpur', bn: 'মোহাম্মদপুর', lat: 23.7656, lng: 90.3589 },
  { slug: 'mirpur',      en: 'Mirpur',      bn: 'মিরপুর',      lat: 23.8223, lng: 90.3654 },
  { slug: 'uttara',      en: 'Uttara',      bn: 'উত্তরা',      lat: 23.8759, lng: 90.3795 },
];

const findClosestArea = (lat, lng) => {
  let best = null;
  let bestDist = Infinity;
  for (const a of POPULAR_AREAS) {
    const dLat = a.lat - lat;
    const dLng = a.lng - lng;
    const d = dLat * dLat + dLng * dLng;
    if (d < bestDist) { bestDist = d; best = a; }
  }
  return best;
};

// ────────────────────────────────────────────────────────────────────────
// NearbyAreaSuggestion — the "AI"-flavoured location hint shown below the
// "Browse all properties" CTA in the overview. Reads the device's coarse
// geolocation (once per session), reverse-maps to the closest popular
// area, and surfaces a one-tap deep link into the matching listing
// feed. Falls back to a generic "Looking for something specific?" copy
// when geolocation is unavailable or the user denies the prompt.
// ────────────────────────────────────────────────────────────────────────
const NearbyAreaSuggestion = ({ language }) => {
  const [area, setArea] = React.useState(null);
  const [denied, setDenied] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      setDenied(true);
      return;
    }
    try {
      const cached = window.sessionStorage.getItem('tolet_nearby_area');
      if (cached) {
        setArea(JSON.parse(cached));
        return;
      }
    } catch { /* swallow */ }
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        const a = findClosestArea(pos.coords.latitude, pos.coords.longitude);
        if (a) {
          setArea(a);
          try { window.sessionStorage.setItem('tolet_nearby_area', JSON.stringify(a)); } catch { /* swallow */ }
        }
      },
      () => { if (!cancelled) setDenied(true); },
      { timeout: 8000, maximumAge: 5 * 60 * 1000, enableHighAccuracy: false },
    );
    return () => { cancelled = true; };
  }, []);

  if (area) {
    const label = language === 'বাংলা' ? area.bn : area.en;
    return (
      <Link
        to={`/properties/all?location=${area.slug}`}
        className="mt-4 inline-flex items-center gap-2 text-[12px] md:text-[13px] font-bold text-gray-600 hover:text-[#ba0036] transition-colors group"
      >
        <span className="inline-flex w-7 h-7 rounded-full bg-[#ba0036]/10 text-[#ba0036] items-center justify-center shrink-0">
          <Sparkles size={12} />
        </span>
        <span className="leading-snug">
          {language === 'বাংলা'
            ? <>আপনি <span className="font-black text-gray-900">{label}</span>-এর কাছে আছেন বলে মনে হচ্ছে — নিকটবর্তী বাড়ি দেখুন</>
            : <>Looks like you\u2019re near <span className="font-black text-gray-900">{label}</span> — see homes nearby</>}
        </span>
        <ArrowRight size={12} className="text-gray-400 group-hover:text-[#ba0036] group-hover:translate-x-0.5 transition-all" />
      </Link>
    );
  }

  return (
    <p className="mt-4 inline-flex items-start gap-2 text-[12px] md:text-[13px] font-bold text-gray-500 leading-snug">
      <span className="inline-flex w-7 h-7 rounded-full bg-gray-100 text-gray-500 items-center justify-center shrink-0">
        <Sparkles size={12} />
      </span>
      <span>
        {denied
          ? (language === 'বাংলা'
              ? 'লোকেশন অন করলে আমরা আপনার এলাকার বাড়ি সাজেস্ট করতে পারবো।'
              : 'Turn on location to get suggestions for homes near you.')
          : (language === 'বাংলা'
              ? 'আমরা আপনার জন্য নিকটবর্তী বাড়ি খুঁজছি…'
              : 'Detecting your area to suggest homes nearby…')}
      </span>
    </p>
  );
};

// Merge two receipt arrays (backend + local) prioritizing the freshest data by ID.
const mergeReceipts = (prev, incoming) => {
  const map = new Map(prev.map(r => [r.id, r]));
  incoming.forEach(r => map.set(r.id, r));
  return Array.from(map.values()).sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt));
};

const TenantDashboard = () => {
  const navigate = useNavigate();
  // 🟢 Pull the logged-in user from AuthContext so the header /
  // drawer / welcome banner show the REAL name (e.g. "Ashraf Alam")
  // instead of the hardcoded "John" fallback. The auth user object
  // carries `name` (set during login/signup); we map it locally so we
  // can keep using the existing `loggedInUser` variable below.
  // 🟢 Roadmap-v2 §1 + tenant-roadmap §T2 — wire profile + role changes
  // through AuthContext so the server stays the source of truth. Calls
  // still fall back to localStorage if the API is unreachable, so the
  // dashboard works in offline / no-backend dev without crashing.
  const {
    logout: authLogout,
    user: authUser,
    updateMe: authUpdateMe,
    submitVerification: authSubmitVerification,
    addRole: authAddRole,
    setActiveRole: authSetActiveRole,
    roles: authRoles,
  } = useAuth();
  const location = useLocation();
  
  // 🔴 100% Connected to your Global LanguageContext from Navbar
  const { t, language, setLanguage } = useLanguage(); 

  const [activeTab, setActiveTab] = useState('overview');
  const [isProfileDrawerOpen, setIsProfileDrawerOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLangOpen, setIsLangOpen] = useState(false);
  
  const [savedProperties, setSavedProperties] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');

  // 🟢 NEW: Payment receipts pushed in by the landlord from HostDashboard.
  const [paymentReceipts, setPaymentReceipts] = useState([]);
  const [activeReceipt, setActiveReceipt] = useState(null);

  // 🟢 Payments filter state — drives the futuristic month/year/property
  // navigator at the top of the Payments tab. We do NOT persist these to
  // localStorage on purpose; the user resets them on each visit.
  //   payYear     — year currently shown in the month strip
  //   payMonth    — 'MM' string ('01'..'12') or null (= "All months")
  //   payProperty — propertyId or 'all'
  //   paySearch   — free-text query (property, month, amount)
  const [payYear, setPayYear] = useState(new Date().getFullYear());
  const [payMonth, setPayMonth] = useState(null);
  const [payProperty, setPayProperty] = useState('all');
  const [paySearch, setPaySearch] = useState('');

  // 🟢 NEW: Inquiry modal — single shared modal opened from any "Inquire"
  // CTA in the dashboard (saved-property cards, inquiry rows). When the
  // user submits, your existing InquiryModal handles the network call;
  // wrap with onSubmitted later if you want to optimistically prepend a
  // new entry to the local inquiries list.
  const [inquiryProp, setInquiryProp] = useState(null);

  // 🟢 NEW: Real "My Inquiries" list, hydrated from GET /api/inquiries/mine.
  // Previously this tab rendered three hard-coded sample rows that had
  // nothing to do with the user. Now we pull the real list from the
  // backend, refresh on a 30s timer (so a landlord's status change is
  // reflected within half a minute), and adapt each record into the
  // shape the existing UI expects (title / location / price / stageIdx /
  // outcome / sentAt / lastUpdate / img).
  const [myInquiries, setMyInquiries] = useState([]);

  useEffect(() => {
    if (!getCurrentToken()) return undefined;
    let cancelled = false;
    const hydrate = async () => {
      try {
        const rows = await listMyInquiries();
        if (cancelled) return;
        setMyInquiries(rows);
      } catch (err) {
        console.warn('[tenant] failed to load inquiries:', err.message || err);
      }
    };
    hydrate();
    const interval = setInterval(hydrate, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);
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
  // Rejected verifications get a dedicated banner so the user knows why
  // their submission bounced — and can retry without hunting for the
  // verify button. The reason text comes from the admin's "Send Rejection"
  // dialog in UserManagement.jsx → backend rejectionReason field.
  const verifRejected = tenantProfile?.verification?.status === 'rejected';
  const rejectionReason = tenantProfile?.verification?.rejectionReason || '';

  // Name resolution order — first non-empty wins:
  //   1. tenantProfile.fullName  (set by the user in the Profile tab)
  //   2. authUser.name           (set when they signed up / logged in)
  //   3. legacy userName key     (kept for backwards-compat)
  //   4. role-based generic label so we NEVER hardcode "John" again
  const loggedInUser = (
    (tenantProfile?.fullName?.trim()) ||
    (authUser?.name?.trim()) ||
    (localStorage.getItem('userName')?.trim()) ||
    (language === 'বাংলা' ? 'ভাড়াটিয়া' : 'Tenant')
  );

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

  // 🟢 NEW: Sync payment receipts — backend is source of truth, localStorage is instant fallback.
  useEffect(() => {
    // 1. Instant local hydration (same-tab push from HostDashboard).
    const loadLocal = () => {
      try {
        const stored = JSON.parse(localStorage.getItem(PAYMENT_RECEIPTS_KEY)) || [];
        setPaymentReceipts((prev) => mergeReceipts(prev, stored));
      } catch { /* ignore */ }
    };
    loadLocal();
    const onStorage = (e) => { if (!e.key || e.key === PAYMENT_RECEIPTS_KEY) loadLocal(); };
    const onCustom = () => loadLocal();
    window.addEventListener('storage', onStorage);
    window.addEventListener(PAYMENT_RECEIPTS_EVENT, onCustom);

    // 2. Backend hydration — persistent cross-device source of truth.
    let cancelled = false;
    const loadBackend = async () => {
      if (!getCurrentToken()) return;
      try {
        const rows = await listTenantReceipts();
        if (cancelled) return;
        setPaymentReceipts((prev) => mergeReceipts(prev, rows));
      } catch (err) {
        console.warn('[tenant] receipt fetch failed:', err.message || err);
      }
    };
    loadBackend();
    const interval = setInterval(loadBackend, 30_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(PAYMENT_RECEIPTS_EVENT, onCustom);
    };
  }, []);

  // 🟢 Notification Polling
  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const fetchNotifications = async () => {
      if (!authUser) return;
      try {
        const res = await listNotifications({ limit: 50 });
        if (cancelled) return;
        setNotifications(res.items);
        setUnreadCount(res.unread);
      } catch (err) {
        // silent
      }
    };

    fetchNotifications();
    timer = setInterval(fetchNotifications, 15_000);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [authUser]);

  // 🟢 Sync tenant profile (mount + storage event + same-tab custom event).
  //
  // Two important invariants enforced here after the cross-account leak fix:
  //
  //   1. **Phone is sourced from authUser, never from stored.**
  //      Phone is OTP-verified at signup and locked thereafter. It belongs to
  //      the auth layer, not to the tenant profile blob. Reading it from
  //      stored caused the "different phone in tenant vs landlord view" bug
  //      when one browser had been used by multiple accounts.
  //
  //   2. **Storage is keyed by user id.**
  //      Each account gets its own slot — `tolet_tenant_profile:<uid>` —
  //      so logging out and back in as a different user can't surface the
  //      previous user's NID flags, profession info, or any other field.
  //
  // We also purge the legacy global key (`tolet_tenant_profile`) on first
  // run so leftover data from before this fix doesn't sit in the browser
  // forever. This runs every effect tick but the key disappears after the
  // first removeItem, so it's effectively a one-shot cleanup.
  useEffect(() => {
    // One-shot purge of the pre-fix global storage slot. Safe to run on every
    // effect re-run: after the first call the key is gone and removeItem is
    // a no-op.
    try { localStorage.removeItem(LEGACY_TENANT_PROFILE_KEY); } catch { /* ignore */ }

    const userId    = authUser?.id || authUser?._id || null;
    const storageKey = tenantProfileKey(userId);

    const loadProfile = () => {
      try {
        const stored = JSON.parse(localStorage.getItem(storageKey) || 'null');
        // 🟢 ONLY auth-layer fallbacks. We deliberately do NOT read the
        // legacy `userName` / `userPhone` localStorage keys here — those
        // are written by older code paths and never cleared on logout,
        // so they leak the previous account's name onto the new account's
        // dashboard right after signup (real bug we hit in production
        // when one browser was used to sign up multiple test accounts).
        const authName   = authUser?.name?.trim()  || '';
        const authPhone  = authUser?.phone?.trim() || '';
        const fallbackName = authName;
        if (stored) {
          // Spread DEFAULT first so any new schema fields land with safe defaults.
          // Stored verification block wins over default if present.
          const merged = {
            ...DEFAULT_TENANT_PROFILE,
            ...stored,
            // Backfill the display name from auth so a freshly-signed-up user
            // doesn't see a blank card if they edited the profile before
            // their first name was set.
            fullName: (stored.fullName?.trim() || fallbackName),
            // 🔒 Phone is ALWAYS from auth — never from stored. This is the
            // fix for the cross-account leak. Even if some stale stored.phone
            // sneaks in (e.g. from a future code path that accidentally
            // writes one), it can never override the real signed-in phone.
            phone: authPhone,
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
          // 🟢 Seed the empty profile with the logged-in user's name + phone so
          // the Profile-edit form doesn't open with blank "Full name" / "Phone"
          // and the phone-OTP verification badge reflects reality straight away.
          const seed = {
            ...DEFAULT_TENANT_PROFILE,
            fullName: fallbackName,
            phone:    authPhone,
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
    const onStorage = (e) => { if (!e.key || e.key === storageKey) loadProfile(); };
    const onCustom = () => loadProfile();
    window.addEventListener('storage', onStorage);
    window.addEventListener(TENANT_PROFILE_EVENT, onCustom);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(TENANT_PROFILE_EVENT, onCustom);
    };
    // Re-run when the auth user identity changes (id) or their canonical
    // name/phone updates. The id dependency is critical — without it, a
    // tab that's open across a logout-then-login-as-someone-else would
    // keep reading the previous user's storage slot.
  }, [authUser?.id, authUser?._id, authUser?.name, authUser?.phone]);

  // ─── Backend hydration — server is source of truth ─────────────────────
  // Whenever the authUser object updates (login, refresh, addRole etc.)
  // and carries a server-side `tenantProfile`, merge those fields into
  // the local tenantProfile state AND write them to the per-user
  // localStorage slot. This is what makes profile data survive
  // logout/login cycles: the backend remembers it, and on next login
  // AuthContext delivers it here. The merge prefers server values for
  // any non-empty field; empty server fields don't clobber local edits
  // the user might have made while offline.
  useEffect(() => {
    if (!authUser) return;
    const serverTP = authUser.tenantProfile;
    if (!serverTP || typeof serverTP !== 'object') return;

    const pickServer = (s, l) => (s !== undefined && s !== null && s !== '' ? s : l);

    setTenantProfile((prev) => {
      const merged = {
        ...prev,
        professionType: pickServer(serverTP.professionType, prev.professionType) || '',
        workPlace:      pickServer(serverTP.workPlace,      prev.workPlace)      || '',
        workPlaceId:    pickServer(serverTP.workPlaceId,    prev.workPlaceId)    || '',
        familySize:     pickServer(serverTP.familySize,     prev.familySize)     || '',
        emergencyContact: {
          name:     pickServer(serverTP.emergencyContact?.name,     prev.emergencyContact?.name)     || '',
          phone:    pickServer(serverTP.emergencyContact?.phone,    prev.emergencyContact?.phone)    || '',
          relation: pickServer(serverTP.emergencyContact?.relation, prev.emergencyContact?.relation) || '',
        },
        publicVisible: serverTP.publicVisible !== false,
        verification: {
          ...(prev.verification || {}),
          ...(serverTP.verification || {}),
        },
        // Identity fields come from the top-level authUser, not tenantProfile.
        fullName: authUser.name  || prev.fullName || '',
        phone:    authUser.phone || prev.phone    || '',
        email:    authUser.email || prev.email    || '',
      };
      // Persist to per-user localStorage so a refresh before the next
      // backend hit still shows the hydrated data.
      try {
        const uid = authUser.id || authUser._id;
        if (uid) localStorage.setItem(tenantProfileKey(uid), JSON.stringify(merged));
      } catch { /* ignore quota errors */ }
      return merged;
    });
    setDraftProfile((d) => ({ ...d, ...serverTP }));
    // We watch a stable JSON projection of tenantProfile because Mongoose
    // serialises into a fresh object every render — depending on the raw
    // reference would loop forever.
  }, [
    authUser?.id,
    authUser?._id,
    authUser?.name,
    authUser?.phone,
    authUser?.email,
    JSON.stringify(authUser?.tenantProfile || {}),
  ]);

  // applyPatch — merge a flat or dotted-path patch object into a profile.
  // Supports keys like 'emergencyContact.phone' so ProfileSection can
  // emit one patch per field save without knowing the nesting shape.
  // Adapted from Lodash's `set` but trimmed to 12 lines for clarity.
  function applyPatch(profile, patch) {
    const next = { ...profile };
    for (const [key, value] of Object.entries(patch || {})) {
      if (!key.includes('.')) {
        next[key] = value;
        continue;
      }
      const parts = key.split('.');
      let cursor = next;
      for (let i = 0; i < parts.length - 1; i++) {
        const k = parts[i];
        cursor[k] = { ...(cursor[k] || {}) };
        cursor = cursor[k];
      }
      cursor[parts[parts.length - 1]] = value;
    }
    return next;
  }

  // Persist + broadcast to other tabs / dashboard subscribers.
  // Writes go to the per-user storage slot so we can't accidentally clobber
  // another account's profile. If we ever end up here with no signed-in user
  // (defensive — the UI shouldn't allow editing in that state), we use the
  // 'anon' slot via tenantProfileKey(null) and skip persistence to avoid
  // polluting shared storage.
  const persistProfile = (next) => {
    setTenantProfile(next);
    const userId = authUser?.id || authUser?._id || null;
    if (!userId) {
      // No authenticated user — just update in-memory state and broadcast.
      // Don't write to localStorage; there's no safe slot for it.
      window.dispatchEvent(new CustomEvent(TENANT_PROFILE_EVENT));
      return;
    }
    try {
      localStorage.setItem(tenantProfileKey(userId), JSON.stringify(next));
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

  const saveProfile = async () => {
    if (!draftProfile.fullName?.trim()) {
      showProfileToast(language === 'বাংলা' ? 'নাম আবশ্যক।' : 'Name is required.');
      return;
    }
    // Persist locally first so the UI updates instantly even on flaky
    // networks. The server PATCH is fire-and-forget — if it fails we
    // surface a toast but the user's data is still safe in localStorage.
    persistProfile(draftProfile);
    setIsEditingProfile(false);

    try {
      await authUpdateMe?.({
        name:        draftProfile.fullName,
        email:       draftProfile.email,
        dateOfBirth: draftProfile.dateOfBirth,
        tenantProfile: {
          professionType: draftProfile.professionType || '',
        },
      });
      showProfileToast(language === 'বাংলা' ? 'প্রোফাইল সেভ হয়েছে।' : 'Profile saved.');
    } catch (err) {
      // Server refused — keep the local copy but tell the user so they
      // know the public trust card hasn't refreshed yet.
      showProfileToast(language === 'বাংলা'
        ? 'লোকালি সেভ হয়েছে — সার্ভার সিঙ্ক হয়নি।'
        : 'Saved locally — server sync pending.');
    }
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

  // ─── Verification wizard (modal) ──────────────────────────────────────
  // The dashboard used to ask the user to flip a checkbox per doc — fake
  // verification. The modal opens a real step-by-step flow with real file
  // pickers. Phase-1 wiring only persists the *flags* (same as before) so
  // the rest of the UI keeps working unchanged. Phase 2 (next session)
  // will stream the picked files to Cloudinary and store the returned
  // secure URLs on `verification.{kind}Url`.
  const [verifModalOpen, setVerifModalOpen] = useState(false);

  // Auto-open the verification wizard when the user lands here with
  // `?openVerify=1` — currently fired by the Navbar's "Switch to Host"
  // path when the backend reports `verification_required`. We strip the
  // query param after opening so a manual refresh doesn't keep re-opening
  // the modal in a loop.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('openVerify') === '1') {
      setVerifModalOpen(true);
      // Clean the URL so the modal opens once, not on every render.
      const url = new URL(window.location.href);
      url.searchParams.delete('openVerify');
      url.searchParams.delete('reason');
      window.history.replaceState({}, '', url.pathname + url.search);
    }
  }, [location.search]);

  // Called by the new TenantVerificationModal after the user reviews +
  // submits. The modal sends a richer payload than the old wizard:
  //   { professionType, workPlace, familySize, emergencyContact,
  //     photo:           { dataUrl, file, ... },
  //     nidFront:        { dataUrl, file, ... },
  //     nidBack:         { dataUrl, file, ... },
  //     professionProof: { dataUrl, file, ... },
  //     liveScore }
  //
  // The previous implementation only wrote to localStorage — backend never
  // knew the user submitted, so the admin panel's KYC queue was empty even
  // after a "successful" submission. The new flow:
  //   1. Upload each non-null file to Cloudinary via uploadVerificationDoc.
  //      That endpoint also persists *Url + *PublicId on the user doc, so a
  //      partial run (e.g. nidFront uploaded, nidBack failed) is recoverable.
  //   2. Call authSubmitVerification so the verification.status flips to
  //      'pending' and submittedForReview goes true server-side.
  //   3. Mirror everything into local tenantProfile + show toast.
  
  // Hydrate saved profile on mount — survives page refresh
useEffect(() => {
  try {
const raw = localStorage.getItem(tenantProfileKey(authUser?.id || authUser?._id || null));   if (raw) {
      const saved = JSON.parse(raw);
      persistProfile((prev) => ({ ...prev, ...saved }));
    }
  } catch (_) {}
}, []);
  
const handleWizardSubmit = async (payload) => {
  // ── 1. Decide what new files need uploading ─────────────────────────
  // The modal hands us { dataUrl, file, name, size, type } for each slot
  // the user touched. A skipped/un-touched slot is null. We map slot →
  // backend kind so the controller routes to the right Cloudinary folder.
  const uploads = [];
  if (payload.photo?.file)           uploads.push(['photo',           payload.photo.file]);
  if (payload.nidFront?.file)        uploads.push(['nidFront',        payload.nidFront.file]);
  if (payload.nidBack?.file)         uploads.push(['nidBack',         payload.nidBack.file]);
  if (payload.professionProof?.file) uploads.push(['professionProof', payload.professionProof.file]);

  try {
    // ── 2. Upload to Cloudinary (sequential — keeps the admin's audit
    //      log readable, and Cloudinary's free tier doesn't love parallel
    //      bursts from the same user).
    for (const [kind, file] of uploads) {
      // uploadVerificationDoc already writes the returned user (with the
      // new *Url + *PublicId fields) back into AuthContext + localStorage
      // via persistSession's broadcast, so the dashboard's tenantProfile
      // hydration effect picks them up automatically.
      await uploadVerificationDoc(kind, file);
    }

    // ── 3. Persist non-file profile fields. PATCH /me whitelists exactly
    //      these keys (see auth.controller.additions.js).
    if (authUpdateMe) {
      await authUpdateMe({
        tenantProfile: {
          ...(payload.professionType ? { professionType: payload.professionType } : {}),
          ...(payload.workPlace      ? { workPlace:      payload.workPlace }      : {}),
          ...(payload.familySize     ? { familySize:     String(payload.familySize) } : {}),
          ...(payload.emergencyContact ? {
            emergencyContact: {
              name:  payload.emergencyContact.name  || '',
              phone: payload.emergencyContact.phone || '',
            },
          } : {}),
        },
      });
    }

    // ── 4. Flip verification → 'pending' on the server. The admin panel
    //      reads this status to populate its KYC queue. Without this call
    //      the docs land in Cloudinary but never reach an admin.
    if (authSubmitVerification) {
      // Read freshly-hydrated flags from authUser (uploadVerificationDoc
      // updated them) instead of trusting our local snapshot. This is the
      // line that makes "submit" actually visible to admins.
      const u = authUser || {};
      const v = u.tenantProfile?.verification || {};
      await authSubmitVerification({
        photo:           !!v.photo           || !!payload.photo?.file,
        nidFront:        !!v.nidFront        || !!payload.nidFront?.file,
        nidBack:         !!v.nidBack         || !!payload.nidBack?.file,
        professionProof: !!v.professionProof || !!payload.professionProof?.file,
      });
    }

    // ── 5. Local mirror so the UI doesn't have to wait for the next
    //      authUser refresh tick.
    const nextProfile = {
      ...tenantProfile,
      professionType: payload.professionType  || tenantProfile.professionType || '',
      workPlace:      payload.workPlace        || tenantProfile.workPlace      || '',
      familySize:     payload.familySize       ?? tenantProfile.familySize    ?? null,
      emergencyContact: {
        name:  payload.emergencyContact?.name  || tenantProfile.emergencyContact?.name  || '',
        phone: payload.emergencyContact?.phone || tenantProfile.emergencyContact?.phone || '',
      },
      verification: {
        ...tenantProfile.verification,
        photo:              !!payload.photo?.file           || !!tenantProfile.verification?.photo,
        nidFront:           !!payload.nidFront?.file        || !!tenantProfile.verification?.nidFront,
        nidBack:            !!payload.nidBack?.file         || !!tenantProfile.verification?.nidBack,
        professionProof:    !!payload.professionProof?.file || !!tenantProfile.verification?.professionProof,
        submittedForReview: true,
        status:             'pending',
      },
    };
    persistProfile(nextProfile);

    try {
      const _uid = authUser?.id || authUser?._id || null;
      const raw  = localStorage.getItem(tenantProfileKey(_uid));
      const cur  = raw ? JSON.parse(raw) : {};
      localStorage.setItem(tenantProfileKey(_uid), JSON.stringify({ ...cur, ...nextProfile }));
    } catch (err) {
      console.warn('[handleWizardSubmit] localStorage write failed:', err);
    }

    showProfileToast(
      language === 'বাংলা'
        ? 'রিভিউয়ের জন্য সাবমিট করা হয়েছে।'
        : 'Submitted for review.',
    );
    setVerifModalOpen(false);
  } catch (err) {
    console.error('[handleWizardSubmit] failed:', err);
    showProfileToast(
      language === 'বাংলা'
        ? `সাবমিট ব্যর্থ: ${err?.message || 'আবার চেষ্টা করুন।'}`
        : `Submit failed: ${err?.message || 'Please retry.'}`,
    );
    // Re-throw so the modal's catch block can show inline error too.
    throw err;
  }
};

  const submitVerification = async () => {
    persistProfile({
      ...tenantProfile,
      verification: {
        ...tenantProfile.verification,
        submittedForReview: true,
        status: 'pending',
      },
    });

    // Mirror the local "pending" state on the server so the public
    // trust card (LandlordProfile / TenantProfile / inquiry list) all
    // see the new status. We surface a toast either way — the local
    // copy is already pending, so failure is non-blocking.
    try {
      await authSubmitVerification?.({
        kind: 'tenant_documents',
        payload: {
          photo:           !!tenantProfile.verification.photo,
          nidFront:        !!tenantProfile.verification.nidFront,
          nidBack:         !!tenantProfile.verification.nidBack,
          professionProof: !!tenantProfile.verification.professionProof,
          professionType:  tenantProfile.professionType || '',
        },
      });
      showProfileToast(language === 'বাংলা' ? 'রিভিউয়ের জন্য সাবমিট করা হয়েছে।' : 'Submitted for review.');
    } catch (err) {
      showProfileToast(language === 'বাংলা'
        ? 'সাবমিশন সার্ভারে পৌঁছায়নি — পরে আবার চেষ্টা করুন।'
        : 'Submission failed to reach the server — please retry.');
    }
  };

  // 🟢 "Become a Landlord" — soft-warning upgrade flow. Roadmap-v2
  // Feature 4 + tenant-roadmap §T4 + Q2 approved answer ("Soft warning
  // only, allow first listing without NID"). Clicking the banner opens
  // a confirm step instead of immediately flipping the role:
  //
  //   • "Continue — verify later" → adds the `landlord` role on the
  //     server, flips the active role, and routes to /host-dashboard.
  //     Listing is NOT blocked on NID — the user can publish their
  //     first property right away.
  //   • "Verify NID first" → closes the confirm and switches to the
  //     Profile tab so the verification block is in view. No role
  //     change happens until the user comes back and confirms.
  //
  // Server-side role mutation is unchanged from the original "single
  // click" version — the only thing that moved is the trigger.
  const isAlsoLandlord = Array.isArray(authRoles) && authRoles.includes('landlord');
  const [hostUpgradePromptOpen, setHostUpgradePromptOpen] = useState(false);
  const performBecomeLandlord = async () => {
    setHostUpgradePromptOpen(false);
    try {
      if (!isAlsoLandlord) await authAddRole?.('landlord');
      await authSetActiveRole?.('landlord');
      navigate('/host-dashboard');
    } catch (err) {
      showProfileToast(language === 'বাংলা'
        ? 'হোস্ট মোডে যাওয়া যায়নি — পরে চেষ্টা করুন।'
        : 'Could not switch to host mode — please try again.');
    }
  };
  const openBecomeLandlordPrompt = () => setHostUpgradePromptOpen(true);
  const goVerifyNidFirst = () => {
    setHostUpgradePromptOpen(false);
    setActiveTab('profile');
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
    // Messages lives inside each inquiry thread — no separate route is
    // needed from the tenant's side. We hide this entry on mobile so the
    // small screen drawer doesn't feel duplicated; desktop keeps it for
    // power users who want the legacy /messages inbox.
    { id: 'messages', icon: MessageSquare, label: t.messages || (language === 'বাংলা' ? 'মেসেজ' : 'Messages'), isLink: true, path: '/messages', desktopOnly: true },
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

        {/* Header trimmed to match the public homepage navbar: logo +
            notification bell + tenant portal chip. The search bar and the
            language toggle were removed to mirror the host dashboard
            header. Since this is the tenant surface, there is intentionally
            NO "Add Property" or list-FAB here — tenants list nothing. */}

        <div className="flex items-center gap-3 md:gap-4 z-10 ml-auto">
          {/* Notifications — host-style chip with ping. */}
          <div className="relative cursor-pointer" ref={notifRef}>
            <button onClick={() => setIsNotifOpen(!isNotifOpen)} className="p-2 bg-white/60 rounded-xl hover:bg-white transition-all border border-white/80 shadow-sm relative group">
              <Bell size={18} className="text-gray-500 group-hover:text-blue-600 transition-colors" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#ba0036] opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#ba0036] border-2 border-white"></span>
                </span>
              )}
            </button>
            {isNotifOpen && (
              <div className="fixed sm:absolute top-[5.25rem] sm:top-full inset-x-3 sm:inset-auto sm:right-0 sm:mt-3 w-auto sm:w-72 max-h-[calc(100vh-6rem)] sm:max-h-none overflow-y-auto sm:overflow-visible bg-white/95 backdrop-blur-3xl border border-white shadow-[0_30px_60px_rgba(0,0,0,0.12)] rounded-[1.5rem] p-2 z-[100] animate-in fade-in zoom-in-95 origin-top-right">
                <div className="p-3 border-b border-gray-50 flex justify-between items-center">
                  <h3 className="text-[13px] font-black text-gray-900 tracking-tight">{t.notifications || (language === 'বাংলা' ? 'নোটিফিকেশন' : 'Notifications')}</h3>
                  {unreadCount > 0 && (
                    <span className="bg-[#ba0036]/10 text-[#ba0036] px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest">{unreadCount} {t.new || (language === 'বাংলা' ? 'নতুন' : 'New')}</span>
                  )}
                </div>
                <div className="p-1.5 space-y-1.5 max-h-[300px] overflow-y-auto">
                  {notifications.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-4">{language === 'বাংলা' ? 'কোনো নোটিফিকেশন নেই' : 'No notifications'}</p>
                  ) : (
                    notifications.map(notif => (
                      <div key={notif.id} onClick={async () => {
                          if (!notif.read) {
                            try {
                              await markRead(notif.id);
                              setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read: true } : n));
                              setUnreadCount(prev => Math.max(0, prev - 1));
                            } catch (err) {}
                          }
                          setIsNotifOpen(false);
                        }}
                        className={`p-3 rounded-2xl border cursor-pointer hover:bg-white hover:shadow-sm transition-all group ${!notif.read ? 'bg-blue-50/50 border-blue-100' : 'bg-gray-50 border-gray-100'}`}
                      >
                        <p className={`text-xs font-bold leading-tight mb-1.5 transition-colors ${!notif.read ? 'text-blue-900 group-hover:text-blue-600' : 'text-gray-800 group-hover:text-[#ba0036]'}`}>{notif.title || notif.body}</p>
                        {notif.title && notif.body && <p className="text-[11px] text-gray-500 mb-2 truncate">{notif.body}</p>}
                        <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1">
                          {!notif.read && <span className="w-1 h-1 bg-blue-500 rounded-full"></span>}
                          {new Date(notif.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Avatar — opens right-drawer (replaces dropdown menu). */}
          <button onClick={() => setIsProfileDrawerOpen(true)} className="flex items-center gap-2 p-1 pr-3 bg-white/60 rounded-xl border border-white/80 shadow-sm hover:shadow-md hover:bg-white transition-all active:scale-95">
            <div className="relative">
              <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-sm border border-blue-100 overflow-hidden">
                {authUser?.avatar ? (
                  <img
                    key={authUser.avatar}
                    src={authUser.avatar}
                    alt={loggedInUser}
                    className="w-full h-full object-cover"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                ) : (
                  loggedInUser.charAt(0)
                )}
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
              <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-lg border border-blue-100 group-hover:scale-105 transition-transform overflow-hidden">
                {authUser?.avatar ? (
                  <img
                    key={authUser.avatar}
                    src={authUser.avatar}
                    alt={loggedInUser}
                    className="w-full h-full object-cover"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                ) : (
                  loggedInUser.charAt(0)
                )}
              </div>
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
            // desktopOnly = hide from the drawer on mobile widths. Messaging
            // already happens inside each inquiry/application thread on phones,
            // so the standalone /messages entry would feel duplicate there.
            const hideOnMobileCls = item.desktopOnly ? 'hidden md:flex' : 'flex';
            return (
              <button
                key={item.id}
                onClick={() => { if (item.isLink) navigate(item.path); else setActiveTab(item.id); setIsProfileDrawerOpen(false); }}
                className={`${hideOnMobileCls} w-full items-center gap-3 px-4 py-3 rounded-xl cursor-pointer font-bold text-xs text-left transition-all duration-300 ${isActive ? 'bg-red-50 text-[#ba0036]' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'}`}
              >
                <item.icon size={16} className={isActive ? "text-[#ba0036]" : "text-gray-400"} />
                <span className="flex-1 tracking-wide">{item.label}</span>
                {item.badge ? <span className="bg-[#ba0036] text-white text-[9px] font-black px-2 py-0.5 rounded-full min-w-[18px] text-center">{item.badge}</span> : null}
              </button>
            );
          })}
        </nav>

        {/* Bottom: logout only. Tenants have no subscription model — the
            "Upgrade to Premium" button was removed per product decision
            (we monetise landlords, not tenants). */}
        <div className="p-5 border-t border-gray-100 bg-gray-50/50 flex flex-col gap-3 mt-auto">
          <button
            onClick={async () => {
              showProfileToast(language === 'বাংলা' ? 'লগআউট হচ্ছে...' : 'Logging out...');
              try { await authLogout(); } finally { setIsProfileDrawerOpen(false); navigate('/'); }
            }}
            className="flex items-center justify-center gap-2 text-[#3b2a2a] hover:text-[#ba0036] font-bold transition-colors w-full py-1.5 group"
          >
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

        {/* 🔵 DESKTOP-ONLY BACK ROW — only visible on md+ widths.
            Mobile users navigate back via the browser/system gesture or
            the existing drawer, so we intentionally do NOT render a
            button there (it would just clutter the small canvas). Shown
            on every non-overview tab so the desktop user can return to
            the rental journey home with one click. Each tab carries its
            own readable title here so users always know where they are. */}
        {activeTab !== 'overview' && (
          <div className="hidden md:flex items-center justify-between mb-5">
            <button
              onClick={() => setActiveTab('overview')}
              className="group inline-flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-white/80 border border-gray-100 hover:border-gray-300 text-gray-600 hover:text-[#ba0036] text-[12px] font-black shadow-sm backdrop-blur-sm transition-all active:scale-95"
            >
              <ChevronLeft size={14} className="-ml-1 group-hover:-translate-x-0.5 transition-transform" />
              {language === 'বাংলা' ? 'ওভারভিউতে ফিরে যান' : 'Back to overview'}
            </button>
            <p className="text-[11px] font-black text-gray-400 uppercase tracking-[0.18em]">
              {{
                profile:      language === 'বাংলা' ? 'আমার প্রোফাইল'         : 'My Profile',
                saved:        language === 'বাংলা' ? 'সেভ করা প্রপার্টি'      : 'Saved Properties',
                applications: language === 'বাংলা' ? 'আমার ইনকোয়ারি'        : 'My Inquiries',
                payments:     language === 'বাংলা' ? 'পেমেন্ট ও রিসিট'        : 'Payments & Receipts',
                settings:     language === 'বাংলা' ? 'অ্যাকাউন্ট সেটিংস'      : 'Account Settings',
                support:      language === 'বাংলা' ? 'হেল্প ও সাপোর্ট'        : 'Help & Support',
              }[activeTab] || ''}
            </p>
          </div>
        )}

        {/* 🔴 TAB 1: OVERVIEW — rebuilt to match the Canva mockup.
            Order: Become-a-Landlord banner (when not yet a landlord) →
            verification banner → 3 stat cards → Quick Search →
            Upcoming Tours. The Trust-Score peek now lives inside the
            Profile tab (still wired to the same `computeTrustScore`
            helper, just no longer cluttering the home view). */}
        {activeTab === 'overview' && (
          <>
            {/* ── VERIFICATION REJECTED BANNER ────────────────────────────
                Surfaces the admin's rejection reason so the user understands
                what to fix, with a one-tap "resubmit" CTA that re-opens the
                same modal. Without this banner a rejected user would see a
                blank dashboard and assume nothing happened. Backend field:
                tenantProfile.verification.rejectionReason — set by
                admin.controller.js → rejectUser(). */}
            {verifRejected && (
              <div className="mb-5 md:mb-7 rounded-[1.5rem] md:rounded-[2rem] p-5 md:p-6 bg-white border-2 border-[#ba0036]/15 shadow-[0_8px_30px_-10px_rgba(186,0,54,0.15)] relative overflow-hidden">
                <div className="flex flex-col md:flex-row md:items-start gap-4 md:gap-5">
                  <div className="shrink-0 w-12 h-12 md:w-14 md:h-14 rounded-2xl bg-[#ba0036]/10 text-[#ba0036] flex items-center justify-center">
                    <ShieldAlert size={22} strokeWidth={2.4} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#ba0036] mb-1">
                      {language === 'বাংলা' ? 'ভেরিফিকেশন বাতিল' : 'Verification rejected'}
                    </p>
                    <h3 className="text-lg md:text-xl font-black text-gray-900 leading-tight">
                      {language === 'বাংলা'
                        ? 'আপনার ডকুমেন্ট গ্রহণ করা হয়নি'
                        : 'Your submission wasn’t accepted'}
                    </h3>
                    {rejectionReason ? (
                      <div className="mt-3 p-3 rounded-xl bg-[#ba0036]/5 border border-[#ba0036]/10">
                        <p className="text-[10px] font-black uppercase tracking-widest text-[#ba0036] mb-1">
                          {language === 'বাংলা' ? 'অ্যাডমিনের মন্তব্য' : 'Admin note'}
                        </p>
                        <p className="text-sm font-bold text-gray-800 leading-snug">
                          {rejectionReason}
                        </p>
                      </div>
                    ) : (
                      <p className="mt-2 text-sm font-bold text-gray-600 leading-snug">
                        {language === 'বাংলা'
                          ? 'অনুগ্রহ করে আপনার তথ্য পুনরায় চেক করে আবার জমা দিন।'
                          : 'Please review your information and submit again.'}
                      </p>
                    )}
                    <button
                      onClick={() => setVerifModalOpen(true)}
                      className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#ba0036] to-[#d11147] text-white font-black text-sm shadow-[0_8px_20px_rgba(186,0,54,0.25)] hover:shadow-[0_12px_30px_rgba(186,0,54,0.35)] hover:-translate-y-0.5 transition-all"
                    >
                      <RefreshCw size={14} />
                      {language === 'বাংলা' ? 'আবার চেষ্টা করুন' : 'Try again'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── BECOME A LANDLORD BANNER (roadmap-v2 §4 / tenant §T4) ──
                Only renders when the user does NOT yet have the landlord
                role on their account. One click adds the role on the
                server and flips them into host mode. Verified tenants get
                a subtle "your trust score carries over" line so they know
                they don't lose progress when switching modes. */}
            {!isAlsoLandlord && (
              <div className="mb-5 md:mb-7 rounded-[1.5rem] md:rounded-[2rem] p-5 md:p-6 bg-gradient-to-br from-[#ba0036] via-[#7c0026] to-[#3a0011] text-white shadow-[0_20px_50px_-20px_rgba(186,0,54,0.5)] relative overflow-hidden">
                <div className="absolute -top-16 -right-16 w-56 h-56 bg-white/10 rounded-full blur-3xl pointer-events-none" />
                <div className="relative flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
                  <div className="shrink-0 w-12 h-12 md:w-14 md:h-14 rounded-2xl bg-white/15 flex items-center justify-center backdrop-blur-md border border-white/15">
                    <Home size={22} strokeWidth={2.4} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-rose-200 mb-1">
                      {language === 'বাংলা' ? 'নতুন!' : 'New'}
                    </p>
                    <h3 className="text-lg md:text-xl font-black leading-tight">
                      {language === 'বাংলা' ? 'বাড়িওয়ালা হয়ে আপনার সম্পত্তি লিস্ট করুন' : 'Become a landlord — list your property'}
                    </h3>
                    <p className="mt-1 text-[12px] md:text-sm font-bold text-white/75 leading-snug max-w-prose">
                      {isVerified
                        ? (language === 'বাংলা'
                            ? 'আপনার ভেরিফাইড ট্রাস্ট স্কোর হোস্ট প্রোফাইলে চলে যাবে।'
                            : 'Your verified trust score carries over to your host profile.')
                        : (language === 'বাংলা'
                            ? 'এক ক্লিকেই হোস্ট মোডে যান — কোনো নতুন একাউন্ট লাগবে না।'
                            : 'One click to switch into host mode — no separate account required.')}
                    </p>
                  </div>
                  <button
                    onClick={openBecomeLandlordPrompt}
                    className="shrink-0 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-white text-[#ba0036] font-black text-sm shadow-[0_10px_25px_rgba(0,0,0,0.25)] hover:scale-105 active:scale-95 transition-transform"
                  >
                    {language === 'বাংলা' ? 'হোস্ট হন' : 'Become a Host'} <ArrowRight size={15} />
                  </button>
                </div>
              </div>
            )}

            {/* ── BECOME A LANDLORD — soft NID warning (Q2 approved) ──
                The first-listing flow is intentionally not blocked on
                NID verification. We just surface a friendly heads-up so
                the user knows verifying lifts their trust score, but
                they can still continue and publish immediately.
                Roadmap-v2 §4 / tenant-roadmap §T4. */}
            {hostUpgradePromptOpen && (
              <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                <div className="w-full max-w-md bg-white rounded-[1.75rem] shadow-2xl border border-gray-100 p-6 md:p-7 relative">
                  <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mb-4">
                    <ShieldCheck size={22} strokeWidth={2.4} />
                  </div>
                  <h4 className="text-lg md:text-xl font-black text-gray-900 leading-tight mb-2">
                    {language === 'বাংলা'
                      ? 'হোস্ট হতে এনআইডি লাগবে না'
                      : 'You can list without NID verification'}
                  </h4>
                  <p className="text-[13px] md:text-sm font-bold text-gray-500 leading-relaxed mb-5">
                    {language === 'বাংলা'
                      ? 'এনআইডি যাচাই না করে এখনই প্রথম প্রপার্টি লিস্ট করতে পারবেন। তবে যাচাই করলে আপনার ট্রাস্ট স্কোর বাড়বে এবং বেশি ইনকোয়ারি পাবেন।'
                      : 'You can publish your first property right now without verifying your NID. Verifying later raises your trust score and brings in more inquiries.'}
                  </p>
                  <div className="flex flex-col gap-3">
                    <button
                      onClick={performBecomeLandlord}
                      className="w-full py-3 rounded-2xl bg-[#ba0036] text-white font-black text-sm shadow-[0_8px_24px_rgba(186,0,54,0.25)] hover:bg-[#90002a] active:scale-[0.99] transition-all"
                    >
                      {language === 'বাংলা' ? 'কন্টিনিউ — পরে যাচাই করব' : 'Continue — verify later'}
                    </button>
                    <button
                      onClick={goVerifyNidFirst}
                      className="w-full py-3 rounded-2xl bg-gray-50 text-gray-700 font-black text-sm border border-gray-100 hover:bg-gray-100 active:scale-[0.99] transition-all"
                    >
                      {language === 'বাংলা' ? 'আগে এনআইডি যাচাই করুন' : 'Verify NID first'}
                    </button>
                    <button
                      onClick={() => setHostUpgradePromptOpen(false)}
                      className="w-full py-2 text-[12px] font-bold text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      {language === 'বাংলা' ? 'বাতিল' : 'Cancel'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── VERIFICATION BANNER — futuristic rebuild ───────────────
                Dark glassy card with a holographic red→indigo accent
                gradient, a "breathing" shield icon ringed by two animated
                pulse rings, a shimmering progress bar, and a CTA that
                stacks UNDER the copy on mobile so the headline never
                gets squashed into a 3-line column. The same component
                covers three states:
                  - not started / in progress (default)
                  - submitted for review (`verifPending`)
                  - verified (`isVerified`) — flips to a green success row */}
            {!isVerified ? (
              <div className="mb-5 md:mb-7 relative overflow-hidden rounded-[1.5rem] md:rounded-[2rem] p-[1px] bg-gradient-to-br from-[#ba0036]/40 via-rose-400/20 to-indigo-500/30 shadow-[0_20px_60px_-20px_rgba(186,0,54,0.35)]">
                {/* Inline keyframes for shimmer + breathing pulse rings. */}
                <style>{`
                  @keyframes tolet-shimmer {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(200%); }
                  }
                  @keyframes tolet-breath {
                    0%, 100% { transform: scale(1); opacity: 0.5; }
                    50%      { transform: scale(1.08); opacity: 0.9; }
                  }
                  @keyframes tolet-grid-drift {
                    0%   { background-position: 0 0; }
                    100% { background-position: 32px 32px; }
                  }
                `}</style>

                <div className="relative rounded-[calc(1.5rem-1px)] md:rounded-[calc(2rem-1px)] bg-gradient-to-br from-[#1a0a14] via-[#2a0a18] to-[#15042b] p-5 md:p-7 overflow-hidden">
                  {/* Holographic background layer: faint dot-grid that
                      slowly drifts diagonally + a couple of soft glow
                      orbs. Pure decoration; pointer-events disabled. */}
                  <div
                    className="absolute inset-0 opacity-[0.08] pointer-events-none"
                    style={{
                      backgroundImage: 'radial-gradient(rgba(255,255,255,0.9) 1px, transparent 1px)',
                      backgroundSize: '16px 16px',
                      animation: 'tolet-grid-drift 18s linear infinite',
                    }}
                  />
                  <div className="absolute -top-24 -left-24 w-64 h-64 bg-[#ba0036]/40 rounded-full blur-3xl pointer-events-none" />
                  <div className="absolute -bottom-32 -right-24 w-72 h-72 bg-indigo-500/25 rounded-full blur-3xl pointer-events-none" />

                  <div className="relative z-10 flex flex-col md:flex-row md:items-center gap-5 md:gap-6">
                    {/* LEFT: animated shield with two breathing pulse rings */}
                    <div className="relative shrink-0 self-start md:self-center">
                      <span
                        className="absolute inset-0 -m-2 rounded-[1.4rem] bg-[#ba0036]/40 blur-md"
                        style={{ animation: 'tolet-breath 2.6s ease-in-out infinite' }}
                      />
                      <span
                        className="absolute inset-0 -m-4 rounded-[1.6rem] border border-[#ba0036]/40"
                        style={{ animation: 'tolet-breath 2.6s ease-in-out infinite 0.6s' }}
                      />
                      <div className="relative w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-gradient-to-br from-[#ff4d6d] via-[#ba0036] to-[#65001e] text-white flex items-center justify-center shadow-[0_10px_30px_-10px_rgba(255,77,109,0.6)] border border-white/10">
                        <Shield size={26} strokeWidth={2.3} />
                      </div>
                    </div>

                    {/* CENTER: pre-label + headline + subcopy */}
                    <div className="flex-1 min-w-0 text-white">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/10 border border-white/15 text-[10px] font-black tracking-[0.18em] uppercase text-rose-200 backdrop-blur-sm">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-rose-300" />
                          </span>
                          {language === 'বাংলা' ? 'আইডেন্টিটি ভেরিফিকেশন' : 'Identity Verification'}
                        </span>
                        <span className="hidden sm:inline-flex text-[9px] font-black tracking-widest uppercase text-white/40">
                          {language === 'বাংলা' ? 'এআই' : 'AI'}-secured
                        </span>
                      </div>
                      <h3 className="text-lg md:text-2xl font-black tracking-tight leading-tight">
                        {verifPending
                          ? (language === 'বাংলা' ? 'রিভিউয়ের জন্য সাবমিট হয়েছে' : 'Submitted for review')
                          : (language === 'বাংলা' ? 'আপনার অ্যাকাউন্ট ভেরিফাই করুন' : 'Verify your account')}
                      </h3>
                      <p className="mt-1.5 text-[12px] md:text-sm font-bold text-white/65 leading-snug max-w-prose">
                        {verifPending
                          ? (language === 'বাংলা' ? 'আমরা আপনার ডকুমেন্ট যাচাই করছি। সাধারণত ২৪ ঘণ্টার মধ্যে শেষ হয়।' : 'We\u2019re reviewing your documents. Usually done within 24 hours.')
                          : (language === 'বাংলা' ? 'ভেরিফাইড ভাড়াটিয়ারা বাড়িওয়ালার কাছ থেকে দ্রুত অ্যাপ্রুভাল পান।' : 'Verified tenants get faster landlord approvals.')}
                      </p>
                    </div>
                  </div>

                  {/* PROGRESS + CTA — full-width on mobile, side-by-side
                      on md+. The progress bar carries a moving "shimmer"
                      sweep so it feels alive even when stuck at 0%. */}
                  <div className="relative z-10 mt-5 md:mt-6 flex flex-col md:flex-row md:items-center gap-3 md:gap-5">
                    <div className="flex-1 flex items-center gap-3">
                      <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden relative">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#ff4d6d] via-[#ba0036] to-[#ff4d6d] transition-[width] duration-700 shadow-[0_0_12px_rgba(255,77,109,0.6)]"
                          style={{ width: `${Math.max(verifPct, 4)}%` }}
                        />
                        {/* Shimmer sweep */}
                        <div
                          className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/40 to-transparent"
                          style={{ animation: 'tolet-shimmer 2.4s linear infinite' }}
                        />
                      </div>
                      <span className="text-xs font-black text-white tabular-nums shrink-0">{verifPct}%</span>
                    </div>
                    <button
                      onClick={() => setActiveTab('profile')}
                      className="group w-full md:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-gradient-to-r from-[#ff4d6d] via-[#ba0036] to-[#90002a] text-white font-black text-xs md:text-sm shadow-[0_12px_30px_-8px_rgba(255,77,109,0.55)] hover:shadow-[0_18px_40px_-8px_rgba(255,77,109,0.7)] hover:-translate-y-0.5 active:translate-y-0 transition-all whitespace-nowrap relative overflow-hidden"
                    >
                      <span
                        className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                        style={{ animation: 'tolet-shimmer 2.8s linear infinite' }}
                      />
                      <ScanFace size={15} strokeWidth={2.5} className="relative z-10" />
                      <span className="relative z-10">
                        {verifPending
                          ? (language === 'বাংলা' ? 'ডকুমেন্ট দেখুন' : 'Review documents')
                          : (language === 'বাংলা' ? 'ভেরিফাই করুন' : 'Get verified')}
                      </span>
                      <ArrowRight size={14} className="relative z-10 group-hover:translate-x-0.5 transition-transform" />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mb-5 md:mb-7 rounded-[1.5rem] border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-emerald-50/60 p-4 md:p-5 flex items-center gap-3 shadow-[0_10px_30px_-15px_rgba(16,185,129,0.4)]">
                <div className="relative shrink-0">
                  <span className="absolute inset-0 rounded-2xl bg-emerald-400/40 blur-md animate-pulse" />
                  <div className="relative w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white flex items-center justify-center shadow">
                    <BadgeCheck size={22} />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-emerald-700">{language === 'বাংলা' ? 'আপনি ভেরিফাইড' : "You're verified"}</p>
                  <p className="text-[11px] font-bold text-emerald-700/80">{language === 'বাংলা' ? 'বাড়িওয়ালারা আপনার প্রোফাইল সবুজ ব্যাজ-সহ দেখেন।' : 'Landlords see your profile with a green verified badge.'}</p>
                </div>
              </div>
            )}

            {/* ── 3 STAT CARDS — Saved · Applications · Payments ─────────
                Each card carries: pastel rounded-square icon, big tabular
                number, a colored underline bar (mockup uses a short
                colored stripe under the count). Tap → drills into the
                matching tab. The Applications count uses a stub today
                (matches the 3-row sample list in the Applications tab);
                swap to the backend's `GET /api/tenant/applications`
                response when wiring real data. */}
            <div className="grid grid-cols-3 gap-3 md:gap-5 mb-5 md:mb-7">
              {[
                {
                  id: 'saved',
                  icon: Heart,
                  iconBg: 'bg-rose-100',
                  iconColor: 'text-[#ba0036]',
                  label: language === 'বাংলা' ? 'সেভ করা' : 'SAVED',
                  value: savedProperties.length,
                  bar: 'bg-[#ba0036]',
                  onClick: () => setActiveTab('saved'),
                },
                {
                  // 🔵 Same destination as the drawer's "My Inquiries"
                  // entry — the two used to read as different features
                  // ("Applications" vs "Inquiries"). Unified copy here so
                  // the user never has to wonder whether they are the same
                  // thing. They are.
                  id: 'applications',
                  icon: CalendarCheck,
                  iconBg: 'bg-emerald-100',
                  iconColor: 'text-emerald-600',
                  label: language === 'বাংলা' ? 'ইনকোয়ারি' : 'INQUIRIES',
                  value: 2,
                  bar: 'bg-emerald-500',
                  onClick: () => setActiveTab('applications'),
                },
                {
                  id: 'payments',
                  icon: DollarSign,
                  iconBg: 'bg-violet-100',
                  iconColor: 'text-violet-600',
                  label: language === 'বাংলা' ? 'পেমেন্ট' : 'PAYMENTS',
                  value: paymentReceipts.length,
                  bar: 'bg-violet-500',
                  badge: unreadReceiptsCount > 0 ? unreadReceiptsCount : null,
                  onClick: () => setActiveTab('payments'),
                },
              ].map((stat) => (
                <button
                  key={stat.id}
                  onClick={stat.onClick}
                  className="relative text-left bg-white/90 backdrop-blur-sm p-4 md:p-6 rounded-2xl md:rounded-[1.5rem] border border-white shadow-[0_4px_20px_rgba(15,23,42,0.04)] flex flex-col items-center md:items-start gap-2 md:gap-3 hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(15,23,42,0.08)] transition-all duration-300"
                >
                  <div className={`w-9 h-9 md:w-11 md:h-11 rounded-2xl ${stat.iconBg} ${stat.iconColor} flex items-center justify-center shadow-sm`}>
                    <stat.icon size={16} className="md:w-[20px] md:h-[20px]" strokeWidth={2.4} />
                  </div>
                  <p className="text-[8px] md:text-[10px] font-black text-gray-400 uppercase tracking-[0.14em] leading-tight">{stat.label}</p>
                  <div className="flex items-end gap-2">
                    <h3 className="text-3xl md:text-[2.75rem] font-black text-gray-900 leading-none tabular-nums tracking-tight">{stat.value}</h3>
                    {stat.badge ? (
                      <span className="inline-flex items-center gap-1 bg-[#ba0036] text-white text-[8px] md:text-[10px] font-black px-1.5 md:px-2 py-0.5 rounded-full mb-1 shadow-sm">
                        <span className="w-1 h-1 bg-white rounded-full animate-pulse" />
                        {stat.badge}
                      </span>
                    ) : null}
                  </div>
                  <div className={`h-1 rounded-full ${stat.bar} w-8 md:w-10 mt-0.5`} />
                </button>
              ))}
            </div>

            {/* ── QUICK SEARCH — single CTA, plus an AI-detected
                location suggestion line. We read the device's coarse
                location (Geolocation API, prompts the user once and
                caches), reverse-geocode the closest popular area, and
                surface it as "Looking around <Area>? See nearby homes →".
                Falls back gracefully (no permission / no API key) to a
                generic suggestion string so the card layout is stable. */}
            <div className="mb-5 md:mb-7 rounded-[1.5rem] md:rounded-[2rem] border border-white bg-white/95 backdrop-blur-sm shadow-[0_4px_20px_rgba(15,23,42,0.04)] p-5 md:p-7">
              <p className="text-[10px] font-black text-[#ba0036] uppercase tracking-[0.18em] mb-1">{language === 'বাংলা' ? 'কুইক সার্চ' : 'Quick Search'}</p>
              <h3 className="text-xl md:text-2xl font-black text-gray-900 mb-4">
                {language === 'বাংলা' ? 'আপনার পরবর্তী বাড়ি খুঁজুন' : 'Find your next home'}
              </h3>
              <Link
                to="/properties/all"
                className="w-full inline-flex items-center justify-center gap-2 bg-[#ba0036] hover:bg-[#90002a] text-white py-3.5 md:py-4 rounded-2xl font-black text-sm shadow-[0_10px_25px_rgba(186,0,54,0.25)] hover:shadow-[0_14px_30px_rgba(186,0,54,0.35)] transition-all"
              >
                <Search size={16} /> {language === 'বাংলা' ? 'সব প্রপার্টি দেখুন' : 'Browse all properties'} <ArrowRight size={14} />
              </Link>

              {/* AI suggestion line — reads the tenant's coarse location
                  once, reverse-maps to the nearest popular area, and
                  presents a one-tap deep link into the matching listing
                  feed. The hook lives in `useNearbyAreaSuggestion()`
                  below and gracefully no-ops when geolocation is
                  unavailable or the user denies the prompt. */}
              <NearbyAreaSuggestion language={language} />
            </div>

            {/* ── UPCOMING TOURS ─────────────────────────────────────── */}
            <div className="relative bg-white/95 backdrop-blur-sm p-5 md:p-7 rounded-[1.5rem] md:rounded-[2rem] border border-white shadow-[0_4px_20px_rgba(15,23,42,0.04)] overflow-hidden">
              <div className="relative z-10 flex items-center justify-between mb-5 md:mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#ba0036] to-rose-500 text-white flex items-center justify-center shadow-md">
                    <Calendar size={18} strokeWidth={2.5} />
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-[#ba0036] uppercase tracking-[0.16em]">
                      {language === 'বাংলা' ? 'ভিজিট সিডিউল' : 'TOUR SCHEDULE'}
                    </p>
                    <h3 className="text-base md:text-lg font-black text-gray-900 leading-tight">
                      {t.upcomingTours || (language === 'বাংলা' ? 'আসন্ন ট্যুর' : 'Upcoming Tours')}
                    </h3>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-black uppercase tracking-widest border border-emerald-100">
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                  {language === 'বাংলা' ? 'এই সপ্তাহে' : 'This week'}
                </span>
              </div>

              <div className="relative z-10 flex flex-col gap-3">
                {/* Tour row — gradient date chip, property + location, time pill */}
                <div className="flex items-center gap-3 md:gap-4 p-4 md:p-5 bg-white border border-gray-100 rounded-2xl">
                  <div className="bg-gradient-to-br from-[#ba0036] via-rose-500 to-orange-500 text-center p-3 rounded-2xl shadow-[0_6px_16px_rgba(186,0,54,0.22)] min-w-[60px] md:min-w-[72px]">
                    <p className="text-[9px] font-black text-white/90 uppercase tracking-[0.16em]">OCT</p>
                    <p className="text-2xl md:text-3xl font-black text-white leading-none mt-0.5 tabular-nums">25</p>
                    <p className="text-[8px] font-black text-white/80 uppercase tracking-widest mt-0.5">SUN</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm md:text-base font-black text-gray-900 truncate">Elegant 3BHK with Skyline View</h4>
                    <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] font-bold text-gray-500">
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin size={11} className="text-gray-400" /> Gulshan 2, Dhaka
                      </span>
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                        <Clock size={10} /> 5:00 PM
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => navigate('/messages')}
                  className="w-full inline-flex items-center justify-center gap-2 py-3 bg-white text-[#ba0036] border border-[#ba0036]/20 rounded-2xl font-black text-xs hover:bg-[#ba0036] hover:text-white hover:border-[#ba0036] transition-all"
                >
                  <MessageSquare size={14} /> {t.contactHost || (language === 'বাংলা' ? 'যোগাযোগ' : 'Contact')}
                </button>
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
            {/* === SHARED PROFILE SECTION (Session 2 - Blueprint v2) ===
                 Replaces the old Header Card + Personal Info Card.
                 HostDashboard will use the same component with role="landlord". */}
            <ProfileSection
              role="tenant"
              user={authUser || {}}
              profile={tenantProfile}
              trustScore={trustScore}
              verificationStatus={tenantProfile?.verification?.status || 'unverified'}
              language={language}
              onUpdate={async (patch) => {
                // 1) Build the new local profile so the UI updates instantly.
                const next = applyPatch(tenantProfile, patch);
                persistProfile(next);

                // 2) Sync to backend — but ONLY the paths that actually changed.
                //    Sending the entire tenantProfile would let empty strings
                //    overwrite previously-saved fields (e.g. saving the name
                //    would wipe phone & relation because we sent them as '').
                //    That was the real cause of "save click করলে data চলে যায়"।
                if (!authUpdateMe) return;

                const topLevel = {};
                const nested   = {};
                for (const [path, value] of Object.entries(patch || {})) {
                  // Identity-level keys → top of user document
                  if (path === 'fullName' || path === 'name') { topLevel.name = value; continue; }
                  if (path === 'email')                       { topLevel.email = value; continue; }
                  if (path === 'dateOfBirth')                 { topLevel.dateOfBirth = value; continue; }

                  // Anything else lives under tenantProfile.*
                  // Walk dotted paths so 'emergencyContact.relation' nests
                  // correctly inside { emergencyContact: { relation: ... } }.
                  const parts = path.split('.');
                  let cursor = nested;
                  for (let i = 0; i < parts.length - 1; i++) {
                    const k = parts[i];
                    if (!cursor[k] || typeof cursor[k] !== 'object') cursor[k] = {};
                    cursor = cursor[k];
                  }
                  cursor[parts[parts.length - 1]] = value;
                }

                const payload = { ...topLevel };
                if (Object.keys(nested).length > 0) payload.tenantProfile = nested;
                if (Object.keys(payload).length === 0) return;

                try {
                  await authUpdateMe(payload);
                } catch (err) {
                  console.warn('[ProfileSection.onUpdate] backend sync failed:', err?.message || err);
                  showProfileToast(language === 'বাংলা'
                    ? 'লোকালি সেভ — সার্ভার সিঙ্ক পরে হবে'
                    : 'Saved locally — server sync pending');
                }
              }}
              onAvatarUpload={async (file, _source, onProgress) => {
                // CRITICAL FIX: আগে uploadVerificationDoc('photo', ...) call হচ্ছিল
                // যেটা শুধু tenantProfile.verification.photoUrl set করে —
                // user.avatar untouched থাকে। তাই Navbar + public profile-এ
                // avatar update দেখাচ্ছিল না।
                //
                // এখন uploadAvatar use করছি — এটা POST /me/avatar hit করে,
                // user.avatar field properly set করে, response-এ updated
                // user object দেয় (authService cache + broadcast)। AuthContext
                // automatically broadcast subscribe করে — Navbar + TenantProfile
                // সব জায়গায় instantly update হবে কোনো extra setState লাগবে না।
                try {
                  await uploadAvatar(file, { onProgress });
                  // No need to setTenant / persistProfile here — authService
                  // already writes to KEY_USER and broadcasts. AuthContext
                  // re-renders all subscribers with the fresh user object.
                } catch (err) {
                  console.error('[AvatarUpload] failed:', err?.message || err);
                  throw err; // AvatarUploader UI rolls back optimistic preview
                }
              }}
              onOpenVerification={() => {
                // Server-side status takes priority — don't re-prompt a
                // user who's already been approved or whose submission is
                // mid-review. Mirrors the same guard HostDashboard uses
                // so the "verify once" promise holds on both surfaces.
                if (isVerified) {
                  showProfileToast(
                    language === 'বাংলা'
                      ? 'আপনি ইতিমধ্যেই ভেরিফাইড।'
                      : 'You are already verified.',
                  );
                  return;
                }
                if (verifPending) {
                  showProfileToast(
                    language === 'বাংলা'
                      ? 'আপনার সাবমিশন এখনও রিভিউতে আছে।'
                      : 'Your submission is under review.',
                  );
                  return;
                }
                setVerifModalOpen(true);
              }}
            />

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

        {/* 🟢 INQUIRIES TAB — single source of truth for what the overview
            cards call "Inquiries" and the drawer calls "My Inquiries". The
            5-stage pipeline tells the tenant exactly where each inquiry
            stands: did it reach the landlord, has the landlord seen it,
            are they replying, has a tour been booked or a decision made.
            That language is intentionally tenant-empathetic — most renters
            in Bangladesh worry that landlords are ignoring them; showing
            real status reduces anxiety and chasing. */}
        {activeTab === 'applications' && (() => {
          // Each stage has an `en` (short pill label), `sub` (one-line
          // explainer shown under the active stage), and a Bengali parity.
          const stages = [
            { id: 'sent',     icon: Send,          en: 'Sent',      bn: 'পাঠানো',         subEn: 'Inquiry on its way',      subBn: 'ইনকোয়ারি যাচ্ছে' },
            { id: 'reached',  icon: Inbox,         en: 'Reached',   bn: 'পৌঁছেছে',         subEn: 'Landlord notified',       subBn: 'মালিককে জানানো হয়েছে' },
            { id: 'viewed',   icon: Eye,           en: 'Viewed',    bn: 'দেখেছেন',         subEn: 'Landlord opened it',      subBn: 'মালিক দেখেছেন' },
            { id: 'replied',  icon: MessageCircle, en: 'Replied',   bn: 'রিপ্লাই',          subEn: 'Conversation started',    subBn: 'কথা শুরু হয়েছে' },
            { id: 'decision', icon: CheckCircle2,  en: 'Decision',  bn: 'সিদ্ধান্ত',        subEn: 'Tour or final answer',    subBn: 'ভিজিট অথবা চূড়ান্ত উত্তর' },
          ];
          // Map the backend Inquiry record onto the 5-stage UI:
          //   new       → "Reached"   (server has it; landlord hasn't acted)
          //   active    → "Replied"   (landlord is actively handling it)
          //   converted → "Decision" + outcome "approved"  (booked)
          //   rejected  → "Decision" + outcome "declined"
          //   archived  → "Decision" + outcome "declined"
          const stageOf = (status) => {
            switch (status) {
              case 'active':    return 3;
              case 'converted': return 4;
              case 'rejected':  return 4;
              case 'archived':  return 4;
              case 'new':
              default:          return 1;
            }
          };
          const outcomeOf = (status) => {
            if (status === 'converted') return 'approved';
            if (status === 'rejected' || status === 'archived') return 'declined';
            return 'pending';
          };
          const fmtDate = (iso) => {
            if (!iso) return '—';
            try {
              return new Date(iso).toLocaleDateString(undefined, {
                month: 'short', day: 'numeric', year: 'numeric',
              });
            } catch { return '—'; }
          };
          const relTime = (iso) => {
            if (!iso) return '';
            const ms = Date.now() - new Date(iso).getTime();
            if (!Number.isFinite(ms) || ms < 0) return 'just now';
            const m = Math.floor(ms / 60000);
            if (m < 1)  return 'just now';
            if (m < 60) return `${m}m ago`;
            const h = Math.floor(m / 60);
            if (h < 24) return `${h}h ago`;
            const d = Math.floor(h / 24);
            if (d < 7)  return `${d}d ago`;
            return new Date(iso).toLocaleDateString();
          };
          const sampleApps = myInquiries.map((inq) => ({
            id:         inq.id || inq._id,
            propertyId: inq.propertyId,
            title:      inq.propTitle || 'Property',
            location:   '',
            price:      '',
            stageIdx:   stageOf(inq.status),
            outcome:    outcomeOf(inq.status),
            sentAt:     fmtDate(inq.createdAt),
            lastUpdate: relTime(inq.updatedAt || inq.createdAt),
            img:        '',
          }));
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

                      {/* Pipeline — 5 stages. We surface a one-line status
                          underneath that reads as the landlord-perspective
                          truth ("Landlord opened it · 15m ago") rather than
                          generic verbs. Tenants in Bangladesh repeatedly
                          told us the worst part of renting is not knowing
                          whether the landlord even saw the message. */}
                      <div className="grid grid-cols-5 gap-1 md:gap-2 mb-3">
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
                                      ? 'bg-gradient-to-br from-[#ba0036] to-rose-500 text-white border-[#ba0036] shadow-[0_0_0_4px_rgba(186,0,54,0.15)] animate-pulse'
                                      : 'bg-gradient-to-br from-emerald-500 to-green-600 text-white border-emerald-500 shadow-sm')
                                  : 'bg-white text-gray-400 border-gray-200'
                              }`}>
                                <Icon size={13} strokeWidth={2.5} />
                              </div>
                              <span className={`text-[9px] md:text-[10px] font-black text-center leading-tight ${reached ? (isCurrent ? 'text-[#ba0036]' : 'text-gray-700') : 'text-gray-400'}`}>
                                {language === 'বাংলা' ? st.bn : st.en}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Where it stands NOW — one human sentence that
                          summarises the current stage; this is the line
                          the tenant actually reads first. */}
                      <div className="mb-5 px-3 py-2 rounded-xl bg-gradient-to-r from-rose-50 via-amber-50 to-emerald-50 border border-amber-100 flex items-center gap-2 text-[11px] font-black text-gray-700">
                        <Zap size={12} className="text-[#ba0036] shrink-0" />
                        <span className="flex-1 truncate">
                          {language === 'বাংলা' ? stages[app.stageIdx].subBn : stages[app.stageIdx].subEn}
                          {app.lastUpdate ? ` · ${app.lastUpdate}` : ''}
                        </span>
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

              {/* Live data — refreshes automatically every 30 seconds. */}
            </div>
          );
        })()}

        {/* 🟢 PAYMENTS TAB — rebuilt as a "month navigator" so the
            tenant can jump to any month in 1 tap instead of scrolling
            through a flat receipt list. Top to bottom:
              1. Hero summary  → total paid this year, outstanding balance
              2. Year switcher → only years that actually have receipts
              3. Month strip   → 12 chips, paid/partial/empty status visible
              4. Filters row   → property dropdown + free-text search
              5. Receipt grid  → filtered live by all of the above */}
        {activeTab === 'payments' && (() => {
          // ── derive year/property/month/search-filtered data ─────────
          const monthNamesEn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          const monthNamesBn = ['জানু','ফেব','মার্চ','এপ্রিল','মে','জুন','জুল','আগ','সেপ্ট','অক্টো','নভে','ডিসে'];
          const monthNames = language === 'বাংলা' ? monthNamesBn : monthNamesEn;
          const now = new Date();
          const thisMonthKey = `${payYear}-${String(now.getMonth() + 1).padStart(2, '0')}`;

          // year set = year of every receipt + the current year so the
          // tenant can always switch to "this year".
          const yearSet = new Set([now.getFullYear()]);
          paymentReceipts.forEach((r) => {
            const y = r.monthKey?.split('-')[0];
            if (y) yearSet.add(Number(y));
          });
          const years = [...yearSet].sort((a, b) => b - a);

          // property dropdown options
          const propMap = new Map();
          paymentReceipts.forEach((r) => {
            const key = r.propertyId || r.propertyTitle;
            if (key) propMap.set(key, r.propertyTitle || key);
          });
          const properties = [...propMap.entries()];

          // bucket receipts by month for the active year (used by month strip)
          const buckets = {};
          paymentReceipts.forEach((r) => {
            if (!r.monthKey) return;
            const [y, m] = r.monthKey.split('-');
            if (Number(y) !== payYear) return;
            if (payProperty !== 'all' && (r.propertyId || r.propertyTitle) !== payProperty) return;
            const list = buckets[m] || (buckets[m] = []);
            list.push(r);
          });

          // search + active-month filter, sorted newest first
          const q = (paySearch || '').toLowerCase().trim();
          const filtered = paymentReceipts
            .filter((r) => {
              if (!r.monthKey) return false;
              const [y, m] = r.monthKey.split('-');
              if (Number(y) !== payYear) return false;
              if (payMonth && m !== payMonth) return false;
              if (payProperty !== 'all' && (r.propertyId || r.propertyTitle) !== payProperty) return false;
              if (!q) return true;
              const hay = `${r.propertyTitle || ''} ${r.monthLabel || ''} ${r.monthKey || ''} ${r.totalPaid || ''} ${r.totalDue || ''}`.toLowerCase();
              return hay.includes(q);
            })
            .sort((a, b) => (b.monthKey || '').localeCompare(a.monthKey || ''));

          // KPIs for the hero strip
          const paidThisYear = paymentReceipts
            .filter((r) => r.monthKey?.startsWith(`${payYear}-`))
            .reduce((s, r) => s + (r.totalPaid || 0), 0);
          const outstanding = paymentReceipts.reduce((s, r) => s + (r.balance || 0), 0);
          const partialCount = paymentReceipts.filter((r) => (r.balance || 0) > 0).length;
          const nextDue = paymentReceipts
            .filter((r) => (r.balance || 0) > 0)
            .sort((a, b) => (a.monthKey || '').localeCompare(b.monthKey || ''))[0];

          // empty state — no receipts at all
          if (paymentReceipts.length === 0) {
            return (
              <div className="animate-in fade-in duration-500">
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
                      : 'When your landlord updates a rent payment, the receipt will appear here automatically.'}
                  </p>
                </div>
              </div>
            );
          }

          return (
            <div className="animate-in fade-in duration-500 space-y-5">

              {/* ─── HERO SUMMARY ───────────────────────────────────── */}
              <div className="relative overflow-hidden rounded-[2rem] border border-white/80 bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-700 text-white shadow-[0_20px_50px_-20px_rgba(59,7,100,0.55)] p-5 md:p-7">
                <div className="absolute -top-16 -right-10 w-56 h-56 rounded-full bg-white/10 blur-3xl pointer-events-none" />
                <div className="absolute -bottom-20 -left-10 w-56 h-56 rounded-full bg-cyan-300/10 blur-3xl pointer-events-none" />
                <div className="relative grid grid-cols-1 md:grid-cols-3 gap-5">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] opacity-70">
                      {language === 'বাংলা' ? `${payYear} সালে পরিশোধ` : `Paid in ${payYear}`}
                    </p>
                    <p className="mt-1 text-3xl md:text-4xl font-black leading-none tabular-nums tracking-tight">
                      ৳ {paidThisYear.toLocaleString()}
                    </p>
                    <p className="mt-2 text-[11px] font-bold opacity-80">
                      {paymentReceipts.filter((r) => r.monthKey?.startsWith(`${payYear}-`)).length}{' '}
                      {language === 'বাংলা' ? 'রিসিট' : 'receipts'} · {unreadReceiptsCount}{' '}
                      {language === 'বাংলা' ? 'নতুন' : 'new'}
                    </p>
                  </div>
                  <div className="md:border-l md:border-white/20 md:pl-5">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] opacity-70">
                      {language === 'বাংলা' ? 'বাকি' : 'Outstanding'}
                    </p>
                    <p className={`mt-1 text-3xl md:text-4xl font-black leading-none tabular-nums tracking-tight ${outstanding > 0 ? 'text-rose-200' : 'text-emerald-200'}`}>
                      ৳ {outstanding.toLocaleString()}
                    </p>
                    <p className="mt-2 text-[11px] font-bold opacity-80">
                      {partialCount > 0
                        ? `${partialCount} ${language === 'বাংলা' ? 'মাসে আংশিক পরিশোধ' : 'months partially paid'}`
                        : (language === 'বাংলা' ? 'সবকিছু পরিশোধিত' : 'You are fully up to date')}
                    </p>
                  </div>
                  <div className="md:border-l md:border-white/20 md:pl-5 flex flex-col justify-between">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] opacity-70">
                        {language === 'বাংলা' ? 'পরবর্তী বকেয়া' : 'Next due'}
                      </p>
                      <p className="mt-1 text-base md:text-lg font-black leading-tight">
                        {nextDue
                          ? `${nextDue.monthLabel || nextDue.monthKey} · ৳${(nextDue.balance || 0).toLocaleString()}`
                          : (language === 'বাংলা' ? 'কিছু বাকি নেই' : 'Nothing due')}
                      </p>
                    </div>
                    {nextDue && (
                      <button
                        onClick={() => { setActiveReceipt(nextDue); markReceiptRead(nextDue.id); }}
                        className="mt-3 self-start inline-flex items-center gap-1.5 bg-white text-indigo-700 px-3.5 py-2 rounded-xl text-[11px] font-black active:scale-95 transition-all shadow-md hover:shadow-lg"
                      >
                        {language === 'বাংলা' ? 'রিসিট দেখুন' : 'Open receipt'} <ArrowRight size={12} />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* ─── YEAR SWITCHER + RESET MONTH ───────────────────── */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400 mr-1">
                  {language === 'বাংলা' ? 'বছর' : 'Year'}
                </span>
                {years.map((y) => (
                  <button
                    key={y}
                    onClick={() => { setPayYear(y); setPayMonth(null); }}
                    className={`px-3 py-1.5 rounded-xl text-[11px] font-black tabular-nums transition-all active:scale-95 ${
                      y === payYear
                        ? 'bg-gray-900 text-white shadow-md'
                        : 'bg-white text-gray-500 border border-gray-100 hover:border-gray-300'
                    }`}
                  >
                    {y}
                  </button>
                ))}
                <span className="hidden md:inline-block ml-auto text-[10px] font-bold text-gray-400">
                  {payMonth
                    ? `${monthNames[Number(payMonth) - 1]} ${payYear}`
                    : (language === 'বাংলা' ? `${payYear} সালের সব মাস` : `All months in ${payYear}`)}
                </span>
                {payMonth && (
                  <button
                    onClick={() => setPayMonth(null)}
                    className="ml-auto md:ml-0 inline-flex items-center gap-1 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-[10px] font-black active:scale-95 transition-all"
                  >
                    <X size={10} /> {language === 'বাংলা' ? 'সব মাস' : 'Clear month'}
                  </button>
                )}
              </div>

              {/* ─── MONTH STRIP (12 chips, scrollable on small screens) ─
                  Status per chip: full / partial / empty (no receipt).
                  Current month gets a subtle ring. Click → filter list. */}
              <div className="-mx-1 md:mx-0 overflow-x-auto md:overflow-visible [&::-webkit-scrollbar]:hidden">
                <div className="px-1 md:px-0 grid grid-flow-col md:grid-flow-row auto-cols-[88px] md:auto-cols-auto md:grid-cols-6 lg:grid-cols-12 gap-2">
                  {monthNames.map((label, i) => {
                    const mm = String(i + 1).padStart(2, '0');
                    const list = buckets[mm] || [];
                    const paid = list.reduce((s, r) => s + (r.totalPaid || 0), 0);
                    const due = list.reduce((s, r) => s + (r.balance || 0), 0);
                    const hasAny = list.length > 0;
                    const isFull = hasAny && due <= 0;
                    const isPartial = hasAny && due > 0;
                    const isActive = payMonth === mm;
                    const isCurrent = `${payYear}-${mm}` === thisMonthKey;
                    return (
                      <button
                        key={mm}
                        onClick={() => setPayMonth(isActive ? null : mm)}
                        className={`relative text-left p-3 rounded-2xl border transition-all duration-200 active:scale-95 ${
                          isActive
                            ? 'bg-gray-900 text-white border-gray-900 shadow-lg'
                            : isFull
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-100 hover:border-emerald-300'
                              : isPartial
                                ? 'bg-amber-50 text-amber-800 border-amber-100 hover:border-amber-300'
                                : 'bg-white text-gray-400 border-gray-100 hover:border-gray-300'
                        } ${isCurrent && !isActive ? 'ring-2 ring-[#ba0036]/30' : ''}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black uppercase tracking-widest opacity-80">{label}</span>
                          {isFull && <CheckCheck size={11} className={isActive ? 'text-emerald-300' : 'text-emerald-600'} />}
                          {isPartial && <Hourglass size={11} className={isActive ? 'text-amber-300' : 'text-amber-600'} />}
                        </div>
                        <div className="mt-1.5 text-[11px] font-black tabular-nums truncate">
                          {hasAny ? `৳${paid.toLocaleString()}` : '—'}
                        </div>
                        {isPartial && (
                          <div className={`text-[9px] font-bold mt-0.5 truncate ${isActive ? 'text-amber-200' : 'text-amber-700'}`}>
                            {language === 'বাংলা' ? 'বাকি' : 'Due'} ৳{due.toLocaleString()}
                          </div>
                        )}
                        {isCurrent && (
                          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#ba0036] animate-pulse" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ─── PROPERTY FILTER + SEARCH + MARK READ ─────────── */}
              <div className="flex flex-col md:flex-row gap-3 md:items-center">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="search"
                    value={paySearch}
                    onChange={(e) => setPaySearch(e.target.value)}
                    placeholder={language === 'বাংলা' ? 'প্রপার্টি, মাস বা রিসিট খুঁজুন…' : 'Find a receipt by property, month or amount…'}
                    className="w-full bg-white pl-10 pr-4 py-2.5 rounded-2xl text-[12px] font-bold text-gray-700 placeholder:text-gray-400 border border-gray-100 focus:border-[#ba0036] focus:ring-4 focus:ring-[#ba0036]/10 outline-none transition-all"
                  />
                </div>
                {properties.length > 1 && (
                  <div className="relative">
                    <Filter size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    <select
                      value={payProperty}
                      onChange={(e) => setPayProperty(e.target.value)}
                      className="appearance-none bg-white pl-9 pr-9 py-2.5 rounded-2xl text-[12px] font-black text-gray-700 border border-gray-100 focus:border-[#ba0036] focus:ring-4 focus:ring-[#ba0036]/10 outline-none transition-all"
                    >
                      <option value="all">{language === 'বাংলা' ? 'সব প্রপার্টি' : 'All properties'}</option>
                      {properties.map(([id, title]) => (
                        <option key={id} value={id}>{title}</option>
                      ))}
                    </select>
                  </div>
                )}
                {unreadReceiptsCount > 0 && (
                  <button
                    onClick={markAllReceiptsRead}
                    className="px-4 py-2.5 bg-white border border-gray-100 hover:border-[#ba0036] hover:text-[#ba0036] text-gray-600 rounded-2xl text-[11px] font-black shadow-sm transition-all active:scale-95"
                  >
                    {language === 'বাংলা' ? 'সব পড়া' : 'Mark all read'}
                  </button>
                )}
              </div>

              {/* ─── FILTERED RECEIPT GRID ─────────────────────────── */}
              {filtered.length === 0 ? (
                <div className="text-center py-16 bg-white/60 backdrop-blur-md rounded-[2rem] border border-gray-100">
                  <div className="w-14 h-14 mx-auto bg-gray-100 rounded-full flex items-center justify-center mb-3">
                    <Search className="text-gray-400" size={22} />
                  </div>
                  <p className="text-sm font-black text-gray-500 mb-1">
                    {language === 'বাংলা' ? 'এই ফিল্টারে কিছু পাওয়া যায়নি' : 'No receipts match this filter'}
                  </p>
                  <p className="text-[11px] font-bold text-gray-400">
                    {language === 'বাংলা' ? 'অন্য মাস, বছর বা প্রপার্টি বেছে নিন' : 'Try a different month, year or property'}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-5">
                  {filtered.map(r => {
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
              )}
            </div>
          );
        })()}

        {/* 🟢 ACCOUNT SETTINGS — clicking "Account Settings" in the side
            drawer now opens the existing TenantSettings page inline. The
            file lived under ./tenant/ but was never wired in; that was
            the user's main complaint. onGoToProfile flips back to the
            Profile tab so "Edit profile" doesn't dump the user on a
            different route. */}
        {activeTab === 'settings' && (
          <div className="animate-in fade-in duration-500">
            <TenantSettings onGoToProfile={() => setActiveTab('profile')} />
          </div>
        )}

        {/* 🟢 HELP & SUPPORT — same fix as Settings: the file exists in
            ./tenant/, it just was never rendered. Now it is. */}
        {activeTab === 'support' && (
          <div className="animate-in fade-in duration-500">
            <TenantSupport />
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

      {/* Identity verification wizard — tenant flow.
          role="tenant" → profession → workPlace → familySize → emergency
          → nid (optional) → review. Initial data sourced from tenantProfile
          so a partially-completed user picks up where they left off.

          The `open` prop ANDs the toggle with !isVerified so a verified
          user never sees the modal even if some legacy code path flips
          setVerifModalOpen(true). Defense in depth — same guard the
          onOpenVerification callback uses above. */}
      <VerificationModal
        role="tenant"
        open={verifModalOpen && !isVerified}
        onClose={() => setVerifModalOpen(false)}
        onSubmit={handleWizardSubmit}
        language={language}
        initialData={tenantProfile}
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