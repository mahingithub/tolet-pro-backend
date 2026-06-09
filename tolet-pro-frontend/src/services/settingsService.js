'use strict';

/**
 * settingsService.js — syncs user preferences between the frontend
 * SharedSettings UI and the backend User.preferences model.
 *
 * Backend endpoints (already exist):
 *   GET   /api/users/me/preferences  → { preferences }
 *   PATCH /api/users/me/preferences  → { preferences }
 *
 * Falls back to localStorage when the user is unauthenticated or offline.
 */

import { getCurrentToken } from './authService';

const API_BASE = import.meta.env.VITE_API_BASE_URL
  ? `${import.meta.env.VITE_API_BASE_URL.replace(/\/$/, '')}/users/me`
  : 'http://localhost:5000/api/users/me';

async function apiFetch(path, { method = 'GET', body } = {}) {
  const token = getCurrentToken();
  if (!token) return null; // unauthenticated — caller should fallback

  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    console.warn(`[settingsService] ${method} ${path} → ${res.status}`);
    return null;
  }
  return res.json();
}

/**
 * Fetch the user's preferences from the backend.
 * @returns {Promise<Object|null>} { preferences } or null on failure
 */
export async function getPreferences() {
  return apiFetch('/preferences');
}

/**
 * Patch (merge) preferences on the backend.
 * Only sends the fields that changed.
 * @param {Object} patch - partial preferences object
 * @returns {Promise<Object|null>} { preferences } or null on failure
 */
export async function setPreferences(patch) {
  return apiFetch('/preferences', { method: 'PATCH', body: patch });
}
