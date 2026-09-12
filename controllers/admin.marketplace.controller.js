'use strict';

/**
 * Admin marketplace monitoring — কত প্রোভাইডার × কত ইউজার × কত সংযোগ.
 * ──────────────────────────────────────────────────────────────────────────
 * The provider marketplace runs provider↔tenant with nobody in between: admin
 * verifies an identity once, confirms a fee once, and never touches a
 * transaction again. That is deliberate, and it costs us the thing a
 * middleman gets for free — knowing whether the thing is working at all.
 *
 * This endpoint is that knowledge, rebuilt from the ledger instead of from
 * sitting in the middle. It answers three questions, in the order they matter:
 *
 *   SUPPLY     how many businesses are actually live, and how many of those
 *              are live in name only (registered, verified, and silent).
 *   DEMAND     how many real people reached a provider through us, and how
 *              many of them came back.
 *   LIQUIDITY  whether the two ever meet. A directory with 200 providers and
 *              200 users that never connect is a failure that both of the
 *              first two numbers report as a success.
 *
 * ── Identity-free on the USER side, named on the PROVIDER side ────────────
 * Every user-facing pipeline here ends in a COUNT. `$group` on a userId exists
 * only so the next stage can measure the set; the ids never leave the
 * database, and there is no row in this payload to click through to a person.
 * That is the same contract as admin.usage.controller.js and it is the reason
 * ContactEvent is allowed to carry a userId on a `view` at all.
 *
 * Providers are different, and the difference is not an inconsistency: a
 * provider is a PUBLIC BUSINESS LISTING that paid to be found. Naming the top
 * ten shops by connections is reading our own directory back to ourselves.
 * Naming the tenants who contacted them would not be.
 *
 * ── What this endpoint cannot see ─────────────────────────────────────────
 * A ContactEvent only exists against a provider that exists. So "৪২ জন
 * মিরপুরে গ্যাস খুঁজেছে, কেউ ছিল না" — demand for a category with zero
 * providers in that thana — is INVISIBLE here, and it is the single most
 * valuable number for deciding where to recruit next. Measuring it needs the
 * browse endpoint to log its empty results, which is a separate change.
 * `coverage` below reports the weaker thing we CAN see honestly: thanas where
 * people contacted somebody in a category that now has no active provider
 * left in it. Do not read it as total unmet demand.
 */

const Provider = require('../models/Provider');
const ContactEvent = require('../models/ContactEvent');
const ServiceRequest = require('../models/ServiceRequest');
const Merchant = require('../models/Merchant');
const cache = require('../config/redis');
const { CATEGORIES, getCategory } = require('../config/serviceCategories');

const { CONNECTING_KINDS, dhakaDayKey } = ContactEvent;

const DAY_MS = 24 * 60 * 60 * 1000;

// The windows the console offers. A fixed set, not a free-form number: it
// bounds the trend series, and it bounds the cache key space so a crawler
// asking for ?days=999999 cannot fill Redis with one-off payloads.
const WINDOWS = [7, 30, 90];
const DEFAULT_WINDOW = 30;

// How far ahead "expiring soon" looks. One month is enough notice to ring a
// shopkeeper twice before his listing drops out of search.
const EXPIRY_WARN_DAYS = 30;

// Breakdown tables are for reading, not for export. Longer than this and the
// page becomes a database dump nobody scrolls.
const AREA_LIMIT = 25;
const TOP_PROVIDER_LIMIT = 10;
const COVERAGE_LIMIT = 10;

// A recruitment target has to be demand that REPEATED. One person contacting a
// shop that has since been suspended is not a hole in the market, and a list
// padded with those is a list nobody acts on.
const COVERAGE_MIN_CONNECTIONS = 3;

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// `$count` returns [] — not [{ n: 0 }] — when nothing matched.
const countOf = (rows) => (Array.isArray(rows) && rows[0] ? Number(rows[0].n) || 0 : 0);

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

/** Share as a whole percent, guarding the 0-denominator that renders NaN%. */
const pct = (n, total) => {
  const t = Number(total) || 0;
  if (t <= 0) return 0;
  return Math.round(((Number(n) || 0) * 100) / t);
};

/**
 * Collapse (userId, n) rows into a headcount.
 *
 * A guest has userId null, and every guest looks identical to `$group`, so
 * they cannot be deduped — each of their events is counted as its own person.
 * That OVER-counts a guest who came back, which is the honest direction to be
 * wrong in: the alternative (`$addToSet`) collapses every guest on the
 * platform into a single human being.
 *
 * Used as a `$sum` expression inside a second `$group` stage — see the
 * two-stage pipelines below.
 */
const headcount = (userField, countField) => ({
  $cond: [{ $eq: [userField, null] }, countField, 1],
});

/**
 * Providers whose prices went stale, expressed as one `$switch` over the
 * category registry.
 *
 * Freshness is per-category and the spread is enormous — a মুদি price list is
 * stale after a week, an ইলেকট্রিশিয়ান's rate is fine after a year — so a
 * single global threshold would either nag every electrician or never catch a
 * grocer. `freshnessState()` calls `expired` 2× maxAgeDays, and this mirrors
 * that constant rather than inventing a second definition of the same word.
 *
 * A provider who never set prices at all has `pricesUpdatedAt: null` and is
 * counted: no prices is the most stale a price list can be.
 */
function stalePriceBranches() {
  return CATEGORIES
    .filter((c) => c.price && c.price.maxAgeDays)
    .map((c) => ({
      case: { $eq: ['$category', c.id] },
      then: new Date(Date.now() - 2 * c.price.maxAgeDays * DAY_MS),
    }));
}

/** Every dayKey from `since` to today, so a quiet day is a zero, not a gap. */
function dayKeysSince(days) {
  const out = [];
  const start = Date.now() - (days - 1) * DAY_MS;
  for (let i = 0; i < days; i += 1) out.push(dhakaDayKey(new Date(start + i * DAY_MS)));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/marketplace?days=30
// ─────────────────────────────────────────────────────────────────────────────
exports.getMarketplace = asyncH(async (req, res) => {
  const requested = Number.parseInt(req.query.days, 10);
  const days = WINDOWS.includes(requested) ? requested : DEFAULT_WINDOW;

  const stats = await cache.getOrSet(
    // The window is IN the key. Without it a 7-day request served whatever the
    // last caller asked for, which is the sort of bug that survives a year
    // because every individual number still looks plausible.
    cache.KEY.adminStats(`marketplace:${days}`),
    cache.TTL.ADMIN_STATS,
    () => buildMarketplaceStats(days),
  );

  return res.json({ stats });
});

async function buildMarketplaceStats(days) {
  const since = new Date(Date.now() - days * DAY_MS);
  const window = { createdAt: { $gte: since } };
  const connectingInWindow = { ...window, kind: { $in: CONNECTING_KINDS } };
  const branches = stalePriceBranches();

  const [
    byStatus,
    byCategorySupply,
    supplyExtras,
    stalePrices,
    merchantAccounts,
    merchantsWithProvider,

    demandTotals,
    viewTotals,
    funnel,
    newPeople,
    byCategoryDemand,
    demandByArea,
    supplyByArea,
    trendRows,

    orderTotals,
    byCategoryOrders,
    responseTime,

    providersConnected,
    silentProviders,
    topProviders,
    orphanCategories,
  ] = await Promise.all([
    // ── SUPPLY ───────────────────────────────────────────────────────────
    // Status is a STATE, not an event, so it is measured all-time. Asking
    // "how many providers are active in the last 30 days" is a category
    // error — `newInWindow` below is the windowed half of this.
    Provider.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),

    Provider.aggregate([
      {
        $group: {
          _id: '$category',
          providers: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          // The green badge, which needs BOTH halves — same rule as the
          // `isVerified` virtual on the model. Tier alone is not a badge.
          verified: {
            $sum: {
              $cond: [{
                $and: [
                  { $eq: ['$verification.status', 'verified'] },
                  { $eq: ['$verification.tier', 'full'] },
                ],
              }, 1, 0],
            },
          },
          openNow: {
            $sum: {
              $cond: [{
                $and: [{ $eq: ['$status', 'active'] }, { $eq: ['$openNow', true] }],
              }, 1, 0],
            },
          },
        },
      },
    ]),

    Provider.aggregate([
      {
        $facet: {
          verified: [
            {
              $match: {
                'verification.status': 'verified',
                'verification.tier': 'full',
              },
            },
            { $count: 'n' },
          ],
          openNow: [{ $match: { status: 'active', openNow: true } }, { $count: 'n' }],
          // Registered but never submitted — someone started the form and
          // walked away. The size of this is an onboarding verdict.
          abandoned: [
            { $match: { status: 'draft', 'verification.submittedForReview': false } },
            { $count: 'n' },
          ],
          expiringSoon: [
            {
              $match: {
                status: 'active',
                'registration.expiresAt': {
                  $ne: null,
                  $lt: new Date(Date.now() + EXPIRY_WARN_DAYS * DAY_MS),
                },
              },
            },
            { $count: 'n' },
          ],
          newInWindow: [{ $match: window }, { $count: 'n' }],
          // Went LIVE in the window, which is not the same as registered in
          // it: the gap between these two is how long the queue takes.
          activatedInWindow: [
            { $match: { status: 'active', 'registration.paidAt': { $gte: since } } },
            { $count: 'n' },
          ],
          feeCollected: [
            { $match: { 'registration.paidAt': { $gte: since } } },
            { $group: { _id: null, n: { $sum: '$registration.amount' } } },
          ],
        },
      },
    ]),

    branches.length
      ? Provider.aggregate([
        { $match: { status: 'active' } },
        { $addFields: { staleBefore: { $switch: { branches, default: null } } } },
        {
          $match: {
            $expr: {
              $and: [
                { $ne: ['$staleBefore', null] },
                // Epoch stands in for "never set", so a provider who never
                // entered a price is stale rather than invisible.
                { $lt: [{ $ifNull: ['$pricesUpdatedAt', new Date(0)] }, '$staleBefore'] },
              ],
            },
          },
        },
        { $count: 'n' },
      ]).then(countOf)
      : Promise.resolve(0),

    // A merchant account is a login; a provider is a business. Someone who
    // signed up and never registered a shop is a different kind of drop-off
    // from someone whose shop is stuck in the queue, and only this pair
    // separates them.
    Merchant.countDocuments({}),
    Provider.aggregate([{ $group: { _id: '$ownerMerchantId' } }, { $count: 'n' }]).then(countOf),

    // ── DEMAND ───────────────────────────────────────────────────────────
    // Two stages on purpose. Grouping by userId FIRST and counting the
    // resulting rows keeps the distinct-people maths inside the database —
    // `$addToSet` would haul every user id on the platform into one array
    // just to take its length.
    ContactEvent.aggregate([
      { $match: connectingInWindow },
      { $group: { _id: '$userId', n: { $sum: 1 } } },
      {
        $group: {
          _id: null,
          connections: { $sum: '$n' },
          people: { $sum: headcount('$_id', '$n') },
          // Came back. In a hyperlocal directory this is THE number: a
          // neighbourhood shop lives on repeat custom, and a marketplace
          // where nobody returns is an expensive phone book.
          repeatPeople: {
            $sum: { $cond: [{ $and: [{ $ne: ['$_id', null] }, { $gt: ['$n', 1] }] }, 1, 0] },
          },
          guestEvents: { $sum: { $cond: [{ $eq: ['$_id', null] }, '$n', 0] } },
        },
      },
    ]),

    ContactEvent.aggregate([
      { $match: { ...window, kind: 'view' } },
      { $group: { _id: '$userId', n: { $sum: 1 } } },
      {
        $group: {
          _id: null,
          views: { $sum: '$n' },
          viewers: { $sum: headcount('$_id', '$n') },
        },
      },
    ]),

    // Looked → actually reached out, measured PER PERSON rather than by
    // dividing one total by another. Dividing contacts by viewers reads fine
    // until a `tel:` tap arrives with no view recorded before it — the client
    // does not always send both — and the dashboard prints 140%. Asking
    // whether the same person did both cannot exceed 100% by construction.
    //
    // Registered users only: every guest collapses to the same null id, so
    // "did this guest come back and call" is not a question the data can
    // answer. The rate is over people we can actually follow.
    ContactEvent.aggregate([
      { $match: { ...window, userId: { $ne: null } } },
      {
        $group: {
          _id: '$userId',
          viewed: { $max: { $cond: [{ $eq: ['$kind', 'view'] }, 1, 0] } },
          connected: { $max: { $cond: [{ $eq: ['$kind', 'view'] }, 0, 1] } },
        },
      },
      {
        $group: {
          _id: null,
          viewers: { $sum: '$viewed' },
          converted: {
            $sum: {
              $cond: [{ $and: [{ $eq: ['$viewed', 1] }, { $eq: ['$connected', 1] }] }, 1, 0],
            },
          },
        },
      },
    ]),

    // First-ever connection landed inside the window. Deliberately scanned
    // across ALL time — "new" is only meaningful against the whole history,
    // and a window-local `$min` would relabel every returning user as new.
    ContactEvent.aggregate([
      { $match: { userId: { $ne: null }, kind: { $in: CONNECTING_KINDS } } },
      { $group: { _id: '$userId', first: { $min: '$createdAt' } } },
      { $match: { first: { $gte: since } } },
      { $count: 'n' },
    ]).then(countOf),

    // Per-category demand, both kinds in one pass. `$_id.v` is "was this a
    // view", which keeps views and connections in the same two-stage shape
    // instead of running the pipeline twice.
    ContactEvent.aggregate([
      { $match: window },
      {
        $group: {
          _id: { c: '$category', u: '$userId', v: { $eq: ['$kind', 'view'] } },
          n: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: '$_id.c',
          views: { $sum: { $cond: ['$_id.v', '$n', 0] } },
          connections: { $sum: { $cond: ['$_id.v', 0, '$n'] } },
          viewers: { $sum: { $cond: ['$_id.v', headcount('$_id.u', '$n'), 0] } },
          people: { $sum: { $cond: ['$_id.v', 0, headcount('$_id.u', '$n')] } },
        },
      },
    ]),

    // WHERE THE USER WAS, snapshotted at contact. Not where the shop is —
    // see the note on `areas` in the payload.
    ContactEvent.aggregate([
      { $match: { ...connectingInWindow, thana: { $gt: '' } } },
      { $group: { _id: { t: '$thana', u: '$userId' }, n: { $sum: 1 } } },
      {
        $group: {
          _id: '$_id.t',
          connections: { $sum: '$n' },
          people: { $sum: headcount('$_id.u', '$n') },
        },
      },
    ]),

    Provider.aggregate([
      { $match: { thana: { $gt: '' } } },
      {
        $group: {
          _id: '$thana',
          providers: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
        },
      },
    ]),

    // Grouped on the stored dayKey — already 'YYYY-MM-DD' in Asia/Dhaka, so
    // there is no date truncation here and no chance of slicing the series on
    // UTC midnight, which in Dhaka is 6am and cuts a working day in half.
    ContactEvent.aggregate([
      { $match: window },
      {
        $group: {
          _id: { d: '$dayKey', u: '$userId', v: { $eq: ['$kind', 'view'] } },
          n: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: '$_id.d',
          views: { $sum: { $cond: ['$_id.v', '$n', 0] } },
          connections: { $sum: { $cond: ['$_id.v', 0, '$n'] } },
          people: { $sum: { $cond: ['$_id.v', 0, headcount('$_id.u', '$n')] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),

    // ── ORDERS ───────────────────────────────────────────────────────────
    // Only `request` and `order` tier categories ever reach this collection.
    // For the four `contact`-tier categories there are no orders to count and
    // never will be, so a low order count is not automatically bad news — it
    // has to be read against the category mix.
    ServiceRequest.aggregate([
      { $match: window },
      {
        $group: {
          _id: '$status',
          n: { $sum: 1 },
          // A placed order is not money. Only a completed one is.
          gmv: {
            $sum: {
              $cond: [
                { $eq: ['$status', 'completed'] },
                { $ifNull: ['$finalTotal', '$quotedTotal'] },
                0,
              ],
            },
          },
        },
      },
    ]),

    ServiceRequest.aggregate([
      { $match: window },
      {
        $group: {
          _id: '$category',
          orders: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          gmv: {
            $sum: {
              $cond: [
                { $eq: ['$status', 'completed'] },
                { $ifNull: ['$finalTotal', '$quotedTotal'] },
                0,
              ],
            },
          },
        },
      },
    ]),

    // How long a tenant waits for an answer. The number that decides whether
    // ordering through the app beats ringing the shop directly — if the
    // average is 20 minutes, nobody uses the order flow twice.
    ServiceRequest.aggregate([
      { $match: { ...window, acceptedAt: { $ne: null } } },
      {
        $group: {
          _id: null,
          avgMin: { $avg: { $divide: [{ $subtract: ['$acceptedAt', '$createdAt'] }, 60_000] } },
          n: { $sum: 1 },
        },
      },
    ]),

    // ── LIQUIDITY ────────────────────────────────────────────────────────
    ContactEvent.aggregate([
      { $match: connectingInWindow },
      { $group: { _id: '$providerId' } },
      { $count: 'n' },
    ]).then(countOf),

    // Active, paid, and nobody reached them all window. This is the churn
    // list: every one of these is a shopkeeper who will not renew, and he is
    // right not to. Computed as an EXISTS lookup ($limit 1 inside the
    // sub-pipeline) rather than by pulling every contacted id into Node and
    // running a `$nin` against it.
    Provider.aggregate([
      { $match: { status: 'active' } },
      {
        $lookup: {
          from: ContactEvent.collection.name,
          let: { pid: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$providerId', '$$pid'] },
                createdAt: { $gte: since },
                kind: { $in: CONNECTING_KINDS },
              },
            },
            { $limit: 1 },
          ],
          as: 'hit',
        },
      },
      { $match: { hit: { $size: 0 } } },
      { $count: 'n' },
    ]).then(countOf),

    // Named on purpose — a provider is a public listing that paid to be
    // found. See the header note on why users are counted and shops are not.
    ContactEvent.aggregate([
      { $match: connectingInWindow },
      { $group: { _id: { p: '$providerId', u: '$userId' }, n: { $sum: 1 } } },
      {
        $group: {
          _id: '$_id.p',
          connections: { $sum: '$n' },
          people: { $sum: headcount('$_id.u', '$n') },
        },
      },
      { $sort: { connections: -1 } },
      { $limit: TOP_PROVIDER_LIMIT },
      {
        $lookup: {
          from: Provider.collection.name,
          localField: '_id',
          foreignField: '_id',
          as: 'p',
        },
      },
      {
        $project: {
          connections: 1,
          people: 1,
          name: { $arrayElemAt: ['$p.name', 0] },
          category: { $arrayElemAt: ['$p.category', 0] },
          thana: { $arrayElemAt: ['$p.thana', 0] },
          status: { $arrayElemAt: ['$p.status', 0] },
        },
      },
    ]),

    // Thana × category pairs where people contacted somebody and there is now
    // nobody active left serving them. The weak, honest half of unmet demand —
    // see the header note on what this endpoint cannot see.
    //
    // "Serving them" is NOT "whose shop is in that thana". A provider sets a
    // coverage area, and a গ্যাস agency pinned in ধানমন্ডি that delivers to
    // মোহাম্মদপুর covers মোহাম্মদপুর. Matching on Provider.thana alone ignored
    // the coverage model entirely and invented a hole for every neighbouring
    // thana a shop already serves — a recruitment list of places that do not
    // need recruiting.
    //
    // Radius coverage still cannot be evaluated here: ContactEvent stores how
    // far apart the two were, not where the user was, so there is no point to
    // measure a radius from. That is why COVERAGE_MIN_CONNECTIONS exists — one
    // stray contact is not evidence of a gap, and this list is only worth
    // reading where the demand repeated.
    ContactEvent.aggregate([
      { $match: { ...connectingInWindow, thana: { $gt: '' } } },
      { $group: { _id: { t: '$thana', c: '$category' }, connections: { $sum: 1 } } },
      { $match: { connections: { $gte: COVERAGE_MIN_CONNECTIONS } } },
      {
        $lookup: {
          from: Provider.collection.name,
          let: { t: '$_id.t', c: '$_id.c' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$category', '$$c'] },
                    { $eq: ['$status', 'active'] },
                    {
                      $or: [
                        { $eq: ['$thana', '$$t'] },
                        { $in: ['$$t', { $ifNull: ['$coverage.thanas', []] }] },
                      ],
                    },
                  ],
                },
              },
            },
            { $limit: 1 },
          ],
          as: 'live',
        },
      },
      { $match: { live: { $size: 0 } } },
      { $sort: { connections: -1 } },
      { $limit: COVERAGE_LIMIT },
    ]),
  ]);

  // ── Reshape ────────────────────────────────────────────────────────────

  const statusCounts = Object.fromEntries(byStatus.map((r) => [r._id, r.n]));
  const facet = supplyExtras[0] || {};
  const facetCount = (key) => countOf(facet[key]);

  const demand = demandTotals[0] || {};
  const views = viewTotals[0] || {};
  const orderCounts = Object.fromEntries(orderTotals.map((r) => [r._id, r.n]));
  const gmv = orderTotals.reduce((sum, r) => sum + (r.gmv || 0), 0);
  const ordersPlaced = orderTotals.reduce((sum, r) => sum + r.n, 0);

  const activeProviders = statusCounts.active || 0;
  const connections = demand.connections || 0;
  const people = demand.people || 0;

  // ── Per-category table ─────────────────────────────────────────────────
  // Built from the REGISTRY, not from whatever happened to be in the data, so
  // a category with zero of everything still gets a row. A live category
  // sitting at zero providers is the finding; silently omitting it would hide
  // exactly the thing worth seeing.
  const demandByCat = Object.fromEntries(byCategoryDemand.map((r) => [r._id, r]));
  const supplyByCat = Object.fromEntries(byCategorySupply.map((r) => [r._id, r]));
  const ordersByCat = Object.fromEntries(byCategoryOrders.map((r) => [r._id, r]));

  const seen = new Set();
  const categories = CATEGORIES.map((c) => {
    seen.add(c.id);
    const s = supplyByCat[c.id] || {};
    const d = demandByCat[c.id] || {};
    const o = ordersByCat[c.id] || {};
    return {
      id: c.id,
      label: c.label,
      icon: c.icon,
      interaction: c.interaction,
      categoryStatus: c.status,
      providers: s.providers || 0,
      active: s.active || 0,
      verified: s.verified || 0,
      openNow: s.openNow || 0,
      views: d.views || 0,
      viewers: d.viewers || 0,
      connections: d.connections || 0,
      people: d.people || 0,
      orders: o.orders || 0,
      completedOrders: o.completed || 0,
      gmv: o.gmv || 0,
    };
  });

  // Rows whose category id is no longer in the registry — a renamed or
  // retired id with live data still pointing at it. Surfaced rather than
  // dropped, for the same reason usage tracking reports `unlinkedRecords`:
  // numbers that silently fail to add up are how a dashboard loses its
  // reader's trust.
  const strayCategories = [
    ...new Set([...Object.keys(supplyByCat), ...Object.keys(demandByCat)]),
  ].filter((id) => !seen.has(id) && !getCategory(id));

  // ── Per-area table ─────────────────────────────────────────────────────
  // Supply thana and demand thana are DIFFERENT FACTS sharing a column: one
  // is where the shop is, the other is where the tenant was standing. They
  // are joined here because a reader wants them side by side, not because
  // they measure the same thing — a thana with providers and no connections
  // means something quite different from the reverse.
  const areaMap = new Map();
  const areaRow = (t) => {
    if (!areaMap.has(t)) {
      areaMap.set(t, { thana: t, providers: 0, active: 0, connections: 0, people: 0 });
    }
    return areaMap.get(t);
  };
  for (const r of supplyByArea) Object.assign(areaRow(r._id), { providers: r.providers, active: r.active });
  for (const r of demandByArea) Object.assign(areaRow(r._id), { connections: r.connections, people: r.people });

  const areas = [...areaMap.values()]
    .sort((a, b) => (b.connections - a.connections) || (b.active - a.active))
    .slice(0, AREA_LIMIT);

  // ── Trend ──────────────────────────────────────────────────────────────
  // Zero-filled. A sparse series plots a quiet Friday as a straight line to
  // the next busy day, which reads as growth that did not happen.
  const trendMap = Object.fromEntries(trendRows.map((r) => [r._id, r]));
  const trend = dayKeysSince(days).map((dayKey) => {
    const r = trendMap[dayKey] || {};
    return {
      dayKey,
      views: r.views || 0,
      connections: r.connections || 0,
      people: r.people || 0,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    windowDays: days,
    windows: WINDOWS,

    // The three numbers the dashboard exists to show, in one place so the
    // headline never has to be re-derived by adding up a table.
    headline: {
      providers: activeProviders,
      people,
      connections,
    },

    supply: {
      total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
      byStatus: {
        draft: statusCounts.draft || 0,
        pendingReview: statusCounts.pending_review || 0,
        awaitingPayment: statusCounts.awaiting_payment || 0,
        active: activeProviders,
        rejected: statusCounts.rejected || 0,
        suspended: statusCounts.suspended || 0,
        expired: statusCounts.expired || 0,
      },
      verified: facetCount('verified'),
      openNow: facetCount('openNow'),
      abandonedDrafts: facetCount('abandoned'),
      expiringSoon: facetCount('expiringSoon'),
      stalePrices,
      newInWindow: facetCount('newInWindow'),
      activatedInWindow: facetCount('activatedInWindow'),
      feeCollected: facet.feeCollected?.[0]?.n || 0,
      merchantAccounts,
      merchantsWithProvider,
      // Signed up, never registered a shop. A different drop-off from a shop
      // stuck in the queue, and it points at a different fix.
      merchantsIdle: Math.max(0, merchantAccounts - merchantsWithProvider),
    },

    demand: {
      people,
      newPeople,
      repeatPeople: demand.repeatPeople || 0,
      repeatRate: pct(demand.repeatPeople || 0, people),
      connections,
      guestConnections: demand.guestEvents || 0,
      views: views.views || 0,
      viewers: views.viewers || 0,
      // The funnel that says whether the cards are doing their job. Measured
      // per person over registered users — see the pipeline note.
      //
      // `registeredViewers` is the DENOMINATOR of that rate and is shipped
      // with it on purpose: `viewers` above includes guests, so a client that
      // drew the funnel against `viewers` would print a bar labelled 44% next
      // to a rate of 91% and look broken on its own card.
      registeredViewers: funnel[0]?.viewers || 0,
      viewersWhoContacted: funnel[0]?.converted || 0,
      viewToContactRate: pct(funnel[0]?.converted || 0, funnel[0]?.viewers || 0),
    },

    liquidity: {
      activeProviders,
      providersConnected,
      silentProviders,
      // Registered, paid, and got nothing all window. The renewal risk, and
      // the one number on this page that should ever trigger a phone call.
      silentRate: pct(silentProviders, activeProviders),
      connectionsPerActiveProvider: activeProviders
        ? round1(connections / activeProviders) : 0,
      peoplePerConnectedProvider: providersConnected
        ? round1(people / providersConnected) : 0,
    },

    orders: {
      placed: ordersPlaced,
      open: (orderCounts.placed || 0) + (orderCounts.accepted || 0)
        + (orderCounts.on_the_way || 0),
      accepted: orderCounts.accepted || 0,
      completed: orderCounts.completed || 0,
      declined: orderCounts.declined || 0,
      cancelled: orderCounts.cancelled || 0,
      // Nobody answered inside the response window. Kept apart from
      // `declined` everywhere in this system: an honest decline is fine
      // behaviour, silence is not, and merging them would punish the
      // provider who answers properly.
      expired: orderCounts.expired || 0,
      gmv,
      completionRate: pct(orderCounts.completed || 0, ordersPlaced),
      silenceRate: pct(orderCounts.expired || 0, ordersPlaced),
      avgResponseMin: responseTime[0] ? round1(responseTime[0].avgMin) : null,
      answered: responseTime[0]?.n || 0,
    },

    categories,
    strayCategories,
    areas,
    // Contacts recorded with no thana on them — an older client, or a user
    // who never granted location. Reported so `areas` can be reconciled
    // against the connection total instead of silently falling short.
    unlocatedConnections: Math.max(
      0,
      connections - demandByArea.reduce((sum, r) => sum + r.connections, 0),
    ),
    trend,
    topProviders: topProviders.map((r) => ({
      id: String(r._id),
      name: r.name || '—',
      category: r.category || '',
      categoryLabel: getCategory(r.category)?.label || null,
      thana: r.thana || '',
      status: r.status || '',
      connections: r.connections,
      people: r.people,
    })),
    coverage: orphanCategories.map((r) => ({
      thana: r._id.t,
      category: r._id.c,
      categoryLabel: getCategory(r._id.c)?.label || null,
      connections: r.connections,
    })),

    // Shipped with the numbers so the console labels them exactly the way
    // this file measures them, and a definition can never drift from the
    // query that produced it.
    definitions: {
      providers: 'Businesses live in the directory right now — verified and paid.',
      people: `Distinct people who contacted a provider in the last ${days} days. Guests cannot be deduped, so each guest event counts as one person.`,
      connections: 'Calls, requests and orders. Opening a card is a view, not a connection.',
      newPeople: 'People whose first-ever contact with any provider was inside this window.',
      silentProviders: 'Active providers nobody contacted all window — the renewal risk.',
      stalePrices: "Active providers whose price list is past twice its category's freshness window, or was never filled in.",
      abandonedDrafts: 'Registrations started and never submitted for review.',
      merchantsIdle: 'Shopkeeper logins that never registered a business.',
      expired: 'Orders nobody answered inside the response window — counted apart from honest declines.',
      viewToContactRate: 'Of the registered people who opened a card, the share who then reached out. Guests are excluded — they cannot be followed between two events.',
      providersConnected: 'Distinct providers somebody contacted, whatever their status now — a shop suspended last week still got the calls it got.',
      areas: 'Providers are counted where the SHOP is; connections where the USER was at the moment of contact. The two columns are different facts.',
      coverage: `Thanas where at least ${COVERAGE_MIN_CONNECTIONS} contacts went to a category with no active provider serving the area — by its own thana or its named coverage list. Treat it as a lead, not a verdict: a search that found nobody leaves no record at all, and a provider covering the thana by RADIUS cannot be matched here because we store how far apart the two were, not where the user was.`,
      perCategoryPeople: 'Per-category headcounts overlap: somebody who used gas and a grocer appears in both rows, so the column sums higher than the total.',
    },
  };
}

exports.buildMarketplaceStats = buildMarketplaceStats;
exports.WINDOWS = WINDOWS;
