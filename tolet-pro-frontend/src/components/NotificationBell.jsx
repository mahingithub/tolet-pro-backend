/**
 * NotificationBell.jsx
 * ──────────────────────────────────────────────────────────────────────────
 * Header-mounted bell with an unread badge. Polls /api/notifications/unread-count
 * every 15s while the user is logged in. Click opens a dropdown that loads
 * the latest 20 notifications and lets the user mark them read or jump to
 * the referenced surface (inquiry / conversation).
 */

import React, { useEffect, useRef, useState } from 'react';
import { Bell, MessageCircle, Inbox, CheckCheck, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import notificationService from '../services/notificationService';

const POLL_INTERVAL_MS = 15_000;

const typeIcon = (t) => {
  if (t === 'message_new')     return <MessageCircle size={14} className="text-blue-500" />;
  if (t === 'inquiry_new')     return <Inbox         size={14} className="text-[#ba0036]" />;
  if (t === 'inquiry_status')  return <CheckCheck    size={14} className="text-emerald-500" />;
  return <Bell size={14} className="text-amber-500" />;
};

const formatTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)   return 'now';
  if (m < 60)  return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString();
};

export default function NotificationBell({ isAuthed, className = '' }) {
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef(null);

  // Poll unread count.
  useEffect(() => {
    if (!isAuthed) {
      setUnread(0);
      return undefined;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const n = await notificationService.getUnreadCount();
        if (!cancelled) setUnread(n);
      } catch { /* silent */ }
    };
    tick();
    const t = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [isAuthed]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const loadList = async () => {
    setLoading(true);
    try {
      const { items: rows, unread: u } = await notificationService.listNotifications({ limit: 20 });
      setItems(rows);
      setUnread(u);
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  const handleOpen = async () => {
    if (!isAuthed) {
      navigate('/login?next=%2Fsmart-alerts');
      return;
    }
    if (!open) await loadList();
    setOpen((o) => !o);
  };

  const handleRowClick = async (n) => {
    // Optimistically mark as read.
    if (!n.read) {
      setItems((prev) => prev.map((x) => x.id === n.id ? { ...x, read: true } : x));
      setUnread((u) => Math.max(0, u - 1));
      notificationService.markRead(n.id).catch(() => { /* silent */ });
    }
    setOpen(false);

    // Deep-link by type.
    if (n.type === 'message_new' && n.data?.conversationId) {
      navigate('/messages');
      return;
    }
    if (n.type === 'inquiry_new' && n.data?.inquiryId) {
      // Landlord inbox lives on the host dashboard.
      navigate('/host-dashboard?tab=inquiries');
      return;
    }
    if (n.type === 'inquiry_status' && n.data?.inquiryId) {
      navigate('/tenant-dashboard?tab=inquiries');
      return;
    }
    navigate('/smart-alerts');
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationService.markAllRead();
      setItems((prev) => prev.map((x) => ({ ...x, read: true })));
      setUnread(0);
    } catch { /* silent */ }
  };

  if (!isAuthed) {
    return (
      <button
        type="button"
        onClick={handleOpen}
        aria-label="Notifications"
        className={`relative p-2 rounded-xl text-gray-700 bg-white/70 backdrop-blur-md border border-white/60 shadow-sm hover:text-[#ba0036] hover:bg-red-50 hover:border-red-100 transition-all ${className}`}
      >
        <Bell size={18} strokeWidth={2.4} />
      </button>
    );
  }

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={handleOpen}
        aria-label="Notifications"
        className="relative p-2 rounded-xl text-gray-700 bg-white/70 backdrop-blur-md border border-white/60 shadow-sm hover:text-[#ba0036] hover:bg-red-50 hover:border-red-100 transition-all"
      >
        <Bell size={18} strokeWidth={2.4} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#ba0036] text-white text-[10px] font-black flex items-center justify-center ring-2 ring-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-2xl shadow-[0_18px_60px_rgba(0,0,0,0.15)] border border-gray-100 z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h4 className="text-sm font-black text-gray-900">Notifications</h4>
            <div className="flex items-center gap-2">
              {unread > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="text-[10px] font-black text-[#ba0036] hover:underline uppercase tracking-wide"
                >
                  Mark all read
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1 rounded-md text-gray-400 hover:text-gray-700"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="py-8 text-center text-xs font-bold text-gray-400">Loading…</div>
            ) : items.length === 0 ? (
              <div className="py-10 text-center px-6">
                <Bell size={20} className="mx-auto text-gray-300 mb-2" />
                <p className="text-xs font-bold text-gray-400">You're all caught up.</p>
              </div>
            ) : (
              items.map((n) => (
                <button
                  type="button"
                  key={n.id}
                  onClick={() => handleRowClick(n)}
                  className={`w-full text-left flex gap-3 px-4 py-3 border-b border-gray-50 last:border-b-0 hover:bg-gray-50 transition-colors ${!n.read ? 'bg-red-50/30' : ''}`}
                >
                  <div className="mt-0.5 shrink-0">{typeIcon(n.type)}</div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-[12px] truncate ${!n.read ? 'font-black text-gray-900' : 'font-bold text-gray-700'}`}>
                      {n.title || 'Notification'}
                    </p>
                    {n.body ? (
                      <p className="text-[11px] text-gray-500 line-clamp-2 mt-0.5">{n.body}</p>
                    ) : null}
                    <p className="text-[10px] font-black uppercase tracking-wider text-gray-400 mt-1">
                      {formatTime(n.createdAt)}
                    </p>
                  </div>
                  {!n.read && (
                    <span className="w-2 h-2 mt-1.5 rounded-full bg-[#ba0036] shrink-0" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
