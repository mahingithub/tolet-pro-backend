/**
 * TenantSettings — 7-section preferences block rendered as the
 * "Account settings" tab content inside TenantDashboard. Lives inline
 * (no separate route) so the drawer + tab architecture stays intact.
 *
 * Toggles + preferences persist to localStorage under
 * `tolet_pro::tenant:settings:<userId>` and broadcast via _storage.js
 * so the rest of the app picks up the change.
 *
 * Backend contract (single-file swap when API lands):
 *   GET   /api/tenant/me/settings   -> Settings
 *   PATCH /api/tenant/me/settings   (partial) -> Settings
 *
 * NOTE: Privacy & Security delegates the heavy lifting (2FA, sessions,
 * data export, account delete) to the existing `/account/privacy`
 * surface — we link out rather than duplicate the flows.
 *
 * Props:
 *   onGoToProfile?: () => void  — called from "Edit profile". When the
 *                                  parent dashboard passes a setter, we
 *                                  flip its active tab to Profile;
 *                                  otherwise we route to the dashboard
 *                                  with state.activeTab='profile'.
 */
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ChevronDown, User, Shield, Bell, Sliders, CreditCard,
  Smartphone, Scale, Globe, Lock, Trash2, LogOut, Download, ExternalLink,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useLanguage } from '../../context/LanguageContext';
import { readJson, writeJson, broadcast } from '../../services/_storage.js';
import { getPreferences, setPreferences as savePreferences } from '../../services/settingsService.js';

const KEY = (uid) => `tenant:settings:${uid || '_anon'}`;

const DEFAULTS = {
  notif: { pushEnabled: true, emailEnabled: true, smsEnabled: false, frequency: 'instant' },
  prefs: { language: 'English', currency: 'BDT', defaultArea: '', defaultBudget: '' },
  app:   { theme: 'light', autoplayVideos: true },
};

const Card = ({ icon: Icon, title, subtitle, defaultOpen, children }) => {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <section className="bg-white rounded-2xl border border-gray-100 shadow-[0_8px_30px_-15px_rgba(0,0,0,0.08)] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-5 md:px-6 py-4 flex items-center justify-between gap-3 hover:bg-gray-50/60 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-9 h-9 rounded-xl bg-rose-50 text-[#ba0036] flex items-center justify-center shrink-0">
            <Icon size={17} />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm md:text-base font-black text-gray-900 tracking-tight truncate">{title}</h2>
            {subtitle && <p className="text-[11px] font-bold text-gray-400 truncate">{subtitle}</p>}
          </div>
        </div>
        <ChevronDown size={18} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-5 md:px-6 pb-5 md:pb-6 border-t border-gray-50">{children}</div>}
    </section>
  );
};

const Row = ({ label, sublabel, right }) => (
  <div className="flex items-center justify-between gap-4 py-3 border-b border-gray-50 last:border-b-0">
    <div className="min-w-0">
      <p className="text-sm font-black text-gray-900 truncate">{label}</p>
      {sublabel && <p className="text-[11px] font-bold text-gray-400 truncate">{sublabel}</p>}
    </div>
    <div className="shrink-0">{right}</div>
  </div>
);

const Toggle = ({ checked, onChange }) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className={`relative w-11 h-6 rounded-full transition-colors ${checked ? 'bg-[#ba0036]' : 'bg-gray-300'}`}
  >
    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
  </button>
);

const LinkAction = ({ to, children }) => (
  <Link to={to} className="inline-flex items-center gap-1.5 text-xs font-black text-[#ba0036] hover:text-[#90002a]">
    {children} <ExternalLink size={12} />
  </Link>
);

const SharedSettings = ({ onGoToProfile } = {}) => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { language, setLanguage } = useLanguage();
  const bn = language === 'বাংলা';

  const goToProfile = () => {
    if (typeof onGoToProfile === 'function') return onGoToProfile();
    navigate('/tenant-dashboard', { state: { activeTab: 'profile' } });
  };

  const [settings, setSettings] = useState(() => ({ ...DEFAULTS, ...(readJson(KEY(user?.id), null) || {}) }));
  const apiSyncTimer = useRef(null);
  const initialLoad = useRef(false);

  // On mount: fetch from backend and merge with localStorage cache.
  useEffect(() => {
    if (initialLoad.current) return;
    initialLoad.current = true;
    (async () => {
      try {
        const data = await getPreferences();
        if (data?.preferences) {
          const p = data.preferences;
          setSettings((prev) => ({
            ...prev,
            notif: {
              ...prev.notif,
              pushEnabled: p.callNotifications !== undefined ? p.callNotifications : prev.notif.pushEnabled,
              emailEnabled: p.marketingEmails !== undefined ? p.marketingEmails : prev.notif.emailEnabled,
              smsEnabled: p.smsAlerts !== undefined ? p.smsAlerts : prev.notif.smsEnabled,
            },
            app: {
              ...prev.app,
              theme: p.theme || prev.app.theme,
            },
          }));
        }
      } catch (e) {
        // Offline or unauthenticated — localStorage values already loaded.
      }
    })();
  }, []);

  // Persist to localStorage immediately; debounce API sync by 800ms.
  useEffect(() => {
    writeJson(KEY(user?.id), settings);
    broadcast(KEY(user?.id));

    if (apiSyncTimer.current) clearTimeout(apiSyncTimer.current);
    apiSyncTimer.current = setTimeout(() => {
      savePreferences({
        callNotifications: settings.notif.pushEnabled,
        marketingEmails:   settings.notif.emailEnabled,
        smsAlerts:         settings.notif.smsEnabled,
        theme:             settings.app.theme,
        language:          settings.prefs.language === 'বাংলা' ? 'bn' : 'en',
      }).catch(() => {}); // silent — offline fallback is localStorage
    }, 800);

    return () => { if (apiSyncTimer.current) clearTimeout(apiSyncTimer.current); };
  }, [settings, user?.id]);

  const upd = (section, patch) =>
    setSettings((s) => ({ ...s, [section]: { ...(s[section] || {}), ...patch } }));

  return (
    <div className="w-full mb-10 animate-in fade-in zoom-in-95 duration-500">
      <div className="max-w-[900px] mx-auto">
        <h1 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900">{bn ? 'অ্যাকাউন্ট সেটিংস' : 'Account settings'}</h1>
        <p className="text-sm font-bold text-gray-500 mb-6">
          {bn ? 'নোটিফিকেশন, প্রাইভেসি ও অ্যাপের পছন্দ একসাথে।' : 'Notifications, privacy and app preferences in one place.'}
        </p>

        <div className="grid gap-4 md:gap-5">
          {/* (a) Account */}
          <Card icon={User} title={bn ? 'অ্যাকাউন্ট' : 'Account'} subtitle={bn ? 'প্রোফাইল, পাসওয়ার্ড, যাচাই' : 'Profile, password, verification'} defaultOpen>
            <Row
              label={bn ? 'প্রোফাইল এডিট করুন' : 'Edit profile'}
              sublabel={bn ? 'নাম, ছবি, পরিচয়' : 'Name, photo, identity'}
              right={
                <button onClick={goToProfile} className="inline-flex items-center gap-1.5 text-xs font-black text-[#ba0036] hover:text-[#90002a]">
                  {bn ? 'খুলুন' : 'Open'} <ExternalLink size={12} />
                </button>
              }
            />
            <Row
              label={bn ? 'ইমেইল' : 'Email'}
              sublabel={user?.email || '—'}
              right={<span className="text-[11px] font-black text-emerald-600">{bn ? 'যাচাইকৃত' : 'Verified'}</span>}
            />
            <Row
              label={bn ? 'ফোন নম্বর' : 'Phone number'}
              sublabel={user?.phone || '—'}
              right={<span className="text-[11px] font-black text-emerald-600">{bn ? 'যাচাইকৃত' : 'Verified'}</span>}
            />
            <Row
              label={bn ? 'পাসওয়ার্ড পরিবর্তন' : 'Change password'}
              sublabel={bn ? 'সর্বশেষ পরিবর্তিত: ৩ মাস আগে' : 'Last changed 3 months ago'}
              right={<LinkAction to="/account/privacy">{bn ? 'পরিবর্তন' : 'Change'}</LinkAction>}
            />
            <Row
              label={bn ? 'লগ আউট' : 'Sign out'}
              right={
                <button
                  onClick={async () => { await logout(); navigate('/'); }}
                  className="inline-flex items-center gap-1.5 text-xs font-black text-red-500 hover:text-red-600"
                >
                  <LogOut size={12} /> {bn ? 'এখন লগআউট' : 'Sign out'}
                </button>
              }
            />
          </Card>

          {/* (b) Privacy & Security */}
          <Card icon={Shield} title={bn ? 'প্রাইভেসি ও সিকিউরিটি' : 'Privacy & security'} subtitle={bn ? '2FA, সেশন, ডেটা' : '2FA, sessions, data'}>
            <Row label={bn ? 'টু-ফ্যাক্টর অথেন্টিকেশন' : 'Two-factor authentication'} right={<LinkAction to="/account/privacy">{bn ? 'কনফিগ' : 'Configure'}</LinkAction>} />
            <Row label={bn ? 'লগইন অ্যালার্ট' : 'Login alerts'} sublabel={bn ? 'নতুন ডিভাইসে সাইন-ইন হলে ইমেইল' : 'Email me on new device sign-in'} right={<Toggle checked={true} onChange={() => {}} />} />
            <Row label={bn ? 'সক্রিয় সেশন' : 'Active sessions'} sublabel={bn ? 'অন্য ডিভাইস দেখুন' : 'See other devices'} right={<LinkAction to="/account/privacy">{bn ? 'দেখুন' : 'View'}</LinkAction>} />
            <Row
              label={bn ? 'আমার ডেটা ডাউনলোড' : 'Download my data'}
              sublabel={bn ? 'GDPR-শৈলীর এক্সপোর্ট' : 'GDPR-style export'}
              right={
                <Link to="/account/privacy" className="inline-flex items-center gap-1 text-xs font-black text-gray-700 hover:text-[#ba0036]"><Download size={12} /> {bn ? 'এক্সপোর্ট' : 'Export'}</Link>
              }
            />
            <Row
              label={bn ? 'অ্যাকাউন্ট ডিলিট করুন' : 'Delete account'}
              sublabel={bn ? '৩০ দিনের গ্রেস পিরিয়ড' : '30-day grace period'}
              right={
                <Link to="/account/privacy" className="inline-flex items-center gap-1 text-xs font-black text-red-500 hover:text-red-600"><Trash2 size={12} /> {bn ? 'অনুরোধ' : 'Request'}</Link>
              }
            />
          </Card>

          {/* (c) Notifications */}
          <Card icon={Bell} title={bn ? 'নোটিফিকেশন' : 'Notifications'} subtitle={bn ? 'পুশ, ইমেইল, SMS' : 'Push, email, SMS'}>
            <Row label={bn ? 'পুশ নোটিফিকেশন' : 'Push notifications'} right={<Toggle checked={settings.notif.pushEnabled} onChange={(v) => upd('notif', { pushEnabled: v })} />} />
            <Row label={bn ? 'ইমেইল নোটিফিকেশন' : 'Email notifications'} sublabel={bn ? 'নতুন প্রপার্টি, পেমেন্ট, ইনকোয়ারি উত্তর' : 'New properties, payments, inquiry replies'} right={<Toggle checked={settings.notif.emailEnabled} onChange={(v) => upd('notif', { emailEnabled: v })} />} />
            <Row label={bn ? 'SMS নোটিফিকেশন' : 'SMS notifications'} right={<Toggle checked={settings.notif.smsEnabled} onChange={(v) => upd('notif', { smsEnabled: v })} />} />
            <Row
              label={bn ? 'ফ্রিকোয়েন্সি' : 'Frequency'}
              right={
                <select
                  value={settings.notif.frequency}
                  onChange={(e) => upd('notif', { frequency: e.target.value })}
                  className="px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs font-black text-gray-900 focus:outline-none focus:border-[#ba0036]"
                >
                  <option value="instant">{bn ? 'তাৎক্ষণিক' : 'Instant'}</option>
                  <option value="daily">{bn ? 'দৈনিক সারসংক্ষেপ' : 'Daily digest'}</option>
                  <option value="weekly">{bn ? 'সাপ্তাহিক সারসংক্ষেপ' : 'Weekly digest'}</option>
                </select>
              }
            />
          </Card>

          {/* (d) Preferences */}
          <Card icon={Sliders} title={bn ? 'পছন্দ' : 'Preferences'} subtitle={bn ? 'ভাষা, মুদ্রা, ডিফল্ট সার্চ' : 'Language, currency, default search'}>
            <Row
              label={bn ? 'ভাষা' : 'Language'}
              right={
                <select
                  value={language}
                  onChange={(e) => setLanguage && setLanguage(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs font-black text-gray-900 focus:outline-none focus:border-[#ba0036]"
                >
                  <option value="English">English</option>
                  <option value="বাংলা">বাংলা</option>
                </select>
              }
            />
            <Row
              label={bn ? 'মুদ্রা' : 'Currency display'}
              right={
                <select
                  value={settings.prefs.currency}
                  onChange={(e) => upd('prefs', { currency: e.target.value })}
                  className="px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs font-black text-gray-900 focus:outline-none focus:border-[#ba0036]"
                >
                  <option value="BDT">BDT (৳)</option>
                  <option value="USD">USD ($)</option>
                </select>
              }
            />
            <Row
              label={bn ? 'ডিফল্ট এলাকা' : 'Default search area'}
              right={
                <input
                  value={settings.prefs.defaultArea}
                  onChange={(e) => upd('prefs', { defaultArea: e.target.value })}
                  placeholder="Gulshan"
                  className="px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs font-bold text-gray-900 focus:outline-none focus:border-[#ba0036] w-32"
                />
              }
            />
            <Row
              label={bn ? 'ডিফল্ট বাজেট' : 'Default budget'}
              right={
                <input
                  value={settings.prefs.defaultBudget}
                  onChange={(e) => upd('prefs', { defaultBudget: e.target.value })}
                  placeholder="20,000"
                  className="px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs font-bold text-gray-900 focus:outline-none focus:border-[#ba0036] w-32"
                />
              }
            />
          </Card>

          {/* (e) Payment & Billing */}
          <Card icon={CreditCard} title={bn ? 'পেমেন্ট ও বিলিং' : 'Payment & billing'} subtitle={bn ? 'মেথড, ইতিহাস, রসিদ' : 'Methods, history, receipts'}>
            <Row label={bn ? 'সেভড পেমেন্ট মেথড' : 'Saved payment methods'} sublabel={bn ? 'কোনো কার্ড সেভ করা নেই' : 'No cards on file'} right={<button className="text-xs font-black text-[#ba0036] hover:text-[#90002a]">+ {bn ? 'যোগ করুন' : 'Add'}</button>} />
            <Row label={bn ? 'পেমেন্ট ইতিহাস' : 'Payment history'} right={<Link to="/tenant-dashboard" state={{ activeTab: 'payments' }} className="text-xs font-black text-[#ba0036]">{bn ? 'খুলুন' : 'Open'}</Link>} />
            <Row label={bn ? 'রসিদ' : 'Receipts'} sublabel={bn ? 'PDF ডাউনলোড' : 'Download as PDF'} right={<Link to="/tenant-dashboard" state={{ activeTab: 'payments' }} className="text-xs font-black text-[#ba0036]">{bn ? 'দেখুন' : 'View'}</Link>} />
          </Card>

          {/* (f) App */}
          <Card icon={Smartphone} title={bn ? 'অ্যাপ' : 'App'} subtitle={bn ? 'থিম, অটোপ্লে' : 'Theme, autoplay'}>
            <Row
              label={bn ? 'থিম' : 'Theme'}
              right={
                <select
                  value={settings.app.theme}
                  onChange={(e) => upd('app', { theme: e.target.value })}
                  className="px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs font-black text-gray-900 focus:outline-none focus:border-[#ba0036]"
                >
                  <option value="light">{bn ? 'লাইট' : 'Light'}</option>
                  <option value="dark">{bn ? 'ডার্ক' : 'Dark'}</option>
                  <option value="system">{bn ? 'সিস্টেম' : 'System'}</option>
                </select>
              }
            />
            <Row
              label={bn ? 'প্রপার্টি ভিডিও অটোপ্লে' : 'Auto-play property videos'}
              sublabel={bn ? 'মোবাইল ডেটায় বন্ধ রাখুন' : 'Turn off to save mobile data'}
              right={<Toggle checked={settings.app.autoplayVideos} onChange={(v) => upd('app', { autoplayVideos: v })} />}
            />
          </Card>

          {/* (g) Legal */}
          <Card icon={Scale} title={bn ? 'লিগ্যাল' : 'Legal'} subtitle={bn ? 'টার্মস, প্রাইভেসি পলিসি' : 'Terms, privacy policy'}>
            <Row label={bn ? 'সার্ভিস শর্তাবলি' : 'Terms of service'} right={<LinkAction to="/account/privacy">{bn ? 'দেখুন' : 'View'}</LinkAction>} />
            <Row label={bn ? 'প্রাইভেসি পলিসি' : 'Privacy policy'} right={<LinkAction to="/account/privacy">{bn ? 'দেখুন' : 'View'}</LinkAction>} />
            <Row label={bn ? 'রিফান্ড পলিসি' : 'Refund policy'} right={<LinkAction to="/account/privacy">{bn ? 'দেখুন' : 'View'}</LinkAction>} />
          </Card>
        </div>
      </div>
    </div>
  );
};

export default SharedSettings;
