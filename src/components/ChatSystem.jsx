// ChatSystem.jsx
//
// Full-screen TO-LET PRO message centre. Re-written end-to-end for:
//   • Real responsive behaviour — full-screen master/detail on mobile,
//     two-pane on tablet, three-pane on desktop with a context rail.
//   • Cross-system rent-receipt cards rendered inline in the right thread,
//     fed by the same `tolet_payment_receipts` store HostDashboard writes to.
//   • Smart-reply chips (rule-based locally, swappable for an LLM endpoint).
//   • Message grouping, date dividers, status ticks (sent / delivered / read),
//     proper typing indicator, and full-bleed glassmorphic surfaces.
//
// Backward-compatible with every existing entry-point:
//   navigate('/messages', { state: { chatId, initialMessage, mode: 'call' }})  → still works.
//   navigate('/messages', { state: { chatId: 'ai-bot', initialMessage: '...' }}) → still works.
//   navigate('/messages', { state: { chatId, source: 'host-bookings', tenantName, tenantPhone, propertyTitle }}) → host CTA.
//   navigate('/messages', { state: { chatId, source: 'tenant-receipt', receiptId, propertyTitle, monthKey, prefillMessage }}) → tenant CTA.

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Send, Bot, Search, MoreVertical, Paperclip, Sparkles,
  CheckCheck, Check, Phone, Video, ArrowLeft, Smile, X, Mic, PhoneOff,
  UserPlus, Pin, Receipt, FileText, Hourglass, Info, ChevronRight,
  Download, MessageCircle, VolumeX,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Cross-system storage keys (mirrored on HostDashboard / TenantDashboard) ─
const CHAT_HISTORY_KEY        = 'tolet_chat_history';
const CHAT_THREADS_KEY        = 'tolet_chat_threads';        // dynamic threads created from location.state
const PAYMENT_RECEIPTS_KEY    = 'tolet_payment_receipts';
const PAYMENT_RECEIPTS_EVENT  = 'tolet-payment-receipts-updated';

// ─── Seed chats — kept as fallback so the page still works when nobody has
//     navigated in with a chatId. AI bot is always first. ────────────────────
const initialChats = [
  {
    id: 'ai-bot',
    name: 'TO-LET AI Bot',
    role: 'Smart Assistant',
    avatar: null,
    isAI: true,
    status: 'online',
    lastMsg: 'How can I help you today?',
    time: 'Just now',
    unread: 0,
    pinned: true,
  },
  {
    id: 1,
    name: 'Rahman Syndicate',
    role: 'Property Owner',
    avatar: 'https://ui-avatars.com/api/?name=Rahman+Syndicate&background=fce4ec&color=ba0036',
    isAI: false,
    status: 'online',
    lastMsg: 'Hello! How can I help you?',
    time: '10:30 AM',
    unread: 0,
    pinned: false,
  },
];

// ─── Local rule-based bot. Kept verbatim from previous version so the floating
//     GlobalAIAssistant hand-off keeps working. Swap with backend later. ─────
const getBotReply = (text) => {
  const lower = (text || '').toLowerCase();
  if (!lower.trim()) {
    return "I'm here whenever you're ready. Ask me about properties, rent, tours, or how to contact a landlord.";
  }
  if (/(hi|hello|hey|salam|assalam|হ্যালো|হাই)/i.test(lower)) {
    return "Hi! 👋 I'm the TO-LET PRO AI Assistant. I can help you find properties, schedule a tour, understand rent, or contact a landlord. What would you like to do?";
  }
  if (/(rent|ভাড়া|payment|পেমেন্ট|due|বকেয়া)/i.test(lower)) {
    return "For rent and payment questions: open your dashboard → 'Payments' (tenant) or 'Rent Collection' (host). Receipts arrive automatically when the landlord marks a month as paid. Need anything specific?";
  }
  if (/(tour|visit|ভিজিট|দেখ|appointment)/i.test(lower)) {
    return "To schedule a tour, open the property page and tap 'Request Tour'. The host gets notified instantly and approved tours appear in your dashboard's 'Upcoming Tours' section.";
  }
  if (/(contact|landlord|host|বাড়িওয়ালা|message)/i.test(lower)) {
    return "Tap 'Contact Host' on any property card or use the Messages tab from your dashboard. You can chat, voice-call, or video-call them from here.";
  }
  if (/(property|properties|flat|apartment|house|home|প্রপার্টি|বাসা|ফ্ল্যাট)/i.test(lower)) {
    return "We've got listings across Dhaka — Gulshan, Banani, Dhanmondi, Uttara, Mirpur and more. Use the Explore page filters (price, BHK, location) to narrow down. Want me to open Explore for you?";
  }
  if (/(price|cost|budget|দাম)/i.test(lower)) {
    return "Prices vary widely: studios from ৳18,000, family flats ৳35,000–৳1,20,000, premium suites ৳2,50,000+. Tell me your budget and area — I'll suggest options.";
  }
  if (/(thanks|thank you|ধন্যবাদ)/i.test(lower)) {
    return "You're welcome! Anything else I can help with? 🙂";
  }
  return "Got it. I'm still learning, but I can help with: 🏠 finding properties · 💸 rent & payments · 📅 tours · 📞 contacting landlords. Try asking about one of those.";
};

// ─── Smart-reply chips. Rule-based for now; the chip array is shaped exactly
//     like an LLM completion would deliver, so swapping in /api/ai/replies
//     later means changing one function. ────────────────────────────────────
const getSmartReplies = (lastIncoming, chat) => {
  if (!lastIncoming) {
    return chat?.isAI
      ? [
          { id: 'sr-find', text: 'Find me a 2-bed in Dhanmondi' },
          { id: 'sr-rent', text: 'Explain how rent receipts work' },
          { id: 'sr-tour', text: 'Schedule a tour this week' },
        ]
      : [
          { id: 'sr-greet', text: 'Hi, is this still available?' },
          { id: 'sr-tour',  text: 'Can I visit this weekend?' },
          { id: 'sr-rent',  text: 'Is the rent negotiable?' },
        ];
  }
  const t = (lastIncoming.text || '').toLowerCase();
  const out = [];
  if (/rent|ভাড়া|price|দাম/i.test(t))   out.push({ id: 'sr-neg',  text: 'Is the rent negotiable a bit?' });
  if (/tour|visit|ভিজিট|দেখ/i.test(t))    out.push({ id: 'sr-when', text: 'I can come Saturday morning' });
  if (/available|আছে/i.test(t))           out.push({ id: 'sr-yes',  text: "Great — I'd like to proceed" });
  if (/document|kyc|nid|ডকুমেন্ট/i.test(t)) out.push({ id: 'sr-doc',  text: "I'll send my NID + photo today" });
  if (/deposit|advance|অগ্রিম/i.test(t)) out.push({ id: 'sr-dep',  text: 'How much advance is required?' });
  if (out.length < 3) {
    out.push({ id: 'sr-call', text: 'Can we hop on a quick call?' });
    out.push({ id: 'sr-info', text: 'Could you share more details?' });
    out.push({ id: 'sr-thx',  text: 'Thanks for the info 🙂' });
  }
  return out.slice(0, 3);
};

// ─── Date helpers ────────────────────────────────────────────────────────────
const sameDay = (a, b) => {
  if (!a || !b) return false;
  const x = new Date(a), y = new Date(b);
  if (isNaN(x.getTime()) || isNaN(y.getTime())) return false;
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
};
const dayLabel = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yest))  return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
};
const formatBDT = (n) => `৳${(Number(n) || 0).toLocaleString('en-IN')}`;
const formatTime = (iso) => {
  if (!iso) return 'Just now';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso; // already a label like "Just now"
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// ─── Receipt card — rendered inline inside the message stream when a host has
//     marked a month paid. Visually consistent with TenantDashboard's
//     receipt-detail modal (blue = full, amber = partial). ────────────────────
const ReceiptCard = ({ receipt, mine, onView }) => {
  const isFull = receipt.status === 'full' || (Number(receipt.balance) || 0) <= 0;
  const grad = isFull
    ? 'from-blue-500 to-indigo-600'
    : 'from-amber-500 to-orange-600';
  return (
    <button
      onClick={() => onView?.(receipt)}
      className={`group relative text-left w-full max-w-[320px] rounded-2xl overflow-hidden shadow-[0_10px_30px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all border ${
        mine ? 'border-white/30' : 'border-gray-100'
      } bg-white`}
    >
      <div className={`relative px-4 py-3 text-white bg-gradient-to-br ${grad} overflow-hidden`}>
        <div className="absolute -top-8 -right-8 w-24 h-24 bg-white/20 rounded-full blur-2xl pointer-events-none"></div>
        <div className="relative flex items-center gap-2">
          {isFull ? <CheckCheck size={16} strokeWidth={3}/> : <Hourglass size={16} strokeWidth={2.5}/>}
          <p className="text-[9px] font-black uppercase tracking-[0.18em]">
            {isFull ? 'Rent Receipt · Full Paid' : 'Rent Receipt · Partial'}
          </p>
        </div>
        <p className="text-xl font-black tracking-tight mt-1.5 tabular-nums">
          {formatBDT(receipt.totalPaid)}
        </p>
        <p className="text-[10px] font-bold text-white/80 mt-0.5">
          {receipt.monthLabel || receipt.monthKey}{receipt.method ? ` · ${receipt.method}` : ''}
        </p>
      </div>

      <div className="px-4 py-3 space-y-1.5">
        <p className="text-[11px] font-black text-gray-900 line-clamp-1">{receipt.propertyTitle}</p>
        <div className="flex items-center justify-between text-[10px] font-bold text-gray-500">
          <span>Due {formatBDT(receipt.totalDue)}</span>
          <span className={(Number(receipt.balance) || 0) > 0 ? 'text-amber-600' : 'text-blue-600'}>
            {(Number(receipt.balance) || 0) > 0 ? `Balance ${formatBDT(receipt.balance)}` : 'Cleared'}
          </span>
        </div>
        <div className="flex items-center justify-between pt-1">
          <span className="text-[9px] font-black text-gray-300 font-mono truncate max-w-[60%]">{receipt.id}</span>
          <span className="text-[10px] font-black text-[#ba0036] flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
            View <ChevronRight size={11}/>
          </span>
        </div>
      </div>
    </button>
  );
};

// ─── Day divider that floats in the message stream ──────────────────────────
const DayDivider = ({ label }) => (
  <div className="flex items-center justify-center my-4">
    <span className="bg-white/80 backdrop-blur-md border border-gray-100 text-[9px] font-black uppercase tracking-[0.18em] text-gray-500 px-3 py-1.5 rounded-full shadow-sm">
      {label}
    </span>
  </div>
);

// ─── Animated typing dots ───────────────────────────────────────────────────
const TypingDots = ({ name = 'AI' }) => (
  <div className="flex justify-start">
    <div className="bg-gradient-to-br from-gray-900 to-[#1a1a1f] text-white px-4 py-3 rounded-3xl rounded-tl-md shadow-sm">
      <div className="flex items-center gap-1.5 text-[9px] font-black text-white/60 uppercase tracking-widest mb-1.5">
        <Sparkles size={10}/> {name} is typing
      </div>
      <div className="flex gap-1">
        <span className="w-2 h-2 bg-white/70 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
        <span className="w-2 h-2 bg-white/70 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
        <span className="w-2 h-2 bg-white/70 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
      </div>
    </div>
  </div>
);

// ─── Sidebar chat row ───────────────────────────────────────────────────────
const ChatRow = ({ chat, lastMsg, isActive, onClick, isMobile }) => {
  const initials = (chat.name || '?').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 sm:p-4 rounded-2xl flex items-center gap-3 border transition-all active:scale-[0.99] ${
        isActive
          ? 'bg-white border-[#ba0036]/15 shadow-[0_4px_20px_rgba(186,0,54,0.08)]'
          : 'border-transparent hover:bg-white/70'
      }`}
    >
      <div className="relative shrink-0">
        {chat.isAI ? (
          <div className="w-12 h-12 bg-gradient-to-br from-[#ba0036] to-[#7a0024] rounded-full flex items-center justify-center text-white shadow-md">
            <Bot size={20}/>
          </div>
        ) : chat.avatar ? (
          <img src={chat.avatar} className="w-12 h-12 rounded-full object-cover" alt={chat.name}/>
        ) : (
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-gray-700 font-black text-sm">
            {initials}
          </div>
        )}
        {chat.status === 'online' && (
          <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <h4 className="font-black text-gray-900 text-[13px] truncate flex items-center gap-1.5">
            {chat.name}
            {chat.pinned && <Pin size={10} className="text-gray-400 shrink-0" />}
          </h4>
          <span className="text-[9px] font-black text-gray-400 shrink-0 tabular-nums">
            {lastMsg?.iso ? formatTime(lastMsg.iso) : chat.time}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className={`text-[11px] truncate ${chat.unread > 0 ? 'font-black text-gray-900' : 'font-bold text-gray-500'}`}>
            {lastMsg?.preview || chat.lastMsg}
          </p>
          {chat.unread > 0 && (
            <span className="bg-[#ba0036] text-white text-[9px] font-black rounded-full min-w-[18px] h-[18px] px-1.5 flex items-center justify-center shrink-0">
              {chat.unread}
            </span>
          )}
        </div>
      </div>

      {isMobile && <ChevronRight size={14} className="text-gray-300 shrink-0"/>}
    </button>
  );
};

// ─── Main ChatSystem component ──────────────────────────────────────────────
const ChatSystem = () => {
  const location = useLocation();

  // Persistent chat list (seeded threads + dynamic threads from location.state)
  const [chats, setChats] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(CHAT_THREADS_KEY) || 'null');
      if (Array.isArray(stored) && stored.length > 0) {
        const merged = [...initialChats];
        stored.forEach(t => {
          if (!merged.find(c => c.id === t.id)) merged.push(t);
        });
        return merged;
      }
    } catch { /* ignore */ }
    return initialChats;
  });

  const [activeChatId, setActiveChatId] = useState('ai-bot');
  const [isCalling, setIsCalling] = useState(false);
  const [callType, setCallType] = useState('voice');
  const [muted, setMuted] = useState(false);
  const [inputText, setInputText] = useState('');
  const [isBotTyping, setIsBotTyping] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSidebarMobile, setShowSidebarMobile] = useState(true);
  const [showInfoPane, setShowInfoPane] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [contextBanner, setContextBanner] = useState(null);
  const [activeReceipt, setActiveReceipt] = useState(null);
  const [paymentReceipts, setPaymentReceipts] = useState([]);

  // Persistent message threads (per chat id)
  const [messages, setMessages] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) || 'null');
      if (stored && typeof stored === 'object') return stored;
    } catch { /* ignore */ }
    return { 'ai-bot': [], 1: [] };
  });
  useEffect(() => {
    try { localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(messages)); } catch { /* quota */ }
  }, [messages]);

  // Persist *dynamic* threads (everything except the seed list).
  useEffect(() => {
    const dynamic = chats.filter(c => !initialChats.find(s => s.id === c.id));
    try { localStorage.setItem(CHAT_THREADS_KEY, JSON.stringify(dynamic)); } catch { /* quota */ }
  }, [chats]);

  // Receipts feed — pulled from localStorage and refreshed on the custom event.
  useEffect(() => {
    const load = () => {
      try {
        const arr = JSON.parse(localStorage.getItem(PAYMENT_RECEIPTS_KEY) || '[]');
        setPaymentReceipts(Array.isArray(arr) ? arr : []);
      } catch { setPaymentReceipts([]); }
    };
    load();
    const onUpdate = () => load();
    const onStorage = (e) => { if (!e.key || e.key === PAYMENT_RECEIPTS_KEY) load(); };
    window.addEventListener(PAYMENT_RECEIPTS_EVENT, onUpdate);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(PAYMENT_RECEIPTS_EVENT, onUpdate);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Track viewport so we can switch master/detail vs three-pane behaviour.
  const [viewport, setViewport] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1280));
  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const isMobile  = viewport < 768;
  const isDesktop = viewport >= 1280;

  const scrollRef = useRef(null);
  const inputRef  = useRef(null);
  const handledStateRef = useRef(null);

  // Send message
  const sendMessageTo = useCallback((chatId, text) => {
    if (!text || !text.trim()) return;
    const trimmed = text.trim();
    const chat = chats.find(c => c.id === chatId);
    const userMsg = {
      id: Date.now(),
      sender: 'me',
      text: trimmed,
      iso: new Date().toISOString(),
      status: 'sent',
    };
    setMessages(prev => ({ ...prev, [chatId]: [...(prev[chatId] || []), userMsg] }));

    if (chat?.isAI) {
      setIsBotTyping(true);
      const reply = getBotReply(trimmed);
      setTimeout(() => {
        const botMsg = {
          id: Date.now() + 1,
          sender: 'bot',
          text: reply,
          iso: new Date().toISOString(),
        };
        setMessages(prev => ({ ...prev, [chatId]: [...(prev[chatId] || []), botMsg] }));
        setIsBotTyping(false);
        setMessages(prev => ({
          ...prev,
          [chatId]: (prev[chatId] || []).map(m => m.id === userMsg.id ? { ...m, status: 'read' } : m),
        }));
      }, 700 + Math.min(trimmed.length * 18, 1400));
    } else {
      // Human chat — fake the delivered state until the backend wires up real receipts.
      setTimeout(() => {
        setMessages(prev => ({
          ...prev,
          [chatId]: (prev[chatId] || []).map(m => m.id === userMsg.id ? { ...m, status: 'delivered' } : m),
        }));
      }, 600);
    }
  }, [chats]);

  // Create a chat row on the fly when a new chatId arrives via state.
  const ensureChat = useCallback((s) => {
    setChats(prev => {
      if (prev.find(c => c.id === s.chatId)) return prev;
      const isAI = s.chatId === 'ai-bot';
      const fresh = {
        id: s.chatId,
        name: s.tenantName || s.landlordName || (isAI ? 'TO-LET AI Bot' : 'Conversation'),
        role: s.source === 'tenant-receipt'
          ? 'Property Owner'
          : (s.source === 'host-bookings' ? 'Tenant' : (isAI ? 'Smart Assistant' : 'Conversation')),
        avatar: s.avatar || (s.tenantName ? `https://ui-avatars.com/api/?name=${encodeURIComponent(s.tenantName)}&background=fce4ec&color=ba0036` : null),
        isAI,
        status: 'online',
        lastMsg: s.propertyTitle ? `Re: ${s.propertyTitle}` : 'New conversation',
        time: 'Just now',
        unread: 0,
        pinned: false,
        propertyTitle: s.propertyTitle,
        tenantPhone: s.tenantPhone,
      };
      return [...prev, fresh];
    });
  }, []);

  // Hydrate from location.state (legacy `initialMessage` auto-sends, new `prefillMessage` fills the input).
  useEffect(() => {
    if (!location.state) return;
    if (handledStateRef.current === location.key) return;
    handledStateRef.current = location.key;

    const s = location.state;
    if (s.chatId) {
      ensureChat(s);
      setActiveChatId(s.chatId);
      if (isMobile) setShowSidebarMobile(false);
      if (s.mode === 'call') {
        setCallType('voice');
        setIsCalling(true);
      }
    }
    if (s.source === 'host-bookings' || s.source === 'tenant-receipt') {
      setContextBanner({
        source: s.source,
        propertyTitle: s.propertyTitle,
        monthKey: s.monthKey,
        receiptId: s.receiptId,
      });
    }
    if (s.initialMessage) {
      const targetId = s.chatId || 'ai-bot';
      setTimeout(() => sendMessageTo(targetId, s.initialMessage), 50);
    } else if (s.prefillMessage) {
      setInputText(s.prefillMessage);
      setTimeout(() => inputRef.current?.focus(), 80);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  // Auto-scroll on new content.
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, activeChatId, isBotTyping, paymentReceipts]);

  // Esc to close call/overlay.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (activeReceipt) setActiveReceipt(null);
        else if (isCalling) setIsCalling(false);
        else if (showEmojiPicker) setShowEmojiPicker(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeReceipt, isCalling, showEmojiPicker]);

  const handleSendMessage = () => {
    if (!inputText.trim()) return;
    const text = inputText;
    setInputText('');
    setShowEmojiPicker(false);
    sendMessageTo(activeChatId, text);
  };

  const insertEmoji = (e) => {
    setInputText(prev => prev + e);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  // Filter & sort the sidebar chat list.
  const visibleChats = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? chats.filter(c => c.name.toLowerCase().includes(q) || (c.role || '').toLowerCase().includes(q))
      : chats;
    return [...filtered].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      const ax = (messages[a.id] || []).slice(-1)[0]?.iso || '';
      const bx = (messages[b.id] || []).slice(-1)[0]?.iso || '';
      return bx.localeCompare(ax);
    });
  }, [chats, searchQuery, messages]);

  const activeChat = chats.find(c => c.id === activeChatId) || initialChats[0];

  // Build the rendered message stream for the active chat — merge text/bot
  // messages with inline ReceiptCards from `paymentReceipts`. Sorted by ISO.
  const renderedStream = useMemo(() => {
    const base = (messages[activeChatId] || []).map(m => ({ kind: 'text', ...m }));
    const receiptItems = paymentReceipts
      .filter(r => r.landlordChatId === activeChatId)
      .map(r => ({
        kind: 'receipt',
        sender: 'them',
        id: `r-${r.id}`,
        iso: r.issuedAt,
        receipt: r,
      }));
    return [...base, ...receiptItems].sort((a, b) => (a.iso || '').localeCompare(b.iso || ''));
  }, [messages, activeChatId, paymentReceipts]);

  const lastIncoming = useMemo(() => {
    const stream = messages[activeChatId] || [];
    for (let i = stream.length - 1; i >= 0; i--) {
      if (stream[i].sender !== 'me') return stream[i];
    }
    return null;
  }, [messages, activeChatId]);
  const smartReplies = useMemo(() => getSmartReplies(lastIncoming, activeChat), [lastIncoming, activeChat]);

  // Group consecutive same-sender messages so we can collapse the avatar
  // and tighten the bubble shoulder — feels closer to iMessage / WhatsApp.
  const groupedStream = useMemo(() => {
    const out = [];
    let lastDay = null;
    renderedStream.forEach((m, i) => {
      const dl = dayLabel(m.iso);
      if (dl && dl !== lastDay) {
        out.push({ kind: 'divider', id: `d-${i}`, label: dl });
        lastDay = dl;
      }
      const prev = renderedStream[i - 1];
      const next = renderedStream[i + 1];
      const prevSame = prev && prev.sender === m.sender && sameDay(prev.iso, m.iso);
      const nextSame = next && next.sender === m.sender && sameDay(next.iso, m.iso);
      out.push({
        ...m,
        position: !prevSame && !nextSame ? 'solo' : !prevSame ? 'first' : !nextSame ? 'last' : 'middle',
      });
    });
    return out;
  }, [renderedStream]);

  const bubbleRadius = (mine, position) => {
    if (position === 'solo')   return mine ? 'rounded-3xl rounded-tr-md'    : 'rounded-3xl rounded-tl-md';
    if (position === 'first')  return mine ? 'rounded-3xl rounded-tr-md'    : 'rounded-3xl rounded-tl-md';
    if (position === 'middle') return mine ? 'rounded-l-3xl rounded-r-md'   : 'rounded-r-3xl rounded-l-md';
    if (position === 'last')   return mine ? 'rounded-3xl rounded-br-md'    : 'rounded-3xl rounded-bl-md';
    return 'rounded-3xl';
  };

  // Mark thread "read" when opened.
  useEffect(() => {
    setChats(prev => prev.map(c => c.id === activeChatId ? { ...c, unread: 0 } : c));
  }, [activeChatId]);

  const QUICK_EMOJI = ['👍', '🙏', '🙂', '🎉', '❤️', '🔥', '✅', '🏠', '💸', '📅'];

  return (
    <div className="relative w-full">
      {/* Backdrop accents */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-40 -left-32 w-[480px] h-[480px] bg-[#ba0036]/15 rounded-full blur-3xl"></div>
        <div className="absolute -bottom-40 -right-32 w-[480px] h-[480px] bg-blue-500/10 rounded-full blur-3xl"></div>
      </div>

      <div className={`flex flex-col md:flex-row ${
        isMobile ? 'h-[100dvh]' : 'h-[calc(100dvh-2rem)] my-4 max-w-[1400px] mx-auto rounded-[2rem]'
      } bg-white/60 backdrop-blur-2xl border border-white/70 shadow-[0_30px_80px_rgba(0,0,0,0.08)] overflow-hidden relative`}>

        {/* CALL OVERLAY */}
        <AnimatePresence>
          {isCalling && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-[120] bg-gray-900/95 backdrop-blur-2xl flex flex-col items-center justify-center text-white p-6"
            >
              <div className="relative mb-6">
                <span className="absolute inset-0 rounded-full border-2 border-[#ba0036]/40 animate-ping"></span>
                <span className="absolute -inset-3 rounded-full border-2 border-[#ba0036]/20 animate-ping" style={{ animationDelay: '0.4s' }}></span>
                <div className="w-32 h-32 rounded-full border-4 border-[#ba0036] p-1 relative">
                  {activeChat.avatar ? (
                    <img src={activeChat.avatar} className="w-full h-full rounded-full object-cover" alt=""/>
                  ) : (
                    <div className="w-full h-full rounded-full bg-gradient-to-br from-[#ba0036] to-[#7a0024] flex items-center justify-center">
                      <Bot size={48}/>
                    </div>
                  )}
                </div>
                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-[#ba0036] px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap">
                  {callType === 'video' ? 'Video Calling…' : 'Calling…'}
                </div>
              </div>

              <h2 className="text-2xl sm:text-3xl font-black mb-1 text-center">{activeChat.name}</h2>
              <p className="text-gray-400 font-bold mb-10 text-sm">TO-LET PRO HD {callType === 'video' ? 'Video' : 'Voice'} Call</p>

              <div className="flex gap-4 sm:gap-8">
                <button
                  onClick={() => setMuted(m => !m)}
                  className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center transition-all border ${
                    muted ? 'bg-amber-500/20 border-amber-500/40 text-amber-300' : 'bg-white/10 hover:bg-white/20 border-white/10'
                  }`}
                  aria-label={muted ? 'Unmute' : 'Mute'}
                >
                  {muted ? <VolumeX size={22}/> : <Mic size={22}/>}
                </button>
                <button
                  onClick={() => { setIsCalling(false); setMuted(false); }}
                  className="w-16 h-16 sm:w-20 sm:h-20 bg-red-600 hover:bg-red-700 rounded-full flex items-center justify-center shadow-2xl shadow-red-600/40 transition-all"
                  aria-label="End call"
                >
                  <PhoneOff size={28}/>
                </button>
                <button
                  className="w-14 h-14 sm:w-16 sm:h-16 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center transition-all border border-white/10"
                  aria-label="Add participant"
                >
                  <UserPlus size={22}/>
                </button>
              </div>
              <p className="mt-6 text-[10px] font-black text-white/40 uppercase tracking-[0.2em]">Tap Esc to hang up</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* SIDEBAR */}
        <aside
          className={`${
            isMobile
              ? (showSidebarMobile ? 'flex' : 'hidden') + ' w-full'
              : 'flex w-[320px] lg:w-[360px] shrink-0 border-r border-white/60'
          } flex-col bg-white/40`}
        >
          <div className="p-5 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-black text-gray-900 flex items-center gap-2">
                Messages
                <span className="text-[10px] font-black text-[#ba0036] bg-[#ba0036]/10 rounded-full px-2 py-0.5 uppercase tracking-widest">
                  {chats.length}
                </span>
              </h2>
              <button
                onClick={() => setIsSearching(s => !s)}
                className="p-2 hover:bg-white rounded-xl text-gray-500 hover:text-[#ba0036] transition-all"
                aria-label="Toggle search"
              >
                <Search size={18}/>
              </button>
            </div>
            <AnimatePresence initial={false}>
              {isSearching && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="relative">
                    <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text" autoFocus
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Search chats…"
                      className="w-full bg-white border border-white rounded-2xl py-2.5 pl-11 pr-10 outline-none text-sm font-bold text-gray-800 focus:border-[#ba0036]/30 transition-all shadow-sm"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 rounded-full"
                      >
                        <X size={14} className="text-gray-400"/>
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-1.5">
            {visibleChats.length === 0 ? (
              <div className="text-center text-xs font-bold text-gray-400 py-10 px-4">
                No chats match "{searchQuery}". Try a different query.
              </div>
            ) : (
              visibleChats.map(chat => {
                const stream = messages[chat.id] || [];
                const last = stream[stream.length - 1];
                const lastMsg = last
                  ? { iso: last.iso, preview: last.sender === 'me' ? `You: ${last.text}` : last.text }
                  : null;
                return (
                  <ChatRow
                    key={chat.id}
                    chat={chat}
                    lastMsg={lastMsg}
                    isActive={activeChatId === chat.id}
                    isMobile={isMobile}
                    onClick={() => {
                      setActiveChatId(chat.id);
                      if (isMobile) setShowSidebarMobile(false);
                    }}
                  />
                );
              })
            )}
          </div>

          {!isMobile && (
            <div className="p-4 border-t border-white/60 text-[10px] font-bold text-gray-400 leading-relaxed">
              Tip: open a chat from any property card or the host/tenant dashboard to start a new thread.
            </div>
          )}
        </aside>

        {/* MAIN CHAT PANE */}
        <main className={`${isMobile && showSidebarMobile ? 'hidden' : 'flex'} flex-1 flex-col min-w-0 bg-white/30`}>
          <header className="px-4 sm:px-6 py-3 sm:py-4 border-b border-white/60 bg-white/40 backdrop-blur-md flex justify-between items-center gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {isMobile && (
                <button
                  onClick={() => setShowSidebarMobile(true)}
                  className="p-2 -ml-1 rounded-xl hover:bg-white/70 transition-all"
                  aria-label="Back to chats"
                >
                  <ArrowLeft size={20} className="text-gray-700"/>
                </button>
              )}
              <div className="w-11 h-11 rounded-2xl overflow-hidden shrink-0 shadow-sm">
                {activeChat.isAI ? (
                  <div className="w-full h-full bg-gradient-to-br from-[#ba0036] to-[#7a0024] flex items-center justify-center text-white">
                    <Bot size={22}/>
                  </div>
                ) : activeChat.avatar ? (
                  <img src={activeChat.avatar} className="w-full h-full object-cover" alt={activeChat.name}/>
                ) : (
                  <div className="w-full h-full bg-gray-100 flex items-center justify-center text-gray-700 font-black text-sm">
                    {(activeChat.name || '?').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase()}
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <h3 className="text-base sm:text-lg font-black text-gray-900 truncate">{activeChat.name}</h3>
                <p className="text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 text-green-600 truncate">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse shrink-0"></span>
                  {activeChat.role || 'Online'}{activeChat.tenantPhone ? ` · ${activeChat.tenantPhone}` : ''}
                </p>
              </div>
            </div>
            <div className="flex gap-1.5 sm:gap-2 shrink-0">
              <button
                onClick={() => { setCallType('voice'); setIsCalling(true); }}
                className="p-2.5 sm:p-3 bg-white hover:bg-red-50 rounded-2xl text-gray-500 hover:text-[#ba0036] transition-all shadow-sm"
                aria-label="Voice call"
              >
                <Phone size={18}/>
              </button>
              <button
                onClick={() => { setCallType('video'); setIsCalling(true); }}
                className="p-2.5 sm:p-3 bg-white hover:bg-red-50 rounded-2xl text-gray-500 hover:text-[#ba0036] transition-all shadow-sm"
                aria-label="Video call"
              >
                <Video size={18}/>
              </button>
              {!isMobile && (
                <button
                  onClick={() => setShowInfoPane(s => !s)}
                  className={`p-2.5 sm:p-3 rounded-2xl transition-all shadow-sm ${
                    showInfoPane ? 'bg-[#ba0036] text-white' : 'bg-white hover:bg-red-50 text-gray-500 hover:text-[#ba0036]'
                  }`}
                  aria-label="Toggle info pane"
                >
                  <Info size={18}/>
                </button>
              )}
              <button
                className="p-2.5 sm:p-3 bg-white hover:bg-red-50 rounded-2xl text-gray-500 hover:text-[#ba0036] transition-all shadow-sm"
                aria-label="More"
              >
                <MoreVertical size={18}/>
              </button>
            </div>
          </header>

          {/* Context banner — appears when arriving from HostDashboard / TenantDashboard */}
          {contextBanner && (
            <div className="px-4 sm:px-6 pt-3">
              <div className="bg-gradient-to-r from-[#ba0036]/10 to-transparent border border-[#ba0036]/15 rounded-2xl px-4 py-2.5 flex items-center gap-3 text-[11px] font-bold text-gray-700">
                <span className="w-7 h-7 rounded-full bg-[#ba0036]/15 text-[#ba0036] flex items-center justify-center shrink-0">
                  {contextBanner.source === 'tenant-receipt' ? <Receipt size={13}/> : <FileText size={13}/>}
                </span>
                <span className="flex-1 min-w-0 truncate">
                  {contextBanner.source === 'tenant-receipt'
                    ? <>Replying about <b>{contextBanner.propertyTitle}</b>{contextBanner.monthKey ? ` (${contextBanner.monthKey})` : ''}{contextBanner.receiptId ? ` · receipt ${contextBanner.receiptId}` : ''}</>
                    : <>Conversation about <b>{contextBanner.propertyTitle || 'this booking'}</b></>}
                </span>
                <button onClick={() => setContextBanner(null)} className="p-1 hover:bg-white rounded-full" aria-label="Dismiss">
                  <X size={12} className="text-gray-400"/>
                </button>
              </div>
            </div>
          )}

          {/* Messages stream */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-6 bg-gradient-to-b from-transparent via-white/10 to-white/40 relative">
            {groupedStream.length === 0 && !isBotTyping && (
              <div className="h-full flex flex-col items-center justify-center text-center px-6">
                <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-[#ba0036] to-[#7a0024] text-white flex items-center justify-center shadow-[0_15px_30px_rgba(186,0,54,0.25)] mb-4">
                  {activeChat.isAI ? <Bot size={28}/> : <MessageCircle size={28}/>}
                </div>
                <h4 className="text-lg font-black text-gray-900">
                  {activeChat.isAI ? 'Ask me anything' : `Say hi to ${activeChat.name}`}
                </h4>
                <p className="text-[11px] font-bold text-gray-500 mt-1.5 max-w-[280px] leading-relaxed">
                  {activeChat.isAI
                    ? 'Try a smart-reply chip below — properties, rent, tours or contacting a landlord.'
                    : 'Send your first message — your phone number stays private until you choose to share it.'}
                </p>
              </div>
            )}

            {groupedStream.map((m) => {
              if (m.kind === 'divider') {
                return <DayDivider key={m.id} label={m.label}/>;
              }
              const mine = m.sender === 'me';
              const fromBot = m.sender === 'bot';
              const showTail = m.position === 'last' || m.position === 'solo';

              if (m.kind === 'receipt') {
                return (
                  <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'} mb-2`}>
                    <ReceiptCard
                      receipt={m.receipt}
                      mine={mine}
                      onView={(r) => setActiveReceipt(r)}
                    />
                  </div>
                );
              }
              return (
                <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'} ${m.position === 'middle' ? 'mb-0.5' : 'mb-2'}`}>
                  <div className={`max-w-[78%] sm:max-w-[68%] ${bubbleRadius(mine, m.position)} px-4 py-2.5 shadow-sm transition-all ${
                    mine
                      ? 'bg-gradient-to-br from-[#ba0036] to-[#a30030] text-white'
                      : fromBot
                        ? 'bg-gradient-to-br from-gray-900 to-[#1a1a1f] text-white'
                        : 'bg-white text-gray-800 border border-gray-100'
                  }`}>
                    {fromBot && m.position !== 'middle' && m.position !== 'last' && (
                      <div className="flex items-center gap-1.5 mb-1 text-[9px] font-black text-white/60 uppercase tracking-widest">
                        <Sparkles size={10}/> AI Assistant
                      </div>
                    )}
                    <p className="text-[13px] sm:text-sm font-medium whitespace-pre-line leading-relaxed">{m.text}</p>
                    {showTail && (
                      <div className={`flex items-center gap-1.5 mt-1 ${mine ? 'justify-end text-white/70' : fromBot ? 'justify-start text-white/50' : 'justify-start text-gray-400'}`}>
                        <span className="text-[9px] font-bold tabular-nums">{formatTime(m.iso)}</span>
                        {mine && (
                          m.status === 'read'      ? <CheckCheck size={11} className="text-blue-200"/>
                          : m.status === 'delivered' ? <CheckCheck size={11}/>
                          : <Check size={11}/>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {isBotTyping && activeChat.isAI && <TypingDots name="AI"/>}
            <div ref={scrollRef} />
          </div>

          {/* Smart-reply chips */}
          {smartReplies.length > 0 && !isBotTyping && (
            <div className="px-4 sm:px-6 pb-2 flex gap-2 overflow-x-auto scrollbar-none">
              {smartReplies.map(sr => (
                <button
                  key={sr.id}
                  onClick={() => sendMessageTo(activeChatId, sr.text)}
                  className="shrink-0 px-3.5 py-1.5 bg-white border border-gray-100 hover:border-[#ba0036]/30 hover:bg-[#ba0036]/5 text-gray-700 hover:text-[#ba0036] rounded-full text-[11px] font-black flex items-center gap-1.5 shadow-sm transition-all active:scale-95"
                >
                  <Sparkles size={10} className="text-amber-500"/>
                  {sr.text}
                </button>
              ))}
            </div>
          )}

          {/* Composer */}
          <div className="px-4 sm:px-6 pb-4 sm:pb-6 pt-2 relative">
            <AnimatePresence>
              {showEmojiPicker && (
                <motion.div
                  initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }}
                  className="absolute bottom-[88px] left-4 sm:left-6 bg-white rounded-2xl shadow-[0_15px_30px_rgba(0,0,0,0.10)] border border-gray-100 p-3 flex flex-wrap gap-1.5 max-w-[280px] z-30"
                >
                  {QUICK_EMOJI.map(e => (
                    <button
                      key={e}
                      onClick={() => insertEmoji(e)}
                      className="w-9 h-9 hover:bg-gray-50 rounded-xl text-lg transition-all active:scale-90"
                    >
                      {e}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-end gap-2 bg-white border border-white p-2 rounded-[1.6rem] shadow-[0_10px_25px_rgba(0,0,0,0.06)]">
              <button
                onClick={() => setShowEmojiPicker(s => !s)}
                className={`p-2.5 rounded-xl transition-all ${showEmojiPicker ? 'bg-[#ba0036]/10 text-[#ba0036]' : 'text-gray-400 hover:text-[#ba0036] hover:bg-gray-50'}`}
                aria-label="Emoji"
              >
                <Smile size={18}/>
              </button>
              <button
                className="p-2.5 rounded-xl text-gray-400 hover:text-[#ba0036] hover:bg-gray-50 transition-all hidden sm:block"
                aria-label="Attach file"
                title="Attach (coming soon)"
              >
                <Paperclip size={18}/>
              </button>
              <textarea
                ref={inputRef}
                rows="1"
                value={inputText}
                onChange={(e) => {
                  setInputText(e.target.value);
                  const el = e.target;
                  el.style.height = 'auto';
                  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder={activeChat.isAI ? 'Ask the AI assistant anything…' : 'Type a message…'}
                className="flex-1 bg-transparent outline-none text-sm font-bold text-gray-800 resize-none py-2 max-h-[120px] leading-relaxed placeholder:text-gray-400"
              />
              {inputText.trim() ? (
                <button
                  onClick={handleSendMessage}
                  className="w-11 h-11 bg-gradient-to-br from-[#ba0036] to-[#7a0024] text-white rounded-xl flex items-center justify-center shadow-[0_8px_20px_rgba(186,0,54,0.30)] hover:-translate-y-0.5 transition-all active:scale-95"
                  aria-label="Send"
                >
                  <Send size={18} className="ml-0.5"/>
                </button>
              ) : (
                <button
                  className="w-11 h-11 bg-gray-100 hover:bg-gray-200 text-gray-500 rounded-xl flex items-center justify-center transition-all active:scale-95"
                  aria-label="Voice message (coming soon)"
                  title="Voice (coming soon)"
                >
                  <Mic size={18}/>
                </button>
              )}
            </div>

            {!inputText && !isMobile && (
              <p className="text-center text-[9px] font-black text-gray-300 uppercase tracking-[0.18em] mt-2.5">
                Enter to send · Shift + Enter for new line · Esc to close call
              </p>
            )}
          </div>
        </main>

        {/* INFO PANE (desktop only) */}
        {isDesktop && showInfoPane && (
          <aside className="w-[300px] border-l border-white/60 bg-white/30 backdrop-blur-md p-5 overflow-y-auto shrink-0">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-sm font-black text-gray-900">Conversation</h4>
              <button onClick={() => setShowInfoPane(false)} className="p-1.5 hover:bg-white rounded-full text-gray-400">
                <X size={14}/>
              </button>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-4 text-center">
              {activeChat.avatar ? (
                <img src={activeChat.avatar} className="w-20 h-20 rounded-full object-cover mx-auto mb-3" alt={activeChat.name}/>
              ) : (
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#ba0036] to-[#7a0024] text-white flex items-center justify-center mx-auto mb-3">
                  <Bot size={32}/>
                </div>
              )}
              <h5 className="text-base font-black text-gray-900">{activeChat.name}</h5>
              <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mt-1">{activeChat.role}</p>
              {activeChat.tenantPhone && (
                <p className="text-[11px] font-bold text-gray-700 mt-2">{activeChat.tenantPhone}</p>
              )}
              {activeChat.propertyTitle && (
                <p className="text-[11px] font-bold text-gray-500 mt-1 line-clamp-2">{activeChat.propertyTitle}</p>
              )}
            </div>

            <h5 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 px-1">Receipts in this chat</h5>
            <div className="space-y-2">
              {paymentReceipts.filter(r => r.landlordChatId === activeChatId).slice(0, 6).map(r => (
                <ReceiptCard key={r.id} receipt={r} mine={false} onView={(rec) => setActiveReceipt(rec)}/>
              ))}
              {paymentReceipts.filter(r => r.landlordChatId === activeChatId).length === 0 && (
                <p className="text-[11px] font-bold text-gray-400 text-center py-6 leading-relaxed">
                  No rent receipts yet.<br/>They'll appear here automatically when the landlord marks a month as paid.
                </p>
              )}
            </div>

            <h5 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 px-1 mt-5">Quick actions</h5>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { setCallType('voice'); setIsCalling(true); }} className="bg-white hover:bg-red-50 border border-gray-100 hover:border-[#ba0036]/20 rounded-xl py-2.5 text-[10px] font-black uppercase tracking-widest text-gray-700 hover:text-[#ba0036] transition-all flex items-center justify-center gap-1.5">
                <Phone size={12}/> Call
              </button>
              <button onClick={() => { setCallType('video'); setIsCalling(true); }} className="bg-white hover:bg-red-50 border border-gray-100 hover:border-[#ba0036]/20 rounded-xl py-2.5 text-[10px] font-black uppercase tracking-widest text-gray-700 hover:text-[#ba0036] transition-all flex items-center justify-center gap-1.5">
                <Video size={12}/> Video
              </button>
              <button
                onClick={() => setChats(prev => prev.map(c => c.id === activeChatId ? { ...c, pinned: !c.pinned } : c))}
                className="col-span-2 bg-white hover:bg-amber-50 border border-gray-100 hover:border-amber-200 rounded-xl py-2.5 text-[10px] font-black uppercase tracking-widest text-gray-700 hover:text-amber-700 transition-all flex items-center justify-center gap-1.5"
              >
                <Pin size={12}/> {activeChat.pinned ? 'Unpin chat' : 'Pin to top'}
              </button>
            </div>
          </aside>
        )}
      </div>

      {/* RECEIPT DETAIL MODAL */}
      <AnimatePresence>
        {activeReceipt && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[140] bg-gray-900/40 backdrop-blur-md flex items-center justify-center p-4"
            onClick={() => setActiveReceipt(null)}
          >
            <motion.div
              initial={{ y: 20, scale: 0.96 }} animate={{ y: 0, scale: 1 }} exit={{ y: 20, scale: 0.96 }}
              className="bg-white rounded-[2rem] w-full max-w-md shadow-[0_30px_80px_rgba(0,0,0,0.2)] overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className={`p-6 text-white relative overflow-hidden ${
                (activeReceipt.status === 'full' || (Number(activeReceipt.balance) || 0) <= 0)
                  ? 'bg-gradient-to-br from-blue-500 to-indigo-600'
                  : 'bg-gradient-to-br from-amber-500 to-orange-600'
              }`}>
                <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-3xl"></div>
                <button
                  onClick={() => setActiveReceipt(null)}
                  className="absolute top-4 right-4 p-2 bg-white/15 hover:bg-white/25 rounded-full transition-all"
                >
                  <X size={16}/>
                </button>
                <div className="relative">
                  <div className="w-14 h-14 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center mb-4 border border-white/30 shadow-lg">
                    {(activeReceipt.status === 'full' || (Number(activeReceipt.balance) || 0) <= 0)
                      ? <CheckCheck size={26} strokeWidth={3}/>
                      : <Hourglass size={26} strokeWidth={2.5}/>}
                  </div>
                  <p className="text-[10px] font-black text-white/70 uppercase tracking-widest mb-1">Digital Rent Receipt</p>
                  <h3 className="text-2xl font-black tracking-tight">{formatBDT(activeReceipt.totalPaid)}</h3>
                  <p className="text-[11px] font-bold text-white/80 mt-1">
                    {(activeReceipt.status === 'full' || (Number(activeReceipt.balance) || 0) <= 0)
                      ? 'Full payment confirmed'
                      : 'Partial payment recorded'}
                  </p>
                </div>
              </div>
              <div className="p-6 space-y-3">
                {[
                  ['Property', activeReceipt.propertyTitle],
                  ['Month', activeReceipt.monthLabel || activeReceipt.monthKey],
                  ['Total Due', formatBDT(activeReceipt.totalDue)],
                  ['Total Paid', formatBDT(activeReceipt.totalPaid)],
                  ['Balance', (Number(activeReceipt.balance) || 0) > 0 ? formatBDT(activeReceipt.balance) : 'Cleared'],
                  ['Method', activeReceipt.method ? `${activeReceipt.method}${activeReceipt.txnId ? ' · ' + activeReceipt.txnId : ''}` : '—'],
                  ['Date', activeReceipt.date],
                  ['Receipt ID', activeReceipt.id],
                ].map(([k, v], i, a) => (
                  <div key={k} className={`flex justify-between items-center py-2 ${i < a.length - 1 ? 'border-b border-gray-100' : ''}`}>
                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{k}</span>
                    <span className={`text-sm font-black text-right max-w-[220px] ${k === 'Balance' && (Number(activeReceipt.balance) || 0) > 0 ? 'text-[#ba0036]' : k === 'Balance' ? 'text-green-600' : 'text-gray-900'} ${k === 'Receipt ID' ? 'font-mono text-[11px]' : ''}`}>
                      {v}
                    </span>
                  </div>
                ))}
                <button
                  onClick={() => {
                    const text = [
                      'TO-LET PRO Rent Receipt',
                      `Property: ${activeReceipt.propertyTitle}`,
                      `Month: ${activeReceipt.monthLabel || activeReceipt.monthKey}`,
                      `Total Due: ${formatBDT(activeReceipt.totalDue)}`,
                      `Total Paid: ${formatBDT(activeReceipt.totalPaid)}`,
                      `Balance: ${(Number(activeReceipt.balance) || 0) > 0 ? formatBDT(activeReceipt.balance) : 'Cleared'}`,
                      `Method: ${activeReceipt.method || '—'}${activeReceipt.txnId ? ' · Txn ' + activeReceipt.txnId : ''}`,
                      `Date: ${activeReceipt.date}`,
                      `Receipt ID: ${activeReceipt.id}`,
                    ].join('\n');
                    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a'); a.href = url; a.download = `receipt-${activeReceipt.id}.txt`; a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="w-full mt-2 py-3 bg-gray-900 hover:bg-[#ba0036] text-white rounded-xl text-[11px] font-black transition-all flex items-center justify-center gap-2"
                >
                  <Download size={14}/> Download receipt
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ChatSystem;
