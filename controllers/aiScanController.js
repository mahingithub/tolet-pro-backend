'use strict';

/**
 * AI Ledger Scanner Controller
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/ai/scan-ledger
 *
 * Accepts a base64-encoded image of a handwritten rent ledger (খাতা) and uses
 * the Gemini Vision API to extract structured tenant data from it.
 *
 * The response is an array of parsed tenant objects — each is a draft booking
 * that the frontend fills into a preview form for the landlord to review before
 * calling POST /api/bookings/batch to save them all at once.
 *
 * Flow:
 *   1. Client sends { imageBase64, mimeType, defaultSettings }
 *   2. We build a strict Gemini prompt asking for JSON output only
 *   3. Parse + validate the JSON, flag low-confidence fields
 *   4. Return { tenants: [...], rawText } to the client
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const ApiError = require('../utils/ApiError');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ── Gemini prompt ─────────────────────────────────────────────────────────────
// Written in plain English so the model doesn't get confused by Bangla
// instructions mixed with Bangla data. We want STRICT JSON only in the response.
const SCAN_PROMPT = `You are an expert at reading Bangladeshi rent ledger books (ভাড়ার খাতা). 
The image contains a handwritten or printed list of tenants and their rent information.

Extract ALL tenant entries visible in the image and return ONLY a valid JSON array. 
Do NOT include any explanation, markdown code blocks, or extra text — ONLY the raw JSON array.

Each tenant object in the array must have EXACTLY these fields:
{
  "name": "string — tenant full name (Bengali or English), empty string if unreadable",
  "phone": "string — 11-digit BD mobile number, empty string if not found",
  "monthlyRent": number — monthly rent amount in BDT (integer), 0 if not found,
  "advancePayment": number — security deposit or advance amount in BDT, 0 if not found,
  "roomNumber": "string — room/flat number if visible, empty string otherwise",
  "floorNumber": "string — floor number if visible, empty string otherwise",
  "notes": "string — any extra notes visible for this tenant",
  "confidence": {
    "name": number between 0 and 1,
    "phone": number between 0 and 1,
    "monthlyRent": number between 0 and 1
  }
}

Rules:
- If a field is illegible or absent, use the default value shown above.
- For phone numbers: extract only if you are confident it is a valid BD number (01xxxxxxxxx format).
- For amounts: extract only the numeric value (no ৳ or commas).
- confidence scores: 1.0 = certain, 0.5 = guessed, 0.0 = not found.
- If you see no tenant data at all, return an empty array: []

Return ONLY the JSON array, nothing else.`;

// ── Helpers ───────────────────────────────────────────────────────────────────

// Validate a BD mobile number: must be 11 digits starting with 01[3-9]
function isValidBDPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  return /^01[3-9]\d{8}$/.test(d);
}

// Sanitise a single parsed tenant, applying the landlord's default settings
// and flagging fields whose AI confidence is below the threshold (< 0.65).
function sanitiseTenant(raw = {}, defaults = {}) {
  const confidence = (raw.confidence && typeof raw.confidence === 'object')
    ? raw.confidence
    : { name: 0, phone: 0, monthlyRent: 0 };

  const phone = isValidBDPhone(raw.phone) ? String(raw.phone).replace(/\D/g, '') : '';

  return {
    // ── AI-extracted fields ──────────────────────────────────
    name:           String(raw.name || '').trim().slice(0, 100),
    phone,
    monthlyRent:    Math.max(0, Number(raw.monthlyRent) || 0),
    advancePayment: Math.max(0, Number(raw.advancePayment) || 0),
    roomNumber:     String(raw.roomNumber || '').trim().slice(0, 20),
    floorNumber:    String(raw.floorNumber || '').trim().slice(0, 20),
    notes:          String(raw.notes || '').trim().slice(0, 300),

    // ── Defaults from landlord profile (pre-filled in the preview form) ──
    rentDueDay:      defaults.rentDueDay      ?? 5,
    paymentMethod:   defaults.paymentMethod   || '',
    reminderLeadDays: defaults.reminderLeadDays ?? 3,
    autoReminder:    defaults.autoReminder    !== false,
    property:        defaults.property        || '',
    location:        defaults.location        || '',
    leaseStart:      defaults.leaseStart      || new Date().toISOString().split('T')[0],

    // ── UI helpers: flag uncertain fields for the landlord to review ──────
    _flags: {
      nameLow:         confidence.name         < 0.65,
      phoneLow:        confidence.phone        < 0.65 || !phone,
      monthlyRentLow:  confidence.monthlyRent  < 0.65,
    },
    _confidence: confidence,
  };
}

// ── Controller ────────────────────────────────────────────────────────────────

async function scanLedger(req, res, next) {
  try {
    const { imageBase64, mimeType = 'image/jpeg', defaultSettings = {} } = req.body;

    if (!imageBase64) {
      throw ApiError.badRequest('imageBase64 is required.');
    }

    // Strip data-URI prefix if the client sent a full data URL
    const base64Clean = imageBase64.replace(/^data:[^;]+;base64,/, '');

    // Safety: rough size check (max ~8 MB base64 ≈ 10.9 MB raw)
    if (base64Clean.length > 11_000_000) {
      throw ApiError.badRequest('Image too large. Please use an image under 8 MB.');
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const result = await model.generateContent([
      SCAN_PROMPT,
      {
        inlineData: {
          mimeType: mimeType,
          data: base64Clean,
        },
      },
    ]);

    const rawText = result.response.text().trim();

    // Strip potential markdown code fences (```json ... ```) that Gemini
    // sometimes adds despite the instruction.
    const jsonStr = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      // Gemini didn't return clean JSON — return empty with the raw text so
      // the frontend can still surface a helpful "no data found" state.
      return res.json({
        tenants: [],
        rawText,
        parseError: true,
        message: 'Could not extract structured data. Try a clearer image.',
      });
    }

    if (!Array.isArray(parsed)) {
      return res.json({
        tenants: [],
        rawText,
        parseError: true,
        message: 'Unexpected response format. Try a clearer image.',
      });
    }

    // Sanitise every entry and apply landlord defaults
    const tenants = parsed
      .filter(t => t && typeof t === 'object')
      .map(t => sanitiseTenant(t, defaultSettings))
      // Drop completely empty rows (no name AND no rent)
      .filter(t => t.name || t.monthlyRent > 0);

    return res.json({
      tenants,
      count: tenants.length,
      rawText,
    });
  } catch (err) {
    // If it's a Gemini API error, it won't be an instance of ApiError, 
    // so it normally falls through to a generic 500. Let's expose it for debugging.
    if (err.message && err.message.includes('GoogleGenerativeAI')) {
      return next(ApiError.badRequest(`Gemini Error: ${err.message}`));
    }
    return next(err);
  }
}

// ── Batch booking creation ─────────────────────────────────────────────────────
// POST /api/bookings/batch
// The frontend calls this after the landlord reviews the scanned data and
// clicks "Save All". We reuse the same validation/defaults as createBooking.

async function batchCreateBookings(req, res, next) {
  try {
    const { tenants } = req.body;

    if (!Array.isArray(tenants) || tenants.length === 0) {
      throw ApiError.badRequest('tenants array is required and must not be empty.');
    }
    if (tenants.length > 50) {
      throw ApiError.badRequest('Maximum 50 tenants per batch.');
    }

    const Booking = require('../models/Booking');
    const User    = require('../models/User');

    // Helper to resolve a user by phone (reuse from createBooking scope)
    async function resolveUserIdByPhone(phone) {
      const d = String(phone || '').replace(/\D/g, '');
      const core = d.length >= 10 ? d.slice(-10) : '';
      if (!core) return null;
      try {
        const user = await User.findOne({ phone: new RegExp(`${core}$`) }).select('_id').lean();
        return user?._id || null;
      } catch {
        return null;
      }
    }

    // Generate a short unique invite code
    function genCode() {
      const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let s = '';
      for (let i = 0; i < 6; i++) s += alpha[Math.floor(Math.random() * alpha.length)];
      return s;
    }
    async function uniqueCode() {
      for (let i = 0; i < 6; i++) {
        const c = genCode();
        // eslint-disable-next-line no-await-in-loop
        if (!(await Booking.exists({ inviteCode: c }))) return c;
      }
      return genCode() + genCode().slice(0, 3); // longer fallback
    }

    const created = [];
    const errors  = [];

    for (const [idx, t] of tenants.entries()) {
      try {
        const rent = Number(t.monthlyRent);
        if (!rent || rent <= 0) {
          errors.push({ idx, name: t.name, reason: 'monthlyRent must be > 0' });
          continue;
        }
        if (!t.name || !String(t.name).trim()) {
          errors.push({ idx, name: t.name, reason: 'name is required' });
          continue;
        }

        // eslint-disable-next-line no-await-in-loop
        const linkedTenantId = t.tenantPhone
          // eslint-disable-next-line no-await-in-loop
          ? await resolveUserIdByPhone(t.tenantPhone || t.phone)
          : null;

        const leaseStart = t.leaseStart ? new Date(t.leaseStart) : new Date();
        if (Number.isNaN(leaseStart.getTime())) leaseStart.setTime(Date.now());

        // eslint-disable-next-line no-await-in-loop
        const inviteCode = await uniqueCode();

        // eslint-disable-next-line no-await-in-loop
        const booking = await Booking.create({
          landlordId:       req.user._id,
          tenantId:         linkedTenantId,
          property:         String(t.property || '').trim(),
          location:         String(t.location || '').trim(),
          tenant:           String(t.name || '').trim(),
          tenantPhone:      String(t.phone || '').trim() || null,
          monthlyRent:      rent,
          advancePayment:   Math.max(0, Number(t.advancePayment) || 0),
          paymentMethod:    String(t.paymentMethod || '').trim(),
          serviceCharge:    Math.max(0, Number(t.serviceCharge) || 0),
          rentDueDay:       Number(t.rentDueDay) || 5,
          reminderLeadDays: Number(t.reminderLeadDays) || 3,
          autoReminder:     t.autoReminder !== false,
          leaseStart,
          leaseEnd:         t.leaseEnd ? new Date(t.leaseEnd) : null,
          floorNumber:      String(t.floorNumber || '').trim(),
          roomNumber:       String(t.roomNumber || '').trim(),
          notes:            String(t.notes || '').trim(),
          dealType:         t.dealType === 'commercial' ? 'commercial' : 'residential',
          lateFeeAmount:    Math.max(0, Math.min(100000, Number(t.lateFeeAmount) || 0)),
          gracePeriodDays:  Math.max(0, Math.min(28, Number(t.gracePeriodDays) ?? 5)),
          members:          [],
          inviteCode,
        });

        created.push(booking);
      } catch (err) {
        errors.push({ idx, name: t.name, reason: err.message });
      }
    }

    return res.status(201).json({
      created: created.length,
      errors:  errors.length,
      bookings: created,
      errorDetails: errors,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { scanLedger, batchCreateBookings };
