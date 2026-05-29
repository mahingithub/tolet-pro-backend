/**
 * inquiryService.js
 * ──────────────────────────────────────────────────────────────────────────
 * Frontend client for the inquiry endpoints exposed by the backend at
 * routes/inquiry.routes.js + routes/host.routes.js.
 *
 *   POST   /api/inquiries                         createInquiry (auth)
 *   GET    /api/inquiries/mine                    listMyInquiries (auth, tenant)
 *   PATCH  /api/inquiries/:id/status              updateInquiryStatus (auth, host)
 *   GET    /api/host/inquiries                    listHostInquiries (auth, host)
 *
 * Token comes from authService's `'auth:token'` key. We deliberately read
 * the same key as authService so a single login covers every service in the
 * app — no per-service token namespacing.
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

// ─── Tenant side ────────────────────────────────────────────────────────────

/**
 * Send a new inquiry to the host of a property.
 * @param {object} args
 * @param {string} args.propertyId   - Mongo ObjectId of the property
 * @param {string} args.message      - Free-text message (1..2000 chars)
 * @param {string=} args.leaseStart  - Optional ISO date "YYYY-MM-DD"
 * @param {string=} args.leaseEnd    - Optional ISO date "YYYY-MM-DD"
 */
export const createInquiry = async ({ propertyId, message, leaseStart, leaseEnd }) => {
  const data = await call('/inquiries', {
    method: 'POST',
    body: {
      propertyId,
      message,
      ...(leaseStart ? { leaseStart } : {}),
      ...(leaseEnd   ? { leaseEnd   } : {}),
    },
  });
  return data.inquiry;
};

/** Tenant's own outgoing inquiries. */
export const listMyInquiries = async () => {
  const data = await call('/inquiries/mine');
  return Array.isArray(data.inquiries) ? data.inquiries : [];
};

// ─── Host side ──────────────────────────────────────────────────────────────

/** Host's incoming inquiries (every property they own). */
export const listHostInquiries = async ({ status } = {}) => {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const data = await call(`/host/inquiries${qs}`);
  return Array.isArray(data.inquiries) ? data.inquiries : [];
};

/** Move an inquiry through its lifecycle. Status enum must match the model:
 *  'new' | 'active' | 'archived' | 'converted' | 'rejected'. */
export const updateInquiryStatus = async (id, status) => {
  const data = await call(`/inquiries/${id}/status`, {
    method: 'PATCH',
    body: { status },
  });
  return data.inquiry;
};

export default {
  createInquiry,
  listMyInquiries,
  listHostInquiries,
  updateInquiryStatus,
};
