'use strict';

/**
 * utils/trustScore.js
 * ─────────────────────────────────────────────────────────────────────
 * Single source of truth for trust score computation.
 *
 * Why a util and not a model method?
 *   • tests/profile.test.js, migrations, scheduled jobs all need this
 *     without pulling in the full Mongoose connection
 *   • Frontend mirrors the same weights — keeping the formula in a
 *     plain-JS file makes it copy-pasteable to the frontend if we ever
 *     want offline preview math
 *   • User.js's pre-save hook still calls it (re-exported below for
 *     backwards-compat with existing `User.computeTenantTrust` callers)
 *
 * The TENANT formula is unchanged from the original in User.js —
 * honest-verification rule preserved (NID + profession points only
 * award after admin sets verification.status === 'verified').
 *
 * The LANDLORD formula is NEW. Until landlordProfile schema lands, it
 * scores on the fields that already exist on the User doc (phone, avatar,
 * verification photo, admin-approved NID). Add landlord-specific weights
 * here when preferredTenants/communication/serviceCharge/houseRules
 * become real schema fields.
 */

// ─── TIER MAPPING ────────────────────────────────────────────────────
// Shared across roles. Frontend's TrustGaugeLive uses the same buckets.
function tierFor(score) {
  if (score >= 90) return 'platinum';
  if (score >= 70) return 'gold';
  if (score >= 40) return 'silver';
  return 'bronze';
}

// ─── TENANT ──────────────────────────────────────────────────────────
// IMPORTANT — this is the existing User.js formula, lifted verbatim.
// Do NOT tweak weights here without also updating the dashboard's
// previewed score. The "honest-verification" gate (adminApproved) is
// the whole point of computing server-side; the user can't fake it.
function computeTenantTrust(profile = {}, parentDoc = {}) {
  const v = profile.verification || {};
  const adminApproved = v.status === 'verified';
  const items = [
    // Phone OTP — trustworthy without admin review (Firebase did it).
    { pts: 20, done: !!parentDoc.phone },
    // Profile photo — user-uploaded, not claimed to be govt-verified.
    { pts: 30, done: !!v.photo },
    // NID — admin must have approved. Uploaded-but-pending = 0 pts.
    { pts: 50, done: adminApproved && !!(v.nidFront && v.nidBack) },
  ];
  const score = items.reduce((s, i) => (i.done ? s + i.pts : s), 0);
  return { score, tier: tierFor(score) };
}

// ─── LANDLORD ────────────────────────────────────────────────────────
// Scored from fields that exist on the User doc TODAY. When the
// landlordProfile sub-schema lands (preferredTenants, communication,
// serviceCharge, houseRules), add those items here — they should not
// require admin approval since they're self-declared preferences, not
// identity claims. Suggested future weights:
//   preferredTenants[].length > 0  → +10
//   communication[].length > 0     → +10
//   serviceCharge != null          → +10
//   houseRules[].length > 0        → +10
// That gives landlords a path to 100 without NID, matching the
// blueprint's "soft trust" idea for landlord listings.
function computeLandlordTrust(user = {}) {
  const lp = user.landlordProfile || {};
  const tp = user.tenantProfile || {};
  
  const vLandlord = lp.verification || {};
  const vTenant = tp.verification || {};
  
  const isLandlordVerified = vLandlord.status === 'verified';
  const isTenantVerified = vTenant.status === 'verified';
  const adminApproved = isLandlordVerified || isTenantVerified;

  const items = [
    // Phone OTP
    { pts: 20, done: !!user.phone },
    // Avatar uploaded
    { pts: 10, done: !!user.avatar },
    // Verification photo (selfie)
    { pts: 20, done: !!vLandlord.photo || !!vTenant.photo },
    // NID admin-approved
    { pts: 25, done: adminApproved && (!!(vLandlord.nidFront && vLandlord.nidBack) || !!(vTenant.nidFront && vTenant.nidBack)) },
    // Landlord Preferences
    { pts: 5, done: (lp.preferredTenants || []).length > 0 },
    { pts: 5, done: (lp.communication || []).length > 0 },
    { pts: 5, done: lp.serviceCharge != null && lp.serviceCharge !== '' },
    { pts: 10, done: (lp.houseRules || []).length > 0 },
  ];
  const score = items.reduce((s, i) => (i.done ? s + i.pts : s), 0);
  return { score, tier: tierFor(score) };
}

// ─── DISPATCH ────────────────────────────────────────────────────────
// One entry point the controllers should call. Picks the right formula
// based on the user's active role. Returns `{ score, tier }` regardless.
function computeTrust(user = {}) {
  const role = user.role || (Array.isArray(user.roles) ? user.roles[0] : 'tenant');
  if (role === 'landlord') return computeLandlordTrust(user);
  return computeTenantTrust(user.tenantProfile || {}, user);
}

module.exports = {
  computeTrust,
  computeTenantTrust,
  computeLandlordTrust,
  tierFor,
};