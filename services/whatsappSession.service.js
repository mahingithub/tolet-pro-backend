'use strict';

/**
 * whatsappSession.service.js — can the OpenWA session actually send right now?
 * ──────────────────────────────────────────────────────────────────────────
 * whatsapp.service.isConfigured() only proves the three OPENWA_* env vars are
 * non-empty. Whether the gateway's session is QR-linked and `ready` is runtime
 * state — and between 2026-09-11 and 2026-09-20 it was not: the session sat at
 * `qr_ready`, every reminder failed (sendWhatsAppMessage never throws), and the
 * first anyone heard of it was a landlord asking why a reminder never came.
 *
 * This module makes that state visible:
 *   • sessionStatus()  — a cached (60s) probe of GET /api/sessions/{id}, shown
 *                        in /healthz under whatsapp.session. Bounded by a wait
 *                        budget, so a hung gateway cannot slow /healthz.
 *   • the monitor      — probes every minute and tells every admin, in-app,
 *                        once when the session has been down 15 minutes and
 *                        once when it comes back. Never over WhatsApp: that is
 *                        the channel being reported as down.
 *   • name fallback    — a QR relink often creates a NEW session, and the
 *                        pinned OPENWA_SESSION_ID then 404s while the gateway
 *                        dashboard cheerfully shows "Connected". When that
 *                        happens the session named OPENWA_SESSION_NAME is looked
 *                        up, sends go to it (activeSessionId()), and the status
 *                        names the id the env var should be changed to.
 *
 * Nothing here throws: a monitor that can crash what it monitors is worse than
 * none. State is IN-MEMORY and per instance, like the send throttle — except
 * the outage flag, which is re-read at boot from the last alert so a deploy
 * mid-outage neither re-alerts nor loses the "recovered" message.
 */

const axios = require('axios');
const env = require('../config/env');

const cfg = env.whatsapp || {};

const CACHE_MS = 60_000;
const PROBE_TIMEOUT_MS = 4_000;
const ALERT_AFTER_MS = 15 * 60_000;
const ALERT_KIND = 'whatsapp_session';
const TZ = process.env.CRON_TZ || 'Asia/Dhaka';

const isOpenWA = () => cfg.provider === 'openwa';
const configured = () => Boolean(cfg.openwaApiUrl && cfg.openwaApiKey && cfg.openwaSessionId);

let snapshot = null;    // last probe result
let snapshotAt = 0;
let inflight = null;    // the probe in progress, shared by every concurrent caller
let resolvedId = null;  // the named session's id, while the pinned one 404s
let outage = { since: null, alerted: false };
let monitorTimer = null;
let lastLoggedState = null;

/** The session id sends should use: the pinned one, unless it has gone stale
 *  and a session with the configured name was found in its place. */
function activeSessionId() {
  return resolvedId || cfg.openwaSessionId;
}

// /healthz is unauthenticated — same redaction as whatsapp.service's logPhone.
function maskPhone(phone) {
  const s = String(phone || '');
  if (!s || !env.isProd || s.length <= 4) return s || null;
  return `${'*'.repeat(s.length - 4)}${s.slice(-4)}`;
}

function request(path) {
  return axios.get(`${cfg.openwaApiUrl}/api/sessions${path}`, {
    headers: { 'X-API-Key': cfg.openwaApiKey },
    timeout: PROBE_TIMEOUT_MS,
  });
}

/** The gateway's view of one session, trimmed to what diagnoses an outage.
 *  `lastActive` matters most: after a LOGOUT, lastError stays null and only
 *  lastActive shows when the session died. */
function describe(s = {}) {
  return {
    state: s.status || 'unknown',
    name: s.name || null,
    phone: maskPhone(s.phone),
    lastActive: s.lastActive || null,
    lastError: s.lastError ? String(s.lastError).slice(0, 200) : null,
    restriction: s.restriction ? { kind: s.restriction.kind, code: s.restriction.code } : null,
  };
}

function hintFor(state) {
  switch (state) {
    case 'ready':          return null;
    case 'qr_ready':       return 'The number is unlinked — rescan the QR on the gateway dashboard.';
    case 'disconnected':   return 'The session dropped; the gateway may reconnect on its own.';
    case 'initializing':
    case 'authenticating': return 'The session is starting up.';
    case 'created':        return 'The session was created but never started.';
    default:               return `The gateway reports "${state}" — see lastError.`;
  }
}

/** A probe that never reached a session: bad key, or no answer at all. */
function failure(err) {
  const status = err.response?.status;
  if (status === 401 || status === 403) {
    return { state: 'unauthorized', lastError: `HTTP ${status}`, hint: 'The gateway rejected OPENWA_API_KEY.' };
  }
  return {
    state: 'unreachable',
    lastError: status ? `HTTP ${status}` : String(err.code || err.message || 'error'),
    hint: 'The gateway did not answer.',
  };
}

async function byName(base) {
  const name = cfg.openwaSessionName;
  const gone = `OPENWA_SESSION_ID ${base.sessionId} does not exist on the gateway`;
  if (!name) return { ...base, state: 'not_found', hint: `${gone}. Set it to the current session id.` };

  let sessions;
  try {
    const { data } = await request('');
    sessions = Array.isArray(data) ? data : [];
  } catch (err) {
    // Keep any earlier resolution: the named session may well still be right.
    return { ...base, state: 'not_found', lastError: failure(err).lastError, hint: `${gone}, and listing sessions failed.` };
  }

  // Names are unique on the gateway, so there is at most one match.
  const match = sessions.find((s) => s && s.name === name && s.id);
  if (!match) {
    resolvedId = null;
    return { ...base, state: 'not_found', name, hint: `${gone}, and no session is named "${name}". Relink one and set OPENWA_SESSION_ID to its id.` };
  }

  if (resolvedId !== match.id) {
    console.warn(
      `[whatsapp] OPENWA_SESSION_ID ${base.sessionId} not found — sending through session ` +
      `"${name}" (${match.id}) instead. Set OPENWA_SESSION_ID=${match.id}.`,
    );
  }
  resolvedId = match.id;
  const s = describe(match);
  const fix = `OPENWA_SESSION_ID is stale — set it to ${match.id} (session "${name}"); sends use that id until then.`;
  return {
    ...base,
    ...s,
    activeSessionId: match.id,
    expectedSessionId: match.id,
    hint: [fix, hintFor(s.state)].filter(Boolean).join(' '),
  };
}

async function probe() {
  const pinned = cfg.openwaSessionId;
  const base = { sessionId: pinned, activeSessionId: activeSessionId(), expectedSessionId: null };
  try {
    const { data } = await request(`/${encodeURIComponent(pinned)}`);
    resolvedId = null;
    const s = describe(data);
    return { ...base, ...s, activeSessionId: pinned, hint: hintFor(s.state) };
  } catch (err) {
    const status = err.response?.status;
    // 404 is "no such session"; 400 is "not even a UUID" — the gateway checks
    // the id's shape before looking it up. Either way the pinned id is wrong.
    if (status === 404 || status === 400) return byName(base);
    return { ...base, ...failure(err) };
  }
}

function finish(snap) {
  const out = { ...snap, ok: snap.state === 'ready', checkedAt: new Date().toISOString() };
  // Transitions only — one line per change, not one per minute.
  if (out.state !== lastLoggedState) {
    lastLoggedState = out.state;
    const line = `[whatsapp] session ${out.activeSessionId}: ${out.state}${out.hint ? ` — ${out.hint}` : ''}`;
    if (out.ok) console.log(line); else console.warn(line);
  }
  return out;
}

/** Probe now, sharing any probe already in flight. Always resolves. */
function refresh() {
  if (!inflight) {
    inflight = probe()
      .catch((err) => ({ sessionId: cfg.openwaSessionId, activeSessionId: activeSessionId(), state: 'error', lastError: err.message }))
      .then((snap) => {
        snapshot = finish(snap);
        snapshotAt = Date.now();
        return snapshot;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

function present(snap) {
  return {
    provider: 'openwa',
    ...snap,
    outageSince: outage.since ? new Date(outage.since).toISOString() : null,
    adminAlerted: outage.alerted,
  };
}

/**
 * Session state for /healthz. Cached for 60s; past that, waits at most
 * `maxWaitMs` for a fresh probe and otherwise answers with the previous one
 * (`stale: true`) — or `checking` if there has never been one — while the
 * probe finishes in the background.
 */
async function sessionStatus({ maxWaitMs = PROBE_TIMEOUT_MS, now = Date.now() } = {}) {
  if (!isOpenWA()) return { provider: cfg.provider, state: 'not_applicable', ok: null };
  if (!configured()) return { provider: 'openwa', state: 'not_configured', ok: false };
  if (snapshot && now - snapshotAt < CACHE_MS) return present(snapshot);

  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(resolve, maxWaitMs, null); });
  try {
    const snap = await Promise.race([refresh(), late]);
    if (snap) return present(snap);
    return present(snapshot
      ? { ...snapshot, stale: true }
      : { sessionId: cfg.openwaSessionId, activeSessionId: activeSessionId(), state: 'checking', ok: null });
  } finally {
    clearTimeout(timer);
  }
}

// ─── Admin alerts ────────────────────────────────────────────────────────────

const when = (ms) => new Date(ms).toLocaleString('en-GB', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' });

function duration(ms) {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ${min % 60} min`;
  return `${Math.floor(h / 24)} days`;
}

async function alertAdmins(event, snap, since, now) {
  const label = `"${snap.name || cfg.openwaSessionName || snap.activeSessionId}"`;
  const down = event === 'down';
  const title = down ? 'WhatsApp is down — reminders are not going out' : 'WhatsApp is back';
  const body = down
    ? `Gateway session ${label} has been "${snap.state}" since ${when(since)}. Every WhatsApp reminder fails until it is fixed. ${snap.hint || ''}`.trim()
    : `Gateway session ${label} is ready again after ${duration(now - since)} down (since ${when(since)}). WhatsApp sends are working.`;

  if (down) console.error(`[whatsapp] ALERT ${title}: ${body}`);
  else console.log(`[whatsapp] ${title}: ${body}`);

  try {
    // In-app bell + push to every admin — the existing admin-alert path.
    await require('./notification.service').emitToAdmins({
      type: 'system',
      title,
      body,
      data: {
        kind: ALERT_KIND,
        event,
        state: snap.state,
        since: new Date(since).toISOString(),
        sessionId: cfg.openwaSessionId,
        expectedSessionId: snap.expectedSessionId || null,
      },
    });
  } catch (err) {
    console.warn('[whatsapp] session alert failed:', err.message);
  }
}

/** Advance the outage clock with one probe result; alert on the edges. */
async function track(snap, now) {
  if (snap.ok) {
    const was = outage;
    outage = { since: null, alerted: false };
    // A blip shorter than the threshold was never announced, so nothing to undo.
    if (was.alerted) await alertAdmins('recovered', snap, was.since, now);
    return;
  }
  if (!outage.since) outage.since = now;
  if (!outage.alerted && now - outage.since >= ALERT_AFTER_MS) {
    outage.alerted = true; // before the await, so an overlapping tick can't send it twice
    await alertAdmins('down', snap, outage.since, now);
  }
}

/** One monitor tick: a fresh probe, then the outage clock. */
async function checkSession({ now = Date.now() } = {}) {
  if (!isOpenWA() || !configured()) return null;
  const snap = await refresh();
  await track(snap, now);
  return snap;
}

/**
 * Pick up an outage that was announced before this process started. Without
 * it, a deploy mid-outage would re-announce the outage 15 minutes later, and a
 * session that recovered across a restart would never get its "back" message.
 */
async function restoreOutage() {
  try {
    const { Types } = require('mongoose');
    const Notification = require('../models/Notification');
    // Bounded by _id so this is an index range, not a scan of every notification.
    const floor = Types.ObjectId.createFromTime(Math.floor((Date.now() - 30 * 86_400_000) / 1000));
    const last = await Notification.findOne({ _id: { $gte: floor }, type: 'system', 'data.kind': ALERT_KIND })
      .sort({ _id: -1 })
      .select('data createdAt')
      .lean();
    if (last?.data?.event === 'down') {
      outage = { since: Date.parse(last.data.since) || new Date(last.createdAt).getTime(), alerted: true };
    }
  } catch (err) {
    console.warn('[whatsapp] could not restore session outage state:', err.message);
  }
}

/**
 * Start the per-minute probe. Called once from server.js start(), after Mongo
 * connects. Its first tick is also the boot-time name resolution: a pinned id
 * that 404s is swapped for the named session before the first reminder goes out.
 */
function startSessionMonitor({ intervalMs = CACHE_MS } = {}) {
  if (monitorTimer || !isOpenWA() || !configured()) return false;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await checkSession(); } catch (err) { console.warn('[whatsapp] session check failed:', err.message); }
    finally { busy = false; }
  };
  monitorTimer = setInterval(tick, intervalMs);
  monitorTimer.unref?.();
  restoreOutage().then(tick);
  return true;
}

function stopSessionMonitor() {
  clearInterval(monitorTimer);
  monitorTimer = null;
}

module.exports = {
  sessionStatus,
  checkSession,
  activeSessionId,
  startSessionMonitor,
  stopSessionMonitor,
  restoreOutage,
  ALERT_AFTER_MS,
  CACHE_MS,
  // Tests only — module state would otherwise leak between cases.
  __reset: () => {
    snapshot = null; snapshotAt = 0; inflight = null; resolvedId = null;
    outage = { since: null, alerted: false }; lastLoggedState = null;
    stopSessionMonitor();
  },
};
