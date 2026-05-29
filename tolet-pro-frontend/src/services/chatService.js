/**
 * chatService.js
 * ──────────────────────────────────────────────────────────────────────────
 * Frontend client for the polling-based chat backend at
 *   routes/chat.routes.js
 *
 *   GET    /api/conversations                       listConversations
 *   POST   /api/conversations/open                  openConversation (peerUserId, propertyId?)
 *   GET    /api/conversations/:id/messages?since    listMessages (delta poll)
 *   POST   /api/conversations/:id/messages          sendMessage
 *   POST   /api/conversations/:id/read              markRead
 *
 * Token comes from the shared `'auth:token'` key written by authService.
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
    err.details = data.details;
    err.status = res.status;
    throw err;
  }
  return data;
}

/** List all conversations for the logged-in user (sidebar). */
export const listConversations = async () => {
  const data = await call('/conversations');
  return Array.isArray(data.conversations) ? data.conversations : [];
};

/**
 * Open (or find) a 1:1 conversation with another user.
 * @param {object} args
 * @param {string} args.peerUserId
 * @param {string=} args.propertyId   Scopes the thread to a specific property.
 * @param {string=} args.inquiryId    Optional inquiry link.
 */
export const openConversation = async ({ peerUserId, propertyId, inquiryId }) => {
  const data = await call('/conversations/open', {
    method: 'POST',
    body: {
      peerUserId,
      ...(propertyId ? { propertyId } : {}),
      ...(inquiryId  ? { inquiryId  } : {}),
    },
  });
  return data.conversation;
};

/**
 * Fetch messages for a conversation. Pass `since` (ISO timestamp) for
 * delta polling so we don't refetch the whole thread every 5s.
 */
export const listMessages = async (conversationId, { since } = {}) => {
  const qs = since ? `?since=${encodeURIComponent(since)}` : '';
  const data = await call(`/conversations/${conversationId}/messages${qs}`);
  return Array.isArray(data.messages) ? data.messages : [];
};

/** Send a message to a conversation. */
export const sendMessage = async (conversationId, text) => {
  const data = await call(`/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: { text },
  });
  return data.message;
};

/** Mark all messages in this conversation as read by the current user. */
export const markRead = async (conversationId) => {
  return call(`/conversations/${conversationId}/read`, { method: 'POST' });
};

export default {
  listConversations,
  openConversation,
  listMessages,
  sendMessage,
  markRead,
};
