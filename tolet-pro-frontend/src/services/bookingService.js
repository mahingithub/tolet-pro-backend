/**
 * bookingService.js — HTTP client for the /api/bookings endpoints.
 * ──────────────────────────────────────────────────────────────────────────
 * Follows the same pattern as inquiryService.js / chatService.js:
 *   • Uses getCurrentToken() for Bearer auth
 *   • Falls back to import.meta.env.VITE_API_BASE_URL or localhost:5000
 *   • Named exports (not a class)
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
    err.code = body.code;
    throw err;
  }
  return res.json();
}

// ── Booking CRUD ────────────────────────────────────────────────────────────

/** Create a new booking (landlord converts an inquiry to a lease). */
export async function createBooking(data) {
  const { booking } = await request('/api/bookings', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return booking;
}

/** List all bookings for the logged-in landlord. */
export async function listHostBookings() {
  const { bookings } = await request('/api/bookings/host');
  return bookings || [];
}

/** List all bookings for the logged-in tenant. */
export async function listTenantBookings() {
  const { bookings } = await request('/api/bookings/tenant');
  return bookings || [];
}

/** Mark a month as paid/partial/due in a booking's rent ledger. */
export async function updateLedger(bookingId, monthKey, data) {
  const { booking } = await request(`/api/bookings/${bookingId}/ledger/${monthKey}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
  return booking;
}

/** Undo a payment record (delete ledger entry + receipt). */
export async function undoLedger(bookingId, monthKey) {
  const { booking } = await request(`/api/bookings/${bookingId}/ledger/${monthKey}`, {
    method: 'DELETE',
  });
  return booking;
}

/** Update booking settings (autoReminder, rentDueDay, etc.). */
export async function updateBookingSettings(bookingId, data) {
  const { booking } = await request(`/api/bookings/${bookingId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
  return booking;
}
