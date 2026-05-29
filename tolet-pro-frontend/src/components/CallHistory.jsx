// CallHistory.jsx
//
// The "Calls" tab of the Messages surface — a Messenger / WhatsApp-style
// list of every call the user has made or received. Renders nothing on
// its own outside the sidebar; it's mounted by ChatSystem when the user
// flips the sidebar tab from Messages → Calls.

import React from 'react';
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

const CallHistoryRow = ({ call, onCallBack }) => {
  const { Icon, color, label } = statusVisuals(call);
  const initials = (call.peer?.name || '?')
    .split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();
  const isCompleted = call.status === 'completed';
  const isMissedOrDeclined = call.status === 'missed' || call.status === 'declined' || call.status === 'no-answer';
  const TypeIcon = call.type === 'video' ? Video : Phone;

  return (
    <div className="group w-full text-left p-3 sm:p-4 rounded-2xl flex items-center gap-3 border border-transparent hover:bg-white/70 transition-all">
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

      {/* Tap-to-call-back icon */}
      <button
        onClick={() => onCallBack?.(call)}
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

const CallHistory = ({ calls = [], onCallBack, isLoading = false, searchQuery = '' }) => {
  const q = (searchQuery || '').trim().toLowerCase();
  const filtered = q
    ? calls.filter(c => (c.peer?.name || '').toLowerCase().includes(q))
    : calls;

  const grouped = groupByDay(filtered);

  if (isLoading && calls.length === 0) {
    return (
      <div className="text-center text-xs font-bold text-gray-400 py-10 px-4">
        Loading call history…
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="text-center px-6 py-12">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-gray-100 to-gray-200 text-gray-400 flex items-center justify-center mx-auto mb-3">
          <Phone size={22}/>
        </div>
        <h4 className="text-sm font-black text-gray-700">
          {q ? `No calls matching "${searchQuery}"` : 'No calls yet'}
        </h4>
        <p className="text-[11px] font-bold text-gray-400 mt-1 leading-relaxed max-w-[240px] mx-auto">
          {q
            ? 'Try a different name.'
            : 'Voice and video calls will appear here. Tap the phone icon on any chat to start one.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {grouped.map((g) =>
        g.kind === 'divider'
          ? <DayGroup key={g.id} label={g.label}/>
          : <CallHistoryRow key={g.id} call={g.call} onCallBack={onCallBack}/>
      )}
    </div>
  );
};

export default CallHistory;