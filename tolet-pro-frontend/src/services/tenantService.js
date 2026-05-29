/**
 * tenantService.js
 * ──────────────────────────────────────────────────────────────────────────
 * Talks to the public tenant-profile endpoint exposed by the backend
 * (`GET /api/tenants/:id`). The endpoint returns one of three views
 * depending on whether the caller is the tenant themselves, a landlord
 * with an active inquiry/booking, or anyone else.
 *
 * The shape is documented in backend/controllers/tenant.controller.js
 * and mirrored in components/TenantProfile.jsx — public, unlocked,
 * and "private" (the tenant viewing their own card) all use the same
 * field names so the page never branches on "shape".
 */

const API = (
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api'
).replace(/\/$/, '');

const getToken = () => window.localStorage.getItem('auth:token');

const headers = () => ({
  'Content-Type': 'application/json',
  // Auth header is optional — the route is public — but sending it when
  // we have one is what unlocks the private fields for self / linked
  // landlord callers.
  ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
});

export const tenantService = {
  /**
   * Fetch the public trust card for a tenant.
   *   • Returns `null` on 404 or any failure — the page renders a
   *     friendly "Tenant not found" card in that case (same UX as
   *     LandlordProfile.jsx).
   */
  async getTenant(id) {
    if (id == null) return null;
    try {
      const res = await fetch(`${API}/tenants/${id}`, {
        headers: headers(),
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.tenant || null;
    } catch {
      return null;
    }
  },
};

export default tenantService;
