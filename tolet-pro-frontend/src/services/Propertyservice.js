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
  readJson, writeJson, broadcast, subscribe as subscribeKey, fakeLatency, now, newId,
} from './_storage.js';
import { getCurrentUser } from './authService.js';

// ─── API CONFIG ───────────────────────────────────────────────────────────────
const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

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
    // The fallback floor used to be 5000 BDT/month — sensible for a
    // real production listing but cruel during dev/QA where a host is
    // testing with placeholder prices like 2000-2500. Empty listing
    // pages were the no-1 confusion: properties added by the user did
    // get saved, they just got filtered out before render. We now
    // default to 0 so a freshly-added test listing shows up immediately
    // regardless of price; the PropertyListing UI is still free to
    // pass its own minPrice if it wants the old behaviour.
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
const readAllUserProperties = () => readJson(KEY_USER_PROPERTIES, []);

// Build the canonical `[{ room, url }]` representation that PropertyDetails
// groups by and PropertyListing builds its collage from. Source of truth is
// the room-tagged uploads in the wizard.
const buildRoomPhotoRecords = (form) =>
  Array.isArray(form.roomPhotos)
    ? form.roomPhotos
        .map(p => ({ room: p.room || 'other', url: p.preview || p.url || '' }))
        .filter(p => p.url)
    : [];

const formToProperty = (form, owner) => {
  const priceNumber  = Number(String(form.price ?? '').replace(/[^\d.]/g, '')) || 0;
  const today        = now().slice(0, 10);
  const coverImg     = form.coverPhoto?.preview || '';
  const roomRecords  = buildRoomPhotoRecords(form);
  const roomImgs     = roomRecords.map(r => r.url);

  return {
    id:            newId(),
    landlordId:    owner.id,
    ownerUserId:   owner.id,
    ownerName:     owner.name,
    date:          today,
    addedDate:     today,
    createdAt:     now(),
    division:      form.division      || '',
    district:      form.district      || '',
    area:          form.area          || '',
    type:          form.type          || 'apartment',
    rentalCategory:form.category      || 'family',
    intent:        form.intent        || 'rent',
    title:         form.title         || 'Untitled property',
    location:      form.location      || '',
    gps: { lat: form.gpsLat || null, lng: form.gpsLng || null, address: form.gpsAddress || '' },
    gpsLat:        form.gpsLat        || null,
    gpsLng:        form.gpsLng        || null,
    lat:           form.gpsLat        || null,
    lng:           form.gpsLng        || null,
    beds:          Number(form.beds)  || 1,
    baths:         Number(form.baths) || 1,
    sqft:          Number(form.sqft)  || 0,
    floor:         Number(form.floor) || 0,
    furnishing:    form.furnishing    || 'Unfurnished',
    description:   form.description   || '',
    amenities:     Array.isArray(form.amenities) ? [...form.amenities] : [],
    price:         priceNumber,
    originalPrice: priceNumber,
    rating:        0,
    reviews:       0,
    verified:      false,
    popularity:    0,
    inquiries:     0,
    status:        form.status        || 'active',
    img:           coverImg,
    images:        [coverImg, ...roomImgs].filter(Boolean),
    // Cover + room-tagged photos preserved so:
    //   • PropertyDetails groups the gallery by room category
    //   • PropertyListing's card collage shows one photo per category
    coverPhoto:    coverImg,
    roomPhotos:    roomRecords,
    videoId:       form.videoId       || '',
    mainVideo:     form.mainVideo?.preview || '',
    videoUrl:      form.mainVideo?.preview || '',
  };
};

// ─── PROPERTY SERVICE ─────────────────────────────────────────────────────────
export const propertyService = {

  /**
   * সব প্রপার্টি আনে (filter সহ)।
   * প্রথমে backend, তারপর localStorage। কোনো demo data merge হয় না।
   */
  async getProperties(filters = {}, sortBy = "Newest Listings") {
    const params = new URLSearchParams();
    if (filters.activeDivision && filters.activeDivision !== 'all')
      params.set('division', filters.activeDivision);
    params.set('status', 'active');

    const res = await probeFetch('properties', `${API}/properties?${params}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (res && res.ok) {
      const data = await res.json();
      const apiProps = (data.properties || []).map(p => _normaliseApiProperty(p));
      return _sortProperties(applyFilters(apiProps, filters), sortBy);
    }

    // ── Fallback: শুধুই user-uploaded properties ──
    return _sortProperties(applyFilters(readAllUserProperties(), filters), sortBy);
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

    const userHit = readAllUserProperties().find(p => String(p.id) === String(id));
    return userHit || null;
  },

  /**
   * Landlord info আনে।
   *   ✅ GET /api/landlords/:id  (roadmap-v2 Feature 2 — public landlord card)
   *   📦 localStorage fallback so dev without a backend still renders.
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

    // ── 2. localStorage fallback (no backend reachable) ───────────────────
    const owned = readAllUserProperties().find(
      p => String(p.ownerUserId) === String(landlordId)
        || String(p.landlordId)   === String(landlordId),
    );
    if (owned) {
      return {
        id:           landlordId,
        name:         owned.ownerName || 'TO-LET PRO Host',
        responseTime: '— hrs',
        avatar:       `https://ui-avatars.com/api/?name=${encodeURIComponent(owned.ownerName || 'Host')}&background=fce4ec&color=ba0036&size=256`,
      };
    }
    return null;
  },

  /**
   * নতুন প্রপার্টি তৈরি করে।
   * ✅ POST /api/properties  (backend চালু থাকলে)
   * 📦 localStorage fallback (backend না থাকলে)
   */
  async createProperty(form) {
    const owner = getCurrentUser();
    if (!owner) throw new Error('Sign in as a host before adding a property.');

    if (getToken()) {
      const body = {
        title:       form.title,
        intent:      form.intent      || 'rent',
        type:        form.type,
        category:    form.category,
        division:    form.division,
        district:    form.district    || '',
        area:        form.area        || '',
        location:    form.location,
        gpsLat:      form.gpsLat      || null,
        gpsLng:      form.gpsLng      || null,
        gpsAddress:  form.gpsAddress  || '',
        beds:        Number(form.beds)  || 1,
        baths:       Number(form.baths) || 1,
        sqft:        Number(form.sqft)  || 0,
        furnishing:  form.furnishing,
        description: form.description,
        amenities:   form.amenities   || [],
        price:       Number(String(form.price ?? '').replace(/[^\d.]/g, '')) || 0,
        status:      form.status      || 'active',
        coverPhoto:  form.coverPhoto?.preview || '',
        roomPhotos:  buildRoomPhotoRecords(form),
        videoId:     form.videoId     || '',
        videoUrl:    form.mainVideo?.preview || '',
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

    await fakeLatency(400);
    const record = formToProperty(form, owner);
    const list   = readAllUserProperties();
    list.push(record);
    writeJson(KEY_USER_PROPERTIES, list);
    broadcast(KEY_USER_PROPERTIES);
    return record;
  },

  /**
   * Host এর নিজের সব প্রপার্টি আনে।
   * ✅ GET /api/host/properties  (backend চালু থাকলে)
   * 📦 localStorage fallback
   */
  async listMyProperties() {
    if (getToken()) {
      const res = await probeFetch('hostProperties', `${API}/host/properties`, {
        headers: apiHeaders(),
        signal:  AbortSignal.timeout(15000),
      });
      if (res && res.ok) {
        const data = await res.json();
        return (data.properties || []).map(_normaliseApiProperty);
      }
    }

    await fakeLatency(120);
    const me = getCurrentUser();
    if (!me) return [];
    return readAllUserProperties()
      .filter(p => p.ownerUserId === me.id)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  },

  /** Sync version (useMemo এর ভেতরে use করা যায়) */
  listMyPropertiesSync() {
    const me = getCurrentUser();
    if (!me) return [];
    return readAllUserProperties()
      .filter(p => p.ownerUserId === me.id)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  },

  /**
   * প্রপার্টি update করে।
   * ✅ PATCH /api/properties/:id  (backend চালু থাকলে)
   * 📦 localStorage fallback
   */
  async updateProperty(id, patch = {}) {
    if (getToken()) {
      const res = await probeFetch('updateProperty', `${API}/properties/${id}`, {
        method:  'PATCH',
        headers: apiHeaders(),
        body:    JSON.stringify(patch),
      });
      if (res && res.ok) {
        const data = await res.json();
        broadcast(KEY_USER_PROPERTIES);
        return _normaliseApiProperty(data.property);
      }
    }

    await fakeLatency(200);
    const me = getCurrentUser();
    if (!me) throw new Error('Sign in as a host before editing a property.');
    const list = readAllUserProperties();
    const idx  = list.findIndex(p => String(p.id) === String(id));
    if (idx === -1) return null;
    if (list[idx].ownerUserId && list[idx].ownerUserId !== me.id) {
      throw new Error('You can only edit your own listings.');
    }
    const merged = { ...list[idx], ...patch, id: list[idx].id, updatedAt: now() };
    list[idx] = merged;
    writeJson(KEY_USER_PROPERTIES, list);
    broadcast(KEY_USER_PROPERTIES);
    return merged;
  },
};

// ─── SUBSCRIBE HELPER ─────────────────────────────────────────────────────────
export const subscribeUserProperties = (listener) =>
  subscribeKey(KEY_USER_PROPERTIES, listener);

// ─── INTERNAL: API → frontend shape converter ─────────────────────────────────
function _normaliseApiProperty(p) {
  if (!p) return null;
  const coverImg = p.coverPhoto || '';
  const roomRecords = Array.isArray(p.roomPhotos)
    ? p.roomPhotos
        .map(r => ({ room: r.room || 'other', url: r.url || r.preview || '' }))
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
