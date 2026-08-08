'use strict';

const propertyService = require('../services/property.service');
const propertyValidators = require('../validators/property.validators');
const ApiError = require('../utils/ApiError');
// NOTE: both of these were missing, so attachHostTiers() below threw a
// ReferenceError on EVERY listing request. Its try/catch swallowed it and fell
// back to hostTier 'free' for everyone — which is why Plus/Pro badges and the
// Gold Card never appeared on the feed no matter what the host had paid for.
const Subscription = require('../models/Subscription');
const Review = require('../models/Review');
const User = require('../models/User');
const { tierOf } = require('../utils/subscriptionTier');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ── Listing-card payload trimming ───────────────────────────────────────────
// The public listing/search response must stay light on mobile. Per property
// we ship ONLY: coverPhoto + a few room-category photos — ONE per unique
// category, ANY property kind (residential OR commercial). The card renders the
// cover + its best 3 thumbnails from these. The heavy walkthrough video
// (`videoUrl`, up to ~25 MB base64) is dropped entirely; it loads on the detail
// page instead, along with the full room gallery.
//
// We ship a few EXTRA distinct categories (limit 6) so the card can prefer
// photos that differ from the cover when choosing its 3 thumbnails.
const LIST_ROOM_PHOTO_LIMIT = 6;

function toCloudinaryCardImage(url) {
  const s = String(url || '').trim();
  if (!/^https?:\/\/res\.cloudinary\.com\//i.test(s)) return s;
  const marker = '/image/upload/';
  const markerIndex = s.indexOf(marker);
  if (markerIndex === -1) return s;
  const after = s.slice(markerIndex + marker.length);
  const firstSegment = after.split('/')[0] || '';
  if (/^(?:a_|ar_|b_|c_|co_|dpr_|e_|f_|fl_|g_|h_|l_|o_|q_|r_|t_|w_|x_|y_|z_)/.test(firstSegment)) {
    return s;
  }
  return `${s.slice(0, markerIndex + marker.length)}f_auto,q_auto:eco,w_640,c_fill/${after}`;
}

function trimForListCard(p) {
  delete p.videoUrl;
  const coverThumb = p.coverPhotoThumb || '';
  p.coverPhoto = toCloudinaryCardImage(coverThumb || p.coverPhoto);
  delete p.coverPhotoThumb;
  // Keep ONE photo per unique room category, in upload order, CATEGORY-AGNOSTIC
  // (residential AND commercial). We preserve the REAL room id so the card
  // labels it correctly (Front / Inside Floor / Workspace / Reception / Washroom
  // …) and can order/choose. The old version bucketed by residential room names
  // (bed/bath/living/kitchen), which dropped every commercial photo except a
  // washroom (it matched 'wash') and even re-tagged it "bathroom".
  const photos = Array.isArray(p.roomPhotos) ? p.roomPhotos : [];
  const picked = [];
  const seenRooms = new Set();
  for (const ph of photos) {
    if (picked.length >= LIST_ROOM_PHOTO_LIMIT) break;
    const room = String((ph && ph.room) || 'other').toLowerCase();
    if (seenRooms.has(room)) continue;
    const url = toCloudinaryCardImage((ph && (ph.thumbUrl || ph.thumbnailUrl || ph.url || ph.preview)) || '');
    if (!url) continue;
    seenRooms.add(room);
    picked.push({ room, url });
  }
  p.roomPhotos = picked; // ≤ LIST_ROOM_PHOTO_LIMIT distinct-category photos; cover stays in coverPhoto
  return p;
}

function formatLeanProperty(p) {
  if (typeof p.toJSON === 'function') return p.toJSON();
  const ret = { ...p };
  ret.id              = String(ret._id);
  ret.landlordId      = ret.ownerUserId ? String(ret.ownerUserId) : null;
  ret.landlordName    = ret.ownerName  || '';
  ret.hostTier        = ret.hostTier   || 'free';
  ret.gpsLat          = ret.gps && ret.gps.lat ? ret.gps.lat : null;
  ret.gpsLng          = ret.gps && ret.gps.lng ? ret.gps.lng : null;
  ret.gpsAddress      = ret.gps && ret.gps.address ? ret.gps.address : '';
  ret.rentalCategory  = ret.category;
  delete ret.searchHaystack;
  delete ret.ownerPhone;
  delete ret._id;
  return ret;
}

exports.createProperty = asyncH(async (req, res) => {
  const doc = await propertyService.createProperty({ body: req.body, user: req.user });
  res.status(201).json({ property: doc.toJSON() });
});

exports.getSuggestions = asyncH(async (req, res) => {
  const q = req.query.q || '';
  if (!q || q.length < 2) {
    return res.json({ suggestions: [] });
  }
  const suggestions = await propertyService.getSuggestions(q);
  res.json({ suggestions });
});

exports.getProperties = asyncH(async (req, res) => {
  const parsed = propertyValidators.listQuery.safeParse(req.query);
  if (!parsed.success) {
    throw ApiError.badRequest('Query params সঠিক নয়।', {
      code: 'validation_error',
      details: parsed.error.issues.map((i) => ({
        path: i.path.join('.'), message: i.message,
      })),
    });
  }
  const out = await propertyService.listProperties(parsed.data);
  const items = out.items.map((d) => trimForListCard(formatLeanProperty(d)));
  await attachHostTiers(items);
  res.json({
    properties: items,
    total: out.total,
    page:  out.page,
    limit: out.limit,
  });
});

// Stamp each list item with its host's ENTITLED subscription tier
// ('free' | 'plus' | 'pro') so cards can render Plus/Pro badges, the gold
// card and Top Position tags. Looked up fresh per request (one batched query)
// instead of denormalised onto the property, so an expired subscription drops
// its badges immediately.
//
// The launch trial counts: a landlord on the 2-month free Pro trial is on
// "Pro Mode", badge and Gold Card included. tierOf() expiry-checks both the
// paid period and the trial window, so a lapsed host still falls back to free.
async function attachHostTiers(items) {
  try {
    const ids = [...new Set(items.map((p) => p.landlordId).filter(Boolean))];
    if (!ids.length) return items;
    const now = new Date();
    const subs = await Subscription.find({
      userId: { $in: ids },
      $or: [
        { status: 'active' },
        { status: 'trialing', trialEndsAt: { $gt: now } },
      ],
    }).select('userId planId status trialTier trialEndsAt currentPeriodEnd').lean();
    const tierByUser = {};
    for (const s of subs) {
      tierByUser[String(s.userId)] = tierOf(s, now);
    }
    
    // Batch lookup landlord reviews
    const mongoose = require('mongoose');
    const objectIds = ids.filter(id => mongoose.Types.ObjectId.isValid(id)).map(id => new mongoose.Types.ObjectId(String(id)));
    const reviewStats = await Review.aggregate([
      { $match: { revieweeId: { $in: objectIds }, revieweeRole: 'landlord' } },
      { $group: { _id: '$revieweeId', avg: { $avg: '$rating' }, count: { $sum: 1 } } }
    ]);
    const reviewsByLandlord = {};
    for (const r of reviewStats) {
      reviewsByLandlord[String(r._id)] = {
        rating: Math.round(r.avg * 10) / 10,
        reviews: r.count
      };
    }

    // Landlord avatars for the card's owner chip. The Property document only
    // ever snapshotted ownerName/ownerPhone — never an avatar — so
    // `landlordAvatar` was undefined on every card and the chip always fell
    // back to the name's first letter. Read it live from the owner instead of
    // snapshotting: it's one indexed _id lookup per PAGE (ids are already
    // de-duplicated above, ≤1 per card), it stays correct when a landlord
    // changes their photo, and it needs no backfill for existing listings.
    //
    // Scoped to its own try/catch: this runs BEFORE the assignment loop below,
    // so letting it throw into the outer handler would cost every card its
    // tier badge and rating too. An avatar is the least important thing here —
    // it must never take the rest of the chip down with it.
    const avatarByUser = {};
    try {
      const users = await User.find({ _id: { $in: objectIds } }).select('avatar').lean();
      for (const u of users) {
        const a = String(u.avatar || '').trim();
        // Ship http(s) URLs ONLY — the same rule the listing pipeline's
        // httpOnly() applies to photos. User.avatar also accepts an inline
        // `data:` URL of up to 2MB, and 50 of those in one feed response is
        // precisely the payload/OOM blowup that guard exists to prevent. Those
        // cards keep the initial-letter fallback, which is a fine degradation.
        if (/^https?:\/\//i.test(a)) avatarByUser[String(u._id)] = a;
      }
    } catch (e) {
      console.warn('[properties] landlord avatar lookup failed:', e.message);
    }

    items.forEach((p) => {
      p.hostTier = tierByUser[p.landlordId] || 'free';
      const stats = reviewsByLandlord[p.landlordId];
      p.rating = stats ? stats.rating : 0;
      p.reviews = stats ? stats.reviews : 0;
      p.landlordAvatar = avatarByUser[p.landlordId] || '';
    });
  } catch (e) {
    // Badges are decorative — never let this lookup break the listing feed.
    console.warn('[properties] hostTier lookup failed:', e.message);
    items.forEach((p) => { if (!p.hostTier) p.hostTier = 'free'; });
  }
  return items;
}

exports.getPropertyById = asyncH(async (req, res) => {
  const doc = await propertyService.getPropertyById(req.params.id);
  const property = doc.toJSON();
  const summary = await Review.summaryFor(property.ownerUserId, 'landlord');
  property.rating = summary.avg;
  property.reviews = summary.count;
  res.json({ property });
});

exports.updateProperty = asyncH(async (req, res) => {
  const doc = await propertyService.updateProperty({
    idOrSlug: req.params.id,
    body: req.body,
    user: req.user,
  });
  res.json({ property: doc.toJSON() });
});

exports.deleteProperty = asyncH(async (req, res) => {
  const out = await propertyService.deleteProperty({
    idOrSlug: req.params.id,
    user: req.user,
  });
  res.json({ ok: true, ...out });
});

exports.getHostProperties = asyncH(async (req, res) => {
  const items = await propertyService.listMyProperties(req.user);
  const formattedItems = items.map((d) => trimForListCard(formatLeanProperty(d)));
  await attachHostTiers(formattedItems);
  res.json({ properties: formattedItems });
});
