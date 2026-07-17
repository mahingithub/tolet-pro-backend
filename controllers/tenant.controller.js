'use strict';

/**
 * Public tenant profile controller — the privacy-gated "trust card".
 *
 *   GET /api/tenants/:id
 *
 * Three audiences:
 *   1. The tenant themselves           → full unlock
 *   2. A landlord with an active link  → full unlock (phone + email visible)
 *      (active link = at least one Inquiry where this user is the
 *       inquirer and the caller owns the property being inquired about,
 *       OR a future Booking record once those exist)
 *   3. Anyone else (anonymous / random) → trust card only — name, avatar,
 *      profession, trust score, badges. NO phone, NO email, NO DOB.
 *
 * If `tenantProfile.publicVisible === false`, audiences (2) and (3) get 404.
 * The tenant themselves can always pull their own record (use /me for
 * the writable view; this endpoint is read-only).
 */

const mongoose = require('mongoose');
const User     = require('../models/User');
const Inquiry  = require('../models/Inquiry');
const Review   = require('../models/Review');

function isObjectId(v) {
  return mongoose.Types.ObjectId.isValid(String(v));
}

// Decide whether `callerId` (the logged-in user, may be null) is allowed
// to see the private fields of tenant `targetId`.
async function callerHasUnlockLink(callerId, targetId) {
  if (!callerId) return false;
  if (String(callerId) === String(targetId)) return true;

  // Active or new inquiry from the tenant → caller is the landlord.
  const link = await Inquiry.findOne({
    inquirerUserId:   targetId,
    propertyOwnerId:  callerId,
    status:           { $ne: 'rejected' },
  }).lean();

  return !!link;
}

async function getTenant(req, res, next) {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) return res.status(404).json({ message: 'Tenant not found' });

    const user = await User.findById(id).lean();
    if (!user) return res.status(404).json({ message: 'Tenant not found' });

    const callerId   = req.user?._id || null;
    const isSelf     = callerId && String(callerId) === String(user._id);
    const tp         = user.tenantProfile || {};

    // Privacy switch — once the user opts out of public discoverability
    // we 404 to non-self callers.
    if (!isSelf && tp.publicVisible === false) {
      return res.status(404).json({ message: 'Tenant not found' });
    }

    const unlocked = isSelf || (await callerHasUnlockLink(callerId, user._id));

    const v = tp.verification || {};

    // Roadmap-v2 §6 / Q4 approved answer — "Show 'New host' badge for the
    // first 30 days." Mirror that rule on the tenant side so a landlord
    // hitting a brand-new tenant card sees the same "New on TO-LET PRO"
    // badge the frontend already renders for landlords. Computed server
    // side so the frontend never has to reason about dates.
    const createdAt = user.createdAt || new Date();
    const ageMs     = Date.now() - new Date(createdAt).getTime();
    const isNew     = ageMs < 30 * 24 * 60 * 60 * 1000;

    // Person-to-person rating: reviews others have left about this user AS A
    // TENANT (e.g. landlords rating a past tenant). Computed on read. This is a
    // public trust signal, so it's always included (not privacy-gated).
    const ratingSummary = await Review.summaryFor(user._id, 'tenant');

    const trustCard = {
      id:              String(user._id),
      name:            user.name,
      avatar:          user.avatar || '',
      professionType:  tp.professionType || '',
      trustScore:      tp.trustScore || 0,
      trustTier:       tp.trustTier  || 'bronze',
      memberSinceYear: tp.memberSinceYear || new Date(createdAt).getFullYear(),
      createdAt,
      isNew,
      verification: {
        // Booleans only — the actual document blobs never leave the API,
        // they live in your upload store. The frontend just renders the
        // ticks.
        photo:              !!v.photo,
        nidFront:           !!v.nidFront,
        nidBack:            !!v.nidBack,
        submittedForReview: !!v.submittedForReview,
        status:             v.status || 'unverified',
      },
      // Always-public summary signal so the host knows whether to engage.
      phoneOtpVerified:  !!user.phoneVerified,
      // Person-to-person rating (public trust signal).
      rating:            ratingSummary.avg,
      totalReviews:      ratingSummary.count,
    };

    // ─── Privacy-gated extras ────────────────────────────────────────────
    // ONLY surfaced to:
    //   • the tenant themselves
    //   • a landlord with an active inquiry / booking link
    if (unlocked) {
      trustCard.unlocked     = true;
      trustCard.phone        = user.phone || '';
      trustCard.email        = user.email || '';
      trustCard.dateOfBirth  = user.dateOfBirth || null;
      // Map Blueprint v2 fields to the expected frontend structure
      trustCard.professionDetails = {
        institution: tp.workPlace || '',
        studentId:   tp.workPlaceId || '',
        company:     tp.workPlace || '',
        officeId:    tp.workPlaceId || '',
      };
      trustCard.emergencyContact  = tp.emergencyContact || {};
      trustCard.familySize        = tp.familySize || '';
      trustCard.unlockReason = isSelf ? 'self' : 'inquiry-or-booking';
    } else {
      trustCard.unlocked     = false;
      trustCard.unlockReason = 'public-card-only';
    }

    return res.json({ tenant: trustCard });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getTenant };
