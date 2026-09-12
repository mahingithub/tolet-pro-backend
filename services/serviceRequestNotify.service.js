'use strict';

/**
 * serviceRequestNotify.service — telling the two sides an order moved.
 * ─────────────────────────────────────────────────────────────────────────────
 * There is no admin in this loop, so nobody is watching it on anyone's behalf.
 * If a message does not land, the order simply sits there: the shopkeeper never
 * knew, and the tenant waits on a shop that was never rung.
 *
 * ─── THE TWO SIDES GET DIFFERENT LADDERS, BECAUSE THEY ARE DIFFERENT PEOPLE ───
 *
 *   TENANT    is a User. notification.emit() already writes the bell row, pushes
 *             to their devices and emits over the socket, so that IS the ladder
 *             for them. A phone message is added only for the states where
 *             silence is the failure — declined, expired — because those are the
 *             ones where they are sitting waiting for food that is not coming.
 *
 *   MERCHANT  is NOT a User and has no row in the Notification collection or
 *             socket identity, but he does have devices — his own collection,
 *             MerchantPushSubscription. His ladder is:
 *
 *               1. WEB PUSH to every device he registered. Free, instant, and
 *                  it lands on the lock screen of the phone already in his
 *                  hand.
 *               2. WhatsApp, when push reached NOTHING — no device registered,
 *                  every endpoint dead, or VAPID not configured at all.
 *               3. SMS, when WhatsApp could not deliver either.
 *
 *             The order matters for cost as much as for speed: WhatsApp is
 *             throttled and SMS is metered, so the free channel is tried first
 *             and the paid ones only when it delivered to nobody. A PARTIAL
 *             push success still counts as delivered — one of his three phones
 *             buzzing is enough, and messaging him again is how a shopkeeper
 *             concludes the app is noisy and turns it off.
 *
 * ─── WHY NOTHING HERE THROWS ─────────────────────────────────────────────────
 * Every function is best-effort and swallows its own failures. A WhatsApp
 * outage must never be able to fail the order that was already written — the
 * ServiceRequest is the durable record, and the message is a courtesy on top
 * of it. Callers deliberately do not await the merchant ladder.
 *
 * Sends pass through whatsapp.service's shared throttle (per-recipient and
 * per-account daily caps), so a burst of orders can never become a blast.
 */

const notifications = require('./notification.service');
const whatsapp = require('./whatsapp.service');
const push = require('./push.service');
const env = require('../config/env');

// Optional SMS fallback — absent in installs that don't ship the provider.
let sms = null;
try { sms = require('./sms.service'); } catch { sms = null; }

const APP_NAME = 'TO-LET PRO';

const money = (n) => `৳${Number(n || 0).toLocaleString('en-IN')}`;

/**
 * WhatsApp, then SMS if WhatsApp could not deliver.
 *
 * Never throws and never blocks the caller. Returns a promise so tests can
 * await it; production callers fire and forget.
 */
async function toPhone(phone, body, { label = 'service' } = {}) {
  const to = String(phone || '').trim();
  if (to.length < 8) {
    console.warn(`[${label}] no phone to reach — message skipped`);
    return { success: false, skipped: true };
  }

  try {
    const wa = await whatsapp.sendWhatsAppMessage(to, { body });
    if (wa && wa.success) return wa;

    // Only now does SMS cost anything. A shopkeeper on WhatsApp should not be
    // paying us for an SMS he did not need.
    if (env.smsApiKey && sms) return await sms.sendSms(to, body);
    return wa || { success: false };
  } catch (err) {
    console.warn(`[${label}] phone notify failed:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Push to his devices, and say whether ANY of them took it.
 *
 * `sent > 0` is the bar, not `failed === 0`: one phone buzzing is enough, and
 * falling back to a paid SMS because his second, dead device 404'd would be
 * paying twice to say one thing.
 *
 * Never throws — a push gateway having a bad minute must not stop the WhatsApp
 * fallback from running.
 */
async function toDevices(merchantId, payload, { label = 'service' } = {}) {
  if (!merchantId) return { sent: 0 };
  try {
    return await push.sendMerchantPush(merchantId, payload);
  } catch (err) {
    console.warn(`[${label}] merchant push failed:`, err.message);
    return { sent: 0, error: err.message };
  }
}

/** One line naming what was ordered, for a message with no screen behind it. */
function itemSummary(doc) {
  const items = Array.isArray(doc.items) ? doc.items : [];
  if (!items.length) return '';
  const head = items.slice(0, 3).map((i) => `${i.label} ×${i.qty}`).join(', ');
  return items.length > 3 ? `${head} (+${items.length - 3})` : head;
}

// ─────────────────────────────────────────────────────────────────────────────
// MERCHANT side
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A new order landed. This is the message the whole marketplace depends on:
 * an order the shopkeeper never hears about expires in 30 minutes and counts
 * against him as a no-show, which is the worst possible outcome for someone
 * who did nothing wrong.
 *
 * `providerPhone` is read off the request, not the Provider document — it was
 * snapshotted at placement, so an order still reaches the number that was live
 * when it was placed.
 */
async function merchantNewRequest(doc, { ownerMerchantId } = {}) {
  const items = itemSummary(doc);
  const title = `নতুন ${doc.kind === 'order' ? 'অর্ডার' : 'অনুরোধ'} — #${doc.code}`;

  // Rung 1: his devices.
  const pushed = await toDevices(ownerMerchantId, {
    type: 'service_request',
    title,
    body: [items, doc.quotedTotal ? money(doc.quotedTotal) : null]
      .filter(Boolean).join(' · ') || 'অ্যাপে দেখুন',
    requestId: String(doc._id),
    code: doc.code,
    // Deep-links straight to the order rather than dropping him on a list.
    url: '/',
  }, { label: 'svc-merchant' });

  if (pushed.sent > 0) return pushed;

  // Rung 2+3: the phone. Reached only when push landed on NO device — see the
  // header note on why a partial success is enough.
  const body = [
    title,
    items ? `${items}${doc.quotedTotal ? ` · ${money(doc.quotedTotal)}` : ''}` : null,
    doc.deliverTo?.addressText ? `ঠিকানা: ${doc.deliverTo.addressText}` : null,
    doc.tenantPhone ? `ফোন: ${doc.tenantPhone}` : null,
    // The deadline, said out loud. He is being measured against it.
    '৩০ মিনিটের মধ্যে অ্যাপে গ্রহণ বা বাতিল করুন।',
    `— ${APP_NAME}`,
  ].filter(Boolean).join('\n');

  return toPhone(doc.providerPhone, body, { label: 'svc-merchant' });
}

/** The tenant called it off. Sent so he does not pack an order nobody wants. */
async function merchantCancelled(doc, reason, { ownerMerchantId } = {}) {
  const title = `অর্ডার #${doc.code} বাতিল করেছেন ক্রেতা।`;

  const pushed = await toDevices(ownerMerchantId, {
    type: 'service_request',
    title,
    body: reason || 'অ্যাপে দেখুন',
    requestId: String(doc._id),
    code: doc.code,
    url: '/',
  }, { label: 'svc-merchant' });

  if (pushed.sent > 0) return pushed;

  const body = [title, reason ? `কারণ: ${reason}` : null, `— ${APP_NAME}`]
    .filter(Boolean).join('\n');
  return toPhone(doc.providerPhone, body, { label: 'svc-merchant' });
}

// ─────────────────────────────────────────────────────────────────────────────
// TENANT side
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What each state change says to the tenant.
 *
 * `phone: true` marks the states where silence IS the failure — the tenant is
 * waiting on something that is not coming, and an in-app bell they may not
 * look at for an hour is not enough.
 *
 * EVERY body names the provider, because `#code` alone does not identify an
 * order to a tenant. The code is unique per (provider, day), not globally, so
 * a tenant with an open order at two shops on the same day can be handed the
 * same four digits twice — and the merchant's side of that ambiguity does not
 * exist, since he only ever sees his own.
 */
const TENANT_COPY = {
  accepted: (d) => ({
    title: 'অর্ডার গ্রহণ করা হয়েছে',
    body: `${d.providerName} আপনার অর্ডার #${d.code} গ্রহণ করেছেন।`,
  }),
  on_the_way: (d) => ({
    title: 'পথে আছে',
    body: `${d.providerName} আপনার অর্ডার #${d.code} নিয়ে রওনা দিয়েছেন।`,
  }),
  completed: (d) => ({
    title: 'অর্ডার সম্পন্ন',
    body: `${d.providerName} আপনার অর্ডার #${d.code} সম্পন্ন করেছেন${d.finalTotal ? ` — ${money(d.finalTotal)}` : ''}।`,
  }),
  declined: (d, reason) => ({
    title: 'অর্ডার নেওয়া যায়নি',
    body: `${d.providerName} অর্ডার #${d.code} নিতে পারেননি।${reason ? ` কারণ: ${reason}` : ''}`,
    phone: true,
  }),
  // Either side may have cancelled, so the shop is named as the order's OWNER
  // ("X-এর অর্ডার"), never as the actor — a tenant who cancelled it himself
  // must not be told his shopkeeper did.
  cancelled: (d, reason) => ({
    title: 'অর্ডার বাতিল',
    body: `${d.providerName}-এর অর্ডার #${d.code} বাতিল হয়েছে।${reason ? ` কারণ: ${reason}` : ''}`,
    phone: true,
  }),
  expired: (d) => ({
    title: 'কোনো উত্তর আসেনি',
    // Named plainly. "No answer" is the platform's failure, not the tenant's,
    // and pretending otherwise is how somebody stops trusting the order button.
    body: `${d.providerName} সময়মতো উত্তর দেননি, তাই অর্ডার #${d.code} বাতিল হয়েছে। অন্য দোকান দেখুন।`,
    phone: true,
  }),
};

/**
 * Tell the tenant their order moved.
 *
 * Returns the Notification document (or null) so a caller can assert on it;
 * the phone rung, when there is one, is fire-and-forget behind it.
 */
async function tenantStatusChanged(doc, { reason = '' } = {}) {
  const build = TENANT_COPY[doc.status];
  if (!build) return null;

  const copy = build(doc, reason);

  const notif = await notifications.emit({
    userId: doc.tenantId,
    type: 'service_request',
    title: copy.title,
    body: copy.body,
    // Enough for the client to deep-link straight to the order rather than
    // dropping the tenant on a list and making them find it.
    data: {
      requestId: String(doc._id),
      code: doc.code,
      status: doc.status,
      providerId: String(doc.providerId),
      category: doc.category,
    },
  });

  if (copy.phone && doc.tenantPhone) {
    // Not awaited by design: a slow gateway must not hold up the HTTP response
    // the merchant is waiting on.
    toPhone(doc.tenantPhone, `${copy.body}\n— ${APP_NAME}`, { label: 'svc-tenant' })
      .catch(() => null);
  }

  return notif;
}

module.exports = {
  toDevices,
  merchantNewRequest,
  merchantCancelled,
  tenantStatusChanged,
  toPhone,
  itemSummary,
  TENANT_COPY,
};
