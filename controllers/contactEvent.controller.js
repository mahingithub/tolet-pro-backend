'use strict';

/**
 * ContactEvent Controller — the connection ledger's write and read paths.
 * ─────────────────────────────────────────────────────────────────────────────
 *   POST /api/services/contact          a tenant opened a card, or tapped call
 *   GET  /api/providers/:id/stats       the provider's own numbers
 *
 * ─── WHY A `tel:` TAP IS WORTH RECORDING ─────────────────────────────────────
 * For `contact`-tier categories — গৃহকর্মী, ইলেকট্রিশিয়ান, প্লাম্বার,
 * ইন্টারনেট — there are no orders at all. The tenant just rings. So the call
 * count is not a vanity metric: it is the ENTIRE return-on-investment story
 * for the registration fee, and the only evidence the platform did anything.
 *
 * We cannot know whether a `tel:` call connected, only that intent was
 * expressed. It is counted as a lead and never reported as a completed call.
 *
 * ─── THE PRIVACY BOUNDARY ────────────────────────────────────────────────────
 * A provider learns WHO somebody is only when they reach out. A `view` is
 * never attributable to him — he gets the count, never the identities.
 * Browsing a shop is not consent to hand that shop your name and number, and a
 * directory where it is, is a directory nobody browses twice.
 */

const mongoose = require('mongoose');

const ContactEvent = require('../models/ContactEvent');
const ServiceRequest = require('../models/ServiceRequest');
const Provider = require('../models/Provider');
const ApiError = require('../utils/ApiError');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Kinds a client may report. `request` and `order` are recorded server-side
// when the ServiceRequest is created — accepting them here would let a client
// inflate a provider's order count without ordering anything.
const CLIENT_KINDS = ['view', 'call_tel'];

// `all` is null on purpose — "no window" rather than "some number of days".
// Read it with a key check, NEVER with `RANGES[x] ?? 30`: `??` fires on null
// as well as undefined, so `?range=all` silently came back as 30 days and a
// shopkeeper asking for his lifetime numbers was shown last month's.
const RANGES = { '7d': 7, '30d': 30, '90d': 90, all: null };
const DEFAULT_RANGE = '30d';

function resolveRange(raw) {
  const key = String(raw || '');
  return Object.prototype.hasOwnProperty.call(RANGES, key) ? key : DEFAULT_RANGE;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/services/contact   { providerId, kind, thana?, area?, distanceKm? }
//
// optionalAuth: a guest browsing counts as demand, they just cannot be deduped.
// ─────────────────────────────────────────────────────────────────────────────
exports.record = asyncH(async (req, res) => {
  const { providerId, kind } = req.body || {};

  if (!CLIENT_KINDS.includes(kind)) {
    throw ApiError.badRequest('Unknown contact kind.', { code: 'bad_kind' });
  }
  if (!mongoose.isValidObjectId(providerId)) {
    throw ApiError.badRequest('Unknown provider.', { code: 'bad_provider' });
  }

  const provider = await Provider.findById(providerId).select('category status');
  // Silently ignored rather than 404'd: this is analytics on a page the user
  // is already looking at, and an error toast over a counter would be absurd.
  if (!provider || provider.status !== 'active') {
    return res.status(202).json({ recorded: false });
  }

  const evt = await ContactEvent.record({
    providerId: provider._id,
    userId: req.user?._id || null,
    kind,
    category: provider.category,
    thana: String(req.body?.thana || '').slice(0, 100),
    area: String(req.body?.area || '').slice(0, 120),
    buildingId: req.body?.buildingId || null,
    distanceKm: Number.isFinite(Number(req.body?.distanceKm))
      ? Number(req.body.distanceKm) : null,
  });

  // `record()` returns null when the unique index absorbed a repeat view from
  // the same person on the same day — a no-op, not a failure.
  if (evt) {
    const field = kind === 'view' ? 'stats.views' : 'stats.contacts';
    await Provider.updateOne({ _id: provider._id }, { $inc: { [field]: 1 } });
  }

  return res.status(evt ? 201 : 200).json({ recorded: Boolean(evt) });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/providers/:id/stats?range=30d
//
// The provider app's Earnings screen. Merchant-gated and scoped to a business
// he owns.
// ─────────────────────────────────────────────────────────────────────────────
exports.providerStats = asyncH(async (req, res) => {
  const provider = await Provider.findById(req.params.id);
  if (!provider || String(provider.ownerMerchantId) !== String(req.merchant._id)) {
    throw ApiError.notFound('প্রোভাইডার পাওয়া যায়নি।', { code: 'provider_not_found' });
  }

  const range = resolveRange(req.query.range);
  const days = RANGES[range];
  const since = days ? new Date(Date.now() - days * 86_400_000) : new Date(0);
  const match = { providerId: provider._id, createdAt: { $gte: since } };

  const [byKind, repeat, topBuilding, sales] = await Promise.all([
    ContactEvent.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$kind',
          events: { $sum: 1 },
          users: { $addToSet: '$userId' },
          guests: { $sum: { $cond: [{ $eq: ['$userId', null] }, 1, 0] } },
        },
      },
    ]),

    // People who came back. The number a shopkeeper cares about most after
    // "how many called" — a repeat customer is the whole point of being local.
    ContactEvent.aggregate([
      { $match: { ...match, userId: { $ne: null }, kind: { $in: ContactEvent.CONNECTING_KINDS } } },
      { $group: { _id: '$userId', n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
      { $count: 'repeatCustomers' },
    ]),

    // Building density — this platform's real advantage over a general
    // marketplace, and a number he understands instantly.
    ContactEvent.aggregate([
      { $match: { ...match, buildingId: { $ne: null } } },
      { $group: { _id: '$buildingId', customers: { $addToSet: '$userId' } } },
      { $project: { customers: { $size: '$customers' } } },
      { $sort: { customers: -1 } },
      { $limit: 1 },
      { $lookup: { from: 'buildings', localField: '_id', foreignField: '_id', as: 'b' } },
      { $project: { customers: 1, name: { $arrayElemAt: ['$b.name', 0] } } },
    ]),

    // Only COMPLETED orders count as sales. A placed order is not money.
    ServiceRequest.aggregate([
      { $match: { providerId: provider._id, status: 'completed', completedAt: { $gte: since } } },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          total: { $sum: { $ifNull: ['$finalTotal', '$quotedTotal'] } },
        },
      },
    ]),
  ]);

  const kindMap = Object.fromEntries(byKind.map((r) => [
    r._id,
    // Distinct people, not raw events: `$addToSet` collapses every guest into
    // one null, so filter it out and add the guest rows back separately.
    { people: r.users.filter(Boolean).length + r.guests, events: r.events },
  ]));

  const contacts = ContactEvent.CONNECTING_KINDS.reduce(
    (sum, k) => sum + (kindMap[k]?.people || 0), 0,
  );

  return res.json({
    // The range that was actually APPLIED, not the one that was asked for —
    // a typo'd value falls back to 30 days and the client must be able to see
    // that it did.
    range,
    // `views` is a COUNT. There is deliberately no list of viewers anywhere in
    // this payload — see the header note.
    views: kindMap.view?.people || 0,
    contacts,
    calls: kindMap.call_tel?.people || 0,
    orders: sales[0]?.orders || 0,
    salesTotal: sales[0]?.total || 0,
    repeatCustomers: repeat[0]?.repeatCustomers || 0,
    topBuilding: topBuilding[0]?.name
      ? { name: topBuilding[0].name, customers: topBuilding[0].customers }
      : null,
  });
});
