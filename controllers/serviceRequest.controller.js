'use strict';

/**
 * ServiceRequest Controller — the order/callback loop.
 * ─────────────────────────────────────────────────────────────────────────────
 * A tenant places it, the MERCHANT answers it, and the two of them settle it
 * between themselves. No admin, no platform money, no commission.
 *
 * ─── TWO SURFACES, NOT ONE ───────────────────────────────────────────────────
 * The tenant and the merchant live in separate identity systems with separate
 * token audiences, so these handlers are exported in two groups and mounted
 * behind two different gates:
 *
 *   tenant   → /api/service-requests    (requireAuth, a User)
 *   merchant → /api/merchant/requests   (requireMerchantAuth, a Merchant)
 *
 * A single route accepting either token would need a gate that tries both —
 * exactly the kind of "fall through to the other check" logic that eventually
 * lets the wrong caller through. Two doors, each with one lock.
 *
 * ─── WHAT THE STATE MACHINE OWNS ─────────────────────────────────────────────
 * Every transition goes through `ServiceRequest.transition()`, which refuses an
 * illegal move. Nothing here sets `status` directly, so a completed order can
 * never quietly walk backwards to placed.
 */

const mongoose = require('mongoose');

const ServiceRequest = require('../models/ServiceRequest');
const ContactEvent = require('../models/ContactEvent');
const Provider = require('../models/Provider');
const ApiError = require('../utils/ApiError');
const { getCategory } = require('../config/serviceCategories');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

async function loadForTenant(id, user) {
  if (!mongoose.isValidObjectId(id)) {
    throw ApiError.notFound('অর্ডার পাওয়া যায়নি।', { code: 'request_not_found' });
  }
  const doc = await ServiceRequest.findById(id);
  if (!doc || String(doc.tenantId) !== String(user._id)) {
    throw ApiError.notFound('অর্ডার পাওয়া যায়নি।', { code: 'request_not_found' });
  }
  return doc;
}

/**
 * Load a request the CALLING MERCHANT owns — verified against his provider
 * ids, not against a provider id he sent. Trusting a `providerId` from the
 * body would let any merchant answer anybody's orders.
 */
async function loadForMerchant(id, merchant) {
  if (!mongoose.isValidObjectId(id)) {
    throw ApiError.notFound('অর্ডার পাওয়া যায়নি।', { code: 'request_not_found' });
  }
  const doc = await ServiceRequest.findById(id);
  if (!doc) throw ApiError.notFound('অর্ডার পাওয়া যায়নি।', { code: 'request_not_found' });

  const owned = await Provider.exists({ _id: doc.providerId, ownerMerchantId: merchant._id });
  if (!owned) throw ApiError.notFound('অর্ডার পাওয়া যায়নি।', { code: 'request_not_found' });

  return doc;
}

/** Move the machine, save, and answer. One path for every transition. */
async function applyTransition(doc, to, { by, byRole, reason = '', res }) {
  try {
    doc.transition(to, { by, byRole, reason });
  } catch (err) {
    if (err.code === 'illegal_transition') {
      throw ApiError.badRequest('এই অর্ডারে আর এটি করা যাবে না।', {
        code: 'illegal_transition',
        details: { from: doc.status, to },
      });
    }
    throw err;
  }

  await doc.save();
  await applyBehaviourCounters(doc);
  return res.json({ request: doc.toJSON() });
}

/**
 * Roll a closed request into the provider's behaviour counters.
 *
 * An honest decline costs him NOTHING — a shop that is out of stock and says
 * so is behaving well, and penalising it teaches providers to accept
 * everything and cancel later, which is strictly worse for the tenant. Only
 * silence and cancelling-after-accepting count.
 */
async function applyBehaviourCounters(doc) {
  const kind = doc.countsAgainstProvider();
  const inc = {};
  if (kind === 'noShow') inc.noShowCount = 1;
  if (kind === 'cancel') inc.cancelCount = 1;
  if (doc.status === 'declined') inc.declineCount = 1;   // tracked, not punished
  if (doc.status === 'completed') inc['stats.orders'] = 1;

  if (Object.keys(inc).length) {
    await Provider.updateOne({ _id: doc.providerId }, { $inc: inc });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// TENANT SURFACE  — /api/service-requests
// ═════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/service-requests
 *
 * Only `request` and `order` tier categories reach here; a `contact` category
 * (গৃহকর্মী, ইলেকট্রিশিয়ান) has no booking flow by design and the model
 * refuses one.
 */
exports.create = asyncH(async (req, res) => {
  const body = req.body || {};

  const provider = await Provider.findById(body.providerId);
  if (!provider || provider.status !== 'active') {
    throw ApiError.notFound('প্রোভাইডার পাওয়া যায়নি।', { code: 'provider_not_found' });
  }

  const cat = getCategory(provider.category);
  if (!cat || cat.interaction === 'contact') {
    throw ApiError.badRequest('এই সেবায় অর্ডার নেওয়া হয় না — সরাসরি ফোন করুন।', {
      code: 'contact_only_category',
    });
  }
  if (!provider.openNow) {
    // Better to say so now than to let it sit unanswered until it expires.
    throw ApiError.badRequest('এই মুহূর্তে বন্ধ আছে।', { code: 'provider_closed' });
  }

  // Idempotency BEFORE any write: a double tap over a flaky connection must
  // not buy two cylinders. Returns the original rather than an error the
  // client would retry again.
  const clientRequestId = body.clientRequestId ? String(body.clientRequestId).slice(0, 64) : null;
  if (clientRequestId) {
    const already = await ServiceRequest.findOne({ tenantId: req.user._id, clientRequestId });
    if (already) return res.status(200).json({ request: already.toJSON(), duplicate: true });
  }

  // Prices are FROZEN from the provider's current list. A provider who
  // re-prices tomorrow must not change what was agreed today, so the unit
  // price is read here and never re-read.
  const items = [];
  for (const raw of (Array.isArray(body.items) ? body.items : [])) {
    const field = cat.providerFields.find((f) => f.key === raw.field && f.type === 'price_rows');
    if (!field) continue;
    const row = field.rows.find((r) => r.key === raw.rowKey);
    if (!row) continue;

    const unitPrice = provider.fields?.[field.key]?.[row.key];
    if (!Number.isFinite(unitPrice)) continue;   // not stocked — silently skipped

    items.push({
      field: field.key,
      rowKey: row.key,
      label: row.bn,
      unit: row.unit ? row.unit.bn : '',
      qty: Math.max(1, Math.min(999, Number(raw.qty) || 1)),
      unitPrice,
    });
  }

  if (!items.length) {
    throw ApiError.badRequest('অন্তত একটি জিনিস বেছে নিন।', { code: 'items_required' });
  }

  const deliverTo = body.deliverTo || {};
  if (!deliverTo.addressText && !deliverTo.lat) {
    throw ApiError.badRequest('ডেলিভারির ঠিকানা দিন।', { code: 'address_required' });
  }

  let doc;
  try {
    doc = await ServiceRequest.create({
      kind: cat.interaction,
      category: provider.category,
      providerId: provider._id,
      tenantId: req.user._id,
      providerName: provider.name,
      providerPhone: provider.phone,
      tenantName: req.user.name || '',
      tenantPhone: req.user.phone || '',
      items,
      // Snapshotted, never re-resolved: a tenant who moves out must not have
      // last month's orders silently re-point at their new flat.
      deliverTo: {
        label: String(deliverTo.label || '').slice(0, 80),
        addressText: String(deliverTo.addressText || '').slice(0, 400),
        phone: String(deliverTo.phone || req.user.phone || '').slice(0, 20),
        note: String(deliverTo.note || '').slice(0, 300),
        lat: Number.isFinite(Number(deliverTo.lat)) ? Number(deliverTo.lat) : null,
        lng: Number.isFinite(Number(deliverTo.lng)) ? Number(deliverTo.lng) : null,
        thana: String(deliverTo.thana || '').slice(0, 100),
        area: String(deliverTo.area || '').slice(0, 120),
        buildingId: deliverTo.buildingId || null,
        unitId: deliverTo.unitId || null,
        propertyId: deliverTo.propertyId || null,
      },
      note: String(body.note || '').slice(0, 500),
      deliveryFee: Math.max(0, Number(body.deliveryFee) || 0),
      paymentMode: body.paymentMode || 'cash_on_delivery',
      clientRequestId,
    });
  } catch (err) {
    if (err?.code === 11000 && clientRequestId) {
      const winner = await ServiceRequest.findOne({ tenantId: req.user._id, clientRequestId });
      if (winner) return res.status(200).json({ request: winner.toJSON(), duplicate: true });
    }
    throw err;
  }

  // Placing an order IS a connection — the provider's own numbers and the
  // admin's platform counts read one ledger, not two.
  const evt = await ContactEvent.record({
    providerId: provider._id,
    userId: req.user._id,
    kind: cat.interaction === 'order' ? 'order' : 'request',
    category: provider.category,
    thana: deliverTo.thana || '',
    area: deliverTo.area || '',
    buildingId: deliverTo.buildingId || null,
  });
  if (evt) {
    doc.contactEventId = evt._id;
    await doc.save();
  }
  await Provider.updateOne({ _id: provider._id }, {
    $inc: { [cat.interaction === 'order' ? 'stats.requests' : 'stats.requests']: 1 },
  });

  return res.status(201).json({ request: doc.toJSON() });
});

/** GET /api/service-requests — the tenant's own orders. */
exports.listMine = asyncH(async (req, res) => {
  const filter = { tenantId: req.user._id };
  if (req.query.open === '1') filter.status = { $in: ServiceRequest.OPEN_STATUSES };

  const rows = await ServiceRequest.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(100, Number.parseInt(req.query.limit, 10) || 30));

  return res.json({ requests: rows.map((r) => r.toJSON()) });
});

exports.getMine = asyncH(async (req, res) => {
  const doc = await loadForTenant(req.params.id, req.user);
  return res.json({ request: doc.toJSON() });
});

/** POST /api/service-requests/:id/cancel — the tenant calls it off. */
exports.cancelByTenant = asyncH(async (req, res) => {
  const doc = await loadForTenant(req.params.id, req.user);
  return applyTransition(doc, 'cancelled', {
    by: req.user._id,
    byRole: 'tenant',
    reason: String(req.body?.reason || '').slice(0, 300),
    res,
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// MERCHANT SURFACE  — /api/merchant/requests
// ═════════════════════════════════════════════════════════════════════════════

/** GET /api/merchant/requests — his inbox. The provider app's home screen. */
exports.listForMerchant = asyncH(async (req, res) => {
  const providerIds = await Provider.find({ ownerMerchantId: req.merchant._id }).distinct('_id');
  if (!providerIds.length) return res.json({ requests: [] });

  const filter = { providerId: { $in: providerIds } };
  if (req.query.providerId) {
    // Narrowed to one business, but still only from the set he owns.
    if (!providerIds.some((id) => String(id) === String(req.query.providerId))) {
      return res.json({ requests: [] });
    }
    filter.providerId = req.query.providerId;
  }
  if (req.query.status) filter.status = String(req.query.status);
  else filter.status = { $in: ServiceRequest.OPEN_STATUSES };

  const rows = await ServiceRequest.find(filter)
    // Oldest open request first — the one closest to expiring is the one he
    // needs to see, not the newest.
    .sort({ status: 1, createdAt: 1 })
    .limit(Math.min(100, Number.parseInt(req.query.limit, 10) || 50));

  return res.json({ requests: rows.map((r) => r.toJSON()) });
});

exports.accept = asyncH(async (req, res) => {
  const doc = await loadForMerchant(req.params.id, req.merchant);
  return applyTransition(doc, 'accepted', { by: req.merchant._id, byRole: 'provider', res });
});

/**
 * POST /api/merchant/requests/:id/decline   { reason }
 *
 * The reason goes to the tenant verbatim, so it has to be the provider's own
 * words ("স্টক নেই") rather than a generic code.
 */
exports.decline = asyncH(async (req, res) => {
  const doc = await loadForMerchant(req.params.id, req.merchant);
  return applyTransition(doc, 'declined', {
    by: req.merchant._id,
    byRole: 'provider',
    reason: String(req.body?.reason || '').slice(0, 300),
    res,
  });
});

exports.onTheWay = asyncH(async (req, res) => {
  const doc = await loadForMerchant(req.params.id, req.merchant);
  return applyTransition(doc, 'on_the_way', { by: req.merchant._id, byRole: 'provider', res });
});

/**
 * POST /api/merchant/requests/:id/complete   { finalTotal? }
 *
 * `finalTotal` is what actually changed hands, which for a `request` is agreed
 * on the phone. The gap between it and `quotedTotal` is the signal that a
 * provider's listed prices are fiction.
 */
exports.complete = asyncH(async (req, res) => {
  const doc = await loadForMerchant(req.params.id, req.merchant);
  const final = Number(req.body?.finalTotal);
  if (Number.isFinite(final) && final >= 0) doc.finalTotal = Math.round(final);
  return applyTransition(doc, 'completed', { by: req.merchant._id, byRole: 'provider', res });
});

exports.cancelByProvider = asyncH(async (req, res) => {
  const doc = await loadForMerchant(req.params.id, req.merchant);
  return applyTransition(doc, 'cancelled', {
    by: req.merchant._id,
    byRole: 'provider',
    reason: String(req.body?.reason || '').slice(0, 300),
    res,
  });
});

exports.loadForMerchant = loadForMerchant;
exports.applyBehaviourCounters = applyBehaviourCounters;
