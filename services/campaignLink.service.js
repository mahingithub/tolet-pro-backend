'use strict';

/**
 * campaignLink.service.js — mint and resolve the short links in campaigns.
 * ──────────────────────────────────────────────────────────────────────────
 * See models/CampaignLink.js for why these exist at all (SMS segment cost, and
 * the fact that a click is the only signal SMS/WhatsApp give us).
 *
 * NEVER THROWS ON THE SEND PATH. `mint()` resolves to `null` if the database
 * refuses the write, and marketing.service falls back to the full URL. A
 * campaign that cannot be measured is a much smaller problem than a campaign
 * that cannot be sent, and the blast is already half-dispatched by the time a
 * later recipient's link is built.
 */

const crypto = require('crypto');
const CampaignLink = require('../models/CampaignLink');
const { publicAppBaseUrl } = require('../utils/inviteToken');
const { normalizeTarget } = require('../utils/campaignTargets');

// Base62. Deliberately case-sensitive: 62^7 is ~3.5e12, so a 7-character code
// is unguessable in practice while staying short enough that the link fits in
// one SMS segment alongside real copy.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CODE_LEN = 7;

function randomCode() {
  // randomInt over the alphabet length avoids the modulo bias a naive
  // `randomBytes[i] % 62` introduces (256 is not a multiple of 62, so the first
  // 8 characters would come up ~1.6% more often than the rest).
  let out = '';
  for (let i = 0; i < CODE_LEN; i += 1) {
    out += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  return out;
}

/** The URL a recipient actually receives. */
function shortUrl(code) {
  return `${publicAppBaseUrl()}/r/${code}`;
}

/**
 * Create a short link for one (campaign, channel) pair.
 *
 * @param {object} opts
 *   targetPath   string  in-app path — re-validated here, not trusted
 *   campaign     string  label for the admin (the offer's title)
 *   channel      string  'sms' | 'whatsapp' | 'other'
 *   createdBy    ObjectId|null
 *   audienceSize number  recipients this channel will attempt
 * @returns {Promise<{ code: string, url: string, targetPath: string }|null>}
 */
async function mint({ targetPath, campaign = '', channel = 'other', createdBy = null, audienceSize = 0 }) {
  const target = normalizeTarget(targetPath);
  if (!target.ok) {
    // The controller validates first, so reaching here means a caller skipped
    // that. Refuse rather than mint a link to an unknown page.
    console.warn(`[campaignLink] refused to mint for "${targetPath}": ${target.reason}`);
    return null;
  }

  // Retry only on a duplicate-key collision. At 3.5e12 codes this is a
  // formality, but a silent overwrite of somebody else's live campaign link is
  // not a failure mode worth leaving open.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode();
    try {
      const doc = await CampaignLink.create({
        code,
        targetPath: target.path,
        campaign: String(campaign || '').slice(0, 160),
        channel,
        createdBy,
        audienceSize,
      });
      return { code: doc.code, url: shortUrl(doc.code), targetPath: doc.targetPath };
    } catch (err) {
      if (err && err.code === 11000) continue; // collision — draw again
      console.error('[campaignLink] mint failed:', err?.message);
      return null;
    }
  }
  console.error('[campaignLink] mint failed: 5 code collisions in a row');
  return null;
}

/**
 * Resolve a code and count the click in ONE round trip.
 *
 * The counters are incremented with $inc rather than read-modify-write: a
 * campaign link is by definition clicked by many people at the same moment, and
 * a load-then-save would lose most of them.
 *
 * @param {string} code
 * @param {{ signedIn?: boolean }} opts
 * @returns {Promise<{ targetPath: string, campaign: string, channel: string }|null>}
 */
async function resolveAndCount(code, { signedIn = false } = {}) {
  const clean = String(code || '').trim();
  // Shape check before touching the database, so a crawler hitting /r/<junk>
  // costs nothing.
  if (!/^[A-Za-z0-9]{4,24}$/.test(clean)) return null;

  const now = new Date();
  const doc = await CampaignLink.findOneAndUpdate(
    { code: clean },
    {
      $inc: { clicks: 1, ...(signedIn ? { signedInClicks: 1 } : {}) },
      $set: { lastClickAt: now },
      // Written exactly once, on the first click: $min sets an ABSENT field and
      // otherwise keeps the smaller (earlier) value. This is why the schema
      // leaves `firstClickAt` with no default — see the note there.
      $min: { firstClickAt: now },
    },
    { new: true, lean: true },
  );

  if (!doc) return null;
  return { targetPath: doc.targetPath, campaign: doc.campaign, channel: doc.channel };
}

/** Campaign links most recently sent, for the admin console's stats panel. */
async function recentLinks(limit = 20) {
  const rows = await CampaignLink.find({})
    .sort({ createdAt: -1 })
    .limit(Math.min(100, Math.max(1, Number(limit) || 20)))
    .lean();

  return rows.map((r) => ({
    code: r.code,
    url: shortUrl(r.code),
    campaign: r.campaign,
    channel: r.channel,
    targetPath: r.targetPath,
    audienceSize: r.audienceSize || 0,
    clicks: r.clicks || 0,
    signedInClicks: r.signedInClicks || 0,
    firstClickAt: r.firstClickAt || null,
    lastClickAt: r.lastClickAt || null,
    createdAt: r.createdAt,
  }));
}

module.exports = { mint, resolveAndCount, recentLinks, shortUrl };
