'use strict';

// ─── Facebook Page Auto-Post Service ───────────────────────────────────────
// Posts property listings to a Facebook Page automatically when a new property
// is created.  Uses the Facebook Graph API v21.0.
//
// Required env vars:
//   FACEBOOK_PAGE_ID            – numeric Page ID
//   FACEBOOK_PAGE_ACCESS_TOKEN  – long-lived Page Access Token
//   FRONTEND_BASE_URL           – e.g. https://tolet-pro.vercel.app
//
// If any of these are missing the service silently no-ops so existing
// behaviour is completely unaffected.
// ────────────────────────────────────────────────────────────────────────────

const FB_API       = 'https://graph.facebook.com/v21.0';
const PAGE_ID      = process.env.FACEBOOK_PAGE_ID;
const ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
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

// ─── Caption Builder ────────────────────────────────────────────────────────

/**
 * Build a marketing-ready caption from property data.
 * Location goes FIRST (area → district → division).
 */
function buildCaption(property) {
  const lines = [];

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
async function uploadUnpublishedPhoto(imageUrl) {
  const url = `${FB_API}/${PAGE_ID}/photos`;
  const params = new URLSearchParams({
    url:          imageUrl,
    published:    'false',
    access_token: ACCESS_TOKEN,
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
async function publishMultiPhotoPost(caption, mediaFbIds) {
  const url = `${FB_API}/${PAGE_ID}/feed`;

  const body = new URLSearchParams({
    message:      caption,
    access_token: ACCESS_TOKEN,
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
async function publishSinglePhotoPost(caption, imageUrl) {
  const url = `${FB_API}/${PAGE_ID}/photos`;
  const params = new URLSearchParams({
    url:          imageUrl,
    message:      caption,
    access_token: ACCESS_TOKEN,
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
async function publishTextPost(caption, link) {
  const url = `${FB_API}/${PAGE_ID}/feed`;
  const params = new URLSearchParams({
    message:      caption,
    access_token: ACCESS_TOKEN,
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

// ─── Main Entry Point ───────────────────────────────────────────────────────

/**
 * Post a property listing to the configured Facebook Page.
 *
 * - Multiple images → gallery post
 * - Single image   → photo post
 * - No images      → text post with link
 *
 * This function NEVER throws. All errors are caught and logged.
 */
async function postToFacebookPage(property) {
  // Guard: skip if Facebook is not configured
  if (!PAGE_ID || !ACCESS_TOKEN) {
    return;
  }

  try {
    const { text: caption, link } = buildCaption(property);
    const imageUrls = collectImageUrls(property);

    if (imageUrls.length > 1) {
      // ── Multi-photo gallery post ──────────────────────────────────────
      const uploadPromises = imageUrls.map((imgUrl) =>
        uploadUnpublishedPhoto(imgUrl),
      );
      const mediaFbIds = await Promise.all(uploadPromises);
      const result = await publishMultiPhotoPost(caption, mediaFbIds);
      console.log('[FacebookService] Multi-photo post published:', result.id);

    } else if (imageUrls.length === 1) {
      // ── Single photo post ─────────────────────────────────────────────
      const result = await publishSinglePhotoPost(caption, imageUrls[0]);
      console.log('[FacebookService] Single-photo post published:', result.id || result.post_id);

    } else {
      // ── Text-only post ────────────────────────────────────────────────
      const result = await publishTextPost(caption, link);
      console.log('[FacebookService] Text post published:', result.id);
    }
  } catch (err) {
    // Log but NEVER propagate — property creation must not be affected.
    console.error('[FacebookService] Failed to post to Facebook:', err.message);
  }
}

module.exports = { postToFacebookPage, buildCaption };
