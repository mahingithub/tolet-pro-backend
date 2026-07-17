'use strict';

/**
 * FacebookToken model
 * ──────────────────────────────────────────────────────────────────────────
 * Persists the Facebook Graph API access token(s) so the long-lived token can
 * be refreshed automatically BEFORE its ~60-day expiry and the fresh value
 * survives server restarts.
 *
 * Why a DB row instead of just an env var?
 *   On hosts like Render the process environment is immutable at runtime — a
 *   value refreshed in-process would be lost on the next restart/redeploy. The
 *   env var (FACEBOOK_PAGE_ACCESS_TOKEN) is used only to SEED this row the very
 *   first time; from then on this document is the source of truth and the
 *   refresh job keeps it current.
 *
 * Single-row store: we only ever keep one document per `key` (default
 * 'facebook'). The unique index makes the upsert race-safe.
 *
 * Token fields:
 *   userAccessToken — the long-lived USER token. This is the one we re-exchange
 *                     via `oauth/access_token?grant_type=fb_exchange_token` to
 *                     mint a fresh token (each exchange resets the ~60d clock).
 *   pageAccessToken — the PAGE token derived from the user token, used to post
 *                     to the Facebook Page. Optional (only when tokenType=page).
 */

const mongoose = require('mongoose');

const FacebookTokenSchema = new mongoose.Schema(
  {
    // Logical name of this credential set. Keeping it keyed leaves room for a
    // second entry later (e.g. a WhatsApp Cloud API token) without a new model.
    key: { type: String, required: true, unique: true, default: 'facebook' },

    // 'user' → we only track/refresh a user token.
    // 'page' → we also derive + store a Page token for auto-posting.
    tokenType: { type: String, enum: ['user', 'page'], default: 'page' },

    // The long-lived user token used as the input to the next refresh.
    userAccessToken: { type: String, default: '' },

    // The Page token used for posting (derived from userAccessToken).
    pageAccessToken: { type: String, default: '' },

    // Numeric Facebook Page ID this Page token belongs to (for auditing).
    pageId: { type: String, default: '' },

    // When the tracked token expires. null = unknown / non-expiring. The job
    // refreshes once we're within `refreshBeforeDays` of this instant, which
    // keeps the real API-call cadence comfortably under 60 days.
    expiresAt: { type: Date, default: null },

    // Bookkeeping for observability / debugging.
    lastRefreshedAt:    { type: Date, default: null },
    lastRefreshStatus:  { type: String, enum: ['ok', 'error', 'skipped', 'seeded'], default: 'seeded' },
    lastError:          { type: String, default: '' },
    refreshCount:       { type: Number, default: 0 },
  },
  { timestamps: true },
);

// NEVER leak raw tokens if this doc is ever serialized into an API response or
// a log. Consumers that genuinely need the token read the field directly off
// the document; JSON output only carries redacted metadata.
FacebookTokenSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    ret.hasUserToken = Boolean(ret.userAccessToken);
    ret.hasPageToken = Boolean(ret.pageAccessToken);
    delete ret.userAccessToken;
    delete ret.pageAccessToken;
    return ret;
  },
});

module.exports = mongoose.model('FacebookToken', FacebookTokenSchema);
