/**
 * subscriptionService.js
 * ──────────────────────────────────────────────────────────────────────────
 * Handles host subscription states, plans, and simulated checkouts via API.
 */

import { broadcast, subscribe as subscribeKey } from './_storage.js';

const KEY_SUBSCRIPTION = 'subscription:update';
const API = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api').replace(/\/$/, '');

let cachedStatus = { tier: 'guest', isPaid: false, isTrial: false, isExpired: false, daysRemaining: 0, trialEndsAt: null, plan: null };

export const PREMIUM_FEATURES = [
  'analytics',
  'documents',
  'bookings',
  'rent',
  'smartAlerts',
  'aiInsights',
];

const FEATURE_LABELS = {
  analytics:   { en: 'Analytics',        bn: 'অ্যানালিটিক্স' },
  documents:   { en: 'Home Management',  bn: 'হোম ম্যানেজমেন্ট' },
  bookings:    { en: 'Bookings',         bn: 'বুকিং' },
  rent:        { en: 'Rent Collection',  bn: 'ভাড়া কালেকশন' },
  smartAlerts: { en: 'Smart Alerts',     bn: 'স্মার্ট অ্যালার্টস' },
  aiInsights:  { en: 'AI Insights',      bn: 'এআই ইনসাইটস' },
};

export const PLANS = [
  {
    id: 'pro_monthly',
    name: { en: 'Pro Monthly', bn: 'প্রো মাসিক' },
    price: 999,
    currency: 'BDT',
    interval: 'month',
    intervalLabel: { en: '/month', bn: '/মাসিক' },
    popular: false,
    benefits: { en: ['All premium tabs', 'Cancel anytime', 'Email support'], bn: ['সব প্রিমিয়াম ট্যাব', 'যেকোনো সময় বাতিল', 'ইমেইল সাপোর্ট'] },
  },
  {
    id: 'pro_yearly',
    name: { en: 'Pro Yearly', bn: 'প্রো বার্ষিক' },
    price: 9999,
    currency: 'BDT',
    interval: 'year',
    intervalLabel: { en: '/year', bn: '/বছর' },
    popular: true,
    savings: { en: 'Save ~17%', bn: '~১৭% সাশ্রয়' },
    benefits: { en: ['All premium tabs', 'Priority support', '2 months free'], bn: ['সব প্রিমিয়াম ট্যাব', 'প্রায়োরিটি সাপোর্ট', '২ মাস ফ্রি'] },
  },
];

const getToken = () => window.localStorage.getItem('auth:token');

function authHeaders() {
  const t = getToken();
  return {
    'Content-Type': 'application/json',
    ...(t ? { Authorization: `Bearer ${t}` } : {}),
  };
}

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) {
    const err = new Error(data.message || 'অনুরোধে সমস্যা হয়েছে।');
    err.code = data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

function updateCache(dbSub) {
  if (!dbSub) {
    cachedStatus = { tier: 'guest', isPaid: false, isTrial: false, isExpired: false, daysRemaining: 0, trialEndsAt: null, plan: null };
  } else if (dbSub.status === 'active' && dbSub.currentPeriodEnd) {
    const msLeft = new Date(dbSub.currentPeriodEnd).getTime() - Date.now();
    const daysRemaining = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
    const planDef = PLANS.find(p => p.id === dbSub.planId) || { id: dbSub.planId, name: { en: 'Pro', bn: 'প্রো' } };
    
    cachedStatus = {
      tier: 'pro',
      plan: { id: planDef.id, name: planDef.name, interval: planDef.interval },
      isPaid: true,
      isTrial: false,
      isExpired: daysRemaining === 0,
      daysRemaining,
      paidThroughAt: dbSub.currentPeriodEnd,
      autoRenew: dbSub.autoRenew
    };
  } else if (dbSub.status === 'trialing' && dbSub.trialEndsAt) {
    const msLeft = new Date(dbSub.trialEndsAt).getTime() - Date.now();
    const daysRemaining = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
    cachedStatus = {
      tier: 'trial',
      plan: null,
      isPaid: false,
      isTrial: true,
      isExpired: daysRemaining === 0,
      daysRemaining,
      trialEndsAt: dbSub.trialEndsAt
    };
  } else {
    cachedStatus = { tier: 'expired', isPaid: false, isTrial: false, isExpired: true, daysRemaining: 0, trialEndsAt: null, plan: null };
  }
  broadcast(KEY_SUBSCRIPTION);
  return cachedStatus;
}

export const subscriptionService = {
  getStatus() {
    return cachedStatus;
  },

  async fetchStatus() {
    if (!getToken()) return cachedStatus;
    try {
      const data = await call('/billing/subscription');
      return updateCache(data.subscription);
    } catch (err) {
      console.error('[subscriptionService] fetch error:', err);
      return cachedStatus;
    }
  },

  getLockedFeatures() {
    return cachedStatus.isExpired ? [...PREMIUM_FEATURES] : [];
  },

  labelFor(featureId, lang = 'English') {
    const entry = FEATURE_LABELS[featureId];
    if (!entry) return featureId;
    return lang === 'বাংলা' ? entry.bn : entry.en;
  },

  async subscribe(planId) {
    const data = await call('/billing/checkout', {
      method: 'POST',
      body: { planId, paymentMethod: 'bKash' }
    });
    return updateCache(data.subscription);
  },

  async cancel() {
    const data = await call('/billing/cancel', { method: 'POST' });
    return updateCache(data.subscription);
  },

  onChange(listener) {
    return subscribeKey(KEY_SUBSCRIPTION, listener);
  },
};
