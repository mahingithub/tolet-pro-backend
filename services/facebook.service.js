'use strict';

const path = require('path');
const os   = require('os');
const fs   = require('fs');

// ─── Facebook Page Auto-Post Service ───────────────────────────────────────
// Posts property listings to a Facebook Page automatically when a new property
// is created.  Uses the Facebook Graph API v21.0.
//
// Required env vars:
//   FACEBOOK_PAGE_ID            – numeric Page ID
//   FACEBOOK_PAGE_ACCESS_TOKEN  – long-lived Page Access Token (SEED value)
//   FRONTEND_BASE_URL           – e.g. https://tolet-pro.vercel.app
//
// The access token is NOT read straight from the env var at post time — it's
// obtained from services/facebookToken.service.js, which keeps a fresh,
// auto-refreshed token in the database (the env var only seeds it the first
// time). That way this service always posts with a valid token even after the
// original ~60-day token would have expired.
//
// If the Page ID or token are missing the service silently no-ops so existing
// behaviour is completely unaffected.
// ────────────────────────────────────────────────────────────────────────────

const fbToken = require('./facebookToken.service');

const FB_API       = 'https://graph.facebook.com/v21.0';
const FRONTEND_URL = (process.env.FRONTEND_BASE_URL || '').replace(/\/+$/, '');

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Capitalise the first letter of a string and replace underscores with spaces.
 * e.g. "single_room" → "Single Room"
 */
function humanise(str) {
  if (!str) return '';
  return str
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Format price in Bangladeshi style: ৳25,000
 */
function formatPrice(price) {
  if (!price && price !== 0) return '';
  return `৳${Number(price).toLocaleString('en-BD')}`;
}

/**
 * Collect every image URL from the property document.
 * Returns an array of absolute Cloudinary URLs.
 */
function collectImageUrls(property) {
  const urls = [];

  // Cover photo first
  const cover = property.coverPhoto || '';
  if (cover && cover.startsWith('http')) {
    urls.push(cover);
  }

  // Room photos
  const rooms = Array.isArray(property.roomPhotos) ? property.roomPhotos : [];
  for (const rp of rooms) {
    const url = (rp && (rp.url || rp.preview)) || '';
    if (url && url.startsWith('http')) {
      urls.push(url);
    }
  }

  return urls;
}

/**
 * Collect every uploadable video URL from the property document.
 * Only Cloudinary-hosted (https) URLs are returned — YouTube IDs are handled
 * separately in the caption.
 */
function collectVideoUrls(property) {
  const urls = [];

  // Legacy single-video field
  const legacy = property.videoUrl || '';
  if (legacy && legacy.startsWith('http')) {
    urls.push(legacy);
  }

  // Multi-video array
  const videos = Array.isArray(property.videos) ? property.videos : [];
  for (const v of videos) {
    const url = (v && v.url) || '';
    if (url && url.startsWith('http') && !urls.includes(url)) {
      urls.push(url);
    }
  }

  return urls;
}

/**
 * Collect YouTube video IDs from the property document.
 * Used to add YouTube links in the caption when no uploadable video exists.
 */
function collectYoutubeIds(property) {
  const ids = [];

  const legacy = property.videoId || '';
  if (legacy) ids.push(legacy);

  const videos = Array.isArray(property.videos) ? property.videos : [];
  for (const v of videos) {
    const ytId = (v && v.youtubeId) || '';
    if (ytId && !ids.includes(ytId)) ids.push(ytId);
  }

  return ids;
}

// ─── Caption Builder ────────────────────────────────────────────────────────

/**
 * Build a marketing-ready caption from property data.
 * Location goes FIRST (area → district → division).
 */
function buildCaption(property, { superBoost = false } = {}) {
  const lines = [];

  // ── Pro "Super Boost" banner ──────────────────────────────────────────
  // Pro listings lead with a featured banner so they stand out in the feed.
  // NOTE: this is organic differentiation only — it does NOT buy paid reach.
  // True paid boosting needs the Facebook Marketing API and an ad account
  // with a funded payment method; see the note in postToFacebookPage.
  if (superBoost) {
    lines.push('⭐ FEATURED LISTING ⭐');
    lines.push('');
  }

  // ── Location block (always first) ─────────────────────────────────────
  const area     = property.area     || '';
  const district = property.district || '';
  const division = property.division || '';

  const locationParts = [area, district, humanise(division)].filter(Boolean);
  if (locationParts.length) {
    lines.push(`📍 ${locationParts.join(', ')}`);
  }

  const specificLocation = property.location || '';
  if (specificLocation) {
    lines.push(`📌 ${specificLocation}`);
  }

  lines.push(''); // blank line separator

  // ── Property type & intent ────────────────────────────────────────────
  const beds   = property.beds || '';
  const type   = humanise(property.type) || 'Property';
  const intent = property.intent === 'sale' ? 'for Sale' : property.intent === 'commercial' ? 'for Commercial Use' : 'for Rent';

  const headline = beds ? `🏠 ${beds} Bedroom ${type} ${intent}` : `🏠 ${type} ${intent}`;
  lines.push(headline);

  // ── Price ─────────────────────────────────────────────────────────────
  if (property.price) {
    const suffix = property.intent === 'sale' ? '' : '/month';
    lines.push(`💰 ${formatPrice(property.price)}${suffix}`);
  }

  // ── Quick specs ───────────────────────────────────────────────────────
  const specs = [];
  if (property.beds)  specs.push(`🛏️ ${property.beds} Beds`);
  if (property.baths) specs.push(`🚿 ${property.baths} Baths`);
  if (property.sqft)  specs.push(`📐 ${property.sqft} sqft`);
  if (specs.length) {
    lines.push(specs.join(' | '));
  }

  // ── Furnishing ────────────────────────────────────────────────────────
  if (property.furnishing && property.furnishing !== 'Unfurnished') {
    lines.push(`🪑 ${property.furnishing}`);
  }

  // ── Floor ─────────────────────────────────────────────────────────────
  if (property.floorNumber && property.floorNumber > 0) {
    lines.push(`🏢 Floor: ${property.floorNumber}`);
  }

  // ── Category ──────────────────────────────────────────────────────────
  if (property.category) {
    lines.push(`👥 ${humanise(property.category)}`);
  }

  // ── Amenities ─────────────────────────────────────────────────────────
  const amenities = Array.isArray(property.amenities) ? property.amenities : [];
  if (amenities.length) {
    lines.push('');
    lines.push(`✨ Amenities: ${amenities.join(', ')}`);
  }

  // ── CTA + link ────────────────────────────────────────────────────────
  const propertyId = property._id || property.id;
  const link = FRONTEND_URL ? `${FRONTEND_URL}/property/${propertyId}` : '';

  // ── YouTube walkthrough link(s) ───────────────────────────────────
  const ytIds = collectYoutubeIds(property);
  if (ytIds.length) {
    lines.push('');
    lines.push('🎬 Video walkthrough:');
    for (const ytId of ytIds) {
      lines.push(`▶️ https://youtu.be/${ytId}`);
    }
  }

  lines.push('');
  lines.push('👉 Full details, more photos & owner contact:');
  if (link) {
    lines.push(`🔗 ${link}`);
  }

  return { text: lines.join('\n'), link };
}

// ─── Facebook Graph API Calls ───────────────────────────────────────────────

/**
 * Upload a single photo to the Facebook Page as UNPUBLISHED.
 * Returns the media_fbid needed for multi-photo posts.
 */
async function uploadUnpublishedPhoto(pageId, accessToken, imageUrl) {
  const url = `${FB_API}/${pageId}/photos`;
  const params = new URLSearchParams({
    url:          imageUrl,
    published:    'false',
    access_token: accessToken,
  });

  const res = await fetch(url, {
    method: 'POST',
    body:   params,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FB photo upload failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  return data.id; // media_fbid
}

/**
 * Publish a multi-photo post (gallery) to the Facebook Page.
 */
async function publishMultiPhotoPost(pageId, accessToken, caption, mediaFbIds) {
  const url = `${FB_API}/${pageId}/feed`;

  const body = new URLSearchParams({
    message:      caption,
    access_token: accessToken,
  });

  // Attach each photo as attached_media[i]
  mediaFbIds.forEach((fbId, i) => {
    body.append(`attached_media[${i}]`, JSON.stringify({ media_fbid: fbId }));
  });

  const res = await fetch(url, {
    method: 'POST',
    body,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FB multi-photo post failed (${res.status}): ${err}`);
  }

  return res.json();
}

/**
 * Publish a single-photo post to the Facebook Page.
 */
async function publishSinglePhotoPost(pageId, accessToken, caption, imageUrl) {
  const url = `${FB_API}/${pageId}/photos`;
  const params = new URLSearchParams({
    url:          imageUrl,
    message:      caption,
    access_token: accessToken,
  });

  const res = await fetch(url, {
    method: 'POST',
    body:   params,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FB single-photo post failed (${res.status}): ${err}`);
  }

  return res.json();
}

/**
 * Publish a text-only post (with link) to the Facebook Page.
 */
async function publishTextPost(pageId, accessToken, caption, link) {
  const url = `${FB_API}/${pageId}/feed`;
  const params = new URLSearchParams({
    message:      caption,
    access_token: accessToken,
  });
  if (link) {
    params.set('link', link);
  }

  const res = await fetch(url, {
    method: 'POST',
    body:   params,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FB text post failed (${res.status}): ${err}`);
  }

  return res.json();
}

// ─── Video Upload Helpers ───────────────────────────────────────────────────

/**
 * Download a video from a URL (e.g. Cloudinary) into a temporary file.
 * Returns the absolute path to the temp file. Caller MUST delete it when done.
 */
async function downloadToTempFile(videoUrl) {
  const ext = path.extname(new URL(videoUrl).pathname) || '.mp4';
  const tmpFile = path.join(os.tmpdir(), `fb_upload_${Date.now()}${ext}`);

  const res = await fetch(videoUrl);
  if (!res.ok) {
    throw new Error(`Failed to download video (${res.status}): ${videoUrl}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(tmpFile, buffer);
  return tmpFile;
}

/**
 * Upload a video file to a Facebook Page using multipart/form-data.
 *
 * Facebook's /{page-id}/videos endpoint requires the actual binary file data
 * sent as the `source` field in a multipart form. We download the Cloudinary
 * video to a temp file, build the multipart body manually (using the built-in
 * FormData available in Node 18+), and POST it.
 *
 * The response includes the video post's `id`.
 */
async function publishVideoPost(pageId, accessToken, caption, videoFilePath) {
  const url = `${FB_API}/${pageId}/videos`;

  const formData = new FormData();

  const videoBuffer = fs.readFileSync(videoFilePath);
  const fileName = path.basename(videoFilePath);

  // Create a Blob from the buffer (globalThis.Blob available in Node 18+)
  const videoBlob = new Blob([videoBuffer], { type: 'video/mp4' });

  formData.set('access_token', accessToken);
  formData.set('description', caption);
  formData.set('source', videoBlob, fileName);

  const res = await fetch(url, {
    method: 'POST',
    body:   formData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FB video upload failed (${res.status}): ${err}`);
  }

  return res.json();
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

/**
 * Post a property listing to the configured Facebook Page.
 *
 * - Multiple images → gallery post
 * - Single image   → photo post
 * - No images      → text post with link
 *
 * This function NEVER throws. All errors are caught and logged.
 *
 * GATING: the caller (services/property.service.js) only invokes this for Plus
 * and Pro hosts — Facebook posting is a paid perk. `opts.superBoost` marks a
 * Pro listing so its caption leads with a FEATURED banner.
 *
 * LIMITATION: "Boost" here means an organic Page post, not paid reach. Buying
 * actual ad delivery requires the Facebook Marketing API plus a funded ad
 * account, which is not wired up.
 */
async function postToFacebookPage(property, opts = {}) {
  // Pull the CURRENT (auto-refreshed) token + page id from the token service.
  // These come from the DB row the refresh job keeps fresh, so we never post
  // with a stale/expired env value.
  const pageId      = fbToken.getCachedPageId();
  const accessToken = await fbToken.getPageAccessToken();

  // Guard: skip if Facebook is not configured
  if (!pageId || !accessToken) {
    return;
  }

  try {
    const { text: caption, link } = buildCaption(property, opts);
    const imageUrls = collectImageUrls(property);
    const videoUrls = collectVideoUrls(property);

    // ── 1) Video post (highest priority — video walkthroughs are the
    //       primary listing media per the design brief) ──────────────────
    if (videoUrls.length > 0) {
      let tmpFile = null;
      try {
        // Download the first video from Cloudinary to a temp file
        tmpFile = await downloadToTempFile(videoUrls[0]);
        const result = await publishVideoPost(pageId, accessToken, caption, tmpFile);
        console.log('[FacebookService] Video post published:', result.id);
      } finally {
        // Always clean up the temp file
        if (tmpFile) {
          try { fs.unlinkSync(tmpFile); } catch (_) { /* best-effort cleanup */ }
        }
      }

      // If there are also images, publish them as a separate gallery post
      // so the listing gets maximum visibility on the Page feed.
      if (imageUrls.length > 1) {
        try {
          const uploadPromises = imageUrls.map((imgUrl) =>
            uploadUnpublishedPhoto(pageId, accessToken, imgUrl),
          );
          const mediaFbIds = await Promise.all(uploadPromises);
          const galCaption = `📸 More photos — ${property.title || 'Property'}\n\n🔗 ${link || ''}`;
          const result = await publishMultiPhotoPost(pageId, accessToken, galCaption, mediaFbIds);
          console.log('[FacebookService] Gallery post (alongside video) published:', result.id);
        } catch (galErr) {
          console.warn('[FacebookService] Gallery alongside video failed (video was posted):', galErr.message);
        }
      } else if (imageUrls.length === 1) {
        try {
          const imgCaption = `📸 Cover photo — ${property.title || 'Property'}\n\n🔗 ${link || ''}`;
          const result = await publishSinglePhotoPost(pageId, accessToken, imgCaption, imageUrls[0]);
          console.log('[FacebookService] Photo post (alongside video) published:', result.id || result.post_id);
        } catch (imgErr) {
          console.warn('[FacebookService] Photo alongside video failed (video was posted):', imgErr.message);
        }
      }

    // ── 2) Multi-photo gallery post ─────────────────────────────────────
    } else if (imageUrls.length > 1) {
      const uploadPromises = imageUrls.map((imgUrl) =>
        uploadUnpublishedPhoto(pageId, accessToken, imgUrl),
      );
      const mediaFbIds = await Promise.all(uploadPromises);
      const result = await publishMultiPhotoPost(pageId, accessToken, caption, mediaFbIds);
      console.log('[FacebookService] Multi-photo post published:', result.id);

    // ── 3) Single photo post ────────────────────────────────────────────
    } else if (imageUrls.length === 1) {
      const result = await publishSinglePhotoPost(pageId, accessToken, caption, imageUrls[0]);
      console.log('[FacebookService] Single-photo post published:', result.id || result.post_id);

    // ── 4) Text-only post (with link) ───────────────────────────────────
    } else {
      const result = await publishTextPost(pageId, accessToken, caption, link);
      console.log('[FacebookService] Text post published:', result.id);
    }
  } catch (err) {
    // Log but NEVER propagate — property creation must not be affected.
    console.error('[FacebookService] Failed to post to Facebook:', err.message);
  }
}

module.exports = { postToFacebookPage, buildCaption };
