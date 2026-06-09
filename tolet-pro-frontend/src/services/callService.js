/**
 * callService.js
 * ──────────────────────────────────────────────────────────────────────────
 * REST client for the Call resource. Reads call history and active-call
 * state from /api/calls. The actual signaling (CALL_RINGING, OFFER, ANSWER,
 * ICE_CANDIDATE) lives on Socket.IO via callProvider.js — this file is
 * purely the persisted history surface that drives the Calls tab and the
 * inline "Missed call · 2:34" cards inside chat threads.
 */

import { getCurrentToken } from './authService';

const API_BASE = import.meta.env.VITE_API_BASE_URL
  ? `${import.meta.env.VITE_API_BASE_URL.replace(/\/$/, '')}/calls`
  : 'http://localhost:5000/api/calls';

async function api(path = '', { method = 'GET', body } = {}) {
  const token = getCurrentToken();
  if (!token) {
    const err = new Error('Not authenticated');
    err.code = 'unauthenticated';
    throw err;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) {
    const err = new Error(data.message || `Request failed (${res.status})`);
    err.code = data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * List the current user's call history. Returns up to `limit` recent calls,
 * sorted newest first. Each call is populated with caller + receiver
 * (name, profilePicture) so the UI can render rows without extra round-trips.
 */
export async function listCallHistory({ limit = 50 } = {}) {
  const { calls } = await api(`/history?limit=${encodeURIComponent(limit)}`);
  return Array.isArray(calls) ? calls : [];
}

/**
 * Get a specific call by id (with populated peer details). Used by the
 * call detail modal and on reconnection to recover an active-call's roomId.
 */
export async function getCall(callId) {
  if (!callId) throw new Error('callId required');
  const { call } = await api(`/${encodeURIComponent(callId)}`);
  return call;
}

/**
 * The user's currently-active call (ringing / accepted), if any. Used by
 * the app on boot to resume a call that was in progress when the socket
 * dropped or the page reloaded.
 */
export async function getActiveCall() {
  const { call } = await api('/active');
  return call || null;
}

/**
 * Helper: figure out a normalised "shape" of a call from the current
 * user's perspective. Returns { direction, status, peer, durationSec, iso }.
 * direction → 'incoming' | 'outgoing'
 * status    → 'missed' | 'declined' | 'completed' | 'no-answer' | 'in-progress'
 */
export function describeCall(call, currentUserId) {
  if (!call) return null;
  const me = String(currentUserId);
  const callerId = String(call.callerId?._id || call.callerId);
  const isOutgoing = callerId === me;
  const peer = isOutgoing ? call.receiverId : call.callerId;

  let status = call.status;
  // Normalise from caller vs receiver perspective:
  //   - For the CALLER, a 'missed' status means "they didn't pick up" → 'no-answer'
  //   - For the CALLEE, a 'missed' status means "I missed it" → 'missed'
  if (call.status === 'missed') {
    status = isOutgoing ? 'no-answer' : 'missed';
  } else if (call.status === 'rejected') {
    status = 'declined';
  } else if (call.status === 'ended') {
    status = 'completed';
  } else if (call.status === 'accepted' || call.status === 'ringing') {
    status = 'in-progress';
  }

  return {
    id: String(call._id || call.id),
    direction: isOutgoing ? 'outgoing' : 'incoming',
    status,
    type: call.type, // 'voice' | 'video'
    peer: peer && typeof peer === 'object' ? {
      id: String(peer._id || peer.id),
      name: peer.name || 'User',
      profilePicture: peer.profilePicture || null,
      phone: peer.phone || null,
      role: peer.role || null, // 'landlord' | 'tenant' | null — used for "View Profile"
    } : null,
    durationSec: Number(call.duration) || 0,
    iso: call.startedAt || call.createdAt || call.updatedAt,
    createdAt: call.createdAt,
    startedAt: call.startedAt || null,
    endedAt: call.endedAt || null,
    roomId: call.roomId,
    // Phase Call-4: have *I* seen this call? (drives the missed badge.)
    seen: Array.isArray(call.seenBy)
      ? call.seenBy.map((x) => String(x?._id || x)).includes(me)
      : false,
    raw: call,
  };
}

/**
 * Format a duration (seconds) into "M:SS" or "H:MM:SS" for the UI.
 */
export function formatCallDuration(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

/**
 * Mark all the current user's missed calls as seen. Clears the missed badge.
 * (Phase Call-4) Returns { updated }.
 */
export async function markSeen() {
  return api('/mark-seen', { method: 'POST' });
}

/**
 * Soft-delete a call from the current user's history (per-user; the other
 * participant keeps it). (Phase Call-4) Returns { deleted, id }.
 */
export async function deleteCall(callId) {
  if (!callId) throw new Error('callId required');
  return api(`/${encodeURIComponent(callId)}`, { method: 'DELETE' });
}

const callService = {
  listCallHistory,
  getCall,
  getActiveCall,
  describeCall,
  formatCallDuration,
  markSeen,
  deleteCall,
};

export default callService;