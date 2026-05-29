/**
 * notificationService.js
 * ──────────────────────────────────────────────────────────────────────────
 *   GET    /api/notifications?unread=true&limit=50    list (with unread count)
 *   GET    /api/notifications/unread-count            unreadCount only (cheap)
 *   POST   /api/notifications/:id/read                markRead
 *   POST   /api/notifications/read-all                markAllRead
 *
 * The bell in the Navbar polls /unread-count every 15s; the dropdown
 * panel triggers /notifications when opened.
 */

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
    const err = new Error(data.message || 'অনুরোধে সমস্যা হয়েছে।');
    err.code = data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

export const listNotifications = async ({ unreadOnly = false, limit = 50 } = {}) => {
  const qs = `?unread=${unreadOnly ? 'true' : 'false'}&limit=${limit}`;
  const data = await call(`/notifications${qs}`);
  return {
    items: Array.isArray(data.notifications) ? data.notifications : [],
    unread: Number(data.unread) || 0,
  };
};

export const getUnreadCount = async () => {
  const data = await call('/notifications/unread-count');
  return Number(data.unread) || 0;
};

export const markRead = async (id) => {
  const data = await call(`/notifications/${id}/read`, { method: 'POST' });
  return data.notification;
};

export const markAllRead = async () => {
  return call('/notifications/read-all', { method: 'POST' });
};

export default {
  listNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
};
