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
 * Is this a Google Drive share link rather than a real media file?
 * Hosts may paste a Drive link instead of uploading, so `videos[].url` can hold
 * either. A Drive URL points at Drive's viewer page — the bytes are NOT directly
 * fetchable — so it can never be uploaded to Facebook; it only goes in the
 * caption as a link.
 */
function isGoogleDriveUrl(url) {
  return /^https?:\/\/(?:[\w-]+\.)*drive\.google\.com\//i.test(String(url || ''));
}

/**
 * Rewrite a Drive "…/view" share link to its "…/preview" embed form, matching
 * what the frontend VideoPlayer renders in an iframe. Query/hash noise (e.g.
 * `?usp=sharing`) is dropped so the printed link stays clean.
 */
function toGoogleDrivePreviewUrl(url) {
  const raw = String(url || '').trim();
  if (!isGoogleDriveUrl(raw)) return raw;
  const clean = raw.split(/[?#]/)[0].replace(/\/+$/, '');
  if (/\/preview$/i.test(clean)) return clean;
  if (/\/view$/i.test(clean)) return clean.replace(/\/view$/i, '/preview');
  // /file/d/<id> with no trailing verb → add /preview.
  if (/\/file\/d\/[^/]+$/i.test(clean)) return `${clean}/preview`;
  return clean;
}

/**
 * Every https video URL on the property, in one pass over both the legacy
 * scalar and the canonical `videos[]` array.
 */
function collectAllVideoUrls(property) {
  const urls = [];
  const push = (url) => {
    if (url && url.startsWith('http') && !urls.includes(url)) urls.push(url);
  };

  push(property.videoUrl || ''); // legacy single-video mirror of videos[0]

  const videos = Array.isArray(property.videos) ? property.videos : [];
  for (const v of videos) push((v && v.url) || '');

  return urls;
}

/**
 * Collect every UPLOADABLE video URL — files Facebook can actually ingest
 * (Cloudinary MP4s and friends). Google Drive links are excluded: they are
 * viewer pages, not media, so they belong in the caption only.
 */
function collectVideoUrls(property) {
  return collectAllVideoUrls(property).filter((url) => !isGoogleDriveUrl(url));
}

/**
 * Collect Google Drive walkthrough links, normalised to their /preview form.
 */
function collectDriveUrls(property) {
  return collectAllVideoUrls(property)
    .filter(isGoogleDriveUrl)
    .map(toGoogleDrivePreviewUrl);
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

  // ── Video & YouTube links ─────────────────────────────────────────
  const ytIds    = collectYoutubeIds(property);
  const driveUrls = collectDriveUrls(property);
  const videoUrls = collectVideoUrls(property);

  if (ytIds.length > 0 || driveUrls.length > 0 || videoUrls.length > 0) {
    lines.push('');
    lines.push('🎬 Video walkthrough:');

    // Add YouTube links
    for (const ytId of ytIds) {
      lines.push(`▶️ https://youtu.be/${ytId}`);
    }

    // Add Google Drive links. Always printed: a Drive clip can't be uploaded to
    // the Page, so this link is the ONLY way viewers reach it.
    for (const dUrl of driveUrls) {
      lines.push(`▶️ ${dUrl}`);
    }

    // Add raw MP4 links (only if we don't have a YouTube/Drive version to avoid
    // spam — and note the file itself is uploaded as its own video post).
    if (ytIds.length === 0 && driveUrls.length === 0 && videoUrls.length > 0) {
      for (const vUrl of videoUrls) {
        lines.push(`▶️ ${vUrl}`);
      }
    }
  }

  lines.push('');
  lines.push('👉 Full details & owner contact:');
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

// ─── Video Uploads ──────────────────────────────────────────────────────────
//
// Both endpoints below take the raw bytes as multipart/form-data. We fetch the
// hosted (Cloudinary) file into memory and forward it, because Facebook's
// `file_url` parameter is unreliable for Pages and gives no useful error when
// it fails. Node 18+ ships fetch/FormData/Blob globally, so no extra dep.

const MAX_VIDEO_UPLOAD_BYTES = 200 * 1024 * 1024; // FB rejects far beyond this

/**
 * Download a hosted video into a Blob so it can be attached to a FormData.
 * Throws if the file is missing or implausibly large (guards the Node heap —
 * the whole clip is buffered in memory).
 */
async function fetchVideoBlob(videoUrl) {
  const res = await fetch(videoUrl);
  if (!res.ok) {
    throw new Error(`Could not download video (${res.status}): ${videoUrl}`);
  }

  const declared = Number(res.headers.get('content-length') || 0);
  if (declared && declared > MAX_VIDEO_UPLOAD_BYTES) {
    throw new Error(`Video too large to upload (${declared} bytes): ${videoUrl}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_VIDEO_UPLOAD_BYTES) {
    throw new Error(`Video too large to upload (${buf.length} bytes): ${videoUrl}`);
  }

  const contentType = res.headers.get('content-type') || 'video/mp4';
  return new Blob([buf], { type: contentType });
}

/**
 * Publish a standard video post to the Page feed (/{page-id}/videos).
 * Used when the listing ALSO has photos, so the gallery stays the lead post and
 * the video is a normal follow-up rather than a Reel.
 */
async function publishVideoPost(pageId, accessToken, caption, videoUrl) {
  const blob = await fetchVideoBlob(videoUrl);

  const form = new FormData();
  form.append('access_token', accessToken);
  form.append('description', caption);
  form.append('source', blob, 'walkthrough.mp4');

  const res = await fetch(`${FB_API}/${pageId}/videos`, {
    method: 'POST',
    body:   form,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FB video post failed (${res.status}): ${err}`);
  }

  return res.json();
}

/**
 * Publish a video as a Facebook Reel (/{page-id}/video_reels).
 *
 * Reels use a 3-step protocol — start (get an upload session), upload the bytes
 * to the returned rupload URL, then finish to publish. Unlike /videos this is
 * NOT a single multipart call.
 */
async function publishReel(pageId, accessToken, caption, videoUrl) {
  const blob = await fetchVideoBlob(videoUrl);

  // 1) start — reserve an upload session
  const startRes = await fetch(`${FB_API}/${pageId}/video_reels`, {
    method: 'POST',
    body:   new URLSearchParams({
      upload_phase: 'start',
      access_token: accessToken,
    }),
  });
  if (!startRes.ok) {
    const err = await startRes.text();
    throw new Error(`FB reel start failed (${startRes.status}): ${err}`);
  }
  const { video_id: videoId, upload_url: uploadUrl } = await startRes.json();
  if (!videoId || !uploadUrl) {
    throw new Error('FB reel start returned no video_id / upload_url');
  }

  // 2) upload — raw binary body to the rupload host, NOT multipart
  const bytes = Buffer.from(await blob.arrayBuffer());
  const uploadRes = await fetch(uploadUrl, {
    method:  'POST',
    headers: {
      Authorization:  `OAuth ${accessToken}`,
      offset:         '0',
      file_size:      String(bytes.length),
      'Content-Type': 'application/octet-stream',
    },
    body: bytes,
  });
  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`FB reel upload failed (${uploadRes.status}): ${err}`);
  }

  // 3) finish — publish the reel with the caption
  const finishParams = new URLSearchParams({
    access_token: accessToken,
    video_id:     videoId,
    upload_phase: 'finish',
    video_state:  'PUBLISHED',
    description:  caption,
  });
  const finishRes = await fetch(`${FB_API}/${pageId}/video_reels?${finishParams}`, {
    method: 'POST',
  });
  if (!finishRes.ok) {
    const err = await finishRes.text();
    throw new Error(`FB reel finish failed (${finishRes.status}): ${err}`);
  }

  const result = await finishRes.json();
  return { id: videoId, ...result };
}
// ─── Main Entry Point ───────────────────────────────────────────────────────

/**
 * Post a property listing to the configured Facebook Page.
 *
 * Photos and an uploaded video become TWO SEPARATE posts, both carrying the
 * exact same full caption (website link + video links):
 *
 *   photos + video → 1) photo gallery / single photo   2) video post (/videos)
 *   video only     → Reel (/video_reels)
 *   photos only    → gallery / single photo post
 *   neither        → text post with link
 *
 * Mixed media in ONE post is not possible: the Graph API cannot attach an MP4
 * and JPGs to a single organic feed post — hence the two-post split. A Reel is
 * used only for a video with no photos, where nothing else competes to lead.
 * Google Drive links are never uploaded (they are viewer pages, not files); they
 * ride along in the caption.
 *
 * This function NEVER throws. All errors are caught and logged, and the photo
 * post is attempted independently of the video post so one failing does not
 * suppress the other.
 */
async function postToFacebookPage(property, opts = {}) {
  // Pull the CURRENT (auto-refreshed) token + page id from the token service.
  const pageId      = fbToken.getCachedPageId();
  const accessToken = await fbToken.getPageAccessToken();

  // Guard: skip if Facebook is not configured
  if (!pageId || !accessToken) {
    return;
  }

  // Both posts share ONE caption, built once.
  const { text: caption, link } = buildCaption(property, opts);
  const imageUrls = collectImageUrls(property);
  const videoUrls = collectVideoUrls(property); // uploadable only — no Drive links
  const hasImages = imageUrls.length > 0;
  const hasVideo  = videoUrls.length > 0;

  // ── Post 1: photos (gallery / single), or a text post when there is no
  //           media at all. Skipped entirely when the listing is video-only,
  //           because the Reel below carries the caption instead.
  if (hasImages || !hasVideo) {
    try {
      if (imageUrls.length > 1) {
        const mediaFbIds = await Promise.all(
          imageUrls.map((imgUrl) => uploadUnpublishedPhoto(pageId, accessToken, imgUrl)),
        );
        const result = await publishMultiPhotoPost(pageId, accessToken, caption, mediaFbIds);
        console.log('[FacebookService] Multi-photo post published:', result.id);

      } else if (imageUrls.length === 1) {
        const result = await publishSinglePhotoPost(pageId, accessToken, caption, imageUrls[0]);
        console.log('[FacebookService] Single-photo post published:', result.id || result.post_id);

      } else {
        const result = await publishTextPost(pageId, accessToken, caption, link);
        console.log('[FacebookService] Text post published:', result.id);
      }
    } catch (err) {
      // Log but NEVER propagate — property creation must not be affected.
      console.error('[FacebookService] Failed to post photos to Facebook:', err.message);
    }
  }

  // ── Post 2: the video. A standard video post when photos exist (the gallery
  //           already leads), a Reel when the video is the only media.
  if (hasVideo) {
    const videoUrl = videoUrls[0]; // videos[0] is the main walkthrough
    try {
      if (hasImages) {
        const result = await publishVideoPost(pageId, accessToken, caption, videoUrl);
        console.log('[FacebookService] Video post published:', result.id);
      } else {
        const result = await publishReel(pageId, accessToken, caption, videoUrl);
        console.log('[FacebookService] Reel published:', result.id);
      }
    } catch (err) {
      console.error('[FacebookService] Failed to post video to Facebook:', err.message);
    }
  }
}

module.exports = {
  postToFacebookPage,
  buildCaption,
  // Exported for tests / reuse — Drive links are handled identically here and
  // in the frontend VideoPlayer.
  isGoogleDriveUrl,
  toGoogleDrivePreviewUrl,
};
