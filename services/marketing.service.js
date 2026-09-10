'use strict';

/**
 * marketing.service.js
 * ──────────────────────────────────────────────────────────────────────────
 * Backs the admin Subscriptions console: who is on which plan, who has the
 * app installed, who consented to WhatsApp — and the multi-channel "special
 * offer" blast.
 *
 * Two things worth knowing before editing:
 *
 * 1. TIER IS DERIVED, NEVER STORED. `Subscription.planId` alone is not the
 *    answer — a lapsed pro_yearly row still says 'pro_yearly'. Everything
 *    goes through utils/subscriptionTier.js → tierOf(), the same helper the
 *    listing quotas enforce with, so the console can never disagree with what
 *    the app actually grants.
 *
 * 2. EVERY CHANNEL IS CONSENT-GATED, and the gates differ per channel because
 *    the regulatory exposure does:
 *      • in-app   — always allowed (it's a row in their own notification list)
 *      • push     — preferences.notifications.marketingPush
 *      • sms      — preferences.smsAlerts  (carrier spam rules)
 *      • whatsapp — preferences.notifications.whatsappOptIn  (Meta requires
 *                   explicit opt-in for marketing templates; ignoring it gets
 *                   the business number quality-rated down, then blocked)
 *    A user who fails a channel's gate is reported as `skipped`, not `failed`
 *    — the admin needs to tell "they said no" apart from "the gateway broke".
 */

const User = require('../models/User');
const Subscription = require('../models/Subscription');
const env = require('../config/env');
const { tierOf } = require('../utils/subscriptionTier');
const { publicAppBaseUrl } = require('../utils/inviteToken');
const notificationSvc = require('./notification.service');
const pushSvc = require('./push.service');
const smsSvc = require('./sms.service');
const waSvc = require('./whatsapp.service');
const campaignLinks = require('./campaignLink.service');

// A deviceTokens entry with one of these platforms was registered by the
// Capacitor shell (services/nativePush.js sends Capacitor.getPlatform()), so
// its presence means the native app is installed on a real device. 'web' comes
// from services/fcmService.js — a browser tab or an installed PWA.
const NATIVE_PLATFORMS = ['android', 'ios'];

// appClients kinds that mean the app is on the device rather than in a tab.
// See models/User.js → appClients.
const INSTALLED_KINDS = ['native', 'pwa'];

// The two independent ways a user can prove they have the app. Kept as one
// array because every place that asks "is it installed?" — the row, the
// filter, and the headline count — has to ask it identically, and they
// previously disagreed the moment one was edited.
//
// The appClients clause is the one that actually works: deviceTokens only
// exists for users who accepted the notification prompt, so on its own it
// reported installed users as not installed. deviceTokens stays in the OR as
// the fallback for everyone who installed before the app-open heartbeat
// shipped and has not opened it since.
const INSTALLED_CLAUSES = [
  { appClients: { $elemMatch: { kind: { $in: INSTALLED_KINDS } } } },
  { appClients: { $elemMatch: { platform: { $in: NATIVE_PLATFORMS } } } },
  { deviceTokens: { $elemMatch: { platform: { $in: NATIVE_PLATFORMS } } } },
];

const lower = (v) => String(v || '').toLowerCase();

/**
 * Install state for one user.
 *
 *   'native' → the Capacitor app on a phone (heartbeat or android/ios token)
 *   'pwa'    → installed to the home screen / dock, but not the native app
 *   'web'    → seen only in a browser tab, or push-reachable in one
 *   'none'   → never seen, no push token
 *
 * PRECEDENCE MATTERS: a user with the native app AND a desktop browser is
 * 'native'. The question the console asks is "can I reach them in the app",
 * and the answer is yes as soon as any one of their devices has it.
 */
function installStateOf(user) {
  const clients = Array.isArray(user?.appClients) ? user.appClients : [];
  const tokens = Array.isArray(user?.deviceTokens) ? user.deviceTokens : [];

  const nativeClient = clients.some(
    (c) => lower(c?.kind) === 'native' || NATIVE_PLATFORMS.includes(lower(c?.platform)),
  );
  const nativeToken = tokens.some((t) => NATIVE_PLATFORMS.includes(lower(t?.platform)));
  if (nativeClient || nativeToken) return 'native';

  if (clients.some((c) => lower(c?.kind) === 'pwa')) return 'pwa';
  if (clients.length || tokens.length) return 'web';
  return 'none';
}

/** Does this install state count as "has the app"? */
const isInstalled = (state) => state === 'native' || state === 'pwa';

/** Consent flags for one user, defaulted to match the schema. */
function consentOf(user) {
  const prefs = user?.preferences || {};
  const notif = prefs.notifications || {};
  return {
    whatsappOptIn: notif.whatsappOptIn === true,
    marketingPush: notif.marketingPush !== false,
    smsAlerts: prefs.smsAlerts !== false,
  };
}

/**
 * Mongo filter for the audience query.
 *
 * `tier` can't be filtered in the database because it depends on expiry dates
 * evaluated at read time, so the caller passes the already-resolved id sets:
 * `paidIds` (everyone whose subscription currently grants plus/pro) lets a
 * 'free' filter become `$nin` — which correctly includes the majority of users
 * who have no Subscription row at all.
 */
function buildAudienceFilter({ tier, installed, whatsapp, search }, { tierIds, paidIds }) {
  const filter = {};
  // Both the install test and the search are $or clauses, and a Mongo query
  // document has only ONE top-level $or — assigning them both would silently
  // drop whichever was written first. They are collected into $and instead, so
  // "installed users named Rahim" means both conditions rather than the last
  // one to be set.
  const and = [];

  if (tier === 'free') filter._id = { $nin: paidIds };
  else if (tier === 'plus' || tier === 'pro') filter._id = { $in: tierIds };

  if (installed === 'true') and.push({ $or: INSTALLED_CLAUSES });
  else if (installed === 'false') and.push({ $nor: INSTALLED_CLAUSES });

  if (whatsapp === 'true') filter['preferences.notifications.whatsappOptIn'] = true;
  else if (whatsapp === 'false') filter['preferences.notifications.whatsappOptIn'] = { $ne: true };

  if (search && String(search).trim()) {
    // Escape regex metacharacters — an admin typing "+880" must not blow up
    // the query. Mirrors the same guard in admin.controller.js → listUsers.
    const rx = new RegExp(String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    and.push({ $or: [{ name: rx }, { phone: rx }, { email: rx }] });
  }

  if (and.length) filter.$and = and;
  return filter;
}

/**
 * Resolve every subscription into a userId → tier map, plus the id sets the
 * tier filter needs. One query: subscriptions are one-per-host, so this stays
 * small relative to the user collection.
 */
async function loadTierIndex() {
  const subs = await Subscription.find({}).lean();
  const now = new Date();

  const tierByUser = new Map();
  const subByUser = new Map();
  const paidIds = [];
  const byTier = { plus: [], pro: [] };

  for (const sub of subs) {
    const tier = tierOf(sub, now);
    const uid = String(sub.userId);
    tierByUser.set(uid, tier);
    subByUser.set(uid, sub);
    if (tier === 'plus' || tier === 'pro') {
      paidIds.push(sub.userId);
      byTier[tier].push(sub.userId);
    }
  }

  return { tierByUser, subByUser, paidIds, byTier };
}

/**
 * One page of the audience table.
 *
 * @param {object} q  { tier, installed, whatsapp, search, page, limit }
 * @returns {Promise<{rows: object[], total: number, page: number, limit: number, counts: object}>}
 */
async function listAudience(q = {}) {
  const { tierByUser, subByUser, paidIds, byTier } = await loadTierIndex();

  const tierIds = q.tier === 'plus' || q.tier === 'pro' ? byTier[q.tier] : [];
  const filter = buildAudienceFilter(q, { tierIds, paidIds });

  const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
  const page = Math.max(1, Number(q.page) || 1);

  const [users, total, reachable] = await Promise.all([
    User.find(filter)
      .select('name phone email avatar roles createdAt lastLoginAt isBanned deviceTokens appClients preferences')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
    // sendOffer() drops banned accounts from the audience, so `total` is NOT
    // the number that will be messaged. The console needs both: `total` labels
    // the table (banned rows are shown, with a badge, because an admin
    // reviewing an audience should see them), while `reachable` is the number
    // to promise on the send button. Reporting `total` there meant "Send to
    // 412" was routinely followed by "Dispatched to 397 user(s)".
    User.countDocuments({ ...filter, isBanned: { $ne: true } }),
  ]);

  const rows = users.map((u) => {
    const uid = String(u._id);
    const sub = subByUser.get(uid) || null;
    const install = installStateOf(u);
    const consent = consentOf(u);

    return {
      id: uid,
      name: u.name,
      phone: u.phone,
      email: u.email || '',
      avatar: u.avatar || '',
      roles: u.roles || [],
      isBanned: !!u.isBanned,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt || null,

      // Plan — `tier` is what the account currently GRANTS; planId/status are
      // the raw billing row, shown so an admin can see *why* (e.g. tier 'free'
      // with status 'past_due' is a churn signal worth an offer).
      tier: tierByUser.get(uid) || 'free',
      planId: sub?.planId || 'free',
      status: sub?.status || null,
      currentPeriodEnd: sub?.currentPeriodEnd || null,
      trialEndsAt: sub?.trialEndsAt || null,

      // Reachability
      appInstalled: isInstalled(install),
      installState: install,
      deviceCount: Array.isArray(u.deviceTokens) ? u.deviceTokens.length : 0,
      // When the app was last opened on any device — the honest answer to "is
      // this person still using it", which a push token cannot give.
      lastAppOpenAt: (Array.isArray(u.appClients) ? u.appClients : [])
        .reduce((latest, c) => {
          const seen = c?.lastSeenAt ? new Date(c.lastSeenAt) : null;
          return seen && (!latest || seen > latest) ? seen : latest;
        }, null),
      whatsappOptIn: consent.whatsappOptIn,
      marketingPush: consent.marketingPush,
      smsAlerts: consent.smsAlerts,
    };
  });

  // Headline totals for the whole user base, independent of the current page
  // and filters — the admin wants "how many Pro users exist", not "how many
  // are on screen".
  const [allUsers, installedTotal, whatsappTotal] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ $or: INSTALLED_CLAUSES }),
    User.countDocuments({ 'preferences.notifications.whatsappOptIn': true }),
  ]);

  return {
    rows,
    total,
    reachable,
    page,
    limit,
    counts: {
      users: allUsers,
      pro: byTier.pro.length,
      plus: byTier.plus.length,
      free: allUsers - paidIds.length,
      appInstalled: installedTotal,
      whatsappOptIn: whatsappTotal,
    },
    // What the CONSOLE cannot know on its own: which gateways this deployment
    // can actually use. The composer previously offered a Meta template form
    // unconditionally, so on an OpenWA deployment every WhatsApp blast was
    // accepted, dispatched, and skipped for every single recipient.
    channels: channelCapabilities(),
  };
}

/**
 * What each channel can do in THIS environment, for the composer to render.
 *
 * The WhatsApp answer is the one that matters. 'meta' is the only provider that
 * can send an approved marketing TEMPLATE (the approved wording lives on Meta's
 * servers and we only hold its name). 'openwa' drives your own number over
 * WhatsApp Web, which can only send free TEXT — which is fine for marketing to
 * people who opted in, and is why the composer offers a text mode at all.
 */
function channelCapabilities() {
  const provider = (env.whatsapp && env.whatsapp.provider) || 'meta';
  const waConfigured = waSvc.isConfigured();
  return {
    whatsapp: {
      provider,
      configured: waConfigured,
      // Which composer form to show. 'template' → approved template name +
      // positional variables; 'text' → a message body we write ourselves.
      mode: provider === 'meta' ? 'template' : 'text',
      // The throttle is per-message, not per-blast, so an admin needs to know
      // the wall-clock cost before pressing send.
      minGapMs: (env.whatsapp && env.whatsapp.minGapMs) || 0,
      maxPerBlast: WHATSAPP_MAX_PER_BLAST,
      maxPerDay: (env.whatsapp && env.whatsapp.maxPerDay) || 0,
    },
    sms: { configured: smsSvc.isConfigured() },
  };
}

// ─── Offer dispatch ─────────────────────────────────────────────────────────

const CHANNELS = ['inapp', 'push', 'sms', 'whatsapp'];

// Hard ceiling on one blast. A mistyped filter that selects the whole user
// base would otherwise fire tens of thousands of paid SMS in a single request
// — and SMS is the one channel here that costs real money per message and
// cannot be recalled. The endpoint reports the cap so the admin sees the
// audience was truncated rather than silently under-delivered.
const MAX_RECIPIENTS = 5000;

// How many recipients we dispatch concurrently. The gateways are HTTP calls
// with ~15 s timeouts; unbounded Promise.all over thousands of users would
// open thousands of sockets at once and trip provider rate limits.
const BATCH_SIZE = 20;

// WhatsApp gets its own, much smaller ceiling, for a reason that has nothing to
// do with the other channels: whatsapp.service funnels every send through a
// deliberate throttle (a ~3 s gap plus jitter) because OpenWA drives a real
// consumer WhatsApp account, and accounts get banned for LOOKING automated.
//
// That gap is per message, so the blast is serial: 60 recipients is ~3 minutes
// of a single HTTP request being held open. Past that the request is likelier
// to be killed by a proxy than to finish, and an admin who sees a timeout on a
// send that actually went out will send it again.
//
// So a WhatsApp blast is capped here and the overflow is reported as skipped
// with reason 'blast_cap' — narrow the filter and send the rest, rather than
// have the console lie about what happened.
const WHATSAPP_MAX_PER_BLAST = Math.max(
  1,
  Number(process.env.WHATSAPP_MAX_PER_BLAST || 60),
);

// The failure codes whatsapp.service is contracted to return. Anything else it
// resolves with is a raw transport message, which must never become a tally
// key — see the note at the WhatsApp delivery branch below.
const WHATSAPP_REASONS = new Set([
  'invalid_recipient',
  'not_configured',
  'template_unsupported',
  'rate_limited',
]);

/** Replace {{name}} / {{tier}} placeholders in a composed message. */
function renderTemplate(text, row) {
  return String(text || '')
    .replace(/\{\{\s*name\s*\}\}/gi, row.name || '')
    .replace(/\{\{\s*tier\s*\}\}/gi, row.tier || 'free');
}

/**
 * Deliver one offer to one user across the requested channels.
 * Never throws — a per-user failure is recorded and the blast continues.
 */
// Where a tapped offer lands when the admin did not choose. An upgrade promo is
// only actionable on the plan page, so that is the default. Any destination
// must be a route that actually exists in the frontend router — App.jsx has a
// catch-all that silently redirects unknown paths to '/', which is
// indistinguishable from a broken notification. utils/campaignTargets.js is
// what enforces that; nothing reaches here unvalidated.
const DEFAULT_OFFER_URL = '/subscription';

/**
 * Append the campaign's link to an outgoing text message.
 *
 * SMS and WhatsApp have no tap target of their own — the message IS the text —
 * so without this the recipient is told about an offer with no way to reach it.
 * A blank line keeps WhatsApp's own preview card from swallowing the last line
 * of copy.
 */
function withLink(text, link) {
  const copy = String(text || '').trim();
  if (!link) return copy;
  if (!copy) return link;
  // Already carries it (an admin who pasted the link into the body themselves)
  // — don't send it twice.
  return copy.includes(link) ? copy : `${copy}\n\n${link}`;
}

async function deliverToUser(user, { channels, title, body, smsText, whatsapp, data, url, links = {} }) {
  const uid = String(user._id);
  const consent = consentOf(user);
  const row = { name: user.name, tier: user.__tier || 'free' };
  const result = { userId: uid, name: user.name, phone: user.phone, channels: {} };
  const deepLink = url || DEFAULT_OFFER_URL;

  // ── In-app: a Notification row + socket push. Always permitted. ──────────
  if (channels.includes('inapp')) {
    const doc = await notificationSvc.emit({
      userId: user._id,
      type: 'marketing',
      title: renderTemplate(title, row),
      body: renderTemplate(body, row),
      // `path` is the in-app deep-link convention NotificationPanel already
      // reads; without it the panel's default sends the user to /notifications,
      // which is not a registered route.
      data: { ...data, kind: 'marketing', path: deepLink, url: deepLink },
      // emit()'s own FCM fan-out is suppressed here: 'push' is a separate
      // channel with its own consent gate, and letting the in-app write also
      // push would deliver to users who opted out of marketing push.
      skipPush: true,
    });
    result.channels.inapp = doc ? { ok: true } : { ok: false, reason: 'emit_failed' };
  }

  // ── Push: FCM device tokens + web-push subscriptions. ───────────────────
  if (channels.includes('push')) {
    if (!consent.marketingPush) {
      result.channels.push = { ok: false, skipped: true, reason: 'opted_out' };
    } else {
      // The deep link is deliberately duplicated across two nesting levels
      // because the two transports read it from different places:
      //
      //   • web-push  — push.service JSON.stringifies this object as-is, and
      //     service-worker.js assigns the WHOLE envelope to notification.data,
      //     then reads `data.url` / `data.type` from its ROOT. A url nested
      //     under `data` is invisible to it, so notificationclick fell back to
      //     '/' and the tap did nothing.
      //   • FCM       — firebaseAdmin.sendToUser forwards only the `data` dict,
      //     so anything at the root is dropped.
      //
      // Sending both keeps one payload correct for both channels.
      const payload = {
        title: renderTemplate(title, row),
        body: renderTemplate(body, row),
        url: deepLink,
        type: 'marketing',
        data: { ...data, kind: 'marketing', type: 'marketing', url: deepLink },
      };
      // Two independent transports are live in this app (FCM for the native
      // shell + web tokens, web-push/VAPID for browser subscriptions), so a
      // blast must hit both or PWA users silently miss it.
      const [fcm, web] = await Promise.allSettled([
        require('./firebaseAdmin').sendToUser(user._id, payload),
        pushSvc.sendPushNotification(user._id, payload),
      ]);

      // Both transports are non-throwing BY CONTRACT: they resolve with a
      // result object and swallow their own errors. So settle *status* carries
      // no delivery information — this check used to be
      // `fcm.status === 'fulfilled' || web.status === 'fulfilled'`, which is
      // unconditionally true and reported every recipient as delivered even
      // with no Firebase credentials, no VAPID keys and zero devices. Inspect
      // the resolved VALUES instead.
      const fcmRes = fcm.status === 'fulfilled' ? (fcm.value || {}) : null;
      const webRes = web.status === 'fulfilled' ? (web.value || {}) : null;

      const delivered = (fcmRes?.sent || 0) + (webRes?.sent || 0);

      // Both transports count a dead token in `failed` AND in `pruned` (they
      // report the same send as failed, then clean the token up). An uninstall
      // or cleared site data is routine churn, not a gateway rejecting our
      // traffic — counting it as a failure would keep the console's red column
      // permanently populated. Only the excess over what was pruned is real.
      const rejected = Math.max(
        0,
        ((fcmRes?.failed || 0) - (fcmRes?.pruned || 0)) +
          ((webRes?.failed || 0) - (webRes?.pruned || 0)),
      );

      const reasons = [fcmRes?.reason, webRes?.reason].filter(Boolean);
      // Collected independently of which branch below wins. A partially
      // configured environment (Firebase unset, VAPID set) is the normal case,
      // so requiring both transports to agree on 'not_configured' — or checking
      // it only after the failure branches — made the flag unreachable in
      // exactly the situation it exists to report.
      const configError = reasons.includes('not_configured');
      // Both transports report a genuine internal fault as reason 'error' with
      // no failure count, because at that point the count is unknown. It needs
      // its own branch: falling through to the skipped bucket would present an
      // outage as "expected, not an error".
      const errored = reasons.includes('error');

      if (delivered > 0) {
        result.channels.push = { ok: true, devices: delivered };
      } else {
        // Nothing reached this user. Classify by what the admin can act on
        // first: a broken transport outranks a rejection, which outranks
        // missing credentials, which outranks "this user has no device".
        const flag = configError ? { configError: true } : {};
        if (fcm.status === 'rejected' || web.status === 'rejected') {
          // Shouldn't happen given the non-throwing contracts, but a transport
          // that starts throwing must surface as a failure, not a silent skip.
          result.channels.push = {
            ...flag,
            ok: false,
            reason: 'push_failed',
            error: fcm.reason?.message || web.reason?.message || 'push_failed',
          };
        } else if (errored) {
          result.channels.push = { ...flag, ok: false, reason: 'push_error', error: 'push_error' };
        } else if (rejected > 0) {
          result.channels.push = { ...flag, ok: false, reason: 'push_rejected', error: 'push_rejected' };
        } else if (configError) {
          result.channels.push = { ok: false, skipped: true, reason: 'not_configured', configError: true };
        } else {
          result.channels.push = { ok: false, skipped: true, reason: 'no_device' };
        }
      }
    }
  }

  // ── SMS: costs money per message, so the consent gate is strict. ─────────
  if (channels.includes('sms')) {
    if (!consent.smsAlerts) {
      result.channels.sms = { ok: false, skipped: true, reason: 'opted_out' };
    } else if (!user.phone) {
      result.channels.sms = { ok: false, skipped: true, reason: 'no_phone' };
    } else {
      try {
        // sms.service throws on failure (unlike whatsapp.service) — catch so
        // one bad number never aborts the rest of the blast.
        await smsSvc.sendSms(
          user.phone,
          withLink(renderTemplate(smsText || body, row), links.sms),
        );
        result.channels.sms = { ok: true };
      } catch (err) {
        // Both of sms.service's thrown codes are ACCOUNT-LEVEL faults that fail
        // every recipient identically — a missing SMS_API_KEY, or the gateway
        // rejecting the whole batch for insufficient balance / an unverified
        // sender id. Reported per-user they read as "500 failed" and send the
        // admin hunting a delivery problem that is really one setting.
        //
        // Note we key on err.code, never err.message: sms.service deliberately
        // throws a sanitised end-user string (a Bengali OTP retry prompt) and
        // logs the real gateway reason server-side. That message is meaningless
        // in a marketing console, and it ends up in the audit log too.
        if (err.code === 'sms_not_configured') {
          result.channels.sms = { ok: false, skipped: true, reason: 'not_configured', configError: true };
        } else if (err.code === 'sms_rejected') {
          result.channels.sms = { ok: false, reason: 'sms_rejected', configError: true };
        } else {
          result.channels.sms = { ok: false, reason: err.code || 'sms_failed', detail: err.message };
        }
      }
    }
  }

  // ── WhatsApp: an approved template, or free text from our own number. ───
  if (channels.includes('whatsapp')) {
    if (!consent.whatsappOptIn) {
      result.channels.whatsapp = { ok: false, skipped: true, reason: 'not_opted_in' };
    } else if (!user.phone) {
      result.channels.whatsapp = { ok: false, skipped: true, reason: 'no_phone' };
    } else if (user.__waCapped) {
      // Past the per-blast ceiling — see WHATSAPP_MAX_PER_BLAST. Reported, not
      // silently dropped, so the admin knows to send the remainder.
      result.channels.whatsapp = { ok: false, skipped: true, reason: 'blast_cap' };
    } else {
      // TWO WAYS TO SEND, and which one is legal depends on the provider.
      //
      //   'template' — Meta rejects free-form text outside the 24-hour
      //     customer-service window, so a blast through the Cloud API MUST name
      //     a template whose wording Meta already approved. Variables are
      //     positional ({{1}}, {{2}}… in that approved template).
      //   'text' — OpenWA sends from our own WhatsApp number over WhatsApp Web.
      //     There are no templates to approve there (only their NAME ever
      //     reaches us, which is why this used to skip every recipient), so the
      //     copy is written in the composer and sent as text. The opt-in gate
      //     above is what keeps this from being spam, and whatsapp.service's
      //     throttle is what keeps the number from being banned for it.
      const mode = whatsapp?.mode === 'text' ? 'text' : 'template';

      let res;
      if (mode === 'text') {
        res = await waSvc.sendWhatsAppMessage(user.phone, {
          body: withLink(renderTemplate(whatsapp?.body || body, row), links.whatsapp),
        });
      } else {
        const params = (whatsapp?.params || []).map((p) => ({
          type: 'text',
          text: renderTemplate(p, row),
        }));
        res = await waSvc.sendWhatsAppMessage(user.phone, {
          // Optional-chained: the controller guarantees a template name in this
          // mode, but a programmatic caller that skipped it should get one
          // clean 'whatsapp_failed' per recipient, not a TypeError thrown
          // inside the batch.
          template: whatsapp?.template,
          languageCode: whatsapp?.languageCode || 'en',
          components: params.length ? [{ type: 'body', parameters: params }] : undefined,
        });
      }
      // whatsapp.service reports an unconfigured provider as skipped, which the
      // console otherwise renders as "the user opted out" — so a WhatsApp
      // integration that was never set up looks like healthy consent filtering.
      // Keep it in the skipped bucket (nothing was charged, nothing failed) but
      // mark it as a config problem.
      //
      // `res.error` is NOT always a code. whatsapp.service returns one of the
      // stable codes below for the cases it recognises, but a transport failure
      // resolves with `error: err.message` — free text like
      // "connect ECONNREFUSED 127.0.0.1:1", or an axios message carrying a URL.
      // That value ends up as a KEY in the per-channel `reasons` tally, which is
      // rendered in the console and written to the audit log, so an unbounded
      // string there means one tally row per distinct error text and a reason
      // the UI has no copy for. Collapse anything unrecognised to a single code
      // and keep the original as `detail`.
      const rawReason = res.error || 'whatsapp_failed';
      const reason = WHATSAPP_REASONS.has(rawReason) ? rawReason : 'whatsapp_failed';
      result.channels.whatsapp = res.success
        ? { ok: true, messageId: res.messageId || null }
        : {
            ok: false,
            skipped: !!res.skipped,
            reason,
            ...(reason !== rawReason ? { detail: String(rawReason).slice(0, 200) } : {}),
            ...(rawReason === 'not_configured' ? { configError: true } : {}),
          };
    }
  }

  return result;
}

/**
 * Send one offer to a filtered audience or an explicit list of user ids.
 *
 * @param {object} opts
 *   channels   string[]  subset of CHANNELS
 *   title      string    in-app / push heading
 *   body       string    in-app / push body
 *   smsText    string    SMS body (falls back to `body`)
 *   whatsapp   object    { mode:'text'|'template', body?, template?, languageCode?, params[] }
 *   targetPath string    in-app destination for the tap — PRE-VALIDATED by the
 *                        controller against utils/campaignTargets.js
 *   adminId    ObjectId  who sent it, recorded on the short links
 *   userIds    string[]  explicit recipients — wins over `filters`
 *   filters    object    same shape as listAudience's query
 * @returns {Promise<{sent:object, attempted:number, capped:boolean, results:object[]}>}
 */
async function sendOffer(opts = {}) {
  const channels = (opts.channels || []).filter((c) => CHANNELS.includes(c));
  const { tierByUser, paidIds, byTier } = await loadTierIndex();
  const targetPath = opts.targetPath || DEFAULT_OFFER_URL;

  let query;
  if (Array.isArray(opts.userIds) && opts.userIds.length) {
    query = { _id: { $in: opts.userIds } };
  } else {
    const f = opts.filters || {};
    const tierIds = f.tier === 'plus' || f.tier === 'pro' ? byTier[f.tier] : [];
    query = buildAudienceFilter(f, { tierIds, paidIds });
  }

  // Banned accounts never receive marketing — they're mid-enforcement, and a
  // promo landing in a banned user's inbox reads as a system that doesn't
  // know its own state.
  query.isBanned = { $ne: true };

  const recipients = await User.find(query)
    .select('name phone email preferences deviceTokens')
    .limit(MAX_RECIPIENTS + 1)
    .lean();

  const capped = recipients.length > MAX_RECIPIENTS;
  const targets = capped ? recipients.slice(0, MAX_RECIPIENTS) : recipients;
  for (const u of targets) u.__tier = tierByUser.get(String(u._id)) || 'free';

  // Everyone past the WhatsApp ceiling is flagged now rather than filtered out,
  // so they still receive the OTHER channels of the same campaign and appear in
  // the WhatsApp tally as skipped/'blast_cap' instead of vanishing.
  const waOverflow = Math.max(0, targets.length - WHATSAPP_MAX_PER_BLAST);
  if (channels.includes('whatsapp') && waOverflow > 0) {
    for (const u of targets.slice(WHATSAPP_MAX_PER_BLAST)) u.__waCapped = true;
  }

  // ── Mint the trackable links, one per text channel ───────────────────────
  // In-app and push don't need one: they navigate inside the app and their tap
  // is already attributable. SMS and WhatsApp have nothing but the text, so the
  // link IS the call to action — and its click count is the only evidence the
  // campaign worked. A failed mint degrades to the full URL rather than
  // stopping a send that is about to cost money.
  const links = {};
  for (const ch of ['sms', 'whatsapp']) {
    if (!channels.includes(ch)) continue;
    // A Meta template's wording is fixed on Meta's side, so there is nowhere to
    // put our link — minting one would record a campaign link that was never
    // sent and drag the click rate down with a phantom audience.
    if (ch === 'whatsapp' && opts.whatsapp?.mode !== 'text') continue;
    const audienceForChannel = ch === 'whatsapp'
      ? Math.min(targets.length, WHATSAPP_MAX_PER_BLAST)
      : targets.length;
    const minted = await campaignLinks.mint({
      targetPath,
      campaign: opts.title || '',
      channel: ch,
      createdBy: opts.adminId || null,
      audienceSize: audienceForChannel,
    });
    links[ch] = minted ? minted.url : `${publicAppBaseUrl()}${targetPath}`;
  }

  const results = [];
  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map((u) => deliverToUser(u, { ...opts, channels, url: targetPath, links })),
    );
    settled.forEach((s, idx) => {
      if (s.status === 'fulfilled') results.push(s.value);
      else {
        results.push({
          userId: String(batch[idx]._id),
          name: batch[idx].name,
          phone: batch[idx].phone,
          channels: {},
          error: s.reason?.message || 'delivery_failed',
        });
      }
    });
  }

  // Per-channel tallies so the admin sees "SMS: 40 sent, 12 skipped (opted
  // out), 3 failed" rather than a single opaque success count.
  //
  // `reasons` breaks the skipped/failed buckets down by cause, and
  // `configError` flags a channel whose gateway is not set up in this
  // environment. Both exist because the aggregate numbers alone were actively
  // misleading: "0 sent, 500 skipped" reads as "everybody opted out" whether the
  // cause is consent or a missing API key.
  const sent = {};
  for (const ch of channels) {
    sent[ch] = { ok: 0, skipped: 0, failed: 0, configError: false, reasons: {} };
    for (const r of results) {
      const c = r.channels?.[ch];
      if (!c) continue;
      if (c.ok) sent[ch].ok += 1;
      else if (c.skipped) sent[ch].skipped += 1;
      else sent[ch].failed += 1;

      if (c.configError) sent[ch].configError = true;
      // Keyed on `reason` ONLY — a stable, closed set of codes the console maps
      // to copy. Never on a gateway's free-text message: those are unbounded,
      // sometimes localised end-user prose, and this object is rendered in the
      // UI and persisted to the audit log.
      const why = c.ok ? null : c.reason;
      if (why) sent[ch].reasons[why] = (sent[ch].reasons[why] || 0) + 1;
    }
  }

  return {
    sent,
    attempted: targets.length,
    capped,
    maxRecipients: MAX_RECIPIENTS,
    // The destination and the links that carry it, echoed back so the console
    // can show the admin exactly what recipients received — and so the audit
    // log records the link that was actually sent, not the one we meant to.
    targetPath,
    links,
    whatsappOverflow: channels.includes('whatsapp') ? waOverflow : 0,
    whatsappMaxPerBlast: WHATSAPP_MAX_PER_BLAST,
    results,
  };
}

module.exports = {
  installStateOf,
  isInstalled,
  consentOf,
  buildAudienceFilter,
  loadTierIndex,
  listAudience,
  channelCapabilities,
  sendOffer,
  renderTemplate,
  withLink,
  CHANNELS,
  MAX_RECIPIENTS,
  NATIVE_PLATFORMS,
  INSTALLED_CLAUSES,
  WHATSAPP_MAX_PER_BLAST,
};
