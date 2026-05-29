import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  MessageSquare, Bot, Search, ShieldAlert, Clock, User as UserIcon,
  Send, Sparkles, CheckCircle2, RefreshCcw, AlertCircle, FileText,
  ShieldCheck, BadgeCheck, ChevronDown, ChevronRight, Inbox,
} from 'lucide-react';

import {
  listAllTickets,
  getTicketWithContext,
  sendAdminMessage,
  resolveTicket,
  reopenTicket,
  assignTicket,
  onTicketsChanged,
} from '../services/supportService.js';
import { logAuditAction } from '../services/adminService.js';
import { useAuth } from '../context/AuthContext.jsx';
import LoadingState from './common/LoadingState.jsx';
import EmptyState from './common/EmptyState.jsx';
import ErrorState from './common/ErrorState.jsx';

/**
 * Real ticket workspace for /admin/support.
 *
 * Layout:
 *   ┌────────────────────┬──────────────────────────────┬──────────────────┐
 *   │  Ticket list       │  Conversation thread          │  User context    │
 *   │  (filter, search)  │  + reply box + templates      │  + actions       │
 *   └────────────────────┴──────────────────────────────┴──────────────────┘
 *
 * State updates are real-time-ish via the supportService's broadcast event.
 * Replace that subscription with a WebSocket when the backend lands.
 */

/** Canned admin reply templates. Keep short, edit-friendly. */
const REPLY_TEMPLATES = [
  { id: 'apology', label: 'Apology for delay', body: "Apologies for the delay — we're looking into this now and will follow up within 1 business day." },
  { id: 'screenshot', label: 'Ask for a screenshot', body: "Could you share a screenshot of what you're seeing? It will help us track the issue down quickly." },
  { id: 'verifying', label: 'Verifying account', body: "We're verifying the details on your account. We'll be back in a few minutes." },
  { id: 'kyc-followup', label: 'KYC follow-up', body: "Your KYC document is being reviewed. You'll get a notification as soon as it's approved." },
  { id: 'closed', label: 'Closing message', body: "We're marking this ticket as resolved. If anything else comes up, just reply and we'll re-open it for you." },
];

const SupportAndAI = () => {
  const { user: adminUser } = useAuth();

  // ── data + ui state ──────────────────────────────────────────────────
  const [tickets, setTickets] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState(/** @type {Error|null} */(null));

  const [activeId, setActiveId] = useState(/** @type {string|null} */(null));
  const [activeTicket, setActiveTicket] = useState(/** @type {any} */(null));
  const [loadingActive, setLoadingActive] = useState(false);
  const [activeError, setActiveError] = useState(/** @type {Error|null} */(null));

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState(/** @type {'all'|'open'|'pending_user'|'resolved'} */('all'));

  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  // ── load helpers ─────────────────────────────────────────────────────
  const refreshList = useCallback(async () => {
    try {
      setListError(null);
      const list = await listAllTickets();
      setTickets(list);
    } catch (e) {
      setListError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoadingList(false);
    }
  }, []);

  const refreshActive = useCallback(async () => {
    if (!activeId) {
      setActiveTicket(null);
      return;
    }
    try {
      setActiveError(null);
      const data = await getTicketWithContext(activeId);
      setActiveTicket(data);
    } catch (e) {
      setActiveError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoadingActive(false);
    }
  }, [activeId]);

  useEffect(() => {
    setLoadingList(true);
    refreshList();
    return onTicketsChanged(() => {
      refreshList();
      refreshActive();
    });
  }, [refreshList, refreshActive]);

  useEffect(() => {
    if (activeId) {
      setLoadingActive(true);
      refreshActive();
    }
  }, [activeId, refreshActive]);

  // ── actions ──────────────────────────────────────────────────────────
  const handleSend = async (e) => {
    e?.preventDefault();
    const text = replyText.trim();
    if (!text || !activeId || sending) return;
    setSending(true);
    try {
      await sendAdminMessage(activeId, text);
      await logAuditAction({
        action: 'support.reply',
        targetType: 'ticket',
        targetId: activeId,
      });
      setReplyText('');
    } finally {
      setSending(false);
    }
  };

  const handleResolve = async () => {
    if (!activeId) return;
    await resolveTicket(activeId, 'Resolved by support agent.');
    await logAuditAction({
      action: 'support.resolve',
      targetType: 'ticket',
      targetId: activeId,
    });
  };

  const handleReopen = async () => {
    if (!activeId) return;
    await reopenTicket(activeId);
    await logAuditAction({
      action: 'support.reopen',
      targetType: 'ticket',
      targetId: activeId,
    });
  };

  const handleAssignSelf = async () => {
    if (!activeId || !adminUser) return;
    await assignTicket(activeId, { adminId: adminUser.id, adminName: adminUser.name });
    await logAuditAction({
      action: 'support.assign',
      targetType: 'ticket',
      targetId: activeId,
      reason: `Assigned to self (${adminUser.name})`,
    });
  };

  // ── derived ──────────────────────────────────────────────────────────
  const filteredTickets = useMemo(() => {
    let list = tickets;
    if (statusFilter !== 'all') list = list.filter((t) => t.status === statusFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (t) =>
          t.subject.toLowerCase().includes(q) ||
          t.userName.toLowerCase().includes(q) ||
          t.userPhone.toLowerCase().includes(q),
      );
    }
    return list;
  }, [tickets, statusFilter, searchQuery]);

  // ── render ───────────────────────────────────────────────────────────
  return (
    <div className="max-w-[1400px] mx-auto pt-4 pb-12 h-[calc(100vh-100px)] flex flex-col">
      <header className="mb-6 shrink-0">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-black text-gray-900 tracking-tight">Support &amp; AI Oversight</h1>
            <p className="text-sm font-bold text-gray-500 mt-2">
              Live tickets handed off from the AI assistant + every Help Center request, in one inbox.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs font-black text-gray-500">
            <SignedInChip name={adminUser?.name ?? 'Admin'} />
            <button
              onClick={refreshList}
              className="flex items-center gap-1.5 bg-white px-3 py-2 rounded-xl shadow-sm hover:shadow transition-all"
              title="Refresh ticket list"
            >
              <RefreshCcw size={12} /> Refresh
            </button>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        {/* ── ticket list ──────────────────────────────────────────── */}
        <aside className="col-span-12 md:col-span-3 bg-white rounded-[2rem] shadow-[0_4px_20px_rgba(0,0,0,0.02)] flex flex-col overflow-hidden min-h-0">
          <div className="p-5 pb-0 shrink-0">
            <div className="relative mb-4">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search subject, name, phone…"
                className="w-full bg-[#eaeff5]/50 py-3 pl-12 pr-4 rounded-xl outline-none font-bold text-sm text-gray-800 focus:bg-[#eaeff5] transition-all"
              />
            </div>

            <div className="flex gap-2 mb-4 overflow-x-auto -mx-1 px-1 pb-1">
              {/** @type {Array<{id:'all'|'open'|'pending_user'|'resolved',label:string}>} */ ([
                { id: 'all', label: 'All' },
                { id: 'open', label: 'Open' },
                { id: 'pending_user', label: 'Awaiting user' },
                { id: 'resolved', label: 'Resolved' },
              ]).map((f) => (
                <button
                  key={f.id}
                  onClick={() => setStatusFilter(f.id)}
                  className={`px-3 py-2 rounded-xl text-xs font-black whitespace-nowrap transition-all ${
                    statusFilter === f.id
                      ? 'bg-[#ba0036] text-white shadow-[0_4px_15px_rgba(186,0,54,0.3)]'
                      : 'bg-[#eaeff5]/50 text-gray-500 hover:bg-[#eaeff5]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 pb-3 custom-scrollbar space-y-2">
            {loadingList && <LoadingState label="Loading tickets" />}
            {!loadingList && listError && (
              <ErrorState onRetry={refreshList} description={listError.message} />
            )}
            {!loadingList && !listError && filteredTickets.length === 0 && (
              <EmptyState
                icon={Inbox}
                title="No tickets here"
                description="When users hand off from the AI assistant, their tickets land here."
                tone="success"
              />
            )}
            {!loadingList &&
              !listError &&
              filteredTickets.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveId(t.id)}
                  className={`w-full text-left p-4 rounded-2xl transition-all border ${
                    activeId === t.id
                      ? 'bg-[#ba0036]/5 border-[#ba0036]/30 shadow-sm'
                      : 'bg-white border-transparent hover:bg-[#eaeff5]/50'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <TicketAvatar ticket={t} />
                      <div className="min-w-0">
                        <h4 className="text-sm font-black text-gray-900 truncate">{t.userName}</h4>
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">
                          {t.origin?.source === 'ai_widget' ? 'AI Handoff' : 'Help Center'}
                        </p>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold text-gray-400 flex items-center gap-1 shrink-0">
                      <Clock size={10} /> {timeAgo(t.updatedAt)}
                    </span>
                  </div>
                  <p className="text-xs font-bold text-gray-700 line-clamp-1 pl-10">{t.subject}</p>
                  <div className="pl-10 mt-2 flex items-center gap-2">
                    <TicketStatusPill status={t.status} />
                    {t.assignedAdminName && (
                      <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">
                        · {t.assignedAdminName}
                      </span>
                    )}
                  </div>
                </button>
              ))}
          </div>
        </aside>

        {/* ── conversation thread ──────────────────────────────────── */}
        <section className="col-span-12 md:col-span-6 bg-white rounded-[2rem] shadow-[0_4px_20px_rgba(0,0,0,0.02)] flex flex-col overflow-hidden min-h-0">
          {!activeId && (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                <MessageSquare size={32} className="text-gray-300" />
              </div>
              <h3 className="text-xl font-black text-gray-900">Select a conversation</h3>
              <p className="text-sm font-bold text-gray-500 mt-2 max-w-sm">
                Pick a ticket on the left to read the user&apos;s message and reply.
              </p>
            </div>
          )}

          {activeId && loadingActive && <LoadingState label="Loading conversation" fullHeight />}

          {activeId && !loadingActive && activeError && (
            <div className="flex-1 flex items-center justify-center p-6">
              <ErrorState onRetry={refreshActive} description={activeError.message} />
            </div>
          )}

          {activeId && activeTicket && (
            <>
              <header className="p-5 border-b border-gray-100 shrink-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-black text-gray-900 truncate">
                      {activeTicket.ticket.subject}
                    </h2>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <TicketStatusPill status={activeTicket.ticket.status} />
                      <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                        {activeTicket.ticket.userName} ·{' '}
                        {activeTicket.ticket.userPhone}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!activeTicket.ticket.assignedAdminId && (
                      <button
                        onClick={handleAssignSelf}
                        className="text-xs font-black px-3 py-2 rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                      >
                        Assign to me
                      </button>
                    )}
                    {activeTicket.ticket.status === 'resolved' ? (
                      <button
                        onClick={handleReopen}
                        className="text-xs font-black px-3 py-2 rounded-xl bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
                      >
                        Reopen
                      </button>
                    ) : (
                      <button
                        onClick={handleResolve}
                        className="text-xs font-black px-3 py-2 rounded-xl bg-green-100 text-green-700 hover:bg-green-200 transition-colors flex items-center gap-1.5"
                      >
                        <CheckCircle2 size={12} /> Mark resolved
                      </button>
                    )}
                  </div>
                </div>

                {/* AI transcript collapsible (only for ai_widget origin tickets) */}
                {activeTicket.ticket.origin?.aiTranscript?.length > 0 && (
                  <button
                    onClick={() => setShowTranscript((s) => !s)}
                    className="mt-3 flex items-center gap-1.5 text-[10px] font-black text-[#ba0036] uppercase tracking-widest"
                  >
                    {showTranscript ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    AI transcript ({activeTicket.ticket.origin.aiTranscript.length} messages)
                  </button>
                )}
                {showTranscript && (
                  <div className="mt-2 bg-gray-50 rounded-xl p-3 max-h-40 overflow-y-auto space-y-2">
                    {activeTicket.ticket.origin.aiTranscript.map((m) => (
                      <div key={m.id} className="text-[11px] font-medium text-gray-700">
                        <span className="font-black uppercase tracking-widest text-gray-400 mr-1.5">
                          {m.author === 'ai' ? 'AI' : 'User'}:
                        </span>
                        {m.text}
                      </div>
                    ))}
                  </div>
                )}
              </header>

              <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4 custom-scrollbar bg-[#f8f9fa]/40">
                {activeTicket.messages.map((m) => (
                  <AdminMessageBubble key={m.id} message={m} adminId={adminUser?.id} />
                ))}
              </div>

              <div className="p-4 border-t border-gray-100 shrink-0 bg-white">
                {showTemplates && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {REPLY_TEMPLATES.map((tpl) => (
                      <button
                        key={tpl.id}
                        onClick={() => {
                          setReplyText((cur) => (cur ? cur + '\n\n' + tpl.body : tpl.body));
                          setShowTemplates(false);
                        }}
                        className="text-[10px] font-black uppercase tracking-widest bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-full transition-colors"
                      >
                        {tpl.label}
                      </button>
                    ))}
                  </div>
                )}
                <form onSubmit={handleSend} className="flex items-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowTemplates((s) => !s)}
                    className="p-3 rounded-2xl bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors shrink-0"
                    title="Reply templates"
                  >
                    <Sparkles size={16} />
                  </button>
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend(e);
                    }}
                    rows={2}
                    placeholder="Type your reply… (⌘/Ctrl + Enter to send)"
                    className="flex-1 bg-[#f4f7fb] rounded-2xl p-3 text-sm font-medium text-gray-900 placeholder-gray-400 outline-none focus:ring-2 focus:ring-[#ba0036]/20 resize-none"
                    disabled={sending || activeTicket.ticket.status === 'closed'}
                  />
                  <button
                    type="submit"
                    disabled={!replyText.trim() || sending || activeTicket.ticket.status === 'closed'}
                    className={`p-3 rounded-2xl shrink-0 transition-all ${
                      replyText.trim() && !sending
                        ? 'bg-[#ba0036] text-white shadow-[0_4px_12px_rgba(186,0,54,0.3)] hover:shadow-lg'
                        : 'bg-gray-200 text-gray-400'
                    }`}
                  >
                    <Send size={16} />
                  </button>
                </form>
              </div>
            </>
          )}
        </section>

        {/* ── user context rail ───────────────────────────────────── */}
        <aside className="col-span-12 md:col-span-3 space-y-4 overflow-y-auto custom-scrollbar min-h-0 pb-2">
          {!activeTicket && (
            <div className="bg-white rounded-[2rem] p-8 text-center shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
              <UserIcon size={28} className="text-gray-300 mx-auto mb-3" />
              <h4 className="text-sm font-black text-gray-900">User context</h4>
              <p className="text-xs font-bold text-gray-500 mt-2">
                Pick a ticket to see profile, KYC status, and recent activity.
              </p>
            </div>
          )}

          {activeTicket && (
            <UserContextCard
              ctx={activeTicket.userContext}
              ticket={activeTicket.ticket}
            />
          )}
        </aside>
      </div>
    </div>
  );
};

// ─── tiny presentational components ────────────────────────────────────

const SignedInChip = ({ name }) => (
  <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-xl shadow-sm">
    <div className="w-6 h-6 rounded-full bg-[#ba0036]/10 text-[#ba0036] flex items-center justify-center">
      <ShieldCheck size={12} />
    </div>
    <span className="text-xs font-black text-gray-700 truncate max-w-[160px]">{name}</span>
  </div>
);

const TicketAvatar = ({ ticket }) => {
  if (ticket.origin?.source === 'ai_widget') {
    return (
      <div className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-500 flex items-center justify-center shrink-0">
        <Bot size={16} />
      </div>
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-500 flex items-center justify-center shrink-0">
      <UserIcon size={16} />
    </div>
  );
};

const TicketStatusPill = ({ status }) => {
  const styles = {
    open: 'bg-blue-50 text-blue-600',
    pending_user: 'bg-amber-50 text-amber-700',
    resolved: 'bg-green-50 text-green-700',
    closed: 'bg-gray-100 text-gray-500',
  };
  const label = {
    open: 'Open',
    pending_user: 'Awaiting user',
    resolved: 'Resolved',
    closed: 'Closed',
  };
  return (
    <span
      className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${
        styles[status] ?? 'bg-gray-100 text-gray-500'
      }`}
    >
      {label[status] ?? status}
    </span>
  );
};

const AdminMessageBubble = ({ message, adminId }) => {
  if (message.author === 'system') {
    return (
      <div className="self-center bg-gray-100 text-gray-500 text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full">
        {message.text}
      </div>
    );
  }
  const fromMe = message.author === 'admin' && message.authorId === adminId;
  const adminBubble = message.author === 'admin';
  return (
    <div className={`flex flex-col max-w-[80%] ${adminBubble ? 'self-end items-end' : 'self-start items-start'}`}>
      <div
        className={`px-4 py-3 shadow-sm ${
          adminBubble
            ? 'bg-gray-900 text-white rounded-[1.5rem] rounded-tr-sm'
            : 'bg-white text-gray-800 rounded-[1.5rem] rounded-tl-sm'
        }`}
      >
        <p className="text-sm font-medium leading-relaxed whitespace-pre-wrap">{message.text}</p>
      </div>
      <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-1 px-1">
        {adminBubble
          ? `${fromMe ? 'You' : message.authorName ?? 'Support'} · ${timeAgo(message.createdAt)}`
          : `${message.authorName ?? 'User'} · ${timeAgo(message.createdAt)}`}
      </span>
    </div>
  );
};

const UserContextCard = ({ ctx, ticket }) => (
  <>
    <div className="bg-white rounded-[2rem] p-5 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#ba0036] to-[#8a0028] text-white flex items-center justify-center font-black text-base">
          {ctx.name?.[0]?.toUpperCase() ?? 'U'}
        </div>
        <div className="min-w-0">
          <h4 className="text-sm font-black text-gray-900 truncate">{ctx.name}</h4>
          <p className="text-[10px] font-bold text-gray-500 truncate">{ctx.phone}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <Stat label="Trust" value={String(ctx.trustScore)} icon={BadgeCheck} />
        <Stat label="Tickets" value={`${ctx.openTicketCount} open`} icon={MessageSquare} />
      </div>

      <div className="space-y-2 text-[11px] font-bold text-gray-600">
        <Line
          icon={ctx.kycVerified ? CheckCircle2 : AlertCircle}
          tone={ctx.kycVerified ? 'green' : 'amber'}
          label={ctx.kycVerified ? 'KYC verified' : 'KYC not verified'}
        />
        <Line
          icon={Inbox}
          label={`${ctx.resolvedTicketCount} resolved past tickets`}
        />
        {ticket.origin?.source === 'ai_widget' && (
          <Line icon={Bot} label="Came from AI handoff" />
        )}
      </div>
    </div>

    <div className="bg-white rounded-[2rem] p-5 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
      <h4 className="text-xs font-black uppercase tracking-widest text-gray-500 mb-3">
        Quick actions
      </h4>
      <div className="space-y-2">
        <ActionRow icon={FileText} label="Open user profile" disabled hint="Coming next slice" />
        <ActionRow icon={ShieldAlert} label="Flag account for review" disabled hint="Coming next slice" />
        <ActionRow icon={MessageSquare} label="View all tickets" disabled hint="Coming next slice" />
      </div>
    </div>
  </>
);

const Stat = ({ label, value, icon: Icon }) => (
  <div className="bg-[#f4f7fb] rounded-2xl p-3">
    <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-gray-400">
      <Icon size={10} /> {label}
    </div>
    <div className="text-base font-black text-gray-900 mt-1">{value}</div>
  </div>
);

const Line = ({ icon: Icon, label, tone = 'gray' }) => {
  const toneClass = tone === 'green'
    ? 'text-green-600'
    : tone === 'amber'
    ? 'text-amber-600'
    : 'text-gray-500';
  return (
    <div className="flex items-center gap-2">
      <Icon size={12} className={toneClass} />
      <span>{label}</span>
    </div>
  );
};

const ActionRow = ({ icon: Icon, label, disabled, hint }) => (
  <button
    disabled={disabled}
    className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-xs font-black transition-colors ${
      disabled
        ? 'bg-gray-50 text-gray-400 cursor-not-allowed'
        : 'bg-[#f4f7fb] text-gray-700 hover:bg-[#eaeff5]'
    }`}
    title={hint}
  >
    <span className="flex items-center gap-2">
      <Icon size={14} /> {label}
    </span>
    {disabled && <span className="text-[9px] uppercase tracking-widest">soon</span>}
  </button>
);

// ─── helpers ───────────────────────────────────────────────────────────

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}

export default SupportAndAI;
