/**
 * privacyService.js
 * ──────────────────────────────────────────────────────────────────────────
 * User-facing data-control surface (the "Privacy Center").
 * Now connected to real backend endpoints.
 */

import { broadcast, subscribe } from './_storage.js';

const API = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api').replace(/\/$/, '');
const KEY_PREFS = 'privacy:preferences'; // kept for local broadcast triggers

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

// ─── EXPORT ───────────────────────────────────────────────────────────────

export const exportMyData = async () => {
  const data = await call('/users/me/export');
  // data.payload contains the JSON dump
  const blob = new Blob([JSON.stringify(data.payload, null, 2)], {
    type: 'application/json',
  });
  const downloadUrl = URL.createObjectURL(blob);
  const filename = `tolet-pro-data-${new Date().getTime()}.json`;
  return {
    downloadUrl,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    filename,
  };
};

// ─── DELETION ─────────────────────────────────────────────────────────────

export const getPendingDeletion = async () => {
  // If we needed to poll this on mount we could fetch from a /users/me endpoint,
  // but usually it's tied to the user profile which is hydrated via Auth context.
  // For now, we will return null unless managed locally, or we could fetch the user.
  const res = await call('/auth/me');
  return res.user?.pendingDeletion?.scheduledAt ? res.user.pendingDeletion : null;
};

export const requestAccountDeletion = async () => {
  const data = await call('/users/me/delete', { method: 'POST' });
  return data.pendingDeletion;
};

export const cancelAccountDeletion = async () => {
  const data = await call('/users/me/delete/cancel', { method: 'POST' });
  return data;
};

// ─── SESSIONS ─────────────────────────────────────────────────────────────

export const listMySessions = async () => {
  const data = await call('/users/me/sessions');
  return data.sessions;
};

export const revokeSession = async (sessionId) => {
  const data = await call(`/users/me/sessions/${sessionId}`, { method: 'DELETE' });
  return data;
};

export const revokeAllOtherSessions = async () => {
  const data = await call('/users/me/sessions', { method: 'DELETE' });
  return data;
};

// ─── PREFERENCES ──────────────────────────────────────────────────────────

export const getPreferences = async () => {
  const data = await call('/users/me/preferences');
  return data.preferences;
};

export const setPreferences = async (patch) => {
  const data = await call('/users/me/preferences', {
    method: 'PATCH',
    body: patch
  });
  broadcast(KEY_PREFS);
  return data.preferences;
};

export const onPreferencesChanged = (listener) => {
  return subscribe(KEY_PREFS, listener);
};
