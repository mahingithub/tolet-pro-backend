'use strict';

/**
 * Public landlord profile controller.
 *
 *   GET /api/landlords/:id
 *
 * Returns a sanitised view of a landlord, suitable for rendering the
 * <LandlordProfile /> page on the frontend without revealing any private
 * fields. Anyone (even unauthenticated visitors) can call this — that's
 * the point. It only ever exposes what the landlord has voluntarily put
 * on the public side of their profile.
 */

const mongoose = require('mongoose');
const User     = require('../models/User');
const Property = require('../models/Property');

function isObjectId(v) {
  return mongoose.Types.ObjectId.isValid(String(v));
}

async function getLandlord(req, res, next) {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) return res.status(404).json({ message: 'Landlord not found' });

    const user = await User.findById(id).lean();
    if (!user) return res.status(404).json({ message: 'Landlord not found' });

    // A landlord must actually *be* a landlord. If they only carry the
    // 'tenant' role we treat this URL as 404 to avoid leaking that the
    // user exists.
    const isLandlord = Array.isArray(user.roles)
      ? user.roles.includes('landlord')
      : user.role === 'landlord';
    if (!isLandlord) return res.status(404).json({ message: 'Landlord not found' });

    // ── Derive cheap aggregates from their property list. We intentionally
    // skip ratings / reviews aggregates for now — pending the rating
    // pipeline. The frontend already handles missing values.
    const properties = await Property.find({
      ownerUserId: user._id,
      status: 'active',
    }).lean();

    const totalProperties = properties.length;
    const createdAt       = user.createdAt || new Date();
    const memberSince     = createdAt.getFullYear ? createdAt.getFullYear().toString()
                                                  : new Date(createdAt).getFullYear().toString();

    // Roadmap-v2 §6 / Q4 approved answer — "Show 'New host' badge for first
    // 30 days." The flag is computed on the server so the frontend never
    // has to reason about dates; we only ever set it true while the
    // account has < 30 days of history AND has zero rating signal so far
    // (rating pipeline lands later; until then we treat the field as 0).
    const ageMs    = Date.now() - new Date(createdAt).getTime();
    const isNew    = ageMs < 30 * 24 * 60 * 60 * 1000;

    // ── Identity + Property verification ──────────────────────────────────
    // After the dual-path refactor we track TWO independent verification
    // blocks per user:
    //
    //   tenantProfile.verification    — NID + photo + profession proof
    //   landlordProfile.verification  — propertyAddress + utility bill
    //
    // The public landlord card needs both so it can render an honest
    // breakdown: "Identity verified" + "Property verified". We expose
    // them separately AND compute a flat top-level summary the existing
    // frontend resolver can keep using without changes.
    const tv = user.tenantProfile?.verification   || {};
    const lv = user.landlordProfile?.verification || {};

    const phoneVerified = user.phoneVerified === true || !!user.phone;

    // Identity-side: status reflects what the tenant queue approved.
    const identityStatus = tv.status || 'unverified';
    // Property-side: status reflects what the landlord queue approved.
    const propertyStatus = lv.status || 'unverified';

    // "Fully verified" landlord = both queues green-lit. This is the
    // signal the blue tick + landlord badge keys off.
    const fullyVerified = identityStatus === 'verified' && propertyStatus === 'verified';

    const verification = {
      // Top-level summary the legacy resolver in LandlordProfile reads.
      // We keep "status" as the identity status so the existing
      // resolver's idStatus fallback chain still does the right thing.
      status:          identityStatus,
      idStatus:        identityStatus,
      idVerified:      identityStatus === 'verified',
      // Phone OTP is implicit at signup.
      phoneVerified,
      emailVerified:   !!user.emailVerified,
      // Address verification is gated on the property KYC, not the
      // tenant identity KYC.
      addressStatus:   propertyStatus,
      addressVerified: propertyStatus === 'verified',

      // Granular per-side blocks for the new dual-badge UI. Backwards-
      // compatible because the legacy resolver only touches the flat
      // fields above.
      tenant:   {
        status:                identityStatus,
        photoVerified:         !!tv.photo           && identityStatus === 'verified',
        nidVerified:           !!(tv.nidFront && tv.nidBack) && identityStatus === 'verified',
        professionVerified:    !!tv.professionProof && identityStatus === 'verified',
      },
      landlord: {
        status:                propertyStatus,
        utilityBillVerified:   !!lv.utilityBillUrl  && propertyStatus === 'verified',
        addressVerified:       !!lv.propertyAddress && propertyStatus === 'verified',
        // Surface the address itself so the public card can show "Property
        // in Dhanmondi" without leaking the rest of the user record.
        propertyAddress:       lv.propertyAddress   || '',
      },
    };

    // ── Trust score ───────────────────────────────────────────────────────
    // Per-side trust numbers come straight from each profile sub-doc
    // (computed server-side in the User pre-save hook). We surface the
    // landlord side as the headline number because this IS the landlord
    // profile page; tenant trust is exposed too so the page can render
    // a secondary chip for users who hold both roles.
    const landlordTrust = user.landlordProfile?.trustScore ?? 0;
    const tenantTrust   = user.tenantProfile?.trustScore   ?? 0;

    return res.json({
      landlord: {
        id:              String(user._id),
        name:            user.name,
        avatar:          user.avatar || '',
        coverImage:      '',  // not yet captured anywhere — placeholder
        tagline:         '',
        bio:             '',
        // "verified" is the strict "blue tick" signal — both queues green.
        verified:        fullyVerified,
        phoneVerified,
        rating:          0,
        totalReviews:    0,
        responseRate:    null,
        responseTime:    '—',
        memberSince,
        createdAt,
        isNew,
        totalProperties,
        preferredTenants: user.landlordProfile?.preferredTenants || [],
        communication:   user.landlordProfile?.communication || [],
        houseRules:      user.landlordProfile?.houseRules || [],
        serviceCharge:   user.landlordProfile?.serviceCharge ?? null,
        badges:          [],
        verification,
        // Headline = landlord trust. Falls back to tenant trust when the
        // landlord side hasn't accumulated points yet (e.g. fresh signup
        // who's only verified identity).
        trustScore:      landlordTrust || tenantTrust,
        trustTier:       user.landlordProfile?.trustTier || user.tenantProfile?.trustTier || 'bronze',
        // Per-side breakdown for advanced UI.
        tenantTrustScore:   tenantTrust,
        landlordTrustScore: landlordTrust,
      },
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getLandlord };