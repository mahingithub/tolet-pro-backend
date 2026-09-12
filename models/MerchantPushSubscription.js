'use strict';

/**
 * MerchantPushSubscription — a shopkeeper's device, for web push.
 * ─────────────────────────────────────────────────────────────────────────────
 * Its OWN collection, not a widened PushSubscription. That model's `userId` is
 * `ref: 'User'` and `required: true`, and a merchant is not a User — the two
 * collections have independent id spaces. Bolting an `ownerType` discriminator
 * onto the shared model would re-couple the two identity systems the merchant
 * separation exists to keep apart, the same argument that gave ProviderReview
 * its own collection and kept the merchant refresh token off RefreshToken.
 *
 * What is NOT duplicated is the sending: services/push.service.js owns the VAPID
 * setup, the payload encoding and the prune-on-410 rule, and both collections
 * go through it. Two tables, one delivery path.
 *
 * ─── WHY A SHOPKEEPER NEEDS THIS AT ALL ──────────────────────────────────────
 * An order gives him 30 minutes to answer before it expires, the tenant is told
 * nobody replied, and the silence counts against him. Until now his only
 * channel was WhatsApp — which is throttled, costs money on the SMS fallback,
 * and is a different app he has to switch to. Push puts the order on the lock
 * screen of the phone already in his hand, and the WhatsApp message becomes the
 * FALLBACK rather than the only hope.
 */

const mongoose = require('mongoose');

const MerchantPushSubscriptionSchema = new mongoose.Schema(
  {
    merchantId: {
      type: mongoose.Schema.Types.ObjectId, ref: 'Merchant', required: true, index: true,
    },

    // The browser's push endpoint. Unique across the collection: re-subscribing
    // on the same device must UPDATE the row rather than accumulate one per
    // page load, or a shopkeeper who opens the app daily ends up with a
    // thousand dead endpoints and every notification is sent a thousand times.
    endpoint: { type: String, required: true, unique: true },

    keys: {
      p256dh: String,
      auth: String,
    },

    // Best-effort device label for a future "signed in on 3 devices" screen.
    // Never shown to anyone but the owner.
    device: { type: String, default: '', maxlength: 200 },

    // Bumped on every successful send, so a stale endpoint that has not been
    // pruned yet is still visible as stale.
    lastSentAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// "Every device this shopkeeper has", which is the only query that runs.
MerchantPushSubscriptionSchema.index({ merchantId: 1, createdAt: -1 });

module.exports = mongoose.models.MerchantPushSubscription
  || mongoose.model('MerchantPushSubscription', MerchantPushSubscriptionSchema);
