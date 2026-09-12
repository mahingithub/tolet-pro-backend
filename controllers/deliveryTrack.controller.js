'use strict';

/**
 * DeliveryTrack Controller — three audiences, three gates.
 * ─────────────────────────────────────────────────────────────────────────────
 *   MERCHANT  POST /api/merchant/requests/:id/track      make a link
 *             GET  /api/merchant/requests/:id/track      watch it
 *             POST /api/merchant/requests/:id/track/end  stop it
 *
 *   COURIER   GET  /api/delivery/:token                  what am I delivering
 *             POST /api/delivery/:token/ping             where I am now
 *
 *   TENANT    GET  /api/service-requests/:id/track       watch it
 *
 * The courier's two routes are the unusual ones: no login, no account, and the
 * token in the URL is the whole credential. That is a deliberate trade, and
 * models/DeliveryTrack.js sets out why — a delivery boy is a teenager on a
 * bicycle with a borrowed phone who changes every few weeks, and any design
 * requiring him to hold an account is a design nobody uses.
 *
 * What keeps it safe is what the token CANNOT do: it is scoped to one order, it
 * exposes no tenant identity beyond a destination point, it cannot move the
 * order's status, and it expires the same day. The worst a stranger with a
 * forwarded link can do is lie about where a bicycle is.
 */

const crypto = require('crypto');
const mongoose = require('mongoose');

const DeliveryTrack = require('../models/DeliveryTrack');
const ServiceRequest = require('../models/ServiceRequest');
const Provider = require('../models/Provider');
const ApiError = require('../utils/ApiError');
const { providerAppBaseUrl } = require('../utils/inviteToken');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Only a live order is worth following. Creating a link for a `placed` order
// would have the courier leaving before the shop accepted it.
const TRACKABLE = ['accepted', 'on_the_way'];

/**
 * Where the courier's page lives.
 *
 * On the PROVIDER app's origin, not the tenant app's: the page is a tool for
 * the shop's own delivery boy, and it has no business sitting on the domain
 * tenants browse. Built in one place so the link a shopkeeper pastes into
 * WhatsApp and the route the app serves can never drift apart.
 */
function trackUrl(token) {
  return `${providerAppBaseUrl()}/d/${token}`;
}

async function loadOwnedRequest(id, merchant) {
  if (!mongoose.isValidObjectId(id)) {
    throw ApiError.notFound('অর্ডার পাওয়া যায়নি।', { code: 'request_not_found' });
  }
  const doc = await ServiceRequest.findById(id);
  if (!doc) throw ApiError.notFound('অর্ডার পাওয়া যায়নি।', { code: 'request_not_found' });

  // Ownership re-derived from the request's provider, never taken from the
  // body — the same rule as everywhere else on the merchant surface.
  const provider = await Provider.findOne({
    _id: doc.providerId, ownerMerchantId: merchant._id,
  }).select('geo name');
  if (!provider) throw ApiError.notFound('অর্ডার পাওয়া যায়নি।', { code: 'request_not_found' });

  return { doc, provider };
}

// ═════════════════════════════════════════════════════════════════════════════
// MERCHANT
// ═════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/merchant/requests/:id/track
 *
 * Idempotent: a shopkeeper who taps the button twice gets the SAME link back,
 * because the first one is already in a WhatsApp thread and minting a second
 * would silently kill it.
 *
 * The raw token is returned EXACTLY ONCE per link — only its hash is stored —
 * so the response carries the full URL and the client is responsible for
 * getting it to the courier.
 */
exports.create = asyncH(async (req, res) => {
  const { doc, provider } = await loadOwnedRequest(req.params.id, req.merchant);

  if (!TRACKABLE.includes(doc.status)) {
    throw ApiError.badRequest('অর্ডার গ্রহণ করার পরে ট্র্যাকিং লিংক তৈরি করুন।', {
      code: 'not_trackable',
      details: { status: doc.status },
    });
  }

  const dest = doc.deliverTo || {};
  if (dest.lat == null || dest.lng == null) {
    // Said plainly rather than creating a link that tracks toward nothing. An
    // order placed before the tenant shared a location has an address in text
    // and no point to aim at.
    throw ApiError.badRequest('এই অর্ডারে ক্রেতার লোকেশন নেই — ফোন করে জেনে নিন।', {
      code: 'no_destination',
    });
  }

  const existing = await DeliveryTrack.findOne({
    requestId: doc._id,
    status: { $in: ['pending', 'live', 'arrived'] },
    expiresAt: { $gt: new Date() },
  });
  if (existing) {
    // The raw token is gone — only its hash was kept — so a reissue cannot
    // rebuild the old URL. Say so rather than returning a link that is not the
    // one already in his WhatsApp thread.
    return res.json({
      track: existing.toWatcher(),
      reused: true,
      url: null,
    });
  }

  const token = crypto.randomBytes(24).toString('base64url');
  const coords = provider.geo?.coordinates || [];

  const track = await DeliveryTrack.create({
    requestId: doc._id,
    providerId: doc.providerId,
    tokenHash: DeliveryTrack.hashToken(token),
    destination: {
      lat: dest.lat,
      lng: dest.lng,
      // A label, not the full address. The courier has that from his boss; the
      // tracker page only needs something to put under the pin.
      label: String(dest.label || dest.area || dest.thana || '').slice(0, 120),
    },
    // [lng, lat] on the provider — the one ordering in this codebase that runs
    // the opposite way round to everything else.
    origin: { lat: coords[1] ?? null, lng: coords[0] ?? null },
    expiresAt: new Date(Date.now() + DeliveryTrack.TTL_HOURS * 3600_000),
  });

  return res.status(201).json({
    track: track.toWatcher(),
    url: trackUrl(token),
    // Ready to paste into WhatsApp — the app he is going to use anyway.
    shareText: `অর্ডার #${doc.code} — ডেলিভারির লোকেশন চালু করুন:\n${trackUrl(token)}`,
  });
});

/** GET /api/merchant/requests/:id/track */
exports.getForMerchant = asyncH(async (req, res) => {
  const { doc } = await loadOwnedRequest(req.params.id, req.merchant);

  const track = await DeliveryTrack.findOne({ requestId: doc._id })
    .sort({ createdAt: -1 });
  if (!track) return res.json({ track: null });

  return res.json({ track: track.toWatcher() });
});

/** POST /api/merchant/requests/:id/track/end — the link stops working. */
exports.end = asyncH(async (req, res) => {
  const { doc } = await loadOwnedRequest(req.params.id, req.merchant);

  const track = await DeliveryTrack.findOne({
    requestId: doc._id,
    status: { $in: ['pending', 'live', 'arrived'] },
  }).sort({ createdAt: -1 });
  if (!track) return res.json({ track: null });

  track.status = 'ended';
  track.endedAt = new Date();
  // Expired as well as ended, so a forwarded link cannot be revived by any
  // later code path that only checks the status.
  track.expiresAt = new Date();
  await track.save();

  return res.json({ track: track.toWatcher() });
});

// ═════════════════════════════════════════════════════════════════════════════
// COURIER — no login, token in the URL
// ═════════════════════════════════════════════════════════════════════════════

async function loadByToken(token) {
  const raw = String(token || '');
  if (raw.length < 16) {
    throw ApiError.notFound('লিংকটি কাজ করছে না।', { code: 'bad_link' });
  }

  const track = await DeliveryTrack.findOne({ tokenHash: DeliveryTrack.hashToken(raw) });
  // One message for "never existed", "already ended" and "expired". A courier
  // cannot act on the difference, and distinguishing them would turn this into
  // an oracle for guessing tokens.
  if (!track || track.expiresAt <= new Date() || track.status === 'ended') {
    throw ApiError.notFound('লিংকটির মেয়াদ শেষ।', { code: 'link_expired' });
  }
  return track;
}

/**
 * GET /api/delivery/:token
 *
 * What the courier's page needs to render, and nothing else: where to go, how
 * far it is, and whether the link is still alive. No tenant name, no phone, no
 * order contents — he is carrying a bag, not reading an invoice.
 */
exports.getByToken = asyncH(async (req, res) => {
  const track = await loadByToken(req.params.token);

  return res.json({
    track: track.toWatcher(),
    // Opens the phone's own maps app, which is what he will actually navigate
    // with — this page is for REPORTING his position, not for replacing Google
    // Maps on a cheap Android.
    navigateUrl: `https://www.google.com/maps/dir/?api=1&destination=${track.destination.lat},${track.destination.lng}`,
  });
});

/**
 * POST /api/delivery/:token/ping   { lat, lng, accuracy?, device? }
 *
 * Called every few seconds while the page is open. Cheap on purpose: one
 * document, one push onto a capped array, no lookups.
 */
exports.ping = asyncH(async (req, res) => {
  const track = await loadByToken(req.params.token);

  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)
    || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw ApiError.badRequest('লোকেশন সঠিক নয়।', { code: 'bad_point' });
  }

  const accuracy = Number(req.body?.accuracy);
  track.addPoint({
    lat, lng, accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null,
  });
  if (!track.device && req.body?.device) {
    track.device = String(req.body.device).slice(0, 120);
  }
  await track.save();

  return res.json({ track: track.toWatcher() });
});

/** POST /api/delivery/:token/done — the courier says he has handed it over. */
exports.finishByToken = asyncH(async (req, res) => {
  const track = await loadByToken(req.params.token);

  // `arrived`, NOT the order's `completed`. A courier saying he is there is a
  // hint; only the shopkeeper closes an order, because a phone near an address
  // is not proof anything changed hands or any money was paid.
  track.status = 'arrived';
  await track.save();

  return res.json({ track: track.toWatcher() });
});

// ═════════════════════════════════════════════════════════════════════════════
// TENANT
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/service-requests/:id/track
 *
 * The tenant watches the same dot the shopkeeper does. They are the one waiting
 * at the door; withholding it would be strange.
 */
exports.getForTenant = asyncH(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw ApiError.notFound('অর্ডার পাওয়া যায়নি।', { code: 'request_not_found' });
  }

  const doc = await ServiceRequest.findById(req.params.id).select('tenantId');
  if (!doc || String(doc.tenantId) !== String(req.user._id)) {
    throw ApiError.notFound('অর্ডার পাওয়া যায়নি।', { code: 'request_not_found' });
  }

  const track = await DeliveryTrack.findOne({ requestId: doc._id }).sort({ createdAt: -1 });
  return res.json({ track: track ? track.toWatcher() : null });
});

exports.trackUrl = trackUrl;
exports.TRACKABLE = TRACKABLE;
