'use strict';

/**
 * campaignTargets.js — where a marketing message is allowed to send someone.
 * ──────────────────────────────────────────────────────────────────────────
 * Every campaign now carries a destination chosen by the admin, and that value
 * arrives from a text field. Two separate things go wrong if it is trusted:
 *
 *   1. OPEN REDIRECT. The short link lives on our own verified domain, so a
 *      recipient (and Android's App Links check) treats it as ours. Letting
 *      `targetPath` be "https://evil.example" or "//evil.example" would turn
 *      an SMS from To-Let Pro into a link that our domain vouches for and
 *      hands to someone else.
 *
 *   2. A LINK THAT SILENTLY GOES NOWHERE. App.jsx ends with
 *      `<Route path="*" element={<Navigate to="/" replace />} />`, so a typo
 *      like '/subscriptions' (plural — the ADMIN console's path, easy to type
 *      out of habit) does not 404. It quietly lands on the homepage, which is
 *      indistinguishable from a broken campaign and impossible to notice until
 *      the blast has already gone out and cannot be recalled.
 *
 * So destinations are matched against the frontend's real route table before a
 * link is minted. The admin console renders PRESETS from the same list, so the
 * common cases never involve typing a path at all.
 *
 * KEEPING THIS IN SYNC: this mirrors the routes in
 * tolet-pro-frontend/src/App.jsx. Adding a route there does not add it here —
 * do both, deliberately, the same way DeepLinkHandler.jsx's ROUTABLE list is
 * maintained. An unlisted route is rejected with a clear error, not silently
 * dropped, so the failure mode of forgetting is loud.
 */

// `access` mirrors each route's guard in App.jsx, and it is not decoration.
// RequireAuth does two different things:
//
//   • no session          → /login?next=<path>, and the recipient lands on the
//     advertised page once they sign in or sign up. This is the good path, and
//     it is why a campaign can point at a private page at all.
//   • signed in, WRONG ROLE → a silent redirect to /tenant-dashboard. So a
//     promo sent to tenants pointing at /subscription (landlord-only) does not
//     fail loudly, it just quietly delivers them somewhere else. The console
//     shows this next to the destination so it is a decision, not a surprise.
//
//   'public'   anyone, signed in or not
//   'auth'     any signed-in account
//   'landlord' / 'tenant'  that role only
//
// A trailing '(/…)?' is never allowed: paths are matched exactly (minus an
// optional trailing slash) so '/subscription-old' cannot pass as '/subscription'.
const ROUTES = [
  { path: '/',                 label: 'Home',                        access: 'public' },
  { path: '/subscription',     label: 'Plans & pricing',             access: 'landlord' },
  { path: '/to-let',           label: 'To-Let hub',                  access: 'public' },
  { path: '/services',         label: 'Home services',               access: 'public' },
  { path: '/support',          label: 'Help & support',              access: 'public' },
  { path: '/how-it-works',     label: 'How it works',                access: 'public' },
  { path: '/living',           label: 'Living (roommate wallet)',    access: 'auth' },
  { path: '/messages',         label: 'Messages',                    access: 'auth' },
  { path: '/smart-alerts',     label: 'Smart alerts',                access: 'auth' },
  { path: '/ai-insights',      label: 'AI insights',                 access: 'public' },
  { path: '/list-property',    label: 'List a property',             access: 'landlord' },
  { path: '/host-dashboard',   label: 'Landlord dashboard',          access: 'landlord' },
  { path: '/tenant-dashboard', label: 'Tenant dashboard',            access: 'tenant' },
  { path: '/account/privacy',  label: 'Privacy centre',              access: 'auth' },
  { path: '/meal-manager',     label: 'Meal manager',                access: 'public' },
  { path: '/roommate-wallet',  label: 'Roommate wallet',             access: 'public' },
  { path: '/house-manager',    label: 'House manager',               access: 'public' },
  { path: '/tenant-manager',   label: 'Tenant manager (ভাড়ার খাতা)', access: 'public' },
  { path: '/home-services',    label: 'Home services landing',       access: 'public' },
  { path: '/privacy-policy',   label: 'Privacy policy',              access: 'public' },
  { path: '/terms',            label: 'Terms of service',            access: 'public' },
  { path: '/refund',           label: 'Refund policy',               access: 'public' },
  { path: '/trust-safety',     label: 'Trust & safety',              access: 'public' },
];

// Routes with a parameter. The pattern must anchor both ends for the same
// reason the static list is matched exactly.
const PARAM_ROUTES = [
  { re: /^\/property\/[A-Za-z0-9_-]{1,64}$/,   label: 'A property page',     example: '/property/<id>',           access: 'public' },
  { re: /^\/properties\/[A-Za-z0-9%_-]{1,64}$/, label: 'A division listing', example: '/properties/dhaka',        access: 'public' },
  { re: /^\/checkout\/[A-Za-z0-9_-]{1,40}$/,   label: 'Checkout for a plan', example: '/checkout/pro_monthly',    access: 'auth' },
  { re: /^\/landlord\/[A-Za-z0-9]{6,32}$/,     label: 'A landlord profile',  example: '/landlord/<id>',           access: 'public' },
  { re: /^\/tenant\/[A-Za-z0-9]{6,32}$/,       label: 'A tenant profile',    example: '/tenant/<id>',             access: 'public' },
];

// The dashboards route by `?tab=`, and useTabHistory falls back to the section
// root for a tab it does not recognise — silently, which is the same invisible
// failure as the catch-all above. These are the tab names that exist; see the
// contract note at the top of frontend src/utils/notificationRoute.js.
const TABS = {
  '/host-dashboard': [
    'dashboard', 'documents', 'analytics', 'properties', 'inquiries',
    'bookings', 'rent', 'payments', 'smartAlerts', 'aiInsights',
    'settings', 'profile',
  ],
  '/tenant-dashboard': [
    'overview', 'saved', 'applications', 'alerts', 'payments',
    'settings', 'profile',
  ],
};

/** Presets for the admin console's destination picker. */
function listTargets() {
  return {
    routes: ROUTES,
    paramRoutes: PARAM_ROUTES.map(({ label, example, access }) => ({ label, example, access })),
    tabs: TABS,
  };
}

/** Who can open a destination: 'public' | 'auth' | 'landlord' | 'tenant'. */
function accessOf(path) {
  const bare = String(path || '').split('?')[0];
  const stat = ROUTES.find((r) => r.path === bare);
  if (stat) return stat.access;
  const param = PARAM_ROUTES.find((r) => r.re.test(bare));
  return param ? param.access : 'public';
}

/**
 * Validate and normalise a campaign destination.
 *
 * @param {string} input  an in-app path, optionally with a query string
 * @returns {{ ok: true, path: string } | { ok: false, reason: string }}
 */
function normalizeTarget(input) {
  const raw = String(input || '').trim();
  if (!raw) return { ok: false, reason: 'A destination is required.' };

  // Reject anything that is not a plain in-app path BEFORE parsing. '//host'
  // is protocol-relative and 'https://host' is absolute; both are redirects off
  // this domain, and both start life looking like a path.
  if (!raw.startsWith('/') || raw.startsWith('//')) {
    return { ok: false, reason: 'Use an in-app path like /subscription — not a full URL.' };
  }
  if (/[\s<>"'\\]/.test(raw)) {
    return { ok: false, reason: 'The destination contains characters that are not valid in a URL.' };
  }

  // A hash is dropped rather than rejected: it is meaningless to the router
  // here and harmless, but carrying it forward would let a campaign smuggle
  // state past this check.
  const [pathAndQuery] = raw.split('#');
  const [pathPart, queryPart = ''] = pathAndQuery.split('?');

  // Collapse duplicate slashes and drop a trailing one (except for the root),
  // so '/subscription/' and '/subscription' are the same destination.
  let path = pathPart.replace(/\/{2,}/g, '/');
  if (path.length > 1) path = path.replace(/\/+$/, '');

  const isStatic = ROUTES.some((r) => r.path === path);
  const isParam = PARAM_ROUTES.some((r) => r.re.test(path));
  if (!isStatic && !isParam) {
    return {
      ok: false,
      reason: `"${path}" is not a page in the app. A link to it would land on the homepage instead.`,
    };
  }

  if (!queryPart) return { ok: true, path };

  // Only `tab` is meaningful to any of these destinations, and only on the two
  // dashboards. Anything else is dropped rather than rejected — a stray utm_*
  // pasted from somewhere should not fail a send, and the campaign is already
  // identified by its own short code.
  const params = new URLSearchParams(queryPart);
  const tab = params.get('tab');
  if (!tab) return { ok: true, path };

  const allowed = TABS[path];
  if (!allowed) {
    return { ok: false, reason: `${path} has no tabs — remove "?tab=${tab}".` };
  }
  if (!allowed.includes(tab)) {
    return {
      ok: false,
      reason: `"${tab}" is not a tab on ${path}. Valid tabs: ${allowed.join(', ')}.`,
    };
  }
  return { ok: true, path: `${path}?tab=${encodeURIComponent(tab)}` };
}

module.exports = { listTargets, normalizeTarget, accessOf, ROUTES, PARAM_ROUTES, TABS };
