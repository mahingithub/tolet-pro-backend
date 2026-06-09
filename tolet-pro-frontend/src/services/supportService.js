/**
 * supportService.js
 * ──────────────────────────────────────────────────────────────────────────
 * Support tickets + AI-to-human handoff, backed by real REST endpoints.
 * Includes a short-polling loop for near real-time updates.
 */

import { getCurrentUser } from './authService.js';

const API = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api').replace(/\/$/, '');

const getToken = () => window.localStorage.getItem('auth:token');

function authHeaders() {
  const t = getToken();
  return {
    'Content-Type': 'application/json',
    ...(t ? { Authorization: `Bearer ${t}` } : {}),
  };
}

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) {
    const err = new Error(data.message || 'Request failed');
    err.code = data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

// ─── POLLING SYSTEM ────────────────────────────────────────────────────────

const listeners = new Set();
let pollInterval = null;

function broadcast() {
  for (const listener of listeners) {
    try { listener(); } catch (err) { console.error('Listener error', err); }
  }
}

function startPolling() {
  if (pollInterval) return;
  pollInterval = setInterval(() => {
    // Only broadcast if there are listeners (e.g. a component is mounted)
    if (listeners.size > 0 && getToken()) {
      broadcast();
    }
  }, 5000); // 5 seconds
}

export const onTicketsChanged = (listener) => {
  listeners.add(listener);
  startPolling();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  };
};

// ─── USER-SIDE API ────────────────────────────────────────────────────────

export const openTicket = async ({ initialMessage, aiTranscript }) => {
  const data = await call('/support/tickets', {
    method: 'POST',
    body: { initialMessage, aiTranscript }
  });
  broadcast();
  return data.ticket;
};

export const listMyTickets = async () => {
  if (!getToken()) return [];
  const data = await call('/support/tickets');
  return data.tickets;
};

export const getTicket = async (id) => {
  try {
    const data = await call(`/support/tickets/${id}`);
    return data; // { ticket, messages }
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
};

export const sendMessage = async (ticketId, text) => {
  const data = await call(`/support/tickets/${ticketId}/messages`, {
    method: 'POST',
    body: { text }
  });
  broadcast();
  return data.message;
};

export const closeTicket = async (ticketId) => {
  const data = await call(`/support/tickets/${ticketId}/close`, { method: 'POST' });
  broadcast();
  return data;
};

// ─── ADMIN-SIDE API ───────────────────────────────────────────────────────

export const listAllTickets = async (filters = {}) => {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.search) params.set('search', filters.search);
  const qs = params.toString() ? `?${params.toString()}` : '';
  
  const data = await call(`/admin/support/tickets${qs}`);
  return data.tickets;
};

export const getTicketWithContext = async (id) => {
  try {
    const data = await call(`/admin/support/tickets/${id}`);
    return data; // { ticket, messages, userContext }
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
};

export const sendAdminMessage = async (ticketId, text, opts = {}) => {
  const data = await call(`/admin/support/tickets/${ticketId}/messages`, {
    method: 'POST',
    body: { text, markPendingUser: !!opts.markPendingUser }
  });
  broadcast();
  return data.message;
};

export const assignTicket = async (ticketId, assignee) => {
  const data = await call(`/admin/support/tickets/${ticketId}/assign`, {
    method: 'POST',
    body: { adminId: assignee.adminId, adminName: assignee.adminName }
  });
  broadcast();
  return data;
};

export const resolveTicket = async (ticketId, summary) => {
  const data = await call(`/admin/support/tickets/${ticketId}/resolve`, {
    method: 'POST',
    body: { summary }
  });
  broadcast();
  return data;
};

export const reopenTicket = async (ticketId) => {
  const data = await call(`/admin/support/tickets/${ticketId}/reopen`, { method: 'POST' });
  broadcast();
  return data;
};
