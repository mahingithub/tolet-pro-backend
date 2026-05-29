/**
 * adminService.js
 * ─────────────────────────────────────────────────────────────────────────
 * Real-backend admin client. Replaces the previous mock that returned
 * hard-coded ৳1.2M / 2,845 users so the admin UI now reflects what's
 * actually in the database.
 *
 * Every call hits /api/admin/* — all protected by requireAuth +
 * requireAdmin server-side, so a 403 here means the logged-in user
 * isn't really an admin (someone tampered with localStorage).
 */

const API = (
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api'
).replace(/\/$/, '');

const KEY_TOKEN = 'auth:token';
const getToken  = () => window.localStorage.getItem(KEY_TOKEN);

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(`${API}/admin${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) {
    const err = new Error(data.message || `Request failed (HTTP ${res.status}).`);
    err.code   = data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

// ─── Dashboard ──────────────────────────────────────────────────────────────
export const getOverviewStats = async () => {
  const data = await api('/overview');
  return data.stats || {};
};

// ─── Users + KYC ────────────────────────────────────────────────────────────
// Returns { users, total, page, limit }. Pass `filter` as a shallow object
// of query params; only non-empty values are forwarded.
export const listUsers = async (filter = {}) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filter)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      qs.set(k, String(v));
    }
  }
  const path = qs.toString() ? `/users?${qs.toString()}` : '/users';
  return api(path);
};

export const listPendingVerification = async () => {
  const data = await api('/users/pending-verification');
  return data.users || [];
};

export const listPendingLandlordVerification = async () => {
  const data = await api('/users/pending-landlord-verification');
  return data.users || [];
};

export const verifyUser = async (userId) =>
  (await api(`/users/${encodeURIComponent(userId)}/verify`, { method: 'POST' })).user;

export const verifyLandlord = async (userId) =>
  (await api(`/users/${encodeURIComponent(userId)}/verify-landlord`, { method: 'POST' })).user;

export const rejectUser = async (userId, reason) =>
  (await api(`/users/${encodeURIComponent(userId)}/reject`, {
    method: 'POST',
    body: { reason },
  })).user;

export const rejectLandlord = async (userId, reason) =>
  (await api(`/users/${encodeURIComponent(userId)}/reject-landlord`, {
    method: 'POST',
    body: { reason },
  })).user;

export const banUser = async (userId, reason) =>
  (await api(`/users/${encodeURIComponent(userId)}/ban`, {
    method: 'POST',
    body: { reason },
  })).user;

export const unbanUser = async (userId) =>
  (await api(`/users/${encodeURIComponent(userId)}/unban`, { method: 'POST' })).user;

// ─── Properties (moderation) ────────────────────────────────────────────────
export const listAdminProperties = async (filter = {}) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filter)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      qs.set(k, String(v));
    }
  }
  const path = qs.toString() ? `/properties?${qs.toString()}` : '/properties';
  return api(path);
};

export const moderateProperty = async (propertyId, action, reason = '') =>
  (await api(`/properties/${encodeURIComponent(propertyId)}/moderate`, {
    method: 'POST',
    body: { action, reason },
  })).property;

// ─── Audit Log ───────────────────────────────────────────────────────────────
export const logAuditAction = async (action, details = {}) => {
  try {
    return await api('/audit-log', { method: 'POST', body: { action, ...details } });
  } catch {
    return null;
  }
};