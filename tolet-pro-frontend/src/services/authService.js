/**
 * authService.js
 * ──────────────────────────────────────────────────────────────────────────
 * Talks to the TO-LET PRO auth backend.
 *
 * Flow recap (Option A — Firebase Phone Auth + backend ID-token verify):
 *
 * Signup:
 * 1.  POST /signup/start  {name, phone, password, role}      → 202
 * 2.  client-side  signInWithPhoneNumber(...)                 → OTP via SMS
 * 3.  client-side  confirmationResult.confirm(otp)            → Firebase user
 * 4.  client-side  user.getIdToken()                          → idToken
 * 5.  POST /signup/verify {idToken}                           → { token, user }
 *
 * Login (no OTP):
 * 1.  POST /login {phone, password}                           → { token, user }
 *
 * Forgot password:
 * 1.  POST /forgot/start {phone}                              → 202 (always)
 * 2.  client-side Firebase phone OTP                          → idToken
 * 3.  POST /forgot/verify {idToken}                           → { resetToken }
 * 4.  POST /reset-password {resetToken, password}             → 200
 */

import { readJson, writeJson, removeKey, broadcast } from './_storage.js';

const API_URL = import.meta.env.VITE_API_BASE_URL
  ? `${import.meta.env.VITE_API_BASE_URL.replace(/\/$/, '')}/auth`
  : 'http://localhost:5000/api/auth';

const KEY_USER  = 'auth:user';
const KEY_TOKEN = 'auth:token';

const ADMIN_ROLES = ['support_agent', 'moderator', 'super_admin'];
export const isAdminRole = (role) => ADMIN_ROLES.includes(role);

export const getCurrentUser  = () => readJson(KEY_USER);
export const getCurrentToken = () => window.localStorage.getItem(KEY_TOKEN);

async function api(path, { method = 'POST', body, auth: useAuth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (useAuth) {
    const t = getCurrentToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
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

function persistSession({ token, user }) {
  window.localStorage.setItem(KEY_TOKEN, token);
  writeJson(KEY_USER, user);
  broadcast(KEY_USER);
}

function clearSession() {
  window.localStorage.removeItem(KEY_TOKEN);
  removeKey(KEY_USER);
  broadcast(KEY_USER);
}

// 🧹 Purge every per-user TenantDashboard cache slot + the legacy global
// key + the older `userName` / `userPhone` keys. Called on logout AND
// right before persisting a fresh signup session so account B can never
// inherit account A's cached profile data from the same browser. We
// scan all localStorage keys because we don't know the previous user
// id at this point.
function purgeTenantProfileCaches() {
  try {
    localStorage.removeItem('tolet_tenant_profile');
    localStorage.removeItem('userName');
    localStorage.removeItem('userPhone');
    const toDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('tolet_tenant_profile:')) toDelete.push(k);
    }
    toDelete.forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

// ─── Signup ─────────────────────────────────────────────────────────────────
export const signupStart  = ({ name, phone, password, role = 'tenant' }) =>
  api('/signup/start', { body: { name, phone, password, role } });

export const signupVerify = async ({ idToken }) => {
  const data = await api('/signup/verify', { body: { idToken } });
  // Purge any previous account's TenantDashboard cache BEFORE persisting
  // the new session, otherwise the freshly-mounted dashboard reads stale
  // fullName/phone from the prior user's storage slot.
  purgeTenantProfileCaches();
  persistSession(data);
  return data.user;
};

// ─── Login ──────────────────────────────────────────────────────────────────
export const loginWithPassword = async ({ phone, password }) => {
  const data = await api('/login', { body: { phone, password } });
  // Only purge previous tenant-profile localStorage if the user actually
  // CHANGED. Same-user re-login on the same browser must NOT wipe their
  // offline cache — that was eating the profile data every time the user
  // logged back in. Different user → purge so account B never inherits
  // account A's cached fullName/phone.
  const prev   = getCurrentUser();
  const prevId = prev?.id || prev?._id;
  const nextId = data.user?.id || data.user?._id;
  if (!prevId || String(prevId) !== String(nextId)) {
    purgeTenantProfileCaches();
  }
  persistSession(data);
  return data.user;
};

// ─── Forgot / Reset ─────────────────────────────────────────────────────────
export const forgotStart  = ({ phone })          => api('/forgot/start',   { body: { phone } });
export const forgotVerify = ({ idToken })        => api('/forgot/verify',  { body: { idToken } });
export const resetPassword = ({ resetToken, password }) =>
  api('/reset-password', { body: { resetToken, password } });

// ─── Session ───────────────────────────────────────────────────────────────
export const fetchMe = () => api('/me', { method: 'GET', auth: true }).then((d) => d.user);

export const logout = async () => {
  try { await api('/logout', { auth: true }); } catch { /* ignore */ }
  purgeTenantProfileCaches();
  clearSession();
  return { ok: true };
};

// ─── Profile mutations ──────────────────────────────────────────────────────
// Talks to the backend so the public landlord/tenant routes see the same
// data the dashboard is editing. The cached local user is refreshed
// from the server response — never from the optimistic patch object —
// so server-computed fields (trustScore, roles[]) stay authoritative.

export const updateMe = async (patch) => {
  // No token = no backend; fall back to the local-only behaviour so unit
  // tests + offline dev still work the way they used to.
  if (!getCurrentToken()) {
    const user = getCurrentUser();
    if (!user) return null;
    const updated = { ...user, ...patch };
    writeJson(KEY_USER, updated);
    broadcast(KEY_USER);
    return updated;
  }

  const data = await api('/me', { method: 'PATCH', body: patch, auth: true });
  writeJson(KEY_USER, data.user);
  broadcast(KEY_USER);
  return data.user;
};

// Idempotent — granting a role you already have is a no-op on the server.
export const addRole = async (role) => {
  const data = await api('/me/roles', { body: { role }, auth: true });
  writeJson(KEY_USER, data.user);
  broadcast(KEY_USER);
  return data.user;
};

// Switch the active UI role. Caller must already own `role`.
export const setActiveRole = async (role) => {
  const data = await api('/me/active-role', { body: { role }, auth: true });
  writeJson(KEY_USER, data.user);
  broadcast(KEY_USER);
  return data.user;
};

// Tenant verification submission — flips the verification block from
// 'unverified' → 'pending' and persists the doc booleans.
//   submitVerification({ photo: true, nidFront: true, nidBack: true,
//                        professionProof: false })
export const submitVerification = async (verification) => {
  const data = await api('/me/verification/submit', {
    body: { verification },
    auth: true,
  });
  writeJson(KEY_USER, data.user);
  broadcast(KEY_USER);
  return data.user;
};

// ─── Verification document upload ───────────────────────────────────────────
export const uploadVerificationDoc = (kind, file, { onProgress } = {}) => {
  return new Promise((resolve, reject) => {
    const token = getCurrentToken();
    if (!token) {
      const err = new Error('আপনি লগইন নন। আবার লগইন করুন।');
      err.code = 'unauthenticated';
      return reject(err);
    }
    if (!(file instanceof Blob)) {
      const err = new Error('Invalid file.');
      err.code = 'invalid_file';
      return reject(err);
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/me/verification/upload/${encodeURIComponent(kind)}`, true);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    if (xhr.upload && typeof onProgress === 'function') {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
        }
      };
    }

    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText || '{}'); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        if (data.user) {
          writeJson(KEY_USER, data.user);
          broadcast(KEY_USER);
        }
        if (typeof onProgress === 'function') onProgress(100);
        resolve(data);
      } else {
        const err = new Error(data.message || `Upload failed (HTTP ${xhr.status}).`);
        err.code   = data.code;
        err.status = xhr.status;
        reject(err);
      }
    };
    xhr.onerror = () => {
      const err = new Error('নেটওয়ার্ক সমস্যা — পরে আবার চেষ্টা করুন।');
      err.code = 'network_error';
      reject(err);
    };
    xhr.onabort = () => {
      const err = new Error('Upload cancelled.');
      err.code = 'upload_aborted';
      reject(err);
    };

    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
};

// ─── Avatar upload (Bug 1 Fix) ──────────────────────────────────────────────

// OPTION A — Dedicated avatar route (RECOMMENDED if backend has it)
export const uploadAvatar = (file, { onProgress } = {}) => {
  return new Promise((resolve, reject) => {
    const token = getCurrentToken();
    if (!token) {
      const err = new Error('আপনি লগইন নন। আবার লগইন করুন।');
      err.code = 'unauthenticated';
      return reject(err);
    }
    if (!(file instanceof Blob)) {
      const err = new Error('Invalid file.');
      err.code = 'invalid_file';
      return reject(err);
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/me/avatar`, true);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    if (xhr.upload && typeof onProgress === 'function') {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
        }
      };
    }

    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText || '{}'); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        if (data.user) {
          writeJson(KEY_USER, data.user);
          broadcast(KEY_USER);
        }
        if (typeof onProgress === 'function') onProgress(100);
        resolve(data.user || data);
      } else {
        const err = new Error(data.message || `Upload failed (HTTP ${xhr.status}).`);
        err.code   = data.code;
        err.status = xhr.status;
        reject(err);
      }
    };
    xhr.onerror = () => {
      const err = new Error('নেটওয়ার্ক সমস্যা — পরে আবার চেষ্টা করুন।');
      err.code = 'network_error';
      reject(err);
    };
    xhr.onabort = () => {
      const err = new Error('Upload cancelled.');
      err.code = 'upload_aborted';
      reject(err);
    };

    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
};

// OPTION B — Fallback via existing PATCH /me (if no /me/avatar route)
export const uploadAvatarFallback = (file, { onProgress } = {}) => {
  return new Promise((resolve, reject) => {
    if (!(file instanceof Blob)) {
      return reject(Object.assign(new Error('Invalid file.'), { code: 'invalid_file' }));
    }
    if (file.size > 5 * 1024 * 1024) {
      return reject(Object.assign(
        new Error('ফাইল অনেক বড় (সর্বোচ্চ ৫ MB)।'),
        { code: 'file_too_large' },
      ));
    }

    const reader = new FileReader();
    reader.onprogress = (e) => {
      if (e.lengthComputable && typeof onProgress === 'function') {
        onProgress(Math.min(50, Math.round((e.loaded / e.total) * 50)));
      }
    };
    reader.onload = async () => {
      try {
        if (typeof onProgress === 'function') onProgress(70);
        const user = await updateMe({ avatar: reader.result });
        if (typeof onProgress === 'function') onProgress(100);
        resolve(user);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(
      Object.assign(new Error('ফাইল পড়তে সমস্যা।'), { code: 'read_error' }),
    );
    reader.readAsDataURL(file);
  });
};


// ─── Backwards-compat shim ──────────────────────────────────────────────────
// AuthContext.jsx currently calls `login({ phone, password })`. Keep that API.
export const login = loginWithPassword;

export const loginAsDemoAdmin = async () => {
  throw new Error('ডেমো লগইন বন্ধ আছে।');
};