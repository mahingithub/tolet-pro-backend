// CallDetailModal.jsx
//
// Phase Call-4: tap any row in the Calls tab → this modal opens with the
// full detail of that call and quick actions (voice, video, message, profile).
//
// It's a controlled component: ChatSystem owns `selectedCall` and passes the
// described call in. All actions are delegated up via callbacks so the modal
// stays dumb and reusable.
//
// Styling mirrors the rest of the app: white glass card, brand #ba0036,
// framer-motion entrance. Only uses lucide icons already imported elsewhere
// (Phone, Video, MessageCircle) plus inline SVG, so it adds no new icon risk.

import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, Video, MessageCircle } from 'lucide-react';
import callService from '../services/callService';

const { formatCallDuration } = callService;

const sameDay = (a, b) => {
  if (!a || !b) return false;
  const x = new Date(a), y = new Date(b);
  if (isNaN(x.getTime()) || isNaN(y.getTime())) return false;
  return x.getFullYear() === y.getFullYear() &&
         x.getMonth() === y.getMonth() &&
         x.getDate() === y.getDate();
};

const fmtAbs = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
};

const fmtTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// Map describeCall's normalised status → label + colour.
const statusInfo = (call) => {
  switch (call.status) {
    case 'missed':      return { label: 'Missed call',    tone: 'text-red-600' };
    case 'no-answer':   return { label: 'No answer',      tone: 'text-red-600' };
    case 'declined':    return { label: call.direction === 'outgoing' ? 'Declined' : 'You declined', tone: 'text-red-600' };
    case 'completed':   return { label: 'Completed',      tone: 'text-green-600' };
    case 'in-progress': return { label: 'In progress',    tone: 'text-amber-600' };
    default:            return { label: call.status || '—', tone: 'text-gray-600' };
  }
};

export default function CallDetailModal({
  call,
  calls = [],
  onClose,
  onCall,         // (type: 'voice'|'video') => void
  onMessage,      // () => void
  onViewProfile,  // () => void  (optional)
}) {
  // Group: how many calls with this same peer happened today.
  const todayWithPeer = useMemo(() => {
    if (!call?.peer?.id) return [];
    return calls.filter(
      (c) => c.peer?.id === call.peer.id && sameDay(c.iso, new Date()),
    );
  }, [calls, call]);

  // A short recent history with this peer (most recent first, cap 5).
  const recentWithPeer = useMemo(() => {
    if (!call?.peer?.id) return [];
    return calls
      .filter((c) => c.peer?.id === call.peer.id && c.id !== call.id)
      .slice(0, 5);
  }, [calls, call]);

  if (!call) return null;

  const peer = call.peer || {};
  const initials = (peer.name || '?')
    .split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  const { label, tone } = statusInfo(call);
  const isVideo = call.type === 'video';

  return (
    <AnimatePresence>
      {call && (
        <motion.div
          className="fixed inset-0 z-[140] flex items-end sm:items-center justify-center p-0 sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-gray-900/50 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Sheet / card */}
          <motion.div
            className="relative w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden"
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          >
            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-all"
              aria-label="Close"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>

            {/* Header: avatar + name */}
            <div className="pt-8 pb-5 px-6 flex flex-col items-center text-center bg-gradient-to-b from-gray-50 to-white">
              <div className="w-20 h-20 rounded-[1.75rem] overflow-hidden shadow-md mb-3 shrink-0">
                {peer.profilePicture ? (
                  <img src={peer.profilePicture} alt={peer.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-[#ba0036] to-[#7a0024] flex items-center justify-center text-white font-black text-2xl">
                    {initials || '?'}
                  </div>
                )}
              </div>
              <h3 className="text-xl font-black text-gray-900">{peer.name || 'Unknown'}</h3>
              {peer.phone && (
                <p className="text-[13px] font-bold text-gray-500 mt-0.5">{peer.phone}</p>
              )}
              <div className="flex items-center gap-1.5 mt-2">
                {isVideo ? <Video size={14} className={tone} /> : <Phone size={14} className={tone} />}
                <span className={`text-[12px] font-black uppercase tracking-widest ${tone}`}>
                  {label}
                </span>
                {call.status === 'completed' && call.durationSec > 0 && (
                  <span className="text-[12px] font-bold text-gray-400">· {formatCallDuration(call.durationSec)}</span>
                )}
              </div>
              {todayWithPeer.length > 1 && (
                <span className="mt-2 text-[10px] font-black uppercase tracking-widest text-[#ba0036] bg-red-50 border border-red-100 px-2.5 py-1 rounded-full">
                  {todayWithPeer.length} calls today
                </span>
              )}
            </div>

            {/* Detail rows */}
            <div className="px-6 py-3 space-y-2.5 border-t border-gray-100">
              <DetailRow k="Direction" v={call.direction === 'outgoing' ? 'Outgoing' : 'Incoming'} />
              <DetailRow k="Type" v={isVideo ? 'Video call' : 'Voice call'} />
              <DetailRow k="Started" v={fmtAbs(call.startedAt || call.iso)} />
              <DetailRow k="Ended" v={call.endedAt ? fmtAbs(call.endedAt) : '—'} />
              {call.durationSec > 0 && (
                <DetailRow k="Duration" v={formatCallDuration(call.durationSec)} />
              )}
              {call.roomId && (
                <DetailRow k="Room ID" v={<span className="font-mono text-[10px] text-gray-400 break-all">{call.roomId}</span>} />
              )}
            </div>

            {/* Recent with this peer */}
            {recentWithPeer.length > 0 && (
              <div className="px-6 pb-2">
                <p className="text-[9px] font-black uppercase tracking-[0.18em] text-gray-400 mb-1.5">
                  Recent with {peer.name?.split(' ')[0] || 'them'}
                </p>
                <div className="space-y-1">
                  {recentWithPeer.map((c) => {
                    const ci = statusInfo(c);
                    return (
                      <div key={c.id} className="flex items-center gap-2 text-[11px]">
                        {c.type === 'video'
                          ? <Video size={11} className={`${ci.tone} shrink-0`} />
                          : <Phone size={11} className={`${ci.tone} shrink-0`} />}
                        <span className={`font-bold ${ci.tone}`}>{ci.label}</span>
                        <span className="text-gray-400 font-bold ml-auto">
                          {c.status === 'completed' && c.durationSec > 0 ? `${formatCallDuration(c.durationSec)} · ` : ''}
                          {fmtTime(c.iso)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="p-4 grid grid-cols-2 gap-2.5 border-t border-gray-100 bg-gray-50/50">
              <button
                onClick={() => onCall?.('voice')}
                className="flex items-center justify-center gap-2 py-3 rounded-2xl bg-green-50 hover:bg-green-100 text-green-700 font-black text-[13px] transition-all active:scale-95"
              >
                <Phone size={16} /> Voice
              </button>
              <button
                onClick={() => onCall?.('video')}
                className="flex items-center justify-center gap-2 py-3 rounded-2xl bg-blue-50 hover:bg-blue-100 text-blue-700 font-black text-[13px] transition-all active:scale-95"
              >
                <Video size={16} /> Video
              </button>
              <button
                onClick={() => onMessage?.()}
                className="flex items-center justify-center gap-2 py-3 rounded-2xl bg-[#ba0036] hover:bg-[#90002a] text-white font-black text-[13px] shadow-md transition-all active:scale-95"
              >
                <MessageCircle size={16} /> Message
              </button>
              <button
                onClick={() => onViewProfile?.()}
                disabled={!onViewProfile || !peer.id}
                className="flex items-center justify-center gap-2 py-3 rounded-2xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-black text-[13px] transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                Profile
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const DetailRow = ({ k, v }) => (
  <div className="flex items-center justify-between gap-4">
    <span className="text-[11px] font-black uppercase tracking-widest text-gray-400 shrink-0">{k}</span>
    <span className="text-[13px] font-bold text-gray-800 text-right">{v}</span>
  </div>
);
