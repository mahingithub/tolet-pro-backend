import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Draggable from 'react-draggable';
import {
  Bot, Send, Sparkles, Minimize2, ExternalLink, TrendingUp,
  Headphones, Inbox, ArrowLeft, ShieldCheck, CheckCircle2, Clock,
} from 'lucide-react';

import { useAuth } from '../context/AuthContext.jsx';
import {
  openTicket as svcOpenTicket,
  listMyTickets,
  getTicket,
  sendMessage as svcSendMessage,
  onTicketsChanged,
} from '../services/supportService.js';

/**
 * Global AI assistant + support widget.
 *
 * Three internal views:
 *   - 'ai'      : the original AI chat (default).
 *   - 'tickets' : list of the signed-in user's support tickets.
 *   - 'ticket'  : a single ticket's conversation with a human admin.
 *
 * Hand-off rule: if the AI fails to satisfy the user (2+ open-ended replies
 * in a row) or the user types "human" / "agent" / "support" / "complaint",
 * we surface a "Talk to a human" CTA. Pressing it opens a real ticket
 * with the AI transcript attached, and switches the widget to the 'ticket'
 * view so the user can keep typing without losing context.
 */

const HUMAN_KEYWORDS = ['human', 'agent', 'support', 'complaint', 'real person', 'staff'];

const GlobalAIAssistant = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();

  const messagesEndRef = useRef(null);
  const chatWindowRef = useRef(null);
  const floatingBtnRef = useRef(null);

  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState(/** @type {'ai'|'tickets'|'ticket'} */('ai'));
  const [activeTicketId, setActiveTicketId] = useState(/** @type {string|null} */(null));
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // AI chat history (persisted in localStorage so it survives refreshes).
  const [aiMessages, setAiMessages] = useState(() => {
    try {
      const saved = localStorage.getItem('ai_chat_history');
      if (saved) return JSON.parse(saved);
    } catch {
      // fall through
    }
    return [
      {
        id: 1,
        sender: 'ai',
        text:
          "Hello! I'm your AI Assistant. I can help you find properties, " +
          'check saved items, or answer questions. If I can\'t help, I can ' +
          'connect you with a human teammate.',
      },
    ];
  });

  // How many AI replies in a row have been unhelpful (no `action`)? Used to
  // decide when to nudge the user toward the human handoff CTA.
  const [unhelpfulStreak, setUnhelpfulStreak] = useState(0);
  const [showHandoffCta, setShowHandoffCta] = useState(false);

  // Tickets list + currently-open ticket detail.
  const [tickets, setTickets] = useState([]);
  const [activeTicket, setActiveTicket] = useState(/** @type {any} */(null));

  // ── persistence ─────────────────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem('ai_chat_history', JSON.stringify(aiMessages));
  }, [aiMessages]);

  // ── auto-scroll on every render that adds content ──────────────────────
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [aiMessages, activeTicket, isTyping, isOpen, view]);

  // ── load tickets when user opens the Tickets view, and react to admin
  //    replies in real time via the supportService broadcast. ─────────────
  const refreshTickets = useCallback(async () => {
    if (!isAuthenticated) {
      setTickets([]);
      return;
    }
    const list = await listMyTickets();
    setTickets(list);
  }, [isAuthenticated]);

  const refreshActiveTicket = useCallback(async () => {
    if (!activeTicketId) return;
    const data = await getTicket(activeTicketId);
    setActiveTicket(data);
  }, [activeTicketId]);

  useEffect(() => {
    refreshTickets();
    return onTicketsChanged(() => {
      refreshTickets();
      refreshActiveTicket();
    });
  }, [refreshTickets, refreshActiveTicket]);

  useEffect(() => {
    refreshActiveTicket();
  }, [activeTicketId, refreshActiveTicket]);

  // ── AI chat send handler (mock NLP — replace with real backend later) ──
  const handleAiSend = (e) => {
    e?.preventDefault();
    const text = inputText.trim();
    if (!text) return;

    /** @type {{id:number,sender:'user'|'ai',text:string,action?:{label:string,route:string}}} */
    const userMsg = { id: Date.now(), sender: 'user', text };
    setAiMessages((prev) => [...prev, userMsg]);
    setInputText('');
    setIsTyping(true);

    // Keyword-triggered immediate handoff suggestion.
    const lower = text.toLowerCase();
    if (HUMAN_KEYWORDS.some((kw) => lower.includes(kw))) {
      setShowHandoffCta(true);
    }

    setTimeout(() => {
      const reply = computeAiReply(text);
      setAiMessages((prev) => [...prev, { id: Date.now() + 1, sender: 'ai', ...reply }]);
      setIsTyping(false);
      setUnhelpfulStreak((s) => {
        const next = reply.action ? 0 : s + 1;
        if (next >= 2) setShowHandoffCta(true);
        return next;
      });
    }, 900);
  };

  /** Pure helper so we can unit-test it easily later. */
  function computeAiReply(text) {
    const q = text.toLowerCase();
    if (q.includes('saved')) {
      return {
        text:
          "I've pulled up your saved items on your tenant dashboard. " +
          'Would you like to review them now?',
        action: { label: 'Open Tenant Dashboard', route: '/tenant-dashboard' },
      };
    }
    if (q.includes('cheap') || q.includes('budget')) {
      return {
        text:
          'Here are budget-friendly listings in Dhaka.',
        action: { label: 'Browse Dhaka Listings', route: '/properties/dhaka' },
      };
    }
    if (q.includes('host') || q.includes('landlord') || (q.includes('list') && q.includes('property'))) {
      return {
        text: 'Sure - opening your host dashboard.',
        action: { label: 'Open Host Dashboard', route: '/host-dashboard' },
      };
    }
    if (q.includes('dashboard')) {
      return {
        text: 'Sure - opening your dashboard.',
        action: { label: 'Open Tenant Dashboard', route: '/tenant-dashboard' },
      };
    }
    return {
      text:
        "I'm not sure I have a great answer to that yet. Try asking about " +
        "'saved properties', 'budget homes', or your dashboard - or tap " +
        "'Talk to a human' below to get a teammate on the line.",
    };
  }

  // ── handoff: open a real ticket and switch into ticket view ────────────
  const handleHandoff = async () => {
    if (!isAuthenticated) {
      // Send to login, returning to whichever page they were on.
      navigate('/login');
      setIsOpen(false);
      return;
    }
    // Find the user's most recent question to seed the ticket; fall back
    // to a generic message if their last turn was the AI's.
    const lastUser = [...aiMessages].reverse().find((m) => m.sender === 'user');
    const initialMessage =
      lastUser?.text ?? 'I would like help from a human teammate.';
    /** @type {import('../services/supportService.js').TicketMessage[]} */
    const transcript = aiMessages.map((m) => ({
      id: String(m.id),
      author: m.sender === 'ai' ? 'ai' : 'user',
      authorId: m.sender === 'user' ? user?.id : undefined,
      authorName: m.sender === 'user' ? user?.name : 'AI Assistant',
      text: m.text,
      createdAt: new Date(typeof m.id === 'number' ? m.id : Date.now()).toISOString(),
    }));
    const ticket = await svcOpenTicket({ initialMessage, aiTranscript: transcript });
    setShowHandoffCta(false);
    setUnhelpfulStreak(0);
    setActiveTicketId(ticket.id);
    setView('ticket');
  };

  // ── ticket reply handler (user side) ───────────────────────────────────
  const handleTicketSend = async (e) => {
    e?.preventDefault();
    const text = inputText.trim();
    if (!text || !activeTicketId) return;
    setInputText('');
    await svcSendMessage(activeTicketId, text);
    // refreshActiveTicket fires automatically via the storage broadcast,
    // but we also nudge to feel snappy.
    refreshActiveTicket();
  };

  // ── view-mode dispatch for the input form ──────────────────────────────
  const onSubmit = view === 'ticket' ? handleTicketSend : handleAiSend;
  const inputDisabled = view === 'tickets';
  const placeholder =
    view === 'ai'
      ? 'Ask me anything…'
      : view === 'ticket'
      ? 'Type your reply to support…'
      : 'Open a ticket to start chatting';

  return (
    <div className="font-sans">
      {isOpen && (
        <Draggable
          nodeRef={chatWindowRef}
          bounds="body"
          handle=".drag-header"
          cancel=".no-drag"
        >
          <div
            ref={chatWindowRef}
            className="fixed bottom-[calc(64px+1rem+env(safe-area-inset-bottom))] md:bottom-24 right-4 md:right-8 z-[100] w-[calc(100vw-2rem)] md:w-[400px] h-[600px] max-h-[75vh] md:max-h-[80vh] flex flex-col bg-white/95 backdrop-blur-2xl rounded-[2rem] shadow-[0_30px_80px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.4)] overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-10 duration-300"
          >
            {/* ── header (drag handle) ───────────────────────────────── */}
            <div className="drag-header cursor-grab active:cursor-grabbing bg-gradient-to-r from-[#ba0036] to-[#d91a4d] p-4 flex items-center justify-between shrink-0 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2"></div>

              <div className="flex items-center gap-3 relative z-10">
                {view === 'ticket' && (
                  <button
                    onClick={() => {
                      setView('tickets');
                      setActiveTicketId(null);
                      setActiveTicket(null);
                    }}
                    className="no-drag p-1.5 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
                    aria-label="Back to tickets"
                  >
                    <ArrowLeft size={16} />
                  </button>
                )}
                <div className="bg-white/20 p-2 rounded-xl backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
                  {view === 'ai' ? <Bot size={20} className="text-white" /> : <Headphones size={20} className="text-white" />}
                </div>
                <div className="flex flex-col min-w-0">
                  <h3 className="font-black text-white text-sm tracking-wide truncate">
                    {view === 'ai'
                      ? 'TO-LET AI Assistant'
                      : view === 'tickets'
                      ? 'Your Support Tickets'
                      : activeTicket?.ticket?.subject || 'Support Conversation'}
                  </h3>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse shadow-[0_0_6px_rgba(74,222,128,0.6)]"></div>
                    <span className="text-[10px] text-white/80 font-medium">
                      {view === 'ai' ? 'Online & Ready' : 'Connected to support'}
                    </span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setIsOpen(false)}
                className="no-drag p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors relative z-10"
                aria-label="Minimize"
              >
                <Minimize2 size={16} />
              </button>
            </div>

            {/* ── view tabs (AI / Tickets) ───────────────────────────── */}
            {view !== 'ticket' && (
              <div className="flex bg-white border-b border-gray-100 shrink-0">
                <button
                  onClick={() => setView('ai')}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-black uppercase tracking-widest transition-colors ${
                    view === 'ai'
                      ? 'text-[#ba0036] border-b-2 border-[#ba0036]'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  <Bot size={14} /> AI Chat
                </button>
                <button
                  onClick={() => setView('tickets')}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-black uppercase tracking-widest transition-colors relative ${
                    view === 'tickets'
                      ? 'text-[#ba0036] border-b-2 border-[#ba0036]'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  <Inbox size={14} /> My Tickets
                  {tickets.filter((t) => t.status === 'open' || t.status === 'pending_user').length > 0 && (
                    <span className="ml-1 bg-[#ba0036] text-white text-[9px] font-black px-1.5 py-0.5 rounded-full">
                      {tickets.filter((t) => t.status === 'open' || t.status === 'pending_user').length}
                    </span>
                  )}
                </button>
              </div>
            )}

            {/* ── ad slot (AI view only) ─────────────────────────────── */}
            {view === 'ai' && (
              <div className="bg-gradient-to-r from-orange-50 to-red-50 shadow-[0_2px_6px_rgba(0,0,0,0.03)] p-2.5 flex items-center justify-between shrink-0 relative z-10">
                <div className="flex items-center gap-2">
                  <TrendingUp size={14} className="text-orange-600" />
                  <span className="text-[10px] font-bold text-gray-700 uppercase tracking-widest">Sponsored</span>
                </div>
                <a href="#" className="text-[10px] font-black text-[#ba0036] hover:underline flex items-center gap-1">
                  Get 20% off Premium <ExternalLink size={10} />
                </a>
              </div>
            )}

            {/* ── content area ────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 custom-scrollbar bg-[#f8f9fa]/50">
              {view === 'ai' && (
                <>
                  {aiMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex flex-col max-w-[85%] ${
                        msg.sender === 'user' ? 'self-end items-end' : 'self-start items-start'
                      }`}
                    >
                      <div
                        className={`px-4 py-3 shadow-md ${
                          msg.sender === 'user'
                            ? 'bg-gray-900 text-white rounded-[1.5rem] rounded-tr-sm'
                            : 'bg-white text-gray-800 rounded-[1.5rem] rounded-tl-sm'
                        }`}
                      >
                        <p className="text-sm font-medium leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                      </div>
                      {msg.action && (
                        <button
                          onClick={() => {
                            navigate(msg.action.route);
                            setIsOpen(false);
                          }}
                          className="mt-2 flex items-center gap-2 bg-[#ba0036]/10 text-[#ba0036] hover:bg-[#ba0036]/20 px-4 py-2 rounded-xl text-xs font-bold transition-colors shadow-[0_2px_8px_rgba(186,0,54,0.15)]"
                        >
                          <Sparkles size={12} /> {msg.action.label} <ExternalLink size={12} />
                        </button>
                      )}
                    </div>
                  ))}

                  {isTyping && (
                    <div className="self-start bg-white shadow-md px-4 py-3.5 rounded-[1.5rem] rounded-tl-sm flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></div>
                      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                    </div>
                  )}

                  {showHandoffCta && !isTyping && (
                    <div className="self-stretch bg-gradient-to-br from-[#ba0036]/5 to-white border border-[#ba0036]/15 rounded-2xl p-4 shadow-sm">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#ba0036]/10 text-[#ba0036] flex items-center justify-center shrink-0">
                          <Headphones size={16} />
                        </div>
                        <div className="flex-1">
                          <h4 className="text-sm font-black text-gray-900">Want a real human?</h4>
                          <p className="text-xs font-medium text-gray-600 mt-1">
                            We&apos;ll attach this whole conversation so you don&apos;t have to repeat yourself.
                          </p>
                          <div className="flex gap-2 mt-3">
                            <button
                              onClick={handleHandoff}
                              className="flex-1 bg-[#ba0036] hover:bg-[#d4004a] text-white px-4 py-2 rounded-xl text-xs font-black shadow-[0_4px_12px_rgba(186,0,54,0.25)] transition-colors"
                            >
                              Talk to a human
                            </button>
                            <button
                              onClick={() => setShowHandoffCta(false)}
                              className="px-3 py-2 rounded-xl text-xs font-bold text-gray-500 hover:bg-gray-100 transition-colors"
                            >
                              Not now
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {view === 'tickets' && (
                <>
                  {!isAuthenticated && (
                    <div className="bg-white rounded-2xl p-6 text-center shadow-sm">
                      <ShieldCheck size={32} className="text-gray-300 mx-auto mb-3" />
                      <h4 className="font-black text-gray-900 text-sm">Sign in to see your tickets</h4>
                      <p className="text-xs font-medium text-gray-500 mt-1">
                        We keep a record of every support conversation under your account.
                      </p>
                      <button
                        onClick={() => {
                          navigate('/login');
                          setIsOpen(false);
                        }}
                        className="mt-4 bg-[#ba0036] text-white px-5 py-2 rounded-xl text-xs font-black shadow-[0_4px_12px_rgba(186,0,54,0.2)]"
                      >
                        Sign in
                      </button>
                    </div>
                  )}
                  {isAuthenticated && tickets.length === 0 && (
                    <div className="bg-white rounded-2xl p-6 text-center shadow-sm">
                      <Inbox size={32} className="text-gray-300 mx-auto mb-3" />
                      <h4 className="font-black text-gray-900 text-sm">No tickets yet</h4>
                      <p className="text-xs font-medium text-gray-500 mt-1">
                        Ask the AI a question first — if it can&apos;t help, you can hand off to a human.
                      </p>
                      <button
                        onClick={() => setView('ai')}
                        className="mt-4 bg-gray-900 text-white px-5 py-2 rounded-xl text-xs font-black"
                      >
                        Open AI Chat
                      </button>
                    </div>
                  )}
                  {isAuthenticated &&
                    tickets.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => {
                          setActiveTicketId(t.id);
                          setView('ticket');
                        }}
                        className="text-left bg-white rounded-2xl p-4 shadow-sm hover:shadow-md transition-all border border-transparent hover:border-[#ba0036]/20"
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <h4 className="text-sm font-black text-gray-900 line-clamp-1">
                            {t.subject}
                          </h4>
                          <TicketStatusPill status={t.status} />
                        </div>
                        <p className="text-[11px] font-medium text-gray-500 flex items-center gap-1">
                          <Clock size={11} />
                          {timeAgo(t.updatedAt)}
                          {t.assignedAdminName && (
                            <>
                              <span className="mx-1">•</span>
                              <span className="font-bold">{t.assignedAdminName}</span>
                            </>
                          )}
                        </p>
                      </button>
                    ))}
                </>
              )}

              {view === 'ticket' && activeTicket && (
                <>
                  {activeTicket.messages.map((m) => (
                    <TicketMessageBubble key={m.id} message={m} myUserId={user?.id} />
                  ))}
                  {activeTicket.ticket.status === 'resolved' && (
                    <div className="self-stretch bg-green-50 border border-green-200 rounded-2xl p-3 text-center">
                      <CheckCircle2 size={16} className="text-green-600 inline-block mr-1.5" />
                      <span className="text-xs font-black text-green-700 uppercase tracking-widest">
                        Resolved by {activeTicket.ticket.assignedAdminName ?? 'Support'}
                      </span>
                    </div>
                  )}
                </>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* ── input row ───────────────────────────────────────────── */}
            {view !== 'tickets' && (
              <div className="p-3 bg-white shadow-[0_-4px_20px_rgba(0,0,0,0.03)] shrink-0 z-10 relative">
                <form
                  onSubmit={onSubmit}
                  className="flex items-center bg-[#f4f7fb] rounded-2xl p-1.5 shadow-inner focus-within:ring-2 focus-within:ring-[#ba0036]/10 transition-all"
                >
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder={placeholder}
                    disabled={inputDisabled}
                    className="flex-1 bg-transparent border-none outline-none text-sm font-medium text-gray-900 placeholder-gray-400 px-3 py-2 disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={!inputText.trim() || isTyping || inputDisabled}
                    className={`p-2.5 rounded-xl transition-all shrink-0 flex items-center justify-center ${
                      inputText.trim() && !isTyping && !inputDisabled
                        ? 'bg-[#ba0036] text-white shadow-[0_4px_12px_rgba(186,0,54,0.3)]'
                        : 'bg-gray-200 text-gray-400'
                    }`}
                  >
                    <Send size={16} className={inputText.trim() ? 'translate-x-0.5 -translate-y-0.5' : ''} />
                  </button>
                </form>
                <div className="text-center mt-2">
                  <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                    {view === 'ai'
                      ? 'AI responses may not always be 100% accurate'
                      : 'You\'re chatting with a human teammate'}
                  </span>
                </div>
              </div>
            )}
          </div>
        </Draggable>
      )}

      {!isOpen && (
        // The floating AI orb is intentionally NOT wrapped in <Draggable />.
        // On mobile touch devices Draggable would fire its onDrag handler
        // even for plain taps, then suppress the subsequent click — which
        // is why "tap the bot button" was doing nothing on phones. A plain
        // fixed-position button is reliable across mouse + touch.
        // Positioned above the bottom-nav (bottom-24 on mobile, bottom-6 on
        // desktop) so it never overlaps the rail. z-[100] keeps it above
        // sticky/modal layers.
        <button
          ref={floatingBtnRef}
          type="button"
          onClick={() => setIsOpen(true)}
          onTouchEnd={(e) => {
            e.preventDefault();
            setIsOpen(true);
          }}
          aria-label="Open AI assistant"
          className="fixed bottom-24 md:bottom-6 right-4 md:right-8 z-[100] group flex items-center justify-center animate-in zoom-in duration-500 cursor-pointer touch-manipulation select-none"
        >
          <div className="absolute inset-0 bg-[#ba0036] rounded-full blur-xl opacity-40 group-hover:opacity-70 group-hover:scale-110 transition-all duration-300 animate-pulse pointer-events-none"></div>
          <div className="relative w-14 h-14 bg-gradient-to-br from-[#ba0036] to-[#8a0028] rounded-full flex items-center justify-center shadow-[0_10px_30px_rgba(186,0,54,0.4),inset_0_1px_0_rgba(255,255,255,0.2)] group-hover:-translate-y-1 transition-transform duration-300 pointer-events-none">
            <Sparkles size={24} className="text-white" />
            <div className="absolute top-0 right-0 w-3.5 h-3.5 bg-green-400 shadow-[0_0_0_2px_white] rounded-full"></div>
          </div>
        </button>
      )}
    </div>
  );
};

// ─── small subcomponents ────────────────────────────────────────────────

const TicketStatusPill = ({ status }) => {
  const styles = {
    open: 'bg-blue-50 text-blue-600',
    pending_user: 'bg-amber-50 text-amber-700',
    resolved: 'bg-green-50 text-green-700',
    closed: 'bg-gray-100 text-gray-500',
  };
  const label = {
    open: 'Open',
    pending_user: 'Awaiting you',
    resolved: 'Resolved',
    closed: 'Closed',
  };
  return (
    <span
      className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full whitespace-nowrap ${
        styles[status] ?? 'bg-gray-100 text-gray-500'
      }`}
    >
      {label[status] ?? status}
    </span>
  );
};

const TicketMessageBubble = ({ message, myUserId }) => {
  if (message.author === 'system') {
    return (
      <div className="self-center bg-gray-100 text-gray-500 text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full">
        {message.text}
      </div>
    );
  }
  const mine = message.author === 'user' && message.authorId === myUserId;
  return (
    <div className={`flex flex-col max-w-[85%] ${mine ? 'self-end items-end' : 'self-start items-start'}`}>
      <div
        className={`px-4 py-3 shadow-md ${
          mine
            ? 'bg-gray-900 text-white rounded-[1.5rem] rounded-tr-sm'
            : message.author === 'admin'
            ? 'bg-[#ba0036] text-white rounded-[1.5rem] rounded-tl-sm'
            : 'bg-white text-gray-800 rounded-[1.5rem] rounded-tl-sm'
        }`}
      >
        <p className="text-sm font-medium leading-relaxed whitespace-pre-wrap">{message.text}</p>
      </div>
      <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-1 px-1">
        {message.author === 'admin'
          ? `Support · ${message.authorName ?? 'Team'}`
          : mine
          ? 'You'
          : message.authorName}
        {' · '}
        {timeAgo(message.createdAt)}
      </span>
    </div>
  );
};

// ─── helpers ────────────────────────────────────────────────────────────

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export default GlobalAIAssistant;
