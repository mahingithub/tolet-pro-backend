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

  // Verification-friendly log: shows the function WAS invoked with the right
  // recipient + payload (full number in dev, redacted in production).
  console.log(`[whatsapp] → ${logPhone(msisdn)} via ${cfg.provider}: "${summary}"`);

  try {
    const { messageId, raw } =
      cfg.provider === 'twilio'
        ? await sendViaTwilio(msisdn, tpl)
        : await sendViaMeta(msisdn, tpl);

    console.log(`[whatsapp] sent ok → ${logPhone(msisdn)} (id: ${messageId || 'n/a'})`);
    return { success: true, messageId, raw };
  } catch (err) {
    // Log the real gateway reason for ops, but swallow it for the caller so
    // background jobs never break on a WhatsApp failure.
    const detail = err.response?.data || err.message;
    console.error(`[whatsapp] send failed → ${logPhone(msisdn)}:`, detail);
    return { success: false, error: err.message, details: detail };
  }
}

module.exports = { sendWhatsAppMessage, isConfigured, normalizeMsisdn };
