import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Building, MessageSquare, Calendar,
  Settings, HelpCircle, Plus, Search, Bell, Filter, ArrowUpDown,
  Edit3, PauseCircle, PlayCircle, FileText, MapPin, Globe, CheckCircle2,
  X, CreditCard, MoreVertical, Download, Trash2, MessageCircle, Archive,
  Send, Paperclip, Smile, Mail, Shield, LogOut, BadgeCheck, Camera, Check,
  Hourglass, Upload, User, Image as ImageIcon, CheckCircle, ScanFace, Zap,
  BellRing, Folder, Scale, ClipboardCheck, Receipt, UploadCloud, ArrowLeft,
  File, Eye, FileEdit, Megaphone, FileSpreadsheet, Phone, Bot, CheckCheck, Video,
  Activity, TrendingUp, Crown, Lock, Sparkles, DollarSign, Wallet,
  XCircle, AlertCircle, RefreshCw, ChevronDown, ChevronUp, MinusCircle,
  Banknote, ArrowRight, ArrowUpRight, Clock, Smartphone,
  BellOff, CalendarRange
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

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

// 🔴 INITIAL DATA (With Added Dates)
const initialPortfolio = [
  // মে মাসের ১ তারিখে অ্যাড করা (৩ দিনের মধ্যে)
  { id: 1, title: 'Elegant 3BHK with Skyline View', location: 'Gulshan 2, Dhaka', price: '85,000', status: 'active', inquiries: 12, img: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?q=80&w=2075', addedDate: '2026-05-01' },
  // এপ্রিলে অ্যাড করা (অনেক আগে)
  { id: 2, title: 'Modern Duplex with Garden', location: 'Banani, Dhaka', price: '1,20,000', status: 'active', inquiries: 45, img: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?q=80&w=2070', addedDate: '2026-04-15' },
  // ফেব্রুয়ারিতে অ্যাড করা (আরও আগে)
  { id: 3, title: 'Cozy Studio Setup', location: 'Dhanmondi, Dhaka', price: '45,000', status: 'rented', inquiries: 0, img: 'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?q=80&w=2070', addedDate: '2026-02-10' },
  { id: 4, title: 'Luxury Penthouse Suite', location: 'Gulshan 1, Dhaka', price: '2,50,000', status: 'active', inquiries: 8, img: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?q=80&w=2070', addedDate: '2026-03-20' },
  { id: 5, title: 'Spacious 4BHK Family Home', location: 'Uttara, Dhaka', price: '95,000', status: 'active', inquiries: 15, img: 'https://images.unsplash.com/photo-1570129477492-45c003edd2be?q=80&w=2070', addedDate: '2026-03-05' },
  { id: 6, title: 'Premium Office Space', location: 'Motijheel, Dhaka', price: '1,80,000', status: 'paused', inquiries: 3, img: 'https://images.unsplash.com/photo-1497366216548-37526070297c?q=80&w=2070', addedDate: '2026-01-15' },
  { id: 7, title: 'Charming 2BHK Flat', location: 'Mirpur 10, Dhaka', price: '35,000', status: 'active', inquiries: 22, img: 'https://images.unsplash.com/photo-1493809842364-78817add7ffb?q=80&w=2070', addedDate: '2026-02-28' },
  { id: 8, title: 'Waterfront Villa', location: 'Purbachal, Dhaka', price: '3,50,000', status: 'active', inquiries: 5, img: 'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?q=80&w=2074', addedDate: '2026-04-01' },
  { id: 9, title: 'Modern Studio Apartment', location: 'Bashundhara, Dhaka', price: '28,000', status: 'rented', inquiries: 0, img: 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?q=80&w=2080', addedDate: '2026-01-20' },
  { id: 10, title: 'Corporate Guest House', location: 'Tejgaon, Dhaka', price: '75,000', status: 'active', inquiries: 9, img: 'https://images.unsplash.com/photo-1554995207-c18c203602cb?q=80&w=2070', addedDate: '2026-04-10' },
  { id: 11, title: 'Rooftop Terrace Apartment', location: 'Mohakhali, Dhaka', price: '65,000', status: 'active', inquiries: 17, img: 'https://images.unsplash.com/photo-1505691938895-1758d7feb511?q=80&w=2070', addedDate: '2026-03-15' },
  { id: 12, title: 'Budget-Friendly 1BHK', location: 'Rampura, Dhaka', price: '18,000', status: 'active', inquiries: 31, img: 'https://images.unsplash.com/photo-1484154218962-a197022b5858?q=80&w=2074', addedDate: '2026-02-05' },
  { id: 13, title: 'Executive Suite with Pool', location: 'Baridhara, Dhaka', price: '4,00,000', status: 'active', inquiries: 4, img: 'https://images.unsplash.com/photo-1512789185822-01d3c5bc89fe?q=80&w=2070', addedDate: '2026-04-20' },
];

// Bookings now carry the full lease + month-by-month rent ledger so we can
// replace the landlord's Excel sheet. `ledger` is keyed by 'YYYY-MM' →
// { paid, paidOn, method, txnId, amount }. Months that don't appear in the
// object yet are simply unpaid, which keeps the data sparse.
const initialBookings = [
  {
    id: 'BKG-001',
    inquiryId: 1,
    propertyId: 1,
    property: 'Elegant 3BHK with Skyline View',
    tenant: 'Mr. John Doe',
    tenantInit: 'JD',
    tenantPhone: '+880 1711 234567',
    tenantEmail: 'john.doe@example.com',
    leaseStart: '2026-06-01',
    leaseEnd: '2027-05-31',
    monthlyRent: 85000,
    serviceCharge: 5000,
    securityDeposit: 170000,
    depositPaid: true,
    tenantsCount: 3,
    rentDueDay: 5,
    reminderLeadDays: 3,
    autoReminder: true,
    chatId: 1,
    notes: 'Upcoming move-in. Security deposit cleared.',
    ledger: {},
  },
  {
    id: 'BKG-002',
    inquiryId: 2,
    propertyId: 2,
    property: 'Modern Duplex with Garden',
    tenant: 'Sarah Islam',
    tenantInit: 'SI',
    tenantPhone: '+880 1822 987654',
    tenantEmail: 'sarah.islam@example.com',
    leaseStart: '2026-01-01',
    leaseEnd: '2027-12-31',
    monthlyRent: 120000,
    serviceCharge: 8000,
    securityDeposit: 240000,
    depositPaid: true,
    tenantsCount: 4,
    rentDueDay: 1,
    reminderLeadDays: 5,
    autoReminder: true,
    chatId: 2,
    notes: 'Long-term tenant, prefers bKash.',
    ledger: {
      '2026-01': { paid: true, paidOn: '2026-01-02', method: 'bKash',         txnId: 'BK1A2B3C', amount: 120000 },
      '2026-02': { paid: true, paidOn: '2026-02-04', method: 'Bank Transfer', txnId: 'TXN8843',  amount: 120000 },
      '2026-03': { paid: true, paidOn: '2026-03-01', method: 'Cash',          txnId: '',         amount: 120000 },
      '2026-04': { paid: true, paidOn: '2026-04-03', method: 'bKash',         txnId: 'BK7Y8Z9W', amount: 120000 },
      // May 2026 intentionally unpaid — surfaces as overdue/due-soon at runtime.
    },
  },
  {
    id: 'BKG-003',
    inquiryId: 3,
    propertyId: 3,
    property: 'Cozy Studio Setup',
    tenant: 'Rahim Uddin',
    tenantInit: 'RU',
    tenantPhone: '+880 1933 456789',
    tenantEmail: 'rahim.uddin@example.com',
    leaseStart: '2025-01-01',
    leaseEnd: '2025-12-31',
    monthlyRent: 45000,
    serviceCharge: 3000,
    securityDeposit: 90000,
    depositPaid: true,
    tenantsCount: 1,
    rentDueDay: 1,
    reminderLeadDays: 3,
    autoReminder: false,
    chatId: 3,
    notes: 'Lease completed, moved out Dec 2025.',
    ledger: Object.fromEntries(
      ['2025-01','2025-02','2025-03','2025-04','2025-05','2025-06','2025-07','2025-08','2025-09','2025-10','2025-11','2025-12']
        .map((k, i) => [k, { paid: true, paidOn: `${k}-0${(i % 5) + 1}`, method: 'Cash', txnId: '', amount: 45000 }])
    ),
  },
  {
    id: 'BKG-004',
    inquiryId: 4,
    propertyId: 7,
    property: 'Charming 2BHK Flat',
    tenant: 'Fatema Begum',
    tenantInit: 'FB',
    tenantPhone: '+880 1644 112233',
    tenantEmail: 'fatema.begum@example.com',
    leaseStart: '2026-02-01',
    leaseEnd: '2027-01-31',
    monthlyRent: 35000,
    serviceCharge: 2500,
    securityDeposit: 70000,
    depositPaid: true,
    tenantsCount: 2,
    rentDueDay: 7,
    reminderLeadDays: 4,
    autoReminder: true,
    chatId: 4,
    notes: '',
    ledger: {
      '2026-02': { paid: true,  paidOn: '2026-02-07', method: 'Cash',  txnId: '',         amount: 35000 },
      '2026-03': { paid: true,  paidOn: '2026-03-09', method: 'bKash', txnId: 'BK11AAFF', amount: 35000 },
      // April + May still unpaid — will show as overdue/due-soon.
    },
  },
];

const initialInquiries = [
  { id: 1, user: 'Mr. John Doe',  init: 'JD', timeAgo: '2 hours ago', phone: '+880 1711 234567', propertyId: 1, propTitle: 'Elegant 3BHK with Skyline View', msg: 'Hi, I need to discuss the upcoming renewal and I am highly interested in this property. When can I visit?', chatId: 1, verified: true,  memberSince: '2025', suggestionIds: ['visit', 'rent', 'facilities'] },
  { id: 2, user: 'Sarah Islam',   init: 'SI', timeAgo: '5 hours ago', phone: '+880 1822 987654', propertyId: 2, propTitle: 'Modern Duplex with Garden',     msg: 'Is the rent negotiable? I am looking for a long-term lease starting next month.', chatId: 2, verified: true,  memberSince: '2026', suggestionIds: ['rent', 'move-in'] },
  { id: 3, user: 'Ahmed Hasan',   init: 'AH', timeAgo: '1 day ago',   phone: '+880 1933 456789', propertyId: 3, propTitle: 'Cozy Studio Setup',             msg: 'I am a university student. Is this studio available for single occupancy?', chatId: 3, verified: false, memberSince: '2026', suggestionIds: ['facilities'] },
  { id: 4, user: 'Fatima Rahman', init: 'FR', timeAgo: '2 days ago',  phone: '+880 1644 112233', propertyId: 1, propTitle: 'Elegant 3BHK with Skyline View', msg: 'Can you share more pictures of the kitchen and the balcony view? Thank you.', chatId: 4, verified: true,  memberSince: '2024', suggestionIds: ['visit'] },
  { id: 5, user: 'Kamrul Huda',   init: 'KH', timeAgo: '3 days ago',  phone: '+880 1555 667788', propertyId: 2, propTitle: 'Modern Duplex with Garden',     msg: 'Does the property have dedicated parking for two vehicles?', chatId: 5, verified: false, memberSince: '2026', suggestionIds: ['facilities'] }
];

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
// CROSS-SYSTEM BRIDGE — HostDashboard → TenantDashboard receipts
//
// The tenant's dashboard listens on this exact localStorage key + custom event
// so the moment a landlord ticks a month as paid, the tenant sees a receipt
// in their inbox without an API round-trip. When the backend lands, swap this
// for a websocket / push-notification broadcast — the storage shape stays
// the same so the tenant UI keeps working unchanged.
// ─────────────────────────────────────────────────────────────────────────────
const PAYMENT_RECEIPTS_KEY = 'tolet_payment_receipts';
const PAYMENT_RECEIPTS_EVENT = 'tolet-payment-receipts-updated';

// Push (or upsert) a receipt into the tenant's localStorage bucket. Multiple
// payments for the same booking + month replace the prior receipt so the
// tenant always sees the latest balance/status.
// TODO(backend): replace with `POST /api/tenants/{tenantId}/receipts` and
// emit a server-side push so other tenant devices get the receipt too.
const pushReceiptToTenant = (receipt) => {
  if (typeof window === 'undefined') return;
  try {
    const existing = JSON.parse(window.localStorage.getItem(PAYMENT_RECEIPTS_KEY) || '[]');
    const filtered = Array.isArray(existing)
      ? existing.filter(r => !(r.bookingId === receipt.bookingId && r.monthKey === receipt.monthKey))
      : [];
    const next = [receipt, ...filtered].slice(0, 200); // hard cap to avoid quota errors
    window.localStorage.setItem(PAYMENT_RECEIPTS_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(PAYMENT_RECEIPTS_EVENT));
  } catch {
    // Quota / serialisation errors — swallow silently. The host UI still
    // shows the payment locally; only the cross-tab tenant view is missed.
  }
};

// Remove the receipt for a booking + month — used when a host undoes a payment.
const removeReceiptFromTenant = (bookingId, monthKey) => {
  if (typeof window === 'undefined') return;
  try {
    const existing = JSON.parse(window.localStorage.getItem(PAYMENT_RECEIPTS_KEY) || '[]');
    const next = Array.isArray(existing)
      ? existing.filter(r => !(r.bookingId === bookingId && r.monthKey === monthKey))
      : [];
    window.localStorage.setItem(PAYMENT_RECEIPTS_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(PAYMENT_RECEIPTS_EVENT));
  } catch { /* ignore */ }
};

const HostDashboard = () => {
  const { t = {}, language = 'English', setLanguage } = useLanguage() || {}; 
  const location = useLocation(); 
  const navigate = useNavigate(); 
  
  // 🟢 CORE STATES
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isProfileDrawerOpen, setIsProfileDrawerOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
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
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [userData, setUserData] = useState({
    fullName: 'Asraf Alom',
    phone: '+880 1711-234567',
    email: 'asraf@example.com',
    address: 'House 42, Road 7, Block C, Banani',
    city: 'Dhaka',
    nidNumber: '',
  });
  const [tempUserData, setTempUserData] = useState(userData);
  
  const [uploadedDocs, setUploadedDocs] = useState({
    nidFront: false,
    nidBack: false,
    selfie: false,
    utilityBill: false
  });

  const [verificationStatus, setVerificationStatus] = useState({
    profileCompleted: true, 
    nidUploaded: false,
    faceVerified: false,
    underReview: false
  });

  // 🟢 REFS
  const nidFrontRef = useRef(null);
  const nidBackRef = useRef(null);
  const utilityRef = useRef(null);
  const notifRef = useRef(null);
  const langRef = useRef(null);

  // 🟢 DATA STATES
  const [properties, setProperties] = useState(initialPortfolio);
  const [bookings, setBookings] = useState(initialBookings);
  const [inquiries, setInquiries] = useState(initialInquiries);
  const [searchQuery, setSearchQuery] = useState('');
  const [propertyFilter, setPropertyFilter] = useState('all');
  const [activeModal, setActiveModal] = useState(null); 
  const [modalData, setModalData] = useState(null);
  const [editForm, setEditForm] = useState({ title: '', price: '', location: '' });
  const [activeDropdownId, setActiveDropdownId] = useState(null);
  // NOTE: in-dashboard chat panel removed — all message CTAs now route to
  // /messages (the standalone ChatSystem) so there's a single source of
  // truth for conversations across the app.

  // 🟢 PREMIUM + RENT-LEDGER STATES
  // `isPremium` is a frontend stub today; the backend will hydrate it from the
  // host's subscription record. Booking creation (Convert Inquiry → Booking)
  // is gated behind this flag so non-premium hosts get the upgrade prompt.
  // TODO(backend): GET /api/host/me  →  { ..., subscription: { tier, isPremium } }
  const [isPremium, setIsPremium] = useState(true);

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
  const [expandedBookingId, setExpandedBookingId] = useState(null);
  const [expandedRentId, setExpandedRentId] = useState(null);

  // Mobile-only: collapse the dark hero stats card into a 1-line banner by
  // default to reclaim ~400px of viewport for the tenant list. Tap the
  // banner to expand into the full KPI block. Independent per tab so each
  // remembers its own state while the host navigates.
  const [bookingsStatsOpen, setBookingsStatsOpen] = useState(false);
  const [rentStatsOpen, setRentStatsOpen] = useState(false);

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

  // Stable "today" used by all rent-status calculations on this render. We
  // memoise on date-string change so flipping months in the picker doesn't
  // thrash the matrix.
  const today = useMemo(() => new Date(), [todayIso()]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.scrollTo(0, 0);
    if (location.state && location.state.activeTab) setActiveTab(location.state.activeTab);
  }, [location]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (notifRef.current && !notifRef.current.contains(event.target)) setIsNotifOpen(false);
      if (langRef.current && !langRef.current.contains(event.target)) setIsLangMenuOpen(false); 
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
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

  const handleProfileSave = () => {
    if(!tempUserData.fullName || !tempUserData.phone) {
      showToast(language === 'বাংলা' ? 'নাম এবং ফোন নম্বর আবশ্যক!' : 'Name and Phone are required!');
      return;
    }
    setUserData(tempUserData);
    setIsEditingProfile(false);
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
        return { ...p, status: newStatus };
      }
      return p;
    }));
  };

  const openModal = (type, data = null) => {
    setActiveModal(type);
    setModalData(data);
    setActiveDropdownId(null);
    setIsProfileDrawerOpen(false);
    if (type === 'edit' && data) {
      setEditForm({ title: data.title, price: data.price, location: data.location });
    }
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

    // ── Cross-system: push receipt to tenant for full + partial only.
    // "Due" notes are landlord-side only — no receipt is generated because
    // no money has changed hands yet.
    if (status !== 'due') {
      const receipt = {
        id: `RCP-${booking.id}-${key}-${Date.now().toString(36).toUpperCase()}`,
        read: false,
        bookingId: booking.id,
        tenantPhone: booking.tenantPhone,
        landlordChatId: booking.chatId,
        propertyTitle: booking.property,
        monthKey: key,
        monthLabel: monthFullLabel(key, language),
        status,                        // 'full' | 'partial'
        totalDue: expected,
        totalPaid: amt,
        balance,
        method,
        txnId: txnId || '',
        paidOn,
        date: formatDate(paidOn, language),
        issuedAt: new Date().toISOString(),
      };
      pushReceiptToTenant(receipt);
    } else {
      // Editing a previously-paid month back to "due" should also pull the
      // stale receipt from the tenant's inbox so they aren't confused.
      removeReceiptFromTenant(booking.id, key);
    }

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
    setActiveModal(null);
  };

  // Reverse a payment record — used when a payment was logged by mistake.
  // Also pulls the receipt from the tenant's inbox so they don't see a
  // stale "Paid" notification for a payment that never happened.
  // TODO(backend): DELETE /api/host/bookings/{bookingId}/ledger/{monthKey}
  const undoMarkPaid = (bookingId, key) => {
    setBookings(prev => prev.map(b => {
      if (b.id !== bookingId) return b;
      const next = { ...(b.ledger || {}) };
      delete next[key];
      return { ...b, ledger: next };
    }));
    removeReceiptFromTenant(bookingId, key);
    showToast(language === 'বাংলা' ? 'পেমেন্ট রেকর্ড মুছে ফেলা হয়েছে — রিসিটও সরানো হয়েছে' : 'Payment record removed — receipt withdrawn');
    setActiveModal(null);
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
  const filteredProperties = properties.filter(p => p.title.toLowerCase().includes(searchQuery.toLowerCase()) || p.location.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredPropertiesByStatus = filteredProperties.filter(p => propertyFilter === 'all' || p.status === propertyFilter);
  
  const recentProps = filteredProperties.filter(p => isRecent(p.addedDate));
  const dashboardProperties = recentProps.length > 0 ? recentProps : filteredProperties.slice(0, 3);
  const dashboardPropTitle = recentProps.length > 0 
      ? (language === 'বাংলা' ? 'সাম্প্রতিক লিস্টিং' : 'Recent Listings') 
      : (language === 'বাংলা' ? 'আপনার প্রপার্টিসমূহ' : 'Your Properties');

  const displayedInquiries = inquiries.filter(i => i.user.toLowerCase().includes(searchQuery.toLowerCase()) || i.propTitle.toLowerCase().includes(searchQuery.toLowerCase()));

  const menuItems = [
    { id: 'dashboard', icon: LayoutDashboard, label: t?.dashboard || (language === 'বাংলা' ? 'ড্যাশবোর্ড' : "Dashboard") },
    { id: 'analytics', icon: TrendingUp, label: language === 'বাংলা' ? 'অ্যানালিটিক্স' : "Analytics" },
    { id: 'documents', icon: Folder, label: language === 'বাংলা' ? 'ডকুমেন্ট ভল্ট' : "Documents" },
    { id: 'properties', icon: Building, label: t?.myProperties || (language === 'বাংলা' ? 'আমার বাসাসমূহ' : "My Properties") },
    { id: 'inquiries', icon: Zap, label: t?.inquiries || (language === 'বাংলা' ? 'যোগাযোগ সমূহ' : "Inquiries") },
    { id: 'messages', icon: MessageCircle, label: t?.messages || (language === 'বাংলা' ? 'বার্তা' : "Messages"), isLink: true, path: '/messages' }, 
    { id: 'bookings', icon: Calendar, label: t?.bookings || (language === 'বাংলা' ? 'বুকিং' : "Bookings") },
    { id: 'rent',     icon: Wallet,   label: language === 'বাংলা' ? 'ভাড়া কালেকশন' : "Rent Collection" },
  ];

  return (
    <div className="flex flex-col min-h-screen bg-[#eaeff5] font-sans relative overflow-hidden text-gray-900 selection:bg-[#ba0036] selection:text-white">
      
      {/* ✨ GLOWING ORBS ✨ */}
      <div className="fixed top-[-20%] left-[-10%] w-[50vw] h-[50vw] bg-gradient-to-br from-[#ba0036]/10 to-transparent rounded-full blur-[120px] pointer-events-none z-0"></div>
      <div className="fixed bottom-[-20%] right-[-10%] w-[50vw] h-[50vw] bg-gradient-to-tl from-blue-600/5 to-transparent rounded-full blur-[120px] pointer-events-none z-0"></div>

      {/* TOAST NOTIFICATION */}
      <div className={`fixed top-8 left-1/2 -translate-x-1/2 z-[100] transition-all duration-500 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] ${toastMessage ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-10 scale-95 pointer-events-none'}`}>
        <div className="bg-gray-900/90 backdrop-blur-2xl text-white px-5 py-3 rounded-full shadow-[0_20px_40px_rgba(0,0,0,0.2)] border border-white/10 flex items-center gap-3">
          <div className="w-5 h-5 bg-green-500/20 rounded-full flex items-center justify-center">
             <CheckCircle2 size={12} className="text-green-400" />
          </div>
          <span className="text-xs font-bold tracking-wide">{toastMessage}</span>
        </div>
      </div>

      {/* --- TOP HEADER --- */}
      <div className="w-full max-w-[1600px] mx-auto z-40 relative">
        <header className="mx-4 md:mx-8 mt-4 bg-white/60 backdrop-blur-3xl border border-white/80 rounded-[2rem] px-4 md:px-8 py-3.5 flex items-center justify-between shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <Link to="/" className="flex items-center gap-3 z-10 group">
            <div className="bg-gradient-to-br from-[#ba0036] to-[#ff004c] p-2.5 rounded-xl shadow-[0_4px_15px_rgba(186,0,54,0.3)] group-hover:scale-105 transition-transform">
              <Building className="text-white" size={20} />
            </div>
            <h1 className="text-xl md:text-2xl font-black text-gray-900 tracking-tighter hidden sm:block">TO-LET <span className="text-[#ba0036]">PRO</span></h1>
          </Link>
          
          <div className="hidden lg:flex items-center gap-3 bg-white/50 px-5 py-2.5 rounded-2xl border border-white/80 w-full max-w-md focus-within:border-[#ba0036]/30 focus-within:bg-white focus-within:shadow-md transition-all">
            <Search size={16} className="text-gray-400" />
            <input type="text" placeholder={t?.searchPlaceholder || (language === 'বাংলা' ? "সার্চ করুন..." : "Search properties, commands...")} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="bg-transparent w-full outline-none text-[13px] font-bold text-gray-700 placeholder-gray-400" />
          </div>

          <div className="flex items-center gap-3 md:gap-4 z-10">
            <div className="relative" ref={langRef}>
              <button onClick={() => setIsLangMenuOpen(!isLangMenuOpen)} className="flex items-center gap-2 px-3 py-2 bg-white/60 rounded-xl hover:bg-white transition-all border border-white/80 shadow-sm group">
                <Globe size={16} className="text-gray-500 group-hover:text-[#ba0036] transition-colors" />
                <span className="md:hidden uppercase text-[10px] font-black text-gray-700">{language === 'বাংলা' ? 'BN' : 'EN'}</span>
                <span className="hidden md:block text-xs font-black text-gray-700">{language === 'বাংলা' ? 'বাংলা' : 'English'}</span>
              </button>
              {isLangMenuOpen && (
                <div className="absolute top-full right-0 mt-3 w-32 bg-white/90 backdrop-blur-2xl border border-white shadow-[0_20px_40px_rgba(0,0,0,0.1)] rounded-2xl p-1.5 z-[100] animate-in fade-in zoom-in-95">
                  <button onClick={() => { setLanguage('English'); setIsLangMenuOpen(false); }} className={`w-full text-left px-3 py-2 rounded-xl text-xs font-black transition-colors ${language === 'English' ? 'bg-[#ba0036]/10 text-[#ba0036]' : 'text-gray-600 hover:bg-gray-50'}`}>English</button>
                  <button onClick={() => { setLanguage('বাংলা'); setIsLangMenuOpen(false); }} className={`w-full text-left px-3 py-2 rounded-xl text-xs font-black transition-colors ${language === 'বাংলা' ? 'bg-[#ba0036]/10 text-[#ba0036]' : 'text-gray-600 hover:bg-gray-50'}`}>বাংলা</button>
                </div>
              )}
            </div>

            <div className="relative cursor-pointer" ref={notifRef}>
              <button onClick={() => setIsNotifOpen(!isNotifOpen)} className="p-2 bg-white/60 rounded-xl hover:bg-white transition-all border border-white/80 shadow-sm relative group">
                <Bell size={18} className="text-gray-500 group-hover:text-blue-600 transition-colors" />
                <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#ba0036] opacity-75"></span><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#ba0036] border-2 border-white"></span></span>
              </button>
              {isNotifOpen && (
                <div className="absolute top-full right-0 mt-3 w-72 bg-white/95 backdrop-blur-3xl border border-white shadow-[0_30px_60px_rgba(0,0,0,0.12)] rounded-[1.5rem] p-2 z-[100] animate-in fade-in zoom-in-95 origin-top-right">
                  <div className="p-3 border-b border-gray-50 flex justify-between items-center">
                    <h3 className="text-[13px] font-black text-gray-900 tracking-tight">{t?.notifications || (language === 'বাংলা' ? 'নোটিফিকেশন' : 'Notifications')}</h3>
                    <span className="bg-[#ba0036]/10 text-[#ba0036] px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest">1 {t?.new || (language === 'বাংলা' ? 'নতুন' : 'New')}</span>
                  </div>
                  <div className="p-1.5 space-y-1.5">
                    <div className="p-3 rounded-2xl bg-gray-50 border border-gray-100 cursor-pointer hover:bg-white hover:shadow-sm transition-all group">
                      <p className="text-xs font-bold text-gray-800 leading-tight mb-1.5 group-hover:text-[#ba0036] transition-colors">New inquiry for Elegant 3BHK</p>
                      <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1"><span className="w-1 h-1 bg-[#ba0036] rounded-full"></span> {t?.justNow || (language === 'বাংলা' ? 'এইমাত্র' : 'Just now')}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <button onClick={() => setIsProfileDrawerOpen(true)} className="flex items-center gap-2 p-1 pr-3 bg-white/60 rounded-xl border border-white/80 shadow-sm hover:shadow-md hover:bg-white transition-all active:scale-95">
              <div className="relative">
                <div className="w-8 h-8 rounded-full bg-[#ba0036] text-white flex items-center justify-center font-bold text-sm">{userData.fullName.charAt(0)}{userData.fullName.split(' ')[1]?.charAt(0)}</div>
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
              <div className="w-10 h-10 rounded-full bg-[#ba0036] text-white flex items-center justify-center font-bold text-lg group-hover:scale-105 transition-transform">{userData.fullName.charAt(0)}{userData.fullName.split(' ')[1]?.charAt(0)}</div>
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
             return (
              <button key={item.id} onClick={() => { if (item.isLink) navigate(item.path); else setActiveTab(item.id); setIsProfileDrawerOpen(false); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer font-bold text-xs text-left transition-all duration-300 ${isActive ? 'bg-red-50 text-[#ba0036]' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'}`}>
                <item.icon size={16} className={isActive ? "text-[#ba0036]" : "text-gray-400"} /> <span className="flex-1 tracking-wide">{item.label}</span>
              </button>
             )
          })}
          <div className="pt-2 pb-1"><div className="h-px w-full bg-gray-100"></div></div>
          <button onClick={() => {openModal('settings'); setIsProfileDrawerOpen(false);}} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-gray-500 hover:bg-gray-100 hover:text-gray-900 font-bold text-xs text-left transition-colors"><Settings size={16} className="text-gray-400"/> {t?.settings || (language === 'বাংলা' ? 'সেটিংস' : 'Settings')}</button>
          <button onClick={() => {openModal('support'); setIsProfileDrawerOpen(false);}} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-gray-500 hover:bg-gray-100 hover:text-gray-900 font-bold text-xs text-left transition-colors"><HelpCircle size={16} className="text-gray-400"/> {t?.support || (language === 'বাংলা' ? 'সাপোর্ট' : 'Support')}</button>
        </nav>

        <div className="p-5 border-t border-gray-100 bg-gray-50/50 flex flex-col gap-3 mt-auto">
          <button onClick={() => showToast(language === 'বাংলা' ? 'প্রিমিয়ামে আপগ্রেড হচ্ছে...' : 'Redirecting to Premium Upgrade...')} className="w-full bg-[#ba0036] hover:bg-[#90002a] text-white py-3 rounded-xl font-bold shadow-[0_8px_20px_rgba(186,0,54,0.25)] transition-all active:scale-95 text-[11px] tracking-wide uppercase">Upgrade to Premium</button>
          <button onClick={() => showToast(language === 'বাংলা' ? 'লগআউট হচ্ছে...' : 'Logging out...')} className="flex items-center justify-center gap-2 text-[#3b2a2a] hover:text-[#ba0036] font-bold transition-colors w-full py-1.5 group"><LogOut size={16} className="group-hover:-translate-x-1 transition-transform" /><span className="tracking-wider text-[11px] uppercase">Logout</span></button>
        </div>
      </div>

      {/* --- MAIN CONTENT --- */}
      <main className="flex-1 w-full max-w-[1600px] mx-auto px-4 md:px-8 lg:px-12 pt-6 md:pt-10 relative z-10 custom-scrollbar overflow-y-auto pb-24">
        
        {activeDropdownId && <div className="fixed inset-0 z-20" onClick={() => setActiveDropdownId(null)}></div>}

        {/* 🔴 PROFILE & VERIFICATION TAB */}
        {activeTab === 'profile' && (
          <div className="w-full mb-10 animate-in fade-in zoom-in-95 duration-500">
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 md:gap-8">
              
              <div className="xl:col-span-2 space-y-6 md:space-y-8">
                 <div className="bg-white rounded-[1.5rem] md:rounded-[2rem] p-6 md:p-8 flex flex-col sm:flex-row items-center sm:items-start gap-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)] relative overflow-hidden transition-all duration-300">
                    <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-red-50/50 rounded-l-full -z-0 hidden md:block"></div>
                    <div className="relative z-10 shrink-0">
                       <div className="w-24 h-24 rounded-full bg-[#ba0036] text-white flex items-center justify-center font-black text-4xl shadow-md">{userData.fullName.charAt(0)}{userData.fullName.split(' ')[1]?.charAt(0)}</div>
                       {isEditingProfile && <button onClick={()=> showToast('Upload Profile Picture')} className="absolute bottom-0 right-0 p-2 bg-white rounded-full shadow-md border border-gray-100 hover:bg-gray-50 transition-colors text-gray-600 cursor-pointer animate-bounce"><Camera size={14}/></button>}
                    </div>
                    <div className="flex-1 text-center sm:text-left relative z-10">
                       <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-2 justify-center sm:justify-start">
                          <h3 className="text-2xl md:text-3xl font-black text-gray-900">{userData.fullName}</h3>
                          {(verificationStatus.nidUploaded && verificationStatus.faceVerified) ? (
                             <span className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 w-max mx-auto sm:mx-0"><BadgeCheck size={12}/> Verified</span>
                          ) : (
                             <span className="bg-orange-100 text-orange-700 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 w-max mx-auto sm:mx-0"><Hourglass size={12}/> Pending</span>
                          )}
                       </div>
                       <p className="text-gray-500 font-medium text-sm">{userData.email}</p>
                       <p className="text-gray-500 font-medium text-sm">{userData.phone}</p>
                    </div>
                    
                    {!isEditingProfile ? (
                      <button onClick={handleEditToggle} className="w-full sm:w-auto bg-gray-100 hover:bg-gray-200 text-gray-800 px-6 py-3 rounded-xl font-bold text-xs transition-all relative z-10 flex items-center justify-center gap-2">
                         <Edit3 size={14} /> Edit Profile
                      </button>
                    ) : (
                      <div className="flex gap-2 w-full sm:w-auto z-10">
                         <button onClick={handleEditToggle} className="flex-1 sm:flex-none bg-gray-100 hover:bg-gray-200 text-gray-600 px-4 py-3 rounded-xl font-bold text-xs transition-all">Cancel</button>
                         <button onClick={handleProfileSave} className="flex-1 sm:flex-none bg-[#ba0036] hover:bg-[#90002a] text-white px-6 py-3 rounded-xl font-bold text-xs shadow-md transition-all flex items-center justify-center gap-2">
                            <Check size={14} /> Save Changes
                         </button>
                      </div>
                    )}
                 </div>

                 <div className={`bg-white rounded-[1.5rem] md:rounded-[2rem] p-6 md:p-8 shadow-[0_4px_20px_rgba(0,0,0,0.02)] border ${isEditingProfile ? 'border-[#ba0036]/30' : 'border-transparent'} transition-all duration-500`}>
                    <div className="flex items-center gap-3 mb-8">
                       <User className="text-[#ba0036]" size={20} />
                       <h4 className="text-lg font-black text-gray-900">Personal Information</h4>
                       {isEditingProfile && <span className="ml-auto text-[10px] font-bold text-[#ba0036] animate-pulse">Editing Mode</span>}
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-8">
                       <div>
                          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-2">Full Name</label>
                          <input type="text" disabled={!isEditingProfile} value={isEditingProfile ? tempUserData.fullName : userData.fullName} onChange={(e) => setTempUserData({...tempUserData, fullName: e.target.value})} className={`w-full border-b pb-2 outline-none bg-transparent font-medium transition-all ${isEditingProfile ? 'border-gray-300 text-gray-900 focus:border-[#ba0036]' : 'border-gray-100 text-gray-600'}`} />
                       </div>
                       <div>
                          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-2">Phone Number</label>
                          <input type="text" disabled={!isEditingProfile} value={isEditingProfile ? tempUserData.phone : userData.phone} onChange={(e) => setTempUserData({...tempUserData, phone: e.target.value})} className={`w-full border-b pb-2 outline-none bg-transparent font-medium transition-all ${isEditingProfile ? 'border-gray-300 text-gray-900 focus:border-[#ba0036]' : 'border-gray-100 text-gray-600'}`} />
                       </div>
                       <div className="md:col-span-2">
                          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-2">Email Address</label>
                          <input type="email" disabled={!isEditingProfile} value={isEditingProfile ? tempUserData.email : userData.email} onChange={(e) => setTempUserData({...tempUserData, email: e.target.value})} className={`w-full border-b pb-2 outline-none bg-transparent font-medium transition-all ${isEditingProfile ? 'border-gray-300 text-gray-900 focus:border-[#ba0036]' : 'border-gray-100 text-gray-600'}`} />
                       </div>
                       <div className="md:col-span-2">
                          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-2">Street Address</label>
                          <input type="text" disabled={!isEditingProfile} value={isEditingProfile ? tempUserData.address : userData.address} onChange={(e) => setTempUserData({...tempUserData, address: e.target.value})} className={`w-full border-b pb-2 outline-none bg-transparent font-medium transition-all ${isEditingProfile ? 'border-gray-300 text-gray-900 focus:border-[#ba0036]' : 'border-gray-100 text-gray-600'}`} />
                       </div>
                       <div>
                          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-2">City</label>
                          {isEditingProfile ? (
                            <select value={tempUserData.city} onChange={(e) => setTempUserData({...tempUserData, city: e.target.value})} className="w-full border-b border-gray-300 pb-2 outline-none focus:border-[#ba0036] bg-transparent text-gray-900 font-medium transition-colors cursor-pointer">
                               <option>Dhaka</option>
                               <option>Chittagong</option>
                               <option>Sylhet</option>
                            </select>
                          ) : (
                             <div className="w-full border-b border-gray-100 pb-2 font-medium text-gray-600">{userData.city}</div>
                          )}
                       </div>
                    </div>
                 </div>

                 <div className={`bg-white rounded-[1.5rem] md:rounded-[2rem] p-6 md:p-8 shadow-[0_4px_20px_rgba(0,0,0,0.02)] border ${isEditingProfile ? 'border-[#ba0036]/30' : 'border-transparent'} transition-all duration-500`}>
                    <div className="flex items-center gap-3 mb-8">
                       <Shield className="text-[#ba0036]" size={20} />
                       <h4 className="text-lg font-black text-gray-900">Identity Verification</h4>
                    </div>
                    
                    <div className="space-y-6">
                       {/* Step 1: NID */}
                       <div className="pb-4">
                         <div className="flex items-center justify-between mb-4">
                            <p className="text-sm font-bold text-gray-900 flex items-center gap-2"><span className="w-5 h-5 bg-gray-100 rounded-full flex items-center justify-center text-[10px] text-gray-500">1</span> NID Upload</p>
                            {uploadedDocs.nidFront && uploadedDocs.nidBack && <CheckCircle size={16} className="text-green-500" />}
                         </div>
                         <div className="ml-7">
                           <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div onClick={() => isEditingProfile && nidFrontRef.current.click()} className={`border-2 border-dashed rounded-2xl p-5 flex flex-col items-center justify-center text-center transition-all ${uploadedDocs.nidFront ? 'border-green-500 bg-green-50/30' : isEditingProfile ? 'border-gray-300 hover:border-[#ba0036] hover:bg-red-50/30 cursor-pointer' : 'border-gray-100 bg-gray-50 opacity-70'}`}>
                                 <input type="file" ref={nidFrontRef} className="hidden" onChange={() => handleFileUpload('nidFront')} accept="image/*" />
                                 {uploadedDocs.nidFront ? (
                                    <><CheckCircle className="text-green-500 mb-2" size={24} /><p className="text-xs font-bold text-green-700">NID Front Uploaded</p></>
                                 ) : (
                                    <><ImageIcon className={`${isEditingProfile ? 'text-[#ba0036]' : 'text-gray-400'} mb-2`} size={24} /><p className={`text-xs font-bold ${isEditingProfile ? 'text-gray-900' : 'text-gray-500'}`}>Upload NID Front</p></>
                                 )}
                              </div>

                              <div onClick={() => isEditingProfile && nidBackRef.current.click()} className={`border-2 border-dashed rounded-2xl p-5 flex flex-col items-center justify-center text-center transition-all ${uploadedDocs.nidBack ? 'border-green-500 bg-green-50/30' : isEditingProfile ? 'border-gray-300 hover:border-[#ba0036] hover:bg-red-50/30 cursor-pointer' : 'border-gray-100 bg-gray-50 opacity-70'}`}>
                                 <input type="file" ref={nidBackRef} className="hidden" onChange={() => handleFileUpload('nidBack')} accept="image/*" />
                                 {uploadedDocs.nidBack ? (
                                    <><CheckCircle className="text-green-500 mb-2" size={24} /><p className="text-xs font-bold text-green-700">NID Back Uploaded</p></>
                                 ) : (
                                    <><ImageIcon className={`${isEditingProfile ? 'text-[#ba0036]' : 'text-gray-400'} mb-2`} size={24} /><p className={`text-xs font-bold ${isEditingProfile ? 'text-gray-900' : 'text-gray-500'}`}>Upload NID Back</p></>
                                 )}
                              </div>
                           </div>
                         </div>
                       </div>

                       {/* Step 2: Face Verification */}
                       <div className="pt-4 border-t border-gray-100">
                         <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                               <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${(uploadedDocs.nidFront && uploadedDocs.nidBack) ? 'bg-[#ba0036] text-white' : 'bg-gray-100 text-gray-500'}`}>2</span>
                               <div>
                                  <p className="text-sm font-bold text-gray-900">Live Face Verification</p>
                                  <p className="text-[10px] text-gray-500">Take a selfie to match with your NID</p>
                               </div>
                            </div>
                            {uploadedDocs.selfie && <CheckCircle size={16} className="text-green-500" />}
                         </div>
                         
                         <div className="ml-7">
                           {!uploadedDocs.selfie ? (
                              <button 
                                 onClick={handleSelfieCapture}
                                 disabled={!isEditingProfile || (!uploadedDocs.nidFront || !uploadedDocs.nidBack)}
                                 className={`w-full py-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all ${(isEditingProfile && uploadedDocs.nidFront && uploadedDocs.nidBack) ? 'bg-[#ba0036] hover:bg-[#90002a] text-white shadow-md' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
                              >
                                 <ScanFace size={16} /> Take Live Selfie
                              </button>
                           ) : (
                              <div className="w-full py-4 rounded-xl bg-green-50 border border-green-200 flex items-center justify-center gap-2 text-green-700 font-bold text-xs">
                                 <CheckCircle2 size={16} /> Face Matched Successfully
                              </div>
                           )}
                           
                           {(isEditingProfile && (!uploadedDocs.nidFront || !uploadedDocs.nidBack)) && (
                             <p className="text-[10px] text-orange-500 font-bold bg-orange-50 p-3 rounded-lg border border-orange-100 mt-3"><Hourglass size={12} className="inline mr-1"/> Please complete Step 1 (NID Upload) to unlock Face Verification.</p>
                           )}
                         </div>
                       </div>

                    </div>
                 </div>
              </div>

              <div className="space-y-6 md:space-y-8">
                 <div className="bg-white rounded-[1.5rem] md:rounded-[2rem] p-6 md:p-8 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
                    <h4 className="text-lg font-black text-gray-900 mb-10 text-center">Verification Status</h4>
                    <div className="relative flex flex-col justify-center py-4">
                       <div className="absolute top-0 bottom-0 left-6 md:left-1/2 w-px bg-gray-100 md:-translate-x-1/2"></div>
                       
                       <div className="w-full flex md:justify-between items-center mb-8 relative z-10">
                          <div className="hidden md:block w-1/2 pr-6"></div>
                          <div className={`absolute left-6 md:relative md:left-auto -translate-x-1/2 md:translate-x-0 w-8 h-8 rounded-full border-2 bg-white flex items-center justify-center shrink-0 shadow-sm transition-colors ${verificationStatus.profileCompleted ? 'border-green-500' : 'border-gray-200'}`}>
                             {verificationStatus.profileCompleted && <Check size={14} className="text-green-500"/>}
                          </div>
                          <div className="w-full md:w-1/2 pl-14 md:pl-6">
                             <div className={`p-4 rounded-xl w-max border transition-colors ${verificationStatus.profileCompleted ? 'bg-green-50/50 border-green-100' : 'bg-gray-50 border-gray-100'}`}>
                                <p className="font-bold text-sm text-gray-900">Profile Completed</p>
                                <p className="text-[10px] text-gray-500 mt-1">Basic info provided.</p>
                             </div>
                          </div>
                       </div>

                       <div className="w-full flex md:justify-between items-center mb-8 relative z-10">
                          <div className="hidden md:flex w-1/2 pr-6 justify-end">
                             <div className={`p-4 rounded-xl w-max border text-right transition-colors ${verificationStatus.nidUploaded ? 'bg-green-50/50 border-green-100' : 'bg-gray-50 border-gray-100 opacity-50'}`}>
                                <p className="font-bold text-sm text-gray-900">NID Uploaded</p>
                                <p className="text-[10px] text-gray-500 mt-1">Front & Back received.</p>
                             </div>
                          </div>
                          <div className={`absolute left-6 md:relative md:left-auto -translate-x-1/2 md:translate-x-0 w-8 h-8 rounded-full border-2 bg-white flex items-center justify-center shrink-0 shadow-sm transition-colors ${verificationStatus.nidUploaded ? 'border-green-500' : 'border-gray-200'}`}>
                             {verificationStatus.nidUploaded && <Check size={14} className="text-green-500"/>}
                          </div>
                          <div className="w-full md:hidden pl-14">
                             <div className={`p-4 rounded-xl w-max border transition-colors ${verificationStatus.nidUploaded ? 'bg-green-50/50 border-green-100' : 'bg-gray-50 border-gray-100 opacity-50'}`}>
                                <p className="font-bold text-sm text-gray-900">NID Uploaded</p>
                                <p className="text-[10px] text-gray-500 mt-1">Front & Back received.</p>
                             </div>
                          </div>
                          <div className="hidden md:block w-1/2 pl-6"></div>
                       </div>

                       <div className="w-full flex md:justify-between items-center mb-8 relative z-10">
                          <div className="hidden md:block w-1/2 pr-6"></div>
                          <div className={`absolute left-6 md:relative md:left-auto -translate-x-1/2 md:translate-x-0 w-8 h-8 rounded-full border-2 bg-white flex items-center justify-center shrink-0 shadow-sm transition-colors ${verificationStatus.faceVerified ? 'border-green-500' : 'border-gray-200'}`}>
                             {verificationStatus.faceVerified && <Check size={14} className="text-green-500"/>}
                          </div>
                          <div className="w-full md:w-1/2 pl-14 md:pl-6">
                             <div className={`p-4 rounded-xl w-max border transition-colors ${verificationStatus.faceVerified ? 'bg-green-50/50 border-green-100' : 'bg-gray-50 border-gray-100 opacity-50'}`}>
                                <p className="font-bold text-sm text-gray-900">Face Verified</p>
                                <p className="text-[10px] text-gray-500 mt-1">Selfie matched.</p>
                             </div>
                          </div>
                       </div>

                       <div className="w-full flex md:justify-between items-center relative z-10">
                          <div className="hidden md:flex w-1/2 pr-6 justify-end">
                             <div className={`p-4 rounded-xl w-max border text-right transition-colors ${verificationStatus.underReview ? 'bg-orange-50/50 border-orange-200' : 'bg-gray-50 border-gray-100 opacity-50'}`}>
                                <p className={`font-bold text-sm ${verificationStatus.underReview ? 'text-orange-700' : 'text-gray-500'}`}>Under Review</p>
                                <p className="text-[10px] text-gray-500 mt-1">Admin verification pending.</p>
                             </div>
                          </div>
                          <div className={`absolute left-6 md:relative md:left-auto -translate-x-1/2 md:translate-x-0 w-8 h-8 rounded-full border-2 bg-white flex items-center justify-center shrink-0 shadow-sm transition-colors ${verificationStatus.underReview ? 'border-orange-400 animate-pulse' : 'border-gray-200'}`}>
                             {verificationStatus.underReview && <Hourglass size={14} className="text-orange-500"/>}
                          </div>
                          <div className="w-full md:hidden pl-14">
                             <div className={`p-4 rounded-xl w-max border transition-colors ${verificationStatus.underReview ? 'bg-orange-50/50 border-orange-200' : 'bg-gray-50 border-gray-100 opacity-50'}`}>
                                <p className={`font-bold text-sm ${verificationStatus.underReview ? 'text-orange-700' : 'text-gray-500'}`}>Under Review</p>
                                <p className="text-[10px] text-gray-500 mt-1">Admin verification pending.</p>
                             </div>
                          </div>
                          <div className="hidden md:block w-1/2 pl-6"></div>
                       </div>
                    </div>
                 </div>

                 <div className="bg-white rounded-[1.5rem] md:rounded-[2rem] p-6 md:p-8 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
                    <h4 className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-4">Additional Documents</h4>
                    <input type="file" ref={utilityRef} className="hidden" onChange={() => handleFileUpload('utilityBill')} accept="image/*,application/pdf" />
                    <div onClick={() => utilityRef.current.click()} className={`border rounded-2xl p-4 flex items-center justify-between cursor-pointer transition-all group ${uploadedDocs.utilityBill ? 'bg-green-50/50 border-green-200' : 'border-gray-200 hover:bg-gray-50'}`}>
                       <div className="flex items-center gap-4">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${uploadedDocs.utilityBill ? 'bg-green-100 text-green-600' : 'bg-gray-200/50 text-gray-600'}`}>
                            {uploadedDocs.utilityBill ? <CheckCircle size={18}/> : <FileText size={18}/>}
                          </div>
                          <div>
                             <p className="font-bold text-sm text-gray-900">{uploadedDocs.utilityBill ? 'Utility Bill Uploaded' : 'Utility Bill'}</p>
                             <p className="text-[10px] text-gray-500 mt-0.5">Recent gas/electric bill</p>
                          </div>
                       </div>
                       {!uploadedDocs.utilityBill && <button className="p-2 text-[#ba0036] group-hover:scale-110 transition-transform"><Upload size={18}/></button>}
                    </div>
                 </div>

              </div>
            </div>
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
                  value: properties.length, shadow: 'shadow-[0_4px_20px_rgba(186,0,54,0.08)]',
                  indicator: 'bg-[#ba0036]'
                },
                {
                  icon: TrendingUp, bg: 'bg-gradient-to-br from-emerald-50 to-green-100/60', iconColor: 'text-emerald-600',
                  label: language === 'বাংলা' ? 'অ্যাক্টিভ' : 'ACTIVE',
                  value: properties.filter(p => p.status === 'active').length, shadow: 'shadow-[0_4px_20px_rgba(16,185,129,0.08)]',
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
              <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6">
                {dashboardProperties.map((prop) => (
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

            {/* ৪. Smart Alerts & AI Insights — Premium Feature Cards */}
            <div>
              <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 px-1">{language === 'বাংলা' ? 'স্মার্ট ফিচারস' : 'Smart Features'}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                {/* Smart Alerts Card */}
                <button
                  onClick={() => navigate('/smart-alerts')}
                  className="group relative text-left bg-white rounded-[1.5rem] p-5 md:p-6 border border-red-100/80 shadow-[0_4px_20px_rgba(186,0,54,0.06)] hover:shadow-[0_12px_35px_rgba(186,0,54,0.13)] hover:-translate-y-1 transition-all duration-300 overflow-hidden w-full"
                >
                  <div className="absolute top-0 right-0 w-40 h-40 rounded-full -translate-y-1/2 translate-x-1/2 bg-gradient-to-br from-red-100 to-orange-50 blur-2xl opacity-60 pointer-events-none group-hover:opacity-90 transition-opacity duration-300"></div>

                  <div className="relative z-10 flex items-start gap-4">
                    <div className="shrink-0 w-12 h-12 md:w-14 md:h-14 rounded-2xl bg-gradient-to-br from-red-50 to-orange-50 border border-red-100 flex items-center justify-center shadow-sm group-hover:scale-110 group-hover:shadow-md transition-all duration-300">
                      <BellRing size={22} className="text-[#ba0036]" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="text-sm md:text-base font-black text-gray-900 tracking-tight">
                          {language === 'বাংলা' ? 'স্মার্ট অ্যালার্টস' : 'Smart Alerts'}
                        </h4>
                        <span className="shrink-0 text-[8px] font-black bg-[#ba0036]/10 text-[#ba0036] px-2 py-0.5 rounded-full uppercase tracking-widest border border-[#ba0036]/15">
                          2 {language === 'বাংলা' ? 'অ্যাক্টিভ' : 'Active'}
                        </span>
                      </div>
                      <p className="text-[11px] font-medium text-gray-500 leading-relaxed line-clamp-2">
                        {language === 'বাংলা'
                          ? 'ভাড়া মেয়াদ, পেমেন্ট ডিউ, এবং লিজ মেয়াদ সংক্রান্ত গুরুত্বপূর্ণ নোটিফিকেশন দেখুন।'
                          : 'View rent due dates, payment reminders, and lease expiry notifications all in one place.'}
                      </p>

                      <div className="mt-3 space-y-1.5">
                        <div className="flex items-center gap-2 bg-orange-50/80 border border-orange-100 rounded-xl px-3 py-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse shrink-0"></div>
                          <span className="text-[10px] font-bold text-orange-700 truncate">
                            {language === 'বাংলা' ? 'সারা ইসলামের ভাড়া ৩ দিনে বাকি' : "Sarah Islam's rent due in 3 days"}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 bg-blue-50/80 border border-blue-100 rounded-xl px-3 py-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0"></div>
                          <span className="text-[10px] font-bold text-blue-700 truncate">
                            {language === 'বাংলা' ? 'রহিম উদ্দিনের লিজ শীঘ্রই শেষ হবে' : "Rahim Uddin's lease expires soon"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="relative z-10 mt-4 pt-4 border-t border-red-50 flex items-center justify-between">
                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                      {language === 'বাংলা' ? 'সব অ্যালার্ট দেখুন' : 'View All Alerts'}
                    </span>
                    <div className="w-7 h-7 rounded-full bg-[#ba0036]/10 group-hover:bg-[#ba0036] flex items-center justify-center transition-all duration-300">
                      <ArrowLeft size={13} className="text-[#ba0036] group-hover:text-white rotate-180 group-hover:translate-x-0.5 transition-all duration-300" />
                    </div>
                  </div>
                </button>

                {/* AI Insights Card */}
                <button
                  onClick={() => navigate('/ai-insights')}
                  className="group relative text-left rounded-[1.5rem] p-5 md:p-6 hover:-translate-y-1 transition-all duration-300 overflow-hidden w-full"
                  style={{
                    background: 'linear-gradient(135deg, #0a0a1a 0%, #0d1535 55%, #130a2a 100%)',
                    border: '1px solid rgba(99,102,241,0.3)',
                    boxShadow: '0 4px 25px rgba(99,102,241,0.12), inset 0 1px 0 rgba(255,255,255,0.04)'
                  }}
                >
                  <div className="absolute top-0 right-0 w-48 h-48 rounded-full -translate-y-1/3 translate-x-1/3 blur-3xl pointer-events-none group-hover:opacity-80 transition-opacity duration-300" style={{background: 'radial-gradient(circle, rgba(99,102,241,0.35) 0%, transparent 70%)'}}></div>
                  <div className="absolute bottom-0 left-0 w-32 h-32 rounded-full translate-y-1/3 -translate-x-1/3 blur-2xl pointer-events-none" style={{background: 'radial-gradient(circle, rgba(236,72,153,0.25) 0%, transparent 70%)'}}></div>
                  <div className="absolute inset-0 opacity-[0.04] pointer-events-none" style={{backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 20px, rgba(99,102,241,0.6) 20px, rgba(99,102,241,0.6) 21px)'}}></div>

                  <div className="relative z-10 flex items-start gap-4">
                    <div
                      className="shrink-0 w-12 h-12 md:w-14 md:h-14 rounded-2xl flex items-center justify-center group-hover:scale-110 group-hover:shadow-[0_0_20px_rgba(99,102,241,0.5)] transition-all duration-300"
                      style={{background: 'linear-gradient(135deg, #6366f1, #ec4899)', boxShadow: '0 0 16px rgba(99,102,241,0.4)'}}
                    >
                      <Zap size={22} className="text-white fill-white/30"/>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="text-sm md:text-base font-black text-white tracking-tight">
                          {language === 'বাংলা' ? 'এআই ইনসাইটস' : 'AI Insights'}
                        </h4>
                        <span
                          className="shrink-0 text-[8px] font-black px-2 py-0.5 rounded-full tracking-widest uppercase"
                          style={{background: 'linear-gradient(135deg, rgba(99,102,241,0.35), rgba(236,72,153,0.35))', border: '1px solid rgba(99,102,241,0.4)', color: '#a5b4fc'}}
                        >
                          LIVE
                        </span>
                      </div>
                      <p className="text-[11px] font-medium leading-relaxed line-clamp-2" style={{color: 'rgba(255,255,255,0.55)'}}>
                        {language === 'বাংলা'
                          ? 'আপনার প্রপার্টির বাজার মূল্য, ভাড়া সুযোগ, এবং রেভিনিউ অপ্টিমাইজেশন সম্পর্কিত এআই বিশ্লেষণ দেখুন।'
                          : 'Explore AI-driven market analysis, rent optimization tips, and revenue forecasts for your portfolio.'}
                      </p>

                      <div className="mt-3 p-2.5 rounded-xl" style={{background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)'}}>
                        <p className="text-[9px] font-black uppercase tracking-widest mb-1.5" style={{color: '#a5b4fc'}}>
                          {language === 'বাংলা' ? 'মার্কেট সুযোগ' : 'Market Opportunity'}
                        </p>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1 rounded-full" style={{background: 'rgba(255,255,255,0.08)'}}>
                            <div className="h-full rounded-full w-3/4" style={{background: 'linear-gradient(90deg, #6366f1, #ec4899)'}}></div>
                          </div>
                          <span className="text-[9px] font-black shrink-0" style={{color: '#a5b4fc'}}>75%</span>
                        </div>
                        <p className="text-[10px] font-bold mt-1.5" style={{color: 'rgba(255,255,255,0.6)'}}>
                          {language === 'বাংলা' ? 'গুলশান ভাড়া ৮% বাড়ালে রেভিনিউ বাড়বে' : 'Increase Gulshan rent by 8% to boost revenue'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="relative z-10 mt-4 pt-4 flex items-center justify-between" style={{borderTop: '1px solid rgba(99,102,241,0.2)'}}>
                    <span className="text-[10px] font-black uppercase tracking-widest" style={{color: 'rgba(165,180,252,0.7)'}}>
                      {language === 'বাংলা' ? 'ইনসাইটস দেখুন' : 'Explore Insights'}
                    </span>
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center group-hover:scale-110 transition-all duration-300"
                      style={{background: 'linear-gradient(135deg, rgba(99,102,241,0.4), rgba(236,72,153,0.4))', border: '1px solid rgba(99,102,241,0.3)'}}
                    >
                      <ArrowLeft size={13} className="text-indigo-300 rotate-180 group-hover:translate-x-0.5 transition-transform duration-300" />
                    </div>
                  </div>
                </button>

              </div>
            </div>

          </div>
        )}

        {/* 🔴 DOCUMENT VAULT TAB */}
        {activeTab === 'documents' && (
          <div className="w-full animate-in fade-in zoom-in-95 duration-500">
            
            {!activeFolder ? (
              <>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
                   <div>
                     <h3 className="text-2xl md:text-3xl font-black text-gray-900 tracking-tight">
                       {language === 'বাংলা' ? 'ডকুমেন্ট ভল্ট' : 'Document Vault'}
                     </h3>
                     <p className="text-xs font-bold text-gray-500 mt-1">
                       {language === 'বাংলা' ? 'আপনার সকল ভাড়ার ডকুমেন্ট এক সুরক্ষিত জায়গায়' : 'All your rental documents in one secure place'}
                     </p>
                   </div>
                   <button onClick={() => openModal('upload_document')} className="w-full sm:w-auto bg-[#ba0036] hover:bg-[#90002a] text-white px-5 py-3 rounded-2xl font-black text-[11px] shadow-[0_4px_15px_rgba(186,0,54,0.25)] transition-all flex items-center justify-center gap-2 active:scale-95">
                     <Upload size={16} /> {language === 'বাংলা' ? 'আপলোড' : 'Upload'}
                   </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
                   {[
                     { id: 'agreements', icon: FileText, c: 'text-blue-500', bg: 'bg-blue-50', h: 'hover:bg-blue-50 hover:text-blue-600', en: 'Rental Agreements', bn: 'রেন্টাল এগ্রিমেন্ট', count: '4 documents', desc: '2 active, 1 upcoming, 1 expired' },
                     { id: 'nids', icon: ScanFace, c: 'text-green-500', bg: 'bg-green-50', h: 'hover:bg-green-50 hover:text-green-600', en: 'Tenant NID / IDs', bn: 'ভাড়াটিয়া NID / আইডি', count: '8 files', desc: 'All tenants' },
                     { id: 'payments', icon: Receipt, c: 'text-orange-500', bg: 'bg-orange-50', h: 'hover:bg-orange-50 hover:text-orange-600', en: 'Payment Records', bn: 'পেমেন্ট রেকর্ড', count: '24 receipts', desc: 'Last 12 months' },
                     { id: 'photos', icon: ImageIcon, c: 'text-purple-500', bg: 'bg-purple-50', h: 'hover:bg-purple-50 hover:text-purple-600', en: 'Property Photos', bn: 'প্রপার্টির ছবি', count: '60 images', desc: 'Across 5 properties' },
                     { id: 'legal', icon: Scale, c: 'text-red-500', bg: 'bg-red-50', h: 'hover:bg-red-50 hover:text-red-600', en: 'Legal Documents', bn: 'লিগ্যাল ডকুমেন্টস', count: '3 files', desc: 'NOC, ownership deeds' },
                     { id: 'inspections', icon: ClipboardCheck, c: 'text-teal-500', bg: 'bg-teal-50', h: 'hover:bg-teal-50 hover:text-teal-600', en: 'Inspection Reports', bn: 'ইন্সপেকশন রিপোর্ট', count: '6 reports', desc: 'Move-in / move-out' }
                   ].map((folder, i) => (
                     <div key={i} className="bg-white p-6 md:p-8 rounded-[2rem] shadow-[0_4px_20px_rgba(0,0,0,0.02)] border border-gray-50 hover:shadow-[0_15px_40px_rgba(0,0,0,0.06)] transition-all duration-300 group flex flex-col items-center text-center relative overflow-hidden">
                       <div className="absolute top-0 right-0 w-24 h-24 rounded-bl-full bg-gray-50/50 -z-0 group-hover:scale-110 transition-transform duration-500"></div>
                       
                       <div className={`w-16 h-16 ${folder.bg} ${folder.c} rounded-[1.2rem] flex items-center justify-center mb-5 group-hover:scale-110 group-hover:-translate-y-1 transition-all duration-300 relative z-10 shadow-sm`}>
                          <folder.icon size={28} strokeWidth={2.5} />
                       </div>
                       
                       <h4 className="text-[17px] font-black text-gray-900 mb-1.5 relative z-10">{language === 'বাংলা' ? folder.bn : folder.en}</h4>
                       <p className="text-[11px] font-bold text-gray-400 mb-1 relative z-10">{folder.count}</p>
                       <p className="text-[10px] font-medium text-gray-400 mb-6 relative z-10">{folder.desc}</p>
                       
                       <button onClick={() => setActiveFolder(folder)} className={`w-full py-3 bg-gray-50 text-gray-500 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors mt-auto relative z-10 ${folder.h}`}>
                         {language === 'বাংলা' ? 'সব দেখুন' : 'View All'}
                       </button>
                     </div>
                   ))}
                </div>
              </>
            ) : (
              <div className="animate-in slide-in-from-right-8 duration-300">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
                   <div className="flex items-center gap-4">
                     <button onClick={() => setActiveFolder(null)} className="w-10 h-10 bg-white border border-gray-200 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-50 hover:text-[#ba0036] transition-all shadow-sm active:scale-95">
                       <ArrowLeft size={18} />
                     </button>
                     <div>
                       <div className="flex items-center gap-2">
                         <activeFolder.icon size={18} className={activeFolder.c} />
                         <h3 className="text-2xl font-black text-gray-900 tracking-tight">
                           {language === 'বাংলা' ? activeFolder.bn : activeFolder.en}
                         </h3>
                       </div>
                       <p className="text-xs font-bold text-gray-500 mt-1">{activeFolder.count} available</p>
                     </div>
                   </div>
                   <button onClick={() => openModal('upload_document')} className="w-full sm:w-auto bg-gray-900 hover:bg-[#ba0036] text-white px-5 py-3 rounded-2xl font-black text-[11px] shadow-sm transition-all flex items-center justify-center gap-2 active:scale-95">
                     <Upload size={16} /> {language === 'বাংলা' ? 'নতুন ফাইল আপলোড' : 'Upload New File'}
                   </button>
                </div>

                <div className="bg-white rounded-[2rem] shadow-[0_4px_20px_rgba(0,0,0,0.02)] border border-gray-50 overflow-hidden">
                   <div className="hidden md:grid grid-cols-12 gap-4 p-5 bg-gray-50/80 border-b border-gray-100 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                     <div className="col-span-6">{language === 'বাংলা' ? 'ফাইলের নাম' : 'File Name'}</div>
                     <div className="col-span-3">{language === 'বাংলা' ? 'আপলোডের তারিখ' : 'Date Uploaded'}</div>
                     <div className="col-span-3 text-right">{language === 'বাংলা' ? 'অ্যাকশন' : 'Actions'}</div>
                   </div>
                   
                   <div className="divide-y divide-gray-50">
                     {[1, 2, 3, 4].map((item) => (
                       <div key={item} className="grid grid-cols-1 md:grid-cols-12 gap-4 p-5 items-center hover:bg-gray-50/50 transition-colors group">
                         <div className="col-span-1 md:col-span-6 flex items-center gap-4">
                           <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${activeFolder.bg} ${activeFolder.c}`}>
                             <File size={18} />
                           </div>
                           <div>
                             <p className="text-sm font-bold text-gray-900 group-hover:text-[#ba0036] transition-colors cursor-pointer">
                               {activeFolder.id === 'agreements' ? `Lease_Agreement_00${item}.pdf` : 
                                activeFolder.id === 'nids' ? `Tenant_ID_Front_00${item}.jpg` : 
                                activeFolder.id === 'payments' ? `Rent_Receipt_MAY_00${item}.pdf` :
                                `Document_File_00${item}.pdf`}
                             </p>
                             <p className="text-[10px] font-medium text-gray-400 mt-0.5">2.4 MB • PDF Document</p>
                           </div>
                         </div>
                         <div className="col-span-1 md:col-span-3 text-xs font-bold text-gray-500">
                           Oct {10 + item}, 2026
                         </div>
                         <div className="col-span-1 md:col-span-3 flex items-center md:justify-end gap-2 mt-2 md:mt-0">
                           <button onClick={() => showToast('Opening preview...')} className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"><Eye size={16} /></button>
                           <button onClick={() => showToast('Downloading file...')} className="p-2 text-gray-400 hover:text-green-500 hover:bg-green-50 rounded-lg transition-colors"><Download size={16} /></button>
                           <button onClick={() => showToast('File moved to trash')} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={16} /></button>
                         </div>
                       </div>
                     ))}
                   </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 🔴 NEW: ANALYTICS OVERVIEW TAB */}
        {activeTab === 'analytics' && (
          <div className="w-full animate-in fade-in zoom-in-95 duration-500">
            <div className="flex justify-between items-center mb-6">
               <h3 className="text-2xl md:text-3xl font-black text-gray-900 tracking-tight">
                 {language === 'বাংলা' ? 'অ্যানালিটিক্স ওভারভিউ' : 'Analytics Overview'}
               </h3>
               <button onClick={() => openModal('select_year')} className="flex items-center gap-2 bg-white px-4 py-2 rounded-xl text-[11px] font-black text-gray-600 shadow-sm border border-gray-100 hover:bg-gray-50 transition-all active:scale-95">
                 <Calendar size={14}/> {language === 'বাংলা' ? 'এই বছর' : 'This Year'}
               </button>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="bg-white p-5 rounded-[1.5rem] shadow-[0_4px_15px_rgba(0,0,0,0.02)] border-t-4 border-blue-500">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{language === 'বাংলা' ? 'মোট আয় (YTD)' : 'Total Revenue (YTD)'}</p>
                <p className="text-2xl font-black text-gray-900">৳ ২৮.৪L</p>
                <p className="text-[10px] font-bold text-green-500 mt-2 flex items-center gap-1"><TrendingUp size={12}/> ↑ 18% YoY</p>
              </div>
              <div className="bg-white p-5 rounded-[1.5rem] shadow-[0_4px_15px_rgba(0,0,0,0.02)] border-t-4 border-green-500">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{language === 'বাংলা' ? 'গড় অকুপেন্সি' : 'Avg Occupancy Rate'}</p>
                <p className="text-2xl font-black text-gray-900">৮৭.৫%</p>
                <p className="text-[10px] font-bold text-green-500 mt-2 flex items-center gap-1"><TrendingUp size={12}/> ↑ 5% from last year</p>
              </div>
              <div className="bg-white p-5 rounded-[1.5rem] shadow-[0_4px_15px_rgba(0,0,0,0.02)] border-t-4 border-[#ba0036]">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{language === 'বাংলা' ? 'বাসা প্রতি গড় ভাড়া' : 'Avg Rent Per Property'}</p>
                <p className="text-2xl font-black text-gray-900">৳ ৭৮,৭৫০</p>
                <p className="text-[10px] font-bold text-green-500 mt-2 flex items-center gap-1"><TrendingUp size={12}/> ↑ 12% from last year</p>
              </div>
              <div className="bg-white p-5 rounded-[1.5rem] shadow-[0_4px_15px_rgba(0,0,0,0.02)] border-t-4 border-orange-400">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{language === 'বাংলা' ? 'মোট ভাড়াটিয়া' : 'Total Tenants Managed'}</p>
                <p className="text-2xl font-black text-gray-900">১২</p>
                <p className="text-[10px] font-bold text-gray-400 mt-2">All-time</p>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              <div className="xl:col-span-2 bg-white p-6 md:p-8 rounded-[2rem] shadow-[0_4px_20px_rgba(0,0,0,0.02)] border-none">
                <h4 className="text-lg font-black text-gray-900 mb-8">{language === 'বাংলা' ? 'মাসিক আয় - ২০২৬' : 'Monthly Revenue - 2026'}</h4>
                
                <div className="h-56 flex items-end justify-between gap-2 border-b border-gray-100 pb-2 relative">
                   <div className="absolute inset-0 flex flex-col justify-between pb-2 z-0 pointer-events-none">
                     <div className="w-full h-px bg-gray-50"></div>
                     <div className="w-full h-px bg-gray-50"></div>
                     <div className="w-full h-px bg-gray-50"></div>
                     <div className="w-full h-px bg-gray-50"></div>
                   </div>

                   {[
                     { m: 'Dec', h: 'h-[30%]', v: '180k' },
                     { m: 'Jan', h: 'h-[45%]', v: '220k' },
                     { m: 'Feb', h: 'h-[35%]', v: '195k' },
                     { m: 'Mar', h: 'h-[55%]', v: '240k' },
                     { m: 'Apr', h: 'h-[70%]', v: '262k' },
                     { m: 'May', h: 'h-[90%]', v: '315k', active: true }
                   ].map((item, i) => (
                     <div key={i} className="flex flex-col items-center gap-3 flex-1 relative z-10 group cursor-pointer">
                       <span className="text-[9px] font-black text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity absolute -top-6">{item.v}</span>
                       <div className={`w-full max-w-[40px] md:max-w-[50px] rounded-t-xl transition-all duration-500 ${item.h} ${item.active ? 'bg-gradient-to-t from-[#ba0036] to-[#ff004c]' : 'bg-gray-100 group-hover:bg-blue-100'}`}></div>
                       <span className={`text-[10px] font-black tracking-widest uppercase ${item.active ? 'text-[#ba0036]' : 'text-gray-400'}`}>{item.m}</span>
                     </div>
                   ))}
                </div>
              </div>

              <div className="bg-white p-6 md:p-8 rounded-[2rem] shadow-[0_4px_20px_rgba(0,0,0,0.02)] border-none">
                <h4 className="text-lg font-black text-gray-900 mb-6">{language === 'বাংলা' ? 'টেন্যান্ট পেমেন্ট স্কোর' : 'Tenant Payment Scores'}</h4>
                
                <div className="space-y-6">
                  {[
                    { n: 'Mr. John Doe', i: 'JD', s: 92, c: 'text-green-500', bg: 'bg-green-500' },
                    { n: 'Sarah Islam', i: 'SI', s: 78, c: 'text-orange-500', bg: 'bg-orange-500' },
                    { n: 'Rahim Uddin', i: 'RU', s: 95, c: 'text-green-500', bg: 'bg-green-500' },
                    { n: 'Fatema Begum', i: 'FB', s: 65, c: 'text-red-500', bg: 'bg-red-500' },
                  ].map((tenant, i) => (
                    <div key={i} className="flex flex-col gap-2 group cursor-default">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black text-white ${tenant.bg}`}>{tenant.i}</div>
                          <span className="text-sm font-bold text-gray-800">{tenant.n}</span>
                        </div>
                        <span className={`text-sm font-black ${tenant.c}`}>{tenant.s}</span>
                      </div>
                      <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${tenant.bg} transition-all duration-1000 ease-out`} style={{ width: `${tenant.s}%` }}></div>
                      </div>
                    </div>
                  ))}
                </div>
                <button onClick={() => openModal('full_report')} className="w-full mt-6 py-3 rounded-xl border border-gray-100 text-[11px] font-black text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-all uppercase tracking-widest active:scale-95">
                  {language === 'বাংলা' ? 'সব রিপোর্ট দেখুন' : 'View Full Report'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 🔴 INQUIRIES TAB (Premium Independent Scroll Layout) */}
        {activeTab === 'inquiries' && (
          <div className="w-full animate-in fade-in zoom-in-95 duration-500">
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 lg:gap-10 items-start">
              
              <div className="xl:col-span-4 w-full flex flex-col gap-5">
                
                <div className="bg-gradient-to-br from-[#ba0036] to-[#ff004c] rounded-[2rem] p-8 text-white shadow-[0_15px_40px_rgba(186,0,54,0.2)] relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -translate-y-10 translate-x-10"></div>
                  <h3 className="text-2xl font-black mb-1 relative z-10">{language === 'বাংলা' ? 'আপনার পারফরম্যান্স' : 'Host Performance'}</h3>
                  <p className="text-white/80 text-[10px] font-bold uppercase tracking-widest mb-8 relative z-10">{language === 'বাংলা' ? 'এই মাসের ওভারভিউ' : 'This Month\'s Overview'}</p>
                  
                  <div className="space-y-6 relative z-10">
                    <div>
                      <p className="text-white/70 text-[9px] font-black uppercase tracking-widest mb-1">{language === 'বাংলা' ? 'রেসপন্স রেট' : 'Response Rate'}</p>
                      <p className="text-3xl font-black">{hostInsights.responseRate}</p>
                    </div>
                    <div>
                      <p className="text-white/70 text-[9px] font-black uppercase tracking-widest mb-1">{language === 'বাংলা' ? 'গড় রেসপন্স টাইম' : 'Avg. Response Time'}</p>
                      <p className="text-3xl font-black">{hostInsights.avgResponseTime} <span className="text-lg text-white/80">min</span></p>
                    </div>
                    <div>
                      <p className="text-white/70 text-[9px] font-black uppercase tracking-widest mb-1">{language === 'বাংলা' ? 'সাকসেস রেট' : 'Conversion Rate'}</p>
                      <p className="text-3xl font-black">{hostInsights.conversionRate}</p>
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
                   <h3 className="text-2xl md:text-3xl font-black text-gray-900 tracking-tight">
                     {t?.newInquiries || (language === 'বাংলা' ? 'নতুন যোগাযোগ' : 'New Inquiries')}
                   </h3>
                   <span className="bg-[#ba0036]/10 text-[#ba0036] px-5 py-2.5 rounded-full font-black text-[11px] tracking-wide border border-[#ba0036]/10">
                     {displayedInquiries.length} {t?.pending || (language === 'বাংলা' ? 'পেন্ডিং' : 'Pending')}
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
                                    <h4 className="text-lg md:text-xl font-black text-gray-900 leading-tight mb-1">{inquiry.user}</h4> 
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

                              {/* Primary CTA — convert inquiry into a booking + start the rent ledger.
                                  Premium-only; non-premium hosts see a Crown lock and the upgrade modal opens. */}
                              <button
                                onClick={() => openConvertInquiry(inquiry)}
                                className={`w-full py-3.5 md:py-4 rounded-2xl font-black text-[12px] md:text-[13px] shadow-[0_8px_20px_rgba(34,197,94,0.25)] hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2 ${isPremium ? 'bg-gradient-to-br from-green-600 to-emerald-500 hover:from-green-700 hover:to-emerald-600 text-white' : 'bg-gradient-to-br from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white'}`}
                              >
                                {isPremium ? <Sparkles size={16} /> : <Crown size={16} />}
                                {language === 'বাংলা' ? 'বুকিং-এ কনভার্ট করুন' : 'Convert to Booking'}
                              </button>

                              <button onClick={() => openModal('update_inquiry', inquiry)} className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-2xl font-black text-[11px] md:text-[12px] shadow-[0_8px_20px_rgba(37,99,235,0.18)] hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2">
                                <Calendar size={14} /> {language === 'বাংলা' ? 'স্ট্যাটাস ও ভিজিট' : 'Update Status & Visit'}
                              </button>

                              <div className="grid grid-cols-2 gap-3">
                                <button onClick={() => openChatPanel(inquiry.chatId, { source: 'host-inquiries', tenantName: inquiry.user, tenantPhone: inquiry.phone, propertyTitle: inquiry.propTitle, prefillMessage: '' })} className="w-full bg-[#ba0036] hover:bg-[#90002a] text-white py-3.5 rounded-2xl font-bold text-[11px] shadow-[0_4px_15px_rgba(186,0,54,0.2)] transition-all flex items-center justify-center gap-1.5 border-none active:scale-95">
                                  <MessageSquare size={14} /> {t?.openMessage || (language === 'বাংলা' ? 'মেসেজ' : 'Message')}
                                </button>
                                <button onClick={() => handleCallUser(inquiry.phone, inquiry.id)} className="w-full bg-white text-gray-700 py-3.5 rounded-2xl font-bold text-[11px] hover:bg-gray-50 hover:text-[#ba0036] shadow-[0_4px_15px_rgba(0,0,0,0.03)] transition-all flex items-center justify-center gap-1.5 border border-gray-100">
                                  <Phone size={14} /> {t?.callUser || (language === 'বাংলা' ? 'কল' : 'Call')}
                                </button>
                              </div>

                              <button onClick={() => handleRemoveInquiry(inquiry.id)} className="w-full bg-white text-gray-500 py-2.5 rounded-2xl font-bold text-[11px] hover:bg-red-50 hover:text-red-600 transition-all flex items-center justify-center gap-1.5">
                                <Archive size={14} /> {t?.archive || (language === 'বাংলা' ? 'আর্কাইভ করুন' : 'Archive Inquiry')}
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
          const renderBookingRow = (booking) => {
            const stage = computeLeaseStage(booking, todayDate);
            const progress = computeBookingProgress(booking, todayDate);
            const next = daysUntilNextDue(booking, todayDate);
            const monthlyTotal = Number(booking.monthlyRent || 0) + Number(booking.serviceCharge || 0);
            const tenantsLabel = (booking.tenantsCount || 1) === 1
              ? (language === 'বাংলা' ? '১ ভাড়াটিয়া' : '1 Tenant')
              : (language === 'বাংলা' ? `${booking.tenantsCount} ভাড়াটিয়া` : `${booking.tenantsCount} Tenants`);
            const isExpanded = expandedBookingId === booking.id;
            const stageAvatar = stage === 'active' ? 'bg-gradient-to-br from-green-500 to-emerald-600'
                              : stage === 'notice' ? 'bg-gradient-to-br from-amber-500 to-orange-500'
                              : stage === 'draft'  ? 'bg-gradient-to-br from-blue-500 to-indigo-600'
                              : 'bg-gradient-to-br from-gray-400 to-gray-500';

            return (
              <div key={booking.id} className={`bg-white rounded-2xl shadow-[0_2px_10px_rgba(0,0,0,0.03)] border border-gray-100/80 overflow-hidden transition-all duration-300 ${isExpanded ? 'shadow-[0_8px_30px_rgba(0,0,0,0.08)]' : 'hover:shadow-[0_4px_20px_rgba(0,0,0,0.05)]'}`}>

                {/* Compact row — always visible */}
                <button
                  type="button"
                  onClick={() => setExpandedBookingId(isExpanded ? null : booking.id)}
                  className="w-full flex items-center gap-2.5 sm:gap-3 px-3 sm:px-4 py-3 text-left hover:bg-gray-50/50 transition-colors"
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
                  <div className="shrink-0 p-1.5 rounded-lg bg-gray-50 text-gray-400">
                    {isExpanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                  </div>
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
                          onClick={() => openChatPanel(booking.chatId, { source: 'host-bookings', tenantName: booking.tenant, tenantPhone: booking.tenantPhone, propertyTitle: booking.property })}
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

              {/* ── LEFT RAIL — full hero on desktop, collapsed banner on mobile ── */}
              <aside className="xl:col-span-4 w-full flex flex-col gap-3 xl:gap-5 xl:h-full xl:pt-1 xl:pb-4">

                {/* Mobile: 1-line stats banner — tap to expand into KPI block.
                    Reclaims ~400px of vertical space on mobile so the host
                    sees the tenant list immediately on scroll. */}
                <div className="xl:hidden">
                  <button
                    type="button"
                    onClick={() => setBookingsStatsOpen(o => !o)}
                    className="w-full bg-gradient-to-r from-gray-900 to-gray-800 rounded-2xl px-4 py-3 text-white flex items-center justify-between gap-3 shadow-[0_8px_24px_rgba(0,0,0,0.15)]"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                        <Wallet size={16} className="text-white"/>
                      </div>
                      <div className="text-left min-w-0">
                        <p className="text-[8px] font-black text-white/50 uppercase tracking-widest">{language === 'বাংলা' ? 'মাসিক আয়' : 'Monthly Revenue'}</p>
                        <p className="text-sm font-black text-white tabular-nums truncate">{formatBDT(leaseSummary.totalMonthlyRevenue)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="bg-green-500/20 text-green-300 px-1.5 py-1 rounded-md text-[9px] font-black tabular-nums">{leaseSummary.activeCount}A</span>
                      {leaseSummary.noticeCount > 0 && <span className="bg-amber-500/20 text-amber-300 px-1.5 py-1 rounded-md text-[9px] font-black tabular-nums">{leaseSummary.noticeCount}N</span>}
                      {bookingsStatsOpen ? <ChevronUp size={14} className="text-white/70"/> : <ChevronDown size={14} className="text-white/70"/>}
                    </div>
                  </button>
                  {bookingsStatsOpen && (
                    <div className="mt-2 bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-4 text-white shadow-[0_8px_24px_rgba(0,0,0,0.15)] animate-in slide-in-from-top-2 fade-in duration-300">
                      <div className="grid grid-cols-2 gap-2.5 mb-3">
                        <div className="bg-white/5 rounded-xl p-2.5">
                          <p className="text-white/50 text-[8px] font-black uppercase tracking-widest mb-0.5">{stageLabel('active', language)}</p>
                          <p className="text-lg font-black text-green-400 tabular-nums">{leaseSummary.activeCount}</p>
                        </div>
                        <div className="bg-white/5 rounded-xl p-2.5">
                          <p className="text-white/50 text-[8px] font-black uppercase tracking-widest mb-0.5">{stageLabel('notice', language)}</p>
                          <p className="text-lg font-black text-amber-300 tabular-nums">{leaseSummary.noticeCount}</p>
                        </div>
                        <div className="bg-white/5 rounded-xl p-2.5">
                          <p className="text-white/50 text-[8px] font-black uppercase tracking-widest mb-0.5">{stageLabel('draft', language)}</p>
                          <p className="text-lg font-black text-blue-300 tabular-nums">{leaseSummary.draftCount}</p>
                        </div>
                        <div className="bg-white/5 rounded-xl p-2.5">
                          <p className="text-white/50 text-[8px] font-black uppercase tracking-widest mb-0.5">{stageLabel('done', language)}</p>
                          <p className="text-lg font-black text-white/70 tabular-nums">{leaseSummary.doneCount}</p>
                        </div>
                      </div>
                      <div className="bg-white/5 rounded-xl p-2.5">
                        <p className="text-white/50 text-[8px] font-black uppercase tracking-widest mb-0.5">{language === 'বাংলা' ? 'সিকিউরিটি ডিপোজিট' : 'Total Security Deposits'}</p>
                        <p className="text-base font-black text-white tabular-nums">{formatBDT(leaseSummary.totalSecurityDeposits)}</p>
                      </div>
                      <button
                        onClick={() => setActiveTab('rent')}
                        className="mt-3 w-full bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/30 rounded-xl px-3 py-2.5 text-emerald-300 text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <Wallet size={12}/> {language === 'বাংলা' ? 'ভাড়া কালেকশন খুলুন' : 'Open Rent Collection'} <ArrowUpRight size={11}/>
                      </button>
                    </div>
                  )}
                </div>

                {/* Desktop: full hero — keeps the original premium feel for ≥xl */}
                <div className="hidden xl:block bg-gradient-to-br from-gray-900 to-gray-800 rounded-[2rem] p-7 text-white shadow-[0_15px_40px_rgba(0,0,0,0.2)] relative overflow-hidden shrink-0">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -translate-y-10 translate-x-10"></div>
                  <div className="flex items-start justify-between mb-1 relative z-10">
                    <h3 className="text-2xl font-black">{language === 'বাংলা' ? 'ফাইন্যান্সিয়াল ওভারভিউ' : 'Financial Overview'}</h3>
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
                  <p className="text-white/50 text-[10px] font-bold uppercase tracking-widest mb-7 relative z-10">
                    {language === 'বাংলা' ? 'লিজ পোর্টফোলিও সারাংশ' : 'Lease Portfolio Snapshot'}
                  </p>
                  <div className="space-y-6 relative z-10">
                    <div>
                      <p className="text-white/50 text-[9px] font-black uppercase tracking-widest mb-1">{language === 'বাংলা' ? 'মোট মাসিক আয়' : 'Total Monthly Revenue'}</p>
                      <p className="text-4xl font-black text-white tracking-tight">{formatBDT(leaseSummary.totalMonthlyRevenue)}</p>
                      <p className="text-[9px] font-bold text-white/50 mt-1">{language === 'বাংলা' ? 'অ্যাক্টিভ + নোটিশ লিজ থেকে (ভাড়া + সার্ভিস)' : 'from active + notice leases (rent + service)'}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-white/5 rounded-2xl p-3">
                        <p className="text-white/50 text-[9px] font-black uppercase tracking-widest mb-1">{stageLabel('active', language)}</p>
                        <p className="text-2xl font-black text-green-400 tabular-nums">{leaseSummary.activeCount}</p>
                      </div>
                      <div className="bg-white/5 rounded-2xl p-3">
                        <p className="text-white/50 text-[9px] font-black uppercase tracking-widest mb-1">{stageLabel('notice', language)}</p>
                        <p className="text-2xl font-black text-amber-300 tabular-nums">{leaseSummary.noticeCount}</p>
                      </div>
                      <div className="bg-white/5 rounded-2xl p-3">
                        <p className="text-white/50 text-[9px] font-black uppercase tracking-widest mb-1">{stageLabel('draft', language)}</p>
                        <p className="text-2xl font-black text-blue-300 tabular-nums">{leaseSummary.draftCount}</p>
                      </div>
                      <div className="bg-white/5 rounded-2xl p-3">
                        <p className="text-white/50 text-[9px] font-black uppercase tracking-widest mb-1">{stageLabel('done', language)}</p>
                        <p className="text-2xl font-black text-white/70 tabular-nums">{leaseSummary.doneCount}</p>
                      </div>
                    </div>
                    <div className="bg-white/5 rounded-2xl p-3">
                      <p className="text-white/50 text-[9px] font-black uppercase tracking-widest mb-1">{language === 'বাংলা' ? 'মোট সিকিউরিটি ডিপোজিট' : 'Total Security Deposits'}</p>
                      <p className="text-xl font-black text-white tabular-nums">{formatBDT(leaseSummary.totalSecurityDeposits)}</p>
                      <p className="text-[9px] font-bold text-white/50 mt-1">{language === 'বাংলা' ? 'লিজ শেষে রিটার্নযোগ্য' : 'returnable at lease end'}</p>
                    </div>
                  </div>
                </div>

                {/* Desktop: lease status flow + Rent Collection CTA */}
                <div className="hidden xl:block bg-white rounded-[2rem] p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)] border-none shrink-0">
                  <h4 className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Activity size={14} className="text-gray-400" />
                    {language === 'বাংলা' ? 'লিজ স্ট্যাটাস ফ্লো' : 'Lease Status Flow'}
                  </h4>
                  <div className="space-y-3">
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
                  className="hidden xl:flex bg-emerald-50 hover:bg-emerald-100 border border-emerald-100 rounded-[2rem] p-5 shadow-[0_4px_20px_rgba(0,0,0,0.02)] items-center justify-between gap-3 transition-colors shrink-0 group"
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

              {/* ── RIGHT MAIN — sticky toolbar + accordion compact rows ────── */}
              <main className="xl:col-span-8 w-full flex flex-col xl:h-full xl:pt-1 min-w-0">

                {/* Sticky toolbar — search + filter pills + new-lease CTA. Stays
                    pinned at the top while the host scrolls the tenant list, so
                    filter context is never lost. Backdrop blur so list rows
                    elegantly fade behind it. */}
                <div className="sticky top-0 z-20 bg-gray-50/85 backdrop-blur-md -mx-3 sm:-mx-4 px-3 sm:px-4 pt-2 pb-3 mb-2 xl:mx-0 xl:px-0 xl:pt-1">
                  <div className="flex items-center gap-2 mb-2.5">
                    <h3 className="text-base sm:text-lg xl:text-2xl font-black text-gray-900 tracking-tight flex-1 truncate">
                      {language === 'বাংলা' ? 'লিজ ম্যানেজমেন্ট' : 'Lease Management'}
                      <span className="ml-1.5 text-[11px] font-bold text-gray-400 tabular-nums">{filtered.length}</span>
                    </h3>
                    <button
                      onClick={() => isPremium ? openBlankLease() : setActiveModal('premium_gate')}
                      className="bg-[#ba0036] hover:bg-[#90002a] text-white px-3 py-2 rounded-xl font-black text-[10px] shadow-[0_4px_12px_rgba(186,0,54,0.25)] transition-all flex items-center gap-1.5 active:scale-95 shrink-0"
                    >
                      {isPremium ? <Plus size={13}/> : <Crown size={13}/>}
                      <span className="hidden sm:inline">{language === 'বাংলা' ? 'নতুন লিজ' : 'New Lease'}</span>
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-0.5">
                    <div className="relative flex-1 min-w-[110px] max-w-[200px] sm:max-w-[240px] shrink-0">
                      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      <input
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={language === 'বাংলা' ? 'খুঁজুন...' : 'Search tenants...'}
                        className="w-full pl-7 pr-2 py-2 rounded-xl bg-white text-[11px] font-bold text-gray-900 shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-transparent focus:border-gray-200 focus:outline-none placeholder:text-gray-400"
                      />
                    </div>
                    {['all', 'draft', 'active', 'notice', 'done'].map(f => (
                      <button
                        key={f}
                        onClick={() => setLeaseStageFilter(f)}
                        className={`shrink-0 px-3 py-2 rounded-xl text-[10px] font-black capitalize transition-all whitespace-nowrap ${leaseStageFilter === f ? 'bg-gray-900 text-white shadow-[0_2px_8px_rgba(0,0,0,0.15)]' : 'bg-white text-gray-500 hover:text-gray-900 shadow-[0_2px_6px_rgba(0,0,0,0.03)]'}`}
                      >
                        {stageLabel(f, language)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex-1 xl:overflow-y-auto custom-scrollbar xl:pr-3 pb-24 space-y-2">
                  {filtered.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-2xl shadow-[0_2px_10px_rgba(0,0,0,0.02)] border-none">
                      <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                         <Calendar className="text-gray-300" size={26} />
                      </div>
                      <h3 className="text-sm font-black text-gray-900">{t?.noBookingsFound || (language === 'বাংলা' ? 'কোনো লিজ পাওয়া যায়নি।' : 'No leases found.')}</h3>
                      <p className="text-[10px] font-bold text-gray-500 mt-1.5 px-6">
                        {language === 'বাংলা' ? 'ইনকোয়ারি থেকে ভাড়াটিয়াকে অ্যাড করুন।' : 'Convert an inquiry into a booking to start.'}
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* "Needs Attention" pinned group — surfaces leases in their
                          renewal window (notice stage) so the host sees what
                          needs action without scrolling. Auto-hidden when the
                          stage filter is already narrowed. */}
                      {leaseStageFilter === 'all' && attentionLeases.length > 0 && (
                        <>
                          <div className="flex items-center gap-2 mt-1 px-1 pt-1">
                            <AlertCircle size={12} className="text-amber-600 shrink-0"/>
                            <span className="text-[10px] font-black text-amber-700 uppercase tracking-widest">
                              {language === 'বাংলা' ? 'এখনই দরকার' : 'Needs Attention'} · {attentionLeases.length}
                            </span>
                            <div className="flex-1 h-px bg-amber-200/60"/>
                          </div>
                          {attentionLeases.map((booking) => renderBookingRow(booking))}
                          {otherLeases.length > 0 && (
                            <div className="flex items-center gap-2 px-1 pt-3 pb-1">
                              <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                                {language === 'বাংলা' ? 'সকল লিজ' : 'All Leases'} · {otherLeases.length}
                              </span>
                              <div className="flex-1 h-px bg-gray-200"/>
                            </div>
                          )}
                          {otherLeases.map((booking) => renderBookingRow(booking))}
                        </>
                      )}
                      {!(leaseStageFilter === 'all' && attentionLeases.length > 0) && (
                        filtered.map((booking) => renderBookingRow(booking))
                      )}
                    </>
                  )}
                </div>
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
          const renderRentRow = (booking) => {
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
            const isExpanded = expandedRentId === booking.id;
            const collectedPctRow = expectedThisMonth > 0 ? Math.min(100, Math.round((paidThisMonth / expectedThisMonth) * 100)) : 0;

            return (
              <div key={booking.id} className={`bg-white rounded-2xl shadow-[0_2px_10px_rgba(0,0,0,0.03)] border border-gray-100/80 overflow-hidden transition-all duration-300 ${isExpanded ? 'shadow-[0_8px_30px_rgba(0,0,0,0.08)]' : 'hover:shadow-[0_4px_20px_rgba(0,0,0,0.05)]'}`}>

                {/* ── Compact row — always visible ──────────────────────── */}
                <button
                  type="button"
                  onClick={() => setExpandedRentId(isExpanded ? null : booking.id)}
                  className="w-full flex items-center gap-2.5 sm:gap-3 px-3 sm:px-4 py-3 text-left hover:bg-gray-50/50 transition-colors"
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
                  <div className="shrink-0 p-1.5 rounded-lg bg-gray-50 text-gray-400">
                    {isExpanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                  </div>
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
                        onClick={() => openChatPanel(booking.chatId, { source: 'host-rent', tenantName: booking.tenant, tenantPhone: booking.tenantPhone, propertyTitle: booking.property })}
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

              {/* ── LEFT RAIL — full hero on desktop, collapsed banner on mobile ── */}
              <aside className="xl:col-span-4 w-full flex flex-col gap-3 xl:gap-5 xl:h-full xl:pt-1 xl:pb-4">

                {/* Mobile: 1-line collection banner — tap to expand. */}
                <div className="xl:hidden">
                  <button
                    type="button"
                    onClick={() => setRentStatsOpen(o => !o)}
                    className="w-full bg-gradient-to-r from-gray-900 to-gray-800 rounded-2xl px-4 py-3 text-white flex items-center justify-between gap-3 shadow-[0_8px_24px_rgba(0,0,0,0.15)]"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                        <Receipt size={16} className="text-white"/>
                      </div>
                      <div className="text-left min-w-0">
                        <p className="text-[8px] font-black text-white/50 uppercase tracking-widest truncate">{monthFullLabel(sm.key, language)} · {language === 'বাংলা' ? 'কালেকশন' : 'Collection'}</p>
                        <p className="text-sm font-black text-white tabular-nums truncate">{formatBDT(sm.collectedTotal)} <span className="text-white/40 text-[10px] font-bold">/ {formatBDT(sm.expectedTotal)}</span></p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`px-2 py-1 rounded-md text-[9px] font-black tabular-nums ${collectedPct === 100 ? 'bg-green-500/20 text-green-300' : 'bg-white/10 text-white/80'}`}>{collectedPct}%</span>
                      {sm.overdueCount > 0 && <span className="bg-rose-500/30 text-rose-200 px-1.5 py-1 rounded-md text-[9px] font-black tabular-nums flex items-center gap-0.5"><AlertCircle size={9}/>{sm.overdueCount}</span>}
                      {rentStatsOpen ? <ChevronUp size={14} className="text-white/70"/> : <ChevronDown size={14} className="text-white/70"/>}
                    </div>
                  </button>
                  {rentStatsOpen && (
                    <div className="mt-2 bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-4 text-white shadow-[0_8px_24px_rgba(0,0,0,0.15)] animate-in slide-in-from-top-2 fade-in duration-300">
                      <div className="grid grid-cols-2 gap-2.5 mb-3">
                        <div className="bg-white/5 rounded-xl p-2.5">
                          <p className="text-white/50 text-[8px] font-black uppercase tracking-widest mb-0.5">{language === 'বাংলা' ? 'আদায় হয়েছে' : 'Collected'}</p>
                          <p className="text-base font-black text-green-400 tabular-nums">{formatBDT(sm.collectedTotal)}</p>
                          <p className="text-[8px] text-white/60 font-bold mt-0.5">{sm.paidCount}/{sm.totalDueCount}</p>
                        </div>
                        <div className="bg-white/5 rounded-xl p-2.5">
                          <p className="text-white/50 text-[8px] font-black uppercase tracking-widest mb-0.5">{language === 'বাংলা' ? 'বাকি' : 'Outstanding'}</p>
                          <p className="text-base font-black text-orange-400 tabular-nums">{formatBDT(sm.outstandingTotal)}</p>
                          <p className="text-[8px] text-white/60 font-bold mt-0.5">{sm.overdueCount} {language === 'বাংলা' ? 'বকেয়া' : 'overdue'}</p>
                        </div>
                      </div>
                      <div className="bg-white/5 rounded-xl p-2.5">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-white/50 text-[8px] font-black uppercase tracking-widest">{language === 'বাংলা' ? 'কালেকশন রেট' : 'Collection Rate'}</span>
                          <span className="text-[11px] font-black text-white tabular-nums">{collectedPct}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-gradient-to-r from-green-400 to-emerald-300 transition-all duration-700"
                               style={{ width: `${collectedPct}%` }} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Desktop: full hero card */}
                <div className="hidden xl:block bg-gradient-to-br from-gray-900 to-gray-800 rounded-[2rem] p-7 text-white shadow-[0_15px_40px_rgba(0,0,0,0.2)] relative overflow-hidden shrink-0">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -translate-y-10 translate-x-10"></div>
                  <div className="flex items-start justify-between mb-1 relative z-10">
                    <h3 className="text-2xl font-black">{language === 'বাংলা' ? 'শেয়ার্ড লেজার' : 'Shared Ledger'}</h3>
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
                  <p className="text-white/50 text-[10px] font-bold uppercase tracking-widest mb-7 relative z-10">
                    {monthFullLabel(sm.key, language)} · {language === 'বাংলা' ? 'এই মাসের আদায়' : "This Month's Collection"}
                  </p>
                  <div className="space-y-6 relative z-10">
                    <div>
                      <p className="text-white/50 text-[9px] font-black uppercase tracking-widest mb-1">{language === 'বাংলা' ? 'প্রত্যাশিত আয়' : 'Expected'}</p>
                      <p className="text-4xl font-black text-white tracking-tight">{formatBDT(sm.expectedTotal)}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-white/5 rounded-2xl p-3">
                        <p className="text-white/50 text-[9px] font-black uppercase tracking-widest mb-1">{language === 'বাংলা' ? 'আদায় হয়েছে' : 'Collected'}</p>
                        <p className="text-xl font-black text-green-400 tracking-tight">{formatBDT(sm.collectedTotal)}</p>
                        <p className="text-[9px] text-white/60 font-bold mt-1">{sm.paidCount}/{sm.totalDueCount} {language === 'বাংলা' ? 'ভাড়াটিয়া' : 'tenants'}</p>
                      </div>
                      <div className="bg-white/5 rounded-2xl p-3">
                        <p className="text-white/50 text-[9px] font-black uppercase tracking-widest mb-1">{language === 'বাংলা' ? 'বাকি' : 'Outstanding'}</p>
                        <p className="text-xl font-black text-orange-400 tracking-tight">{formatBDT(sm.outstandingTotal)}</p>
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
                  <div className="hidden xl:block bg-white rounded-[2rem] p-6 shadow-[0_4px_20px_rgba(0,0,0,0.02)] border-none shrink-0">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-[11px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                        <AlertCircle size={14} className="text-red-500" />
                        {language === 'বাংলা' ? 'বকেয়া ভাড়াটিয়া' : 'Overdue Tenants'}
                      </h4>
                      <span className="bg-red-50 text-red-600 px-2.5 py-1 rounded-lg text-xs font-black">{sm.overdueTenants.length}</span>
                    </div>
                    <div className="space-y-2">
                      {sm.overdueTenants.slice(0, 4).map(b => (
                        <div key={b.id} className="flex items-center justify-between gap-2 p-2 rounded-xl hover:bg-gray-50 transition-colors">
                          <button onClick={() => setExpandedRentId(b.id)} className="flex items-center gap-2.5 min-w-0 flex-1 text-left">
                            <div className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center text-[10px] font-black shrink-0">{b.tenantInit}</div>
                            <div className="min-w-0">
                              <p className="text-[11px] font-black text-gray-900 truncate">{b.tenant}</p>
                              <p className="text-[9px] font-bold text-gray-500 truncate">{formatBDT(b.monthlyRent)} · {b.property}</p>
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

                <div className="hidden xl:block bg-white rounded-[2rem] p-5 shadow-[0_4px_20px_rgba(0,0,0,0.02)] border-none shrink-0">
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

              {/* ── RIGHT MAIN — sticky toolbar + accordion compact rows ────── */}
              <main className="xl:col-span-8 w-full flex flex-col xl:h-full xl:pt-1 min-w-0">

                <div className="sticky top-0 z-20 bg-gray-50/85 backdrop-blur-md -mx-3 sm:-mx-4 px-3 sm:px-4 pt-2 pb-3 mb-2 xl:mx-0 xl:px-0 xl:pt-1">
                  <div className="flex items-center gap-2 mb-2.5">
                    <h3 className="text-base sm:text-lg xl:text-2xl font-black text-gray-900 tracking-tight flex-1 truncate">
                      {language === 'বাংলা' ? 'ভাড়া কালেকশন' : 'Rent Collection'}
                      <span className="ml-1.5 text-[11px] font-bold text-gray-400 tabular-nums">{filteredBookings.length}</span>
                    </h3>
                    <button onClick={() => showToast(language === 'বাংলা' ? 'এক্সপোর্ট হচ্ছে...' : 'Exporting...')} className="px-3 py-2 bg-white text-gray-700 rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.04)] text-[10px] font-black uppercase tracking-widest hover:bg-gray-50 transition-all flex items-center gap-1.5 active:scale-95 shrink-0">
                      <FileSpreadsheet size={12}/> <span className="hidden sm:inline">{language === 'বাংলা' ? 'এক্সপোর্ট' : 'Export'}</span>
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-0.5">
                    <div className="relative flex-1 min-w-[110px] max-w-[200px] sm:max-w-[240px] shrink-0">
                      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      <input
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={language === 'বাংলা' ? 'খুঁজুন...' : 'Search tenants...'}
                        className="w-full pl-7 pr-2 py-2 rounded-xl bg-white text-[11px] font-bold text-gray-900 shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-transparent focus:border-gray-200 focus:outline-none placeholder:text-gray-400"
                      />
                    </div>
                    {[
                      { id: 'all',      label: language === 'বাংলা' ? 'সকল' : 'All',         active: 'bg-gray-900 text-white shadow-[0_2px_8px_rgba(0,0,0,0.15)]', idle: 'bg-white text-gray-500 hover:text-gray-900 shadow-[0_2px_6px_rgba(0,0,0,0.03)]', count: bookings.length },
                      { id: 'overdue',  label: language === 'বাংলা' ? 'বকেয়া' : 'Overdue',  active: 'bg-rose-500 text-white shadow-[0_2px_8px_rgba(225,29,72,0.25)]',     idle: 'bg-rose-50 text-rose-700 hover:bg-rose-100',          count: counts.overdue || 0 },
                      { id: 'partial',  label: language === 'বাংলা' ? 'আংশিক' : 'Partial',  active: 'bg-amber-500 text-white shadow-[0_2px_8px_rgba(245,158,11,0.25)]', idle: 'bg-amber-50 text-amber-700 hover:bg-amber-100',       count: counts.partial || 0 },
                      { id: 'upcoming', label: language === 'বাংলা' ? 'আসন্ন' : 'Upcoming', active: 'bg-orange-500 text-white shadow-[0_2px_8px_rgba(249,115,22,0.25)]',idle: 'bg-orange-50 text-orange-700 hover:bg-orange-100',     count: counts.upcoming || 0 },
                      { id: 'cleared',  label: language === 'বাংলা' ? 'ক্লিয়ার্ড' : 'Cleared', active: 'bg-emerald-500 text-white shadow-[0_2px_8px_rgba(16,185,129,0.25)]',idle: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100', count: counts.cleared || 0 },
                    ].map(pill => (
                      <button
                        key={pill.id}
                        onClick={() => setRentPriorityFilter(pill.id)}
                        className={`shrink-0 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 whitespace-nowrap ${rentPriorityFilter === pill.id ? pill.active : pill.idle}`}
                      >
                        {pill.label}
                        <span className="text-[9px] font-black tabular-nums opacity-80">{pill.count}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex-1 xl:overflow-y-auto custom-scrollbar xl:pr-3 pb-24 space-y-2">
                  {filteredBookings.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-2xl shadow-[0_2px_10px_rgba(0,0,0,0.02)] border-none">
                      <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                         <Wallet className="text-gray-300" size={26} />
                      </div>
                      <h3 className="text-sm font-black text-gray-900">{language === 'বাংলা' ? 'কোনো রেকর্ড নেই' : 'No tenants in this filter'}</h3>
                      <p className="text-[10px] font-bold text-gray-500 mt-1.5 px-6">
                        {language === 'বাংলা' ? 'অন্য ফিল্টার বাছুন বা Bookings ট্যাবে নতুন লিজ যোগ করুন।' : 'Try another filter or add a lease in Bookings.'}
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* "Needs Attention" pinned group — overdue + partial. */}
                      {rentPriorityFilter === 'all' && attentionRent.length > 0 && (
                        <>
                          <div className="flex items-center gap-2 mt-1 px-1 pt-1">
                            <AlertCircle size={12} className="text-rose-600 shrink-0"/>
                            <span className="text-[10px] font-black text-rose-700 uppercase tracking-widest">
                              {language === 'বাংলা' ? 'এখনই দরকার' : 'Needs Attention'} · {attentionRent.length}
                            </span>
                            <div className="flex-1 h-px bg-rose-200/60"/>
                          </div>
                          {attentionRent.map(renderRentRow)}
                          {otherRent.length > 0 && (
                            <div className="flex items-center gap-2 px-1 pt-3 pb-1">
                              <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                                {language === 'বাংলা' ? 'অন্যান্য' : 'All Other Tenants'} · {otherRent.length}
                              </span>
                              <div className="flex-1 h-px bg-gray-200"/>
                            </div>
                          )}
                          {otherRent.map(renderRentRow)}
                        </>
                      )}
                      {!(rentPriorityFilter === 'all' && attentionRent.length > 0) && (
                        filteredBookings.map(renderRentRow)
                      )}
                    </>
                  )}
                </div>
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

            {filteredPropertiesByStatus.length === 0 ? (
              <div className="text-center py-20 bg-white rounded-[2rem] shadow-[0_4px_15px_rgba(0,0,0,0.02)]">
                <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-5"><Search className="text-gray-300" size={32} /></div>
                <h3 className="text-lg font-black text-gray-900">{t?.noPropsFound || (language === 'বাংলা' ? 'কোনো বাসা পাওয়া যায়নি।' : 'No properties found.')}</h3>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-5 lg:gap-8">
                {filteredPropertiesByStatus.map((prop) => (
                  <div key={prop.id} className="bg-white rounded-[1.5rem] md:rounded-[2rem] p-3 shadow-[0_4px_15px_rgba(0,0,0,0.02)] hover:shadow-[0_15px_35px_rgba(0,0,0,0.06)] transition-all duration-500 group flex flex-col cursor-default">
                    <div className="relative h-48 md:h-56 lg:h-64 overflow-hidden bg-gray-100 rounded-[1.2rem] md:rounded-[1.5rem]">
                      <div className="absolute inset-0 bg-cover bg-center transition-transform duration-[2s] ease-[cubic-bezier(0.25,0.46,0.45,0.94)] group-hover:scale-105" style={{ backgroundImage: `url(${prop.img})` }}></div>
                      <div className="absolute top-4 left-4 flex gap-2">
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
                      <div className="absolute bottom-4 right-4 bg-gray-900/90 backdrop-blur-xl px-4 py-2 md:px-5 md:py-2.5 rounded-[1rem] md:rounded-[1.2rem] font-black text-white shadow-lg text-sm md:text-[15px]">
                        ৳ {prop.price}
                      </div>
                    </div>
                    
                    <div className="px-3 md:px-4 py-4 md:py-5 flex-1 flex flex-col">
                      <h4 className="text-lg md:text-[19px] font-black text-gray-900 mb-1.5 leading-tight group-hover:text-[#ba0036] transition-colors line-clamp-1">{prop.title}</h4>
                      <p className="text-[11px] md:text-xs font-bold text-gray-500 flex items-center gap-1.5 mb-5"><MapPin size={12} className="text-[#ba0036]" /> {prop.location}</p>
                      
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
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
              </h3>
              <button onClick={() => setActiveModal(null)} className="p-2 bg-white hover:bg-red-50 hover:text-red-500 rounded-full transition-all shadow-sm"><X size={18} /></button>
            </div>

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

              {activeModal === 'send_reminders' && (
                <div className="space-y-4">
                  <div className="bg-red-50 p-4 rounded-2xl border border-red-100 flex items-start gap-3">
                    <BellRing size={20} className="text-[#ba0036] shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-black text-[#ba0036]">{language === 'বাংলা' ? '২ জন ভাড়াটিয়ার পেমেন্ট বকেয়া আছে' : '2 Tenants have pending dues'}</p>
                      <p className="text-[10px] font-bold text-red-700 mt-0.5">{language === 'বাংলা' ? 'মোট বকেয়া টাকার পরিমাণ: ৳ ১,৮৫,০০০' : 'Total pending amount: ৳ 1,85,000'}</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                     <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block">{language === 'বাংলা' ? 'যাদের রিমাইন্ডার পাঠানো হবে' : 'Recipients'}</label>
                     
                     <div className="flex justify-between items-center p-3 bg-gray-50 rounded-xl border border-gray-100">
                        <div className="flex items-center gap-3">
                          <input type="checkbox" defaultChecked className="w-4 h-4 rounded text-[#ba0036] focus:ring-[#ba0036] cursor-pointer" />
                          <div>
                            <p className="text-xs font-black text-gray-900">Sarah Islam</p>
                            <p className="text-[9px] font-bold text-gray-500">Due: ৳ 1,20,000</p>
                          </div>
                        </div>
                        <span className="text-[10px] font-black text-orange-600 bg-orange-100 px-2 py-1 rounded">3 Days Late</span>
                     </div>
                     
                     <div className="flex justify-between items-center p-3 bg-gray-50 rounded-xl border border-gray-100">
                        <div className="flex items-center gap-3">
                          <input type="checkbox" defaultChecked className="w-4 h-4 rounded text-[#ba0036] focus:ring-[#ba0036] cursor-pointer" />
                          <div>
                            <p className="text-xs font-black text-gray-900">Fatema Begum</p>
                            <p className="text-[9px] font-bold text-gray-500">Due: ৳ 65,000</p>
                          </div>
                        </div>
                        <span className="text-[10px] font-black text-orange-600 bg-orange-100 px-2 py-1 rounded">Pending</span>
                     </div>
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
              )}

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

              {activeModal === 'download_user_document' && (
                <div className="space-y-4">
                  <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 flex items-center gap-3 mb-2">
                    <div className="w-12 h-12 bg-blue-600 text-white rounded-xl flex items-center justify-center font-black text-lg shadow-inner">JD</div>
                    <div>
                      <p className="text-sm font-black text-gray-900">Mr. John Doe</p>
                      <p className="text-[10px] font-bold text-gray-500 mt-0.5">Elegant 3BHK with Skyline View</p>
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
              )}

              {activeModal === 'full_report' && (
                <div className="space-y-4">
                  <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
                    <h4 className="text-sm font-black text-blue-800 mb-1">{language === 'বাংলা' ? 'ভাড়াটিয়া পেমেন্ট হিস্ট্রি' : 'Tenant Payment History'}</h4>
                    <p className="text-[10px] font-bold text-blue-600">{language === 'বাংলা' ? 'গত ১২ মাসের বিস্তারিত রিপোর্ট' : 'Detailed report for the last 12 months'}</p>
                  </div>
                  <div className="space-y-3">
                     {[
                       { n: 'Mr. John Doe', s: language === 'বাংলা' ? 'সঠিক সময়ে পেইড (১২/১২)' : 'Paid on time (12/12)', score: 92, c: 'text-green-500' },
                       { n: 'Sarah Islam', s: language === 'বাংলা' ? 'বিলম্বিত পেমেন্ট (৩/১২)' : 'Late payments (3/12)', score: 78, c: 'text-orange-500' },
                       { n: 'Rahim Uddin', s: language === 'বাংলা' ? 'সঠিক সময়ে পেইড (৫/৫)' : 'Paid on time (5/5)', score: 95, c: 'text-green-500' },
                       { n: 'Fatema Begum', s: language === 'বাংলা' ? 'পেমেন্ট মিস (২/৪)' : 'Missed payments (2/4)', score: 65, c: 'text-red-500' },
                       { n: 'Kamrul Huda', s: language === 'বাংলা' ? 'সঠিক সময়ে পেইড (৮/৮)' : 'Paid on time (8/8)', score: 88, c: 'text-green-500' }
                     ].map((t, i) => (
                       <div key={i} className="flex justify-between items-center p-3 bg-gray-50 rounded-xl border border-gray-100">
                         <div>
                           <p className="text-xs font-black text-gray-900">{t.n}</p>
                           <p className="text-[9px] font-bold text-gray-500 mt-0.5">{t.s}</p>
                         </div>
                         <span className={`text-sm font-black ${t.c}`}>{t.score}</span>
                       </div>
                     ))}
                  </div>
                  <button onClick={() => { showToast(language === 'বাংলা' ? 'রিপোর্ট ডাউনলোড হচ্ছে...' : 'Downloading Report...'); setActiveModal(null); }} className="w-full mt-4 bg-gray-900 text-white py-4 rounded-xl font-black shadow-[0_8px_15px_rgba(0,0,0,0.1)] hover:bg-[#ba0036] transition-all text-sm flex items-center justify-center gap-2">
                    <Download size={18} /> {language === 'বাংলা' ? 'ডাউনলোড পিডিএফ' : 'Download PDF'}
                  </button>
                </div>
              )}
              
              {activeModal === 'update_inquiry' && modalData && (
                <div className="space-y-4">
                  <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 flex items-start gap-3">
                     <div className="bg-blue-100 w-10 h-10 rounded-full flex items-center justify-center text-blue-600 shrink-0 font-black">{modalData.init}</div>
                     <div>
                       <p className="text-sm font-black text-gray-900">{modalData.user}</p>
                       <p className="text-[10px] font-bold text-gray-500 mt-0.5">{modalData.propTitle}</p>
                     </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'বর্তমান স্ট্যাটাস' : 'Current Status'}</label>
                    <select className="w-full mt-1.5 p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(37,99,235,0.08)] border border-transparent focus:border-blue-500/20 transition-all cursor-pointer appearance-none">
                      <option value="new">{language === 'বাংলা' ? 'নতুন ইনকোয়ারি (New)' : 'New Inquiry'}</option>
                      <option value="contacted">{language === 'বাংলা' ? 'ফোনে কথা হয়েছে (Contacted)' : 'Contacted via Phone'}</option>
                      <option value="visit">{language === 'বাংলা' ? 'ভিজিট শিডিউল করা হয়েছে (Visit Scheduled)' : 'Visit Scheduled'}</option>
                      <option value="negotiation">{language === 'বাংলা' ? 'দরদাম চলছে (Negotiation)' : 'In Negotiation'}</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'ভিজিটের তারিখ ও সময়' : 'Visit Date & Time'}</label>
                    <input type="datetime-local" className="w-full mt-1.5 p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(37,99,235,0.08)] border border-transparent focus:border-blue-500/20 transition-all" />
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'ফলো-আপ নোটস' : 'Follow-up Notes'}</label>
                    <textarea rows="3" placeholder={language === 'বাংলা' ? 'যেমন: শুক্রবার বিকেলে সপরিবারে বাসা দেখতে আসবে...' : 'e.g. Coming with family on Friday afternoon...'} className="w-full mt-1.5 p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(37,99,235,0.08)] border border-transparent focus:border-blue-500/20 transition-all resize-none custom-scrollbar" />
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 pt-2">
                    <button onClick={() => { showToast(language === 'বাংলা' ? 'স্ট্যাটাস এবং নোট সেভ হয়েছে!' : 'Status & Notes Saved!'); setActiveModal(null); }} className="flex-[2] bg-blue-600 text-white py-4 rounded-xl font-black shadow-[0_8px_15px_rgba(37,99,235,0.2)] hover:-translate-y-0.5 hover:shadow-[0_12px_20px_rgba(37,99,235,0.3)] transition-all text-sm">
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
                    <button
                      onClick={() => { setIsPremium(true); setActiveModal(null); showToast(language === 'বাংলা' ? 'ডেমো প্রিমিয়াম চালু — এপিআই কানেক্ট করার সময় সরিয়ে নিন' : 'Demo premium enabled — remove when API is wired'); }}
                      className="w-full bg-gray-50 text-gray-500 py-2.5 rounded-xl font-bold text-[10px] hover:bg-gray-100 transition-all"
                    >
                      {language === 'বাংলা' ? 'ডেমো: প্রিমিয়াম চালু করুন' : 'Demo: enable premium for this session'}
                    </button>
                  </div>
                </div>
              )}

              {activeModal === 'edit' && modalData && (
                <div className="space-y-5">
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{t?.propertyTitleLabel || (language === 'বাংলা' ? 'প্রপার্টির নাম' : 'Property Title')}</label>
                    <input type="text" value={editForm.title} onChange={e => setEditForm(f => ({...f, title: e.target.value}))} className="w-full mt-1.5 p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(186,0,54,0.08)] transition-all border border-transparent focus:border-[#ba0036]/20" />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{t?.priceLabel || (language === 'বাংলা' ? 'মূল্য (টাকা)' : 'Price (BDT)')}</label>
                    <input type="text" value={editForm.price} onChange={e => setEditForm(f => ({...f, price: e.target.value}))} className="w-full mt-1.5 p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(186,0,54,0.08)] transition-all border border-transparent focus:border-[#ba0036]/20" />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{language === 'বাংলা' ? 'লোকেশন' : 'Location'}</label>
                    <input type="text" value={editForm.location} onChange={e => setEditForm(f => ({...f, location: e.target.value}))} className="w-full mt-1.5 p-4 bg-gray-50 rounded-xl text-sm font-bold text-gray-900 outline-none focus:bg-white focus:shadow-[0_4px_15px_rgba(186,0,54,0.08)] transition-all border border-transparent focus:border-[#ba0036]/20" />
                  </div>
                  <button onClick={() => {
                    if (!editForm.title.trim() || !editForm.price.trim()) { showToast(language === 'বাংলা' ? 'নাম এবং মূল্য আবশ্যক!' : 'Title and price are required!'); return; }
                    setProperties(prev => prev.map(p => p.id === modalData.id ? { ...p, title: editForm.title, price: editForm.price, location: editForm.location } : p));
                    showToast(language === 'বাংলা' ? 'প্রপার্টি আপডেট হয়েছে!' : 'Property Saved Successfully!');
                    setActiveModal(null);
                  }} className="w-full mt-6 bg-[#ba0036] text-white py-4 rounded-xl font-black shadow-[0_8px_15px_rgba(186,0,54,0.2)] hover:shadow-[0_12px_20px_rgba(186,0,54,0.3)] hover:-translate-y-0.5 transition-all text-sm flex items-center justify-center gap-2">
                    <Check size={16}/> {t?.saveChangesBtn || (language === 'বাংলা' ? 'সেভ করুন' : 'Save Changes')}
                  </button>
                </div>
              )}

              {activeModal === 'lease' && modalData && (
                <div className="text-center space-y-6">
                  <div className="w-20 h-20 bg-blue-50 text-blue-500 rounded-[1.2rem] flex items-center justify-center mx-auto mb-3 shadow-sm"><FileText size={32} /></div>
                  <div><h4 className="text-2xl font-black text-gray-900 leading-tight">{modalData.title}</h4><p className="text-gray-500 font-bold mt-1.5 text-xs">{t?.activeLeaseAgreement || (language === 'বাংলা' ? 'অ্যাক্টিভ লিজ এগ্রিমেন্ট' : 'Active Lease Agreement')}</p></div>
                  <div className="bg-gray-50 p-6 rounded-2xl text-left space-y-4">
                    <div className="flex justify-between items-center"><span className="text-gray-400 font-black text-[10px] uppercase tracking-widest">{t?.tenantLabel || (language === 'বাংলা' ? 'ভাড়াটিয়া' : 'Tenant')}</span> <span className="font-black text-gray-900 text-[15px]">Mr. John Doe</span></div>
                    <div className="flex justify-between items-center"><span className="text-gray-400 font-black text-[10px] uppercase tracking-widest">{t?.rentLabel || (language === 'বাংলা' ? 'ভাড়া' : 'Rent')}</span> <span className="font-black text-gray-900 text-[15px]">৳ {modalData.price || '85,000'}/mo</span></div>
                    <div className="flex justify-between items-center"><span className="text-gray-400 font-black text-[10px] uppercase tracking-widest">{t?.validUntilLabel || (language === 'বাংলা' ? 'মেয়াদ' : 'Valid Until')}</span> <span className="font-black text-green-600 bg-green-50 px-3 py-1 rounded-full text-xs">Dec 2026</span></div>
                  </div>
                  <button onClick={() => { showToast(language === 'বাংলা' ? 'ডাউনলোড হচ্ছে...' : 'Downloading Document...'); setActiveModal(null); }} className="w-full bg-gray-900 text-white py-4 rounded-xl font-black shadow-[0_8px_15px_rgba(0,0,0,0.1)] hover:bg-[#ba0036] transition-all text-sm">{t?.downloadPdfBtn || (language === 'বাংলা' ? 'পিডিএফ ডাউনলোড করুন' : 'Download PDF')}</button>
                </div>
              )}

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
