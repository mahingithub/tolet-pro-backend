/**
 * landlordVerificationService.js
 * ─────────────────────────────────────────────────────────────────────────
 * Thin wrapper around POST /api/auth/me/landlord-verification/submit.
 *
 * The backend decides Path A vs Path B based on the user's current
 * tenant-verification status — we just shove every field into a
 * multipart form and let the server figure out what's required.
 *
 *   Path A (Upgrading Tenant)     → backend reads utilityBill + propertyAddress.
 *   Path B (Fresh Landlord)       → backend ALSO consumes nidFront, nidBack,
 *                                   photo, professionProof.
 *
 * The Promise resolves with { user, path } so the caller can show a
 * "Path A: short form" vs "Path B: full form was processed" message.
 */

import { writeJson, broadcast } from './_storage.js';

const API_URL = import.meta.env.VITE_API_BASE_URL
  ? `${import.meta.env.VITE_API_BASE_URL.replace(/\/$/, '')}/auth`
  : 'http://localhost:5000/api/auth';

const KEY_USER  = 'auth:user';
const KEY_TOKEN = 'auth:token';

/**
 * @param {object} payload
 * @param {string} payload.propertyAddress    Required text.
 * @param {File}   payload.utilityBill        Required file.
 * @param {File}   [payload.nidFront]         Path B only.
 * @param {File}   [payload.nidBack]          Path B only.
 * @param {File}   [payload.photo]            Path B only.
 * @param {File}   [payload.professionProof]  Path B only.
 * @param {(pct:number)=>void} [onProgress]
 * @returns {Promise<{ user: object, path: 'A' | 'B' }>}
 */
export const submitLandlordVerification = (payload, { onProgress } = {}) =>
  new Promise((resolve, reject) => {
    const token = window.localStorage.getItem(KEY_TOKEN);
    if (!token) {
      const err = new Error('আপনি লগইন নন। আবার লগইন করুন।');
      err.code = 'unauthenticated';
      return reject(err);
    }
    if (!payload?.propertyAddress?.trim()) {
      return reject(Object.assign(new Error('Property address is required.'), { code: 'address_required' }));
    }
    if (!(payload.utilityBill instanceof Blob)) {
      return reject(Object.assign(new Error('Utility bill is required.'), { code: 'bill_required' }));
    }

    const form = new FormData();
    form.append('propertyAddress', payload.propertyAddress.trim());
    form.append('utilityBill',     payload.utilityBill);
    if (payload.nidFront instanceof Blob)        form.append('nidFront',        payload.nidFront);
    if (payload.nidBack  instanceof Blob)        form.append('nidBack',         payload.nidBack);
    if (payload.photo    instanceof Blob)        form.append('photo',           payload.photo);
    if (payload.professionProof instanceof Blob) form.append('professionProof', payload.professionProof);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/me/landlord-verification/submit`, true);
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
          // Write the fresh user back into AuthContext so the dashboard
          // sees the new pending status without a refresh.
          writeJson(KEY_USER, data.user);
          broadcast(KEY_USER);
        }
        if (typeof onProgress === 'function') onProgress(100);
        resolve({ user: data.user, path: data.path });
      } else {
        const err = new Error(data.message || `Upload failed (HTTP ${xhr.status}).`);
        err.code    = data.code;
        err.status  = xhr.status;
        err.missing = data.missing;   // server tells us which docs were absent
        err.path    = data.path;
        reject(err);
      }
    };
    xhr.onerror = () => {
      const err = new Error('নেটওয়ার্ক সমস্যা — পরে আবার চেষ্টা করুন।');
      err.code = 'network_error';
      reject(err);
    };
    xhr.send(form);
  });