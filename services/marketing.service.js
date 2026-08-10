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
const { tierOf } = require('../utils/subscriptionTier');
const notificationSvc = require('./notification.service');
const pushSvc = require('./push.service');
const smsSvc = require('./sms.service');
const waSvc = require('./whatsapp.service');

// A deviceTokens entry with one of these platforms was registered by the
// Capacitor shell (services/nativePush.js sends Capacitor.getPlatform()), so
// its presence means the native app is installed on a real device. 'web' comes
// from services/fcmService.js — a browser tab or an installed PWA, which we
// deliberately do NOT count as "app installed".
const NATIVE_PLATFORMS = ['android', 'ios'];

/**
 * Install state for one user, derived purely from registered push tokens.
 *
 *   'native' → has an android/ios token: the app is installed
 *   'web'    → only browser tokens: reachable by push, but no app
 *   'none'   → no tokens at all
 *
 * Caveat the console surfaces to the admin: this only sees users who GRANTED
 * notification permission, so 'none' means "no push token", not proof that
 * the app is absent. It undercounts rather than overcounts, which is the safe
 * direction for a marketing decision.
 */
function installStateOf(user) {
  const tokens = Array.isArray(user?.deviceTokens) ? user.deviceTokens : [];
  if (!tokens.length) return 'none';
  const hasNative = tokens.some((t) => NATIVE_PLATFORMS.includes(String(t?.platform || '').toLowerCase()));
  return hasNative ? 'native' : 'web';
}

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

  if (tier === 'free') filter._id = { $nin: paidIds };
  else if (tier === 'plus' || tier === 'pro') filter._id = { $in: tierIds };

  if (installed === 'true') {
    filter.deviceTokens = { $elemMatch: { platform: { $in: NATIVE_PLATFORMS } } };
  } else if (installed === 'false') {
    filter.deviceTokens = { $not: { $elemMatch: { platform: { $in: NATIVE_PLATFORMS } } } };
  }

  if (whatsapp === 'true') filter['preferences.notifications.whatsappOptIn'] = true;
  else if (whatsapp === 'false') filter['preferences.notifications.whatsappOptIn'] = { $ne: true };

  if (search && String(search).trim()) {
    // Escape regex metacharacters — an admin typing "+880" must not blow up
    // the query. Mirrors the same guard in admin.controller.js → listUsers.
    const rx = new RegExp(String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { phone: rx }, { email: rx }];
  }

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

  const [users, total] = await Promise.all([
    User.find(filter)
      .select('name phone email avatar roles createdAt lastLoginAt isBanned deviceTokens preferences')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
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
      appInstalled: install === 'native',
      installState: install,
      deviceCount: Array.isArray(u.deviceTokens) ? u.deviceTokens.length : 0,
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
    User.countDocuments({ deviceTokens: { $elemMatch: { platform: { $in: NATIVE_PLATFORMS } } } }),
    User.countDocuments({ 'preferences.notifications.whatsappOptIn': true }),
  ]);

  return {
    rows,
    total,
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
async function deliverToUser(user, { channels, title, body, smsText, whatsapp, data }) {
  const uid = String(user._id);
  const consent = consentOf(user);
  const row = { name: user.name, tier: user.__tier || 'free' };
  const result = { userId: uid, name: user.name, phone: user.phone, channels: {} };

  // ── In-app: a Notification row + socket push. Always permitted. ──────────
  if (channels.includes('inapp')) {
    const doc = await notificationSvc.emit({
      userId: user._id,
      type: 'marketing',
      title: renderTemplate(title, row),
      body: renderTemplate(body, row),
      data: { ...data, kind: 'marketing' },
      // emit()'s own FCM fan-out is suppressed here: 'push' is a separate
      // channel with its own consent gate, and letting the in-app write also
      // push would deliver to users who opted out of marketing push.
      skipPush: true,
    });
    result.channels.inapp = doc ? { ok: true } : { ok: false, error: 'emit_failed' };
  }

  // ── Push: FCM device tokens + web-push subscriptions. ───────────────────
  if (channels.includes('push')) {
    if (!consent.marketingPush) {
      result.channels.push = { ok: false, skipped: true, reason: 'opted_out' };
    } else {
      const payload = {
        title: renderTemplate(title, row),
        body: renderTemplate(body, row),
        data: { ...data, kind: 'marketing' },
      };
      // Two independent transports are live in this app (FCM for the native
      // shell + web tokens, web-push/VAPID for browser subscriptions), so a
      // blast must hit both or PWA users silently miss it.
      const [fcm, web] = await Promise.allSettled([
        require('./firebaseAdmin').sendToUser(user._id, payload),
        pushSvc.sendPushNotification(user._id, payload),
      ]);
      const ok = fcm.status === 'fulfilled' || web.status === 'fulfilled';
      result.channels.push = ok
        ? { ok: true }
        : { ok: false, error: fcm.reason?.message || web.reason?.message || 'push_failed' };
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
        await smsSvc.sendSms(user.phone, renderTemplate(smsText || body, row));
        result.channels.sms = { ok: true };
      } catch (err) {
        result.channels.sms = { ok: false, error: err.message };
      }
    }
  }

  // ── WhatsApp: pre-approved template only. ───────────────────────────────
  if (channels.includes('whatsapp')) {
    if (!consent.whatsappOptIn) {
      result.channels.whatsapp = { ok: false, skipped: true, reason: 'not_opted_in' };
    } else if (!user.phone) {
      result.channels.whatsapp = { ok: false, skipped: true, reason: 'no_phone' };
    } else {
      // Meta rejects free-form text outside the 24-hour customer-service
      // window, so a marketing blast MUST name an approved template. Body
      // variables are positional ({{1}}, {{2}}… in the approved template).
      const params = (whatsapp?.params || []).map((p) => ({
        type: 'text',
        text: renderTemplate(p, row),
      }));
      const res = await waSvc.sendWhatsAppMessage(user.phone, {
        template: whatsapp.template,
        languageCode: whatsapp.languageCode || 'en',
        components: params.length ? [{ type: 'body', parameters: params }] : undefined,
      });
      result.channels.whatsapp = res.success
        ? { ok: true, messageId: res.messageId || null }
        : { ok: false, skipped: !!res.skipped, error: res.error || 'whatsapp_failed' };
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
 *   whatsapp   object    { template, languageCode, params[] }
 *   userIds    string[]  explicit recipients — wins over `filters`
 *   filters    object    same shape as listAudience's query
 * @returns {Promise<{sent:object, attempted:number, capped:boolean, results:object[]}>}
 */
async function sendOffer(opts = {}) {
  const channels = (opts.channels || []).filter((c) => CHANNELS.includes(c));
  const { tierByUser, paidIds, byTier } = await loadTierIndex();

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

  const results = [];
  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(batch.map((u) => deliverToUser(u, { ...opts, channels })));
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
  const sent = {};
  for (const ch of channels) {
    sent[ch] = { ok: 0, skipped: 0, failed: 0 };
    for (const r of results) {
      const c = r.channels?.[ch];
      if (!c) continue;
      if (c.ok) sent[ch].ok += 1;
      else if (c.skipped) sent[ch].skipped += 1;
      else sent[ch].failed += 1;
    }
  }

  return { sent, attempted: targets.length, capped, maxRecipients: MAX_RECIPIENTS, results };
}

module.exports = {
  installStateOf,
  consentOf,
  buildAudienceFilter,
  loadTierIndex,
  listAudience,
  sendOffer,
  renderTemplate,
  CHANNELS,
  MAX_RECIPIENTS,
  NATIVE_PLATFORMS,
};
