/**
 * ─── PROPERTY SERVICE ─────────────────────────────────────────────────────────
 *
 * ✅ Backend এর সাথে connected।
 * Backend না চললে localStorage থেকে কাজ করবে (fallback)।
 *
 * Backend URL: http://localhost:5000/api  (পরিবর্তন করতে .env এ লিখুন)
 *   VITE_API_BASE_URL=http://localhost:5000/api
 *
 * NOTE: This service intentionally contains ZERO demo properties / landlords.
 * Listings only ever come from (a) the API or (b) what real hosts have
 * uploaded through the Add Property wizard. Empty arrays / null are the
 * source of truth when no host has uploaded anything yet.
 */

import {
  broadcast, subscribe as subscribeKey,
} from './_storage.js';
import { getCurrentUser } from './authService.js';

// ─── API CONFIG ───────────────────────────────────────────────────────────────
const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';
const HOST_PROPERTIES_TIMEOUT_MS = 45000;

// Token key must match the one written by authService.loginWithPassword /
// signupVerify. Earlier this read `'tolet_token'`, which was never written
// anywhere — so every authenticated property request fell back to anonymous
// and silently wrote listings to localStorage instead of the API. The
// canonical key is `'auth:token'`.
const getToken = () => localStorage.getItem('auth:token');

const apiHeaders = () => ({
  'Content-Type': 'application/json',
  ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
});

// localStorage key
const KEY_USER_PROPERTIES = 'properties:user';

// ─── API ROUTE PROBE ──────────────────────────────────────────────────────────
// We used to persist availability flags to sessionStorage so a missing route
// wasn't re-probed within a tab session. That was actively harmful in
// production: a single transient blip (backend restart, slow network, browser
// ad-blocker) would flip a flag to false for the entire session, and the user
// would silently fall back to localStorage forever — uploaded properties would
// vanish from Explore, freshly created listings would never round-trip, etc.
//
// Two safer rules now:
//   1. Availability is IN-MEMORY ONLY. Page reload clears it.
//   2. Only a hard 404 (route truly missing) flips a flag off. Network or
//      timeout errors fall through to localStorage for THAT call only — the
//      next call retries the API. This way a 2-second backend hiccup doesn't
//      poison the rest of the session.
const apiAvailability = {
  properties:     true,
  propertyById:   true,
  createProperty: true,
  hostProperties: true,
  updateProperty: true,
  deleteProperty: true,
};

const inFlight = new Map();   // url → Promise<Response|null>

function probeFetch(key, url, init = {}) {
  if (!apiAvailability[key]) return Promise.resolve(null);

  // When the same URL is requested concurrently (e.g. HostDashboard
  // hydrating on mount AND on a storage broadcast at the same time), we
  // MUST hand each caller a fresh Response clone. Returning the same
  // Response twice means the first caller's `.json()` consumes the body
  // stream and the second caller throws "body stream already read".
  if (inFlight.has(url)) {
    return inFlight.get(url).then((r) => (r ? r.clone() : null));
  }

  const p = (async () => {
    try {
      const res = await fetch(url, init);
      if (res.status === 404) {
        apiAvailability[key] = false;
        return null;
      }
      return res;
    } catch {
      // Network / timeout / abort — let THIS call fall through to
      // localStorage but don't sticky-flag the route. The next call will
      // try the API again.
      return null;
    } finally {
      inFlight.delete(url);
    }
  })();

  inFlight.set(url, p);
  // Always hand back a clone — never the original — so the cached
  // Response stays unconsumed and future concurrent callers can clone too.
  return p.then((r) => (r ? r.clone() : null));
}

// ─── BACK-COMPAT EXPORTS ──────────────────────────────────────────────────────
// Older imports (e.g. mobile components) reference these names — keep them
// exported so nothing crashes, but they're permanently empty now. Do NOT
// re-seed demo data here.
export const DEMO_PROPERTIES = [];
export const DEMO_LANDLORDS  = {};

export const RENTAL_CATEGORIES = [
  { id: "family",          label: "Family Flat",       shortLabel: "Family"   },
  { id: "bachelor_male",   label: "Bachelor (Male)",   shortLabel: "Bach. (M)"},
  { id: "bachelor_female", label: "Bachelor (Female)", shortLabel: "Bach. (F)"},
  { id: "sublet",          label: "Sublet / Room",     shortLabel: "Sublet"   },
  { id: "student",         label: "Student",           shortLabel: "Student"  },
];

// User-approved relabel — the rental category previously called
// "Apartment" is now "Flat" everywhere visible (filters, badges, search
// suggestions). The wire id `apartment` is preserved for back-compat
// with existing listings on the API + localStorage so nothing has to
// be migrated.
export const PROPERTY_TYPES = [
  { id: "apartment",   label: "Flat"              },
  { id: "independent", label: "Independent House" },
  { id: "duplex",      label: "Duplex"            },
  { id: "studio",      label: "Studio"            },
  { id: "penthouse",   label: "Penthouse"         },
];

export const VALID_DIVISIONS = [
  "dhaka","chittagong","sylhet","rajshahi",
  "khulna","barishal","rangpur","mymensingh",
];

// ─── FILTER HELPER ────────────────────────────────────────────────────────────
// Builds a single haystack string from every location-ish field on a property
// so a search like "Dhanmondi" matches whether the host typed it into the
// address line, picked it from the area dropdown, or it lives in the GPS
// address. Without this, properties picked from cascading dropdowns but
// without "Dhanmondi" in the free-text address never show up in search.
export function propertyLocationHaystack(prop) {
  return [
    prop.location,
    prop.area,
    prop.district,
    prop.division,
    prop.gpsAddress,
    prop.gps?.address,
    prop.title,
  ].filter(Boolean).join(' ').toLowerCase();
}

export function applyFilters(properties, filters) {
  const {
    activeDivision  = "all",
    searchArea      = "",
    nearMeLabel     = "Nearby Location",
    intent          = "",
    minPrice        = 0,
    maxPrice        = 300000,
    selectedTypes   = [],
    selectedCategories = [],
    selectedBeds    = "any",
    maxSqft         = 4000,
    selectedFurnish = "",
    minRating       = 0,
  } = filters;

  const needle = (searchArea || '').trim().toLowerCase();
  return properties.filter(prop => {
    if (activeDivision !== "all" && prop.division !== activeDivision) return false;
    if (needle && needle !== (nearMeLabel || '').toLowerCase() &&
        !propertyLocationHaystack(prop).includes(needle)) return false;
    if (intent && prop.intent !== intent) return false;
    if (prop.price < minPrice || prop.price > maxPrice) return false;
    if (selectedTypes.length > 0 && !selectedTypes.includes(prop.type)) return false;
    if (selectedCategories.length > 0 && !selectedCategories.includes(prop.rentalCategory)) return false;
    if (selectedBeds !== "any") {
      if (selectedBeds === "4+" && prop.beds < 4) return false;
      if (selectedBeds !== "4+" && prop.beds !== Number(selectedBeds)) return false;
    }
    if ((prop.sqft || 0) > maxSqft) return false;
    if (selectedFurnish && prop.furnishing !== selectedFurnish) return false;
    if (minRating > 0 && (prop.rating || 0) < minRating) return false;
    return true;
  });
}

// ─── INTERNAL HELPERS ─────────────────────────────────────────────────────────

// ─── CLOUDINARY DIRECT UPLOAD ───────────────────────────────────────────────
// Property media (cover photo, room photos, walkthrough video) is uploaded
// straight from the browser to Cloudinary using an UNSIGNED upload preset, and
// only the resulting https URL is sent to our API. This keeps base64 blobs OUT
// of the request body (which was causing POST 400s) and OUT of MongoDB / the
// Render backend (which was causing listing 500 OOMs). Large videos never
// touch our server at all.
//
// Requires two Vite env vars (set on Vercel, then REDEPLOY — Vite inlines env
// at build time):
//   VITE_CLOUDINARY_CLOUD_NAME    — your Cloudinary cloud name
//   VITE_CLOUDINARY_UPLOAD_PRESET — an UNSIGNED upload preset name
const CLOUDINARY_CLOUD  = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || '';
const CLOUDINARY_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || '';

const isHttpUrl = (s) => /^https?:\/\//i.test(String(s || '').trim());

/**
 * Upload one asset to Cloudinary and return its secure https URL.
 *  - `asset` may be a File/Blob (preferred) OR a base64 `data:` URL string.
 *  - If `asset` is ALREADY an https URL (e.g. editing a listing whose media was
 *    uploaded earlier), it is returned unchanged — no wasteful re-upload.
 *  - `resourceType` is 'image' or 'video'.
 */
async function uploadToCloudinary(asset, resourceType = 'image') {
  if (isHttpUrl(asset)) return String(asset).trim(); // already hosted
  if (!asset) return '';
  if (!CLOUDINARY_CLOUD || !CLOUDINARY_PRESET) {
    throw new Error(
      'Cloudinary is not configured. Set VITE_CLOUDINARY_CLOUD_NAME and ' +
      'VITE_CLOUDINARY_UPLOAD_PRESET in the frontend environment, then redeploy.'
    );
  }

  const fd = new FormData();
  fd.append('file', asset);                 // Cloudinary accepts a File/Blob OR a data: URI
  fd.append('upload_preset', CLOUDINARY_PRESET);

  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/${resourceType}/upload`;
  let res;
  try {
    res = await fetch(endpoint, { method: 'POST', body: fd });
  } catch {
    throw new Error('Could not reach Cloudinary. Check your connection and try again.');
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch { /* ignore */ }
    throw new Error(`Media upload failed (${res.status})${detail ? `: ${detail}` : ''}.`);
  }
  const data = await res.json();
  const url = data.secure_url || data.url || '';
  if (!url) throw new Error('Media upload returned no URL.');
  return url;
}

function toCloudinaryListingImage(url) {
  const source = String(url || '').trim();
  if (!/^https?:\/\/res\.cloudinary\.com\//i.test(source)) return source;
  const marker = '/image/upload/';
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) return source;
  const after = source.slice(markerIndex + marker.length);
  const firstSegment = after.split('/')[0] || '';
  if (/^(?:a_|ar_|b_|c_|co_|dpr_|e_|f_|fl_|g_|h_|l_|o_|q_|r_|t_|w_|x_|y_|z_)/.test(firstSegment)) {
    return source;
  }
  return `${source.slice(0, markerIndex + marker.length)}f_auto,q_auto:eco,w_640,c_fill/${after}`;
}

function makeDataUrlThumbnail(url, { maxWidth = 720, maxHeight = 540, quality = 0.72, maxBytes = 950000 } = {}) {
  const source = String(url || '');
  if (!/^data:image\//i.test(source) || typeof document === 'undefined' || typeof Image === 'undefined') {
    return Promise.resolve(source);
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const ratio = Math.min(1, maxWidth / img.naturalWidth, maxHeight / img.naturalHeight);
        const width = Math.max(1, Math.round(img.naturalWidth * ratio));
        const height = Math.max(1, Math.round(img.naturalHeight * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(source);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const thumb = canvas.toDataURL('image/jpeg', quality);
        resolve(thumb && thumb.length < source.length && thumb.length <= maxBytes ? thumb : source);
      } catch {
        resolve(source);
      }
    };
    img.onerror = () => resolve(source);
    img.src = source;
  });
}

async function makeListingThumbnail(url) {
  const cloudinary = toCloudinaryListingImage(url);
  if (cloudinary !== String(url || '').trim()) return cloudinary;
  return makeDataUrlThumbnail(url);
}

// Build the canonical `[{ room, url, thumbUrl }]` representation that
// PropertyDetails groups by and PropertyListing builds its collage from. Source
// of truth is the room-tagged uploads in the wizard; thumbnails are only for
// listing cards, while detail pages keep reading the full `url`.
const buildRoomPhotoRecords = async (form) => {
  if (!Array.isArray(form.roomPhotos)) return [];
  const rows = form.roomPhotos
    // Prefer the original File (smaller + better quality than the base64
    // preview); fall back to the data: URL preview, or an already-hosted url.
    .map(p => ({ room: p.room || 'other', source: p.file || p.preview || p.url || '' }))
    .filter(p => p.source);
  // Upload each room photo to Cloudinary; store ONLY the resulting https URL.
  // The listing card derives its own resized version from this URL on the fly
  // (toCloudinaryListingImage / backend toCloudinaryCardImage), so a separate
  // base64 thumbUrl is no longer needed.
  return Promise.all(rows.map(async (p) => ({
    room: p.room,
    url:  await uploadToCloudinary(p.source, 'image'),
  })));
};


// ─── PROPERTY SERVICE ─────────────────────────────────────────────────────────
export const propertyService = {

  /**
   * সব প্রপার্টি আনে (filter সহ)।
   * প্রথমে backend, তারপর localStorage। কোনো demo data merge হয় না।
   */
  async getProperties(filters = {}, sortBy = "Newest Listings") {
    const div = filters.activeDivision && filters.activeDivision !== 'all'
      ? filters.activeDivision : '';
    // Search text → backend `q` (server-side $text + regex over the rich
    // haystack: location/area/district + type/category aliases). Skip the
    // "Nearby Location" placeholder, which isn't a real text query.
    const nearMe = String(filters.nearMeLabel || '').trim().toLowerCase();
    const rawQ   = String(filters.searchArea || '').trim();
    const q = rawQ && rawQ.toLowerCase() !== nearMe ? rawQ : '';

    const urlFor = (withQ) => {
      const params = new URLSearchParams();
      if (div) params.set('division', div);
      params.set('status', 'active');
      // Was unset → server defaulted to 50, silently hiding extra listings.
      params.set('limit', '100');
      if (withQ && q) params.set('q', q);
      
      // Backend filters mapped from frontend state
      if (filters.intent) params.set('intent', filters.intent);
      if (filters.minPrice !== undefined) params.set('minPrice', filters.minPrice);
      if (filters.maxPrice !== undefined) params.set('maxPrice', filters.maxPrice);
      if (filters.selectedTypes?.length) params.set('type', filters.selectedTypes[0]);
      if (filters.selectedCategories?.length) params.set('category', filters.selectedCategories[0]);
      
      return `${API}/properties?${params}`;
    };

    try {
      const res = await probeFetch('properties', urlFor(true), {
        signal: AbortSignal.timeout(15000),
      });
      if (res && res.ok) {
        const data = await res.json();
        const apiProps = (data.properties || []).map(p => _normaliseApiProperty(p));
        // Safety net: a text query that returns nothing from the server is
        // retried WITHOUT `q` and matched client-side — so even if the server
        // search ever hiccups, results are never lost.
        if (q && apiProps.length === 0) {
          const res2 = await probeFetch('properties', urlFor(false), {
            signal: AbortSignal.timeout(15000),
          });
          if (res2 && res2.ok) {
            const data2 = await res2.json();
            const all = (data2.properties || []).map(p => _normaliseApiProperty(p));
            return _sortProperties(applyFilters(all, filters), sortBy);
          }
        }
        // Server already did the text match — don't re-narrow by text here
        // (that would undo alias / multi-word matches); apply only the rest.
        return _sortProperties(applyFilters(apiProps, { ...filters, searchArea: "" }), sortBy);
      }
    } catch (_) { /* network / abort → empty below (no localStorage) */ }

    // No localStorage fallback. Listings come ONLY from the backend (MongoDB).
    // If the API is unreachable we return an empty list rather than showing
    // stale, device-local "demo" data.
    return [];
  },

  /**
   * একটি প্রপার্টির details আনে।
   * GET /api/properties/:id
   */
  async getPropertyById(id) {
    const res = await probeFetch('propertyById', `${API}/properties/${id}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (res && res.ok) {
      const data = await res.json();
      return _normaliseApiProperty(data.property);
    }

    // No localStorage fallback — a property comes only from the backend.
    return null;
  },

  /**
   * Landlord info আনে।
   *   ✅ GET /api/landlords/:id  (roadmap-v2 Feature 2 — public landlord card)
   *
   * No demo landlord ever leaks in — যিনি আসলেই কোনো প্রপার্টি upload করেছেন
   * শুধু তার তথ্য return করা হয়।
   */
  async getLandlord(landlordId) {
    if (landlordId == null) return null;

    // ── 1. Real backend ───────────────────────────────────────────────────
    try {
      const res = await fetch(`${API}/landlords/${landlordId}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        return data.landlord || null;
      }
      if (res.status === 404) return null;
    } catch {
      // network down — fall through to the local fallback so the dev
      // experience matches what the rest of the service does.
    }

    // No localStorage fallback — landlord info comes only from the backend.
    return null;
  },

  /**
   * নতুন প্রপার্টি তৈরি করে।
   * ✅ POST /api/properties  (backend চালু থাকলে)
   */
  async createProperty(form) {
    const owner = getCurrentUser();
    if (!owner) throw new Error('Sign in as a host before adding a property.');

    if (getToken()) {
      // Upload all media straight to Cloudinary FIRST; the request body then
      // carries ONLY https URLs (never base64). This is the fix for the POST
      // 400s, and a big part of the listing 500 OOMs — the heavy bytes go to
      // Cloudinary instead of into the request body / MongoDB / the backend.
      const [coverPhoto, roomPhotos, videoUrl] = await Promise.all([
        // Cover: prefer the original File, else the data: preview, else a url.
        uploadToCloudinary(form.coverPhoto?.file || form.coverPhoto?.preview || '', 'image'),
        buildRoomPhotoRecords(form),
        // Video: upload the raw File directly (no base64 conversion). An
        // already-hosted https url (e.g. on edit) is passed through untouched.
        uploadToCloudinary(form.mainVideo?.file || form.mainVideo?.preview || '', 'video'),
      ]);

      const body = {
        title:       form.title,
        intent:      form.intent      || 'rent',
        type:        form.type,
        category:    form.category,
        division:    form.division,
        district:    form.district    || '',
        area:        form.area        || '',
        thana:       form.thana       || '',
        location:    form.location,
        gpsLat:      form.gpsLat      || null,
        gpsLng:      form.gpsLng      || null,
        gpsAddress:  form.gpsAddress  || '',
        beds:        Number(form.beds)  || 1,
        baths:       Number(form.baths) || 1,
        sqft:        Number(form.sqft)  || 0,
        floor:       Number(form.floor ?? form.floorNumber) || 0,
        furnishing:  form.furnishing,
        description: form.description,
        amenities:   form.amenities   || [],
        price:       Number(String(form.price ?? '').replace(/[^\d.]/g, '')) || 0,
        status:      form.status      || 'active',
        coverPhoto,
        // Card-size cover is derived from the Cloudinary URL on the fly, so we
        // no longer send a separate base64 thumbnail.
        coverPhotoThumb: '',
        roomPhotos,
        videoId:     form.videoId     || '',
        videoUrl,
      };

      const res = await probeFetch('createProperty', `${API}/properties`, {
        method:  'POST',
        headers: apiHeaders(),
        body:    JSON.stringify(body),
      });

      if (res && res.ok) {
        const data = await res.json();
        broadcast(KEY_USER_PROPERTIES);
        return _normaliseApiProperty(data.property);
      }
    }

    // No localStorage fallback. If we reach here the server create failed (or
    // there's no auth token) — surface a real error instead of silently saving
    // the listing to this device only.
    throw new Error('Could not save the property to the server. Please check your connection and try again.');
  },

  /**
   * Host এর নিজের সব প্রপার্টি আনে।
   * ✅ GET /api/host/properties  (backend চালু থাকলে)
   */
  async listMyProperties() {
    if (getToken()) {
      const res = await probeFetch('hostProperties', `${API}/host/properties`, {
        headers: apiHeaders(),
        signal:  AbortSignal.timeout(HOST_PROPERTIES_TIMEOUT_MS),
      });
      if (res && res.ok) {
        const data = await res.json();
        return (data.properties || []).map(_normaliseApiProperty);
      }
      if (!res) {
        throw new Error('Could not reach the server while loading your properties.');
      }
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Could not load your properties (${res.status}).`);
    }

    // No localStorage fallback — a host's listings come only from the backend.
    return [];
  },

  /** Sync version — localStorage has been removed, so this now returns [].
   *  Components should use the async listMyProperties() (backend) instead. */
  listMyPropertiesSync() {
    return [];
  },

  /**
   * প্রপার্টি update করে।
   * ✅ PATCH /api/properties/:id  (backend চালু থাকলে)
   */
  async updateProperty(id, patch = {}) {
    if (getToken()) {
      const nextPatch = { ...patch };
      // Mirror createProperty: any media in the patch is uploaded to Cloudinary
      // first so we never PATCH base64 into the document.
      if (Object.prototype.hasOwnProperty.call(nextPatch, 'coverPhoto')) {
        nextPatch.coverPhoto = nextPatch.coverPhoto
          ? await uploadToCloudinary(nextPatch.coverPhoto, 'image')
          : '';
        nextPatch.coverPhotoThumb = ''; // derived from the URL on the fly
      }
      if (Array.isArray(nextPatch.roomPhotos)) {
        nextPatch.roomPhotos = await buildRoomPhotoRecords({ roomPhotos: nextPatch.roomPhotos });
      }
      // Guard: if a raw/base64 video sneaks into an edit, host it too.
      if (Object.prototype.hasOwnProperty.call(nextPatch, 'videoUrl') && nextPatch.videoUrl) {
        nextPatch.videoUrl = await uploadToCloudinary(nextPatch.videoUrl, 'video');
      }
      const res = await probeFetch('updateProperty', `${API}/properties/${id}`, {
        method:  'PATCH',
        headers: apiHeaders(),
        body:    JSON.stringify(nextPatch),
      });
      if (res && res.ok) {
        const data = await res.json();
        broadcast(KEY_USER_PROPERTIES);
        return _normaliseApiProperty(data.property);
      }
    }

    // No localStorage fallback — surface a real error if the server update failed.
    throw new Error('Could not update the property on the server. Please try again.');
  },

  /**
   * প্রপার্টি ডিলিট করে।
   * ✅ DELETE /api/properties/:id  (backend চালু থাকলে)
   *
   * Returns { ok, id, deletedBookings, deletedInquiries, deletedReceipts }
   * on success.
   */
  async deleteProperty(id) {
    if (!getToken()) throw new Error('Sign in before deleting a property.');

    const res = await probeFetch('deleteProperty', `${API}/properties/${id}`, {
      method:  'DELETE',
      headers: apiHeaders(),
    });

    if (res && res.ok) {
      const data = await res.json();
      broadcast(KEY_USER_PROPERTIES);
      return data; // { ok, id, deletedBookings, deletedInquiries, deletedReceipts }
    }

    // Surface structured errors so the UI can branch on code / status.
    if (res) {
      const body = await res.json().catch(() => ({}));
      const err = new Error(body.message || `Delete failed (${res.status}).`);
      err.status = res.status;
      err.code = body.code;
      err.activeBookings = body.activeBookings;
      throw err;
    }

    throw new Error('Could not reach the server. Please try again.');
  },
};

// ─── SUBSCRIBE HELPER ─────────────────────────────────────────────────────────
export const subscribeUserProperties = (listener) =>
  subscribeKey(KEY_USER_PROPERTIES, listener);

// ─── INTERNAL: API → frontend shape converter ─────────────────────────────────
function _normaliseApiProperty(p) {
  if (!p) return null;
  const coverImg = p.coverPhoto || p.coverPhotoThumb || '';
  const roomRecords = Array.isArray(p.roomPhotos)
    ? p.roomPhotos
        .map(r => ({ room: r.room || 'other', url: r.url || r.preview || '', thumbUrl: r.thumbUrl || '' }))
        .filter(r => r.url)
    : [];
  const roomImgs = roomRecords.map(r => r.url);
  return {
    ...p,
    id:             p._id || p.id,
    landlordId:     p.host?._id || p.host || p.landlordId,
    date:           p.createdAt ? String(p.createdAt).slice(0, 10) : (p.date || ''),
    addedDate:      p.createdAt ? String(p.createdAt).slice(0, 10) : (p.addedDate || ''),
    rentalCategory: p.category   || p.rentalCategory || 'family',
    img:            coverImg,
    images:         [coverImg, ...roomImgs].filter(Boolean),
    coverPhoto:     coverImg,
    roomPhotos:     roomRecords,
    rating:         p.rating     ?? 0,
    reviews:        p.reviews    ?? 0,
    verified:       p.verified   ?? false,
    popularity:     p.popularity ?? 0,
    inquiries:      p.inquiries  ?? 0,
    originalPrice:  p.originalPrice ?? p.price,
    lat:            p.gpsLat     ?? p.lat ?? null,
    lng:            p.gpsLng     ?? p.lng ?? null,
    floor:          p.floor      ?? 0,
    mainVideo:      p.videoUrl   || p.mainVideo || '',
  };
}

function _sortProperties(list, sortBy) {
  return [...list].sort((a, b) => {
    if (sortBy === "Price: Low to High")  return a.price - b.price;
    if (sortBy === "Price: High to Low")  return b.price - a.price;
    if (sortBy === "Popular")             return b.popularity - a.popularity;
    return new Date(b.date) - new Date(a.date);
  });
}