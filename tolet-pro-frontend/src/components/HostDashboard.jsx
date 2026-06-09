import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Building, Building2, MessageSquare, Calendar,
  Settings, HelpCircle, Plus, Search, Bell, Filter, ArrowUpDown,
  Edit3, PauseCircle, PlayCircle, FileText, MapPin, Globe, CheckCircle2,
  X, CreditCard, MoreVertical, Download, Trash2, MessageCircle, Archive,
  Send, Paperclip, Smile, Mail, Shield, ShieldCheck, LogOut, BadgeCheck, Camera, Check,
  Hourglass, Upload, User, UserCircle, Image as ImageIcon, CheckCircle, ScanFace, Zap,
  BellRing, Folder, Scale, ClipboardCheck, Receipt, UploadCloud, ArrowLeft,
  File, Eye, FileEdit, Megaphone, FileSpreadsheet, Phone, Bot, CheckCheck, Video,
  Activity, TrendingUp, Crown, Lock, Sparkles, DollarSign, Wallet,
  XCircle, AlertCircle, RefreshCw, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, MinusCircle,
  Banknote, ArrowRight, ArrowUpRight, Clock, Smartphone,
  BellOff, CalendarRange, BarChart3,
  Bed, Bath, Maximize2, Sofa, Trash, ImagePlus
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext.jsx';
import { propertyService, subscribeUserProperties } from '../services/Propertyservice';
import { subscriptionService } from '../services/subscriptionService';
import { listHostInquiries, updateInquiryStatus, deleteInquiry } from "../services/inquiryService.js";
import { createBooking as createBookingApi, listHostBookings, updateLedger as updateLedgerApi, undoLedger as undoLedgerApi } from "../services/bookingService.js";
import { listNotifications, getUnreadCount, markRead, markAllRead } from "../services/notificationService.js";
import { uploadAvatar } from "../services/authService";
import ProfileSection from './shared/ProfileSection';
import VerificationModal from './VerificationModal';
import SharedSettings from './shared/SharedSettings';
import SharedSupport from './shared/SharedSupport';
import Smartalertspage from './Smartalertspage';
import Aiinsightspage from './Aiinsightspage';

/**
 * Adapt a property record returned by propertyService (used by the public
 * listing + details pages, where price is a Number) onto the shape the host
 * dashboard portfolio cards expect (price as a comma-formatted string and
 * an `addedDate` for the "NEW" badge). When the backend ships, the API will
 * return whatever shape it returns and this is the only place we'll need to
 * touch on the host dashboard side.
 */
const toPortfolioCard = (p) => ({
  ...p,
  price: typeof p.price === 'number'
    ? p.price.toLocaleString('en-IN')
    : String(p.price ?? ''),
  addedDate: p.addedDate || (p.createdAt ? String(p.createdAt).slice(0, 10) : ''),
  inquiries: p.inquiries ?? 0,
});

// ─────────────────────────────────────────────────────────────────────────────
// CROSS-MODULE DATA CONTRACT (frontend stub — backend wires it together later)
//
// 1. PropertyListing.jsx + PropertyDetails.jsx render listings sourced from
//    GET /api/properties.
// 2. InquiryModal.jsx (shared) submits inquiries to
//    POST /api/properties/{propertyId}/inquiries with payload:
//        { phone, message, suggestionIds: string[] }
//    The backend stamps userId/init/timeAgo and stores it.
// 3. HostDashboard.jsx (this file) reads inquiries via
//    GET /api/host/inquiries  →  same shape as `initialInquiries` below.
// 4. When the host clicks "Convert to Booking" (a PREMIUM feature) the call is
//    POST /api/host/bookings with payload:
//      { inquiryId, propertyId, tenant, tenantPhone, leaseStart, leaseEnd,
//        monthlyRent, rentDueDay, reminderLeadDays, autoReminder }
//    The new booking is appended to the host's bookings list with an empty
//    `ledger` keyed by 'YYYY-MM'. Each month a green-tick mark calls
//    PATCH /api/host/bookings/{id}/ledger/{monthKey} with
//      { paid: true, paidOn, method, txnId, amount }
// 5. Reminders fire from a server cron that reads
//    `autoReminder + reminderLeadDays + rentDueDay` from each booking. The
//    UI here only previews + lets the host send manually — the cron is the
//    source of truth so this page can be closed without missing a reminder.
//
// All backend touch-points are tagged with `TODO(backend):` comments.
// ─────────────────────────────────────────────────────────────────────────────

// ─── INITIAL DATA — NO DEMO ROWS ──────────────────────────────────────────
// We start every host's dashboard empty. The real list comes from
// `propertyService.listMyProperties()` in the useEffect below (merged via
// the subscription so newly uploaded listings show up live).
const initialPortfolio = [];

// Bookings are loaded from /api/host/bookings (once wired). Until then,
// new hosts start with zero bookings — no fake tenant ledgers.
const initialBookings = [];

// Inquiries arrive via /api/host/inquiries. No demo conversations are
// pre-seeded — the inbox is empty until a real tenant messages.
const initialInquiries = [];

// Maps a raw inquiry from inquiryService.listHostInquiries() into the shape the
// dashboard renders. The backend already stamps most fields (user/init/timeAgo),
// so this normalises defensively with fallbacks. (This mapper had gone missing,
// which threw "toInquiryRow is not defined" and broke the inquiries tab.)
const _inqInitials = (name) =>
  (String(name || '').trim().split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('') || '?').toUpperCase();

const _inqTimeAgo = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value); // already a label like "2h ago"
  const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const dd = Math.floor(h / 24); if (dd < 30) return `${dd}d ago`;
  return d.toLocaleDateString();
};

const toInquiryRow = (raw = {}) => {
  const user = raw.user || raw.inquirerName || raw.userName || raw.name || raw.guestName || 'Guest';
  return {
    id:             raw.id || raw._id || '',
    inquirerUserId: raw.inquirerUserId || raw.userId || raw.tenantId || null,
    user,
    init:           raw.init || _inqInitials(user),
    timeAgo:        raw.timeAgo || _inqTimeAgo(raw.createdAt || raw.created_at || raw.date),
    phone:          raw.phone || raw.inquirerPhone || raw.userPhone || '',
    propTitle:      raw.propTitle || raw.propertyTitle || raw.property || '',
    propertyId:     raw.propertyId || raw.property || '',
    msg:            raw.msg || raw.message || raw.text || '',
    status:         raw.status || 'new',
    chatId:         raw.chatId || raw.conversationId || raw.threadId || '',
  };
};

// 🟢 ৩ দিনের মধ্যে অ্যাড হয়েছে কিনা তা চেক করার ফাংশন
const isRecent = (dateString) => {
  if(!dateString) return false;
  const added = new Date(dateString);
  const today = new Date(); 
  const diffDays = Math.ceil(Math.abs(today - added) / (1000 * 60 * 60 * 24));
  return diffDays <= 3;
};

// ─────────────────────────────────────────────────────────────────────────────
// RENT-LEDGER HELPERS
// Pure date/money utilities used by the rent-tracking grid and the rent-
// collection summary widget. Keeping them top-level (a) makes them trivial to
// unit-test once we add a test suite, and (b) keeps the component body focused
// on rendering — no inline date math.
// ─────────────────────────────────────────────────────────────────────────────

// Build a 'YYYY-MM' key (zero-padded month) from year and 1-indexed month.
const monthKey = (year, month) => `${year}-${String(month).padStart(2, '0')}`;

// Parse 'YYYY-MM' back to { year, month } — month is 1-indexed.
const parseMonthKey = (key) => {
  const [y, m] = (key || '').split('-').map(Number);
  return { year: y, month: m };
};

const MONTH_NAMES_EN_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_NAMES_BN_SHORT = ['জানু','ফেব্রু','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্ট','অক্টো','নভে','ডিসে'];
const MONTH_NAMES_EN_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_NAMES_BN_FULL  = ['জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর'];

const monthShortLabel = (key, lang) => {
  const { year, month } = parseMonthKey(key);
  if (!month) return '';
  const name = (lang === 'বাংলা' ? MONTH_NAMES_BN_SHORT : MONTH_NAMES_EN_SHORT)[month - 1];
  return `${name} ${String(year).slice(-2)}`;
};

const monthFullLabel = (key, lang) => {
  const { year, month } = parseMonthKey(key);
  if (!month) return '';
  const name = (lang === 'বাংলা' ? MONTH_NAMES_BN_FULL : MONTH_NAMES_EN_FULL)[month - 1];
  return `${name} ${year}`;
};

// Iterate every month-key from leaseStart through leaseEnd, inclusive.
const enumerateLeaseMonths = (leaseStart, leaseEnd) => {
  if (!leaseStart || !leaseEnd) return [];
  const start = new Date(leaseStart);
  const end = new Date(leaseEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const out = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  // Hard cap so a corrupt lease can't loop forever.
  let safety = 0;
  while (cursor <= last && safety < 600) {
    out.push(monthKey(cursor.getFullYear(), cursor.getMonth() + 1));
    cursor.setMonth(cursor.getMonth() + 1);
    safety += 1;
  }
  return out;
};

// The actual due date for `key` given the booking's `rentDueDay`. Clamps to
// the last day of the month so "due day 31" works in February.
const getDueDate = (key, dueDay) => {
  const { year, month } = parseMonthKey(key);
  if (!year || !month) return null;
  const lastDay = new Date(year, month, 0).getDate();
  const day = Math.min(Math.max(1, dueDay || 1), lastDay);
  return new Date(year, month - 1, day);
};

// One of: 'paid' | 'partial' | 'due-marked' | 'overdue' | 'due-soon' | 'upcoming' | 'before-lease'
//
// Visual contract used across the matrix, ledger rows, and dashboard widget:
//   paid         → blue tick (full payment, balance == 0)
//   partial      → amber half-fill (some money received, balance > 0)
//   due-marked   → red dot (manually marked outstanding, no payment yet)
//   overdue      → red pulse (past due date, never paid)
//   due-soon     → orange (within reminderLeadDays of due date)
//   upcoming     → grey (in the future)
//   before-lease → empty (outside the lease window)
const getRentStatus = (booking, key, today = new Date()) => {
  const entry = booking?.ledger?.[key];
  if (entry?.paid) {
    if (entry.status === 'partial' || (Number(entry.balance) || 0) > 0) return 'partial';
    return 'paid';
  }
  if (entry?.status === 'due') return 'due-marked';
  const due = getDueDate(key, booking?.rentDueDay);
  if (!due) return 'upcoming';
  const reminderStart = new Date(due);
  reminderStart.setDate(reminderStart.getDate() - (booking.reminderLeadDays || 3));
  if (today > due) return 'overdue';
  if (today >= reminderStart) return 'due-soon';
  return 'upcoming';
};

// Days from today until the next unpaid month's due date. Negative = late.
const daysUntilNextDue = (booking, today = new Date()) => {
  const months = enumerateLeaseMonths(booking?.leaseStart, booking?.leaseEnd);
  for (const k of months) {
    if (!booking?.ledger?.[k]?.paid) {
      const due = getDueDate(k, booking.rentDueDay);
      if (!due) continue;
      const diff = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
      return { key: k, due, daysFromNow: diff };
    }
  }
  return null;
};

// Aggregate this-month collection for an array of bookings. Used by the
// dashboard widget so the host can answer "who paid May's rent?" at a glance.
//
// Partial payments now contribute to `collectedTotal` (the actual cash banked)
// but count as "partial" not "paid" so the host still sees them on the
// follow-up list. `partialCount` lets the dashboard widget show "X full + Y partial".
const getMonthCollectionSummary = (bookings, year, month, today = new Date()) => {
  const key = monthKey(year, month);
  let paidCount = 0, partialCount = 0, dueCount = 0, overdueCount = 0;
  let expectedTotal = 0, collectedTotal = 0;
  const overdueTenants = [];
  const paidTenants = [];
  const partialTenants = [];
  const pendingTenants = [];
  (bookings || []).forEach((b) => {
    const months = enumerateLeaseMonths(b.leaseStart, b.leaseEnd);
    if (!months.includes(key)) return;
    dueCount += 1;
    expectedTotal += Number(b.monthlyRent || 0);
    const entry = b.ledger?.[key];
    if (entry?.paid) {
      collectedTotal += Number(entry.amount || 0);
      const isPartial = entry.status === 'partial' || (Number(entry.balance) || 0) > 0;
      if (isPartial) {
        partialCount += 1;
        partialTenants.push(b);
      } else {
        paidCount += 1;
        paidTenants.push(b);
      }
    } else {
      const due = getDueDate(key, b.rentDueDay);
      const markedDue = entry?.status === 'due';
      if (markedDue || (due && today > due)) { overdueCount += 1; overdueTenants.push(b); }
      else pendingTenants.push(b);
    }
  });
  return {
    key,
    paidCount, partialCount,
    totalDueCount: dueCount,
    expectedTotal, collectedTotal,
    outstandingTotal: Math.max(0, expectedTotal - collectedTotal),
    overdueCount,
    overdueTenants, paidTenants, partialTenants, pendingTenants,
  };
};

// Lease status from dates + today. Independent of payment state.
const computeBookingStatus = (booking, today = new Date()) => {
  const start = new Date(booking?.leaseStart);
  const end = new Date(booking?.leaseEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'upcoming';
  if (today < start) return 'upcoming';
  if (today > end) return 'completed';
  return 'active';
};

// Lease completion 0-100, used for the existing progress bar.
const computeBookingProgress = (booking, today = new Date()) => {
  const start = new Date(booking?.leaseStart).getTime();
  const end = new Date(booking?.leaseEnd).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const t = today.getTime();
  if (t <= start) return 0;
  if (t >= end) return 100;
  return Math.round(((t - start) / (end - start)) * 100);
};

// ─── Lease lifecycle stages — drives the new Bookings (Lease Management) tab ──
// Independent of payment state (which lives on the Rent Collection tab).
//   • draft  — lease created but tenant hasn't moved in yet (today < leaseStart)
//   • active — tenant is in residence and outside the notice window
//   • notice — within the last 30 days of the lease (renewal / move-out window)
//   • done   — lease has expired
const NOTICE_WINDOW_DAYS = 30;
const computeLeaseStage = (booking, today = new Date()) => {
  const start = new Date(booking?.leaseStart);
  const end = new Date(booking?.leaseEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'draft';
  if (today < start) return 'draft';
  if (today > end) return 'done';
  const noticeStart = new Date(end);
  noticeStart.setDate(noticeStart.getDate() - NOTICE_WINDOW_DAYS);
  if (today >= noticeStart) return 'notice';
  return 'active';
};

// Date object for the next unpaid month — used by the lease card's "Next Payment".
const getNextPaymentDate = (booking, today = new Date()) => {
  const next = daysUntilNextDue(booking, today);
  return next ? next.due : null;
};

// Aggregate counters for the Bookings tab's Financial Overview sidebar.
// Service charge is added to the monthly revenue total because the host
// receives both each month — matches the "Total Monthly" column on each lease card.
const getLeaseSummary = (bookings, today = new Date()) => {
  let totalMonthlyRevenue = 0;
  let activeCount = 0, noticeCount = 0, draftCount = 0, doneCount = 0;
  let totalSecurityDeposits = 0;
  (bookings || []).forEach((b) => {
    const stage = computeLeaseStage(b, today);
    if (stage === 'active') activeCount += 1;
    else if (stage === 'notice') noticeCount += 1;
    else if (stage === 'draft') draftCount += 1;
    else if (stage === 'done') doneCount += 1;
    if (stage === 'active' || stage === 'notice') {
      totalMonthlyRevenue += Number(b.monthlyRent || 0) + Number(b.serviceCharge || 0);
      totalSecurityDeposits += Number(b.securityDeposit || 0);
    }
  });
  return { totalMonthlyRevenue, activeCount, noticeCount, draftCount, doneCount, totalSecurityDeposits };
};

// Map a stage back to its label — used in filter pills + status badges.
const stageLabel = (stage, language) => {
  if (language === 'বাংলা') {
    if (stage === 'draft')  return 'ড্রাফট';
    if (stage === 'active') return 'অ্যাক্টিভ';
    if (stage === 'notice') return 'নোটিশ';
    if (stage === 'done')   return 'সম্পন্ন';
    return 'সকল';
  }
  return { draft: 'Draft', active: 'Active', notice: 'Notice', done: 'Done', all: 'All' }[stage] || stage;
};

// Format BDT amounts with comma grouping (Indian/Bangla grouping).
const formatBDT = (n) => {
  const num = Number(n) || 0;
  return `৳ ${num.toLocaleString('en-IN')}`;
};

// Format an ISO date as "May 03, 2026" / "03 মে 2026".
const formatDate = (iso, lang) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const m = (lang === 'বাংলা' ? MONTH_NAMES_BN_SHORT : MONTH_NAMES_EN_SHORT)[d.getMonth()];
  const day = String(d.getDate()).padStart(2, '0');
  return lang === 'বাংলা' ? `${day} ${m} ${d.getFullYear()}` : `${m} ${day}, ${d.getFullYear()}`;
};

// Today's ISO date (YYYY-MM-DD) — for default values in the mark-paid form.
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Rent receipts are now created server-side (Receipt model) by the booking
// ledger API and read by the tenant via GET /api/receipts/tenant. The old
// localStorage bridge (pushReceiptToTenant / PAYMENT_RECEIPTS_KEY) was removed —
// it was single-browser only and is fully superseded by the backend receipts.
// ─────────────────────────────────────────────────────────────────────────────

const HostDashboard = () => {
  const { t = {}, language = 'English', setLanguage } = useLanguage() || {}; 
  const location = useLocation(); 
  const navigate = useNavigate(); 
  const { user: authUser, logout: authLogout, updateMe: authUpdateMe } = useAuth();
  
  // 🟢 CORE STATES
  const [activeTab, setActiveTab] = useState('dashboard');

  // Honor ?tab=… deep-links (e.g. notification bell → /host-dashboard?tab=inquiries).
  useEffect(() => {
    const tab = new URLSearchParams(location.search).get('tab');
    if (tab && ['dashboard', 'inquiries', 'rent', 'bookings', 'properties', 'profile'].includes(tab)) {
      setActiveTab(tab);
    }
  }, [location.search]);
  const [isProfileDrawerOpen, setIsProfileDrawerOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false); 
  const [toastMessage, setToastMessage] = useState(null);
  const [activeFolder, setActiveFolder] = useState(null);
  
  // 🟢 DYNAMIC HOST INSIGHTS STATE
  const [hostInsights, setHostInsights] = useState({
    responseRate: '98%',
    avgResponseTime: '15',
    conversionRate: '24%'
  });

  // 🟢 PROFILE & VERIFICATION STATES
  // Seed the host profile from the signed-in account so the header avatar,
  // greeting, and profile drawer all show the host's real name/phone/email
  // instead of the legacy demo placeholders.
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [userData, setUserData] = useState(() => ({
    fullName: authUser?.name || authUser?.fullName || '',
    phone:    authUser?.phone || '',
    email:    authUser?.email || '',
    address:  authUser?.address || '',
    city:     authUser?.city || '',
    nidNumber: authUser?.nidNumber || '',
    // base64 data: URL of the host's profile picture. Empty means the
    // initials avatar is shown instead. When the backend ships, swap to a
    // signed URL coming back from PATCH /api/host/me { avatarFile }.
    avatar:   authUser?.avatar || '',
  }));
  const [tempUserData, setTempUserData] = useState(userData);

  const landlordProfileKey = (uid) => `tolet_landlord_profile:${uid || 'anon'}`;
  const DEFAULT_LANDLORD_PROFILE = {
    fullName:         userData.fullName || '',
    city:             userData.city || '',
    address:          userData.address || '',
    preferredTenants: [],
    communication:    [],
    serviceCharge:    '',
    houseRules:       [],
  };

  const [landlordProfile, setLandlordProfile] = useState(() => {
    try {
      const raw = localStorage.getItem(landlordProfileKey(authUser?.id));
      if (raw) return { ...DEFAULT_LANDLORD_PROFILE, ...JSON.parse(raw) };
    } catch { /* ignore parse errors */ }
    return DEFAULT_LANDLORD_PROFILE;
  });

  useEffect(() => {
    setLandlordProfile((prev) => ({
      ...prev,
      fullName: userData.fullName || prev.fullName,
      city:     userData.city     || prev.city,
      address:  userData.address  || prev.address,
    }));
  }, [userData.fullName, userData.city, userData.address]);

  const applyLandlordPatch = (profile, patch) => {
    const next = { ...profile };
    for (const [key, value] of Object.entries(patch || {})) {
      if (!key.includes('.')) { next[key] = value; continue; }
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
  };

  const persistLandlordProfile = async (next) => {
    setLandlordProfile(next);
    try {
      localStorage.setItem(landlordProfileKey(authUser?.id), JSON.stringify(next));
    } catch {}
    setUserData((prev) => ({
      ...prev,
      fullName: next.fullName || prev.fullName,
      city:     next.city     || prev.city,
      address:  next.address  || prev.address,
    }));
    if (authUpdateMe) {
      await authUpdateMe({ landlordProfile: next });
    }
  };

  // Whenever the auth user changes (login, logout, profile update from
  // another tab) re-seed the dashboard profile so we never fall back to a
  // stale demo placeholder.
  useEffect(() => {
    if (!authUser) return;
    setUserData(prev => ({
      ...prev,
      fullName: authUser.name || authUser.fullName || prev.fullName,
      phone:    authUser.phone   || prev.phone,
      email:    authUser.email   || prev.email,
      address:  authUser.address || prev.address,
      city:     authUser.city    || prev.city,
      nidNumber:authUser.nidNumber || prev.nidNumber,
      avatar:   authUser.avatar  || prev.avatar,
    }));
  }, [authUser]);
  
  const [uploadedDocs, setUploadedDocs] = useState({
    nidFront: false,
    nidBack: false,
    selfie: false,
    utilityBill: false
  });

  const [verificationStatus, setVerificationStatus] = useState(() => {
    const isTenantVerified = authUser?.tenantProfile?.verification?.status === 'verified';
    const isHostVerified = authUser?.landlordProfile?.verification?.status === 'verified';
    const hasNid = !!authUser?.tenantProfile?.verification?.nidFront || !!authUser?.landlordProfile?.verification?.nidFront;
    const hasFace = !!authUser?.tenantProfile?.verification?.photo || !!authUser?.landlordProfile?.verification?.photo;
    const isVerified = isTenantVerified || isHostVerified;

    return {
      profileCompleted: true, 
      nidUploaded: isVerified || hasNid,
      faceVerified: isVerified || hasFace,
      underReview: authUser?.landlordProfile?.verification?.status === 'pending' || authUser?.tenantProfile?.verification?.status === 'pending'
    };
  });

  useEffect(() => {
    if (!authUser) return;
    const isTenantVerified = authUser?.tenantProfile?.verification?.status === 'verified';
    const isHostVerified = authUser?.landlordProfile?.verification?.status === 'verified';
    const hasNid = !!authUser?.tenantProfile?.verification?.nidFront || !!authUser?.landlordProfile?.verification?.nidFront;
    const hasFace = !!authUser?.tenantProfile?.verification?.photo || !!authUser?.landlordProfile?.verification?.photo;
    const isVerified = isTenantVerified || isHostVerified;

    setVerificationStatus(prev => ({
      ...prev,
      nidUploaded: isVerified || hasNid,
      faceVerified: isVerified || hasFace,
      underReview: authUser?.landlordProfile?.verification?.status === 'pending' || authUser?.tenantProfile?.verification?.status === 'pending'
    }));
  }, [authUser]);

  const landlordTrustScore = (() => {
    const lp = landlordProfile || {};
    const v  = verificationStatus || {};
    const items = [
        { key: 'phone', labelEn: 'Phone OTP verified', labelBn: 'ফোন OTP ভেরিফাইড', pts: 20, done: !!userData?.phone },
        { key: 'avatar', labelEn: 'Profile picture', labelBn: 'প্রোফাইল ছবি', pts: 10, done: !!userData?.avatar },
        { key: 'preferences', labelEn: 'Tenant preferences', labelBn: 'ভাড়াটিয়ার পছন্দ', pts: 5, done: (lp.preferredTenants || []).length > 0 },
        { key: 'comm', labelEn: 'Communication channels', labelBn: 'যোগাযোগ মাধ্যম', pts: 5, done: (lp.communication || []).length > 0 },
        { key: 'charge', labelEn: 'Service charge', labelBn: 'সার্ভিস চার্জ', pts: 5, done: lp.serviceCharge !== '' && lp.serviceCharge != null },
        { key: 'rules', labelEn: 'House rules', labelBn: 'বাড়ির নিয়ম', pts: 10, done: (lp.houseRules || []).length > 0 },
        { key: 'photo', labelEn: 'Selfie verification', labelBn: 'সেলফি ভেরিফিকেশন', pts: 20, done: !!v.faceVerified },
        { key: 'nid', labelEn: 'NID uploaded', labelBn: 'NID আপলোড', pts: 25, done: !!v.nidUploaded },
    ];
    const score = items.filter(i => i.done).reduce((sum, i) => sum + i.pts, 0);
    let tier = 'bronze';
    if (score >= 90)      tier = 'platinum';
    else if (score >= 70) tier = 'gold';
    else if (score >= 40) tier = 'silver';
    return { score, tier, breakdown: items };
  })();

  const [verifModalOpen, setVerifModalOpen] = useState(false);

  const handleHostWizardSubmit = async (picks) => {
    setVerificationStatus((prev) => ({
      ...prev,
      profileCompleted: true,
      nidUploaded: !!(picks.nidFront?.dataUrl && picks.nidBack?.dataUrl),
      faceVerified: !!picks.photo?.dataUrl,
      underReview: true,
    }));
    setUploadedDocs((prev) => ({
      ...prev,
      nidFront: !!picks.nidFront?.dataUrl,
      nidBack: !!picks.nidBack?.dataUrl,
      selfie: !!picks.photo?.dataUrl,
      utilityBill: !!picks.ownershipProof?.dataUrl,
    }));
    setVerifModalOpen(false);
  };

  // 🟢 REFS
  const nidFrontRef = useRef(null);
  const nidBackRef = useRef(null);
  const utilityRef = useRef(null);
  const notifRef = useRef(null);
  const langRef = useRef(null);
  const toastTimerRef = useRef(null);

  // 🟢 DATA STATES
  const [properties, setProperties] = useState(initialPortfolio);
  const [isPropertiesLoading, setIsPropertiesLoading] = useState(true);
  const [propertyLoadError, setPropertyLoadError] = useState('');
  const [propertyRefreshTick, setPropertyRefreshTick] = useState(0);
  const [bookings, setBookings] = useState(initialBookings);
  const [inquiries, setInquiries] = useState(initialInquiries);
  const [inquiryTab, setInquiryTab] = useState('pending'); // 'pending' | 'accepted' | 'rejected'
  const [searchQuery, setSearchQuery] = useState('');
  const [propertyFilter, setPropertyFilter] = useState('all');
  const [activeModal, setActiveModal] = useState(null); 
  const [modalData, setModalData] = useState(null);
  // Edit modal form state — covers every field the host can change from
  // the dashboard (matches the AddProperty wizard fields one-to-one so the
  // backend's PATCH /api/properties/:id can accept the same shape).
  const EMPTY_EDIT_FORM = {
    title: '', price: '', location: '',
    beds: 1, baths: 1, sqft: 0, floor: 0, furnishing: 'Unfurnished',
    description: '', status: 'active',
    img: '', images: [],
  };
  const [editForm, setEditForm] = useState(EMPTY_EDIT_FORM);
  const [activeDropdownId, setActiveDropdownId] = useState(null);
  // NOTE: in-dashboard chat panel removed — all message CTAs now route to
  // /messages (the standalone ChatSystem) so there's a single source of
  // truth for conversations across the app.

  // 🟢 DELETE PROPERTY STATES
  const [deleteTarget, setDeleteTarget] = useState(null);     // property object to delete
  const [deleteLoading, setDeleteLoading] = useState(false);   // spinner during API call
  const [undoState, setUndoState] = useState(null);            // { prop, timeoutId } for undo grace

  // 🟢 PREMIUM + RENT-LEDGER STATES
  // Premium access is now DERIVED from the real subscription status (computed
  // just below, after subStatus), not a hardcoded stub. Booking creation
  // (Convert Inquiry → Booking) is gated behind it, so hosts whose trial /
  // subscription has expired get the upgrade prompt.

  // Subscription state — feeds the sidebar lock badges and the
  // "Verify Profile" / "Upgrade to Premium" chips. Live-syncs across tabs
  // through the service's onChange listener. The first read seeds a
  // 3-month free trial via subscriptionService.getStatus().
  // We initialize synchronously so the UI doesn't jump, and then re-fetch
  // from the backend on mount to ensure we have the latest server truth.
  const [subStatus, setSubStatus] = useState(() => subscriptionService.getStatus());
  useEffect(() => {
    subscriptionService.fetchStatus();
    const off = subscriptionService.onChange(() => setSubStatus(subscriptionService.getStatus()));
    return off;
  }, []);
  const lockedFeatureIds = useMemo(
    () => (subStatus.isExpired ? subscriptionService.getLockedFeatures() : []),
    [subStatus],
  );
  const isFeatureLocked = (featureId) => lockedFeatureIds.includes(featureId);

  // Premium = the subscription / 3-month free trial is still active (not expired).
  // Single source of truth for the booking-conversion gate + premium badges. If
  // subscriptionService later exposes a more specific flag (e.g. paid tier),
  // swap it in here and everything downstream follows.
  const isPremium = !subStatus?.isExpired;

  // Active tab guarded by subscription. If the host lands on a locked tab
  // (e.g. via a stale link), we bounce them to /subscription with a `from`
  // param so the page can explain why.
  useEffect(() => {
    if (isFeatureLocked(activeTab)) {
      navigate(`/subscription?from=${activeTab}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, lockedFeatureIds]);

  // Rent Collection tab — current ledger year for the 12-month matrix.
  const [ledgerYear, setLedgerYear] = useState(new Date().getFullYear());

  // Bookings tab — lease-stage pill filter (All / Draft / Active / Notice / Done).
  // Decoupled from rentPriorityFilter so navigating between Bookings and
  // Rent Collection never resets the other tab's filter.
  const [leaseStageFilter, setLeaseStageFilter] = useState('all');

  // Rent Collection tab — priority filter (All / Overdue / Partial-Upcoming / Cleared).
  // Filters the per-tenant ledger cards on the new Shared Ledger page.
  const [rentPriorityFilter, setRentPriorityFilter] = useState('all');

  // Accordion state — only one row open at a time per tab. The compact-list
  // pattern keeps each collapsed row ~64-72px tall (vs ~600px in the older
  // expanded design), so 50+ tenant portfolios fit on screen with minimal
  // scrolling. Tap a row to expand it inline; tapping again (or expanding
  // another) collapses it back.
  //
  // Auto-expand rule: when the filtered list has ≤ AUTO_EXPAND_THRESHOLD
  // rows, every row renders expanded by default and the tap-to-toggle is
  // suppressed (no chevron, no click-collapse). The compact-row pattern
  // is a 50-house density tool — with a handful of tenants it's just
  // friction, so the dashboard reverts to a static, fully-readable layout.
  const [expandedBookingId, setExpandedBookingId] = useState(null);
  const [expandedRentId, setExpandedRentId] = useState(null);

  // Modal/form state for marking a month as paid + creating a lease.
  //
  // The mark-paid modal is now a 2-step flow:
  //   step: 'choose'  → 3 big choice cards (Full / Partial / Mark as Due)
  //   step: 'form'    → form tailored to whichever choice was made
  // `status` is the choice carried across steps; downstream handlers branch on it.
  const [payForm, setPayForm] = useState({
    bookingId: null,
    monthKey: '',
    step: 'choose',                // 'choose' | 'form'
    status: 'full',                // 'full' | 'partial' | 'due'
    paidOn: todayIso(),
    method: 'bKash',
    txnId: '',
    amount: '',                    // received amount (full → monthlyRent, partial → user input)
    expectedRent: 0,               // booking.monthlyRent at the time the modal opened
    dueNote: '',                   // free-text note for the 'due' branch
    expectedPayBy: '',             // promised pay-by date for the 'due' branch
  });
  const [leaseForm, setLeaseForm] = useState({
    inquiryId: null,
    propertyId: '',
    property: '',
    tenant: '',
    tenantPhone: '',
    leaseStart: todayIso(),
    leaseEnd: '',
    monthlyRent: '',
    rentDueDay: 5,
    reminderLeadDays: 3,
    autoReminder: true,
    notes: '',
  });

  const [inquiryStatusForm, setInquiryStatusForm] = useState({
    status: 'new',
    visitDate: '',
    notes: ''
  });

  // Stable "today" used by all rent-status calculations on this render. We
  // memoise on date-string change so flipping months in the picker doesn't
  // thrash the matrix.
  const today = useMemo(() => new Date(), [todayIso()]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.scrollTo(0, 0);
    if (location.state && location.state.activeTab) setActiveTab(location.state.activeTab);
  }, [location]);

  // Backend contract:
  //   GET /api/host/properties (Bearer)  →  { properties[] }
  //
  // We merge the host's own listings (from propertyService) with the seeded
  // demo portfolio so brand-new listings created via /list-property show up
  // here without a page refresh. The subscription fires whenever AddProperty
  // writes a new record, including from another browser tab.
  //
  // NOTE on mutability: edit/pause/delete actions below mutate the merged
  // `properties` state in-memory only. The subscription rebuilds the list on
  // every new add, which is fine for mock-mode. When the backend lands, each
  // mutation should round-trip through propertyService.update/delete and the
  // subscriber will refresh from the API response.
  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      setIsPropertiesLoading(true);
      setPropertyLoadError('');
      try {
        const mine = await propertyService.listMyProperties();
        if (cancelled) return;
        setProperties([
          ...mine.map(toPortfolioCard),
          ...initialPortfolio,
        ]);
      } catch (err) {
        if (cancelled) return;
        console.warn('[host] failed to load properties:', err.message || err);
        setPropertyLoadError(err.message || 'Could not load your properties.');
      } finally {
        if (!cancelled) setIsPropertiesLoading(false);
      }
    };

    hydrate();
    const unsubscribe = subscribeUserProperties(hydrate);
    return () => { cancelled = true; unsubscribe?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyRefreshTick]);

  // ── Hydrate the host's bookings from the backend ────────────────────────
  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      try {
        const rows = await listHostBookings();
        if (cancelled) return;
        setBookings(rows);
      } catch (err) {
        console.warn('[host] failed to load bookings:', err.message || err);
      }
    };
    hydrate();
    const interval = setInterval(hydrate, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // ── Hydrate the host's inquiries from the backend ───────────────────────
  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      try {
        const rows = await listHostInquiries();
        if (cancelled) return;
        setInquiries(rows.map(toInquiryRow));
      } catch (err) {
        console.warn('[host] failed to load inquiries:', err.message || err);
      }
    };
    hydrate();
    const interval = setInterval(hydrate, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // ── Hydrate REAL host performance stats (/api/host-stats) ───────────────
  // Response rate, avg response time, conversion rate — all server-computed
  // from live inquiries / bookings / chat threads. Replaces the old hardcoded
  // 98% / 15min / 24% card.
  const [hostStats, setHostStats] = useState({ responseRate: 0, avgResponseTime: 0, conversionRate: 0 });
  useEffect(() => {
    let cancelled = false;
    const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';
    const hydrate = async () => {
      try {
        const token = localStorage.getItem('auth:token');
        if (!token) return;
        const res = await fetch(`${API}/host-stats`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        setHostStats({
          responseRate:    Number(data.responseRate)    || 0,
          avgResponseTime: Number(data.avgResponseTime) || 0,
          conversionRate:  Number(data.conversionRate)  || 0,
        });
      } catch (err) {
        console.warn('[host] failed to load stats:', err.message || err);
      }
    };
    hydrate();
    const interval = setInterval(hydrate, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

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
    timer = setInterval(fetchNotifications, 15_000); // 15s poll

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [authUser]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (notifRef.current && !notifRef.current.contains(event.target)) setIsNotifOpen(false);
      if (langRef.current && !langRef.current.contains(event.target)) setIsLangMenuOpen(false); 
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const showToast = (msg, { undo, duration, type } = {}) => {
    setToastMessage({ text: msg, undo: undo || null, type: type || 'success' });
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(
      () => setToastMessage(null),
      undo ? 6000 : (duration || 3000),
    );
  };

  // 🟢 PROFILE LOGIC HANDLERS
  const handleEditToggle = () => {
    if (isEditingProfile) {
      setTempUserData(userData); 
      setIsEditingProfile(false);
    } else {
      setIsEditingProfile(true);
    }
  };

  const handleProfileSave = async () => {
    if(!tempUserData.fullName || !tempUserData.phone) {
      showToast(language === 'বাংলা' ? 'নাম এবং ফোন নম্বর আবশ্যক!' : 'Name and Phone are required!');
      return;
    }
    setUserData(tempUserData);
    setIsEditingProfile(false);
    // Propagate to AuthContext so the Navbar profile chip + cross-tab
    // subscribers see the updated name/phone/email instantly.
    try {
      await authUpdateMe?.({
        name:      tempUserData.fullName,
        fullName:  tempUserData.fullName,
        phone:     tempUserData.phone,
        email:     tempUserData.email,
        address:   tempUserData.address,
        city:      tempUserData.city,
        nidNumber: tempUserData.nidNumber,
        avatar:    tempUserData.avatar,
      });
    } catch { /* keep the local edit even if sync fails */ }
    showToast(language === 'বাংলা' ? 'প্রোফাইল সফলভাবে আপডেট হয়েছে!' : 'Profile updated successfully!');
    if(uploadedDocs.nidFront && uploadedDocs.nidBack && uploadedDocs.selfie) {
      setVerificationStatus(prev => ({ ...prev, underReview: true }));
    }
  };

  const handleFileUpload = (docType) => {
    showToast(language === 'বাংলা' ? 'ডকুমেন্ট আপলোড হচ্ছে...' : 'Uploading document...');
    setTimeout(() => {
      setUploadedDocs(prev => ({ ...prev, [docType]: true }));
      showToast(language === 'বাংলা' ? 'আপলোড সম্পন্ন হয়েছে!' : 'Upload complete!');
      if(docType === 'nidFront' || docType === 'nidBack') {
        const isFrontDone = docType === 'nidFront' ? true : uploadedDocs.nidFront;
        const isBackDone = docType === 'nidBack' ? true : uploadedDocs.nidBack;
        if(isFrontDone && isBackDone) {
           setVerificationStatus(prev => ({ ...prev, nidUploaded: true }));
        }
      }
    }, 1500);
  };

  const handleSelfieCapture = () => {
    showToast(language === 'বাংলা' ? 'ক্যামেরা ওপেন হচ্ছে...' : 'Opening camera...');
    setTimeout(() => {
      showToast(language === 'বাংলা' ? 'ফেস স্ক্যান এবং ম্যাচ করা হচ্ছে...' : 'Scanning and matching face...');
      setTimeout(() => {
        setUploadedDocs(prev => ({ ...prev, selfie: true }));
        setVerificationStatus(prev => ({ ...prev, faceVerified: true }));
        showToast(language === 'বাংলা' ? 'ফেস ভেরিফাইড!' : 'Face Verified Successfully!');
        if (uploadedDocs.nidFront && uploadedDocs.nidBack) {
            setVerificationStatus(prev => ({ ...prev, underReview: true }));
        }
      }, 2000);
    }, 1000);
  };

  // 🟢 ACTION HANDLERS
  const handleCallUser = (phone, inquiryId) => {
    showToast(language === 'বাংলা' ? 'কল ইনিশিয়েট করা হচ্ছে...' : 'Initiating Call...');
    window.location.href = `tel:${phone}`;
  };

  // 🟢 UNIFIED MESSAGE HANDLER
  // Routes every Message CTA in the dashboard to the standalone ChatSystem
  // page (/messages). The in-dashboard chat panel has been retired so there
  // is one single conversation surface for the whole app — ChatSystem will
  // hydrate the right thread from `location.state.chatId` and render any
  // cross-system rent receipts inline.
  const openChatPanel = (chatId, context = {}) => {
    setActiveDropdownId(null);
    if (chatId == null) return;
    navigate('/messages', {
      state: {
        chatId,
        source: 'host-bookings',
        ...context,
      },
    });
  };

  // 🟢 CLICKABLE NOTIFICATIONS — deep-link a notification to its target surface.
  // The host inbox mostly sees inquiry_new + message_new; rent_* (if any) land
  // on the rent ledger. 'system' / unknown types just mark-read (no navigation).
  const handleNotifClick = (notif) => {
    const d = notif?.data || {};
    switch (notif?.type) {
      case 'message_new':
        if (d.conversationId) openChatPanel(d.conversationId, { source: 'notification' });
        break;
      case 'inquiry_new':
      case 'inquiry_status':
        setActiveTab('inquiries');
        break;
      case 'rent_receipt':
      case 'rent_invoice':
      case 'rent_overdue':
        setActiveTab('rent');
        break;
      default:
        break;
    }
  };

  const handleRemoveBooking = (id) => {
    setBookings(bookings.filter(b => b.id !== id));
    showToast(language === 'বাংলা' ? 'বুকিং মুছে ফেলা হয়েছে।' : 'Booking removed successfully.');
    setActiveDropdownId(null);
  };

  const handleRemoveInquiry = (id) => {
    setInquiries(inquiries.filter(i => i.id !== id));
    showToast(language === 'বাংলা' ? 'ইনকোয়ারি আর্কাইভ করা হয়েছে।' : 'Inquiry Archived.');
  };

  const togglePropertyStatus = (id) => {
    setProperties(properties.map(p => {
      if (p.id === id && p.status !== 'rented') {
        const newStatus = p.status === 'active' ? 'paused' : 'active';
        showToast(language === 'বাংলা' ? `প্রপার্টি ${newStatus.toUpperCase()} করা হয়েছে` : `Property marked as ${newStatus.toUpperCase()}`);
        // Persist host-owned listings via the service layer so the change
        // survives reloads. Demo seed entries return null from
        // updateProperty() and stay as in-memory-only state.
        propertyService.updateProperty(id, { status: newStatus }).catch(() => {});
        return { ...p, status: newStatus };
      }
      return p;
    }));
  };

  // ─── DELETE PROPERTY (deferred with undo grace period) ────────────────
  // Step 1: User clicks Delete → opens the confirmation modal.
  const handleDeleteProperty = (prop) => {
    setDeleteTarget(prop);
    setActiveModal('confirm_delete');
  };

  // Step 2: User confirms in the modal → card removed from UI immediately,
  // actual API call deferred by 5 seconds. During that window the Undo
  // button in the toast re-inserts the card and cancels the timeout.
  const confirmDeleteProperty = () => {
    const prop = deleteTarget;
    if (!prop) return;
    setActiveModal(null);
    setDeleteTarget(null);

    // Optimistically remove from state
    setProperties((prev) => prev.filter((p) => p.id !== prop.id));

    // Schedule the real API call
    const tid = setTimeout(async () => {
      setUndoState(null);
      setDeleteLoading(true);
      try {
        await propertyService.deleteProperty(prop.id);
        showToast(
          language === 'বাংলা'
            ? 'প্রপার্টি সফলভাবে মুছে ফেলা হয়েছে'
            : 'Property deleted successfully',
        );
      } catch (err) {
        // Re-add to the list on failure
        setProperties((prev) => [prop, ...prev]);
        showToast(
          language === 'বাংলা'
            ? 'প্রপার্টি মুছতে সমস্যা হয়েছে'
            : (err.message || 'Failed to delete property'),
          { type: 'error' },
        );
      } finally {
        setDeleteLoading(false);
      }
    }, 5000);

    setUndoState({ prop, timeoutId: tid });

    // Show undo toast
    showToast(
      language === 'বাংলা' ? 'প্রপার্টি মুছে ফেলা হবে...' : 'Property will be deleted...',
      {
        undo: () => {
          clearTimeout(tid);
          setUndoState(null);
          setProperties((prev) => [prop, ...prev]);
          showToast(language === 'বাংলা' ? 'আনডু সফল!' : 'Undo successful!');
        },
      },
    );
  };

  // Cleanup undo timeout on unmount
  useEffect(() => {
    return () => {
      if (undoState?.timeoutId) clearTimeout(undoState.timeoutId);
    };
  }, [undoState]);

  const openModal = (type, data = null) => {
    setActiveModal(type);
    setModalData(data);
    setActiveDropdownId(null);
    setIsProfileDrawerOpen(false);
    if (type === 'edit' && data) {
      // Seed every editable field. Demo seed entries only carry a subset of
      // the schema; fall back to sensible defaults so the inputs render.
      const gallery = Array.isArray(data.images) ? data.images : [];
      setEditForm({
        title: data.title || '',
        price: typeof data.price === 'number' ? data.price.toLocaleString('en-IN') : (data.price || ''),
        location: data.location || '',
        beds: Number(data.beds) || 1,
        baths: Number(data.baths) || 1,
        sqft: Number(data.sqft) || 0,
        floor: Number(data.floor) || 0,
        furnishing: data.furnishing || 'Unfurnished',
        description: data.description || '',
        status: data.status || 'active',
        img: data.img || gallery[0] || '',
        images: gallery,
      });
    } else if (type === 'update_inquiry' && data) {
      setInquiryStatusForm({
        status: data.status || 'new',
        visitDate: '',
        notes: ''
      });
    }
  };

  const submitInquiryStatus = () => {
    if (!modalData) return;
    const newStatus = inquiryStatusForm.status;
    setInquiries(prev => prev.map(i => i.id === modalData.id ? { ...i, status: newStatus } : i));
    showToast(language === "বাংলা" ? "স্ট্যাটাস আপডেট হয়েছে!" : "Status Updated!");
    updateInquiryStatus(modalData.id, newStatus).catch(err => {
      console.warn("[host] update inquiry status failed:", err.message || err);
    });
    setActiveModal(null);
  };

  // ───────────────────────────────────────────────────────────────────────────
  // RENT-LEDGER + BOOKING HANDLERS
  // These are the only places where ledger data is mutated. Keeping them
  // co-located makes it easy to drop in real API calls later — every handler
  // already has a TODO(backend) comment showing the exact endpoint shape.
  // ───────────────────────────────────────────────────────────────────────────

  // Open the "Rent Action" modal pre-filled for a specific booking + month.
  // Always lands on the choice screen first; if the cell already has a payment
  // recorded, the form step starts pre-filled with that data so the host can
  // edit instead of re-entering everything from scratch.
  const openMarkPaid = (booking, key) => {
    const existing = booking.ledger?.[key];
    const expected = Number(booking.monthlyRent || 0);
    // If the cell was already paid, jump straight to the form step so the
    // host can edit. For fresh cells, show the choice screen.
    const startStep = existing?.paid ? 'form' : 'choose';
    let initialStatus = 'full';
    if (existing?.status === 'partial') initialStatus = 'partial';
    else if (existing?.status === 'due') initialStatus = 'due';
    setPayForm({
      bookingId: booking.id,
      monthKey: key,
      step: startStep,
      status: initialStatus,
      paidOn: existing?.paidOn || todayIso(),
      method: existing?.method || 'bKash',
      txnId: existing?.txnId || '',
      amount: String(existing?.amount ?? expected ?? ''),
      expectedRent: expected,
      dueNote: existing?.dueNote || '',
      expectedPayBy: existing?.expectedPayBy || '',
    });
    setActiveModal('mark_paid');
  };

  // Choose one of the three flows from the choice screen and advance to the form.
  // For "full" we lock the amount to the expected monthly rent so the host
  // doesn't have to retype it.
  const choosePayStatus = (status) => {
    setPayForm(prev => ({
      ...prev,
      status,
      step: 'form',
      amount: status === 'full'
        ? String(prev.expectedRent || prev.amount || '')
        : (status === 'due' ? '0' : prev.amount),
    }));
  };

  // Persist a paid month to the ledger (frontend only; backend wires later).
  // Branches on payForm.status — full / partial / due. Each branch:
  //   1. Builds the ledger entry (paid, balance, status).
  //   2. Updates `bookings` state.
  //   3. Pushes a receipt into the tenant's localStorage so their dashboard
  //      sees an instant Inbox notification (matching the user's request:
  //      "the tenant gets a receipt automatically").
  // TODO(backend): PATCH /api/host/bookings/{bookingId}/ledger/{monthKey}
  //   body: { status, paid, paidOn, method, txnId, amount, balance }
  //   On success the server emits a webhook to /api/tenants/{id}/receipts.
  const submitMarkPaid = () => {
    const { bookingId, monthKey: key, status, paidOn, method, txnId, amount, dueNote, expectedPayBy } = payForm;
    if (!bookingId || !key) return;
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return;

    const expected = Number(booking.monthlyRent || 0);
    const amt = Number(amount) || 0;

    // ── Branch validation ──────────────────────────────────────────────────
    if (status === 'full') {
      if (amt <= 0) {
        showToast(language === 'বাংলা' ? 'অ্যামাউন্ট ০ এর বেশি দিন' : 'Amount must be greater than 0');
        return;
      }
    } else if (status === 'partial') {
      if (amt <= 0) {
        showToast(language === 'বাংলা' ? 'কত টাকা পেয়েছেন লিখুন' : 'Enter the amount received');
        return;
      }
      if (amt >= expected) {
        showToast(language === 'বাংলা'
          ? 'পুরো ভাড়া পেয়ে গেছেন — "Full Payment" নির্বাচন করুন'
          : 'Amount covers the full rent — please choose "Full Payment" instead');
        return;
      }
    } else if (status === 'due') {
      if (!dueNote.trim()) {
        showToast(language === 'বাংলা' ? 'কারণটি একটু লিখুন' : 'Please add a short note for the due');
        return;
      }
    }

    // ── Build the ledger entry ─────────────────────────────────────────────
    const balance = status === 'due' ? expected : Math.max(0, expected - amt);
    const entry = status === 'due'
      ? { paid: false, status: 'due', dueNote: dueNote.trim(), expectedPayBy, amount: 0, balance }
      : { paid: true, status, paidOn, method, txnId, amount: amt, balance };

    setBookings(prev => prev.map(b => b.id === bookingId
      ? { ...b, ledger: { ...(b.ledger || {}), [key]: entry } }
      : b
    ));

    // Receipt is created/updated (or cleared for 'due') server-side by the
    // ledger API call below — no local receipt handling needed.

    // ── Toasts (Bn/En) ─────────────────────────────────────────────────────
    const monthLabel = monthFullLabel(key, language);
    if (status === 'full') {
      showToast(language === 'বাংলা'
        ? `${monthLabel} এর সম্পূর্ণ ভাড়া পেইড — ${booking.tenant} কে রিসিট পাঠানো হয়েছে`
        : `${monthLabel} fully paid — receipt sent to ${booking.tenant}`);
    } else if (status === 'partial') {
      showToast(language === 'বাংলা'
        ? `${monthLabel} এ আংশিক পেমেন্ট সেভ — বাকি ${formatBDT(balance)}`
        : `${monthLabel} partial payment saved — ${formatBDT(balance)} balance remaining`);
    } else {
      showToast(language === 'বাংলা'
        ? `${monthLabel} বকেয়া হিসেবে চিহ্নিত করা হয়েছে`
        : `${monthLabel} marked as due`);
    }

    const bookingMongoId = booking._id || bookingId;
    updateLedgerApi(bookingMongoId, key, {
      ...entry,
      monthLabel: monthFullLabel(key, language),
      totalDue: expected,
    }).catch(err => {
      console.warn('[host] mark paid sync failed:', err.message || err);
    });

    setActiveModal(null);
  };

  // Reverse a payment record — used when a payment was logged by mistake.
  // Also pulls the receipt from the tenant's inbox so they don't see a
  // stale "Paid" notification for a payment that never happened.
  // TODO(backend): DELETE /api/host/bookings/{bookingId}/ledger/{monthKey}
  const undoMarkPaid = (bookingId, key) => {
    const booking = bookings.find(b => b.id === bookingId);
    setBookings(prev => prev.map(b => {
      if (b.id !== bookingId) return b;
      const next = { ...(b.ledger || {}) };
      delete next[key];
      return { ...b, ledger: next };
    }));
    // The receipt is removed server-side by undoLedgerApi() below.
    showToast(language === 'বাংলা' ? 'পেমেন্ট রেকর্ড মুছে ফেলা হয়েছে — রিসিটও সরানো হয়েছে' : 'Payment record removed — receipt withdrawn');
    setActiveModal(null);

    if (booking) {
      const mongoId = booking._id || bookingId;
      undoLedgerApi(mongoId, key).catch(err => {
        console.warn('[host] undo ledger sync failed:', err.message || err);
      });
    }
  };

  // Send a manual rent reminder. The server cron handles the auto-reminders;
  // this endpoint is for "send now" buttons. Both go through the same channel.
  // TODO(backend): POST /api/host/bookings/{bookingId}/remind  body: { monthKey, channel }
  const sendRentReminder = (booking, key) => {
    const monthLabel = monthFullLabel(key, language);
    showToast(language === 'বাংলা'
      ? `${booking.tenant} কে ${monthLabel} এর রিমাইন্ডার পাঠানো হয়েছে`
      : `Reminder sent to ${booking.tenant} for ${monthLabel}`);
  };

  // Toggle auto-reminder on/off for a booking. The server cron reads this flag.
  // TODO(backend): PATCH /api/host/bookings/{bookingId}  body: { autoReminder }
  const toggleAutoReminder = (bookingId) => {
    setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, autoReminder: !b.autoReminder } : b));
  };

  // Convert an inquiry into a booking. PREMIUM-GATED — non-premium hosts get
  // an upgrade prompt instead. Pre-fills the lease form from the inquiry so
  // the host doesn't retype the tenant name / phone / property.
  const openConvertInquiry = (inquiry) => {
    if (!isPremium) {
      setModalData(inquiry);
      setActiveModal('premium_gate');
      return;
    }
    // Hassle-free: no "mark Accepted first" step — Accept goes straight to the
    // pre-filled lease modal; confirming it creates the booking and the server
    // marks the inquiry 'converted'.
    // Pre-fill from inquiry; host adjusts dates + rent before confirming.
    const matchingProp = properties.find(p => p.id === inquiry.propertyId) || null;
    const start = todayIso();
    // Default to a 12-month lease ending the day before the same date next year.
    const startDate = new Date(start);
    const endDate = new Date(startDate.getFullYear() + 1, startDate.getMonth(), startDate.getDate() - 1);
    const endIso = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
    setLeaseForm({
      inquiryId: inquiry.id,
      propertyId: inquiry.propertyId || (matchingProp?.id ?? ''),
      property: inquiry.propTitle || matchingProp?.title || '',
      tenant: inquiry.user || '',
      tenantPhone: inquiry.phone || '',
      leaseStart: start,
      leaseEnd: endIso,
      monthlyRent: String(matchingProp?.price || '').replace(/[^\d]/g, '') || '',
      rentDueDay: 5,
      reminderLeadDays: 3,
      autoReminder: true,
      notes: inquiry.msg ? `From inquiry: ${inquiry.msg.slice(0, 140)}${inquiry.msg.length > 140 ? '…' : ''}` : '',
    });
    setActiveModal('create_lease');
  };

  // Reject an inquiry
  const rejectInquiry = (inquiry) => {
    setInquiries(prev => prev.map(i => i.id === inquiry.id ? { ...i, status: 'rejected' } : i));
    updateInquiryStatus(inquiry.id, 'rejected').catch(err => {
      console.warn('[host] inquiry reject sync failed:', err.message || err);
    });
    showToast(language === 'বাংলা' ? 'ইনকোয়ারি রিজেক্ট করা হয়েছে।' : 'Inquiry rejected.');
  };

  const acceptInquiry = (inquiry) => {
    setInquiries(prev => prev.map(i => i.id === inquiry.id ? { ...i, status: 'accepted' } : i));
    updateInquiryStatus(inquiry.id, 'accepted').catch(err => {
      console.warn('[host] inquiry accept sync failed:', err.message || err);
    });
    showToast(language === 'বাংলা' ? 'ইনকোয়ারি একসেপ্ট করা হয়েছে।' : 'Inquiry accepted.');
  };

  const cutInquiry = (inquiryId) => {
    setInquiries(prev => prev.filter(i => i.id !== inquiryId));
    deleteInquiry(inquiryId).catch(err => {
      console.warn('[host] inquiry delete failed:', err.message || err);
    });
    showToast(language === 'বাংলা' ? 'ইনকোয়ারি ডিলিট করা হয়েছে।' : 'Inquiry permanently deleted.');
  };

  // Open create_lease standalone (no inquiry pre-fill).
  const openBlankLease = () => {
    setLeaseForm({
      inquiryId: null,
      propertyId: properties[0]?.id || '',
      property: properties[0]?.title || '',
      tenant: '',
      tenantPhone: '',
      leaseStart: todayIso(),
      leaseEnd: '',
      monthlyRent: '',
      rentDueDay: 5,
      reminderLeadDays: 3,
      autoReminder: true,
      notes: '',
    });
    setActiveModal('create_lease');
  };

  // Persist a new booking + initialise an empty ledger.
  // TODO(backend): POST /api/host/bookings  body: { ...leaseForm }
  //   On success the inquiry should be marked converted server-side.
  const submitCreateLease = () => {
    if (!isPremium) { setActiveModal('premium_gate'); return; }
    const { tenant, tenantPhone, propertyId, leaseStart, leaseEnd, monthlyRent } = leaseForm;
    if (!tenant.trim()) { showToast(language === 'বাংলা' ? 'ভাড়াটিয়ার নাম দিন' : 'Tenant name is required'); return; }
    if (!tenantPhone.trim()) { showToast(language === 'বাংলা' ? 'ফোন নম্বর দিন' : 'Tenant phone is required'); return; }
    if (!propertyId) { showToast(language === 'বাংলা' ? 'প্রপার্টি সিলেক্ট করুন' : 'Pick a property'); return; }
    if (!leaseStart || !leaseEnd) { showToast(language === 'বাংলা' ? 'লিজের তারিখ দিন' : 'Lease dates are required'); return; }
    if (new Date(leaseEnd) <= new Date(leaseStart)) {
      showToast(language === 'বাংলা' ? 'শেষ তারিখ শুরুর তারিখের পরে হতে হবে' : 'End date must be after start date');
      return;
    }
    const rent = Number(monthlyRent) || 0;
    if (rent <= 0) { showToast(language === 'বাংলা' ? 'মাসিক ভাড়া দিন' : 'Monthly rent is required'); return; }

    const matchingProp = properties.find(p => p.id === Number(propertyId)) || null;
    const initials = tenant.trim().split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase() || 'NT';
    const newBooking = {
      id: `BKG-${String(Date.now()).slice(-6)}`,
      inquiryId: leaseForm.inquiryId,
      propertyId: Number(propertyId),
      property: matchingProp?.title || leaseForm.property,
      tenant: tenant.trim(),
      tenantInit: initials,
      tenantPhone: tenantPhone.trim(),
      tenantEmail: '',
      leaseStart,
      leaseEnd,
      monthlyRent: rent,
      rentDueDay: Number(leaseForm.rentDueDay) || 5,
      reminderLeadDays: Number(leaseForm.reminderLeadDays) || 3,
      autoReminder: !!leaseForm.autoReminder,
      chatId: leaseForm.inquiryId || Date.now(),
      notes: leaseForm.notes || '',
      ledger: {},
    };
    setBookings(prev => [newBooking, ...prev]);

    createBookingApi({
      propertyId: matchingProp ? matchingProp._id || matchingProp.id : propertyId,
      inquiryId: leaseForm.inquiryId,
      leaseStart,
      leaseEnd,
      rentDueDay: Number(leaseForm.rentDueDay) || 5,
      reminderLeadDays: Number(leaseForm.reminderLeadDays) || 3,
      autoReminder: !!leaseForm.autoReminder,
      notes: leaseForm.notes || '',
      tenant: tenant.trim(),
      tenantPhone: tenantPhone.trim(),
      monthlyRent: rent,
    }).then(saved => {
      setBookings(prev => prev.map(b => b.id === newBooking.id ? { ...b, ...saved } : b));
    }).catch(err => {
      console.warn('[host] booking create sync failed:', err.message || err);
      showToast(language === 'বাংলা' ? 'বুকিং লোকালি সেভ — সার্ভার সিঙ্ক পেন্ডিং' : 'Booking saved locally — server sync pending');
    });

    // Mark the originating property as rented so it stops appearing in the
    // public listings while this lease is active.
    if (matchingProp) {
      setProperties(prev => prev.map(p => p.id === matchingProp.id ? { ...p, status: 'rented' } : p));
    }

    // Archive the inquiry so it disappears from the inbox once converted.
    if (leaseForm.inquiryId) {
      setInquiries(prev => prev.filter(i => i.id !== leaseForm.inquiryId));
    }

    showToast(language === 'বাংলা' ? 'বুকিং তৈরি হয়েছে! রেন্ট লেজার চালু হয়েছে।' : 'Booking created — rent ledger is live.');
    setActiveModal(null);
    // Land on the Bookings tab so the host sees the new lease's agreement
    // metadata (term, deposit, next-due) right away. The 12-month rent
    // matrix is one click away on the Rent Collection tab.
    setActiveTab('bookings');
  };

  // 🟢 100% FIXED: Moved logic inside the component to prevent White Screen Error!
  const retryLoadProperties = () => setPropertyRefreshTick((tick) => tick + 1);
  const filteredProperties = properties.filter(p => p.title.toLowerCase().includes(searchQuery.toLowerCase()) || p.location.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredPropertiesByStatus = filteredProperties.filter(p => propertyFilter === 'all' || p.status === propertyFilter);

  const recentProps = filteredProperties.filter(p => isRecent(p.addedDate));
  const dashboardProperties = recentProps.length > 0 ? recentProps : filteredProperties.slice(0, 3);
  const dashboardPropTitle = recentProps.length > 0 
      ? (language === 'বাংলা' ? 'সাম্প্রতিক লিস্টিং' : 'Recent Listings') 
      : (language === 'বাংলা' ? 'আপনার প্রপার্টিসমূহ' : 'Your Properties');

  const displayedInquiries = inquiries.filter(i => {
    const matchesSearch = i.user.toLowerCase().includes(searchQuery.toLowerCase()) || i.propTitle.toLowerCase().includes(searchQuery.toLowerCase());
    const s = i.status || 'new';
    if (inquiryTab === 'pending') return (s === 'new' || s === 'pending') && matchesSearch;
    if (inquiryTab === 'accepted') return s === 'accepted' && matchesSearch;
    if (inquiryTab === 'rejected') return s === 'rejected' && matchesSearch;
    return false;
  });

  // The two Smart Features used to live as big CTA cards on the Dashboard tab
  // but they didn't visually fit, so we moved them into the sidebar as proper
  // tabs. They open the existing /smart-alerts and /ai-insights pages — no
  // route changes, so any old in-app links still work.
  const menuItems = [
    { id: 'dashboard', icon: LayoutDashboard, label: t?.dashboard || (language === 'বাংলা' ? 'ড্যাশবোর্ড' : "Dashboard") },
    { id: 'analytics', icon: TrendingUp, label: language === 'বাংলা' ? 'অ্যানালিটিক্স' : "Analytics" },
    { id: 'documents', icon: Folder, label: language === 'বাংলা' ? 'ডকুমেন্ট ভল্ট' : "Documents" },
    { id: 'properties', icon: Building, label: t?.myProperties || (language === 'বাংলা' ? 'আমার বাসাসমূহ' : "My Properties") },
    { id: 'inquiries', icon: Zap, label: t?.inquiries || (language === 'বাংলা' ? 'যোগাযোগ সমূহ' : "Inquiries") },
    { id: 'messages', icon: MessageCircle, label: t?.messages || (language === 'বাংলা' ? 'বার্তা' : "Messages"), isLink: true, path: '/messages' },
    { id: 'bookings', icon: Calendar, label: t?.bookings || (language === 'বাংলা' ? 'বুকিং' : "Bookings") },
    { id: 'rent',     icon: Wallet,   label: language === 'বাংলা' ? 'ভাড়া কালেকশন' : "Rent Collection" },
    { id: 'smartAlerts', icon: BellRing, label: language === 'বাংলা' ? 'স্মার্ট অ্যালার্টস' : 'Smart Alerts' },
    { id: 'aiInsights',  icon: Sparkles, label: language === 'বাংলা' ? 'এআই ইনসাইটস'   : 'AI Insights' },
    { id: 'settings', icon: Settings, label: language === 'বাংলা' ? 'সেটিংস' : 'Settings' },
    { id: 'support', icon: HelpCircle, label: language === 'বাংলা' ? 'হেল্প ও সাপোর্ট' : 'Support' },
  ];

  return (
    <div className="flex flex-col min-h-screen bg-[#eaeff5] font-sans relative overflow-hidden text-gray-900 selection:bg-[#ba0036] selection:text-white">
      
      {/* ✨ GLOWING ORBS ✨ */}
      <div className="fixed top-[-20%] left-[-10%] w-[50vw] h-[50vw] bg-gradient-to-br from-[#ba0036]/10 to-transparent rounded-full blur-[120px] pointer-events-none z-0"></div>
      <div className="fixed bottom-[-20%] right-[-10%] w-[50vw] h-[50vw] bg-gradient-to-tl from-blue-600/5 to-transparent rounded-full blur-[120px] pointer-events-none z-0"></div>

      {/* PERSISTENT VERIFICATION CHIP — a quiet floating pill that lives
          in the bottom-right (above the mobile bottom-nav rail) until the
          host has uploaded their NID and finished face verification.
          Soft pulse + slight float so it's noticeable without being
          aggressive; click → opens the Profile tab where verification
          lives. The chip stays out of the way of toasts (z-[80] vs
          z-[100] for toasts) and never blocks input. */}
      {!(verificationStatus.nidUploaded && verificationStatus.faceVerified) && (
        <button
          onClick={() => { setActiveTab('profile'); setIsProfileDrawerOpen(false); }}
          className="fixed z-[80] right-4 md:right-6 bottom-[5.5rem] md:bottom-6 group flex items-center gap-2.5 pl-2.5 pr-4 py-2 rounded-full text-white shadow-[0_18px_40px_rgba(186,0,54,0.35)] hover:shadow-[0_24px_50px_rgba(186,0,54,0.5)] hover:-translate-y-0.5 transition-all backdrop-blur-xl"
          style={{
            background: 'linear-gradient(135deg, #ba0036 0%, #ff004c 50%, #ba0036 100%)',
            border: '1px solid rgba(255,255,255,0.25)',
          }}
          title={language === 'বাংলা' ? 'প্রোফাইল ভেরিফাই করুন' : 'Verify your profile'}
        >
          <span className="relative flex items-center justify-center w-7 h-7 rounded-full bg-white/15">
            <span className="absolute inline-flex w-full h-full rounded-full bg-white/30 animate-ping" />
            <ScanFace size={14} className="relative" />
          </span>
          <span className="text-[11px] font-black uppercase tracking-widest hidden sm:inline">
            {language === 'বাংলা' ? 'প্রোফাইল ভেরিফাই' : 'Verify Profile'}
          </span>
          <span className="text-[11px] font-black uppercase tracking-widest sm:hidden">
            {language === 'বাংলা' ? 'ভেরিফাই' : 'Verify'}
          </span>
        </button>
      )}

      {/* TOAST NOTIFICATION (supports undo + error/success types) */}
      {(() => {
        const toastText = typeof toastMessage === 'string' ? toastMessage : toastMessage?.text;
        const toastUndo = typeof toastMessage === 'object' ? toastMessage?.undo : null;
        const toastType = typeof toastMessage === 'object' ? (toastMessage?.type || 'success') : 'success';
        const isError = toastType === 'error';
        return (
          <div className={`fixed top-8 left-1/2 -translate-x-1/2 z-[100] transition-all duration-500 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] ${toastMessage ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-10 scale-95 pointer-events-none'}`}>
            <div className="bg-gray-900/90 backdrop-blur-2xl text-white px-5 py-3 rounded-full shadow-[0_20px_40px_rgba(0,0,0,0.2)] border border-white/10 flex items-center gap-3">
              <div className={`w-5 h-5 ${isError ? 'bg-red-500/20' : 'bg-green-500/20'} rounded-full flex items-center justify-center`}>
                {isError
                  ? <AlertCircle size={12} className="text-red-400" />
                  : <CheckCircle2 size={12} className="text-green-400" />}
              </div>
              <span className="text-xs font-bold tracking-wide">{toastText}</span>
              {toastUndo && (
                <button
                  onClick={() => { toastUndo(); setToastMessage(null); clearTimeout(toastTimerRef.current); }}
                  className="ml-1 px-3 py-1 bg-white/15 hover:bg-white/25 rounded-full text-[10px] font-black uppercase tracking-widest transition-colors"
                >
                  {language === 'বাংলা' ? 'আনডু' : 'Undo'}
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* --- TOP HEADER --- */}
      <div className="w-full max-w-[1600px] mx-auto z-40 relative">
        <header className="mx-4 md:mx-8 mt-4 bg-white/60 backdrop-blur-3xl border border-white/80 rounded-[2rem] px-4 md:px-8 py-3.5 flex items-center justify-between shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <Link to="/" className="flex items-center gap-3 z-10 group">
            <div className="bg-gradient-to-br from-[#ba0036] to-[#ff004c] p-2.5 rounded-xl shadow-[0_4px_15px_rgba(186,0,54,0.3)] group-hover:scale-105 transition-transform">
              <Building2 className="text-white w-4 h-4 md:w-[18px] md:h-[18px]" />
            </div>
            <h1 className="text-xl md:text-2xl font-black text-gray-900 tracking-tighter hidden sm:block">
              TO-LET <span className="text-[#ba0036]">PRO</span>
            </h1>
            {/* Beta badge (Phase 7) — signals the app is in beta testing. */}
            <span className="ml-1 px-1.5 py-0.5 text-[9px] md:text-[10px] font-black uppercase tracking-wider text-[#ba0036] bg-red-50 border border-[#ba0036]/30 rounded-md leading-none self-center hidden sm:block">
              Beta
            </span>
          </Link>
          
          {/* Header trimmed to match the public homepage navbar: logo +
              notification bell + profile. The search bar and the language
              toggle were removed at the host's request — language can still
              be switched from the global Navbar on every other route. */}

          <div className="flex items-center gap-3 md:gap-4 z-10 ml-auto">
            <div className="relative cursor-pointer" ref={notifRef}>
              <button onClick={() => setIsNotifOpen(!isNotifOpen)} className="p-2 bg-white/60 rounded-xl hover:bg-white transition-all border border-white/80 shadow-sm relative group">
                <Bell size={18} className="text-gray-500 group-hover:text-blue-600 transition-colors" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#ba0036] opacity-75"></span><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#ba0036] border-2 border-white"></span></span>
                )}
              </button>
              {isNotifOpen && (
                // Mobile: full-width fixed panel anchored to the top of the
                // viewport so it never spills off-screen. The bell sits next
                // to the profile button (not at the screen edge), so a plain
                // `absolute right-0` would push the 18rem panel past the left
                // edge on narrow viewports.
                // sm+:  revert to the original absolute placement under the bell.
                <div className="fixed sm:absolute top-[5.25rem] sm:top-full inset-x-3 sm:inset-auto sm:right-0 sm:mt-3 w-auto sm:w-72 max-h-[calc(100vh-6rem)] sm:max-h-none overflow-y-auto sm:overflow-visible bg-white/95 backdrop-blur-3xl border border-white shadow-[0_30px_60px_rgba(0,0,0,0.12)] rounded-[1.5rem] p-2 z-[100] animate-in fade-in zoom-in-95 origin-top-right">
                  <div className="p-3 border-b border-gray-50 flex justify-between items-center">
                    <h3 className="text-[13px] font-black text-gray-900 tracking-tight">{t?.notifications || (language === 'বাংলা' ? 'নোটিফিকেশন' : 'Notifications')}</h3>
                    {unreadCount > 0 && (
                      <span className="bg-[#ba0036]/10 text-[#ba0036] px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest">{unreadCount} {t?.new || (language === 'বাংলা' ? 'নতুন' : 'New')}</span>
                    )}
                  </div>
                  <div className="p-1.5 space-y-1.5 max-h-[300px] overflow-y-auto">
                    {notifications.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-4">No notifications</p>
                    ) : (
                      notifications.map(notif => (
                        <div key={notif.id} onClick={async () => { 
                            try { 
                              await markRead(notif.id); 
                              setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read: true } : n));
                              setUnreadCount(prev => Math.max(0, prev - 1));
                            } catch (err) {} 
                            setIsNotifOpen(false); 
                            handleNotifClick(notif);
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

            <button onClick={() => setIsProfileDrawerOpen(true)} className="flex items-center gap-2 p-1 pr-3 bg-white/60 rounded-xl border border-white/80 shadow-sm hover:shadow-md hover:bg-white transition-all active:scale-95">
              <div className="relative">
                {userData.avatar ? (
                  <img src={userData.avatar} alt={userData.fullName} className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-[#ba0036] text-white flex items-center justify-center font-bold text-sm">{userData.fullName.charAt(0)}{userData.fullName.split(' ')[1]?.charAt(0)}</div>
                )}
                {(verificationStatus.nidUploaded && verificationStatus.faceVerified) && <div className="absolute -bottom-1 -right-1 bg-blue-500 rounded-full border-2 border-white text-white p-[1px] shadow-sm"><BadgeCheck size={12} /></div>}
              </div>
              <div className="hidden md:block text-left ml-1">
                <p className="text-xs font-black text-gray-800 leading-none truncate max-w-[80px]">{userData.fullName.split(' ')[0]}</p>
                <p className="text-[9px] font-bold text-[#ba0036] uppercase tracking-widest mt-0.5">{t?.hostPortal || (language === 'বাংলা' ? 'হোস্ট পোর্টাল' : 'Host Portal')}</p>
              </div>
            </button>
          </div>
        </header>
      </div>

      {/* 🔴 HOST DASHBOARD SLIDE BAR (Right Drawer) */}
      {isProfileDrawerOpen && <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[60] animate-in fade-in" onClick={() => setIsProfileDrawerOpen(false)}></div>}
      
      <div className={`fixed top-0 right-0 h-full w-full max-w-[280px] bg-[#fdfdfd] shadow-2xl z-[70] transform transition-transform duration-500 ease-in-out flex flex-col border-l border-gray-100 ${isProfileDrawerOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="p-5 pb-3 flex flex-col gap-4 relative">
          <button onClick={() => setIsProfileDrawerOpen(false)} className="absolute top-5 right-5 p-1.5 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors z-10"><X size={18} /></button>
          <div onClick={() => { setActiveTab('profile'); setIsProfileDrawerOpen(false); }} className="flex items-center gap-3 bg-gray-50 hover:bg-[#ba0036]/5 p-3 pr-8 rounded-2xl border border-gray-100 mt-2 cursor-pointer transition-all group">
            <div className="relative shrink-0">
              {userData.avatar ? (
                <img src={userData.avatar} alt={userData.fullName} className="w-10 h-10 rounded-full object-cover group-hover:scale-105 transition-transform" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-[#ba0036] text-white flex items-center justify-center font-bold text-lg group-hover:scale-105 transition-transform">{userData.fullName.charAt(0)}{userData.fullName.split(' ')[1]?.charAt(0)}</div>
              )}
              {(verificationStatus.nidUploaded && verificationStatus.faceVerified) && <div className="absolute -bottom-1 -right-1 bg-blue-500 rounded-full border-2 border-white text-white p-[1px] shadow-sm"><BadgeCheck size={12} /></div>}
            </div>
            <div>
              <p className="text-[13px] font-black text-gray-900 leading-tight group-hover:text-[#ba0036] transition-colors truncate max-w-[120px]">{userData.fullName}</p>
              <p className="text-[9px] font-bold text-[#ba0036] uppercase tracking-widest mt-0.5">{t?.managingUrbanLiving || (language === 'বাংলা' ? 'ম্যানেজিং আরবান লিভিং' : 'MANAGING URBAN LIVING')}</p>
            </div>
          </div>
        </div>

        <div className="px-5 pb-2">
          <Link to="/list-property" className="w-full relative group overflow-hidden bg-gray-900 text-white py-3 rounded-xl font-black text-xs shadow-md flex items-center justify-center gap-2 hover:shadow-[0_10px_20px_rgba(186,0,54,0.3)] hover:bg-[#ba0036] transition-all duration-500">
            <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-500 ease-out"></div>
            <Plus size={16} className="relative z-10" /> <span className="relative z-10">{t?.newListing || (language === 'বাংলা' ? 'নতুন লিস্টিং যোগ করুন' : 'Add New Listing')}</span>
          </Link>
        </div>

        <nav className="flex-1 px-3 space-y-1 overflow-y-auto custom-scrollbar [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {menuItems.map((item) => {
             const isActive = activeTab === item.id && !item.isLink;
             // Premium feature locked after trial expires → click sends
             // the host to /subscription with a `from` param so the page
             // can highlight exactly which feature triggered the gate.
             const locked = isFeatureLocked(item.id);
             const handleClick = () => {
               setIsProfileDrawerOpen(false);
               if (locked) { navigate(`/subscription?from=${item.id}`); return; }
               if (item.isLink) navigate(item.path);
               else setActiveTab(item.id);
             };
             return (
              <button
                key={item.id}
                onClick={handleClick}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer font-bold text-xs text-left transition-all duration-300 ${isActive ? 'bg-red-50 text-[#ba0036]' : locked ? 'text-gray-400 hover:bg-amber-50/40' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'}`}
                title={locked ? (language === 'বাংলা' ? 'প্রিমিয়াম ফিচার — সাবস্ক্রাইব করুন' : 'Premium feature — subscribe to unlock') : undefined}
              >
                <item.icon size={16} className={isActive ? 'text-[#ba0036]' : locked ? 'text-amber-500' : 'text-gray-400'} />
                <span className="flex-1 tracking-wide flex justify-between items-center">
                   {item.label}
                   {item.id === 'inquiries' && inquiries.filter(i => i.status === 'new').length > 0 && (
                     <span className="bg-[#ba0036] text-white text-[9px] px-1.5 py-0.5 rounded-full font-black">
                       {inquiries.filter(i => i.status === 'new').length}
                     </span>
                   )}
                </span>
                {locked && <Lock size={12} className="text-amber-500" />}
              </button>
             )
          })}
        </nav>

        <div className="p-5 border-t border-gray-100 bg-gray-50/50 flex flex-col gap-3 mt-auto">
          {/* Trial / Pro status pill — gives the host a constant view of
              their remaining trial days (or active Pro coverage). Tapping
              the pill or the CTA below sends them to /subscription. */}
          {!subStatus.isPaid && (
            <div className={`px-3 py-2 rounded-xl border ${subStatus.isExpired ? 'bg-red-50 border-red-100 text-red-700' : 'bg-blue-50 border-blue-100 text-blue-700'} flex items-center gap-2 text-[10px] font-black uppercase tracking-widest`}>
              <Clock size={12} />
              {subStatus.isExpired
                ? (language === 'বাংলা' ? 'ট্রায়াল শেষ' : 'Trial ended')
                : (language === 'বাংলা' ? `ট্রায়াল: ${subStatus.daysRemaining} দিন বাকি` : `Trial · ${subStatus.daysRemaining}d left`)}
            </div>
          )}
          {subStatus.isPaid ? (
            <button
              onClick={() => { setIsProfileDrawerOpen(false); navigate('/subscription'); }}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl font-bold shadow-[0_8px_20px_rgba(16,185,129,0.25)] transition-all active:scale-95 text-[11px] tracking-wide uppercase flex items-center justify-center gap-2"
            >
              <Crown size={14}/> {language === 'বাংলা' ? 'প্রো অ্যাক্টিভ' : 'Pro Active'}
            </button>
          ) : (
            <button
              onClick={() => { setIsProfileDrawerOpen(false); navigate('/subscription'); }}
              className="w-full bg-[#ba0036] hover:bg-[#90002a] text-white py-3 rounded-xl font-bold shadow-[0_8px_20px_rgba(186,0,54,0.25)] transition-all active:scale-95 text-[11px] tracking-wide uppercase flex items-center justify-center gap-2"
            >
              <Sparkles size={14}/> {language === 'বাংলা' ? 'প্রো-তে আপগ্রেড' : 'Upgrade to Pro'}
            </button>
          )}
          <button
            onClick={async () => {
              showToast(language === 'বাংলা' ? 'লগআউট হচ্ছে...' : 'Logging out...');
              try { await authLogout(); } finally { setIsProfileDrawerOpen(false); navigate('/'); }
            }}
            className="flex items-center justify-center gap-2 text-[#3b2a2a] hover:text-[#ba0036] font-bold transition-colors w-full py-1.5 group"
          >
            <LogOut size={16} className="group-hover:-translate-x-1 transition-transform" />
            <span className="tracking-wider text-[11px] uppercase">Logout</span>
          </button>
        </div>
      </div>

      {/* --- MAIN CONTENT --- */}
      <main className="flex-1 w-full max-w-[1600px] mx-auto px-4 md:px-8 lg:px-12 pt-6 md:pt-10 relative z-10 custom-scrollbar overflow-y-auto pb-24">
        
        {activeDropdownId && <div className="fixed inset-0 z-20" onClick={() => setActiveDropdownId(null)}></div>}

        {/* 🔴 PROFILE & VERIFICATION TAB */}
        {activeTab === 'profile' && (
          <div className="w-full mb-10 animate-in fade-in zoom-in-95 duration-500">
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 md:gap-8">

              {/* === LEFT (2 cols on xl): Header + Personal Info + Verification Center === */}
              <div className="xl:col-span-2 space-y-6 md:space-y-8">
                <ProfileSection
                  role="landlord"
                  user={userData}
                  profile={landlordProfile}
                  trustScore={landlordTrustScore}
                  verificationStatus={verificationStatus}
                  language={language}
                  onUpdate={async (patch) => {
                    const next = applyLandlordPatch(landlordProfile, patch);
                    await persistLandlordProfile(next);
                    showToast(language === 'বাংলা' ? 'প্রোফাইল আপডেট হয়েছে' : 'Profile updated');
                  }}
                  onAvatarUpload={async (file, _source, onProgress) => {
                    try {
                      const res = await uploadAvatar(file, { onProgress });
                      setUserData(prev => ({ ...prev, avatar: res?.user?.avatar || res?.avatar || prev.avatar }));
                      showToast(language === 'বাংলা' ? 'প্রোফাইল ছবি আপডেট হয়েছে!' : 'Profile photo updated!');
                    } catch (err) {
                      console.error('[AvatarUpload] failed:', err?.message || err);
                      showToast(language === 'বাংলা' ? 'ছবি আপলোড ব্যর্থ হয়েছে' : 'Photo upload failed');
                      throw err;
                    }
                  }}
                  onOpenVerification={() => setVerifModalOpen(true)}
                />
              </div>

              {/* === RIGHT (1 col on xl): Trust Score + Timeline + Quick Wins === */}
              <div className="xl:col-span-1 space-y-6 md:space-y-8">

                <TrustGauge
                  score={landlordTrustScore.score}
                  tier={landlordTrustScore.tier}
                  breakdown={landlordTrustScore.breakdown}
                  language={language}
                />

                <QuickWinsCard
                  breakdown={landlordTrustScore.breakdown}
                  language={language}
                  onJump={() => {
                    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                />

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
                      done={!!userData.phone}
                      icon={Phone}
                      textEn="Phone OTP verified"
                      textBn="ফোন OTP ভেরিফাইড"
                      language={language}
                    />
                    <TimelineRow
                      done={!!userData.avatar}
                      icon={Camera}
                      textEn="Profile photo uploaded"
                      textBn="প্রোফাইল ছবি আপলোড"
                      language={language}
                    />
                    <TimelineRow
                      done={verificationStatus.nidUploaded}
                      icon={ScanFace}
                      textEn="National ID uploaded"
                      textBn="NID আপলোড"
                      language={language}
                    />
                    <TimelineRow
                      done={verificationStatus.underReview || (verificationStatus.faceVerified && verificationStatus.nidUploaded)}
                      icon={Hourglass}
                      textEn="Submitted for admin review"
                      textBn="অ্যাডমিন রিভিউয়ের জন্য সাবমিট"
                      language={language}
                    />
                    <TimelineRow
                      done={verificationStatus.faceVerified && verificationStatus.nidUploaded && !verificationStatus.underReview}
                      icon={BadgeCheck}
                      textEn="Verified by To-Let Pro"
                      textBn="To-Let Pro দ্বারা ভেরিফাইড"
                      language={language}
                      isFinal
                    />
                  </div>
                </div>

              </div>
            </div>
            
            {verifModalOpen && (
              <VerificationModal
                isOpen={verifModalOpen}
                onClose={() => setVerifModalOpen(false)}
                onSubmit={handleHostWizardSubmit}
                language={language}
                role="landlord"
                initialData={{
                  nidVerified: authUser?.tenantProfile?.verification?.status === 'verified' || !!authUser?.tenantProfile?.verification?.nidFront || !!authUser?.landlordProfile?.verification?.nidFront
                }}
              />
            )}
          </div>
        )}

        {/* 🔴 OPTIMIZED MOBILE-FIRST DASHBOARD */}
        {activeTab === 'dashboard' && (
          <div className="animate-in fade-in zoom-in-95 duration-500 space-y-6 md:space-y-8">

            {/* ১. Stats Bento Grid */}
            <div className="grid grid-cols-3 gap-3 md:gap-5">
              {[
                {
	                  icon: Building, bg: 'bg-gradient-to-br from-red-50 to-rose-100/60', iconColor: 'text-[#ba0036]',
	                  label: language === 'বাংলা' ? 'মোট বাসা' : 'PROPERTIES',
	                  value: isPropertiesLoading && properties.length === 0 ? '...' : properties.length, shadow: 'shadow-[0_4px_20px_rgba(186,0,54,0.08)]',
	                  indicator: 'bg-[#ba0036]'
	                },
	                {
	                  icon: TrendingUp, bg: 'bg-gradient-to-br from-emerald-50 to-green-100/60', iconColor: 'text-emerald-600',
	                  label: language === 'বাংলা' ? 'অ্যাক্টিভ' : 'ACTIVE',
	                  value: isPropertiesLoading && properties.length === 0 ? '...' : properties.filter(p => p.status === 'active').length, shadow: 'shadow-[0_4px_20px_rgba(16,185,129,0.08)]',
	                  indicator: 'bg-emerald-500'
	                },
                {
                  icon: MessageSquare, bg: 'bg-gradient-to-br from-violet-50 to-purple-100/60', iconColor: 'text-violet-600',
                  label: language === 'বাংলা' ? 'যোগাযোগ' : 'INQUIRIES',
                  value: inquiries.length, shadow: 'shadow-[0_4px_20px_rgba(124,58,237,0.08)]',
                  indicator: 'bg-violet-500'
                },
              ].map((stat, i) => (
                <div key={i} className={`bg-white p-3 md:p-7 rounded-2xl md:rounded-[1.5rem] ${stat.shadow} border border-white/80 flex flex-col items-center md:items-start justify-center group hover:scale-[1.02] transition-all duration-300 cursor-default relative overflow-hidden`}>
                  <div className={`absolute top-0 right-0 w-16 h-16 md:w-24 md:h-24 rounded-full -translate-y-1/2 translate-x-1/2 ${stat.bg} blur-2xl opacity-60 pointer-events-none`}></div>
                  <div className={`w-8 h-8 md:w-11 md:h-11 rounded-xl ${stat.bg} flex items-center justify-center ${stat.iconColor} mb-2 md:mb-3 shrink-0`}>
                    <stat.icon size={15} className="md:w-5 md:h-5" />
                  </div>
                  <p className="text-[7px] md:text-[10px] font-black text-gray-400 uppercase tracking-widest text-center md:text-left leading-tight">{stat.label}</p>
                  <h3 className="text-2xl md:text-5xl font-black text-gray-900 leading-none mt-0.5 md:mt-1">{stat.value}</h3>
                  <div className={`w-6 h-1 rounded-full mt-2 md:mt-3 ${stat.indicator} opacity-40`}></div>
                </div>
              ))}
            </div>

            {/* ১.৫ Shared Ledger Overview — bird's-eye snapshot of the new
                Rent Collection tab. Tapping anywhere on the card (or the
                top-right "OPEN LEDGER" pill) jumps the host into the full
                Shared Ledger view. The four mini-cards mirror the KPI row
                on that page so the host learns the same vocabulary. */}
            {(() => {
              const todayDate = today;
              const sm = getMonthCollectionSummary(bookings, todayDate.getFullYear(), todayDate.getMonth() + 1, todayDate);
              const collectedPct = sm.expectedTotal > 0 ? Math.min(100, Math.round((sm.collectedTotal / sm.expectedTotal) * 100)) : 0;
              return (
                <div
                  onClick={() => setActiveTab('rent')}
                  className="group relative w-full cursor-pointer bg-white rounded-[1.5rem] p-5 md:p-7 border border-gray-100 shadow-[0_4px_25px_rgba(0,0,0,0.04)] hover:shadow-[0_15px_45px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all duration-300 overflow-hidden"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
                        <Wallet size={18} className="text-emerald-600" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-base md:text-xl font-black text-gray-900 leading-tight">
                          {language === 'বাংলা' ? 'শেয়ার্ড লেজার ওভারভিউ' : 'Shared Ledger Overview'}
                        </h3>
                        <p className="text-[9px] md:text-[10px] font-black text-gray-400 uppercase tracking-widest mt-0.5">
                          {monthFullLabel(sm.key, language)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] md:text-[11px] font-black text-[#ba0036] uppercase tracking-widest group-hover:translate-x-0.5 transition-transform">
                      {language === 'বাংলা' ? 'লেজার দেখুন' : 'Open Ledger'}
                      <ArrowUpRight size={14} />
                    </div>
                  </div>

                  {/* Collection rate progress bar */}
                  <div className="mt-5 md:mt-6">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[9px] md:text-[10px] font-black text-gray-400 uppercase tracking-widest">
                        {language === 'বাংলা' ? 'কালেকশন রেট' : 'Collection Rate'}
                      </span>
                      <span className="text-xs md:text-sm font-black text-[#ba0036] tabular-nums">{collectedPct}%</span>
                    </div>
                    <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-[#ba0036] to-[#ff004c] transition-all duration-700" style={{ width: `${collectedPct}%` }} />
                    </div>
                  </div>

                  {/* 4-KPI strip — same vocabulary as the Rent Collection tab */}
                  <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-emerald-50/60 border border-emerald-100/80 rounded-2xl p-3 md:p-4">
                      <p className="text-[8px] md:text-[9px] font-black text-emerald-700 uppercase tracking-widest">{language === 'বাংলা' ? 'আদায়' : 'Collected'}</p>
                      <p className="text-lg md:text-2xl font-black text-emerald-700 tabular-nums mt-1 leading-none">{formatBDT(sm.collectedTotal)}</p>
                      <p className="text-[8px] md:text-[9px] font-bold text-emerald-700/70 mt-1.5 inline-flex items-center gap-1">
                        <CheckCircle2 size={10} strokeWidth={3}/> {sm.paidCount} {language === 'বাংলা' ? 'ক্লিয়ার্ড' : 'cleared'}
                      </p>
                    </div>
                    <div className="bg-rose-50/60 border border-rose-100/80 rounded-2xl p-3 md:p-4">
                      <p className="text-[8px] md:text-[9px] font-black text-rose-700 uppercase tracking-widest">{language === 'বাংলা' ? 'বকেয়া' : 'Outstanding'}</p>
                      <p className="text-lg md:text-2xl font-black text-rose-700 tabular-nums mt-1 leading-none">{formatBDT(sm.outstandingTotal)}</p>
                      <p className="text-[8px] md:text-[9px] font-bold text-rose-700/70 mt-1.5 inline-flex items-center gap-1">
                        <AlertCircle size={10} strokeWidth={3}/> {sm.overdueCount} {language === 'বাংলা' ? 'বকেয়া' : 'unpaid'}
                      </p>
                    </div>
                    <div className="bg-amber-50/60 border border-amber-100/80 rounded-2xl p-3 md:p-4">
                      <p className="text-[8px] md:text-[9px] font-black text-amber-700 uppercase tracking-widest">{language === 'বাংলা' ? 'আংশিক' : 'Partial'}</p>
                      <p className="text-lg md:text-2xl font-black text-amber-700 tabular-nums mt-1 leading-none">{sm.partialCount}</p>
                      <p className="text-[8px] md:text-[9px] font-bold text-amber-700/70 mt-1.5 inline-flex items-center gap-1">
                        <Hourglass size={10} strokeWidth={3}/> {language === 'বাংলা' ? 'আংশিক পেমেন্ট' : 'partially paid'}
                      </p>
                    </div>
                    <div className="bg-blue-50/60 border border-blue-100/80 rounded-2xl p-3 md:p-4">
                      <p className="text-[8px] md:text-[9px] font-black text-blue-700 uppercase tracking-widest">{language === 'বাংলা' ? 'প্রত্যাশিত' : 'Expected'}</p>
                      <p className="text-lg md:text-2xl font-black text-blue-700 tabular-nums mt-1 leading-none">{formatBDT(sm.expectedTotal)}</p>
                      <p className="text-[8px] md:text-[9px] font-bold text-blue-700/70 mt-1.5 inline-flex items-center gap-1">
                        <Calendar size={10} strokeWidth={3}/> {sm.totalDueCount} {language === 'বাংলা' ? 'ভাড়াটিয়া' : 'tenants'}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ২. Quick Actions */}
            <div>
              <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 px-1">{language === 'বাংলা' ? 'কুইক অ্যাকশন' : 'Quick Actions'}</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { id: 'create_lease', icon: FileEdit, label: language === 'বাংলা' ? 'নতুন চুক্তি' : 'New Contract', color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-100', hover: 'hover:bg-blue-50 hover:border-blue-200' },
                  { id: 'message_all', icon: Megaphone, label: language === 'বাংলা' ? 'সবাইকে মেসেজ' : 'Message All', color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-100', hover: 'hover:bg-green-50 hover:border-green-200' },
                  { id: 'export_report', icon: Download, label: language === 'বাংলা' ? 'রিপোর্ট' : 'Report', color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-100', hover: 'hover:bg-orange-50 hover:border-orange-200' },
                  { id: 'send_reminders', icon: BellRing, label: language === 'বাংলা' ? 'রিমাইন্ডার' : 'Reminder', color: 'text-[#ba0036]', bg: 'bg-red-50', border: 'border-red-100', hover: 'hover:bg-red-50 hover:border-red-200' }
                ].map((action, i) => (
                  <button
                    key={i}
                    onClick={() => openModal(action.id)}
                    className={`group flex flex-col sm:flex-row items-center sm:items-center gap-2 sm:gap-3 bg-white px-3 sm:px-5 py-4 sm:py-3.5 rounded-2xl border ${action.border} shadow-sm active:scale-95 transition-all duration-200 ${action.hover} hover:shadow-md w-full`}
                  >
                    <div className={`w-9 h-9 ${action.bg} ${action.color} rounded-xl flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform duration-200`}>
                      <action.icon size={17}/>
                    </div>
                    <span className="text-[11px] font-black text-gray-700 text-center sm:text-left leading-tight">{action.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* ৩. Recent Properties Grid */}
            <div>
              <div className="flex justify-between items-center mb-4 px-1">
                <h3 className="text-lg md:text-2xl font-black text-gray-900 tracking-tight">{dashboardPropTitle}</h3>
                <button onClick={() => setActiveTab('properties')} className="text-[#ba0036] text-[10px] font-black uppercase tracking-widest hover:underline underline-offset-4 transition-all">
                  {language === 'বাংলা' ? 'সব দেখুন' : 'View All'}
                </button>
              </div>
	              {/* Dashboard overview cards — single-column on phones (matches
	                  the homepage feed), 2-up from sm:, 3-up from lg:. */}
	              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
	                {isPropertiesLoading && dashboardProperties.length === 0 ? (
	                  Array.from({ length: 3 }).map((_, i) => (
	                    <div key={i} className="bg-white rounded-[1.5rem] p-3 shadow-sm border border-gray-50 animate-pulse">
	                      <div className="h-44 md:h-60 rounded-2xl bg-gray-100" />
	                      <div className="py-3 px-1">
	                        <div className="h-4 w-2/3 rounded bg-gray-100" />
	                        <div className="h-3 w-1/2 rounded bg-gray-100 mt-3" />
	                        <div className="grid grid-cols-2 gap-2 mt-4">
	                          <div className="h-9 rounded-xl bg-gray-100" />
	                          <div className="h-9 rounded-xl bg-gray-100" />
	                        </div>
	                      </div>
	                    </div>
	                  ))
	                ) : propertyLoadError && dashboardProperties.length === 0 ? (
	                  <div className="sm:col-span-2 lg:col-span-3 bg-white rounded-[1.5rem] p-6 border border-red-100 shadow-sm">
	                    <div className="flex items-start gap-4">
	                      <div className="w-11 h-11 rounded-2xl bg-red-50 text-[#ba0036] flex items-center justify-center shrink-0">
	                        <AlertCircle size={20} />
	                      </div>
	                      <div className="min-w-0 flex-1">
	                        <h4 className="text-sm md:text-base font-black text-gray-900">
	                          {language === 'বাংলা' ? 'প্রপার্টি লোড করা যায়নি' : 'Could not load your properties'}
	                        </h4>
	                        <p className="text-xs font-bold text-gray-500 mt-1">
	                          {propertyLoadError}
	                        </p>
	                        <button
	                          onClick={retryLoadProperties}
	                          className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#ba0036] text-white text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all"
	                        >
	                          <RefreshCw size={13} />
	                          {language === 'বাংলা' ? 'আবার চেষ্টা করুন' : 'Retry'}
	                        </button>
	                      </div>
	                    </div>
	                  </div>
	                ) : dashboardProperties.length === 0 ? (
	                  <div className="sm:col-span-2 lg:col-span-3 bg-white rounded-[1.5rem] p-6 border border-gray-100 shadow-sm">
	                    <div className="flex items-start gap-4">
	                      <div className="w-11 h-11 rounded-2xl bg-red-50 text-[#ba0036] flex items-center justify-center shrink-0">
	                        <Building2 size={20} />
	                      </div>
	                      <div className="min-w-0 flex-1">
	                        <h4 className="text-sm md:text-base font-black text-gray-900">
	                          {language === 'বাংলা' ? 'এখনও কোনো বাসা নেই' : 'No properties listed yet'}
	                        </h4>
	                        <p className="text-xs font-bold text-gray-500 mt-1">
	                          {language === 'বাংলা' ? 'আপনার প্রথম বাসা লিস্ট করলে এটি এখানে দেখা যাবে।' : 'Your first uploaded property will appear here as soon as it is saved.'}
	                        </p>
	                        <Link
	                          to="/list-property"
	                          className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#ba0036] text-white text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all"
	                        >
	                          <Plus size={13} />
	                          {language === 'বাংলা' ? 'বাসা লিস্ট করুন' : 'List Property'}
	                        </Link>
	                      </div>
	                    </div>
	                  </div>
	                ) : dashboardProperties.map((prop) => (
	                  <div key={prop.id} className="bg-white rounded-[1.5rem] p-3 shadow-sm border border-gray-50 flex flex-col hover:shadow-[0_8px_30px_rgba(0,0,0,0.07)] hover:-translate-y-0.5 transition-all duration-300">
	                    <div className="relative h-44 md:h-60 overflow-hidden rounded-2xl">
	                      <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${prop.img})` }}></div>
                      <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent rounded-2xl"></div>
                      <div className="absolute top-3 left-3 flex gap-1.5">
                        <div className="bg-white/90 backdrop-blur-md px-2.5 py-1 rounded-full text-[9px] font-black uppercase text-green-600 shadow-sm flex items-center gap-1">
                          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div> {prop.status}
                        </div>
                        {isRecent(prop.addedDate) && (
                          <div className="bg-[#ba0036] px-2.5 py-1 rounded-full text-[9px] font-black uppercase text-white shadow-sm">
                            {language === 'বাংলা' ? 'নতুন' : 'NEW'}
                          </div>
                        )}
                      </div>
                      <div className="absolute bottom-3 right-3 bg-gray-900/90 backdrop-blur-sm text-white px-3 py-1.5 rounded-xl font-black text-xs shadow-lg">৳ {prop.price}</div>
                    </div>
                    <div className="py-3 px-1 flex flex-col flex-1">
                      <h4 className="text-sm md:text-base font-black text-gray-900 line-clamp-1">{prop.title}</h4>
                      <p className="text-[10px] font-bold text-gray-400 flex items-center gap-1 mt-1">
                        <MapPin size={10} className="text-[#ba0036] shrink-0" /> {prop.location}
                      </p>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button onClick={() => openModal('edit', prop)} className="bg-gray-50 hover:bg-gray-100 py-2.5 rounded-xl text-[10px] font-black uppercase text-gray-600 active:scale-95 transition-all">
                          {language === 'বাংলা' ? 'এডিট' : 'Edit'}
                        </button>
                        <button onClick={() => setActiveTab('inquiries')} className="bg-[#ba0036] hover:bg-[#90002a] text-white py-2.5 rounded-xl text-[10px] font-black uppercase active:scale-95 transition-all shadow-[0_4px_10px_rgba(186,0,54,0.2)]">
                          {language === 'বাংলা' ? 'ইনকোয়ারি' : 'Inquiries'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

        {/* 🔴 DOCUMENT VAULT TAB */}
        {/* 🔴 DOCUMENT VAULT — futuristic, connected to real bookings/properties/ledger */}
        {activeTab === 'documents' && (() => {
          const todayDate = today;

          // --- Real counts derived from the rest of the dashboard's state -------------------
          // Lease agreements: one per booking that has progressed past 'draft'.
          const leaseAgreements = bookings.filter(b => computeLeaseStage(b, todayDate) !== 'draft');
          // Tenant IDs: assume one NID file per booking with tenantInit (proxy for "tenant on file").
          const tenantIdCount = bookings.filter(b => b.tenantInit).length;
          // Payment receipts: count of paid ledger entries across all bookings (matches the cross-system bridge).
          const paymentReceipts = bookings.reduce((sum, b) => sum + Object.values(b.ledger || {}).filter(e => e?.paid).length, 0);
          // Property photos: 12 photos per property (placeholder ratio until a real media table exists).
          const propertyPhotoCount = properties.length * 12;
          // Legal docs (NOC, ownership): 1 per property by convention.
          const legalCount = properties.length;
          // Inspection reports: 1 move-in + 1 move-out per booking that has ever been active.
          const inspectionCount = bookings.filter(b => ['active','notice','done'].includes(computeLeaseStage(b, todayDate))).length * 2;

          const folders = [
            { id: 'agreements',  icon: FileText,         tint: 'blue',    grad: 'from-blue-500 to-indigo-600',      count: leaseAgreements.length, en: 'Rental Agreements', bn: 'রেন্টাল এগ্রিমেন্ট', desc: language === 'বাংলা' ? `${leaseAgreements.length} সক্রিয় চুক্তি`           : `${leaseAgreements.length} signed leases` },
            { id: 'nids',        icon: ScanFace,         tint: 'emerald', grad: 'from-emerald-500 to-green-600',    count: tenantIdCount,          en: 'Tenant NID / IDs',  bn: 'ভাড়াটিয়া NID / আইডি', desc: language === 'বাংলা' ? `সকল ভাড়াটিয়ার আইডি`                                 : 'All tenants on file' },
            { id: 'payments',    icon: Receipt,          tint: 'amber',   grad: 'from-amber-500 to-orange-500',     count: paymentReceipts,        en: 'Payment Records',   bn: 'পেমেন্ট রেকর্ড',       desc: language === 'বাংলা' ? `${paymentReceipts}টি রিসিপ্ট সংরক্ষিত`                : `${paymentReceipts} receipts archived` },
            { id: 'photos',      icon: ImageIcon,        tint: 'violet',  grad: 'from-violet-500 to-purple-600',    count: propertyPhotoCount,     en: 'Property Photos',   bn: 'প্রপার্টির ছবি',        desc: language === 'বাংলা' ? `${properties.length}টি প্রপার্টিতে`                  : `Across ${properties.length} properties` },
            { id: 'legal',       icon: Scale,            tint: 'rose',    grad: 'from-rose-500 to-red-600',         count: legalCount,             en: 'Legal Documents',   bn: 'লিগ্যাল ডকুমেন্টস',     desc: language === 'বাংলা' ? `NOC, মালিকানার দলিল`                                  : 'NOC, ownership deeds' },
            { id: 'inspections', icon: ClipboardCheck,   tint: 'teal',    grad: 'from-teal-500 to-cyan-600',        count: inspectionCount,        en: 'Inspection Reports', bn: 'ইন্সপেকশন রিপোর্ট',    desc: language === 'বাংলা' ? `মুভ-ইন / মুভ-আউট রিপোর্ট`                              : 'Move-in / move-out' },
          ];

          const totalDocs = folders.reduce((s, f) => s + f.count, 0);

          // Filter: reuse rentPriorityFilter as a generic UI mode so navigation feels continuous,
          // but we map filter IDs onto folder IDs for clarity here.
          const docFilter = leaseStageFilter; // piggyback the existing filter state so we don't add new state
          const visibleFolders = folders.filter(f => {
            if (docFilter === 'all') return true;
            if (docFilter === 'active' && f.id === 'agreements') return true;
            if (docFilter === 'notice' && f.id === 'payments') return true;
            if (docFilter === 'draft'  && f.id === 'nids') return true;
            if (docFilter === 'done'   && (f.id === 'legal' || f.id === 'inspections')) return true;
            if (docFilter === 'all') return true;
            return docFilter === 'all';
          }).filter(f => {
            if (!searchQuery.trim()) return true;
            const q = searchQuery.toLowerCase();
            return (f.en + ' ' + f.bn).toLowerCase().includes(q);
          });

          // File list for active folder — synthesised from real data sources.
          const buildFileList = (folder) => {
            if (!folder) return [];
            if (folder.id === 'agreements') {
              return leaseAgreements.map(b => ({
                id: `agr-${b.id}`,
                name: `Lease_${(b.tenant || 'tenant').replace(/\s+/g,'_')}.pdf`,
                meta: `${formatDate(b.leaseStart)} → ${formatDate(b.leaseEnd)} • PDF`,
                date: b.leaseStart,
                booking: b,
              }));
            }
            if (folder.id === 'nids') {
              return bookings.filter(b => b.tenantInit).map(b => ({
                id: `nid-${b.id}`,
                name: `NID_${(b.tenant || 'tenant').replace(/\s+/g,'_')}.jpg`,
                meta: `${b.tenantPhone || '—'} • Image`,
                date: b.leaseStart,
                booking: b,
              }));
            }
            if (folder.id === 'payments') {
              const out = [];
              bookings.forEach(b => {
                Object.entries(b.ledger || {}).forEach(([k, e]) => {
                  if (e?.paid) {
                    out.push({
                      id: `rcpt-${b.id}-${k}`,
                      name: `Receipt_${(b.tenant || 'tenant').replace(/\s+/g,'_')}_${k}.pdf`,
                      meta: `${monthFullLabel(k)} • ${formatBDT(Number(e.amount || 0))} • ${e.method || 'Cash'}`,
                      date: e.paidOn || `${k}-01`,
                      booking: b,
                    });
                  }
                });
              });
              return out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            }
            if (folder.id === 'photos') {
              return properties.flatMap(p => Array.from({length: 4}, (_, i) => ({
                id: `photo-${p.id}-${i}`,
                name: `${(p.title || 'property').replace(/\s+/g,'_')}_${i+1}.jpg`,
                meta: `${p.location || 'Dhaka'} • Image`,
                date: todayIso(),
                property: p,
              })));
            }
            if (folder.id === 'legal') {
              return properties.map(p => ({
                id: `legal-${p.id}`,
                name: `Ownership_Deed_${(p.title || 'property').replace(/\s+/g,'_')}.pdf`,
                meta: `${p.location || 'Dhaka'} • PDF`,
                date: todayIso(),
                property: p,
              }));
            }
            if (folder.id === 'inspections') {
              const out = [];
              bookings.filter(b => ['active','notice','done'].includes(computeLeaseStage(b, todayDate))).forEach(b => {
                out.push({ id: `insp-in-${b.id}`,  name: `Move-In_${(b.tenant || 'tenant').replace(/\s+/g,'_')}.pdf`,  meta: `${formatDate(b.leaseStart)} • PDF`, date: b.leaseStart, booking: b });
                if (computeLeaseStage(b, todayDate) === 'done') {
                  out.push({ id: `insp-out-${b.id}`, name: `Move-Out_${(b.tenant || 'tenant').replace(/\s+/g,'_')}.pdf`, meta: `${formatDate(b.leaseEnd)} • PDF`,  date: b.leaseEnd,  booking: b });
                }
              });
              return out;
            }
            return [];
          };

          const fileList = buildFileList(activeFolder).filter(f => {
            if (!searchQuery.trim()) return true;
            return f.name.toLowerCase().includes(searchQuery.toLowerCase());
          });

          const tintMap = {
            blue:    { bg: 'bg-blue-50',     text: 'text-blue-600',     border: 'border-blue-200',     ring: 'ring-blue-200' },
            emerald: { bg: 'bg-emerald-50',  text: 'text-emerald-600',  border: 'border-emerald-200',  ring: 'ring-emerald-200' },
            amber:   { bg: 'bg-amber-50',    text: 'text-amber-600',    border: 'border-amber-200',    ring: 'ring-amber-200' },
            violet:  { bg: 'bg-violet-50',   text: 'text-violet-600',   border: 'border-violet-200',   ring: 'ring-violet-200' },
            rose:    { bg: 'bg-rose-50',     text: 'text-rose-600',     border: 'border-rose-200',     ring: 'ring-rose-200' },
            teal:    { bg: 'bg-teal-50',     text: 'text-teal-600',     border: 'border-teal-200',     ring: 'ring-teal-200' },
          };

          const docPill = (id, lbl, count) => (
            <button
              type="button"
              onClick={() => setLeaseStageFilter(id)}
              className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[10px] font-black uppercase tracking-widest transition-all ${
                docFilter === id
                  ? 'bg-gray-900 text-white border-gray-900 shadow-[0_4px_12px_rgba(0,0,0,0.18)]'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300 hover:text-gray-700'
              }`}
            >
              {lbl}
              <span className={`text-[9px] px-1.5 py-px rounded-full tabular-nums ${docFilter === id ? 'bg-white/15' : 'bg-gray-100'}`}>{count}</span>
            </button>
          );

          return (
            <div className="w-full animate-in fade-in zoom-in-95 duration-500">
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 lg:gap-6 items-start">

                {/* ─── LEFT RAIL — dark hero (always visible) ─── */}
                <aside className="xl:col-span-4 w-full flex flex-col gap-4 xl:sticky xl:top-4 xl:self-start">

                  <div className="relative overflow-hidden rounded-[1.75rem] p-5 sm:p-6 text-white shadow-[0_20px_45px_rgba(15,23,42,0.35)]"
                       style={{background: 'linear-gradient(135deg,#0f172a 0%,#1e3a8a 60%,#312e81 100%)'}}>
                    <div className="absolute -top-12 -right-12 w-44 h-44 rounded-full bg-blue-500/30 blur-3xl pointer-events-none" />
                    <div className="absolute -bottom-12 -left-12 w-44 h-44 rounded-full bg-cyan-400/20 blur-3xl pointer-events-none" />

                    <div className="relative z-10 flex items-start justify-between gap-3 mb-5">
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-[0.18em] text-blue-200">
                          {language === 'বাংলা' ? 'ভল্ট' : 'Vault'}
                        </p>
                        <h3 className="text-xl sm:text-2xl font-black tracking-tight mt-1">
                          {language === 'বাংলা' ? 'ডকুমেন্ট ভল্ট' : 'Document Vault'}
                        </h3>
                        <p className="text-[10px] font-bold text-blue-200/80 mt-1">
                          {language === 'বাংলা' ? 'সব ভাড়ার ডকুমেন্ট এক সুরক্ষিত জায়গায়' : 'Everything in one secure place'}
                        </p>
                      </div>
                      <button
                        onClick={() => openModal('upload_document')}
                        className="shrink-0 inline-flex items-center gap-1.5 bg-white text-gray-900 px-3 py-2 rounded-full text-[10px] font-black uppercase tracking-widest shadow-sm hover:shadow-md transition-all active:scale-95"
                      >
                        <Upload size={12}/> {language === 'বাংলা' ? 'আপলোড' : 'Upload'}
                      </button>
                    </div>

                    <div className="relative z-10 grid grid-cols-2 gap-2.5">
                      <div className="bg-white/10 backdrop-blur rounded-2xl p-3 border border-white/10">
                        <p className="text-[8px] font-black uppercase tracking-[0.16em] text-blue-200 mb-1">
                          {language === 'বাংলা' ? 'মোট ফাইল' : 'Total Files'}
                        </p>
                        <p className="text-[15px] sm:text-base font-black tabular-nums leading-tight">{totalDocs}</p>
                        <p className="text-[9px] font-bold text-blue-200 mt-1">
                          {language === 'বাংলা' ? `${folders.length} ফোল্ডার` : `${folders.length} folders`}
                        </p>
                      </div>
                      <div className="bg-white/10 backdrop-blur rounded-2xl p-3 border border-white/10">
                        <p className="text-[8px] font-black uppercase tracking-[0.16em] text-blue-200 mb-1">
                          {language === 'বাংলা' ? 'এগ্রিমেন্ট' : 'Agreements'}
                        </p>
                        <p className="text-[15px] sm:text-base font-black tabular-nums leading-tight">{leaseAgreements.length}</p>
                        <p className="text-[9px] font-bold text-blue-200 mt-1">
                          {language === 'বাংলা' ? 'স্বাক্ষরিত' : 'signed'}
                        </p>
                      </div>
                      <div className="bg-white/10 backdrop-blur rounded-2xl p-3 border border-white/10">
                        <p className="text-[8px] font-black uppercase tracking-[0.16em] text-blue-200 mb-1">
                          {language === 'বাংলা' ? 'রিসিপ্ট' : 'Receipts'}
                        </p>
                        <p className="text-[15px] sm:text-base font-black tabular-nums leading-tight">{paymentReceipts}</p>
                        <p className="text-[9px] font-bold text-blue-200 mt-1">
                          {language === 'বাংলা' ? 'পেমেন্ট' : 'payments'}
                        </p>
                      </div>
                      <div className="bg-white/10 backdrop-blur rounded-2xl p-3 border border-white/10">
                        <p className="text-[8px] font-black uppercase tracking-[0.16em] text-blue-200 mb-1">
                          {language === 'বাংলা' ? 'প্রপার্টি' : 'Properties'}
                        </p>
                        <p className="text-[15px] sm:text-base font-black tabular-nums leading-tight">{properties.length}</p>
                        <p className="text-[9px] font-bold text-blue-200 mt-1">
                          {language === 'বাংলা' ? 'মালিকানা' : 'on file'}
                        </p>
                      </div>
                    </div>

                    {/* Quick verification card */}
                    <div className="relative z-10 mt-4 pt-4 border-t border-white/10">
                      <p className="text-[8px] font-black uppercase tracking-[0.16em] text-blue-200 mb-2">
                        {language === 'বাংলা' ? 'আপনার ভেরিফিকেশন' : 'Your Verification'}
                      </p>
                      <div className="flex items-center gap-1.5 text-[9px] font-black tabular-nums">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border ${uploadedDocs.nidFront ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/30' : 'bg-white/5 text-gray-400 border-white/15'}`}>
                          {uploadedDocs.nidFront ? <CheckCircle size={9}/> : <X size={9}/>} NID-F
                        </span>
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border ${uploadedDocs.nidBack ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/30' : 'bg-white/5 text-gray-400 border-white/15'}`}>
                          {uploadedDocs.nidBack ? <CheckCircle size={9}/> : <X size={9}/>} NID-B
                        </span>
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border ${uploadedDocs.selfie ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/30' : 'bg-white/5 text-gray-400 border-white/15'}`}>
                          {uploadedDocs.selfie ? <CheckCircle size={9}/> : <X size={9}/>} {language === 'বাংলা' ? 'সেলফি' : 'Selfie'}
                        </span>
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border ${uploadedDocs.utilityBill ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/30' : 'bg-white/5 text-gray-400 border-white/15'}`}>
                          {uploadedDocs.utilityBill ? <CheckCircle size={9}/> : <X size={9}/>} {language === 'বাংলা' ? 'বিল' : 'Bill'}
                        </span>
                      </div>
                    </div>
                  </div>
                </aside>

                {/* ─── RIGHT PANE — sticky toolbar + folder grid OR file list ─── */}
                <main className="xl:col-span-8 w-full flex flex-col xl:h-[calc(100vh-160px)] xl:overflow-y-auto xl:pr-2 custom-scrollbar bg-white rounded-[1.75rem] shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-gray-100">

                  {/* Sticky toolbar inside scroll container */}
                  <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-gray-100 px-3 sm:px-4 py-2.5 rounded-t-[1.75rem]">
                    <div className="flex flex-wrap items-center gap-2">
                      {activeFolder ? (
                        <button
                          type="button"
                          onClick={() => setActiveFolder(null)}
                          className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-gray-900 hover:bg-gray-800 text-white text-[10px] font-black uppercase tracking-widest transition-colors active:scale-95"
                        >
                          <ArrowLeft size={11}/>{language === 'বাংলা' ? 'ফোল্ডার' : 'Folders'}
                        </button>
                      ) : (
                        <span className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-[10px] font-black uppercase tracking-widest shadow-sm">
                          <Folder size={11}/>{language === 'বাংলা' ? 'ভল্ট' : 'Vault'}
                        </span>
                      )}

                      {activeFolder && (
                        <span className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-black text-gray-900">
                          <activeFolder.icon size={12} className={tintMap[activeFolder.tint]?.text || 'text-gray-500'}/>
                          {language === 'বাংলা' ? activeFolder.bn : activeFolder.en}
                        </span>
                      )}

                      <div className="flex-1 min-w-[120px] relative">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"/>
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder={activeFolder ? (language === 'বাংলা' ? 'ফাইল খুঁজুন...' : 'Search files...') : (language === 'বাংলা' ? 'ফোল্ডার খুঁজুন...' : 'Search folders...')}
                          className="w-full pl-7 pr-2.5 py-1.5 rounded-full bg-gray-50 border border-gray-200 text-[11px] font-bold text-gray-700 placeholder:text-gray-400 focus:outline-none focus:bg-white focus:border-blue-300 transition-colors"
                        />
                      </div>

                      <span className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 text-gray-600 text-[10px] font-black tabular-nums">
                        {activeFolder ? fileList.length : visibleFolders.length}<span className="text-gray-400">/{activeFolder ? buildFileList(activeFolder).length : folders.length}</span>
                      </span>

                      <button
                        type="button"
                        onClick={() => openModal('upload_document')}
                        className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-[#ba0036] hover:bg-[#90002a] text-white text-[10px] font-black uppercase tracking-widest shadow-sm transition-colors active:scale-95"
                      >
                        <Upload size={11}/>{language === 'বাংলা' ? 'আপলোড' : 'Upload'}
                      </button>
                    </div>

                    {!activeFolder && (
                      <div className="flex items-center gap-1.5 mt-2 overflow-x-auto -mx-1 px-1 pb-0.5 no-scrollbar">
                        {docPill('all',    language === 'বাংলা' ? 'সব'           : 'All',          folders.length)}
                        {docPill('active', language === 'বাংলা' ? 'এগ্রিমেন্ট'   : 'Agreements',   1)}
                        {docPill('draft',  language === 'বাংলা' ? 'আইডি'         : 'IDs',          1)}
                        {docPill('notice', language === 'বাংলা' ? 'পেমেন্ট'      : 'Payments',     1)}
                        {docPill('done',   language === 'বাংলা' ? 'লিগ্যাল'      : 'Legal',        2)}
                      </div>
                    )}
                  </div>

                  {/* Body: folder grid OR file list */}
                  <div className="flex-1 px-3 sm:px-4 py-3">
                    {!activeFolder ? (
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 sm:gap-3">
                        {visibleFolders.length === 0 ? (
                          <div className="col-span-full text-center py-12">
                            <div className="w-14 h-14 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-3">
                              <Folder className="text-gray-300" size={22}/>
                            </div>
                            <h3 className="text-sm font-black text-gray-900">
                              {language === 'বাংলা' ? 'কোনো ফোল্ডার নেই' : 'No folders match'}
                            </h3>
                          </div>
                        ) : (
                          visibleFolders.map((folder) => {
                            const tint = tintMap[folder.tint];
                            return (
                              <button
                                key={folder.id}
                                type="button"
                                onClick={() => setActiveFolder(folder)}
                                className="group relative rounded-2xl border border-gray-100 hover:border-gray-200 bg-white hover:shadow-[0_8px_24px_rgba(15,23,42,0.06)] transition-all overflow-hidden text-left p-3 sm:p-4 active:scale-[0.98]"
                              >
                                <div className={`absolute top-0 right-0 w-20 h-20 rounded-bl-full opacity-50 group-hover:opacity-80 transition-opacity ${tint.bg}`}/>

                                <div className={`relative z-10 w-10 h-10 rounded-xl bg-gradient-to-br ${folder.grad} flex items-center justify-center text-white shadow-[0_8px_20px_rgba(15,23,42,0.12)] mb-2.5`}>
                                  <folder.icon size={18} strokeWidth={2.5}/>
                                </div>

                                <p className="relative z-10 text-[11px] sm:text-[12px] font-black text-gray-900 mb-0.5 leading-tight">
                                  {language === 'বাংলা' ? folder.bn : folder.en}
                                </p>
                                <p className="relative z-10 text-[9px] font-bold text-gray-400 tabular-nums mb-0.5">
                                  {folder.count} {language === 'বাংলা' ? 'ফাইল' : 'files'}
                                </p>
                                <p className="relative z-10 text-[9px] font-medium text-gray-400 truncate">
                                  {folder.desc}
                                </p>

                                <div className="relative z-10 mt-2.5 flex items-center justify-between">
                                  <span className={`inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-widest ${tint.text}`}>
                                    <span className={`w-1 h-1 rounded-full ${tint.text.replace('text-', 'bg-')}`}/>
                                    {language === 'বাংলা' ? 'দেখুন' : 'Open'}
                                  </span>
                                  <ChevronRight size={12} className="text-gray-300 group-hover:text-gray-500 group-hover:translate-x-0.5 transition-all"/>
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {fileList.length === 0 ? (
                          <div className="text-center py-12">
                            <div className="w-14 h-14 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-3">
                              <File className="text-gray-300" size={22}/>
                            </div>
                            <h3 className="text-sm font-black text-gray-900">
                              {language === 'বাংলা' ? 'এই ফোল্ডারে কোনো ফাইল নেই' : 'No files in this folder yet'}
                            </h3>
                            <p className="text-[10px] font-bold text-gray-400 mt-1 max-w-xs mx-auto">
                              {language === 'বাংলা' ? 'বুকিং বা পেমেন্ট তৈরি করলে এখানে আসবে।' : 'Create a booking or record a payment and files will appear here.'}
                            </p>
                          </div>
                        ) : (
                          fileList.map((file) => {
                            const tint = tintMap[activeFolder.tint];
                            return (
                              <div
                                key={file.id}
                                className="group flex items-center gap-2.5 sm:gap-3 px-3 sm:px-3.5 py-2.5 rounded-xl border border-gray-100 hover:border-gray-200 hover:bg-gray-50/60 transition-all"
                              >
                                <div className={`shrink-0 w-9 h-9 rounded-xl ${tint.bg} ${tint.text} flex items-center justify-center`}>
                                  <File size={16}/>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-[12px] font-black text-gray-900 truncate group-hover:text-[#ba0036] cursor-pointer transition-colors" onClick={() => showToast(language === 'বাংলা' ? 'প্রিভিউ খোলা হচ্ছে...' : 'Opening preview...')}>
                                    {file.name}
                                  </p>
                                  <p className="text-[9px] font-bold text-gray-400 mt-0.5 truncate">{file.meta}</p>
                                </div>
                                <div className="hidden sm:block shrink-0 text-[9px] font-bold text-gray-400 tabular-nums text-right min-w-[64px]">
                                  {formatDate(file.date)}
                                </div>
                                <div className="shrink-0 flex items-center gap-0.5">
                                  <button onClick={() => showToast(language === 'বাংলা' ? 'প্রিভিউ খোলা হচ্ছে...' : 'Opening preview...')} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors active:scale-95" title="Preview"><Eye size={14}/></button>
                                  <button onClick={() => showToast(language === 'বাংলা' ? 'ডাউনলোড হচ্ছে...' : 'Downloading...')} className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors active:scale-95" title="Download"><Download size={14}/></button>
                                  <button onClick={() => showToast(language === 'বাংলা' ? 'ট্র্যাশে সরানো হলো' : 'Moved to trash')} className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors active:scale-95" title="Delete"><Trash2 size={14}/></button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>

                </main>
              </div>
            </div>
          );
        })()}

        {/* 🔴 NEW: ANALYTICS OVERVIEW TAB */}
        {/* 🔴 ANALYTICS OVERVIEW — futuristic, ledger-driven */}
        {activeTab === 'analytics' && (() => {
          // Local IIFE so we can declare derived analytics state and helpers
          // without leaking them into the outer component scope.
          const todayDate = today;
          const currentYear = todayDate.getFullYear();
          const ledgerScopeYear = ledgerYear; // share the Rent tab's selected year for a single source of truth
          const yearMonths = Array.from({length: 12}, (_, i) => `${ledgerScopeYear}-${String(i+1).padStart(2,'0')}`);

          // --- Real-data analytics rollup -----------------------------------------------------
          // Per-tenant scorecard: paid months / expected (in-lease) months for the selected year.
          const scorecards = bookings.map((b) => {
            const leaseMonths = enumerateLeaseMonths(b.leaseStart, b.leaseEnd);
            const inLeaseYearMonths = yearMonths.filter(k => leaseMonths.includes(k));
            // Up to current month for the current year, full year for past years.
            const cutoffIdx = ledgerScopeYear === currentYear ? todayDate.getMonth() : 11;
            const dueSoFar = inLeaseYearMonths.filter(k => {
              const [, mm] = k.split('-').map(Number);
              return (mm - 1) <= cutoffIdx;
            });
            const paidSoFar = dueSoFar.filter(k => b.ledger?.[k]?.paid).length;
            const partialSoFar = dueSoFar.filter(k => {
              const e = b.ledger?.[k];
              return e?.paid && Number(e?.amount || 0) > 0 && Number(e?.amount || 0) < Number(b.monthlyRent || 0);
            }).length;
            const overdueSoFar = dueSoFar.filter(k => {
              const e = b.ledger?.[k];
              if (e?.paid) return false;
              // Bug-fix: getDueDate signature is (monthKey, dueDay) — the old call
              // passed the booking as the first arg, which made parseMonthKey
              // crash with `.split is not a function` and blanked the whole tab.
              const due = getDueDate(k, b.rentDueDay);
              return due && todayDate > due;
            }).length;
            const score = dueSoFar.length ? Math.round((paidSoFar / dueSoFar.length) * 100) : 100;
            const ytdCollected = dueSoFar.reduce((sum, k) => {
              const e = b.ledger?.[k];
              return sum + (e?.paid ? Number(e?.amount || 0) : 0);
            }, 0);
            const ytdExpected = dueSoFar.length * Number(b.monthlyRent || 0);
            return {
              booking: b,
              score,
              paidSoFar,
              partialSoFar,
              overdueSoFar,
              dueSoFar: dueSoFar.length,
              ytdCollected,
              ytdExpected,
              bucket: score >= 90 ? 'excellent' : score >= 75 ? 'good' : score >= 50 ? 'risk' : 'critical',
            };
          });

          // Aggregate KPIs (real numbers, not placeholders)
          const totalRevenueYTD = scorecards.reduce((s, c) => s + c.ytdCollected, 0);
          const totalExpectedYTD = scorecards.reduce((s, c) => s + c.ytdExpected, 0);
          const collectionRate = totalExpectedYTD > 0
            ? Math.round((totalRevenueYTD / totalExpectedYTD) * 100)
            : 0;
          const activeLeases = bookings.filter(b => computeLeaseStage(b, todayDate) === 'active').length;
          const noticeLeases = bookings.filter(b => computeLeaseStage(b, todayDate) === 'notice').length;
          const draftLeases  = bookings.filter(b => computeLeaseStage(b, todayDate) === 'draft').length;
          const doneLeases   = bookings.filter(b => computeLeaseStage(b, todayDate) === 'done').length;
          const totalProperties = properties.length;
          const occupancyRate = totalProperties > 0
            ? Math.round(((activeLeases + noticeLeases) / totalProperties) * 100)
            : 0;
          const totalMonthlyRevenue = bookings
            .filter(b => ['active','notice'].includes(computeLeaseStage(b, todayDate)))
            .reduce((s, b) => s + Number(b.monthlyRent || 0), 0);
          const avgRentPerProperty = totalProperties > 0
            ? Math.round(totalMonthlyRevenue / totalProperties)
            : 0;

          // Monthly bar chart series — real ledger sum per month
          const monthly = yearMonths.map((k, i) => {
            const collected = bookings.reduce((sum, b) => {
              const e = b.ledger?.[k];
              return sum + (e?.paid ? Number(e?.amount || 0) : 0);
            }, 0);
            const expected = bookings.reduce((sum, b) => {
              const leaseMonths = enumerateLeaseMonths(b.leaseStart, b.leaseEnd);
              return sum + (leaseMonths.includes(k) ? Number(b.monthlyRent || 0) : 0);
            }, 0);
            return { key: k, monthIdx: i, collected, expected };
          });
          const peakRevenue = Math.max(1, ...monthly.map(m => m.collected || m.expected));

          // Filter & search for tenant scorecard list
          const analyticsFilter = rentPriorityFilter; // reuse the Rent tab pill filter so navigation feels continuous
          const filteredCards = scorecards
            .filter(c => {
              if (analyticsFilter === 'all') return true;
              if (analyticsFilter === 'overdue') return c.overdueSoFar > 0;
              if (analyticsFilter === 'partial') return c.partialSoFar > 0 && c.overdueSoFar === 0;
              if (analyticsFilter === 'upcoming') return c.bucket === 'good';
              if (analyticsFilter === 'cleared')  return c.bucket === 'excellent';
              return true;
            })
            .filter(c => {
              if (!searchQuery.trim()) return true;
              const q = searchQuery.toLowerCase();
              return c.booking.tenant?.toLowerCase().includes(q)
                  || c.booking.property?.toLowerCase().includes(q)
                  || c.booking.tenantPhone?.toLowerCase().includes(q);
            })
            .sort((a, b) => b.score - a.score);

          const bucketBadge = {
            excellent: { dot: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50', label: language === 'বাংলা' ? 'অসাধারণ' : 'Excellent', ring: 'ring-emerald-200' },
            good:      { dot: 'bg-blue-500',    text: 'text-blue-700',    bg: 'bg-blue-50',    label: language === 'বাংলা' ? 'ভালো'      : 'Good',      ring: 'ring-blue-200' },
            risk:      { dot: 'bg-amber-500',   text: 'text-amber-700',   bg: 'bg-amber-50',   label: language === 'বাংলা' ? 'ঝুঁকিতে'   : 'Risk',      ring: 'ring-amber-200' },
            critical:  { dot: 'bg-rose-500',    text: 'text-rose-700',    bg: 'bg-rose-50',    label: language === 'বাংলা' ? 'সঙ্কটাপন্ন' : 'Critical',  ring: 'ring-rose-200' },
          };

          const pill = (id, lbl, count) => (
            <button
              type="button"
              onClick={() => setRentPriorityFilter(id)}
              className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[10px] font-black uppercase tracking-widest transition-all ${
                analyticsFilter === id
                  ? 'bg-gray-900 text-white border-gray-900 shadow-[0_4px_12px_rgba(0,0,0,0.18)]'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300 hover:text-gray-700'
              }`}
            >
              {lbl}
              <span className={`text-[9px] px-1.5 py-px rounded-full tabular-nums ${analyticsFilter === id ? 'bg-white/15' : 'bg-gray-100'}`}>{count}</span>
            </button>
          );

          return (
            <div className="w-full animate-in fade-in zoom-in-95 duration-500">
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 lg:gap-6 items-start">

                {/* ─── LEFT RAIL — dark hero card (always visible, mobile + desktop) ─── */}
                <aside className="xl:col-span-4 w-full flex flex-col gap-4 xl:sticky xl:top-4 xl:self-start">

                  <div className="relative overflow-hidden rounded-[1.75rem] p-5 sm:p-6 text-white shadow-[0_20px_45px_rgba(15,23,42,0.35)]"
                       style={{background: 'linear-gradient(135deg,#0f172a 0%,#1e1b4b 60%,#312e81 100%)'}}>
                    <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-indigo-500/30 blur-3xl pointer-events-none" />
                    <div className="absolute -bottom-10 -left-10 w-40 h-40 rounded-full bg-pink-500/20 blur-3xl pointer-events-none" />

                    <div className="relative z-10 flex items-start justify-between gap-3 mb-5">
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-[0.18em] text-indigo-200">
                          {language === 'বাংলা' ? 'অ্যানালিটিক্স' : 'Analytics'}
                        </p>
                        <h3 className="text-xl sm:text-2xl font-black tracking-tight mt-1">
                          {language === 'বাংলা' ? 'পোর্টফোলিও পারফরম্যান্স' : 'Portfolio Performance'}
                        </h3>
                      </div>
                      <div className="shrink-0 inline-flex items-center gap-1 bg-white/10 backdrop-blur rounded-full p-1 border border-white/15">
                        <button
                          type="button"
                          onClick={() => setLedgerYear(y => y - 1)}
                          className="w-7 h-7 rounded-full hover:bg-white/15 flex items-center justify-center transition-colors"
                          aria-label="Previous year"
                        >
                          <ChevronLeft size={14}/>
                        </button>
                        <span className="text-[11px] font-black tabular-nums px-2 min-w-[44px] text-center">{ledgerScopeYear}</span>
                        <button
                          type="button"
                          onClick={() => setLedgerYear(y => y + 1)}
                          className="w-7 h-7 rounded-full hover:bg-white/15 flex items-center justify-center transition-colors"
                          aria-label="Next year"
                        >
                          <ChevronRight size={14}/>
                        </button>
                      </div>
                    </div>

                    {/* KPI grid — 2×2 on mobile, 2×2 on desktop too (keeps the rail vertical) */}
                    <div className="relative z-10 grid grid-cols-2 gap-2.5">
                      <div className="bg-white/10 backdrop-blur rounded-2xl p-3 border border-white/10">
                        <p className="text-[8px] font-black uppercase tracking-[0.16em] text-indigo-200 mb-1">
                          {language === 'বাংলা' ? 'YTD আয়' : 'YTD Revenue'}
                        </p>
                        <p className="text-[15px] sm:text-base font-black tabular-nums leading-tight">{formatBDT(totalRevenueYTD)}</p>
                        <p className="text-[9px] font-bold text-emerald-300 mt-1 flex items-center gap-1">
                          <TrendingUp size={10}/> {language === 'বাংলা' ? `${collectionRate}% সংগৃহীত` : `${collectionRate}% collected`}
                        </p>
                      </div>
                      <div className="bg-white/10 backdrop-blur rounded-2xl p-3 border border-white/10">
                        <p className="text-[8px] font-black uppercase tracking-[0.16em] text-indigo-200 mb-1">
                          {language === 'বাংলা' ? 'মাসিক রাজস্ব' : 'Monthly Revenue'}
                        </p>
                        <p className="text-[15px] sm:text-base font-black tabular-nums leading-tight">{formatBDT(totalMonthlyRevenue)}</p>
                        <p className="text-[9px] font-bold text-indigo-200 mt-1">
                          {language === 'বাংলা' ? `${activeLeases + noticeLeases} সক্রিয় লিজ` : `${activeLeases + noticeLeases} active leases`}
                        </p>
                      </div>
                      <div className="bg-white/10 backdrop-blur rounded-2xl p-3 border border-white/10">
                        <p className="text-[8px] font-black uppercase tracking-[0.16em] text-indigo-200 mb-1">
                          {language === 'বাংলা' ? 'অকুপেন্সি' : 'Occupancy'}
                        </p>
                        <p className="text-[15px] sm:text-base font-black tabular-nums leading-tight">{occupancyRate}%</p>
                        <p className="text-[9px] font-bold text-indigo-200 mt-1 tabular-nums">
                          {activeLeases + noticeLeases}/{totalProperties} {language === 'বাংলা' ? 'প্রপার্টি' : 'units'}
                        </p>
                      </div>
                      <div className="bg-white/10 backdrop-blur rounded-2xl p-3 border border-white/10">
                        <p className="text-[8px] font-black uppercase tracking-[0.16em] text-indigo-200 mb-1">
                          {language === 'বাংলা' ? 'গড় ভাড়া' : 'Avg Rent'}
                        </p>
                        <p className="text-[15px] sm:text-base font-black tabular-nums leading-tight">{formatBDT(avgRentPerProperty)}</p>
                        <p className="text-[9px] font-bold text-indigo-200 mt-1">
                          {language === 'বাংলা' ? 'প্রতি প্রপার্টি' : 'per property'}
                        </p>
                      </div>
                    </div>

                    {/* Stage distribution mini-row */}
                    <div className="relative z-10 mt-4 pt-4 border-t border-white/10">
                      <p className="text-[8px] font-black uppercase tracking-[0.16em] text-indigo-200 mb-2">
                        {language === 'বাংলা' ? 'লিজ স্টেজ' : 'Lease Stages'}
                      </p>
                      <div className="flex items-center gap-1.5 text-[10px] font-black tabular-nums">
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-200 border border-emerald-400/30">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"/>{activeLeases}
                        </span>
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-500/20 text-amber-200 border border-amber-400/30">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400"/>{noticeLeases}
                        </span>
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blue-500/20 text-blue-200 border border-blue-400/30">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-400"/>{draftLeases}
                        </span>
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white/10 text-gray-300 border border-white/15">
                          <span className="w-1.5 h-1.5 rounded-full bg-gray-400"/>{doneLeases}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Monthly revenue chart — real ledger data */}
                  <div className="bg-white rounded-[1.75rem] p-4 sm:p-5 shadow-[0_4px_20px_rgba(0,0,0,0.04)] border border-gray-100">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-[12px] font-black text-gray-900 tracking-tight">
                        {language === 'বাংলা' ? `মাসিক আয় - ${ledgerScopeYear}` : `Monthly Revenue · ${ledgerScopeYear}`}
                      </h4>
                      <span className="text-[8px] font-black uppercase tracking-[0.16em] text-gray-400">
                        {language === 'বাংলা' ? 'প্রকৃত' : 'Actual'}
                      </span>
                    </div>

                    <div className="h-40 flex items-end justify-between gap-1 relative">
                      <div className="absolute inset-0 flex flex-col justify-between pb-0 pt-0 z-0 pointer-events-none">
                        <div className="w-full h-px bg-gray-50"/>
                        <div className="w-full h-px bg-gray-50"/>
                        <div className="w-full h-px bg-gray-50"/>
                        <div className="w-full h-px bg-gray-50"/>
                      </div>
                      {monthly.map((m, i) => {
                        const isCurrent = m.key === `${currentYear}-${String(todayDate.getMonth()+1).padStart(2,'0')}`;
                        const h = m.collected > 0 ? Math.max(6, Math.round((m.collected / peakRevenue) * 100)) : 4;
                        const expectedH = m.expected > 0 ? Math.max(6, Math.round((m.expected / peakRevenue) * 100)) : 4;
                        return (
                          <div key={m.key} className="flex flex-col items-center gap-1 flex-1 relative z-10 group cursor-default">
                            <span className="text-[8px] font-black tabular-nums text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity absolute -top-4 whitespace-nowrap">{formatBDT(m.collected)}</span>
                            <div className="w-full max-w-[18px] relative" style={{height: '100%'}}>
                              <div className="absolute bottom-0 inset-x-0 rounded-t-md bg-gray-100" style={{height: `${expectedH}%`}}/>
                              <div className={`absolute bottom-0 inset-x-0 rounded-t-md transition-all duration-700 ${isCurrent ? 'bg-gradient-to-t from-[#ba0036] to-[#ff4d7a]' : 'bg-gradient-to-t from-indigo-500 to-violet-400'}`} style={{height: `${h}%`}}/>
                            </div>
                            <span className={`text-[8px] font-black tracking-widest uppercase ${isCurrent ? 'text-[#ba0036]' : 'text-gray-400'}`}>{monthShortLabel(m.key)}</span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex items-center justify-between text-[8px] font-black uppercase tracking-[0.16em] text-gray-400 mt-3 pt-3 border-t border-gray-100">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-sm bg-gradient-to-t from-indigo-500 to-violet-400"/>{language === 'বাংলা' ? 'সংগৃহীত' : 'Collected'}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-sm bg-gray-200"/>{language === 'বাংলা' ? 'প্রত্যাশিত' : 'Expected'}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-sm bg-gradient-to-t from-[#ba0036] to-[#ff4d7a]"/>{language === 'বাংলা' ? 'এই মাস' : 'Now'}
                      </span>
                    </div>
                  </div>
                </aside>

                {/* ─── RIGHT PANE — tenant scorecards with sticky toolbar inside scroll container ─── */}
                <main className="xl:col-span-8 w-full flex flex-col xl:h-[calc(100vh-160px)] xl:overflow-y-auto xl:pr-2 custom-scrollbar bg-white rounded-[1.75rem] shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-gray-100">

                  {/* Sticky toolbar: title chip in corner + search + pills, all in ONE line */}
                  <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-gray-100 px-3 sm:px-4 py-2.5 rounded-t-[1.75rem]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-[10px] font-black uppercase tracking-widest shadow-sm">
                        <BarChart3 size={11}/>{language === 'বাংলা' ? 'অ্যানালিটিক্স' : 'Analytics'}
                      </span>
                      <div className="flex-1 min-w-[140px] relative">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"/>
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder={language === 'বাংলা' ? 'ভাড়াটিয়া খুঁজুন...' : 'Search tenants...'}
                          className="w-full pl-7 pr-2.5 py-1.5 rounded-full bg-gray-50 border border-gray-200 text-[11px] font-bold text-gray-700 placeholder:text-gray-400 focus:outline-none focus:bg-white focus:border-indigo-300 transition-colors"
                        />
                      </div>
                      <span className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 text-gray-600 text-[10px] font-black tabular-nums">
                        {filteredCards.length}<span className="text-gray-400">/{scorecards.length}</span>
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 mt-2 overflow-x-auto -mx-1 px-1 pb-0.5 no-scrollbar">
                      {pill('all',      language === 'বাংলা' ? 'সব'        : 'All',       scorecards.length)}
                      {pill('cleared',  language === 'বাংলা' ? 'অসাধারণ'   : 'Excellent', scorecards.filter(c => c.bucket === 'excellent').length)}
                      {pill('upcoming', language === 'বাংলা' ? 'ভালো'      : 'Good',      scorecards.filter(c => c.bucket === 'good').length)}
                      {pill('partial',  language === 'বাংলা' ? 'আংশিক'     : 'Partial',   scorecards.filter(c => c.partialSoFar > 0 && c.overdueSoFar === 0).length)}
                      {pill('overdue',  language === 'বাংলা' ? 'বকেয়া'    : 'Overdue',   scorecards.filter(c => c.overdueSoFar > 0).length)}
                    </div>
                  </div>

                  {/* Tenant scorecard list — compact rows, futuristic */}
                  <div className="flex-1 px-3 sm:px-4 py-3 space-y-2">
                    {filteredCards.length === 0 ? (
                      <div className="text-center py-12">
                        <div className="w-14 h-14 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-3">
                          <BarChart3 className="text-gray-300" size={22}/>
                        </div>
                        <h3 className="text-sm font-black text-gray-900">
                          {language === 'বাংলা' ? 'কোনো ডেটা নেই' : 'No tenant data yet'}
                        </h3>
                        <p className="text-[10px] font-bold text-gray-400 mt-1 max-w-xs mx-auto">
                          {language === 'বাংলা' ? 'বুকিং তৈরি করলে এখানে স্কোরকার্ড আসবে।' : 'Create a booking and the scorecard will populate here.'}
                        </p>
                      </div>
                    ) : (
                      filteredCards.map((c) => {
                        const badge = bucketBadge[c.bucket];
                        const init = c.booking.tenantInit || c.booking.tenant?.slice(0, 2).toUpperCase() || '?';
                        const collectedPct = c.ytdExpected > 0 ? Math.round((c.ytdCollected / c.ytdExpected) * 100) : 0;
                        return (
                          <div
                            key={c.booking.id}
                            className="group relative rounded-2xl border border-gray-100 hover:border-gray-200 bg-white hover:shadow-[0_8px_24px_rgba(15,23,42,0.06)] transition-all overflow-hidden"
                          >
                            {/* coloured edge */}
                            <div className={`absolute left-0 top-0 bottom-0 w-1 ${badge.dot}`}/>

                            <div className="flex items-center gap-2.5 sm:gap-3 px-3 sm:px-4 py-3">
                              {/* Avatar */}
                              <div className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-white text-[10px] font-black bg-gradient-to-br ${
                                c.bucket === 'excellent' ? 'from-emerald-500 to-green-600' :
                                c.bucket === 'good'      ? 'from-blue-500 to-indigo-600'   :
                                c.bucket === 'risk'      ? 'from-amber-500 to-orange-500'  :
                                                            'from-rose-500 to-red-600'
                              }`}>
                                {init}
                              </div>

                              {/* Main column */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                  <p className="text-[12px] font-black text-gray-900 truncate">{c.booking.tenant}</p>
                                  <span className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full ${badge.bg} ${badge.text} text-[8px] font-black uppercase tracking-widest`}>
                                    <span className={`w-1 h-1 rounded-full ${badge.dot}`}/>{badge.label}
                                  </span>
                                </div>
                                <p className="text-[10px] font-bold text-gray-500 truncate">{c.booking.property}</p>

                                {/* Inline progress bar (collected pct of YTD expected) */}
                                <div className="mt-1.5 flex items-center gap-2">
                                  <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                                    <div className={`h-full rounded-full transition-all duration-700 ${
                                      c.bucket === 'excellent' ? 'bg-gradient-to-r from-emerald-400 to-green-500' :
                                      c.bucket === 'good'      ? 'bg-gradient-to-r from-blue-400 to-indigo-500'   :
                                      c.bucket === 'risk'      ? 'bg-gradient-to-r from-amber-400 to-orange-500'  :
                                                                  'bg-gradient-to-r from-rose-400 to-red-500'
                                    }`} style={{width: `${Math.max(2, collectedPct)}%`}}/>
                                  </div>
                                  <span className={`shrink-0 text-[10px] font-black tabular-nums ${badge.text}`}>{c.score}%</span>
                                </div>
                              </div>

                              {/* Stats column */}
                              <div className="hidden sm:flex shrink-0 flex-col items-end gap-0.5 text-right">
                                <p className="text-[8px] font-black uppercase tracking-[0.14em] text-gray-400">
                                  {language === 'বাংলা' ? `YTD সংগ্রহ` : `YTD Collected`}
                                </p>
                                <p className="text-[12px] font-black text-gray-900 tabular-nums">{formatBDT(c.ytdCollected)}</p>
                                <p className="text-[9px] font-bold text-gray-400 tabular-nums">
                                  {c.paidSoFar}/{c.dueSoFar} {language === 'বাংলা' ? 'মাস' : 'months'}
                                  {c.overdueSoFar > 0 && <span className="ml-1 text-rose-500">• {c.overdueSoFar} {language === 'বাংলা' ? 'বকেয়া' : 'overdue'}</span>}
                                </p>
                              </div>

                              {/* Action */}
                              <button
                                type="button"
                                onClick={() => openChatPanel(c.booking.chatId || `chat-${c.booking.id}`, {
                                  source: 'host-analytics',
                                  bookingId: c.booking.id,
                                  tenantName: c.booking.tenant,
                                  tenantPhone: c.booking.tenantPhone,
                                  propertyTitle: c.booking.property,
                                  prefillMessage: c.overdueSoFar > 0
                                    ? (language === 'বাংলা' ? `হাই ${c.booking.tenant}, ${c.overdueSoFar} মাসের ভাড়া বকেয়া আছে। দয়া করে পরিশোধের তারিখ জানান।` : `Hi ${c.booking.tenant}, you have ${c.overdueSoFar} overdue month${c.overdueSoFar > 1 ? 's' : ''}. Could you confirm your next payment date?`)
                                    : '',
                                })}
                                className="shrink-0 p-2 rounded-xl bg-gray-50 hover:bg-gray-900 text-gray-500 hover:text-white transition-colors active:scale-95"
                                title={language === 'বাংলা' ? 'মেসেজ' : 'Message tenant'}
                              >
                                <Send size={13}/>
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                </main>
              </div>
            </div>
          );
        })()}

        {/* 🔴 INQUIRIES TAB (Premium Independent Scroll Layout) */}
        {activeTab === 'inquiries' && (
          <div className="w-full animate-in fade-in zoom-in-95 duration-500">
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 lg:gap-10 items-start">
              
              <div className="xl:col-span-4 w-full flex flex-col gap-5">
                
                <div className="bg-gradient-to-br from-[#ba0036] to-[#ff004c] rounded-[2rem] p-8 text-white shadow-[0_15px_40px_rgba(186,0,54,0.2)] relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -translate-y-10 translate-x-10"></div>
                  <h3 className="text-2xl font-black mb-1 relative z-10">{language === 'বাংলা' ? 'আপনার পারফরম্যান্স' : 'Host Performance'}</h3>
                  <p className="text-white/80 text-[10px] font-bold uppercase tracking-widest mb-8 relative z-10">{language === 'বাংলা' ? 'সার্বিক পারফরম্যান্স' : 'Performance Overview'}</p>
                  
                  <div className="space-y-6 relative z-10">
                    <div>
                      <p className="text-white/70 text-[9px] font-black uppercase tracking-widest mb-1">{language === 'বাংলা' ? 'রেসপন্স রেট' : 'Response Rate'}</p>
                      <p className="text-3xl font-black">{hostStats.responseRate}%</p>
                    </div>
                    <div>
                      <p className="text-white/70 text-[9px] font-black uppercase tracking-widest mb-1">{language === 'বাংলা' ? 'গড় রেসপন্স টাইম' : 'Avg Response Time'}</p>
                      <p className="text-3xl font-black">{hostStats.avgResponseTime >= 60 ? `${Math.floor(hostStats.avgResponseTime / 60)}${language === 'বাংলা' ? 'ঘ ' : 'h '}${hostStats.avgResponseTime % 60}${language === 'বাংলা' ? 'মি' : 'm'}` : `${hostStats.avgResponseTime} ${language === 'বাংলা' ? 'মিনিট' : 'min'}`}</p>
                    </div>
                    <div>
                      <p className="text-white/70 text-[9px] font-black uppercase tracking-widest mb-1">{language === 'বাংলা' ? 'কনভার্সন রেট' : 'Conversion Rate'}</p>
                      <p className="text-3xl font-black">{hostStats.conversionRate}%</p>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-[2rem] p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)] border-none">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-green-50 rounded-2xl flex items-center justify-center text-green-600"><Smile size={24}/></div>
                    <div>
                      <h4 className="text-sm font-black text-gray-900">Great Job!</h4>
                      <p className="text-[10px] text-gray-500 font-bold mt-0.5">Your properties are trending.</p>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-[2rem] p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)] border-none">
                  <h4 className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-4">{language === 'বাংলা' ? 'ইনকোয়ারি সামারি' : 'Inquiry Summary'}</h4>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center text-sm font-bold text-gray-700">
                      <span>{language === 'বাংলা' ? 'আজকের নতুন' : 'Today\'s New'}</span>
                      <span className="bg-blue-50 text-blue-600 px-2.5 py-1 rounded-lg text-xs">2</span>
                    </div>
                    <div className="flex justify-between items-center text-sm font-bold text-gray-700">
                      <span>{language === 'বাংলা' ? 'আনরিড মেসেজ' : 'Unread'}</span>
                      <span className="bg-red-50 text-[#ba0036] px-2.5 py-1 rounded-lg text-xs">3</span>
                    </div>
                  </div>
                </div>

              </div>

              <div className="xl:col-span-8 w-full flex flex-col xl:h-[calc(100vh-160px)]">
                
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 shrink-0">
                   <div className="flex flex-col gap-2">
                     <h3 className="text-2xl md:text-3xl font-black text-gray-900 tracking-tight">
                       {t?.newInquiries || (language === 'বাংলা' ? 'যোগাযোগ সমূহ' : 'Inquiries')}
                     </h3>
                     <div className="flex gap-2">
                       <button onClick={() => setInquiryTab('pending')} className={`px-4 py-1.5 rounded-full text-xs font-black transition-all ${inquiryTab === 'pending' ? 'bg-[#ba0036] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>Pending</button>
                       <button onClick={() => setInquiryTab('accepted')} className={`px-4 py-1.5 rounded-full text-xs font-black transition-all ${inquiryTab === 'accepted' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>Accepted</button>
                       <button onClick={() => setInquiryTab('rejected')} className={`px-4 py-1.5 rounded-full text-xs font-black transition-all ${inquiryTab === 'rejected' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>Rejected</button>
                     </div>
                   </div>
                   <span className="bg-[#ba0036]/10 text-[#ba0036] px-5 py-2.5 rounded-full font-black text-[11px] tracking-wide border border-[#ba0036]/10">
                     {displayedInquiries.length} {inquiryTab === 'pending' ? 'Pending' : inquiryTab === 'accepted' ? 'Accepted' : 'Rejected'}
                   </span>
                </div>

                <div className="flex-1 xl:overflow-y-auto custom-scrollbar xl:pr-4 pb-10 space-y-6">
                  {displayedInquiries.length === 0 ? (
                     <div className="text-center py-24 bg-white rounded-[2rem] shadow-[0_4px_20px_rgba(0,0,0,0.02)] border-none">
                       <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-5">
                         <Search className="text-gray-300" size={32} />
                       </div>
                       <h3 className="text-lg font-black text-gray-900">{t?.noInquiriesFound || (language === 'বাংলা' ? 'কোনো যোগাযোগ পাওয়া যায়নি।' : 'No inquiries found.')}</h3>
                     </div>
                  ) : (
                    displayedInquiries.map((inquiry) => (
                      <div key={inquiry.id} className="bg-white rounded-[2rem] shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_15px_40px_rgba(0,0,0,0.06)] p-6 md:p-8 transition-all duration-500 border-none">
                        <div className="flex flex-col xl:flex-row gap-6 xl:gap-8 items-stretch">
                          
                          <div className="flex-1 w-full flex flex-col justify-between">
                            <div>
                              <div className="flex items-center justify-between mb-6">
                                <div className="flex items-center gap-4">
                                  <div className="w-12 h-12 md:w-14 md:h-14 bg-red-50 rounded-2xl flex items-center justify-center text-[#ba0036] font-black text-lg md:text-xl border-none shadow-sm">
                                    {inquiry.init}
                                  </div>
                                  <div>
                                    {/* Tenant name → public profile link.
                                        Roadmap-v2 §3 / tenant-roadmap §T3 —
                                        only when the inquiry was actually
                                        submitted by a signed-in user (so
                                        `inquirerUserId` is present). Guest
                                        inquiries stay as plain text. */}
                                    {inquiry.inquirerUserId ? (
                                      <Link
                                        to={`/tenant/${inquiry.inquirerUserId}`}
                                        className="text-lg md:text-xl font-black text-gray-900 hover:text-[#ba0036] transition-colors leading-tight mb-1 block"
                                      >
                                        {inquiry.user}
                                      </Link>
                                    ) : (
                                      <h4 className="text-lg md:text-xl font-black text-gray-900 leading-tight mb-1">{inquiry.user}</h4>
                                    )}
                                    <p className="text-[9px] md:text-[10px] font-bold text-gray-400 uppercase tracking-widest">{inquiry.timeAgo}</p>
                                  </div>
                                </div>
                                <span className="bg-blue-50 text-blue-600 px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border-none shadow-sm">
                                  {t?.new || (language === 'বাংলা' ? 'নতুন' : 'New')}
                                </span>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                                <div className="bg-gray-50/80 p-5 rounded-2xl border-none">
                                  <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5">{t?.phoneNumber || (language === 'বাংলা' ? 'ফোন নাম্বার' : 'Phone Number')}</p>
                                  <p className="text-sm md:text-base font-black text-gray-900">{inquiry.phone}</p>
                                </div>
                                <div className="bg-gray-50/80 p-5 rounded-2xl border-none">
                                  <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5">{t?.propertyInterested || (language === 'বাংলা' ? 'প্রপার্টি' : 'Property')}</p>
                                  <p className="text-sm md:text-base font-black text-[#ba0036] truncate">{inquiry.propTitle}</p> 
                                </div>
                              </div>
                            </div>

                            <div className="bg-[#111827] p-5 md:p-6 rounded-2xl relative shadow-lg h-full flex flex-col justify-center">
                              <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2">{t?.messageFromUser || (language === 'বাংলা' ? 'মেসেজ' : 'Message')}</p>
                              <p className="text-sm font-medium text-white italic leading-relaxed">"{inquiry.msg}"</p> 
                            </div>
                          </div>

                          <div className="w-full xl:w-[240px] flex flex-col gap-4 justify-between shrink-0 mt-2 xl:mt-0">
                            
                            <div className="space-y-3">

                              {/* Accept → hassle-free booking: opens the pre-filled lease modal directly
                                  (no separate "mark accepted" step), confirming it creates the booking.
                                  Reject → marks the inquiry rejected and removes it. Accept is premium-gated. */}
                              <div className="grid grid-cols-2 gap-3">
                                {inquiryTab === 'pending' ? (
                                  <>
                                    <button
                                      onClick={() => acceptInquiry(inquiry)}
                                      className={`w-full py-3.5 md:py-4 rounded-2xl font-black text-[12px] md:text-[13px] shadow-[0_8px_20px_rgba(34,197,94,0.25)] hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2 ${isPremium ? 'bg-gradient-to-br from-green-600 to-emerald-500 hover:from-green-700 hover:to-emerald-600 text-white' : 'bg-gradient-to-br from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white'}`}
                                    >
                                      <CheckCircle2 size={16} />
                                      {language === 'বাংলা' ? 'একসেপ্ট' : 'Accept'}
                                    </button>
                                    <button
                                      onClick={() => rejectInquiry(inquiry)}
                                      className="w-full py-3.5 md:py-4 rounded-2xl font-black text-[12px] md:text-[13px] bg-white text-red-600 border border-red-200 hover:bg-red-50 hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2"
                                    >
                                      <XCircle size={16} /> {language === 'বাংলা' ? 'রিজেক্ট' : 'Reject'}
                                    </button>
                                  </>
                                ) : inquiryTab === 'accepted' ? (
                                  <button
                                    onClick={() => openConvertInquiry(inquiry)}
                                    className="col-span-2 w-full py-3.5 md:py-4 rounded-2xl font-black text-[12px] md:text-[13px] shadow-[0_8px_20px_rgba(34,197,94,0.25)] hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2 bg-gradient-to-br from-green-600 to-emerald-500 hover:from-green-700 hover:to-emerald-600 text-white"
                                  >
                                    <Sparkles size={16} /> {language === 'বাংলা' ? 'বুকিং এ রূপান্তর করুন' : 'Convert to Booking'}
                                  </button>
                                ) : (
                                  <div className="col-span-2 text-center text-red-600 font-bold text-xs py-3 border border-red-100 rounded-2xl bg-red-50">
                                    Rejected Inquiry
                                  </div>
                                )}
                              </div>

                              <button onClick={() => openModal('update_inquiry', inquiry)} className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-2xl font-black text-[11px] md:text-[12px] shadow-[0_8px_20px_rgba(37,99,235,0.18)] hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2">
                                <Calendar size={14} /> {language === 'বাংলা' ? 'স্ট্যাটাস ও ভিজিট' : 'Update Status & Visit'}
                              </button>

                              <div className="grid grid-cols-2 gap-3">
                                <button onClick={() => openChatPanel(inquiry.chatId, { source: 'host-inquiries', tenantName: inquiry.user, tenantPhone: inquiry.phone, propertyTitle: inquiry.propTitle, prefillMessage: '', peerUserId: inquiry.inquirerUserId })} className="w-full bg-[#ba0036] hover:bg-[#90002a] text-white py-3.5 rounded-2xl font-bold text-[11px] shadow-[0_4px_15px_rgba(186,0,54,0.2)] transition-all flex items-center justify-center gap-1.5 border-none active:scale-95">
                                  <MessageSquare size={14} /> {t?.openMessage || (language === 'বাংলা' ? 'মেসেজ' : 'Message')}
                                </button>
                                <button onClick={() => handleCallUser(inquiry.phone, inquiry.id)} className="w-full bg-white text-gray-700 py-3.5 rounded-2xl font-bold text-[11px] hover:bg-gray-50 hover:text-[#ba0036] shadow-[0_4px_15px_rgba(0,0,0,0.03)] transition-all flex items-center justify-center gap-1.5 border border-gray-100">
                                  <Phone size={14} /> {t?.callUser || (language === 'বাংলা' ? 'কল' : 'Call')}
                                </button>
                              </div>

                              <button onClick={() => cutInquiry(inquiry.id)} className="w-full bg-white text-red-500 py-2.5 rounded-2xl font-bold text-[11px] hover:bg-red-50 hover:text-red-600 transition-all flex items-center justify-center gap-1.5 border border-red-100">
                                <Trash2 size={14} /> {language === 'বাংলা' ? 'পুরোপুরি মুছে ফেলুন' : 'Cut / Delete Completely'}
                              </button>
                            </div>

                            <div className="bg-gray-50/80 p-5 rounded-2xl border-none mt-auto">
                               <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-3">{language === 'বাংলা' ? 'টেন্যান্ট প্রোফাইল' : 'Tenant Profile'}</p>
                               <div className="flex flex-col gap-3">
                                 <div className="flex items-center gap-2.5 text-xs font-bold text-gray-700">
                                    {inquiry.verified ? <CheckCircle2 size={16} className="text-green-500" /> : <Hourglass size={16} className="text-orange-400" />}
                                    {inquiry.verified ? 'Verified Identity' : 'Pending Verification'}
                                 </div>
                                 <div className="flex items-center gap-2.5 text-xs font-bold text-gray-700">
                                    <Calendar size={16} className="text-gray-400" />
                                    Joined {inquiry.memberSince || 'Recently'}
                                 </div>
                               </div>
                            </div>

                          </div>

                        </div>
                      </div>
                    ))
                  )}
                </div>

              </div>
              
            </div>
          </div>
        )}      
        
        {/* ─────────────────────────────────────────────────────────────────
            🔴 BOOKINGS TAB — Lease Management (agreement metadata only)
            ─────────────────────────────────────────────────────────────────
            The Bookings tab is now exclusively about the *contract* between
            host and tenant: term length, move-in / expiry dates, deposits,
            service charge, next payment date, and auto-reminder cadence.
            Month-by-month rent collection (12-month matrix, mark-paid modal,
            collection summaries, overdue list) lives on the new
            `rent` tab — they share the same `bookings` state + helpers, so
            both tabs always reflect the same source of truth. */}
        {activeTab === 'bookings' && (() => {
          const todayDate = today;
          const leaseSummary = getLeaseSummary(bookings, todayDate);
          const matchesSearch = (b) => b.tenant.toLowerCase().includes(searchQuery.toLowerCase()) || b.property.toLowerCase().includes(searchQuery.toLowerCase());
          const filtered = bookings.filter(b => {
            const stage = computeLeaseStage(b, todayDate);
            return (leaseStageFilter === 'all' || stage === leaseStageFilter) && matchesSearch(b);
          });
          // Stage → coloured pill class for the compact row badge.
          const stageBadge = (stage) => {
            if (stage === 'active')  return 'bg-green-50 text-green-700 border-green-100';
            if (stage === 'notice')  return 'bg-amber-50 text-amber-700 border-amber-100';
            if (stage === 'draft')   return 'bg-blue-50 text-blue-700 border-blue-100';
            return 'bg-gray-100 text-gray-600 border-gray-200';
          };
          // "Needs Attention" group — leases in their renewal window (notice
          // stage). Only auto-pinned when the host hasn't filtered to a
          // specific stage; otherwise the pill filter takes precedence and
          // we render a flat list.
          const attentionLeases = filtered.filter(b => computeLeaseStage(b, todayDate) === 'notice');
          const otherLeases     = filtered.filter(b => computeLeaseStage(b, todayDate) !== 'notice');

          // ── RENDER ONE COMPACT ROW (collapsed-by-default accordion) ────
          // Collapsed: avatar + tenant + property + ৳rent + stage pill + next-due chip + chevron (~76px tall on mobile)
          // Expanded: collapsed header + 4-tile financial breakdown + 3-tile lease term + progress bar + auto-reminder + actions
          //
          // `forceOpen` (set by the list mapping when ≤ AUTO_EXPAND_THRESHOLD
          // rows match) skips the tap-to-toggle behaviour and the chevron
          // entirely — the row renders fully expanded on first paint and
          // stays that way. Small portfolios get a static, fully-readable
          // layout instead of accordion friction.
          const renderBookingRow = (booking, forceOpen = false) => {
            const stage = computeLeaseStage(booking, todayDate);
            const progress = computeBookingProgress(booking, todayDate);
            const next = daysUntilNextDue(booking, todayDate);
            const monthlyTotal = Number(booking.monthlyRent || 0) + Number(booking.serviceCharge || 0);
            const tenantsLabel = (booking.tenantsCount || 1) === 1
              ? (language === 'বাংলা' ? '১ ভাড়াটিয়া' : '1 Tenant')
              : (language === 'বাংলা' ? `${booking.tenantsCount} ভাড়াটিয়া` : `${booking.tenantsCount} Tenants`);
            const isExpanded = forceOpen || expandedBookingId === booking.id;
            const stageAvatar = stage === 'active' ? 'bg-gradient-to-br from-green-500 to-emerald-600'
                              : stage === 'notice' ? 'bg-gradient-to-br from-amber-500 to-orange-500'
                              : stage === 'draft'  ? 'bg-gradient-to-br from-blue-500 to-indigo-600'
                              : 'bg-gradient-to-br from-gray-400 to-gray-500';

            return (
              <div key={booking.id} className={`bg-white rounded-2xl shadow-[0_2px_10px_rgba(0,0,0,0.03)] border border-gray-100/80 overflow-hidden transition-all duration-300 ${isExpanded ? 'shadow-[0_8px_30px_rgba(0,0,0,0.08)]' : 'hover:shadow-[0_4px_20px_rgba(0,0,0,0.05)]'}`}>

                {/* Compact row — always visible. Click-to-toggle suppressed in forceOpen mode. */}
                <button
                  type="button"
                  onClick={forceOpen ? undefined : () => setExpandedBookingId(isExpanded ? null : booking.id)}
                  className={`w-full flex items-center gap-2.5 sm:gap-3 px-3 sm:px-4 py-3 text-left transition-colors ${forceOpen ? 'cursor-default' : 'hover:bg-gray-50/50'}`}
                >
                  <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center text-white font-black text-[11px] sm:text-xs shrink-0 ${stageAvatar}`}>
                    {booking.tenantInit}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <h4 className="text-[13px] sm:text-sm font-black text-gray-900 truncate">{booking.tenant}</h4>
                      <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider border shrink-0 ${stageBadge(stage)}`}>
                        {stageLabel(stage, language)}
                      </span>
                    </div>
                    <p className="text-[10px] font-bold text-gray-500 truncate">
                      {booking.property} <span className="mx-0.5 text-gray-300">·</span> <span className="tabular-nums">{formatBDT(monthlyTotal)}</span>
                      {next && (
                        <>
                          <span className="mx-0.5 text-gray-300">·</span>
                          <span className={`${next.daysFromNow < 0 ? 'text-rose-600' : next.daysFromNow <= (booking.reminderLeadDays || 3) ? 'text-amber-600' : 'text-gray-500'}`}>
                            {next.daysFromNow < 0 ? `${Math.abs(next.daysFromNow)}d ${language === 'বাংলা' ? 'দেরি' : 'late'}` : next.daysFromNow === 0 ? (language === 'বাংলা' ? 'আজ' : 'today') : `${next.daysFromNow}d`}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="hidden sm:flex flex-col items-end gap-0.5 shrink-0 mr-1">
                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest tabular-nums">{progress}%</span>
                    <div className="w-12 h-1 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${stage === 'done' ? 'bg-gray-400' : stage === 'active' ? 'bg-green-500' : stage === 'notice' ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ width: `${progress}%` }}/>
                    </div>
                  </div>
                  {!forceOpen && (
                    <div className="shrink-0 p-1.5 rounded-lg bg-gray-50 text-gray-400">
                      {isExpanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                    </div>
                  )}
                </button>

                {/* Expanded body — full agreement details */}
                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50/40 px-3 sm:px-4 py-4 animate-in slide-in-from-top-2 fade-in duration-300">

                    {/* Tenant count chip */}
                    <div className="flex items-center justify-end mb-3">
                      <div className="px-2.5 py-1 bg-white border border-gray-100 rounded-lg text-[10px] font-black text-gray-700 inline-flex items-center gap-1.5">
                        <User size={11}/> {tenantsLabel}
                      </div>
                    </div>

                    {/* Financial breakdown — Monthly Rent / Service / Deposit / Total */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
                      <div className="bg-white rounded-xl p-2.5 border border-gray-100">
                        <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'মাসিক ভাড়া' : 'Monthly Rent'}</p>
                        <p className="text-xs sm:text-sm font-black text-gray-900 tabular-nums mt-0.5">{formatBDT(booking.monthlyRent)}</p>
                      </div>
                      <div className="bg-white rounded-xl p-2.5 border border-gray-100">
                        <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'সার্ভিস' : 'Service'}</p>
                        <p className="text-xs sm:text-sm font-black text-gray-900 tabular-nums mt-0.5">{formatBDT(booking.serviceCharge || 0)}</p>
                      </div>
                      <div className="bg-white rounded-xl p-2.5 border border-gray-100">
                        <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'ডিপোজিট' : 'Deposit'}</p>
                        <p className="text-xs sm:text-sm font-black text-gray-900 tabular-nums mt-0.5">{formatBDT(booking.securityDeposit || 0)}</p>
                        <span className={`mt-1 inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${booking.depositPaid ? 'bg-green-50 text-green-700' : 'bg-rose-50 text-rose-700'}`}>
                          {booking.depositPaid ? <CheckCircle2 size={8} strokeWidth={3}/> : <AlertCircle size={8} strokeWidth={3}/>}
                          {booking.depositPaid ? (language === 'বাংলা' ? 'পেইড' : 'Paid') : (language === 'বাংলা' ? 'বকেয়া' : 'Pending')}
                        </span>
                      </div>
                      <div className="bg-gradient-to-br from-[#ba0036]/5 to-[#ff004c]/5 border border-[#ba0036]/10 rounded-xl p-2.5">
                        <p className="text-[8px] font-black text-[#ba0036] uppercase tracking-widest">{language === 'বাংলা' ? 'মোট মাসিক' : 'Total/mo'}</p>
                        <p className="text-xs sm:text-sm font-black text-[#ba0036] tabular-nums mt-0.5">{formatBDT(monthlyTotal)}</p>
                        <p className="text-[8px] font-bold text-gray-500 mt-1">{language === 'বাংলা' ? 'ভাড়া + সার্ভিস' : 'Rent + Service'}</p>
                      </div>
                    </div>

                    {/* Lease term — Move-In · Next Payment · Lease Expiry */}
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 sm:gap-3">
                      <div className="rounded-xl p-2.5 border border-gray-100 bg-white">
                        <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1"><Calendar size={9}/> {language === 'বাংলা' ? 'মুভ-ইন' : 'Move-In'}</p>
                        <p className="text-[11px] sm:text-xs font-black text-gray-900 mt-0.5">{formatDate(booking.leaseStart, language)}</p>
                      </div>
                      <div className="rounded-xl p-2.5 border border-gray-100 bg-white">
                        <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1"><Clock size={9}/> {language === 'বাংলা' ? 'পরবর্তী পেমেন্ট' : 'Next Payment'}</p>
                        <p className="text-[11px] sm:text-xs font-black text-gray-900 mt-0.5">
                          {next ? formatDate(next.due.toISOString(), language) : (language === 'বাংলা' ? 'কোনো বকেয়া নেই' : 'No upcoming')}
                        </p>
                        {next && (
                          <p className={`text-[9px] font-bold mt-0.5 ${next.daysFromNow < 0 ? 'text-rose-600' : next.daysFromNow <= (booking.reminderLeadDays || 3) ? 'text-amber-600' : 'text-gray-500'}`}>
                            {next.daysFromNow < 0 ? `${Math.abs(next.daysFromNow)}d ${language === 'বাংলা' ? 'দেরি' : 'late'}` : next.daysFromNow === 0 ? (language === 'বাংলা' ? 'আজ ডিউ' : 'Due today') : `${language === 'বাংলা' ? 'বাকি' : 'In'} ${next.daysFromNow}d`}
                          </p>
                        )}
                      </div>
                      <div className="rounded-xl p-2.5 border border-gray-100 bg-white">
                        <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1"><CalendarRange size={9}/> {language === 'বাংলা' ? 'লিজ এক্সপায়ারি' : 'Lease Expiry'}</p>
                        <p className="text-[11px] sm:text-xs font-black text-gray-900 mt-0.5">{formatDate(booking.leaseEnd, language)}</p>
                      </div>
                    </div>

                    {/* Lease progress bar */}
                    <div className="mt-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'লিজের অগ্রগতি' : 'Lease Progress'}</span>
                        <span className="text-[10px] font-black text-gray-700 tabular-nums">{progress}%</span>
                      </div>
                      <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-1000 ease-out ${stage === 'done' ? 'bg-gray-400' : stage === 'active' ? 'bg-green-500' : stage === 'notice' ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ width: `${progress}%` }}></div>
                      </div>
                    </div>

                    {/* Auto-reminder + actions row */}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-1.5">
                      <button
                        onClick={() => toggleAutoReminder(booking.id)}
                        className={`px-2.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1 ${booking.autoReminder ? 'bg-blue-50 text-blue-700 hover:bg-blue-100' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
                        title={booking.autoReminder ? `Auto-remind ${booking.reminderLeadDays}d before due` : 'Auto-reminder off'}
                      >
                        {booking.autoReminder ? <BellRing size={12}/> : <BellOff size={12}/>}
                        <span className="hidden sm:inline">{language === 'বাংলা' ? 'অটো রিমাইন্ডার' : 'Auto Reminder'}</span> · {booking.reminderLeadDays}d
                      </button>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        {/* Message — single button. Routes to /messages so every conversation
                            lives in one place; ChatSystem hydrates the right thread from
                            location.state. */}
                        <button
                          onClick={() => openChatPanel(booking.chatId || `chat-${booking.id}`, { source: 'host-bookings', tenantName: booking.tenant, tenantPhone: booking.tenantPhone, propertyTitle: booking.property, peerUserId: booking.tenantId })}
                          className="px-3 py-2 bg-gray-900 text-white hover:bg-[#ba0036] transition-all rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 shadow-md flex items-center gap-1"
                        >
                          <MessageCircle size={12}/> {language === 'বাংলা' ? 'মেসেজ' : 'Message'}
                        </button>
                        {/* Invoice — jumps to Rent Collection focused on this tenant. */}
                        <button
                          onClick={() => { setActiveTab('rent'); setExpandedRentId(booking.id); }}
                          className="px-2.5 py-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-all rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 flex items-center gap-1"
                          title={language === 'বাংলা' ? 'রেন্ট কালেকশনে দেখুন' : 'Open in Rent Collection'}
                        >
                          <Wallet size={12}/> {language === 'বাংলা' ? 'ইনভয়েস' : 'Invoice'}
                        </button>
                        {/* Docs — agreement document vault */}
                        <button onClick={() => openModal('download_user_document')} className="px-2.5 py-2 bg-gray-50 text-gray-700 hover:bg-gray-100 transition-all rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 flex items-center gap-1">
                          <Folder size={12}/> {language === 'বাংলা' ? 'ডকস' : 'Docs'}
                        </button>
                        <div className="relative">
                          <button onClick={() => setActiveDropdownId(activeDropdownId === booking.id ? null : booking.id)} className="p-2 rounded-xl bg-gray-50 text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-all border border-gray-100"><MoreVertical size={13}/></button>
                          {activeDropdownId === booking.id && (
                            <div className="absolute right-0 bottom-full mb-2 w-52 bg-white shadow-[0_15px_40px_rgba(0,0,0,0.12)] rounded-2xl p-1.5 z-[50] animate-in fade-in zoom-in-95 origin-bottom-right border border-gray-100">
                              <button onClick={() => { handleCallUser(booking.tenantPhone); setActiveDropdownId(null); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-blue-50 text-xs font-bold text-gray-700 hover:text-blue-600 transition-colors text-left"><Phone size={14}/> {language === 'বাংলা' ? 'কল করুন' : 'Call Tenant'}</button>
                              <button onClick={() => { setActiveTab('rent'); setExpandedRentId(booking.id); setActiveDropdownId(null); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-emerald-50 text-xs font-bold text-gray-700 hover:text-emerald-600 transition-colors text-left"><Receipt size={14}/> {language === 'বাংলা' ? 'রেন্ট লেজার' : 'Rent Ledger'}</button>
                              <button onClick={() => { showToast(language === 'বাংলা' ? 'অ্যাগ্রিমেন্ট ডাউনলোড হচ্ছে...' : 'Downloading agreement...'); setActiveDropdownId(null); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 text-xs font-bold text-gray-700 transition-colors text-left"><Download size={14}/> {language === 'বাংলা' ? 'অ্যাগ্রিমেন্ট ডাউনলোড' : 'Download Agreement'}</button>
                              <div className="h-px w-full bg-gray-100 my-1"></div>
                              <button onClick={() => handleRemoveBooking(booking.id)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-red-50 text-xs font-bold text-red-600 transition-colors text-left"><Trash2 size={14}/> {t?.remove || (language === 'বাংলা' ? 'লিজ রিমুভ' : 'Remove Lease')}</button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          };
          return (
          <div className="w-full animate-in fade-in zoom-in-95 duration-500">

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 lg:gap-6 xl:h-[calc(100vh-140px)] overflow-visible xl:overflow-hidden">

              {/* ── LEFT RAIL — full Financial Overview ALWAYS visible (mobile + desktop) ── */}
              <aside className="xl:col-span-4 w-full flex flex-col gap-3 xl:gap-5 xl:h-full xl:overflow-y-auto custom-scrollbar xl:pt-1 xl:pb-4 xl:pr-1">

                {/* Financial Overview — full hero card, always visible.
                    Padding/font sizes scale down on mobile so the entire KPI
                    block fits comfortably on a 6.7" viewport. No accordion,
                    no toggle — the host always sees their portfolio at a glance. */}
                <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl xl:rounded-[2rem] p-5 xl:p-7 text-white shadow-[0_10px_30px_rgba(0,0,0,0.18)] xl:shadow-[0_15px_40px_rgba(0,0,0,0.2)] relative overflow-hidden shrink-0">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -translate-y-10 translate-x-10"></div>
                  <div className="flex items-start justify-between mb-1 relative z-10">
                    <h3 className="text-lg xl:text-2xl font-black">{language === 'বাংলা' ? 'ফাইন্যান্সিয়াল ওভারভিউ' : 'Financial Overview'}</h3>
                    {isPremium ? (
                      <div className="bg-[#ba0036] text-white px-2 py-1 rounded-md text-[8px] font-black uppercase tracking-widest flex items-center gap-1 shadow-md">
                         <Crown size={10} /> PRO
                      </div>
                    ) : (
                      <button onClick={() => setActiveModal('premium_gate')} className="bg-white/10 hover:bg-white/20 text-white px-2 py-1 rounded-md text-[8px] font-black uppercase tracking-widest flex items-center gap-1 transition-colors">
                         <Lock size={10} /> Free
                      </button>
                    )}
                  </div>
                  <p className="text-white/50 text-[9px] xl:text-[10px] font-bold uppercase tracking-widest mb-4 xl:mb-7 relative z-10">
                    {language === 'বাংলা' ? 'লিজ পোর্টফোলিও সারাংশ' : 'Lease Portfolio Snapshot'}
                  </p>
                  <div className="space-y-4 xl:space-y-6 relative z-10">
                    <div>
                      <p className="text-white/50 text-[9px] font-black uppercase tracking-widest mb-1">{language === 'বাংলা' ? 'মোট মাসিক আয়' : 'Total Monthly Revenue'}</p>
                      <p className="text-3xl xl:text-4xl font-black text-white tracking-tight tabular-nums">{formatBDT(leaseSummary.totalMonthlyRevenue)}</p>
                      <p className="text-[9px] font-bold text-white/50 mt-1">{language === 'বাংলা' ? 'অ্যাক্টিভ + নোটিশ লিজ থেকে (ভাড়া + সার্ভিস)' : 'from active + notice leases (rent + service)'}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 xl:gap-3">
                      <div className="bg-white/5 rounded-xl xl:rounded-2xl p-2.5 xl:p-3">
                        <p className="text-white/50 text-[9px] font-black uppercase tracking-widest mb-1">{stageLabel('active', language)}</p>
                        <p className="text-xl xl:text-2xl font-black text-green-400 tabular-nums">{leaseSummary.activeCount}</p>
                      </div>
                      <div className="bg-white/5 rounded-xl xl:rounded-2xl p-2.5 xl:p-3">
                        <p className="text-white/50 text-[9px] font-black uppercase tracking-widest mb-1">{stageLabel('notice', language)}</p>
                        <p className="text-xl xl:text-2xl font-black text-amber-300 tabular-nums">{leaseSummary.noticeCount}</p>
                      </div>
                      <div className="bg-white/5 rounded-xl xl:rounded-2xl p-2.5 xl:p-3">
                        <p className="text-white/50 text-[9px] font-black uppercase tracking-widest mb-1">{stageLabel('draft', language)}</p>
                        <p className="text-xl xl:text-2xl font-black text-blue-300 tabular-nums">{leaseSummary.draftCount}</p>
                      </div>
                      <div className="bg-white/5 rounded-xl xl:rounded-2xl p-2.5 xl:p-3">
                        <p className="text-white/50 text-[9px] font-black uppercase tracking-widest mb-1">{stageLabel('done', language)}</p>
                        <p className="text-xl xl:text-2xl font-black text-white/70 tabular-nums">{leaseSummary.doneCount}</p>
                      </div>
                    </div>
                    <div className="bg-white/5 rounded-xl xl:rounded-2xl p-2.5 xl:p-3">
                      <p className="text-white/50 text-[9px] font-black uppercase tracking-widest mb-1">{language === 'বাংলা' ? 'মোট সিকিউরিটি ডিপোজিট' : 'Total Security Deposits'}</p>
                      <p className="text-lg xl:text-xl font-black text-white tabular-nums">{formatBDT(leaseSummary.totalSecurityDeposits)}</p>
                      <p className="text-[9px] font-bold text-white/50 mt-1">{language === 'বাংলা' ? 'লিজ শেষে রিটার্নযোগ্য' : 'returnable at lease end'}</p>
                    </div>
                  </div>
                </div>

                {/* Lease status flow — always visible on mobile + desktop. */}
                <div className="bg-white rounded-2xl xl:rounded-[2rem] p-4 xl:p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)] border-none shrink-0">
                  <h4 className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-3 xl:mb-4 flex items-center gap-2">
                    <Activity size={14} className="text-gray-400" />
                    {language === 'বাংলা' ? 'লিজ স্ট্যাটাস ফ্লো' : 'Lease Status Flow'}
                  </h4>
                  <div className="space-y-2 xl:space-y-3">
                    {[
                      { stage: 'draft',  count: leaseSummary.draftCount,  dot: 'bg-blue-500',  bg: 'bg-blue-50',  text: 'text-blue-700',  hint: language === 'বাংলা' ? 'মুভ-ইনের অপেক্ষায়' : 'awaiting move-in' },
                      { stage: 'active', count: leaseSummary.activeCount, dot: 'bg-green-500', bg: 'bg-green-50', text: 'text-green-700', hint: language === 'বাংলা' ? 'বর্তমানে রেসিডেন্স' : 'currently in residence' },
                      { stage: 'notice', count: leaseSummary.noticeCount, dot: 'bg-amber-500', bg: 'bg-amber-50', text: 'text-amber-700', hint: language === 'বাংলা' ? 'রিনিউয়াল উইন্ডো · শেষ ৩০ দিন' : 'renewal window · last 30 days' },
                      { stage: 'done',   count: leaseSummary.doneCount,   dot: 'bg-gray-400',  bg: 'bg-gray-100', text: 'text-gray-600',  hint: language === 'বাংলা' ? 'মেয়াদ শেষ' : 'lease ended' },
                    ].map(row => (
                      <button key={row.stage} onClick={() => setLeaseStageFilter(row.stage)} className="w-full flex items-center gap-3 p-2 -mx-2 rounded-xl hover:bg-gray-50 transition-colors text-left">
                        <span className={`w-2 h-2 rounded-full ${row.dot}`}></span>
                        <span className="text-xs font-black text-gray-900 w-20 capitalize">{stageLabel(row.stage, language)}</span>
                        <span className="text-[10px] font-bold text-gray-500 flex-1 truncate">{row.hint}</span>
                        <span className={`${row.bg} ${row.text} px-2.5 py-1 rounded-lg text-xs font-black tabular-nums`}>{row.count}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => setActiveTab('rent')}
                  className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-100 rounded-2xl xl:rounded-[2rem] p-4 xl:p-5 shadow-[0_4px_20px_rgba(0,0,0,0.02)] flex items-center justify-between gap-3 transition-colors shrink-0 group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-white border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
                      <Wallet size={16} />
                    </div>
                    <div className="text-left">
                      <p className="text-xs font-black text-emerald-900">{language === 'বাংলা' ? 'ভাড়া কালেকশন' : 'Rent Collection'}</p>
                      <p className="text-[10px] font-bold text-emerald-700/70 leading-tight">{language === 'বাংলা' ? '১২ মাসের লেজার, পেমেন্ট আপডেট' : '12-month ledger, mark paid, reminders'}</p>
                    </div>
                  </div>
                  <ArrowUpRight size={16} className="text-emerald-700 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                </button>
              </aside>

              {/* ── RIGHT MAIN — main IS the scroll container; sticky toolbar pins inside it ── */}
              <main className="xl:col-span-8 w-full xl:h-full xl:overflow-y-auto custom-scrollbar pb-24 xl:pr-3 min-w-0">

                {/* Sticky toolbar — ONE row. Title is a tiny chip in the
                    corner; search + filter pills + New Lease share the same
                    sticky line. Because <main> is the scroll container, this
                    bar pins to the top of the list as the host scrolls (works
                    on both desktop and mobile). */}
                <div className="sticky top-0 z-30 bg-gray-50/85 backdrop-blur-md -mx-3 sm:-mx-4 xl:mx-0 px-3 sm:px-4 xl:px-0 pt-2 pb-3 mb-2 xl:pt-1">
                  <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap xl:flex-nowrap">
                    {/* Title corner chip — small, gray, with live count. */}
                    <span className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/70 text-[9px] xl:text-[10px] font-black text-gray-700 uppercase tracking-widest shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                      <CalendarRange size={11} className="text-[#ba0036]"/>
                      <span className="hidden sm:inline">{language === 'বাংলা' ? 'লিজ' : 'Leases'}</span>
                      <span className="text-gray-400 tabular-nums">{filtered.length}</span>
                    </span>
                    {/* Search input — flexes to fill, capped on desktop. */}
                    <div className="relative flex-1 min-w-[120px] xl:max-w-[260px] order-3 sm:order-none basis-full sm:basis-auto">
                      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      <input
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={language === 'বাংলা' ? 'খুঁজুন...' : 'Search tenants...'}
                        className="w-full pl-7 pr-2 py-2 rounded-xl bg-white text-[11px] font-bold text-gray-900 shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-transparent focus:border-gray-200 focus:outline-none placeholder:text-gray-400"
                      />
                    </div>
                    {/* Filter pills — horizontal scroll on narrow viewports. */}
                    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar flex-1 xl:flex-none order-2 sm:order-none min-w-0">
                      {['all', 'draft', 'active', 'notice', 'done'].map(f => (
                        <button
                          key={f}
                          onClick={() => setLeaseStageFilter(f)}
                          className={`shrink-0 px-2.5 sm:px-3 py-2 rounded-xl text-[10px] font-black capitalize transition-all whitespace-nowrap ${leaseStageFilter === f ? 'bg-gray-900 text-white shadow-[0_2px_8px_rgba(0,0,0,0.15)]' : 'bg-white text-gray-500 hover:text-gray-900 shadow-[0_2px_6px_rgba(0,0,0,0.03)]'}`}
                        >
                          {stageLabel(f, language)}
                        </button>
                      ))}
                    </div>
                    {/* New Lease action — corner-pinned. */}
                    <button
                      onClick={() => isPremium ? openBlankLease() : setActiveModal('premium_gate')}
                      className="shrink-0 bg-[#ba0036] hover:bg-[#90002a] text-white px-3 py-2 rounded-xl font-black text-[10px] shadow-[0_4px_12px_rgba(186,0,54,0.25)] transition-all flex items-center gap-1.5 active:scale-95 order-1 sm:order-none ml-auto sm:ml-0"
                    >
                      {isPremium ? <Plus size={13}/> : <Crown size={13}/>}
                      <span className="hidden sm:inline">{language === 'বাংলা' ? 'নতুন লিজ' : 'New Lease'}</span>
                    </button>
                  </div>
                </div>

                {/* List — flat sequence of compact rows. Sticky toolbar above
                    floats on scroll. forceOpen auto-engages when the filtered
                    list is ≤5 rows; small portfolios then get a fully-readable
                    static layout instead of accordion friction. */}
                {(() => {
                  const AUTO_EXPAND_THRESHOLD = 5;
                  const forceOpen = filtered.length > 0 && filtered.length <= AUTO_EXPAND_THRESHOLD;
                  if (filtered.length === 0) {
                    return (
                      <div className="text-center py-20 bg-white rounded-2xl shadow-[0_2px_10px_rgba(0,0,0,0.02)] border-none">
                        <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                           <Calendar className="text-gray-300" size={26} />
                        </div>
                        <h3 className="text-sm font-black text-gray-900">{t?.noBookingsFound || (language === 'বাংলা' ? 'কোনো লিজ পাওয়া যায়নি।' : 'No leases found.')}</h3>
                        <p className="text-[10px] font-bold text-gray-500 mt-1.5 px-6">
                          {language === 'বাংলা' ? 'ইনকোয়ারি থেকে ভাড়াটিয়াকে অ্যাড করুন।' : 'Convert an inquiry into a booking to start.'}
                        </p>
                      </div>
                    );
                  }
                  return (
                    <div className="space-y-2">
                      {leaseStageFilter === 'all' && attentionLeases.length > 0 ? (
                        <>
                          <div className="flex items-center gap-2 mt-1 px-1 pt-1">
                            <AlertCircle size={12} className="text-amber-600 shrink-0"/>
                            <span className="text-[10px] font-black text-amber-700 uppercase tracking-widest">
                              {language === 'বাংলা' ? 'এখনই দরকার' : 'Needs Attention'} · {attentionLeases.length}
                            </span>
                            <div className="flex-1 h-px bg-amber-200/60"/>
                          </div>
                          {attentionLeases.map((b) => renderBookingRow(b, forceOpen))}
                          {otherLeases.length > 0 && (
                            <div className="flex items-center gap-2 px-1 pt-3 pb-1">
                              <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                                {language === 'বাংলা' ? 'সকল লিজ' : 'All Leases'} · {otherLeases.length}
                              </span>
                              <div className="flex-1 h-px bg-gray-200"/>
                            </div>
                          )}
                          {otherLeases.map((b) => renderBookingRow(b, forceOpen))}
                        </>
                      ) : (
                        filtered.map((b) => renderBookingRow(b, forceOpen))
                      )}
                    </div>
                  );
                })()}
              </main>

            </div>
          </div>
          );
        })()}

        {/* ─────────────────────────────────────────────────────────────────
            🔴 RENT COLLECTION TAB — Shared Ledger (rent payment tracking)
            ─────────────────────────────────────────────────────────────────
            Replaces the host's rent-tracking spreadsheet. Compact accordion
            rows surface the 12-month matrix on tap, so a 50-tenant portfolio
            fits on one screen at a glance. KPI hero collapses to a 1-line
            banner on mobile. Sticky toolbar keeps search + priority filters
            pinned while scrolling. "Needs Attention" group auto-pins overdue
            and partial tenants to the top — the answer to "who hasn't paid"
            without scrolling.

            All payment logic — rent ledger updates, cross-system receipts to
            TenantDashboard, auto-reminder cron, the 2-step Mark-Paid modal —
            is inherited from the original rent flow and remains untouched.
            Only the rendering layer is compact-mode. */}
        {activeTab === 'rent' && (() => {
          const todayDate = today;
          const sm = getMonthCollectionSummary(bookings, todayDate.getFullYear(), todayDate.getMonth() + 1, todayDate);
          const collectedPct = sm.expectedTotal > 0 ? Math.min(100, Math.round((sm.collectedTotal / sm.expectedTotal) * 100)) : 0;
          const yearMonths = Array.from({ length: 12 }, (_, i) => monthKey(ledgerYear, i + 1));
          // Bucket tenants by their CURRENT-month rent state — drives the
          // priority filter pills + per-row status badge. Aligned with the
          // matrix vocabulary so colours stay consistent across the tab.
          const tenantBucket = (booking) => {
            const months = enumerateLeaseMonths(booking.leaseStart, booking.leaseEnd);
            if (!months.includes(sm.key)) return 'none';
            const entry = booking.ledger?.[sm.key];
            if (entry?.paid) {
              const isPartial = entry.status === 'partial' || (Number(entry.balance) || 0) > 0;
              return isPartial ? 'partial' : 'cleared';
            }
            const due = getDueDate(sm.key, booking.rentDueDay);
            if (entry?.status === 'due' || (due && todayDate > due)) return 'overdue';
            return 'upcoming';
          };
          const matchesQuery = (b) => b.tenant.toLowerCase().includes(searchQuery.toLowerCase()) || b.property.toLowerCase().includes(searchQuery.toLowerCase());
          const filteredBookings = bookings.filter(b => {
            if (!matchesQuery(b)) return false;
            if (rentPriorityFilter === 'all') return true;
            return tenantBucket(b) === rentPriorityFilter;
          });
          const counts = bookings.reduce((acc, b) => { const k = tenantBucket(b); acc[k] = (acc[k] || 0) + 1; return acc; }, {});
          // Auto-pin: overdue + partial when filter is "all" — the rows the
          // host actually needs to do something about.
          const attentionRent = rentPriorityFilter === 'all'
            ? filteredBookings.filter(b => { const k = tenantBucket(b); return k === 'overdue' || k === 'partial'; })
            : [];
          const otherRent = rentPriorityFilter === 'all'
            ? filteredBookings.filter(b => { const k = tenantBucket(b); return k !== 'overdue' && k !== 'partial'; })
            : filteredBookings;

          // Coloured palette per current-month bucket — re-used across the
          // avatar gradient, status pill, and progress bar.
          const bucketTheme = {
            cleared:  { cls: 'bg-emerald-50 text-emerald-700 border-emerald-100', label: language === 'বাংলা' ? 'ক্লিয়ার্ড' : 'CLEARED', icon: <CheckCircle2 size={10} strokeWidth={3}/>, bar: 'bg-emerald-500', avatar: 'bg-gradient-to-br from-emerald-500 to-green-600' },
            partial:  { cls: 'bg-amber-50 text-amber-700 border-amber-100',       label: language === 'বাংলা' ? 'আংশিক' : 'PARTIAL',     icon: <Hourglass size={10} strokeWidth={3}/>,    bar: 'bg-amber-500',   avatar: 'bg-gradient-to-br from-amber-500 to-orange-500' },
            overdue:  { cls: 'bg-rose-50 text-rose-700 border-rose-100',          label: language === 'বাংলা' ? 'বকেয়া' : 'OVERDUE',     icon: <AlertCircle size={10} strokeWidth={3}/>,  bar: 'bg-rose-500',    avatar: 'bg-gradient-to-br from-rose-500 to-red-600' },
            upcoming: { cls: 'bg-orange-50 text-orange-700 border-orange-100',    label: language === 'বাংলা' ? 'আসন্ন' : 'UPCOMING',    icon: <Clock size={10} strokeWidth={3}/>,        bar: 'bg-orange-400',  avatar: 'bg-gradient-to-br from-[#ba0036] to-[#ff004c]' },
            none:     { cls: 'bg-gray-100 text-gray-600 border-gray-200',         label: language === 'বাংলা' ? 'লিজের বাইরে' : 'OUTSIDE', icon: <MinusCircle size={10} strokeWidth={3}/>, bar: 'bg-gray-300',    avatar: 'bg-gradient-to-br from-gray-400 to-gray-500' },
          };

          // ── RENDER ONE COMPACT ROW (collapsed-by-default accordion) ────
          // Collapsed: avatar + tenant + property + ৳outstanding + status pill + chevron (~76px tall)
          // Expanded: collapsed header + this-month ledger panel + 12-month matrix + per-month rows + actions
          //
          // `forceOpen` (set by the list mapping when ≤ AUTO_EXPAND_THRESHOLD
          // tenants match) skips the tap-to-toggle behaviour and the chevron
          // entirely — every row renders fully expanded on first paint and
          // stays that way. Hosts with a handful of tenants get a static,
          // fully-readable layout instead of accordion friction.
          const renderRentRow = (booking, forceOpen = false) => {
            const bucket = tenantBucket(booking);
            const theme = bucketTheme[bucket];
            const leaseMonths = enumerateLeaseMonths(booking.leaseStart, booking.leaseEnd);
            const monthEntry = booking.ledger?.[sm.key];
            const monthInLease = leaseMonths.includes(sm.key);
            const expectedThisMonth = monthInLease ? Number(booking.monthlyRent || 0) : 0;
            const paidThisMonth = monthEntry?.paid ? Number(monthEntry.amount || 0) : 0;
            const balanceThisMonth = Math.max(0, expectedThisMonth - paidThisMonth);
            const nextDue = daysUntilNextDue(booking, todayDate);
            const status = computeBookingStatus(booking, todayDate);
            const paidThisYear = yearMonths.filter(k => booking.ledger?.[k]?.paid).length;
            const monthsThisYearInLease = yearMonths.filter(k => leaseMonths.includes(k)).length;
            const isExpanded = forceOpen || expandedRentId === booking.id;
            const collectedPctRow = expectedThisMonth > 0 ? Math.min(100, Math.round((paidThisMonth / expectedThisMonth) * 100)) : 0;

            return (
              <div key={booking.id} className={`bg-white rounded-2xl shadow-[0_2px_10px_rgba(0,0,0,0.03)] border border-gray-100/80 overflow-hidden transition-all duration-300 ${isExpanded ? 'shadow-[0_8px_30px_rgba(0,0,0,0.08)]' : 'hover:shadow-[0_4px_20px_rgba(0,0,0,0.05)]'}`}>

                {/* ── Compact row — always visible. Click-to-toggle suppressed in forceOpen mode. ── */}
                <button
                  type="button"
                  onClick={forceOpen ? undefined : () => setExpandedRentId(isExpanded ? null : booking.id)}
                  className={`w-full flex items-center gap-2.5 sm:gap-3 px-3 sm:px-4 py-3 text-left transition-colors ${forceOpen ? 'cursor-default' : 'hover:bg-gray-50/50'}`}
                >
                  <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center text-white font-black text-[11px] sm:text-xs shrink-0 ${theme.avatar}`}>
                    {booking.tenantInit}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <h4 className="text-[13px] sm:text-sm font-black text-gray-900 truncate">{booking.tenant}</h4>
                      <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider border shrink-0 inline-flex items-center gap-0.5 ${theme.cls}`}>
                        {theme.icon} <span className="hidden sm:inline">{theme.label}</span>
                      </span>
                    </div>
                    <p className="text-[10px] font-bold text-gray-500 truncate">
                      {booking.property}
                      {monthInLease && (
                        <>
                          <span className="mx-1 text-gray-300">·</span>
                          {bucket === 'cleared'
                            ? <span className="text-emerald-600 tabular-nums">{formatBDT(paidThisMonth)} {language === 'বাংলা' ? 'পেইড' : 'paid'}</span>
                            : bucket === 'partial'
                              ? <span className="text-amber-600 tabular-nums">{formatBDT(balanceThisMonth)} {language === 'বাংলা' ? 'বাকি' : 'due'}</span>
                              : bucket === 'overdue'
                                ? <span className="text-rose-600 tabular-nums">{formatBDT(expectedThisMonth)} {language === 'বাংলা' ? 'বকেয়া' : 'overdue'}</span>
                                : <span className="text-gray-600 tabular-nums">{formatBDT(expectedThisMonth)} {language === 'বাংলা' ? 'আসন্ন' : 'upcoming'}</span>}
                          {nextDue && (
                            <>
                              <span className="mx-1 text-gray-300">·</span>
                              <span className={`${nextDue.daysFromNow < 0 ? 'text-rose-600' : nextDue.daysFromNow <= 3 ? 'text-amber-600' : 'text-gray-500'}`}>
                                {nextDue.daysFromNow < 0 ? `${Math.abs(nextDue.daysFromNow)}d late` : nextDue.daysFromNow === 0 ? 'today' : `${nextDue.daysFromNow}d`}
                              </span>
                            </>
                          )}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="hidden sm:flex flex-col items-end gap-1 shrink-0 mr-1">
                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest tabular-nums">{paidThisYear}/{monthsThisYearInLease || 12}</span>
                    <div className="w-12 h-1 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${theme.bar}`} style={{ width: `${collectedPctRow}%` }}/>
                    </div>
                  </div>
                  {!forceOpen && (
                    <div className="shrink-0 p-1.5 rounded-lg bg-gray-50 text-gray-400">
                      {isExpanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                    </div>
                  )}
                </button>

                {/* ── Expanded body — ledger panel + 12-month matrix ───── */}
                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50/40 px-3 sm:px-4 py-4 animate-in slide-in-from-top-2 fade-in duration-300">

                    {/* This-month ledger panel — totals + progress + edit */}
                    <div className="bg-white rounded-2xl p-3.5 border border-gray-100">
                      <div className="flex items-center justify-between mb-2.5 gap-2">
                        <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest truncate">
                          {language === 'বাংলা' ? 'এই মাস' : 'This Month'} · {monthFullLabel(sm.key, language)}
                        </p>
                        {monthInLease && (
                          <button
                            onClick={() => openMarkPaid(booking, sm.key)}
                            className="px-2.5 py-1 rounded-lg bg-[#ba0036] text-white text-[9px] font-black uppercase tracking-widest hover:bg-[#90002a] transition-colors flex items-center gap-1 shrink-0"
                          >
                            <Edit3 size={10} strokeWidth={3}/> {monthEntry?.paid ? (language === 'বাংলা' ? 'এডিট' : 'Edit') : (language === 'বাংলা' ? 'মার্ক পেইড' : 'Mark Paid')}
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2 sm:gap-3">
                        <div>
                          <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'মোট ডিউ' : 'Due'}</p>
                          <p className="text-xs sm:text-sm font-black text-gray-900 tabular-nums mt-0.5">{formatBDT(expectedThisMonth)}</p>
                        </div>
                        <div>
                          <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'পেইড' : 'Paid'}</p>
                          <p className="text-xs sm:text-sm font-black text-emerald-600 tabular-nums mt-0.5">{formatBDT(paidThisMonth)}</p>
                        </div>
                        <div>
                          <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'বাকি' : 'Balance'}</p>
                          <p className={`text-xs sm:text-sm font-black tabular-nums mt-0.5 ${balanceThisMonth > 0 ? 'text-rose-600' : 'text-gray-400'}`}>{formatBDT(balanceThisMonth)}</p>
                        </div>
                      </div>
                      <div className="mt-2.5 h-1 w-full bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-700 ${theme.bar}`}
                             style={{ width: expectedThisMonth > 0 ? `${(paidThisMonth / expectedThisMonth) * 100}%` : '0%' }} />
                      </div>
                    </div>

                    {/* Year stepper (inline) — lets the host browse other years */}
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <div className="flex bg-white p-1 rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.03)] items-center gap-0.5">
                        <button onClick={() => setLedgerYear(y => y - 1)} className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-50" aria-label="Prev year">
                          <ArrowLeft size={12} />
                        </button>
                        <span className="px-2 text-[11px] font-black text-gray-900 tabular-nums">{ledgerYear}</span>
                        <button onClick={() => setLedgerYear(y => y + 1)} className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-50" aria-label="Next year">
                          <ArrowRight size={12} />
                        </button>
                      </div>
                      <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest tabular-nums">{paidThisYear}/{monthsThisYearInLease || 12} {language === 'বাংলা' ? 'মাস' : 'months'}</span>
                    </div>

                    {/* 12-month rent grid — the headline feature */}
                    <div className="mt-2 bg-white p-2.5 rounded-2xl border border-gray-100">
                      <div className="grid grid-cols-12 gap-1">
                        {yearMonths.map(k => {
                          const inLease = leaseMonths.includes(k);
                          const cellStatus = inLease ? getRentStatus(booking, k, todayDate) : 'before-lease';
                          const entry = booking.ledger?.[k];
                          const isCurrent = k === monthKey(todayDate.getFullYear(), todayDate.getMonth() + 1);
                          // Tooltip — surfaces sub-status (full/partial/due) on hover.
                          const tooltip = inLease
                            ? (entry?.paid
                                ? (cellStatus === 'partial'
                                    ? `${monthFullLabel(k, language)} · Partial ${formatBDT(entry.amount)} / ${formatBDT(booking.monthlyRent)} · Balance ${formatBDT(entry.balance)} · ${formatDate(entry.paidOn, language)}`
                                    : `${monthFullLabel(k, language)} · Paid ${formatBDT(entry.amount)} ${formatDate(entry.paidOn, language)}${entry.method ? ' (' + entry.method + ')' : ''}`)
                                : (cellStatus === 'due-marked'
                                    ? `${monthFullLabel(k, language)} · Marked due${entry?.dueNote ? ' — ' + entry.dueNote : ''}`
                                    : `${monthFullLabel(k, language)} · ${cellStatus.replace('-', ' ')} · due ${formatDate(getDueDate(k, booking.rentDueDay)?.toISOString(), language)}`))
                            : `${monthFullLabel(k, language)} · ${language === 'বাংলা' ? 'লিজের বাইরে' : 'outside lease'}`;
                          // Colour vocabulary — matches the legend + tenant receipts.
                          const colorClass =
                            cellStatus === 'paid' ? 'bg-blue-500 text-white hover:bg-blue-600 shadow-[0_2px_8px_rgba(59,130,246,0.35)]' :
                            cellStatus === 'partial' ? 'bg-amber-400 text-white hover:bg-amber-500' :
                            cellStatus === 'due-marked' ? 'bg-red-500 text-white hover:bg-red-600' :
                            cellStatus === 'overdue' ? 'bg-red-500 text-white hover:bg-red-600 animate-pulse' :
                            cellStatus === 'due-soon' ? 'bg-orange-400 text-white hover:bg-orange-500' :
                            cellStatus === 'upcoming' ? 'bg-gray-100 text-gray-500 hover:bg-gray-200' :
                            'bg-gray-50 text-gray-300 cursor-not-allowed border border-dashed border-gray-200';
                          return (
                            <button
                              key={k}
                              type="button"
                              title={tooltip}
                              disabled={!inLease}
                              onClick={(e) => { e.stopPropagation(); inLease && openMarkPaid(booking, k); }}
                              className={`relative aspect-square rounded-lg text-[8px] sm:text-[9px] font-black uppercase tracking-tight transition-all flex flex-col items-center justify-center ${colorClass} ${isCurrent ? 'ring-2 ring-offset-1 ring-gray-900' : ''}`}
                            >
                              <span className="leading-none">{(language === 'বাংলা' ? MONTH_NAMES_BN_SHORT : MONTH_NAMES_EN_SHORT)[parseMonthKey(k).month - 1]}</span>
                              {cellStatus === 'paid' && <CheckCheck size={9} className="mt-0.5" strokeWidth={3} />}
                              {cellStatus === 'partial' && <Hourglass size={8} className="mt-0.5" strokeWidth={3} />}
                              {cellStatus === 'due-marked' && <AlertCircle size={8} className="mt-0.5" strokeWidth={3} />}
                            </button>
                          );
                        })}
                      </div>
                      {nextDue && status !== 'completed' && (
                        <div className="mt-2.5 flex items-center justify-end">
                          <p className={`text-[9px] font-black tracking-wide whitespace-nowrap shrink-0 px-2 py-1 rounded-lg ${nextDue.daysFromNow < 0 ? 'bg-red-50 text-red-600' : nextDue.daysFromNow <= (booking.reminderLeadDays || 3) ? 'bg-orange-50 text-orange-600' : 'bg-gray-100 text-gray-600'}`}>
                            <Clock size={10} className="inline -mt-0.5 mr-1" />
                            {nextDue.daysFromNow < 0
                              ? `${Math.abs(nextDue.daysFromNow)}d ${language === 'বাংলা' ? 'দেরি' : 'late'} · ${monthShortLabel(nextDue.key, language)}`
                              : nextDue.daysFromNow === 0
                                ? `${language === 'বাংলা' ? 'আজ ডিউ' : 'Due today'} · ${monthShortLabel(nextDue.key, language)}`
                                : `${language === 'বাংলা' ? 'ডিউ' : 'Due in'} ${nextDue.daysFromNow}d · ${monthShortLabel(nextDue.key, language)}`}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Action row — payment-focused */}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => {
                            const k = nextDue?.key || monthKey(todayDate.getFullYear(), todayDate.getMonth() + 1);
                            openMarkPaid(booking, k);
                          }}
                          className="px-2.5 py-2 bg-green-50 hover:bg-green-100 text-green-700 transition-all rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 flex items-center gap-1"
                        >
                          <CheckCircle2 size={12} /> {language === 'বাংলা' ? 'পেইড মার্ক' : 'Mark Paid'}
                        </button>
                        {nextDue && nextDue.daysFromNow <= (booking.reminderLeadDays || 3) && (
                          <button onClick={() => sendRentReminder(booking, nextDue.key)} className="px-2.5 py-2 bg-orange-50 text-orange-700 hover:bg-orange-100 transition-all rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 flex items-center gap-1">
                            <BellRing size={12}/> {language === 'বাংলা' ? 'রিমাইন্ডার' : 'Remind'}
                          </button>
                        )}
                      </div>
                      <button
                        onClick={() => openChatPanel(booking.chatId || `chat-${booking.id}`, { source: 'host-rent', tenantName: booking.tenant, tenantPhone: booking.tenantPhone, propertyTitle: booking.property, peerUserId: booking.tenantId })}
                        className="px-3 py-2 bg-gray-900 text-white hover:bg-[#ba0036] transition-all rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 shadow-md flex items-center gap-1.5"
                      >
                        <MessageCircle size={12}/> {language === 'বাংলা' ? 'মেসেজ' : 'Message'}
                      </button>
                    </div>

                    {/* Per-month ledger detail rows — collapsible secondary view */}
                    <details className="mt-3 group">
                      <summary className="cursor-pointer list-none flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100/60 transition-colors">
                        <ChevronDown size={12} className="text-gray-400 group-open:rotate-180 transition-transform"/>
                        <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                          {language === 'বাংলা' ? `${ledgerYear} সালের বিবরণ` : `${ledgerYear} Ledger Details`}
                        </span>
                      </summary>
                      <div className="mt-2 space-y-1">
                        {yearMonths.filter(k => leaseMonths.includes(k)).map(k => {
                          const cellStatus = getRentStatus(booking, k, todayDate);
                          const entry = booking.ledger?.[k];
                          const due = getDueDate(k, booking.rentDueDay);
                          const dotClass =
                            cellStatus === 'paid' ? 'bg-blue-500' :
                            cellStatus === 'partial' ? 'bg-amber-400' :
                            cellStatus === 'due-marked' ? 'bg-red-500' :
                            cellStatus === 'overdue' ? 'bg-red-500' :
                            cellStatus === 'due-soon' ? 'bg-orange-400' : 'bg-gray-300';
                          return (
                            <div key={k} className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-white border border-gray-100">
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`}></span>
                              <span className="text-[10px] font-black text-gray-900 w-14 sm:w-16 shrink-0 truncate">{monthShortLabel(k, language)}</span>
                              <span className="text-[9px] font-bold text-gray-500 hidden sm:inline w-20 shrink-0 truncate">{formatDate(due?.toISOString(), language)}</span>
                              <span className="text-[10px] font-bold flex-1 truncate">
                                {cellStatus === 'paid' && (
                                  <span className="text-blue-700 inline-flex items-center gap-1"><CheckCheck size={10} strokeWidth={3}/> {formatBDT(entry.amount || booking.monthlyRent)}{entry.method ? ` · ${entry.method}` : ''}</span>
                                )}
                                {cellStatus === 'partial' && (
                                  <span className="text-amber-700 inline-flex items-center gap-1"><Hourglass size={10} strokeWidth={3}/> {language === 'বাংলা' ? 'বাকি' : 'Bal'} {formatBDT(entry.balance)}</span>
                                )}
                                {cellStatus === 'due-marked' && (
                                  <span className="text-red-600 inline-flex items-center gap-1"><AlertCircle size={10} strokeWidth={3}/> {language === 'বাংলা' ? 'বকেয়া' : 'Marked Due'}</span>
                                )}
                                {cellStatus === 'overdue' && (<span className="text-red-600">{language === 'বাংলা' ? 'বকেয়া' : 'Overdue'}</span>)}
                                {cellStatus === 'due-soon' && (<span className="text-orange-600">{language === 'বাংলা' ? 'শীঘ্রই' : 'Soon'}</span>)}
                                {cellStatus === 'upcoming' && (<span className="text-gray-500">{language === 'বাংলা' ? 'আসন্ন' : 'Upcoming'}</span>)}
                              </span>
                              {entry?.paid ? (
                                <button onClick={(e) => { e.stopPropagation(); openMarkPaid(booking, k); }} className="p-1 rounded-md hover:bg-gray-100 text-gray-500 shrink-0" title="Edit"><Edit3 size={11}/></button>
                              ) : (
                                <button onClick={(e) => { e.stopPropagation(); openMarkPaid(booking, k); }} className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-wider shrink-0 ${cellStatus === 'due-marked' ? 'bg-red-50 hover:bg-red-100 text-red-700' : 'bg-green-50 hover:bg-green-100 text-green-700'}`}>
                                  {cellStatus === 'due-marked' ? (language === 'বাংলা' ? 'এডিট' : 'Update') : (language === 'বাংলা' ? 'রেকর্ড' : 'Record')}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  </div>
                )}
              </div>
            );
          };

          return (
          <div className="w-full animate-in fade-in zoom-in-95 duration-500">

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 lg:gap-6 xl:h-[calc(100vh-140px)] overflow-visible xl:overflow-hidden">

              {/* ── LEFT RAIL — full Shared Ledger ALWAYS visible (mobile + desktop) ── */}
              <aside className="xl:col-span-4 w-full flex flex-col gap-3 xl:gap-5 xl:h-full xl:overflow-y-auto custom-scrollbar xl:pt-1 xl:pb-4 xl:pr-1">

                {/* Shared Ledger hero — full KPI card, always visible. */}
                <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl xl:rounded-[2rem] p-5 xl:p-7 text-white shadow-[0_10px_30px_rgba(0,0,0,0.18)] xl:shadow-[0_15px_40px_rgba(0,0,0,0.2)] relative overflow-hidden shrink-0">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -translate-y-10 translate-x-10"></div>
                  <div className="flex items-start justify-between mb-1 relative z-10">
                    <h3 className="text-lg xl:text-2xl font-black">{language === 'বাংলা' ? 'শেয়ার্ড লেজার' : 'Shared Ledger'}</h3>
                    {isPremium ? (
                      <div className="bg-[#ba0036] text-white px-2 py-1 rounded-md text-[8px] font-black uppercase tracking-widest flex items-center gap-1 shadow-md">
                         <Crown size={10} /> PRO
                      </div>
                    ) : (
                      <button onClick={() => setActiveModal('premium_gate')} className="bg-white/10 hover:bg-white/20 text-white px-2 py-1 rounded-md text-[8px] font-black uppercase tracking-widest flex items-center gap-1 transition-colors">
                         <Lock size={10} /> Free
                      </button>
                    )}
                  </div>
                  <p className="text-white/50 text-[9px] xl:text-[10px] font-bold uppercase tracking-widest mb-4 xl:mb-7 relative z-10">
                    {monthFullLabel(sm.key, language)} · {language === 'বাংলা' ? 'এই মাসের আদায়' : "This Month's Collection"}
                  </p>
                  <div className="space-y-4 xl:space-y-6 relative z-10">
                    <div>
                      <p className="text-white/50 text-[9px] font-black uppercase tracking-widest mb-1">{language === 'বাংলা' ? 'প্রত্যাশিত আয়' : 'Expected'}</p>
                      <p className="text-3xl xl:text-4xl font-black text-white tracking-tight tabular-nums">{formatBDT(sm.expectedTotal)}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 xl:gap-4">
                      <div className="bg-white/5 rounded-xl xl:rounded-2xl p-2.5 xl:p-3">
                        <p className="text-white/50 text-[9px] font-black uppercase tracking-widest mb-1">{language === 'বাংলা' ? 'আদায় হয়েছে' : 'Collected'}</p>
                        <p className="text-lg xl:text-xl font-black text-green-400 tracking-tight tabular-nums">{formatBDT(sm.collectedTotal)}</p>
                        <p className="text-[9px] text-white/60 font-bold mt-1">{sm.paidCount}/{sm.totalDueCount} {language === 'বাংলা' ? 'ভাড়াটিয়া' : 'tenants'}</p>
                      </div>
                      <div className="bg-white/5 rounded-xl xl:rounded-2xl p-2.5 xl:p-3">
                        <p className="text-white/50 text-[9px] font-black uppercase tracking-widest mb-1">{language === 'বাংলা' ? 'বাকি' : 'Outstanding'}</p>
                        <p className="text-lg xl:text-xl font-black text-orange-400 tracking-tight tabular-nums">{formatBDT(sm.outstandingTotal)}</p>
                        <p className="text-[9px] text-white/60 font-bold mt-1">
                          <span className={sm.overdueCount > 0 ? 'text-red-300' : 'text-white/60'}>
                            {sm.overdueCount} {language === 'বাংলা' ? 'বকেয়া' : 'overdue'}
                          </span>
                        </p>
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-white/50 text-[9px] font-black uppercase tracking-widest">{language === 'বাংলা' ? 'কালেকশন রেট' : 'Collection Rate'}</span>
                        <span className="text-xs font-black text-white tabular-nums">{collectedPct}%</span>
                      </div>
                      <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-green-400 to-emerald-300 transition-all duration-700"
                             style={{ width: `${collectedPct}%` }} />
                      </div>
                    </div>
                  </div>
                </div>

                {sm.overdueTenants.length > 0 && (
                  <div className="bg-white rounded-2xl xl:rounded-[2rem] p-4 xl:p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)] border-none shrink-0">
                    <div className="flex items-center justify-between mb-3 xl:mb-4">
                      <h4 className="text-[11px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                        <AlertCircle size={14} className="text-red-500" />
                        {language === 'বাংলা' ? 'বকেয়া ভাড়াটিয়া' : 'Overdue Tenants'}
                      </h4>
                      <span className="bg-red-50 text-red-600 px-2.5 py-1 rounded-lg text-xs font-black tabular-nums">{sm.overdueTenants.length}</span>
                    </div>
                    <div className="space-y-2">
                      {sm.overdueTenants.slice(0, 4).map(b => (
                        <div key={b.id} className="flex items-center justify-between gap-2 p-2 rounded-xl hover:bg-gray-50 transition-colors">
                          <button onClick={() => setExpandedRentId(b.id)} className="flex items-center gap-2.5 min-w-0 flex-1 text-left">
                            <div className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center text-[10px] font-black shrink-0">{b.tenantInit}</div>
                            <div className="min-w-0">
                              <p className="text-[11px] font-black text-gray-900 truncate">{b.tenant}</p>
                              <p className="text-[9px] font-bold text-gray-500 truncate tabular-nums">{formatBDT(b.monthlyRent)} · {b.property}</p>
                            </div>
                          </button>
                          <button onClick={() => sendRentReminder(b, sm.key)} className="shrink-0 p-2 rounded-lg bg-orange-50 text-orange-600 hover:bg-orange-100 transition-colors" title="Send reminder">
                            <BellRing size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="bg-white rounded-2xl xl:rounded-[2rem] p-4 xl:p-5 shadow-[0_4px_20px_rgba(0,0,0,0.02)] border-none shrink-0">
                  <h4 className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-3">{language === 'বাংলা' ? 'লেজেন্ড' : 'Legend'}</h4>
                  <div className="grid grid-cols-2 gap-y-2 gap-x-3 text-[10px] font-bold text-gray-600">
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-md bg-blue-500 inline-block"></span>{language === 'বাংলা' ? 'পেইড' : 'Paid'}</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-md bg-amber-400 inline-block"></span>{language === 'বাংলা' ? 'আংশিক' : 'Partial'}</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-md bg-red-500 inline-block"></span>{language === 'বাংলা' ? 'বকেয়া' : 'Overdue'}</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-md bg-orange-400 inline-block"></span>{language === 'বাংলা' ? 'শীঘ্রই' : 'Due soon'}</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-md bg-gray-100 inline-block"></span>{language === 'বাংলা' ? 'আসন্ন' : 'Upcoming'}</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-md bg-gray-50 inline-block border border-dashed border-gray-300"></span>{language === 'বাংলা' ? 'লিজের বাইরে' : 'Outside'}</span>
                  </div>
                </div>
              </aside>

              {/* ── RIGHT MAIN — main IS the scroll container; sticky toolbar pins inside it ── */}
              <main className="xl:col-span-8 w-full xl:h-full xl:overflow-y-auto custom-scrollbar pb-24 xl:pr-3 min-w-0">

                {/* Sticky toolbar — ONE row. Title is a tiny chip in the corner;
                    search + year stepper + filter pills + Export share the
                    same sticky line. */}
                <div className="sticky top-0 z-30 bg-gray-50/85 backdrop-blur-md -mx-3 sm:-mx-4 xl:mx-0 px-3 sm:px-4 xl:px-0 pt-2 pb-3 mb-2 xl:pt-1">
                  <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap xl:flex-nowrap">
                    {/* Title corner chip — small, gray, with live count. */}
                    <span className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/70 text-[9px] xl:text-[10px] font-black text-gray-700 uppercase tracking-widest shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                      <Wallet size={11} className="text-emerald-600"/>
                      <span className="hidden sm:inline">{language === 'বাংলা' ? 'রেন্ট' : 'Rent'}</span>
                      <span className="text-gray-400 tabular-nums">{filteredBookings.length}</span>
                    </span>
                    {/* Year stepper — pin to corner of toolbar. */}
                    <div className="shrink-0 flex items-center gap-1 bg-white rounded-xl px-1 py-1 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
                      <button onClick={() => setLedgerYear(y => y - 1)} className="p-1 rounded-lg hover:bg-gray-50 text-gray-400 hover:text-gray-700 transition-colors"><ChevronLeft size={12}/></button>
                      <span className="text-[11px] font-black text-gray-900 tabular-nums w-10 text-center">{ledgerYear}</span>
                      <button onClick={() => setLedgerYear(y => y + 1)} className="p-1 rounded-lg hover:bg-gray-50 text-gray-400 hover:text-gray-700 transition-colors"><ChevronRight size={12}/></button>
                    </div>
                    {/* Search input. */}
                    <div className="relative flex-1 min-w-[120px] xl:max-w-[220px] order-3 sm:order-none basis-full sm:basis-auto">
                      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      <input
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={language === 'বাংলা' ? 'খুঁজুন...' : 'Search tenants...'}
                        className="w-full pl-7 pr-2 py-2 rounded-xl bg-white text-[11px] font-bold text-gray-900 shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-transparent focus:border-gray-200 focus:outline-none placeholder:text-gray-400"
                      />
                    </div>
                    {/* Priority pills — horizontal scroll on narrow viewports. */}
                    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar flex-1 xl:flex-none order-2 sm:order-none min-w-0">
                      {[
                        { k: 'all',      label: language === 'বাংলা' ? 'সকল' : 'All',        cls: 'bg-gray-900 text-white' },
                        { k: 'overdue',  label: language === 'বাংলা' ? 'বকেয়া' : 'Overdue',  cls: 'bg-rose-600 text-white' },
                        { k: 'partial',  label: language === 'বাংলা' ? 'আংশিক' : 'Partial',  cls: 'bg-amber-500 text-white' },
                        { k: 'upcoming', label: language === 'বাংলা' ? 'আসন্ন' : 'Upcoming', cls: 'bg-orange-500 text-white' },
                        { k: 'cleared',  label: language === 'বাংলা' ? 'ক্লিয়ার্ড' : 'Cleared', cls: 'bg-emerald-600 text-white' },
                      ].map(pill => (
                        <button
                          key={pill.k}
                          onClick={() => setRentPriorityFilter(pill.k)}
                          className={`shrink-0 px-2.5 sm:px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap inline-flex items-center gap-1 ${rentPriorityFilter === pill.k ? `${pill.cls} shadow-[0_2px_8px_rgba(0,0,0,0.15)]` : 'bg-white text-gray-500 hover:text-gray-900 shadow-[0_2px_6px_rgba(0,0,0,0.03)]'}`}
                        >
                          {pill.label}
                          {pill.k !== 'all' && counts[pill.k] > 0 && <span className={`tabular-nums ${rentPriorityFilter === pill.k ? 'opacity-90' : 'opacity-60'}`}>·{counts[pill.k]}</span>}
                        </button>
                      ))}
                    </div>
                    {/* Export action — corner-pinned. */}
                    <button
                      onClick={() => showToast(language === 'বাংলা' ? 'এক্সপোর্ট হচ্ছে...' : 'Exporting...')}
                      className="shrink-0 px-3 py-2 bg-white text-gray-700 rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-[10px] font-black uppercase tracking-widest hover:bg-gray-50 transition-all flex items-center gap-1.5 active:scale-95 order-1 sm:order-none ml-auto sm:ml-0"
                    >
                      <FileSpreadsheet size={12}/> <span className="hidden sm:inline">{language === 'বাংলা' ? 'এক্সপোর্ট' : 'Export'}</span>
                    </button>
                  </div>
                </div>

                {/* List — compact rows. forceOpen auto-engages when filtered
                    list is ≤5; small portfolios get a fully-readable static
                    layout instead of accordion friction. */}
                {(() => {
                  const AUTO_EXPAND_THRESHOLD = 5;
                  const forceOpen = filteredBookings.length > 0 && filteredBookings.length <= AUTO_EXPAND_THRESHOLD;
                  if (filteredBookings.length === 0) {
                    return (
                      <div className="text-center py-20 bg-white rounded-2xl shadow-[0_2px_10px_rgba(0,0,0,0.02)] border-none">
                        <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                           <Receipt className="text-gray-300" size={26} />
                        </div>
                        <h3 className="text-sm font-black text-gray-900">{language === 'বাংলা' ? 'এই ফিল্টারে কোনো ভাড়াটিয়া পাওয়া যায়নি।' : 'No tenants match this filter.'}</h3>
                      </div>
                    );
                  }
                  return (
                    <div className="space-y-2">
                      {rentPriorityFilter === 'all' && attentionRent.length > 0 ? (
                        <>
                          <div className="flex items-center gap-2 mt-1 px-1 pt-1">
                            <AlertCircle size={12} className="text-rose-600 shrink-0"/>
                            <span className="text-[10px] font-black text-rose-700 uppercase tracking-widest">
                              {language === 'বাংলা' ? 'এখনই দরকার' : 'Needs Attention'} · {attentionRent.length}
                            </span>
                            <div className="flex-1 h-px bg-rose-200/60"/>
                          </div>
                          {attentionRent.map(b => renderRentRow(b, forceOpen))}
                          {otherRent.length > 0 && (
                            <div className="flex items-center gap-2 px-1 pt-3 pb-1">
                              <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                                {language === 'বাংলা' ? 'অন্যান্য' : 'All Other Tenants'} · {otherRent.length}
                              </span>
                              <div className="flex-1 h-px bg-gray-200"/>
                            </div>
                          )}
                          {otherRent.map(b => renderRentRow(b, forceOpen))}
                        </>
                      ) : (
                        filteredBookings.map(b => renderRentRow(b, forceOpen))
                      )}
                    </div>
                  );
                })()}
              </main>

            </div>
          </div>
          );
        })()}

        {/* 🔴 PROPERTIES GRID (Only for 'properties' tab) */}
        {activeTab === 'properties' && (
          <div className="animate-in fade-in zoom-in-95 duration-500">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 md:mb-6 mt-2">
               <h3 className="text-xl md:text-2xl font-black text-gray-900 tracking-tight">
                 {t?.allProperties || (language === 'বাংলা' ? 'সকল প্রপার্টি' : 'All Properties')}
                 <span className="ml-2 text-[13px] font-bold text-gray-400">({filteredPropertiesByStatus.length})</span>
               </h3>
               <div className="flex items-center gap-2 w-full sm:w-auto">
                 <div className="flex bg-white p-1 rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] gap-0.5 flex-1 sm:flex-none overflow-x-auto">
                   {[
                     { key: 'all', label: language === 'বাংলা' ? 'সকল' : 'All' },
                     { key: 'active', label: language === 'বাংলা' ? 'অ্যাক্টিভ' : 'Active' },
                     { key: 'paused', label: language === 'বাংলা' ? 'পজড' : 'Paused' },
                     { key: 'rented', label: language === 'বাংলা' ? 'ভাড়া হয়েছে' : 'Rented' },
                   ].map(f => (
                     <button key={f.key} onClick={() => setPropertyFilter(f.key)} className={`px-3 py-2 rounded-lg text-[10px] font-black capitalize transition-all whitespace-nowrap ${propertyFilter === f.key ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'}`}>
                       {f.label}
                     </button>
                   ))}
                 </div>
                 <button onClick={() => showToast(language === 'বাংলা' ? 'সর্ট হচ্ছে!' : 'Sorted!')} className="flex items-center gap-1.5 px-3 py-2.5 bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] text-[10px] font-black text-gray-600 transition-all hover:bg-gray-50 shrink-0"><ArrowUpDown size={13} /> {t?.sort || (language === 'বাংলা' ? 'সর্ট' : 'Sort')}</button>
               </div>
            </div>

	            {isPropertiesLoading && properties.length === 0 ? (
	              <div className="text-center py-20 bg-white rounded-[2rem] shadow-[0_4px_15px_rgba(0,0,0,0.02)]">
	                <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-5">
	                  <RefreshCw className="text-[#ba0036] animate-spin" size={32} />
	                </div>
	                <h3 className="text-lg font-black text-gray-900">
	                  {language === 'বাংলা' ? 'আপনার বাসাগুলো লোড হচ্ছে...' : 'Loading your properties...'}
	                </h3>
	                <p className="text-xs font-bold text-gray-500 mt-2">
	                  {language === 'বাংলা' ? 'সার্ভার জেগে উঠলে এগুলো এখানে দেখা যাবে।' : 'This can take a moment if the server is waking up.'}
	                </p>
	              </div>
	            ) : propertyLoadError && properties.length === 0 ? (
	              <div className="text-center py-20 bg-white rounded-[2rem] border border-red-100 shadow-[0_4px_15px_rgba(0,0,0,0.02)]">
	                <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-5">
	                  <AlertCircle className="text-[#ba0036]" size={32} />
	                </div>
	                <h3 className="text-lg font-black text-gray-900">
	                  {language === 'বাংলা' ? 'প্রপার্টি লোড করা যায়নি' : 'Could not load properties'}
	                </h3>
	                <p className="text-xs font-bold text-gray-500 mt-2 max-w-md mx-auto">{propertyLoadError}</p>
	                <button
	                  onClick={retryLoadProperties}
	                  className="mt-5 inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#ba0036] text-white text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all"
	                >
	                  <RefreshCw size={13} />
	                  {language === 'বাংলা' ? 'আবার চেষ্টা করুন' : 'Retry'}
	                </button>
	              </div>
	            ) : filteredPropertiesByStatus.length === 0 ? (
	              <div className="text-center py-20 bg-white rounded-[2rem] shadow-[0_4px_15px_rgba(0,0,0,0.02)]">
	                <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-5"><Search className="text-gray-300" size={32} /></div>
	                <h3 className="text-lg font-black text-gray-900">{t?.noPropsFound || (language === 'বাংলা' ? 'কোনো বাসা পাওয়া যায়নি।' : 'No properties found.')}</h3>
              </div>
            ) : (
              // Single-column on mobile so each card reads like a homepage
              // listing card. 2-up from sm:, 3-up from lg:.
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5 lg:gap-8">
                {filteredPropertiesByStatus.map((prop) => {
                  const gallery = Array.isArray(prop.images) ? prop.images.filter(Boolean) : [];
                  const coverImg = prop.img || gallery[0] || '';
                  const thumbs = gallery.length > 1 ? gallery.slice(1, 4) : [];
                  const hasSpecs = prop.beds || prop.baths || prop.sqft || prop.furnishing;
                  const ownerLabel = prop.ownerName || userData.fullName;
                  const ownerInitials = (ownerLabel || 'H')
                    .split(' ')
                    .map(s => s.charAt(0))
                    .join('')
                    .slice(0, 2)
                    .toUpperCase();
                  return (
                  <div key={prop.id} className="bg-white rounded-[1.5rem] md:rounded-[2rem] p-3 shadow-[0_4px_15px_rgba(0,0,0,0.02)] hover:shadow-[0_15px_35px_rgba(0,0,0,0.06)] transition-all duration-500 group flex flex-col cursor-default">
                    {/* Cover + side-thumbnail strip (listing-card style) */}
                    <div className="relative h-52 sm:h-56 lg:h-64 overflow-hidden bg-gray-100 rounded-[1.2rem] md:rounded-[1.5rem]">
                      {thumbs.length > 0 ? (
                        <div className="absolute inset-0 flex gap-1.5">
                          <div className="relative w-[72%] h-full overflow-hidden">
                            <img
                              src={coverImg}
                              alt={prop.title}
                              className="w-full h-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] group-hover:scale-105"
                            />
                          </div>
                          <div className="w-[28%] h-full flex flex-col gap-1.5">
                            {thumbs.map((src, i) => (
                              <div key={i} className="relative flex-1 overflow-hidden bg-gray-200">
                                <img src={src} alt="" className="w-full h-full object-cover" />
                                {i === 2 && gallery.length > 4 && (
                                  <div className="absolute inset-0 bg-[#ba0036]/85 backdrop-blur-sm flex items-center justify-center text-white text-xs font-black">
                                    +{gallery.length - 4}
                                  </div>
                                )}
                              </div>
                            ))}
                            {Array.from({ length: Math.max(0, 3 - thumbs.length) }, (_, i) => (
                              <div key={`pad-${i}`} className="flex-1 bg-gray-100" />
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div
                          className="absolute inset-0 bg-cover bg-center transition-transform duration-[2s] ease-[cubic-bezier(0.25,0.46,0.45,0.94)] group-hover:scale-105"
                          style={{ backgroundImage: `url(${coverImg})` }}
                        />
                      )}
                      <div className="absolute top-3 left-3 flex gap-2 z-10">
                        <div className="bg-white/95 backdrop-blur-md px-3 py-1.5 md:px-4 md:py-2 rounded-full text-[9px] md:text-[10px] font-black uppercase tracking-widest shadow-sm flex items-center gap-1.5">
                          {prop.status === 'active' ? (
                            <span className="text-green-600 flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>{t?.activeStatus || (language === 'বাংলা' ? 'অ্যাক্টিভ' : 'ACTIVE')}</span>
                          ) : prop.status === 'paused' ? (
                            <span className="text-orange-500 flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-orange-500"></div>{t?.pausedStatus || (language === 'বাংলা' ? 'পজড' : 'PAUSED')}</span>
                          ) : (
                            <span className="text-gray-500">{t?.rentedStatus || (language === 'বাংলা' ? 'ভাড়া হয়েছে' : 'RENTED')}</span>
                          )}
                        </div>
                        {isRecent(prop.addedDate) && (
                          <div className="bg-[#ba0036] px-3 py-1.5 md:px-4 md:py-2 rounded-full text-[9px] md:text-[10px] font-black uppercase tracking-widest shadow-sm text-white flex items-center animate-pulse">
                            {language === 'বাংলা' ? 'নতুন' : 'NEW'}
                          </div>
                        )}
                      </div>
                      <div className="absolute bottom-3 right-3 bg-gray-900/90 backdrop-blur-xl px-4 py-2 md:px-5 md:py-2.5 rounded-[1rem] md:rounded-[1.2rem] font-black text-white shadow-lg text-sm md:text-[15px] z-10">
                        ৳ {prop.price}
                      </div>
                    </div>

                    {/* Body */}
                    <div className="px-3 md:px-4 py-4 md:py-5 flex-1 flex flex-col">
                      <h4 className="text-base md:text-[19px] font-black text-gray-900 mb-1.5 leading-tight group-hover:text-[#ba0036] transition-colors line-clamp-1">{prop.title}</h4>
                      <p className="text-[11px] md:text-xs font-bold text-gray-500 flex items-center gap-1.5 mb-3"><MapPin size={12} className="text-[#ba0036]" /> {prop.location}</p>

                      {hasSpecs && (
                        <div className="flex items-center flex-wrap gap-1.5 md:gap-2 mb-3">
                          {prop.beds ? (
                            <span className="inline-flex items-center gap-1 bg-gray-50 border border-gray-100 px-2.5 py-1 rounded-full text-[10px] font-black text-gray-700">
                              <Bed size={11} className="text-[#ba0036]"/> {prop.beds} {language === 'বাংলা' ? 'বেড' : 'Beds'}
                            </span>
                          ) : null}
                          {prop.baths ? (
                            <span className="inline-flex items-center gap-1 bg-gray-50 border border-gray-100 px-2.5 py-1 rounded-full text-[10px] font-black text-gray-700">
                              <Bath size={11} className="text-[#ba0036]"/> {prop.baths} {language === 'বাংলা' ? 'বাথ' : 'Baths'}
                            </span>
                          ) : null}
                          {prop.sqft ? (
                            <span className="inline-flex items-center gap-1 bg-gray-50 border border-gray-100 px-2.5 py-1 rounded-full text-[10px] font-black text-gray-700">
                              <Maximize2 size={11} className="text-[#ba0036]"/> {Number(prop.sqft).toLocaleString('en-IN')} {language === 'বাংলা' ? 'বর্গফুট' : 'sqft'}
                            </span>
                          ) : null}
                          {prop.furnishing ? (
                            <span className="inline-flex items-center gap-1 bg-gray-50 border border-gray-100 px-2.5 py-1 rounded-full text-[10px] font-black text-gray-700">
                              <Sofa size={11} className="text-[#ba0036]"/> {prop.furnishing}
                            </span>
                          ) : null}
                        </div>
                      )}

                      {/* Landlord row */}
                      <div className="flex items-center gap-2 mb-4 pt-3 border-t border-gray-50">
                        <div className="w-9 h-9 rounded-full bg-[#ba0036]/10 text-[#ba0036] flex items-center justify-center font-black text-[11px] shrink-0">
                          {ownerInitials}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[11px] font-black text-gray-900 truncate">{ownerLabel}</p>
                          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'হোস্ট' : 'Listed by host'}</p>
                        </div>
                      </div>

                      <div className="mt-auto flex flex-wrap lg:flex-nowrap gap-2">
                         <button onClick={() => openModal('edit', prop)} className="flex-1 flex items-center justify-center gap-1.5 bg-gray-50 hover:bg-gray-100 text-gray-700 py-2.5 md:py-3 rounded-xl text-[9px] md:text-[10px] font-black uppercase tracking-wider transition-all active:scale-95"><Edit3 size={12} /> {t?.editBtn || (language === 'বাংলা' ? 'এডিট' : 'Edit')}</button>
                         {prop.status !== 'rented' ? (
                           <>
                             <button onClick={() => togglePropertyStatus(prop.id)} className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 md:py-3 rounded-xl text-[9px] md:text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 ${prop.status === 'paused' ? 'bg-orange-500 text-white hover:bg-orange-600 shadow-md shadow-orange-500/20' : 'bg-gray-50 hover:bg-gray-100 text-gray-700'}`}>
                               {prop.status === 'paused' ? <><PlayCircle size={12}/> {t?.resumeBtn || (language === 'বাংলা' ? 'চালু' : 'Resume')}</> : <><PauseCircle size={12}/> {t?.pauseBtn || (language === 'বাংলা' ? 'পজ' : 'Pause')}</>}
                             </button>
                             <button onClick={() => setActiveTab('inquiries')} className="w-full lg:flex-1 flex items-center justify-center gap-1.5 bg-[#ba0036] hover:bg-[#90002a] text-white py-2.5 md:py-3 rounded-xl text-[9px] md:text-[10px] font-black uppercase tracking-wider transition-all relative shadow-[0_6px_15px_rgba(186,0,54,0.25)] active:scale-95">
                               {t?.inquiriesBtn || (language === 'বাংলা' ? 'যোগাযোগ' : 'Inquiries')}
                               {prop.inquiries > 0 && <span className="absolute -top-1.5 -right-1.5 bg-gray-900 text-white text-[8px] md:text-[9px] w-4 h-4 md:w-5 md:h-5 flex items-center justify-center rounded-full shadow-sm border-2 border-white">{prop.inquiries}</span>}
                             </button>
                           </>
                         ) : (
                           <button onClick={() => openModal('lease', prop)} className="flex-[2] flex items-center justify-center gap-1.5 bg-blue-50 hover:bg-blue-100 text-blue-600 py-2.5 md:py-3 rounded-xl text-[9px] md:text-[10px] font-black uppercase tracking-wider transition-all active:scale-95"><FileText size={12} /> {t?.viewLeaseBtn || (language === 'বাংলা' ? 'লিজ দেখুন' : 'View Lease')}</button>
                         )}
                         <button
                           onClick={() => handleDeleteProperty(prop)}
                           aria-label={language === 'বাংলা' ? `${prop.title} মুছুন` : `Delete ${prop.title}`}
                           className="flex items-center justify-center gap-1.5 bg-gray-50 hover:bg-red-50 text-gray-400 hover:text-red-500 py-2.5 md:py-3 px-3 rounded-xl text-[9px] md:text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ba0036]"
                           title={language === 'বাংলা' ? 'প্রপার্টি মুছুন' : 'Delete property'}
                         >
                           <Trash2 size={13} />
                         </button>
                      </div>
                    </div>
                  </div>
                  );
                })}
      </div>
            )}
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────────
            🔴 NEW TABS (Smart Alerts, AI Insights, Settings, Support)
            ───────────────────────────────────────────────────────────────── */}
        {activeTab === 'smartAlerts' && (
          <div className="w-full h-[calc(100vh-120px)] animate-in fade-in zoom-in-95 duration-500 overflow-y-auto">
             <Smartalertspage />
          </div>
        )}

        {activeTab === 'aiInsights' && (
          <div className="w-full h-[calc(100vh-120px)] animate-in fade-in zoom-in-95 duration-500 overflow-y-auto">
             <Aiinsightspage />
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="w-full animate-in fade-in zoom-in-95 duration-500">
             <SharedSettings />
          </div>
        )}

        {activeTab === 'support' && (
          <div className="w-full animate-in fade-in zoom-in-95 duration-500">
             <SharedSupport />
          </div>
        )}

      </main>

      {/* 🔴 DYNAMIC MODALS */}
      {activeModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-md animate-in fade-in">
          <div className="bg-white rounded-[2rem] w-full max-w-md shadow-[0_30px_60px_rgba(0,0,0,0.15)] overflow-hidden relative animate-in zoom-in-95 duration-300">
            
            <div className="px-6 py-5 flex justify-between items-center bg-gray-50">
              <h3 className="text-xl font-black text-gray-900 capitalize">
                {activeModal === 'select_year' && (language === 'বাংলা' ? 'বছর নির্বাচন করুন' : 'Select Year')}
                {activeModal === 'full_report' && (language === 'বাংলা' ? 'পূর্ণাঙ্গ রিপোর্ট' : 'Full Report')}
                {activeModal === 'update_inquiry' && (language === 'বাংলা' ? 'ইনকোয়ারি স্ট্যাটাস' : 'Inquiry Status')}
                {activeModal === 'create_lease' && (language === 'বাংলা' ? 'নতুন লিজ তৈরি করুন' : 'Create New Lease')}
                {activeModal === 'edit' && (t?.editPropertyTitle || (language === 'বাংলা' ? 'প্রপার্টি এডিট করুন' : 'Edit Property'))}
                {activeModal === 'lease' && (t?.leaseAgreementTitle || (language === 'বাংলা' ? 'লিজ এগ্রিমেন্ট' : 'Lease Agreement'))}
                {activeModal === 'settings' && (t?.accountSettingsTitle || (language === 'বাংলা' ? 'অ্যাকাউন্ট সেটিংস' : 'Account Settings'))}
                {activeModal === 'support' && (t?.helpSupportTitle || (language === 'বাংলা' ? 'হেল্প এবং সাপোর্ট' : 'Help & Support'))}
                {activeModal === 'upload_document' && (language === 'বাংলা' ? 'ডকুমেন্ট আপলোড' : 'Upload Document')}
                {activeModal === 'message_all' && (language === 'বাংলা' ? 'ব্রডকাস্ট মেসেজ' : 'Broadcast Message')}
                {activeModal === 'export_report' && (language === 'বাংলা' ? 'রিপোর্ট এক্সপোর্ট' : 'Export Report')}
                {activeModal === 'send_reminders' && (language === 'বাংলা' ? 'পেমেন্ট রিমাইন্ডার' : 'Payment Reminders')}
                {activeModal === 'download_user_document' && (language === 'বাংলা' ? 'ভাড়াটিয়ার ডকুমেন্ট' : 'Tenant Documents')}
                {activeModal === 'confirm_delete' && (language === 'বাংলা' ? 'প্রপার্টি মুছুন' : 'Delete Property')}
              </h3>
              <button onClick={() => setActiveModal(null)} className="p-2 bg-white hover:bg-red-50 hover:text-red-500 rounded-full transition-all shadow-sm"><X size={18} /></button>
            </div>

            {activeModal === 'confirm_delete' && deleteTarget && (
              <div className="p-6 space-y-5" role="alertdialog" aria-labelledby="delete-confirm-title" aria-describedby="delete-confirm-desc">
                {/* Property preview */}
                <div className="flex items-center gap-4 p-4 bg-red-50/60 border border-red-100 rounded-2xl">
                  {(deleteTarget.img || deleteTarget.coverPhoto) ? (
                    <img
                      src={deleteTarget.img || deleteTarget.coverPhoto}
                      alt=""
                      className="w-16 h-16 rounded-xl object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                      <Building2 size={24} className="text-red-300" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p id="delete-confirm-title" className="text-sm font-black text-gray-900 truncate">{deleteTarget.title}</p>
                    <p className="text-[10px] font-bold text-gray-500 flex items-center gap-1 mt-0.5"><MapPin size={10} className="text-[#ba0036]" /> {deleteTarget.location}</p>
                  </div>
                </div>

                {/* Warning */}
                <div id="delete-confirm-desc" className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <div className="flex items-start gap-2">
                    <AlertCircle size={16} className="text-amber-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-black text-amber-800">
                        {language === 'বাংলা' ? 'এই কাজটি পূর্বাবস্থায় ফেরানো যাবে না' : 'This action cannot be undone'}
                      </p>
                      <p className="text-[10px] font-bold text-amber-700 mt-1 leading-relaxed">
                        {language === 'বাংলা'
                          ? 'এই প্রপার্টির সাথে সম্পর্কিত সকল ইনকোয়ারি, বুকিং (চলমান লিজ সহ) এবং রসিদ সম্পূর্ণভাবে মুছে যাবে।'
                          : 'All related inquiries, bookings (including active leases), and receipts will be permanently removed.'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex gap-3 pt-1">
                  <button
                    onClick={() => { setActiveModal(null); setDeleteTarget(null); }}
                    className="flex-1 py-3.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-black uppercase tracking-widest transition-all active:scale-95"
                  >
                    {language === 'বাংলা' ? 'বাতিল' : 'Cancel'}
                  </button>
                  <button
                    onClick={confirmDeleteProperty}
                    className="flex-1 py-3.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all active:scale-95 shadow-[0_6px_15px_rgba(220,38,38,0.3)] flex items-center justify-center gap-2"
                  >
                    <Trash2 size={14} />
                    {language === 'বাংলা' ? 'মুছে ফেলুন' : 'Delete Permanently'}
                  </button>
                </div>
              </div>
            )}

            {activeModal === 'upload_document' && (
                <div className="space-y-5 p-6">
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'ফোল্ডার নির্বাচন করুন' : 'Select Folder'}</label>
                    <select className="w-full mt-1.5 p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(186,0,54,0.08)] border border-transparent focus:border-[#ba0036]/20 transition-all cursor-pointer appearance-none">
                      <option>{language === 'বাংলা' ? 'রেন্টাল এগ্রিমেন্ট' : 'Rental Agreements'}</option>
                      <option>{language === 'বাংলা' ? 'ভাড়াটিয়া NID / আইডি' : 'Tenant NID / IDs'}</option>
                      <option>{language === 'বাংলা' ? 'পেমেন্ট রেকর্ড' : 'Payment Records'}</option>
                      <option>{language === 'বাংলা' ? 'লিগ্যাল ডকুমেন্টস' : 'Legal Documents'}</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">{language === 'বাংলা' ? 'ফাইল সিলেক্ট করুন' : 'Choose File'}</label>
                    <div className="border-2 border-dashed border-gray-200 hover:border-[#ba0036] hover:bg-red-50/30 rounded-2xl p-8 flex flex-col items-center justify-center text-center transition-all cursor-pointer group">
                       <UploadCloud size={32} className="text-gray-400 group-hover:text-[#ba0036] mb-3 transition-colors" />
                       <p className="text-sm font-black text-gray-900 mb-1">{language === 'বাংলা' ? 'পিডিএফ বা ছবি আপলোড করুন' : 'Upload PDF or Image'}</p>
                       <p className="text-[10px] text-gray-500 font-bold">{language === 'বাংলা' ? 'সর্বোচ্চ সাইজ: 10MB' : 'Max size: 10MB'}</p>
                    </div>
                  </div>

                  <button onClick={() => { showToast(language === 'বাংলা' ? 'ফাইল আপলোড হচ্ছে...' : 'Uploading File...'); setActiveModal(null); }} className="w-full mt-2 bg-gray-900 text-white py-4 rounded-xl font-black shadow-[0_8px_15px_rgba(0,0,0,0.1)] hover:bg-[#ba0036] transition-all text-sm flex items-center justify-center gap-2">
                    <Check size={18} /> {language === 'বাংলা' ? 'আপলোড কমপ্লিট করুন' : 'Complete Upload'}
                  </button>
                </div>
              )}
            
            <div className="p-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
              {activeModal === 'select_year' && (
                <div className="grid grid-cols-2 gap-3">
                  {['2023', '2024', '2025', '2026', '2027', '2028'].map(year => (
                     <button key={year} onClick={() => { showToast(language === 'বাংলা' ? `${year} সিলেক্ট করা হয়েছে` : `${year} Selected`); setActiveModal(null); }} className="py-4 bg-gray-50 hover:bg-blue-50 hover:text-blue-600 rounded-xl text-lg font-black text-gray-700 transition-all border border-gray-100 hover:border-blue-200">
                       {year}
                     </button>
                  ))}
                </div>
              )}

              {activeModal === 'send_reminders' && (() => {
                // Derive overdue / pending tenants from the live bookings state.
                // No hardcoded names — until a real lease is in arrears, the
                // host sees a clean "all caught up" panel.
                const overdueRows = bookings
                  .map(b => {
                    const summary = getMonthCollectionSummary(b);
                    const due = (summary.overdue || 0) + (summary.partial || 0);
                    return { booking: b, due };
                  })
                  .filter(r => r.due > 0);
                const totalDue = overdueRows.reduce((acc, r) => acc + r.due, 0);

                if (overdueRows.length === 0) {
                  return (
                    <div className="space-y-4">
                      <div className="bg-green-50 p-6 rounded-2xl border border-green-100 text-center">
                        <CheckCheck size={28} className="text-green-500 mx-auto mb-2" />
                        <p className="text-sm font-black text-green-700">
                          {language === 'বাংলা' ? 'সকল ভাড়া পরিশোধিত!' : 'All rents are up to date.'}
                        </p>
                        <p className="text-[10px] font-bold text-green-600 mt-1">
                          {language === 'বাংলা' ? 'এই মুহূর্তে রিমাইন্ডার পাঠানোর প্রয়োজন নেই।' : 'No reminders need to be sent right now.'}
                        </p>
                      </div>
                      <button
                        onClick={() => setActiveModal(null)}
                        className="w-full bg-gray-100 text-gray-700 py-3.5 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-gray-200 transition-all"
                      >
                        {language === 'বাংলা' ? 'বন্ধ করুন' : 'Close'}
                      </button>
                    </div>
                  );
                }

                return (
                  <div className="space-y-4">
                    <div className="bg-red-50 p-4 rounded-2xl border border-red-100 flex items-start gap-3">
                      <BellRing size={20} className="text-[#ba0036] shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-black text-[#ba0036]">
                          {language === 'বাংলা'
                            ? `${overdueRows.length} জন ভাড়াটিয়ার পেমেন্ট বকেয়া আছে`
                            : `${overdueRows.length} tenant(s) have pending dues`}
                        </p>
                        <p className="text-[10px] font-bold text-red-700 mt-0.5">
                          {language === 'বাংলা' ? 'মোট বকেয়া টাকার পরিমাণ: ' : 'Total pending amount: '}{formatBDT(totalDue)}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block">
                        {language === 'বাংলা' ? 'যাদের রিমাইন্ডার পাঠানো হবে' : 'Recipients'}
                      </label>
                      {overdueRows.map(({ booking, due }) => (
                        <div key={booking.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-xl border border-gray-100">
                          <div className="flex items-center gap-3">
                            <input type="checkbox" defaultChecked className="w-4 h-4 rounded text-[#ba0036] focus:ring-[#ba0036] cursor-pointer" />
                            <div>
                              <p className="text-xs font-black text-gray-900">{booking.tenant || booking.tenantName || '—'}</p>
                              <p className="text-[9px] font-bold text-gray-500">{language === 'বাংলা' ? 'বকেয়া: ' : 'Due: '}{formatBDT(due)}</p>
                            </div>
                          </div>
                          <span className="text-[10px] font-black text-orange-600 bg-orange-100 px-2 py-1 rounded">
                            {language === 'বাংলা' ? 'বকেয়া' : 'Pending'}
                          </span>
                        </div>
                      ))}
                    </div>

                    <button
                      onClick={() => {
                        showToast(language === 'বাংলা' ? 'অটোমেটেড SMS এবং ইমেইল পাঠানো হয়েছে!' : 'Automated SMS & Email Sent!');
                        setActiveModal(null);
                      }}
                      className="w-full mt-2 bg-gray-900 text-white py-4 rounded-xl font-black shadow-[0_8px_15px_rgba(0,0,0,0.1)] hover:bg-[#ba0036] hover:-translate-y-0.5 transition-all text-sm flex items-center justify-center gap-2"
                    >
                      <Send size={18} /> {language === 'বাংলা' ? 'SMS ও ইমেইল পাঠান' : 'Send SMS & Email'}
                    </button>
                  </div>
                );
              })()}

              {activeModal === 'export_report' && (
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'রিপোর্টের ধরন' : 'Report Type'}</label>
                    <select className="w-full mt-1.5 p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(249,115,22,0.08)] border border-transparent focus:border-orange-500/20 transition-all cursor-pointer appearance-none">
                      <option>{language === 'বাংলা' ? 'ফাইন্যান্সিয়াল ওভারভিউ (আয়-ব্যয়)' : 'Financial Overview (Income/Expense)'}</option>
                      <option>{language === 'বাংলা' ? 'ভাড়াটিয়া পেমেন্ট হিস্ট্রি' : 'Tenant Payment History'}</option>
                      <option>{language === 'বাংলা' ? 'অ্যাক্টিভ লিজ তালিকা' : 'Active Lease List'}</option>
                    </select>
                  </div>
                  
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'সময়কাল' : 'Date Range'}</label>
                    <select className="w-full mt-1.5 p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(249,115,22,0.08)] border border-transparent focus:border-orange-500/20 transition-all cursor-pointer appearance-none">
                      <option>{language === 'বাংলা' ? 'চলতি মাস' : 'This Month'}</option>
                      <option>{language === 'বাংলা' ? 'গত ৩ মাস' : 'Last 3 Months'}</option>
                      <option>{language === 'বাংলা' ? 'এই বছর (YTD)' : 'This Year (YTD)'}</option>
                    </select>
                  </div>

                  <div className="pt-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-2">{language === 'বাংলা' ? 'ফরম্যাট সিলেক্ট করে ডাউনলোড করুন' : 'Select Format to Download'}</label>
                    <div className="grid grid-cols-2 gap-3">
                      <button onClick={() => { showToast(language === 'বাংলা' ? 'PDF ডাউনলোড হচ্ছে...' : 'Downloading PDF...'); setActiveModal(null); }} className="py-4 bg-red-50 text-red-600 hover:bg-red-100 rounded-xl text-xs font-black transition-all border border-red-100 hover:border-red-200 flex flex-col items-center justify-center gap-1">
                        <FileText size={20} />
                        <span>PDF Format</span>
                      </button>
                      <button onClick={() => { showToast(language === 'বাংলা' ? 'Excel ডাউনলোড হচ্ছে...' : 'Downloading Excel...'); setActiveModal(null); }} className="py-4 bg-green-50 text-green-600 hover:bg-green-100 rounded-xl text-xs font-black transition-all border border-green-100 hover:border-green-200 flex flex-col items-center justify-center gap-1">
                        <FileSpreadsheet size={20} />
                        <span>Excel / CSV</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

             {activeModal === 'message_all' && (
                <div className="space-y-4">
                  <div className="bg-green-50/80 p-4 rounded-2xl border border-green-100 flex items-start gap-3">
                    <Megaphone size={20} className="text-green-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-black text-green-900">{language === 'বাংলা' ? 'সকল অ্যাক্টিভ ভাড়াটিয়াকে পাঠানো হচ্ছে' : 'Sending to all active tenants'}</p>
                      <p className="text-[10px] font-bold text-green-700 mt-0.5">{language === 'বাংলা' ? 'বর্তমানে ১২ জন ভাড়াটিয়া অ্যাক্টিভ আছেন।' : 'Currently 12 tenants are active.'}</p>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">{language === 'বাংলা' ? 'আপনার মেসেজ লিখুন' : 'Write your announcement'}</label>
                    <textarea 
                      rows="4" 
                      placeholder={language === 'বাংলা' ? 'যেমন: আগামীকাল সকাল ১০টা থেকে দুপুর ১২টা পর্যন্ত পানি সরবরাহ বন্ধ থাকবে...' : 'e.g. Water supply will be interrupted tomorrow from 10 AM to 12 PM...'} 
                      className="w-full p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(22,163,74,0.1)] border border-transparent focus:border-green-500/20 transition-all resize-none custom-scrollbar" 
                    />
                  </div>

                  <div>
                    <input 
                      type="file" 
                      id="broadcast-attachment" 
                      className="hidden" 
                      accept="image/*,.pdf" 
                      onChange={(e) => {
                        if(e.target.files && e.target.files.length > 0) {
                          showToast(language === 'বাংলা' ? `ফাইল যুক্ত হয়েছে: ${e.target.files[0].name}` : `Attachment added: ${e.target.files[0].name}`);
                        }
                      }} 
                    />
                    <label 
                      htmlFor="broadcast-attachment" 
                      className="inline-flex items-center gap-3 px-4 py-3 bg-gray-50 border border-gray-200 border-dashed rounded-xl text-[11px] font-black text-gray-600 hover:text-green-600 hover:bg-green-50 hover:border-green-300 transition-all cursor-pointer group w-full active:scale-95"
                    >
                      <div className="w-8 h-8 rounded-lg bg-white shadow-sm flex items-center justify-center text-gray-400 group-hover:text-green-500 transition-colors">
                        <UploadCloud size={16} />
                      </div>
                      <span className="flex-1 text-left">
                        {language === 'বাংলা' ? 'ছবি বা নোটিশ আপলোড করুন (ঐচ্ছিক)' : 'Upload Image or Notice (Optional)'}
                      </span>
                    </label>
                  </div>

                  <button 
                    onClick={() => { 
                      showToast(language === 'বাংলা' ? 'সবার কাছে মেসেজ পাঠানো হয়েছে!' : 'Broadcast message sent successfully!'); 
                      setActiveModal(null); 
                    }} 
                    className="w-full mt-2 bg-green-600 text-white py-4 rounded-xl font-black shadow-[0_8px_15px_rgba(22,163,74,0.2)] hover:bg-green-700 hover:-translate-y-0.5 hover:shadow-[0_12px_20px_rgba(22,163,74,0.3)] transition-all text-sm flex items-center justify-center gap-2"
                  >
                    <Send size={18} /> {language === 'বাংলা' ? 'সবার কাছে পাঠান' : 'Send to Everyone'}
                  </button>
                </div>
              )}

              {activeModal === 'download_user_document' && (() => {
                // No hardcoded tenant. Use the modalData if the caller passed
                // booking/property context, otherwise show a neutral header.
                const tenantName = modalData?.tenant || modalData?.tenantName || (language === 'বাংলা' ? 'ভাড়াটিয়া' : 'Tenant');
                const propTitle  = modalData?.propertyTitle || modalData?.title || (language === 'বাংলা' ? 'প্রপার্টি' : 'Property');
                const initials   = (tenantName.split(/\s+/).map(w => w[0]).slice(0, 2).join('') || '—').toUpperCase();
                return (
                  <div className="space-y-4">
                    <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 flex items-center gap-3 mb-2">
                      <div className="w-12 h-12 bg-blue-600 text-white rounded-xl flex items-center justify-center font-black text-lg shadow-inner">{initials}</div>
                      <div>
                        <p className="text-sm font-black text-gray-900">{tenantName}</p>
                        <p className="text-[10px] font-bold text-gray-500 mt-0.5">{propTitle}</p>
                      </div>
                    </div>

                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-2">
                    {language === 'বাংলা' ? 'ডকুমেন্ট নির্বাচন করে ডাউনলোড করুন' : 'Select Document to Download'}
                  </label>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => { showToast(language === 'বাংলা' ? 'লিজ এগ্রিমেন্ট ডাউনলোড হচ্ছে...' : 'Downloading Lease Agreement...'); setActiveModal(null); }} className="p-4 bg-gray-50 hover:bg-blue-50 border border-gray-100 hover:border-blue-200 rounded-xl text-left transition-all group active:scale-95">
                      <FileText size={20} className="text-blue-500 mb-2 group-hover:scale-110 transition-transform" />
                      <p className="text-xs font-black text-gray-900">{language === 'বাংলা' ? 'লিজ এগ্রিমেন্ট' : 'Lease Agreement'}</p>
                      <p className="text-[9px] font-bold text-gray-500 mt-0.5">PDF • 2.4 MB</p>
                    </button>
                    <button onClick={() => { showToast(language === 'বাংলা' ? 'NID কপি ডাউনলোড হচ্ছে...' : 'Downloading NID Copy...'); setActiveModal(null); }} className="p-4 bg-gray-50 hover:bg-green-50 border border-gray-100 hover:border-green-200 rounded-xl text-left transition-all group active:scale-95">
                      <ScanFace size={20} className="text-green-500 mb-2 group-hover:scale-110 transition-transform" />
                      <p className="text-xs font-black text-gray-900">{language === 'বাংলা' ? 'এনআইডি (NID) কপি' : 'NID Copy'}</p>
                      <p className="text-[9px] font-bold text-gray-500 mt-0.5">JPG • 1.1 MB</p>
                    </button>
                    <button onClick={() => { showToast(language === 'বাংলা' ? 'পেমেন্ট রেকর্ড ডাউনলোড হচ্ছে...' : 'Downloading Payment Records...'); setActiveModal(null); }} className="p-4 bg-gray-50 hover:bg-orange-50 border border-gray-100 hover:border-orange-200 rounded-xl text-left transition-all group active:scale-95">
                      <Receipt size={20} className="text-orange-500 mb-2 group-hover:scale-110 transition-transform" />
                      <p className="text-xs font-black text-gray-900">{language === 'বাংলা' ? 'পেমেন্ট রেকর্ড' : 'Payment Records'}</p>
                      <p className="text-[9px] font-bold text-gray-500 mt-0.5">PDF • 1.8 MB</p>
                    </button>
                    <button onClick={() => { showToast(language === 'বাংলা' ? 'ইন্সপেকশন রিপোর্ট ডাউনলোড হচ্ছে...' : 'Downloading Inspection Report...'); setActiveModal(null); }} className="p-4 bg-gray-50 hover:bg-purple-50 border border-gray-100 hover:border-purple-200 rounded-xl text-left transition-all group active:scale-95">
                      <ClipboardCheck size={20} className="text-purple-500 mb-2 group-hover:scale-110 transition-transform" />
                      <p className="text-xs font-black text-gray-900">{language === 'বাংলা' ? 'ইন্সপেকশন রিপোর্ট' : 'Inspection Report'}</p>
                      <p className="text-[9px] font-bold text-gray-500 mt-0.5">PDF • 3.5 MB</p>
                    </button>
                  </div>
                  <button onClick={() => setActiveModal(null)} className="w-full mt-2 bg-gray-100 text-gray-600 hover:bg-gray-200 py-3.5 rounded-xl font-black transition-all text-xs uppercase tracking-widest">
                    {language === 'বাংলা' ? 'বন্ধ করুন' : 'Close'}
                  </button>
                  </div>
                );
              })()}

              {activeModal === 'full_report' && (() => {
                // Derive tenant payment history from real bookings — no
                // hardcoded names. New hosts see an empty-state card.
                const rows = bookings.map(b => {
                  const expectedMonths = Array.isArray(b.ledgerKeys) ? b.ledgerKeys.length : 0;
                  const paidMonths = b.ledger
                    ? Object.values(b.ledger).filter(e => e?.paid && e?.status !== 'due').length
                    : 0;
                  const score = expectedMonths > 0 ? Math.round((paidMonths / expectedMonths) * 100) : 0;
                  let label, color;
                  if (score >= 90)      { label = language === 'বাংলা' ? `সঠিক সময়ে পেইড (${paidMonths}/${expectedMonths})` : `Paid on time (${paidMonths}/${expectedMonths})`; color = 'text-green-500'; }
                  else if (score >= 70) { label = language === 'বাংলা' ? `বিলম্বিত পেমেন্ট (${paidMonths}/${expectedMonths})` : `Late payments (${paidMonths}/${expectedMonths})`; color = 'text-orange-500'; }
                  else                  { label = language === 'বাংলা' ? `পেমেন্ট মিস (${paidMonths}/${expectedMonths})` : `Missed payments (${paidMonths}/${expectedMonths})`; color = 'text-red-500'; }
                  return { n: b.tenant || b.tenantName || '—', s: label, score, c: color };
                });
                return (
                  <div className="space-y-4">
                    <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
                      <h4 className="text-sm font-black text-blue-800 mb-1">{language === 'বাংলা' ? 'ভাড়াটিয়া পেমেন্ট হিস্ট্রি' : 'Tenant Payment History'}</h4>
                      <p className="text-[10px] font-bold text-blue-600">{language === 'বাংলা' ? 'গত ১২ মাসের বিস্তারিত রিপোর্ট' : 'Detailed report for the last 12 months'}</p>
                    </div>
                    {rows.length === 0 ? (
                      <div className="bg-gray-50 rounded-2xl p-8 text-center border border-gray-100">
                        <p className="text-xs font-black text-gray-600">
                          {language === 'বাংলা' ? 'এখনও কোনো ভাড়াটিয়া যোগ হয়নি।' : 'No tenants yet.'}
                        </p>
                        <p className="text-[10px] font-bold text-gray-400 mt-1">
                          {language === 'বাংলা' ? 'একটি লিজ তৈরি করলে পেমেন্ট হিস্ট্রি এখানে দেখাবে।' : 'Create a lease to see payment history here.'}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {rows.map((row, i) => (
                          <div key={i} className="flex justify-between items-center p-3 bg-gray-50 rounded-xl border border-gray-100">
                            <div>
                              <p className="text-xs font-black text-gray-900">{row.n}</p>
                              <p className="text-[9px] font-bold text-gray-500 mt-0.5">{row.s}</p>
                            </div>
                            <span className={`text-sm font-black ${row.c}`}>{row.score}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <button onClick={() => { showToast(language === 'বাংলা' ? 'রিপোর্ট ডাউনলোড হচ্ছে...' : 'Downloading Report...'); setActiveModal(null); }} className="w-full mt-4 bg-gray-900 text-white py-4 rounded-xl font-black shadow-[0_8px_15px_rgba(0,0,0,0.1)] hover:bg-[#ba0036] transition-all text-sm flex items-center justify-center gap-2">
                      <Download size={18} /> {language === 'বাংলা' ? 'ডাউনলোড পিডিএফ' : 'Download PDF'}
                    </button>
                  </div>
                );
              })()}
              
              {activeModal === 'update_inquiry' && modalData && (
                <div className="space-y-4">
                  <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 flex items-start gap-3">
                     <div className="bg-blue-100 w-10 h-10 rounded-full flex items-center justify-center text-blue-600 shrink-0 font-black">{modalData.init}</div>
                     <div>
                       <p className="text-sm font-black text-gray-900">{modalData.user}</p>
                       <p className="text-[11px] font-black text-gray-700 mt-0.5">{modalData.phone || (language === 'বাংলা' ? 'ফোন নেই' : 'No phone')}</p>
                       <p className="text-[10px] font-bold text-gray-500 mt-0.5">{modalData.propTitle}</p>
                     </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'বর্তমান স্ট্যাটাস' : 'Current Status'}</label>
                    <select value={inquiryStatusForm.status} onChange={e => setInquiryStatusForm(f => ({ ...f, status: e.target.value }))} className="w-full mt-1.5 p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(37,99,235,0.08)] border border-transparent focus:border-blue-500/20 transition-all cursor-pointer appearance-none">
                      <option value="new">{language === 'বাংলা' ? 'নতুন (New)' : 'New'}</option>
                      <option value="pending">{language === 'বাংলা' ? 'পেন্ডিং (Pending)' : 'Pending'}</option>
                      <option value="accepted">{language === 'বাংলা' ? 'গৃহীত (Accepted)' : 'Accepted'}</option>
                      <option value="rejected">{language === 'বাংলা' ? 'বাতিল (Rejected)' : 'Rejected'}</option>
                      <option value="archived">{language === 'বাংলা' ? 'আর্কাইভ (Archived)' : 'Archived'}</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'ভিজিটের তারিখ ও সময়' : 'Visit Date & Time'}</label>
                    <input type="datetime-local" value={inquiryStatusForm.visitDate} onChange={e => setInquiryStatusForm(f => ({ ...f, visitDate: e.target.value }))} className="w-full mt-1.5 p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(37,99,235,0.08)] border border-transparent focus:border-blue-500/20 transition-all" />
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'ফলো-আপ নোটস' : 'Follow-up Notes'}</label>
                    <textarea rows="3" value={inquiryStatusForm.notes} onChange={e => setInquiryStatusForm(f => ({ ...f, notes: e.target.value }))} placeholder={language === 'বাংলা' ? 'যেমন: শুক্রবার বিকেলে সপরিবারে বাসা দেখতে আসবে...' : 'e.g. Coming with family on Friday afternoon...'} className="w-full mt-1.5 p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(37,99,235,0.08)] border border-transparent focus:border-blue-500/20 transition-all resize-none custom-scrollbar" />
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 pt-2">
                    <button onClick={submitInquiryStatus} className="flex-[2] bg-blue-600 text-white py-4 rounded-xl font-black shadow-[0_8px_15px_rgba(37,99,235,0.2)] hover:-translate-y-0.5 hover:shadow-[0_12px_20px_rgba(37,99,235,0.3)] transition-all text-sm">
                      {language === 'বাংলা' ? 'আপডেট সেভ করুন' : 'Save Details'}
                    </button>
                    <button onClick={() => setActiveModal('create_lease')} className="flex-[1] bg-green-50 text-green-700 py-4 rounded-xl font-black hover:bg-green-100 transition-all text-xs border border-green-200 flex flex-col items-center justify-center leading-tight">
                      <span>{language === 'বাংলা' ? 'ডিল ডান?' : 'Deal Done?'}</span>
                      <span className="text-[9px] uppercase tracking-wider">{language === 'বাংলা' ? 'লিজ তৈরি করুন' : 'Create Lease'}</span>
                    </button>
                  </div>
                </div>
              )}

              {activeModal === 'create_lease' && (
                <div className="space-y-4">
                  <div className="bg-blue-50/80 p-4 rounded-2xl border border-blue-100 mb-2">
                    <p className="text-[11px] font-bold text-blue-800 flex items-start gap-2 leading-relaxed">
                      <CheckCircle2 size={16} className="text-blue-600 shrink-0 mt-0.5" />
                      {language === 'বাংলা'
                        ? 'লিজ তৈরি হলে প্রপার্টিটি "Rented" মার্ক হবে এবং রেন্ট লেজার চালু হবে।'
                        : 'On create, the property is marked "Rented" and a fresh rent ledger is initialised.'}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'ভাড়াটিয়ার নাম' : 'Tenant Name'}</label>
                      <input type="text" value={leaseForm.tenant} onChange={e => setLeaseForm(f => ({ ...f, tenant: e.target.value }))} placeholder={language === 'বাংলা' ? 'নাম লিখুন' : 'e.g. John Doe'} className="w-full mt-1.5 p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(186,0,54,0.08)] border border-transparent focus:border-[#ba0036]/20 transition-all" />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'ফোন নম্বর' : 'Tenant Phone'}</label>
                      <input type="tel" value={leaseForm.tenantPhone} onChange={e => setLeaseForm(f => ({ ...f, tenantPhone: e.target.value }))} placeholder="+880 1xxx xxxxxx" className="w-full mt-1.5 p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(186,0,54,0.08)] border border-transparent focus:border-[#ba0036]/20 transition-all" />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'প্রপার্টি' : 'Property'}</label>
                      <select value={leaseForm.propertyId} onChange={e => {
                        const id = Number(e.target.value);
                        const prop = properties.find(p => p.id === id);
                        setLeaseForm(f => ({ ...f, propertyId: id, property: prop?.title || '' }));
                      }} className="w-full mt-1.5 p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(186,0,54,0.08)] border border-transparent focus:border-[#ba0036]/20 transition-all">
                        <option value="">{language === 'বাংলা' ? 'প্রপার্টি সিলেক্ট করুন' : 'Select a property'}</option>
                        {properties.map(p => (<option key={p.id} value={p.id}>{p.title} · {p.location}</option>))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'লিজ শুরু' : 'Lease Start'}</label>
                      <input type="date" value={leaseForm.leaseStart} onChange={e => setLeaseForm(f => ({ ...f, leaseStart: e.target.value }))} className="w-full mt-1.5 p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(186,0,54,0.08)] border border-transparent focus:border-[#ba0036]/20 transition-all" />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'লিজ শেষ' : 'Lease End'}</label>
                      <input type="date" value={leaseForm.leaseEnd} onChange={e => setLeaseForm(f => ({ ...f, leaseEnd: e.target.value }))} className="w-full mt-1.5 p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(186,0,54,0.08)] border border-transparent focus:border-[#ba0036]/20 transition-all" />
                    </div>

                    <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'মাসিক ভাড়া (৳)' : 'Monthly Rent (BDT)'}</label>
                      <input type="number" min="0" value={leaseForm.monthlyRent} onChange={e => setLeaseForm(f => ({ ...f, monthlyRent: e.target.value }))} placeholder="85000" className="w-full mt-1.5 p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(186,0,54,0.08)] border border-transparent focus:border-[#ba0036]/20 transition-all" />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'প্রতি মাসের কত তারিখে?' : 'Rent Due Day'}</label>
                      <input type="number" min="1" max="31" value={leaseForm.rentDueDay} onChange={e => setLeaseForm(f => ({ ...f, rentDueDay: e.target.value }))} className="w-full mt-1.5 p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(186,0,54,0.08)] border border-transparent focus:border-[#ba0036]/20 transition-all" />
                    </div>

                    <div className="sm:col-span-2 bg-gray-50/80 p-4 rounded-2xl border border-gray-100">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <BellRing size={14} className="text-[#ba0036]" />
                          <span className="text-[11px] font-black text-gray-900">{language === 'বাংলা' ? 'অটো রিমাইন্ডার' : 'Auto Reminder'}</span>
                        </div>
                        <button type="button" onClick={() => setLeaseForm(f => ({ ...f, autoReminder: !f.autoReminder }))} className={`w-11 h-6 rounded-full relative transition-colors ${leaseForm.autoReminder ? 'bg-[#ba0036]' : 'bg-gray-300'}`}>
                          <div className={`w-4 h-4 bg-white rounded-full absolute top-1 shadow-sm transition-all ${leaseForm.autoReminder ? 'right-1' : 'left-1'}`}></div>
                        </button>
                      </div>
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'কত দিন আগে রিমাইন্ডার?' : 'Remind X days before due'}</label>
                      <input type="number" min="0" max="14" value={leaseForm.reminderLeadDays} onChange={e => setLeaseForm(f => ({ ...f, reminderLeadDays: e.target.value }))} className="w-full mt-1.5 p-3 bg-white rounded-xl text-sm font-bold text-gray-900 outline-none focus:shadow-[0_4px_15px_rgba(186,0,54,0.08)] border border-transparent focus:border-[#ba0036]/20 transition-all" />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'নোটস' : 'Notes (optional)'}</label>
                      <textarea rows="2" value={leaseForm.notes} onChange={e => setLeaseForm(f => ({ ...f, notes: e.target.value }))} placeholder={language === 'বাংলা' ? 'যেমন: ডিপোজিট পেইড, bKash এ পেমেন্ট...' : 'e.g. Deposit cleared, prefers bKash...'} className="w-full mt-1.5 p-3 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(186,0,54,0.08)] border border-transparent focus:border-[#ba0036]/20 transition-all resize-none" />
                    </div>
                  </div>

                  <button onClick={submitCreateLease} className="w-full mt-2 bg-green-600 text-white py-4 rounded-xl font-black shadow-[0_8px_15px_rgba(22,163,74,0.2)] hover:-translate-y-0.5 hover:shadow-[0_12px_20px_rgba(22,163,74,0.3)] transition-all text-sm flex items-center justify-center gap-2">
                    <Check size={18} /> {language === 'বাংলা' ? 'বুকিং তৈরি করুন' : 'Create Booking & Start Ledger'}
                  </button>
                </div>
              )}

              {/* ─ Rent Action modal — 2-step futuristic flow ───────────────
                  Step 1 (choose): three big choice cards — Full Payment,
                                   Partial / Due, or Mark as Due.
                  Step 2 (form):   tailored form for whichever choice was made.
                  Pushes a receipt into the tenant's localStorage on submit so
                  the tenant dashboard shows it instantly. */}
              {activeModal === 'mark_paid' && (() => {
                const booking = bookings.find(b => b.id === payForm.bookingId);
                if (!booking) return null;
                const due = getDueDate(payForm.monthKey, booking.rentDueDay);
                const expected = Number(booking.monthlyRent || 0);
                const amt = Number(payForm.amount) || 0;
                const balance = payForm.status === 'due' ? expected : Math.max(0, expected - amt);
                const existing = booking.ledger?.[payForm.monthKey];
                const isEditing = !!existing?.paid || existing?.status === 'due';

                // Per-status visual theme (drives the gradient header + pill colour).
                const theme = payForm.status === 'full'
                  ? { from: 'from-blue-500', to: 'to-indigo-600', soft: 'bg-blue-50 text-blue-700', accent: 'text-blue-600', ring: 'focus:border-blue-500/30 focus:shadow-[0_4px_15px_rgba(59,130,246,0.10)]' }
                  : payForm.status === 'partial'
                    ? { from: 'from-amber-500', to: 'to-orange-600', soft: 'bg-amber-50 text-amber-700', accent: 'text-amber-600', ring: 'focus:border-amber-500/30 focus:shadow-[0_4px_15px_rgba(251,191,36,0.10)]' }
                    : { from: 'from-rose-500', to: 'to-red-600', soft: 'bg-rose-50 text-rose-700', accent: 'text-rose-600', ring: 'focus:border-rose-500/30 focus:shadow-[0_4px_15px_rgba(244,63,94,0.10)]' };

                return (
                  <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200">
                    {/* ── Header — same on both steps so the host always sees who/what/when ── */}
                    <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${theme.from} ${theme.to} text-white p-4 shadow-[0_10px_30px_rgba(0,0,0,0.12)]`}>
                      <div className="absolute -top-10 -right-10 w-36 h-36 bg-white/10 rounded-full blur-3xl pointer-events-none"></div>
                      <div className="relative z-10 flex items-center gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center shrink-0 border border-white/20">
                          <span className="text-sm font-black tracking-tight">{booking.tenantInit || (booking.tenant?.[0] ?? '?')}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[9px] font-black uppercase tracking-[0.18em] text-white/70">{language === 'বাংলা' ? 'রেন্ট অ্যাকশন' : 'Rent Action'}</p>
                          <p className="text-base font-black truncate">{booking.tenant} · {booking.property}</p>
                          <p className="text-[10px] font-bold text-white/80 mt-0.5">
                            {monthFullLabel(payForm.monthKey, language)}
                            {' · '}{language === 'বাংলা' ? 'ডিউ' : 'Due'} {formatDate(due?.toISOString(), language)}
                            {' · '}{language === 'বাংলা' ? 'এক্সপেক্টেড' : 'Expected'} {formatBDT(expected)}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* ─────────────── STEP 1 — CHOICE SCREEN ─────────────── */}
                    {payForm.step === 'choose' && (
                      <>
                        <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest text-center pt-1">
                          {language === 'বাংলা' ? 'এই মাসের জন্য কী রেকর্ড করবেন?' : 'What do you want to record for this month?'}
                        </p>

                        <div className="grid grid-cols-1 gap-3">
                          {/* Full Payment */}
                          <button
                            type="button"
                            onClick={() => choosePayStatus('full')}
                            className="group relative text-left bg-gradient-to-br from-blue-50 to-indigo-50/40 hover:from-blue-100 hover:to-indigo-100/50 border border-blue-100 hover:border-blue-300 rounded-2xl p-5 transition-all hover:-translate-y-0.5 hover:shadow-[0_15px_30px_rgba(59,130,246,0.18)] active:scale-[0.99] overflow-hidden"
                          >
                            <div className="absolute -top-12 -right-12 w-32 h-32 bg-blue-200/30 rounded-full blur-3xl pointer-events-none group-hover:bg-blue-300/40 transition-colors"></div>
                            <div className="relative flex items-center gap-4">
                              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center shrink-0 shadow-[0_8px_20px_rgba(59,130,246,0.35)]">
                                <CheckCheck size={26} strokeWidth={3} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="text-[15px] font-black text-gray-900">{language === 'বাংলা' ? 'সম্পূর্ণ পেমেন্ট' : 'Full Payment'}</p>
                                  <span className="text-[8px] font-black text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded-md uppercase tracking-widest">{language === 'বাংলা' ? 'নীল টিক' : 'Blue Tick'}</span>
                                </div>
                                <p className="text-[11px] font-bold text-gray-500 mt-0.5 leading-snug">
                                  {language === 'বাংলা' ? `সম্পূর্ণ ${formatBDT(expected)} পেয়েছেন — ভাড়াটিয়াকে রিসিট চলে যাবে` : `Rent of ${formatBDT(expected)} received in full — receipt sent to tenant`}
                                </p>
                              </div>
                              <ArrowRight size={20} className="text-blue-500 shrink-0 group-hover:translate-x-1 transition-transform" />
                            </div>
                          </button>

                          {/* Partial / Due */}
                          <button
                            type="button"
                            onClick={() => choosePayStatus('partial')}
                            className="group relative text-left bg-gradient-to-br from-amber-50 to-orange-50/40 hover:from-amber-100 hover:to-orange-100/50 border border-amber-100 hover:border-amber-300 rounded-2xl p-5 transition-all hover:-translate-y-0.5 hover:shadow-[0_15px_30px_rgba(251,191,36,0.20)] active:scale-[0.99] overflow-hidden"
                          >
                            <div className="absolute -top-12 -right-12 w-32 h-32 bg-amber-200/40 rounded-full blur-3xl pointer-events-none group-hover:bg-amber-300/50 transition-colors"></div>
                            <div className="relative flex items-center gap-4">
                              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 text-white flex items-center justify-center shrink-0 shadow-[0_8px_20px_rgba(251,146,60,0.35)]">
                                <Hourglass size={24} strokeWidth={2.5} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="text-[15px] font-black text-gray-900">{language === 'বাংলা' ? 'আংশিক পেমেন্ট' : 'Partial / Due'}</p>
                                  <span className="text-[8px] font-black text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-md uppercase tracking-widest">{language === 'বাংলা' ? 'আংশিক' : 'Partial'}</span>
                                </div>
                                <p className="text-[11px] font-bold text-gray-500 mt-0.5 leading-snug">
                                  {language === 'বাংলা' ? 'কিছু টাকা পেয়েছেন — বাকিটা ব্যালান্স হিসেবে ট্র্যাক হবে' : 'Some amount received — balance auto-tracked & shown to tenant'}
                                </p>
                              </div>
                              <ArrowRight size={20} className="text-amber-500 shrink-0 group-hover:translate-x-1 transition-transform" />
                            </div>
                          </button>

                          {/* Mark as Due (no money received) */}
                          <button
                            type="button"
                            onClick={() => choosePayStatus('due')}
                            className="group relative text-left bg-gradient-to-br from-rose-50 to-red-50/40 hover:from-rose-100 hover:to-red-100/50 border border-rose-100 hover:border-rose-300 rounded-2xl p-5 transition-all hover:-translate-y-0.5 hover:shadow-[0_15px_30px_rgba(244,63,94,0.18)] active:scale-[0.99] overflow-hidden"
                          >
                            <div className="absolute -top-12 -right-12 w-32 h-32 bg-rose-200/30 rounded-full blur-3xl pointer-events-none group-hover:bg-rose-300/40 transition-colors"></div>
                            <div className="relative flex items-center gap-4">
                              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-rose-500 to-red-600 text-white flex items-center justify-center shrink-0 shadow-[0_8px_20px_rgba(244,63,94,0.35)]">
                                <AlertCircle size={26} strokeWidth={2.5} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="text-[15px] font-black text-gray-900">{language === 'বাংলা' ? 'বকেয়া হিসেবে চিহ্নিত' : 'Mark as Due'}</p>
                                  <span className="text-[8px] font-black text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded-md uppercase tracking-widest">{language === 'বাংলা' ? 'নোট' : 'Note'}</span>
                                </div>
                                <p className="text-[11px] font-bold text-gray-500 mt-0.5 leading-snug">
                                  {language === 'বাংলা' ? 'কোনো টাকা আসেনি — শুধু বকেয়া হিসেবে নোট রাখুন' : 'No money received yet — log it as outstanding (no receipt sent)'}
                                </p>
                              </div>
                              <ArrowRight size={20} className="text-rose-500 shrink-0 group-hover:translate-x-1 transition-transform" />
                            </div>
                          </button>
                        </div>

                        {isEditing && (
                          <button
                            onClick={() => undoMarkPaid(booking.id, payForm.monthKey)}
                            className="w-full bg-gray-50 hover:bg-red-50 text-gray-500 hover:text-red-600 py-3 rounded-xl font-black text-[11px] uppercase tracking-widest border border-gray-100 transition-all flex items-center justify-center gap-2"
                          >
                            <XCircle size={14}/> {language === 'বাংলা' ? 'এই মাসের রেকর্ড মুছুন' : 'Remove this month\u2019s record'}
                          </button>
                        )}
                      </>
                    )}

                    {/* ─────────────── STEP 2 — FORM ─────────────── */}
                    {payForm.step === 'form' && (
                      <>
                        <button
                          type="button"
                          onClick={() => setPayForm(f => ({ ...f, step: 'choose' }))}
                          className="text-[10px] font-black text-gray-400 hover:text-gray-700 uppercase tracking-widest flex items-center gap-1.5 transition-colors"
                        >
                          <ArrowLeft size={12}/> {language === 'বাংলা' ? 'অপশন পরিবর্তন' : 'Change option'}
                        </button>

                        {/* Pill telling the host which mode they're in */}
                        <div className={`inline-flex items-center gap-1.5 ${theme.soft} px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-widest`}>
                          {payForm.status === 'full' && <><CheckCheck size={11} strokeWidth={3}/> {language === 'বাংলা' ? 'সম্পূর্ণ পেমেন্ট' : 'Full Payment'}</>}
                          {payForm.status === 'partial' && <><Hourglass size={11} strokeWidth={3}/> {language === 'বাংলা' ? 'আংশিক পেমেন্ট' : 'Partial Payment'}</>}
                          {payForm.status === 'due' && <><AlertCircle size={11} strokeWidth={3}/> {language === 'বাংলা' ? 'বকেয়া নোট' : 'Due Note'}</>}
                        </div>

                        {/* ── DUE NOTE form ───────────────────────────────── */}
                        {payForm.status === 'due' ? (
                          <div className="space-y-4">
                            <div>
                              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'বকেয়ার নোট (ভাড়াটিয়াকে দেখানো হবে না)' : 'Due note (visible to you only)'}</label>
                              <textarea
                                rows="3"
                                value={payForm.dueNote}
                                onChange={e => setPayForm(f => ({ ...f, dueNote: e.target.value }))}
                                placeholder={language === 'বাংলা' ? 'যেমন: ভাড়াটিয়া পরের সপ্তাহে দেবে বলেছে' : 'e.g. Tenant promised to pay next Friday'}
                                className={`w-full mt-1.5 p-3 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white border border-transparent ${theme.ring} transition-all resize-none`}
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'ভাড়াটিয়া কবে দেবে বলেছে? (অপশনাল)' : 'Promised pay-by date (optional)'}</label>
                              <input
                                type="date"
                                value={payForm.expectedPayBy}
                                onChange={e => setPayForm(f => ({ ...f, expectedPayBy: e.target.value }))}
                                className={`w-full mt-1.5 p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white border border-transparent ${theme.ring} transition-all`}
                              />
                            </div>
                          </div>
                        ) : (
                          /* ── FULL / PARTIAL form ─────────────────────────── */
                          <div className="space-y-4">
                            {/* Amount + balance preview — the headline of the form */}
                            <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'যত টাকা পেয়েছেন' : 'Amount received (BDT)'}</label>
                              <div className="mt-2 relative">
                                <span className={`absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-black ${theme.accent}`}>৳</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  value={payForm.amount}
                                  readOnly={payForm.status === 'full'}
                                  onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))}
                                  className={`w-full pl-10 pr-4 py-4 bg-white rounded-xl text-2xl font-black text-gray-900 outline-none border ${payForm.status === 'full' ? 'border-blue-200 cursor-not-allowed' : 'border-amber-200'} ${theme.ring} tabular-nums tracking-tight transition-all`}
                                />
                              </div>
                              {/* Live balance / status hint */}
                              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                                <div className="bg-white rounded-lg py-2 border border-gray-100">
                                  <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'এক্সপেক্টেড' : 'Expected'}</p>
                                  <p className="text-[12px] font-black text-gray-900 mt-0.5 tabular-nums">{formatBDT(expected)}</p>
                                </div>
                                <div className={`rounded-lg py-2 border ${payForm.status === 'full' ? 'bg-blue-50 border-blue-200' : 'bg-amber-50 border-amber-200'}`}>
                                  <p className={`text-[8px] font-black uppercase tracking-widest ${theme.accent}`}>{language === 'বাংলা' ? 'পেইড' : 'Paid'}</p>
                                  <p className="text-[12px] font-black text-gray-900 mt-0.5 tabular-nums">{formatBDT(amt)}</p>
                                </div>
                                <div className={`rounded-lg py-2 border ${balance > 0 ? 'bg-rose-50 border-rose-200' : 'bg-green-50 border-green-200'}`}>
                                  <p className={`text-[8px] font-black uppercase tracking-widest ${balance > 0 ? 'text-rose-600' : 'text-green-600'}`}>{language === 'বাংলা' ? 'বাকি' : 'Balance'}</p>
                                  <p className="text-[12px] font-black text-gray-900 mt-0.5 tabular-nums">{balance > 0 ? formatBDT(balance) : (language === 'বাংলা' ? 'ক্লিয়ার' : 'Cleared')}</p>
                                </div>
                              </div>
                              {payForm.status === 'full' && (
                                <p className="text-[10px] font-bold text-blue-600 mt-2 flex items-center gap-1.5"><Lock size={10}/> {language === 'বাংলা' ? 'সম্পূর্ণ পেমেন্ট মোড — অ্যামাউন্ট লক করা' : 'Full Payment mode — amount locked to monthly rent'}</p>
                              )}
                            </div>

                            {/* Method, txn, date */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div>
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'পেমেন্টের তারিখ' : 'Paid On'}</label>
                                <input type="date" value={payForm.paidOn} onChange={e => setPayForm(f => ({ ...f, paidOn: e.target.value }))} className={`w-full mt-1.5 p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white border border-transparent ${theme.ring} transition-all`} />
                              </div>
                              <div>
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'পেমেন্ট মেথড' : 'Method'}</label>
                                <select value={payForm.method} onChange={e => setPayForm(f => ({ ...f, method: e.target.value }))} className={`w-full mt-1.5 p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white border border-transparent ${theme.ring} transition-all`}>
                                  <option>bKash</option>
                                  <option>Nagad</option>
                                  <option>Rocket</option>
                                  <option>Bank Transfer</option>
                                  <option>Cash</option>
                                  <option>Cheque</option>
                                  <option>Other</option>
                                </select>
                              </div>
                              <div className="sm:col-span-2">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'ট্রানজ্যাকশন আইডি' : 'Txn ID (optional)'}</label>
                                <input type="text" value={payForm.txnId} onChange={e => setPayForm(f => ({ ...f, txnId: e.target.value }))} placeholder="BK1A2B3C" className={`w-full mt-1.5 p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white border border-transparent ${theme.ring} transition-all`} />
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Submit row */}
                        <div className="flex flex-col sm:flex-row gap-3 pt-2">
                          <button
                            onClick={submitMarkPaid}
                            className={`flex-[2] bg-gradient-to-br ${theme.from} ${theme.to} text-white py-4 rounded-xl font-black hover:-translate-y-0.5 transition-all text-sm flex items-center justify-center gap-2 shadow-[0_10px_25px_rgba(0,0,0,0.15)]`}
                          >
                            {payForm.status === 'full' && <><CheckCheck size={18} strokeWidth={3}/> {language === 'বাংলা' ? 'পূর্ণ পেইড সেভ ও রিসিট পাঠান' : 'Save Full Payment & Send Receipt'}</>}
                            {payForm.status === 'partial' && <><Hourglass size={18} strokeWidth={3}/> {language === 'বাংলা' ? 'আংশিক সেভ ও রিসিট পাঠান' : 'Save Partial & Send Receipt'}</>}
                            {payForm.status === 'due' && <><AlertCircle size={18} strokeWidth={3}/> {language === 'বাংলা' ? 'বকেয়া হিসেবে সেভ' : 'Save as Due'}</>}
                          </button>
                          {isEditing && (
                            <button onClick={() => undoMarkPaid(booking.id, payForm.monthKey)} className="flex-1 bg-red-50 text-red-600 py-4 rounded-xl font-black hover:bg-red-100 transition-all text-xs flex items-center justify-center gap-1.5 border border-red-100">
                              <XCircle size={14} /> {language === 'বাংলা' ? 'রেকর্ড মুছুন' : 'Remove'}
                            </button>
                          )}
                        </div>

                        {/* Tenant-receipt reassurance line — explains the cross-system bridge to the host */}
                        {payForm.status !== 'due' && (
                          <p className="text-center text-[10px] font-bold text-gray-400 leading-snug">
                            <Sparkles size={10} className="inline -mt-0.5 mr-1 text-amber-500" />
                            {language === 'বাংলা'
                              ? `সেভ করার সাথে সাথে ${booking.tenant} এর পেমেন্ট ইনবক্সে ${payForm.status === 'full' ? 'নীল টিক' : 'অ্যাম্বার'} রিসিট চলে যাবে।`
                              : `On save, ${booking.tenant}\u2019s tenant inbox gets a ${payForm.status === 'full' ? 'blue-tick' : 'partial'} receipt instantly.`}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                );
              })()}

              {/* ─ Premium Gate — non-premium hosts trying to convert/create ─ */}
              {activeModal === 'premium_gate' && (
                <div className="text-center space-y-5">
                  <div className="w-20 h-20 mx-auto rounded-[1.4rem] bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-[0_12px_30px_rgba(251,146,60,0.35)]">
                    <Crown size={36} className="text-white" />
                  </div>
                  <div>
                    <h4 className="text-2xl font-black text-gray-900 leading-tight">{language === 'বাংলা' ? 'প্রিমিয়াম ফিচার' : 'Premium Feature'}</h4>
                    <p className="text-gray-500 font-bold mt-2 text-sm leading-relaxed">
                      {language === 'বাংলা'
                        ? 'বুকিং কনভার্সন, রেন্ট লেজার ও অটো রিমাইন্ডার প্রিমিয়াম সাবস্ক্রিপশনে চালু থাকে।'
                        : 'Booking conversion, the rent ledger, and auto-reminders are part of the premium plan.'}
                    </p>
                  </div>

                  <div className="bg-gradient-to-br from-gray-50 to-white p-5 rounded-2xl border border-gray-100 text-left space-y-2.5">
                    {[
                      language === 'বাংলা' ? 'মাসিক ভাড়ার অটো ট্র্যাকিং' : 'Per-tenant monthly rent tracking',
                      language === 'বাংলা' ? 'ডিউ ডেটের আগে অটো SMS / ইমেইল' : 'Auto SMS / email before due date',
                      language === 'বাংলা' ? 'বকেয়া অ্যালার্ট ও পেমেন্ট লগ' : 'Overdue alerts & payment log',
                      language === 'বাংলা' ? 'ইনকোয়ারি থেকে বুকিং কনভার্সন' : 'Convert inquiries into bookings',
                    ].map((line, i) => (
                      <div key={i} className="flex items-start gap-2.5">
                        <CheckCircle2 size={16} className="text-green-500 shrink-0 mt-0.5" />
                        <span className="text-[12px] font-bold text-gray-700 leading-snug">{line}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-col gap-2.5 pt-2">
                    <button
                      onClick={() => {
                        // TODO(backend): redirect to /pricing or open Stripe checkout.
                        navigate('/pricing');
                        setActiveModal(null);
                      }}
                      className="w-full bg-gradient-to-br from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white py-4 rounded-xl font-black shadow-[0_8px_20px_rgba(251,146,60,0.3)] hover:-translate-y-0.5 transition-all text-sm flex items-center justify-center gap-2"
                    >
                      <Sparkles size={16} /> {language === 'বাংলা' ? 'প্রিমিয়াম আপগ্রেড করুন' : 'Upgrade to Premium'}
                    </button>
                  </div>
                </div>
              )}

              {activeModal === 'edit' && modalData && (() => {
                // Convert a File input to a base64 data: URL so the preview
                // survives a reload (localStorage can't hold blob: URLs).
                // Replaced by a multipart POST /api/uploads call when the
                // backend ships.
                const readFileAsDataUrl = (file) =>
                  new Promise((resolve, reject) => {
                    if (!file) return resolve('');
                    const reader = new FileReader();
                    reader.onload = () => resolve(String(reader.result || ''));
                    reader.onerror = () => reject(reader.error || new Error('File read failed'));
                    reader.readAsDataURL(file);
                  });
                const onCoverChange = async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const url = await readFileAsDataUrl(file);
                  setEditForm(f => ({ ...f, img: url, images: [url, ...(f.images || []).slice(1)] }));
                };
                const onGalleryAdd = async (e) => {
                  const files = Array.from(e.target.files || []);
                  if (files.length === 0) return;
                  const urls = await Promise.all(files.map(readFileAsDataUrl));
                  setEditForm(f => ({ ...f, images: [...(f.images || []), ...urls.filter(Boolean)] }));
                  e.target.value = '';
                };
                const removeGalleryAt = (idx) => {
                  setEditForm(f => {
                    const next = (f.images || []).filter((_, i) => i !== idx);
                    // If the removed image was the cover, fall back to the
                    // next available picture so the card never goes blank.
                    const img = f.img === f.images?.[idx] ? (next[0] || '') : f.img;
                    return { ...f, images: next, img };
                  });
                };
                const makeCover = (idx) => {
                  setEditForm(f => {
                    const url = f.images?.[idx];
                    if (!url) return f;
                    const rest = f.images.filter((_, i) => i !== idx);
                    return { ...f, img: url, images: [url, ...rest] };
                  });
                };
                const statusOptions = [
                  { id: 'active', label: language === 'বাংলা' ? 'অ্যাক্টিভ' : 'Active', tone: 'bg-green-50 text-green-700 border-green-200' },
                  { id: 'paused', label: language === 'বাংলা' ? 'পজড' : 'Paused', tone: 'bg-orange-50 text-orange-700 border-orange-200' },
                  { id: 'rented', label: language === 'বাংলা' ? 'ভাড়া হয়েছে' : 'Rented', tone: 'bg-gray-100 text-gray-700 border-gray-200' },
                ];
                const handleSave = async () => {
                  if (!editForm.title.trim() || !String(editForm.price).trim()) {
                    showToast(language === 'বাংলা' ? 'নাম এবং মূল্য আবশ্যক!' : 'Title and price are required!');
                    return;
                  }
                  const priceNumber = Number(String(editForm.price).replace(/[^\d.]/g, '')) || 0;
                  const cover = editForm.img || (editForm.images || [])[0] || '';
                  // Backend stores the cover as `coverPhoto` and validates the
                  // PATCH with a STRICT schema — sending `img`/`images` (not
                  // schema fields) bounces the whole update, so edits only ever
                  // survived in local state. Send `coverPhoto` instead.
                  const patch = {
                    title: editForm.title.trim(),
                    location: editForm.location.trim(),
                    beds: Number(editForm.beds) || 0,
                    baths: Number(editForm.baths) || 0,
                    sqft: Number(editForm.sqft) || 0,
                    floor: Number(editForm.floor) || 0,
                    furnishing: editForm.furnishing,
                    description: editForm.description,
                    status: editForm.status,
                    coverPhoto: cover,
                    price: priceNumber,
                  };
                  // Persist host-owned listings; demo seed entries fall through
                  // and live only in component state.
                  try {
                    await propertyService.updateProperty(modalData.id, patch);
                  } catch (_) { /* demo seed or not signed in — ignore */ }
                  setProperties(prev => prev.map(p => p.id === modalData.id ? {
                    ...p,
                    ...patch,
                    // Mirror the cover to the display aliases the card reads.
                    img: cover,
                    coverPhoto: cover,
                    images: editForm.images,
                    // Keep the display-formatted price string on the card.
                    price: priceNumber.toLocaleString('en-IN'),
                  } : p));
                  showToast(language === 'বাংলা' ? 'প্রপার্টি আপডেট হয়েছে!' : 'Property Saved Successfully!');
                  setActiveModal(null);
                };
                const coverPreview = editForm.img || editForm.images?.[0] || '';
                return (
                  <div className="space-y-5">
                    {/* Cover photo swap */}
                    <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'কভার ছবি' : 'Cover Photo'}</label>
                      <div className="mt-1.5 relative w-full aspect-[16/9] bg-gray-100 rounded-xl overflow-hidden border border-gray-100">
                        {coverPreview ? (
                          <img src={coverPreview} alt="cover" className="absolute inset-0 w-full h-full object-cover" />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-xs font-black">
                            {language === 'বাংলা' ? 'কভার ছবি যোগ করুন' : 'Add a cover photo'}
                          </div>
                        )}
                        <label className="absolute bottom-3 right-3 cursor-pointer inline-flex items-center gap-1.5 bg-white/95 backdrop-blur-md px-3 py-1.5 rounded-full text-[10px] font-black text-gray-900 border border-gray-100 shadow-sm hover:bg-white">
                          <Camera size={12}/> {language === 'বাংলা' ? 'বদলান' : 'Replace'}
                          <input type="file" accept="image/*" className="hidden" onChange={onCoverChange} />
                        </label>
                      </div>
                    </div>

                    {/* Gallery management */}
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'গ্যালারি' : 'Gallery'}</label>
                        <label className="cursor-pointer inline-flex items-center gap-1.5 bg-gray-900 text-white px-3 py-1.5 rounded-full text-[10px] font-black hover:bg-gray-800">
                          <ImagePlus size={12}/> {language === 'বাংলা' ? 'ছবি যোগ' : 'Add Photos'}
                          <input type="file" accept="image/*" multiple className="hidden" onChange={onGalleryAdd} />
                        </label>
                      </div>
                      <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {(editForm.images || []).map((src, i) => (
                          <div key={`${src.slice(0, 32)}-${i}`} className="relative group aspect-square rounded-xl overflow-hidden bg-gray-100 border border-gray-100">
                            <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" />
                            {editForm.img === src && (
                              <div className="absolute top-1 left-1 bg-[#ba0036] text-white text-[8px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-widest">{language === 'বাংলা' ? 'কভার' : 'Cover'}</div>
                            )}
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100">
                              {editForm.img !== src && (
                                <button type="button" onClick={() => makeCover(i)} className="bg-white text-gray-900 px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest">{language === 'বাংলা' ? 'কভার' : 'Cover'}</button>
                              )}
                              <button type="button" onClick={() => removeGalleryAt(i)} className="bg-red-500 text-white p-1.5 rounded-md"><Trash size={12}/></button>
                            </div>
                          </div>
                        ))}
                        {(editForm.images || []).length === 0 && (
                          <p className="col-span-3 sm:col-span-4 text-[11px] font-bold text-gray-400 text-center py-6 bg-gray-50 rounded-xl">
                            {language === 'বাংলা' ? 'কোনো ছবি নেই — উপরের বোতাম দিয়ে যোগ করুন।' : 'No photos yet — add some with the button above.'}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{t?.propertyTitleLabel || (language === 'বাংলা' ? 'প্রপার্টির নাম' : 'Property Title')}</label>
                        <input type="text" value={editForm.title} onChange={e => setEditForm(f => ({...f, title: e.target.value}))} className="w-full mt-1.5 p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(186,0,54,0.08)] transition-all border border-transparent focus:border-[#ba0036]/20" />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{t?.priceLabel || (language === 'বাংলা' ? 'মূল্য (টাকা)' : 'Price (BDT)')}</label>
                        <input type="text" value={editForm.price} onChange={e => setEditForm(f => ({...f, price: e.target.value}))} className="w-full mt-1.5 p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(186,0,54,0.08)] transition-all border border-transparent focus:border-[#ba0036]/20" />
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'লোকেশন' : 'Location'}</label>
                      <input type="text" value={editForm.location} onChange={e => setEditForm(f => ({...f, location: e.target.value}))} className="w-full mt-1.5 p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(186,0,54,0.08)] transition-all border border-transparent focus:border-[#ba0036]/20" />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'বেডরুম' : 'Beds'}</label>
                        <input type="number" min="0" value={editForm.beds} onChange={e => setEditForm(f => ({...f, beds: e.target.value}))} className="w-full mt-1.5 p-3 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(186,0,54,0.08)] transition-all border border-transparent focus:border-[#ba0036]/20" />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'বাথরুম' : 'Baths'}</label>
                        <input type="number" min="0" value={editForm.baths} onChange={e => setEditForm(f => ({...f, baths: e.target.value}))} className="w-full mt-1.5 p-3 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(186,0,54,0.08)] transition-all border border-transparent focus:border-[#ba0036]/20" />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'বর্গফুট' : 'Sqft'}</label>
                        <input type="number" min="0" value={editForm.sqft} onChange={e => setEditForm(f => ({...f, sqft: e.target.value}))} className="w-full mt-1.5 p-3 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(186,0,54,0.08)] transition-all border border-transparent focus:border-[#ba0036]/20" />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'কত তলায়' : 'Floor'}</label>
                        <input type="number" min="0" value={editForm.floor} onChange={e => setEditForm(f => ({...f, floor: e.target.value}))} className="w-full mt-1.5 p-3 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(186,0,54,0.08)] transition-all border border-transparent focus:border-[#ba0036]/20" />
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'ফার্নিশিং' : 'Furnishing'}</label>
                      <select
                        value={editForm.furnishing}
                        onChange={e => setEditForm(f => ({...f, furnishing: e.target.value}))}
                        className="w-full mt-1.5 p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(186,0,54,0.08)] transition-all border border-transparent focus:border-[#ba0036]/20"
                      >
                        <option value="Furnished">{language === 'বাংলা' ? 'ফার্নিশড' : 'Furnished'}</option>
                        <option value="Semi-Furnished">{language === 'বাংলা' ? 'সেমি-ফার্নিশড' : 'Semi-Furnished'}</option>
                        <option value="Unfurnished">{language === 'বাংলা' ? 'আনফার্নিশড' : 'Unfurnished'}</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'বিবরণ' : 'Description'}</label>
                      <textarea
                        rows={4}
                        value={editForm.description}
                        onChange={e => setEditForm(f => ({...f, description: e.target.value}))}
                        className="w-full mt-1.5 p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(186,0,54,0.08)] transition-all border border-transparent focus:border-[#ba0036]/20 resize-none"
                        placeholder={language === 'বাংলা' ? 'প্রপার্টির বিবরণ লিখুন...' : 'Describe the property...'}
                      />
                    </div>

                    {/* Status picker — including the user's requested
                        "Rented" option. Switching to rented flips the card
                        chrome to the lease view and removes the
                        Inquiries/Pause buttons in the grid. */}
                    <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'স্ট্যাটাস' : 'Status'}</label>
                      <div className="mt-1.5 grid grid-cols-3 gap-2">
                        {statusOptions.map(opt => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setEditForm(f => ({...f, status: opt.id}))}
                            className={`px-3 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${editForm.status === opt.id ? `${opt.tone} ring-2 ring-offset-1 ring-[#ba0036]/30` : 'bg-gray-50 text-gray-500 border-transparent hover:bg-gray-100'}`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      onClick={handleSave}
                      className="w-full mt-2 bg-[#ba0036] text-white py-4 rounded-xl font-black shadow-[0_8px_15px_rgba(186,0,54,0.2)] hover:shadow-[0_12px_20px_rgba(186,0,54,0.3)] hover:-translate-y-0.5 transition-all text-sm flex items-center justify-center gap-2"
                    >
                      <Check size={16}/> {t?.saveChangesBtn || (language === 'বাংলা' ? 'সেভ করুন' : 'Save Changes')}
                    </button>
                  </div>
                );
              })()}

              {activeModal === 'lease' && modalData && (() => {
                // Pull live lease info from the booking that matches this
                // property, if one exists. No hardcoded "Mr. John Doe" — show
                // a friendly placeholder when there's no active lease yet.
                const booking = bookings.find(b => String(b.propertyId) === String(modalData.id));
                const tenantName = booking?.tenant || booking?.tenantName || (language === 'বাংলা' ? 'কোনো ভাড়াটিয়া নেই' : 'No active tenant');
                const rentDisplay = typeof booking?.monthlyRent === 'number'
                  ? formatBDT(booking.monthlyRent)
                  : (modalData.price ? `৳ ${modalData.price}` : '—');
                const validUntil = booking?.leaseEnd
                  ? new Date(booking.leaseEnd).toLocaleDateString(language === 'বাংলা' ? 'bn-BD' : 'en-US', { month: 'short', year: 'numeric' })
                  : (language === 'বাংলা' ? 'নির্ধারিত হয়নি' : 'Not set');
                return (
                  <div className="text-center space-y-6">
                    <div className="w-20 h-20 bg-blue-50 text-blue-500 rounded-[1.2rem] flex items-center justify-center mx-auto mb-3 shadow-sm"><FileText size={32} /></div>
                    <div><h4 className="text-2xl font-black text-gray-900 leading-tight">{modalData.title}</h4><p className="text-gray-500 font-bold mt-1.5 text-xs">{t?.activeLeaseAgreement || (language === 'বাংলা' ? 'অ্যাক্টিভ লিজ এগ্রিমেন্ট' : 'Active Lease Agreement')}</p></div>
                    <div className="bg-gray-50 p-6 rounded-2xl text-left space-y-4">
                      <div className="flex justify-between items-center"><span className="text-gray-400 font-black text-[10px] uppercase tracking-widest">{t?.tenantLabel || (language === 'বাংলা' ? 'ভাড়াটিয়া' : 'Tenant')}</span> <span className="font-black text-gray-900 text-[15px]">{tenantName}</span></div>
                      <div className="flex justify-between items-center"><span className="text-gray-400 font-black text-[10px] uppercase tracking-widest">{t?.rentLabel || (language === 'বাংলা' ? 'ভাড়া' : 'Rent')}</span> <span className="font-black text-gray-900 text-[15px]">{rentDisplay}{booking ? '/mo' : ''}</span></div>
                      <div className="flex justify-between items-center"><span className="text-gray-400 font-black text-[10px] uppercase tracking-widest">{t?.validUntilLabel || (language === 'বাংলা' ? 'মেয়াদ' : 'Valid Until')}</span> <span className="font-black text-green-600 bg-green-50 px-3 py-1 rounded-full text-xs">{validUntil}</span></div>
                    </div>
                    <button onClick={() => { showToast(language === 'বাংলা' ? 'ডাউনলোড হচ্ছে...' : 'Downloading Document...'); setActiveModal(null); }} className="w-full bg-gray-900 text-white py-4 rounded-xl font-black shadow-[0_8px_15px_rgba(0,0,0,0.1)] hover:bg-[#ba0036] transition-all text-sm">{t?.downloadPdfBtn || (language === 'বাংলা' ? 'পিডিএফ ডাউনলোড করুন' : 'Download PDF')}</button>
                  </div>
                );
              })()}

              {activeModal === 'settings' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-5 bg-white rounded-2xl shadow-[0_4px_15px_rgba(0,0,0,0.02)] hover:shadow-[0_8px_20px_rgba(0,0,0,0.05)] transition-all">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center text-[#ba0036]"><Mail size={20}/></div>
                      <div><p className="text-sm font-black text-gray-900">{t?.emailAlerts || (language === 'বাংলা' ? 'ইমেইল অ্যালার্ট' : 'Email Alerts')}</p><p className="text-[10px] text-gray-500 font-bold mt-0.5">{t?.emailAlertsDesc || (language === 'বাংলা' ? 'ইনকোয়ারি ইমেইল পান' : 'Get inquiry emails')}</p></div>
                    </div>
                    <div className="w-12 h-7 bg-[#ba0036] rounded-full relative cursor-pointer shadow-inner"><div className="w-5 h-5 bg-white rounded-full absolute right-1 top-1 shadow-sm"></div></div>
                  </div>
                  <div className="flex items-center justify-between p-5 bg-white rounded-2xl shadow-[0_4px_15px_rgba(0,0,0,0.02)] hover:shadow-[0_8px_20px_rgba(0,0,0,0.05)] transition-all">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600"><Shield size={20}/></div>
                      <div><p className="text-sm font-black text-gray-900">{t?.twoFactorAuth || (language === 'বাংলা' ? '২-ফ্যাক্টর' : '2-Factor Auth')}</p><p className="text-[10px] text-gray-500 font-bold mt-0.5">{t?.twoFactorAuthDesc || (language === 'বাংলা' ? 'অ্যাকাউন্ট সুরক্ষিত রাখুন' : 'Secure your account')}</p></div>
                    </div>
                    <div className="w-12 h-7 bg-gray-200 rounded-full relative cursor-pointer shadow-inner"><div className="w-5 h-5 bg-white rounded-full absolute left-1 top-1 shadow-sm"></div></div>
                  </div>
                  <button onClick={() => { showToast(language === 'বাংলা' ? 'সেটিংস সেভ হয়েছে!' : 'Settings Saved!'); setActiveModal(null); }} className="w-full mt-5 bg-[#ba0036] text-white py-4 rounded-xl font-black shadow-[0_8px_15px_rgba(186,0,54,0.25)] hover:-translate-y-0.5 transition-all text-sm">{t?.savePreferencesBtn || (language === 'বাংলা' ? 'সেভ করুন' : 'Save Preferences')}</button>
                </div>
              )}

              {activeModal === 'support' && (
                <div className="space-y-4">
                  <p className="text-sm font-bold text-gray-500 mb-3">{t?.needHelpDesc || (language === 'বাংলা' ? 'কোনো সমস্যা হচ্ছে? আমাদের মেসেজ দিন।' : 'Need help with your properties? Send us a message.')}</p>
                  <div><label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{t?.subjectLabel || (language === 'বাংলা' ? 'বিষয়' : 'Subject')}</label><input type="text" placeholder={t?.subjectPlaceholder || (language === 'বাংলা' ? 'যেমন: পেমেন্ট সমস্যা' : 'e.g. Payment Issue')} className="w-full mt-1.5 p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(186,0,54,0.08)] transition-all" /></div>
                  <div><label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{t?.messageLabel || (language === 'বাংলা' ? 'মেসেজ' : 'Message')}</label><textarea rows="4" placeholder={t?.messagePlaceholder || (language === 'বাংলা' ? 'আপনার সমস্যার কথা লিখুন...' : 'Describe your issue...')} className="w-full mt-1.5 p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(186,0,54,0.08)] transition-all resize-none" /></div>
                  <button onClick={() => { showToast(language === 'বাংলা' ? 'মেসেজ পাঠানো হয়েছে!' : 'Message Sent to Support!'); setActiveModal(null); }} className="w-full mt-3 bg-[#ba0036] text-white py-4 rounded-xl font-black shadow-[0_8px_15px_rgba(186,0,54,0.2)] hover:-translate-y-0.5 transition-all text-sm">{t?.sendMessageBtn || (language === 'বাংলা' ? 'সেন্ড করুন' : 'Send Message')}</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default HostDashboard;

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  TimelineRow — Single timeline row for the "Verification Status"     ║
// ╚══════════════════════════════════════════════════════════════════════╝
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
            {language === 'বাংলা' ? 'ভাড়াটিয়ারা যা দেখে' : 'What tenants see'}
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
          {language === 'বাংলা' ? 'অসাধারণ! আপনার প্রোফাইল ১০০% — ভাড়াটিয়াদের কাছে আপনি এখন প্ল্যাটিনাম।' : 'You hit max Trust Score. Tenants see you as Platinum tier.'}
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
