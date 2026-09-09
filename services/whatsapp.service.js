'use strict';

/**
 * whatsapp.service.js
 * ──────────────────────────────────────────────────────────────────────────
 * A thin, provider-agnostic wrapper for sending WhatsApp reminders (rent
 * due/overdue, new invoices, visit reminders) straight to a user's WhatsApp
 * number.
 *
 * Supported providers (set WHATSAPP_PROVIDER in .env):
 *   • 'meta'   → WhatsApp Business Cloud API (graph.facebook.com)  [default]
 *   • 'twilio' → Twilio WhatsApp (api.twilio.com)
 *   • 'openwa' → self-hosted WhatsApp Web gateway (your own number)
 *
 * TEXT vs TEMPLATE, per provider. Every reminder in this app (rent, visits,
 * lease expiry, invoices, late fees) sends plain TEXT, which all three
 * providers handle. Only the admin marketing blast sends a Meta TEMPLATE, and
 * only 'meta' can deliver one — a template's approved wording lives on Meta's
 * servers and this side only ever holds its NAME, so the other two providers
 * have nothing to render. Both degrade instead of inventing a body: Twilio
 * sends an empty text, OpenWA skips the send outright.
 *
 * Design principles (mirrors sms.service.js but SAFER for background jobs):
 *   • FIRE-AND-FORGET SAFE — sendWhatsAppMessage NEVER throws. It resolves to
 *     a result object ({ success, skipped?, error?, ... }) so a WhatsApp
 *     hiccup can never crash a cron run or a visit-reminder sweep. Callers
 *     that want to react can inspect the result; callers that don't can
 *     ignore it.
 *   • NO-OP WHEN UNCONFIGURED — if the chosen provider's keys are missing the
 *     call is skipped (with a one-line warning), so the whole app still runs
 *     locally / in CI without WhatsApp credentials.
 *
 * Public API:
 *   sendWhatsAppMessage(phone, templateData) → Promise<result>
 *     phone         E.164 ("+8801712345678") or local — normalised here.
 *     templateData  one of:
 *       • a string                              → plain text message
 *       • { body }                              → plain text message
 *       • { template, languageCode, components} → Meta template message
 *                                                 (components optional)
 */

const axios = require('axios');
const env = require('../config/env');

const cfg = env.whatsapp || {};

/**
 * Normalise a phone number to the international form WITHOUT a leading '+'
 * (Meta's Cloud API wants "8801712345678"). Twilio wants the '+' back, which
 * we re-add at the Twilio call site.
 *
 * Handles the common Bangladesh formats so real-world stored numbers work
 * regardless of how they were entered:
 *   "+8801712345678" → "8801712345678"   (E.164 — the app's canonical form)
 *   "8801712345678"  → "8801712345678"   (already international)
 *   "01712345678"    → "8801712345678"   (BD local → prepend 880, drop 0)
 *   "008801712345678"→ "8801712345678"   ("00" international prefix)
 */
function normalizeMsisdn(phone) {
  // Strip everything that isn't a digit ('+', spaces, dashes, parens, ...).
  let s = String(phone || '').replace(/\D/g, '');
  if (!s) return '';
  // "00" international dialling prefix → drop it.
  if (s.startsWith('00')) s = s.slice(2);
  // Bangladesh local "01XXXXXXXXX" (11 digits) → "880" + number w/o leading 0.
  if (s.startsWith('0') && s.length === 11) s = `880${s.slice(1)}`;
  return s;
}

/**
 * Phone number for logs. In production we redact all but the last 4 digits so
 * we never write full PII to logs. In non-prod (dev / test) we log the full
 * number so the "verify the correct phone number was used" check is easy.
 */
function logPhone(msisdn) {
  const s = String(msisdn || '');
  if (!env.isProd) return s;
  if (s.length <= 4) return s;
  return `${'*'.repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`;
}

/** True when the ACTIVE provider has the credentials it needs to send. */
function isConfigured() {
  if (cfg.provider === 'twilio') {
    return Boolean(cfg.twilioAccountSid && cfg.twilioAuthToken && cfg.twilioFrom);
  }
  if (cfg.provider === 'openwa') {
    // Credentials only — whether the session is actually QR-linked and `ready`
    // is a runtime state the gateway answers with (409), not something we can
    // know here without a network call on every isConfigured() caller.
    return Boolean(cfg.openwaApiUrl && cfg.openwaApiKey && cfg.openwaSessionId);
  }
  // default: meta
  return Boolean(cfg.accessToken && cfg.phoneNumberId);
}

/**
 * Coerce the flexible `templateData` arg into a normalised descriptor:
 *   { kind: 'text', body }                       — plain text
 *   { kind: 'template', name, languageCode, components } — Meta template
 */
function normalizeTemplateData(templateData) {
  if (templateData == null) return { kind: 'text', body: '' };
  if (typeof templateData === 'string') return { kind: 'text', body: templateData };

  if (templateData.template) {
    return {
      kind: 'template',
      name: templateData.template,
      languageCode: templateData.languageCode || cfg.defaultLang || 'en',
      components: Array.isArray(templateData.components) ? templateData.components : undefined,
    };
  }
  // { body } or { text } → text message
  return { kind: 'text', body: templateData.body || templateData.text || '' };
}

// ─── Meta WhatsApp Business Cloud API ────────────────────────────────────────
async function sendViaMeta(msisdn, tpl) {
  const url = `https://graph.facebook.com/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`;

  const payload = tpl.kind === 'template'
    ? {
        messaging_product: 'whatsapp',
        to: msisdn,
        type: 'template',
        template: {
          name: tpl.name,
          language: { code: tpl.languageCode },
          ...(tpl.components ? { components: tpl.components } : {}),
        },
      }
    : {
        messaging_product: 'whatsapp',
        to: msisdn,
        type: 'text',
        text: { preview_url: false, body: tpl.body },
      };

  const resp = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${cfg.accessToken}`,
      'Content-Type': 'application/json',
    },
    timeout: 15_000,
  });

  // Meta returns { messaging_product, contacts:[...], messages:[{ id }] }
  const messageId = resp.data?.messages?.[0]?.id || null;
  return { messageId, raw: resp.data };
}

// ─── Twilio WhatsApp ─────────────────────────────────────────────────────────
async function sendViaTwilio(msisdn, tpl) {
  // Twilio only sends free-form text this way; templates require its Content
  // API. For our reminder use-case a text body is what we need. If a template
  // descriptor is passed we fall back to its (optional) body.
  const body = tpl.kind === 'template' ? (tpl.body || '') : tpl.body;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${cfg.twilioAccountSid}/Messages.json`;
  const form = new URLSearchParams({
    From: `whatsapp:${cfg.twilioFrom.startsWith('+') ? cfg.twilioFrom : `+${cfg.twilioFrom}`}`,
    To: `whatsapp:+${msisdn}`,
    Body: body,
  });

  const resp = await axios.post(url, form.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    auth: { username: cfg.twilioAccountSid, password: cfg.twilioAuthToken },
    timeout: 15_000,
  });

  return { messageId: resp.data?.sid || null, raw: resp.data };
}

// ─── OpenWA (self-hosted WhatsApp Web gateway) ───────────────────────────────
async function sendViaOpenWA(msisdn, tpl) {
  // OpenWA addresses an individual chat by its WhatsApp id: "<msisdn>@c.us"
  // (groups use "@g.us", which reminders never target).
  const chatId = `${msisdn}@c.us`;
  const url = `${cfg.openwaApiUrl}/api/sessions/${cfg.openwaSessionId}/messages/send-text`;

  const resp = await axios.post(
    url,
    { chatId, text: tpl.body },
    {
      headers: {
        'X-API-Key': cfg.openwaApiKey,
        'Content-Type': 'application/json',
      },
      timeout: 15_000,
    },
  );

  // OpenWA returns { messageId, timestamp } — NOT Meta's { messages: [{ id }] }
  // and not a bare `id`.
  return { messageId: resp.data?.messageId || null, raw: resp.data };
}

// ─── Throttle ────────────────────────────────────────────────────────────────
// WhatsApp Web is not an API with a published quota; it is a consumer account
// being automated, and the way an account gets banned is by looking like a bot:
// dozens of identical messages fired in the same second, or one number hammered
// all day. Both are exactly what a rent-reminder sweep does by default — the
// 09:00 cron previously fired every send in parallel with no spacing at all.
//
// So every send in this process funnels through here, whatever called it (cron,
// the landlord's Remind button, visit reminders, lease expiry, invoices). One
// choke point means a new caller cannot forget to be careful.
//
// Three limits, all env-tunable:
//   • a minimum gap between sends, with jitter so the spacing isn't machine-
//     regular either
//   • a per-recipient daily cap — nobody gets nagged more than this many times
//   • a whole-account daily cap — the blast radius if something loops
//
// IN-MEMORY, therefore PER INSTANCE and reset by a restart. That is honest for
// the current single-instance deploy and still removes the burst pattern that
// actually triggers bans; if the backend is ever scaled to several instances,
// this has to move to Redis to stay a real ceiling.
const throttle = {
  minGapMs:     cfg.minGapMs,
  perNumberDay: cfg.maxPerNumberPerDay,
  perDay:       cfg.maxPerDay,
  maxQueue:     cfg.maxQueue,
};

let sendChain  = Promise.resolve();
let queueDepth = 0;
let lastSentAt = 0;
const counters = { day: '', total: 0, byNumber: new Map() };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Day boundary in the timezone rent actually runs on, so "today's cap" matches
// the landlord's day rather than UTC's.
function today() {
  return new Date().toLocaleDateString('en-CA', { timeZone: process.env.CRON_TZ || 'Asia/Dhaka' });
}

function rollDay() {
  const d = today();
  if (counters.day !== d) {
    counters.day = d;
    counters.total = 0;
    counters.byNumber.clear();
  }
}

/** Would this send breach a daily cap? Checked BEFORE queueing, so a capped
 *  message fails fast instead of occupying a slot it can never use. */
function capBreach(msisdn) {
  rollDay();
  if (throttle.perDay && counters.total >= throttle.perDay) return 'daily_cap';
  if (throttle.perNumberDay && (counters.byNumber.get(msisdn) || 0) >= throttle.perNumberDay) {
    return 'recipient_cap';
  }
  return null;
}

function countSend(msisdn) {
  rollDay();
  counters.total += 1;
  counters.byNumber.set(msisdn, (counters.byNumber.get(msisdn) || 0) + 1);
}

/**
 * Run `fn` on the shared send queue, spaced by minGapMs (±40% jitter).
 *
 * The queue is bounded: past maxQueue waiters we refuse rather than accept work
 * we would only get to in an hour — a caller that is told "rate_limited" now can
 * react, one left waiting silently cannot.
 */
function schedule(fn) {
  if (queueDepth >= throttle.maxQueue) return Promise.reject(Object.assign(new Error('queue_full'), { rateLimited: true }));
  queueDepth += 1;

  const run = sendChain.then(async () => {
    const jitter = throttle.minGapMs * (0.8 + Math.random() * 0.4);
    const wait = Math.max(0, lastSentAt + jitter - Date.now());
    if (wait > 0) await sleep(wait);
    lastSentAt = Date.now();
    return fn();
  });

  // The chain must survive a failed send, or one rejection deadlocks every
  // later message behind it.
  sendChain = run.then(() => {}, () => {}).finally(() => { queueDepth -= 1; });
  return run;
}

/**
 * Send a WhatsApp message. NEVER throws — always resolves to a result object.
 *
 * @param {string} phone         recipient phone (E.164 or local)
 * @param {(string|object)} templateData  see module docblock
 * @returns {Promise<{success:boolean, skipped?:boolean, messageId?:string|null, error?:string}>}
 */
async function sendWhatsAppMessage(phone, templateData) {
  const msisdn = normalizeMsisdn(phone);
  const tpl = normalizeTemplateData(templateData);
  const summary = tpl.kind === 'template' ? `template:${tpl.name}` : (tpl.body || '').slice(0, 80);

  if (!msisdn || msisdn.length < 8) {
    console.warn(`[whatsapp] skip — no valid recipient phone (got "${phone}")`);
    return { success: false, skipped: true, error: 'invalid_recipient' };
  }

  if (!isConfigured()) {
    // Not an error — WhatsApp simply isn't set up in this environment.
    console.warn(
      `[whatsapp] not configured (provider=${cfg.provider}) — would send to ` +
      `${logPhone(msisdn)}: "${summary}"`,
    );
    return { success: false, skipped: true, error: 'not_configured' };
  }

  // A Meta template cannot survive the trip through OpenWA: only its NAME
  // reaches us, so the best we could put in the chat is the literal string
  // "promo_eid_2026" — spam, sent to a real tenant, that also reports back as
  // a successful delivery. Skip instead, so the marketing console shows the
  // blast as skipped-for-config rather than silently mis-sending it.
  if (cfg.provider === 'openwa' && tpl.kind === 'template' && !tpl.body) {
    console.warn(
      `[whatsapp] skip — provider 'openwa' cannot send Meta template ` +
      `"${tpl.name}" (set WHATSAPP_PROVIDER=meta for marketing blasts)`,
    );
    return { success: false, skipped: true, error: 'template_unsupported' };
  }

  // Refused BEFORE queueing: a message over its cap will never be sendable
  // today, so making the caller wait in line for it would only delay the
  // answer. Reported as `skipped` — nothing failed, we chose not to send.
  const breach = capBreach(msisdn);
  if (breach) {
    console.warn(
      `[whatsapp] throttled (${breach}) → ${logPhone(msisdn)}: "${summary}" ` +
      `[today ${counters.total}/${throttle.perDay}, this number ` +
      `${counters.byNumber.get(msisdn) || 0}/${throttle.perNumberDay}]`,
    );
    return { success: false, skipped: true, error: 'rate_limited', reason: breach };
  }

  // Verification-friendly log: shows the function WAS invoked with the right
  // recipient + payload (full number in dev, redacted in production).
  console.log(`[whatsapp] → ${logPhone(msisdn)} via ${cfg.provider}: "${summary}"`);

  try {
    // Spaced out on the shared queue — see the throttle block above.
    const { messageId, raw } = await schedule(() =>
      cfg.provider === 'openwa'
        ? sendViaOpenWA(msisdn, tpl)
        : cfg.provider === 'twilio'
          ? sendViaTwilio(msisdn, tpl)
          : sendViaMeta(msisdn, tpl));

    // Counted only on a real send, so failures don't burn a tenant's daily quota.
    countSend(msisdn);

    console.log(`[whatsapp] sent ok → ${logPhone(msisdn)} (id: ${messageId || 'n/a'})`);
    return { success: true, messageId, raw };
  } catch (err) {
    if (err.rateLimited) {
      console.warn(`[whatsapp] throttled (queue_full) → ${logPhone(msisdn)}: "${summary}"`);
      return { success: false, skipped: true, error: 'rate_limited', reason: 'queue_full' };
    }
    // Log the real gateway reason for ops, but swallow it for the caller so
    // background jobs never break on a WhatsApp failure.
    const detail = err.response?.data || err.message;
    console.error(`[whatsapp] send failed → ${logPhone(msisdn)}:`, detail);
    return { success: false, error: err.message, details: detail };
  }
}

/** Current throttle state — for /healthz and tests. */
function throttleStatus() {
  rollDay();
  return {
    day: counters.day,
    sentToday: counters.total,
    dailyCap: throttle.perDay,
    perNumberCap: throttle.perNumberDay,
    minGapMs: throttle.minGapMs,
    queueDepth,
  };
}

// __resetThrottle is exported for tests only — module state would otherwise
// leak counters between cases.
module.exports = {
  sendWhatsAppMessage, isConfigured, normalizeMsisdn, throttleStatus,
  __resetThrottle: () => {
    counters.day = ''; counters.total = 0; counters.byNumber.clear();
    lastSentAt = 0; queueDepth = 0; sendChain = Promise.resolve();
  },
};
