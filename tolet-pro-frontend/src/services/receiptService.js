/**
 * receiptService.js — HTTP client for the /api/receipts endpoints.
 * ──────────────────────────────────────────────────────────────────────────
 * Replaces the localStorage-only receipt reading in TenantDashboard.jsx
 * and ChatSystem.jsx with real backend persistence.
 */

import { getCurrentToken } from './authService';

const BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000').replace(/\/+$/, '').replace(/\/api$/, '');
async function request(path, options = {}) {
  const token = getCurrentToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** Fetch all receipts for the logged-in tenant. */
export async function listTenantReceipts() {
  const { receipts } = await request('/api/receipts/tenant');
  return receipts || [];
}

/** Fetch all receipts issued by the logged-in landlord. */
export async function listHostReceipts() {
  const { receipts } = await request('/api/receipts/host');
  return receipts || [];
}

/** Mark a receipt as read by the tenant. */
export async function markReceiptRead(receiptId) {
  return request(`/api/receipts/${receiptId}/read`, { method: 'PATCH' });
}
