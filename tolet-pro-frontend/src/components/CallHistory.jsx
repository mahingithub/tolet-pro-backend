// CallHistory.jsx
//
// The "Calls" tab of the Messages surface — a Messenger / WhatsApp-style
// list of every call the user has made or received. Mounted by ChatSystem
// when the sidebar tab flips Messages → Calls.
//
// Phase Call-4 additions:
//   • Filter tabs: All / Missed / Incoming / Outgoing (Missed shows a red count)
//   • Swipe a row right → call back, left → delete (framer-motion gestures)
//   • Tap a row → open the call detail modal (onSelectCall)
//
// Icons: only lucide icons already proven elsewhere in the app are imported
// (lucide-react is pinned old); the delete/trash glyph is inline SVG.

import React, { useState, useRef, useMemo } from 'react';
import {
  motion, AnimatePresence, useMotionValue, useTransform, animate,
} from 'framer-motion';
import {
  Phone, Video, PhoneIncoming, PhoneOutgoing, PhoneMissed,
  PhoneOff, Bot,
} from 'lucide-react';
import callService from '../services/callService';

const { formatCallDuration } = callService;

// ─── Time formatting (Today, Yesterday, Mon 5 Aug …) ────────────────────────
const sameDay = (a, b) => {
  if (!a || !b) return false;
  const x = new Date(a), y = new Date(b);
  if (isNaN(x.getTime()) || isNaN(y.getTime())) return false;
  return x.getFullYear() === y.getFullYear() &&
         x.getMonth() === y.getMonth() &&
         x.getDate() === y.getDate();
};

const formatCallTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const today = new Date();
  const yest  = new Date(); yest.setDate(today.getDate() - 1);
  const time  = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay(d, today)) return `Today, ${time}`;
  if (sameDay(d, yest))  return `Yesterday, ${time}`;
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) + `, ${time}`;
};

// ─── Per-call status icon + colour palette ───────────────────────────────────
const statusVisuals = (call) => {
  if (call.status === 'missed') {
    return { Icon: PhoneMissed,   color: 'text-red-600',   label: 'Missed' };
  }
  if (call.status === 'no-answer') {
    return { Icon: PhoneOff,      color: 'text-red-600',   label: 'No answer' };
  }
  if (call.status === 'declined') {
    return { Icon: PhoneOff,      color: 'text-red-600',
             label: call.direction === 'outgoing' ? 'Declined' : 'You declined' };
  }
  if (call.direction === 'incoming') {
    return { Icon: PhoneIncoming, color: 'text-green-600', label: 'Incoming' };
  }
  return { Icon: PhoneOutgoing, color: 'text-blue-600',  label: 'Outgoing' };
};

// ─── The visible row content (shared; sits on top of the swipe actions) ──────
const RowContent = ({ call, onCallBack }) => {
  const { Icon, color, label } = statusVisuals(call);
  const initials = (call.peer?.name || '?')
    .split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();
  const isCompleted = call.status === 'completed';
  const isMissedOrDeclined = call.status === 'missed' || call.status === 'declined' || call.status === 'no-answer';
  const TypeIcon = call.type === 'video' ? Video : Phone;

  return (
    <div className="w-full p-3 sm:p-4 flex items-center gap-3">
      {/* Avatar */}
      <div className="relative shrink-0">
        {call.peer?.profilePicture ? (
          <img
            src={call.peer.profilePicture}
            className="w-12 h-12 rounded-full object-cover"
            alt={call.peer.name}
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-gray-700 font-black text-sm">
            {initials || <Bot size={18}/>}
          </div>
        )}
      </div>

      {/* Main column */}
      <div className="flex-1 min-w-0">
        <h4 className={`font-black text-[13px] truncate ${isMissedOrDeclined ? 'text-red-600' : 'text-gray-900'}`}>
          {call.peer?.name || 'Unknown'}
        </h4>
        <div className="flex items-center gap-1.5 mt-0.5">
          <Icon size={12} className={`${color} shrink-0`} strokeWidth={2.5}/>
          <p className="text-[11px] font-bold text-gray-500 truncate">
            {label}
            {isCompleted && call.durationSec > 0 && (
              <span className="text-gray-400"> · {formatCallDuration(call.durationSec)}</span>
            )}
            <span className="text-gray-400"> · {formatCallTime(call.iso)}</span>
          </p>
        </div>
      </div>

      {/* Tap-to-call-back icon (stops propagation so it doesn't open the modal) */}
      <button
        onClick={(e) => { e.stopPropagation(); onCallBack?.(call); }}
        onPointerDownCapture={(e) => e.stopPropagation()}
        className={`shrink-0 p-2.5 rounded-xl transition-all active:scale-90 ${
          call.type === 'video'
            ? 'bg-blue-50 hover:bg-blue-100 text-blue-600'
            : 'bg-green-50 hover:bg-green-100 text-green-600'
        }`}
        aria-label={`Call ${call.peer?.name || 'back'}`}
        title={`${call.type === 'video' ? 'Video' : 'Voice'} call back`}
      >
        <TypeIcon size={16}/>
      </button>
    </div>
  );
};

// ─── Swipeable wrapper: right → call back, left → delete, tap → details ──────
const SWIPE_TRIGGER = 64;

const SwipeableRow = ({ call, onCallBack, onSelectCall, onDelete }) => {
  const x = useMotionValue(0);
  const callOpacity = useTransform(x, [8, 56], [0, 1]);   // green reveal (right swipe)
  const delOpacity  = useTransform(x, [-56, -8], [1, 0]); // red reveal (left swipe)
  const draggedRef = useRef(false);

  const snapBack = () => animate(x, 0, { type: 'spring', stiffness: 500, damping: 40 });

  const handleDragEnd = (_e, info) => {
    const dx = info.offset.x;
    if (dx <= -SWIPE_TRIGGER) {
      animate(x, -420, { duration: 0.18 });
      setTimeout(() => onDelete?.(call), 160);
    } else if (dx >= SWIPE_TRIGGER) {
      snapBack();
      onCallBack?.(call);
    } else {
      snapBack();
    }
  };

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {/* Call-back action (revealed on right swipe) */}
      <motion.div
        style={{ opacity: callOpacity }}
        className="absolute inset-y-0 left-0 right-0 flex items-center pl-5 bg-green-500 rounded-2xl pointer-events-none"
        aria-hidden="true"
      >
        <Phone size={20} className="text-white" />
        <span className="ml-2 text-white font-black text-sm uppercase tracking-widest">Call back</span>
      </motion.div>

      {/* Delete action (revealed on left swipe) */}
      <motion.div
        style={{ opacity: delOpacity }}
        className="absolute inset-y-0 left-0 right-0 flex items-center justify-end pr-5 bg-red-500 rounded-2xl pointer-events-none"
        aria-hidden="true"
      >
        <span className="mr-2 text-white font-black text-sm uppercase tracking-widest">Delete</span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
             stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      </motion.div>

      {/* Foreground (opaque so it hides the actions at rest) */}
      <motion.div
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: -96, right: 96 }}
        dragElastic={0.45}
        style={{ x }}
        onDragStart={() => { draggedRef.current = false; }}
        onDrag={(_e, info) => { if (Math.abs(info.offset.x) > 6) draggedRef.current = true; }}
        onDragEnd={handleDragEnd}
        onClick={() => {
          if (draggedRef.current) { draggedRef.current = false; return; }
          onSelectCall?.(call);
        }}
        className="relative bg-white hover:bg-gray-50 rounded-2xl cursor-pointer select-none active:bg-gray-100 transition-colors"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') onSelectCall?.(call); }}
      >
        <RowContent call={call} onCallBack={onCallBack} />
      </motion.div>
    </div>
  );
};

// ─── Day dividers ─────────────────────────────────────────────────────────
const DayGroup = ({ label }) => (
  <div className="px-4 pt-4 pb-1 text-[9px] font-black uppercase tracking-[0.18em] text-gray-400">
    {label}
  </div>
);

const groupByDay = (calls) => {
  const groups = [];
  let lastLabel = null;
  for (const c of calls) {
    const d = new Date(c.iso);
    if (isNaN(d.getTime())) continue;
    const today = new Date();
    const yest = new Date(); yest.setDate(today.getDate() - 1);
    let label;
    if (sameDay(d, today)) label = 'Today';
    else if (sameDay(d, yest)) label = 'Yesterday';
    else label = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
    if (label !== lastLabel) {
      groups.push({ kind: 'divider', id: `d-${label}`, label });
      lastLabel = label;
    }
    groups.push({ kind: 'row', id: c.id, call: c });
  }
  return groups;
};

// ─── Filter tabs ────────────────────────────────────────────────────────────
const FILTERS = [
  { key: 'all',      label: 'All' },
  { key: 'missed',   label: 'Missed' },
  { key: 'incoming', label: 'Incoming' },
  { key: 'outgoing', label: 'Outgoing' },
];

const matchesFilter = (c, filter) => {
  if (filter === 'all') return true;
  if (filter === 'missed') return c.status === 'missed';
  if (filter === 'incoming') return c.direction === 'incoming';
  if (filter === 'outgoing') return c.direction === 'outgoing';
  return true;
};

const FilterTabs = ({ filter, setFilter, counts }) => (
  <div className="flex gap-1.5 px-3 pb-2">
    {FILTERS.map(({ key, label }) => {
      const active = filter === key;
      const showMissedBadge = key === 'missed' && counts.missed > 0;
      return (
        <button
          key={key}
          onClick={() => setFilter(key)}
          className={`flex-1 px-2 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-1 ${
            active ? 'bg-[#ba0036] text-white shadow-sm' : 'text-gray-500 hover:text-gray-800 hover:bg-white/60'
          }`}
        >
          {label}
          {showMissedBadge && (
            <span className={`text-[8px] rounded-full min-w-[15px] h-[14px] px-1 inline-flex items-center justify-center ${
              active ? 'bg-white/25 text-white' : 'bg-red-100 text-red-700'
            }`}>{counts.missed}</span>
          )}
        </button>
      );
    })}
  </div>
);

// ─── Main ────────────────────────────────────────────────────────────────
const CallHistory = ({
  calls = [],
  onCallBack,
  onSelectCall,
  onDelete,
  isLoading = false,
  searchQuery = '',
}) => {
  const [filter, setFilter] = useState('all');

  const q = (searchQuery || '').trim().toLowerCase();
  const searched = useMemo(
    () => (q ? calls.filter(c => (c.peer?.name || '').toLowerCase().includes(q)) : calls),
    [calls, q],
  );

  const counts = useMemo(() => ({
    all: searched.length,
    missed: searched.filter(c => c.status === 'missed').length,
    incoming: searched.filter(c => c.direction === 'incoming').length,
    outgoing: searched.filter(c => c.direction === 'outgoing').length,
  }), [searched]);

  const filtered = useMemo(
    () => searched.filter(c => matchesFilter(c, filter)),
    [searched, filter],
  );

  const grouped = groupByDay(filtered);

  return (
    <div>
      <FilterTabs filter={filter} setFilter={setFilter} counts={counts} />

      {isLoading && calls.length === 0 ? (
        <div className="text-center text-xs font-bold text-gray-400 py-10 px-4">
          Loading call history…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center px-6 py-12">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-gray-100 to-gray-200 text-gray-400 flex items-center justify-center mx-auto mb-3">
            <Phone size={22}/>
          </div>
          <h4 className="text-sm font-black text-gray-700">
            {q
              ? `No calls matching "${searchQuery}"`
              : filter === 'all' ? 'No calls yet' : `No ${filter} calls`}
          </h4>
          <p className="text-[11px] font-bold text-gray-400 mt-1 leading-relaxed max-w-[240px] mx-auto">
            {q
              ? 'Try a different name.'
              : filter === 'all'
                ? 'Voice and video calls will appear here. Tap the phone icon on any chat to start one.'
                : 'Switch filters to see your other calls.'}
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          <AnimatePresence initial={false}>
            {grouped.map((g) =>
              g.kind === 'divider'
                ? <DayGroup key={g.id} label={g.label}/>
                : (
                  <motion.div
                    key={g.id}
                    layout
                    exit={{ opacity: 0, height: 0, marginTop: 0 }}
                    transition={{ duration: 0.18 }}
                  >
                    <SwipeableRow
                      call={g.call}
                      onCallBack={onCallBack}
                      onSelectCall={onSelectCall}
                      onDelete={onDelete}
                    />
                  </motion.div>
                )
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};

export default CallHistory;
