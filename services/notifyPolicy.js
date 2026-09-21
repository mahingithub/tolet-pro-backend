'use strict';

/**
 * notifyPolicy — decides HOW a notification is allowed to reach a phone.
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * `preferences.notifications` has been on the User model, editable from the
 * settings screen, for a long time: a push master switch, per-topic switches
 * (messages / bookings / payments / inquiries / visits), a Do-Not-Disturb
 * window, a marketing opt-in. Before this file, the ONLY code on the server
 * that read any of it was marketing.service.js.
 *
 * So the promotional blasts — the one thing a user has the least reason to want
 * — were the only notifications that honoured the user's settings, and every
 * transactional push ignored them completely. Turning "push" off in settings
 * changed nothing. A Do-Not-Disturb window from 22:00 to 08:00 changed nothing.
 * That is not a missing feature, it is a setting that lies, and a user who
 * discovers a switch does not work reaches for the OS-level mute instead —
 * which is how an app loses the ability to tell a landlord about unpaid rent.
 *
 * WHAT IT DOES NOT DO
 *
 * It never suppresses the in-app notification row. Preferences are about
 * INTERRUPTION, not about withholding information: a tenant who muted push
 * still needs the overdue notice waiting in the bell when they open the app.
 * Everything here decides push delivery only.
 *
 * DO-NOT-DISTURB DOWNGRADES, IT DOES NOT DROP
 *
 * Inside the quiet window the push is still sent, on a LOW-importance channel:
 * it appears in the shade, silently, with no banner and no vibration. Dropping
 * it instead would be simpler and worse — the event still happened, and the
 * user would wake up with no record of it in the one place they look. This way
 * the night is quiet and the morning is complete.
 */

const CHANNEL = {
  CALLS:    'toletpro_calls',
  RENT:     'toletpro_rent',
  MESSAGES: 'toletpro_messages',
  ACTIVITY: 'toletpro_activity',
  QUIET:    'toletpro_quiet',
  // '_v2' is load-bearing, not a version stamp. Android channel importance is
  // immutable once created, so raising promos from LOW (no banner, no sound, no
  // lock-screen wake) to HIGH was impossible under the old id on any device
  // that had already run the app. The new id is the migration. It MUST stay in
  // lockstep with NotificationChannels.java — an id the app never created falls
  // back to the manifest default and quietly loses its banner again.
  PROMOS:   'toletpro_promos_v2',
};

/**
 * type → { topic, channel }
 *
 * `topic` names the per-user switch in preferences.notifications that governs
 * it; null means "no switch governs this" (account/security/system messages,
 * which only the push master switch can silence).
 *
 * `channel` is the Android notification channel — see
 * android/app/src/main/java/com/toletpro/app/NotificationChannels.java. The ids
 * MUST match that file; an unknown id falls back to the manifest default, which
 * silently costs the notification its heads-up banner.
 *
 * Every `type` in models/Notification.js should appear here. One that doesn't
 * still delivers — it just lands on the default ACTIVITY channel with no topic
 * switch, which is the safe direction to fail in.
 */
const POLICY = {
  // Money. The reason this app is installed.
  payment:          { topic: 'payments', channel: CHANNEL.RENT },
  receipt:          { topic: 'payments', channel: CHANNEL.RENT },
  rent_invoice:     { topic: 'payments', channel: CHANNEL.RENT },
  rent_overdue:     { topic: 'payments', channel: CHANNEL.RENT },
  rent_receipt:     { topic: 'payments', channel: CHANNEL.RENT },
  rent_updated:     { topic: 'payments', channel: CHANNEL.RENT },
  rent_due_summary: { topic: 'payments', channel: CHANNEL.RENT },

  // A person is waiting for a reply.
  message:      { topic: 'messages', channel: CHANNEL.MESSAGES },
  message_new:  { topic: 'messages', channel: CHANNEL.MESSAGES },

  inquiry:        { topic: 'inquiries', channel: CHANNEL.ACTIVITY },
  inquiry_new:    { topic: 'inquiries', channel: CHANNEL.ACTIVITY },
  inquiry_status: { topic: 'inquiries', channel: CHANNEL.ACTIVITY },

  booking:           { topic: 'bookings', channel: CHANNEL.ACTIVITY },
  tenant_onboarding: { topic: 'bookings', channel: CHANNEL.ACTIVITY },
  service_request:   { topic: 'bookings', channel: CHANNEL.ACTIVITY },

  property: { topic: 'priceAlerts', channel: CHANNEL.ACTIVITY },
  review:   { topic: null,          channel: CHANNEL.ACTIVITY },

  // Account-level. Not governed by a topic switch: a user who muted "bookings"
  // has not asked to stop hearing that their KYC was rejected.
  system:          { topic: null, channel: CHANNEL.ACTIVITY },
  support_ticket:  { topic: null, channel: CHANNEL.ACTIVITY },
  support_message: { topic: null, channel: CHANNEL.ACTIVITY },
  kyc_tenant:      { topic: null, channel: CHANNEL.ACTIVITY },
  kyc_landlord:    { topic: null, channel: CHANNEL.ACTIVITY },

  // The only promotional type, and the only one on a channel the user can mute
  // in system settings without losing anything they need. That mutability is
  // what earns it a HIGH-importance channel: the user has a one-tap way out
  // that costs them no rent alert, no message and no call.
  marketing: { topic: 'marketingPush', channel: CHANNEL.PROMOS },

  // The new-account feature tour (utils/featureTips.js). Governed by the SAME
  // switch as marketing and routed to the same mutable channel, deliberately:
  // however useful the tour is, it is us advertising our own product to someone
  // who did not ask, and a user who turned promotional push off has already
  // answered the question. Giving it its own ungoverned topic would be a way of
  // not taking no for an answer.
  feature_tip: { topic: 'marketingPush', channel: CHANNEL.PROMOS },
};

const TZ = process.env.CRON_TZ || 'Asia/Dhaka';

// Minutes since local midnight in the app's timezone.
//
// Server time is not the user's time — this app runs on Render, whose boxes are
// UTC, and Dhaka is UTC+6. A DND window of 22:00–08:00 evaluated against a UTC
// clock is silent from 4pm to 2am local, which mutes the early evening and
// buzzes at 2am: worse than having no quiet hours at all.
function localMinutes(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

function parseHHMM(s, fallback) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!match) return fallback;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return fallback;
  return h * 60 + m;
}

/**
 * Is `now` inside a quiet window?
 *
 * Handles the OVERNIGHT case, which is the only one anybody actually
 * configures: from 22:00 until 08:00 means from > until, so the window is the
 * UNION of [from, midnight) and [midnight, until) rather than the empty range a
 * naive `from <= t && t < until` produces. Getting this wrong makes the feature
 * appear to do nothing for the exact setting everyone chooses.
 */
function inQuietWindow(win, now = new Date()) {
  if (!win || !win.enabled) return false;
  const from = parseHHMM(win.from, 22 * 60);
  const until = parseHHMM(win.until, 8 * 60);
  if (from === until) return false; // zero-width window — treat as off
  const t = localMinutes(now);
  return from < until ? (t >= from && t < until) : (t >= from || t < until);
}

/**
 * Decide how (and whether) to push a notification of `type` to `user`.
 *
 * @param {object} user  a User doc or lean object — needs `preferences` only
 * @param {string} type  a Notification `type`
 * @returns {{ push: boolean, channelId: string, silent: boolean, reason?: string }}
 */
function decide(user, type, now = new Date()) {
  const entry = POLICY[type] || { topic: null, channel: CHANNEL.ACTIVITY };
  const prefs = (user && user.preferences) || {};
  const notif = prefs.notifications || {};

  // Master switch. `!== false` rather than a truthy check: the field defaults
  // to true and is absent on documents written before the schema gained it, and
  // those users should keep receiving push, not silently lose it.
  if (notif.push === false) {
    return { push: false, channelId: entry.channel, silent: true, reason: 'push_off' };
  }

  if (entry.topic && notif[entry.topic] === false) {
    return { push: false, channelId: entry.channel, silent: true, reason: `topic_off:${entry.topic}` };
  }

  // NOTE: marketing used to return early right here, pinned to silent:true, so
  // an offer could never buzz. That is no longer the policy — promos now ride
  // the normal path below and arrive with a banner on the HIGH-importance
  // promos_v2 channel.
  //
  // The early return is gone rather than merely flipped, and that matters: it
  // sat ABOVE the quiet-hours check, so marketing was the ONE type that never
  // consulted DND. Harmless while it was silent anyway; a loud promo at 02:00
  // is the single worst notification this app could send, and it would have
  // been the only one the quiet window did not catch. Falling through means
  // marketing is subject to the same DND downgrade as everything else.

  // The landlord's own quiet hours are scoped to inquiry pings by the schema
  // ("Suppress inquiry pings during these hours"), so they apply there and
  // nowhere else. The general DND window below covers everything.
  const landlordQuiet = entry.topic === 'inquiries'
    && inQuietWindow((prefs.landlord || {}).quietHours, now);

  if (landlordQuiet || inQuietWindow(notif.dnd, now)) {
    return { push: true, channelId: CHANNEL.QUIET, silent: true, reason: 'dnd' };
  }

  return { push: true, channelId: entry.channel, silent: false };
}

module.exports = {
  decide,
  inQuietWindow,   // exported for tests — the overnight case is the whole point
  localMinutes,
  CHANNEL,
  POLICY,
};
