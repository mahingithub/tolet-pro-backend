/**
 * TenantSupport — Help & Support hub.
 *
 * Lives at `/tenant/support`. Pulls together every help surface the
 * tenant can reach:
 *
 *   - FAQs (collapsible)
 *   - Video tutorials (placeholder cards — embed real URLs later)
 *   - AI chat hand-off (toggles the existing GlobalAIAssistant)
 *   - Submit a ticket + track my tickets (wires to supportService)
 *   - Live agent chat (escalates through the same ticket pipeline)
 *   - Hotline phone number, WhatsApp link, email
 *   - Report a property / user
 *   - Tenant rights guide (Bangladesh)
 *   - Scam-awareness tips
 *
 * Each section is intentionally a card the user can land directly on
 * via the in-page tab strip at the top — mirrors the design of the
 * settings page so they feel like a matched pair.
 */
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  MessageCircle, PlayCircle, Sparkles, LifeBuoy, Phone,
  Mail, AlertTriangle, Shield, Flag, FileText, ChevronDown, Send,
  Loader2, BadgeCheck, ExternalLink,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useLanguage } from '../../context/LanguageContext';
import {
  openTicket, listMyTickets, onTicketsChanged,
} from '../../services/supportService.js';

const FAQ_DATA = [
  {
    cat: 'Booking',
    items: [
      { q: 'How do I book a property viewing?', a: 'Open the property → tap "Request a Tour" → pick a time slot. The landlord gets a notification immediately.' },
      { q: 'Can I cancel a tour?', a: 'Yes — from "Upcoming tours" on your dashboard, tap the tour and "Cancel". Free until 4 hours before the slot.' },
    ],
  },
  {
    cat: 'Payments',
    items: [
      { q: 'How does rent payment work?', a: 'Your landlord pushes a receipt to your Payments tab. Open it and tap "Pay now" to settle via bKash, Nagad, card, or bank transfer.' },
      { q: 'Where are my receipts?', a: 'Dashboard → Payments. Every receipt can be exported as a PDF for tax / proof-of-residence.' },
    ],
  },
  {
    cat: 'Profile',
    items: [
      { q: 'Why fill out the full profile?', a: "Landlords reply ~3× faster to fully-completed profiles. Income range + references are the highest-impact fields." },
      { q: 'Can I edit my photo later?', a: 'Yes — Profile → Edit → tap the camera tile.' },
    ],
  },
  {
    cat: 'Verification',
    items: [
      { q: 'What documents do I need?', a: 'NID front + back, a live selfie, and optionally income proof. Approvals usually take under 24 hours.' },
      { q: 'Is my data safe?', a: 'Documents are encrypted at rest and never shared with landlords directly — only your verification status is shown.' },
    ],
  },
  {
    cat: 'Visits',
    items: [
      { q: 'What if the landlord no-shows?', a: 'Report it from the tour card — we credit your account and add a strike to the landlord. Three strikes = account review.' },
    ],
  },
];

const TUTORIALS = [
  { title: 'How to verify your account in 3 minutes', minutes: 3 },
  { title: 'Finding the right neighborhood', minutes: 5 },
  { title: 'Negotiating rent with confidence', minutes: 4 },
];

const CardShell = ({ icon: Icon, title, subtitle, children, id }) => (
  <section id={id} className="bg-white rounded-2xl border border-gray-100 shadow-[0_8px_30px_-15px_rgba(0,0,0,0.08)] overflow-hidden scroll-mt-24">
    <header className="px-5 md:px-6 py-4 flex items-center gap-3 border-b border-gray-50 bg-gradient-to-r from-gray-50/50 to-white">
      <span className="w-9 h-9 rounded-xl bg-rose-50 text-[#ba0036] flex items-center justify-center shrink-0">
        <Icon size={17} />
      </span>
      <div className="min-w-0">
        <h2 className="text-sm md:text-base font-black text-gray-900 tracking-tight truncate">{title}</h2>
        {subtitle && <p className="text-[11px] font-bold text-gray-400 truncate">{subtitle}</p>}
      </div>
    </header>
    <div className="p-5 md:p-6">{children}</div>
  </section>
);

const FaqGroup = ({ data, bn }) => {
  const [open, setOpen] = useState(null);
  return (
    <div className="space-y-4">
      {data.map((g, gi) => (
        <div key={gi}>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#ba0036] mb-2">{g.cat}</p>
          <div className="space-y-1.5">
            {g.items.map((it, i) => {
              const key = `${gi}-${i}`;
              const isOpen = open === key;
              return (
                <div key={key} className="border border-gray-100 rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : key)}
                    className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-gray-50 transition-colors"
                  >
                    <span className="text-sm font-black text-gray-900">{it.q}</span>
                    <ChevronDown size={16} className={`text-gray-400 transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {isOpen && <p className="px-4 pb-4 text-[13px] font-bold text-gray-600 leading-relaxed">{it.a}</p>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

const TenantSupport = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { language } = useLanguage();
  const bn = language === 'বাংলা';

  const [tickets, setTickets] = useState([]);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(false);

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      const list = await listMyTickets();
      if (mounted) setTickets(list);
    };
    refresh();
    const unsub = onTicketsChanged(refresh);
    return () => { mounted = false; unsub(); };
  }, []);

  const submitTicket = async () => {
    if (!draft.trim()) return;
    setPosting(true);
    try {
      await openTicket({ initialMessage: draft.trim() });
      setDraft('');
      setPosted(true);
      setTimeout(() => setPosted(false), 1800);
    } finally {
      setPosting(false);
    }
  };

  const openAi = () => {
    window.dispatchEvent(new CustomEvent('tolet-open-ai-assistant'));
  };

  const sections = [
    { id: 'faqs', icon: LifeBuoy, label: bn ? 'FAQ' : 'FAQs' },
    { id: 'tutorials', icon: PlayCircle, label: bn ? 'টিউটোরিয়াল' : 'Tutorials' },
    { id: 'chat', icon: Sparkles, label: bn ? 'এআই চ্যাট' : 'AI chat' },
    { id: 'ticket', icon: MessageCircle, label: bn ? 'টিকিট' : 'Ticket' },
    { id: 'contact', icon: Phone, label: bn ? 'যোগাযোগ' : 'Contact' },
    { id: 'reports', icon: Flag, label: bn ? 'রিপোর্ট' : 'Reports' },
    { id: 'rights', icon: Shield, label: bn ? 'অধিকার' : 'Rights' },
    { id: 'scams', icon: AlertTriangle, label: bn ? 'স্ক্যাম' : 'Scam tips' },
  ];

  return (
    <div className="w-full mb-10 animate-in fade-in zoom-in-95 duration-500">
      <div className="max-w-[1100px] mx-auto">
        <h1 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900">{bn ? 'হেল্প ও সাপোর্ট' : 'Help & Support'}</h1>
        <p className="text-sm font-bold text-gray-500 mb-5">
          {bn ? 'উত্তর, গাইড, সরাসরি সাহায্য — সব এক জায়গায়।' : 'Answers, guides, and live help — all in one place.'}
        </p>

        {/* Quick jump tabs */}
        <div className="flex flex-wrap gap-2 mb-6 sticky top-[64px] z-10 bg-[#f6f7fb] py-2">
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-gray-200 text-[11px] font-black text-gray-700 hover:border-[#ba0036] hover:text-[#ba0036] transition-colors"
            >
              <s.icon size={12} /> {s.label}
            </a>
          ))}
        </div>

        <div className="grid gap-4 md:gap-5">
          {/* FAQs */}
          <CardShell id="faqs" icon={LifeBuoy} title={bn ? 'প্রায়শই জিজ্ঞাসিত প্রশ্ন' : 'Frequently asked questions'} subtitle={bn ? 'সবচেয়ে কমন প্রশ্নগুলো' : 'The most common questions'}>
            <FaqGroup data={FAQ_DATA} bn={bn} />
          </CardShell>

          {/* Tutorials */}
          <CardShell id="tutorials" icon={PlayCircle} title={bn ? 'ভিডিও টিউটোরিয়াল' : 'Video tutorials'} subtitle={bn ? 'দ্রুত শিখুন, ভালো ভাড়াটিয়া হন' : 'Quick how-tos and walk-throughs'}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {TUTORIALS.map((t, i) => (
                <div key={i} className="rounded-2xl border border-gray-100 bg-gradient-to-br from-gray-900 to-[#1a0a14] aspect-video flex items-end p-4 text-white relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                  <div className="absolute top-3 right-3 bg-white/10 backdrop-blur-sm rounded-full px-2 py-0.5 text-[10px] font-black">
                    {t.minutes} min
                  </div>
                  <PlayCircle size={40} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white/80" />
                  <p className="relative z-10 text-sm font-black leading-tight">{t.title}</p>
                </div>
              ))}
            </div>
          </CardShell>

          {/* AI chat */}
          <CardShell id="chat" icon={Sparkles} title={bn ? 'এআই অ্যাসিস্ট্যান্ট' : 'AI assistant'} subtitle={bn ? 'যেকোনো সময়, যেকোনো প্রশ্ন' : 'Anytime, any question'}>
            <p className="text-sm font-bold text-gray-600 mb-3 max-w-prose">
              {bn ? 'আমাদের এআই বাংলা ও ইংরেজি — দুই ভাষাতেই উত্তর দেয়। জটিল কেইসে সরাসরি লাইভ এজেন্টে এসকেলেট হয়।' : 'Our AI replies in both English and Bangla. Complex cases auto-escalate to a live agent.'}
            </p>
            <button
              onClick={openAi}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-gradient-to-r from-[#ff4d6d] via-[#ba0036] to-[#90002a] text-white text-xs font-black shadow-[0_12px_30px_-12px_rgba(255,77,109,0.55)] hover:shadow-[0_18px_40px_-12px_rgba(255,77,109,0.7)] transition-all"
            >
              <Sparkles size={14} /> {bn ? 'এআই খুলুন' : 'Open AI chat'}
            </button>
          </CardShell>

          {/* Ticket form */}
          <CardShell id="ticket" icon={MessageCircle} title={bn ? 'টিকিট খুলুন' : 'Open a support ticket'} subtitle={bn ? '২৪ ঘণ্টার মধ্যে উত্তর' : 'Replies within 24 hours'}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={bn ? 'কী সমস্যা হচ্ছে বিস্তারিত লিখুন...' : 'Describe what is going wrong...'}
              rows={4}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-sm font-bold text-gray-900 placeholder:text-gray-300 focus:outline-none focus:border-[#ba0036] focus:ring-2 focus:ring-[#ba0036]/15 transition-all resize-y"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-[11px] font-bold text-gray-400">{bn ? 'আপনার ইমেইল আমরা ব্যবহার করব: ' : 'We will reply to: '}<span className="text-gray-700">{user?.email || '—'}</span></p>
              <button
                onClick={submitTicket}
                disabled={posting || !draft.trim()}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gray-900 text-white text-xs font-black hover:bg-[#ba0036] transition-colors disabled:opacity-50"
              >
                {posting ? <Loader2 size={14} className="animate-spin" /> : posted ? <BadgeCheck size={14} /> : <Send size={14} />}
                {posting ? (bn ? 'পাঠানো হচ্ছে...' : 'Sending...') : posted ? (bn ? 'পাঠানো হয়েছে' : 'Sent') : (bn ? 'টিকিট জমা দিন' : 'Submit ticket')}
              </button>
            </div>

            {/* My tickets list */}
            <div className="mt-6 border-t border-gray-100 pt-5">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-gray-500 mb-3">{bn ? 'আমার টিকিট' : 'My tickets'} ({tickets.length})</p>
              {tickets.length === 0 ? (
                <p className="text-xs italic text-gray-400">{bn ? 'কোনো টিকিট নেই।' : 'No tickets yet.'}</p>
              ) : (
                <ul className="space-y-2">
                  {tickets.slice(0, 6).map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 bg-gray-50 rounded-xl px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-black text-gray-900 truncate">#{t.id.slice(-6).toUpperCase()} · {t.subject || (t.messages?.[0]?.text?.slice(0, 60) || 'Ticket')}</p>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t.status} · {new Date(t.createdAt).toLocaleDateString()}</p>
                      </div>
                      <span className={`text-[10px] font-black px-2 py-1 rounded-full uppercase tracking-widest ${t.status === 'resolved' ? 'bg-emerald-50 text-emerald-600' : t.status === 'open' ? 'bg-amber-50 text-amber-600' : 'bg-gray-100 text-gray-600'}`}>
                        {t.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardShell>

          {/* Contact */}
          <CardShell id="contact" icon={Phone} title={bn ? 'সরাসরি যোগাযোগ' : 'Reach us directly'}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <a href="tel:+8801700000000" className="flex items-center gap-3 p-4 rounded-2xl border border-gray-100 hover:border-[#ba0036] hover:bg-rose-50/40 transition-colors">
                <span className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center"><Phone size={18} /></span>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{bn ? 'হটলাইন' : 'Hotline'}</p>
                  <p className="text-sm font-black text-gray-900">+880 17 0000 0000</p>
                </div>
              </a>
              <a href="https://wa.me/8801700000000" target="_blank" rel="noreferrer" className="flex items-center gap-3 p-4 rounded-2xl border border-gray-100 hover:border-[#ba0036] hover:bg-rose-50/40 transition-colors">
                <span className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center"><MessageCircle size={18} /></span>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">WhatsApp</p>
                  <p className="text-sm font-black text-gray-900">+880 17 0000 0000</p>
                </div>
              </a>
              <a href="mailto:support@toletpro.com" className="flex items-center gap-3 p-4 rounded-2xl border border-gray-100 hover:border-[#ba0036] hover:bg-rose-50/40 transition-colors">
                <span className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center"><Mail size={18} /></span>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Email</p>
                  <p className="text-sm font-black text-gray-900">support@toletpro.com</p>
                </div>
              </a>
            </div>
            <button
              onClick={openAi}
              className="mt-4 inline-flex items-center gap-2 text-xs font-black text-[#ba0036] hover:text-[#90002a]"
            >
              <Sparkles size={12} /> {bn ? 'বা লাইভ এজেন্টে এসকেলেট করুন' : 'Or escalate to a live agent →'}
            </button>
          </CardShell>

          {/* Reports */}
          <CardShell id="reports" icon={Flag} title={bn ? 'রিপোর্ট' : 'Report a problem'} subtitle={bn ? 'প্রপার্টি বা ব্যবহারকারী রিপোর্ট করুন' : 'Report a property or user'}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button onClick={() => setDraft((d) => d || (bn ? 'একটি প্রপার্টি রিপোর্ট করতে চাই: ' : 'I want to report a property: '))} className="text-left p-4 rounded-2xl border border-gray-100 hover:border-[#ba0036] hover:bg-rose-50/40 transition-colors">
                <span className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center mb-3"><AlertTriangle size={18} /></span>
                <p className="text-sm font-black text-gray-900">{bn ? 'প্রপার্টি রিপোর্ট' : 'Report a property'}</p>
                <p className="text-[11px] font-bold text-gray-400 mt-1">{bn ? 'ভুল ছবি, ভুয়া দাম, প্রতারণা' : 'Fake images, wrong price, scam'}</p>
              </button>
              <button onClick={() => setDraft((d) => d || (bn ? 'একজন ব্যবহারকারী রিপোর্ট করতে চাই: ' : 'I want to report a user: '))} className="text-left p-4 rounded-2xl border border-gray-100 hover:border-[#ba0036] hover:bg-rose-50/40 transition-colors">
                <span className="w-10 h-10 rounded-xl bg-red-50 text-red-500 flex items-center justify-center mb-3"><Flag size={18} /></span>
                <p className="text-sm font-black text-gray-900">{bn ? 'ব্যবহারকারী রিপোর্ট' : 'Report a user'}</p>
                <p className="text-[11px] font-bold text-gray-400 mt-1">{bn ? 'হয়রানি, প্রতারণা, অনুপস্থিতি' : 'Harassment, fraud, no-shows'}</p>
              </button>
            </div>
          </CardShell>

          {/* Rights */}
          <CardShell id="rights" icon={Shield} title={bn ? 'ভাড়াটিয়ার অধিকার (বাংলাদেশ)' : 'Tenant rights (Bangladesh)'} subtitle={bn ? 'সংক্ষিপ্ত গাইড' : 'A short, plain-language guide'}>
            <ul className="space-y-2 text-sm font-bold text-gray-700 list-disc pl-5">
              <li>{bn ? 'ভাড়া বাড়ানোর জন্য কমপক্ষে ১৫ দিনের নোটিশ আবশ্যক।' : 'A 15-day written notice is required before any rent increase.'}</li>
              <li>{bn ? 'অগ্রিম জমা (সিকিউরিটি ডিপোজিট) লিজ শেষে ফেরতযোগ্য, প্রকৃত ক্ষতি বাদ দিয়ে।' : 'Security deposits must be returned at lease end, minus documented damages.'}</li>
              <li>{bn ? 'বাড়িওয়ালা পূর্ব নোটিশ ছাড়া ফ্ল্যাটে প্রবেশ করতে পারবেন না (জরুরি ব্যতীত)।' : 'Landlords cannot enter without prior notice except in genuine emergencies.'}</li>
              <li>{bn ? 'অননুমোদিত উচ্ছেদ থেকে আপনি সুরক্ষিত — আদালতের আদেশ দরকার।' : 'You are protected from unauthorised eviction — a court order is required.'}</li>
            </ul>
            <a href="https://bdlaws.minlaw.gov.bd/" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-black text-[#ba0036] hover:text-[#90002a]">
              {bn ? 'সরকারি আইন পড়ুন' : 'Read the official law'} <ExternalLink size={12} />
            </a>
          </CardShell>

          {/* Scams */}
          <CardShell id="scams" icon={AlertTriangle} title={bn ? 'স্ক্যাম থেকে সতর্ক থাকুন' : 'Stay safe from scams'} subtitle={bn ? 'লাল পতাকা চিনে নিন' : 'Spot the red flags'}>
            <ul className="space-y-2 text-sm font-bold text-gray-700 list-disc pl-5">
              <li>{bn ? 'কখনো ফ্ল্যাট না দেখে অগ্রিম পাঠাবেন না।' : 'Never send advance payments before physically viewing the property.'}</li>
              <li>{bn ? 'অস্বাভাবিক কম ভাড়ার লিস্টিংয়ে সতর্ক থাকুন।' : 'Be wary of listings priced far below the market.'}</li>
              <li>{bn ? 'বাড়িওয়ালার NID যাচাই করুন; ভেরিফায়েড ব্যাজ খুঁজুন।' : "Verify the landlord's NID and look for the verified badge."}</li>
              <li>{bn ? 'পেমেন্ট সবসময় অ্যাপের ভেতরের রসিদ থেকে করুন — কখনো ব্যক্তিগত ফোনে নয়।' : 'Always pay through receipts inside the app — never to a private phone number.'}</li>
            </ul>
          </CardShell>
        </div>
      </div>
    </div>
  );
};

export default TenantSupport;
