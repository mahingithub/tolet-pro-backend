'use strict';

/**
 * CampaignLink model — the short, trackable link inside a marketing message.
 * ──────────────────────────────────────────────────────────────────────────
 * WHY A SHORT LINK RATHER THAN THE PLAIN URL
 *
 *   • SMS IS BILLED BY THE SEGMENT. A GSM-7 message is 160 characters; go one
 *     character over and the gateway bills two. A full deep link with campaign
 *     parameters ("https://www.toletpro.rent/subscription?utm_source=...") is
 *     ~70 characters of that budget before the copy even starts. `/r/AbC1234`
 *     on the same host is 30.
 *   • IT IS THE ONLY CLICK SIGNAL THESE CHANNELS HAVE. SMS and WhatsApp report
 *     delivery at best; nothing tells us whether anyone acted. The redirect is
 *     the one moment we get to observe, so it is where the counter lives.
 *
 * THE LINK IS MINTED ON THE PUBLIC APP HOST, NOT THE API HOST, and that is
 * deliberate: www.toletpro.rent is the domain verified in assetlinks.json, so
 * an Android device with the app installed opens `/r/<code>` INSIDE the app
 * (see DeepLinkHandler.jsx). A link on api.toletpro.rent would always bounce
 * the recipient into a browser and lose the session they already have.
 *
 * ONE CODE PER (CAMPAIGN, CHANNEL). A campaign blasted over SMS and WhatsApp
 * mints two codes pointing at the same page, so "which channel actually moved
 * people" is answerable — with a single shared code it is not.
 *
 * NO PER-RECIPIENT CODES, ON PURPOSE. A code that identifies one person turns
 * a forwarded message into a way to act as them, and these links are forwarded
 * constantly in group chats. Clicks are counted in aggregate; `signedInClicks`
 * only records THAT the clicker was logged in, never who.
 */

const mongoose = require('mongoose');

const CampaignLinkSchema = new mongoose.Schema(
  {
    // The short code in the URL path. Base62, generated in
    // services/campaignLink.service.js — case-sensitive, so it must never be
    // lowercased on the way in or out.
    code: { type: String, required: true, unique: true, trim: true, maxlength: 24 },

    // Where the click lands, as an IN-APP PATH ('/subscription',
    // '/property/665f…'). Never an absolute URL: this value is handed to the
    // router as a navigation target, and accepting an absolute URL here would
    // make the redirect an open redirect that our own domain vouches for.
    // Validated against utils/campaignTargets.js before a document is created.
    targetPath: { type: String, required: true, trim: true, maxlength: 512 },

    // Human label for the admin — the offer's title at send time.
    campaign: { type: String, trim: true, default: '', maxlength: 160 },

    // Which channel carried THIS code. 'sms' | 'whatsapp' | 'other'.
    channel: { type: String, trim: true, default: 'other', maxlength: 20, index: true },

    // The admin who sent the blast, for the audit trail.
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // How many recipients the blast attempted on this channel. Stored so a
    // click count can be read as a rate ("38 of 412") rather than a bare
    // number, which on its own says nothing about whether the campaign worked.
    audienceSize: { type: Number, default: 0, min: 0 },

    clicks:         { type: Number, default: 0, min: 0 },
    // Clicks that arrived with a valid session. The gap between this and
    // `clicks` is the signed-out half of the audience — the people for whom the
    // destination is a login wall, which is exactly who a re-engagement
    // campaign is aimed at.
    signedInClicks: { type: Number, default: 0, min: 0 },

    // NO `default: null` on firstClickAt, and that is load-bearing. The click
    // counter stamps it with `$min`, which only writes when the field is
    // ABSENT or the new value is smaller. BSON sorts null before every date,
    // so a stored null would win every comparison and the first-click time
    // would stay null forever. Leaving the path unset lets $min set it once,
    // on the first click, in the same atomic update as the counters.
    firstClickAt: { type: Date },
    lastClickAt:  { type: Date, default: null },
  },
  { timestamps: true },
);

CampaignLinkSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('CampaignLink', CampaignLinkSchema);
