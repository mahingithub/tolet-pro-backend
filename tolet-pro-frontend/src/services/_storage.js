/**
 * ─── _storage.js ──────────────────────────────────────────────────────────
 *
 * Internal helpers used by every service in this folder. Centralizes:
 *   - localStorage namespacing (so we don't collide with other apps)
 *   - JSON parse/stringify boilerplate
 *   - cross-tab change broadcasts (the browser already fires `storage`
 *     events for us, but we wrap them so service consumers can subscribe
 *     to logical keys without caring about prefixing)
 *   - latency simulation (so the UI's loading states are exercised even
 *     in mock mode, and the real backend will feel similar)
 *   - opaque ID generation
 *
 * When the backend goes live, only `_storage.js` and the four `*Service.js`
 * files need to change. UI components must never read or write
 * localStorage directly.
 */

const NAMESPACE = 'tolet_pro::';

/** @returns {string} */
export const newId = () =>
  `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

/** @template T @param {string} key @param {T} fallback @returns {T} */
export const readJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(NAMESPACE + key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

/** @template T @param {string} key @param {T} value */
export const writeJson = (key, value) => {
  localStorage.setItem(NAMESPACE + key, JSON.stringify(value));
};

/** @param {string} key */
export const removeKey = (key) => {
  localStorage.removeItem(NAMESPACE + key);
};

/**
 * Subscribe to changes for one of our namespaced keys. Fires on every
 * tab/window of the same origin (browser firing the native `storage` event)
 * AND in the current tab via a custom event we dispatch ourselves. Returns
 * an unsubscribe function.
 *
 * @param {string} key
 * @param {() => void} listener
 * @returns {() => void}
 */
export const subscribe = (key, listener) => {
  const handler = (event) => {
    // Native cross-tab storage events.
    if (event instanceof StorageEvent) {
      if (event.key === NAMESPACE + key) listener();
      return;
    }
    // Same-tab custom dispatch (CustomEvent.detail.key).
    const detail = /** @type {CustomEvent} */ (event).detail;
    if (detail && detail.key === key) listener();
  };
  window.addEventListener('storage', handler);
  window.addEventListener('tolet:storage', /** @type {EventListener} */(handler));
  return () => {
    window.removeEventListener('storage', handler);
    window.removeEventListener('tolet:storage', /** @type {EventListener} */(handler));
  };
};

/** @param {string} key */
export const broadcast = (key) => {
  window.dispatchEvent(new CustomEvent('tolet:storage', { detail: { key } }));
};

/**
 * Simulate network latency so loading states get exercised. The real
 * backend is unlikely to respond in <50ms, so this also keeps mock-mode
 * UX honest.
 * @param {number} [ms]
 */
export const fakeLatency = (ms = 250) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Stable ISO timestamp helper (so test snapshots are deterministic if needed). */
export const now = () => new Date().toISOString();
