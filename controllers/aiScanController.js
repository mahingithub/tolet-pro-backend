'use strict';

/**
 * AI Scan Controller — খাতা (rent ledger) and ভর্তি ফরম (admission form)
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
function sanitiseTenant(raw = {}, defaults = {}, isFormMode = false) {
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

    // The person, in the SAME shape the manual form writes — so a scanned
    // tenant and a hand-typed one are the same record, validated by the same
    // rules. Empty in খাতা mode: a ledger page has none of this on it.
    moveInDate: String(raw.moveInDate || '').trim(),
    tenantProfile: isFormMode ? profileFromForm(raw) : {},

    // ── UI helpers: flag uncertain fields for the landlord to review ──────
    _flags: {
      nameLow:         confidence.name         < 0.65,
      phoneLow:        confidence.phone        < 0.65 || !phone,
      monthlyRentLow:  confidence.monthlyRent  < 0.65,
    },
    _confidence: confidence,
  };
}

// ── Admission-form mode ───────────────────────────────────────────────────────
// A খাতা page physically contains names, rooms and amounts — never a father's
// name or an NID. Those live on the ভর্তি ফরম the landlord already collects, one
// page per tenant, so reading THAT is where the real time saving is.
//
// The fields below are exactly the 11 the landlord marked, and nothing else.
// Every one is optional: a form with half the boxes blank produces a tenant
// with half the fields blank, which is a valid record.
const FORM_PROMPT = `You are reading a Bangladeshi tenant / hostel admission form (ভর্তি ফরম).
The image contains ONE tenant's filled-in details, handwritten or printed, in Bengali or English.

Return ONLY a valid JSON array containing exactly ONE object. No markdown, no explanation.

{
  "name": "string — tenant's full name (ভাড়াটিয়ার নাম), empty string if unreadable",
  "phone": "string — 11-digit BD mobile (01xxxxxxxxx), empty string if not found",
  "roomNumber": "string — room/flat number (রুম/ফ্ল্যাট নম্বর), empty if absent",
  "floorNumber": "string — floor if visible, empty otherwise",
  "moveInDate": "string — move-in date as YYYY-MM-DD, empty if absent or unclear",
  "fatherName": "string — father's name (পিতার নাম), empty if absent",
  "dob": "string — date of birth as YYYY-MM-DD, empty if absent",
  "maritalStatus": "one of: single, married, divorced, widowed, or empty string",
  "permanentAddress": "string — permanent address (স্থায়ী ঠিকানা), empty if absent",
  "tenantType": "one of: student, employee, business, freelancer, other, or empty string",
  "organization": "string — university, company or business name, empty if absent",
  "department": "string — department (students only), empty if absent",
  "professionalIdNumber": "string — student ID / employee ID / trade licence number, empty if absent",
  "govtIdType": "one of: nid, passport, or empty string",
  "govtIdNumber": "string — NID or passport number, empty if absent",
  "emergencyName": "string — emergency contact name, empty if absent",
  "emergencyRelation": "string — relation e.g. Father, Mother, empty if absent",
  "emergencyPhone": "string — emergency contact mobile, empty if absent",
  "emergencyAddress": "string — emergency contact address, empty if absent",
  "confidence": { "name": 0..1, "phone": 0..1, "govtIdNumber": 0..1 }
}

Rules:
- Leave a field as an empty string when it is blank, illegible or absent. NEVER guess.
- Occupation words map to tenantType: ছাত্র/শিক্ষার্থী/student → "student";
  চাকরি/চাকরিজীবী/service/job → "employee"; ব্যবসা/ব্যবসায়ী/business → "business";
  ফ্রিল্যান্সার/freelance → "freelancer"; anything else readable → "other".
- Phone: only if it looks like a valid BD mobile.
- Dates: convert any format you see to YYYY-MM-DD.
- Return [] if this is not a tenant form.

Return ONLY the JSON array.`;

// The 11 marked fields, as they are stored on a tenant profile. Read off a
// form; blank whenever the form was blank.
const PROFILE_KEYS = [
  'fatherName', 'dob', 'maritalStatus', 'permanentAddress',
  'tenantType', 'organization', 'department', 'professionalIdNumber',
  'govtIdType', 'govtIdNumber',
  'emergencyName', 'emergencyRelation', 'emergencyPhone', 'emergencyAddress',
];

// Turn a scanned form into the SAME tenantProfile shape the manual form writes.
//
// The আছে/নেই gates matter here: an ID number is only ever required because the
// tenant said they have one, so reading a number off a form has to ALSO answer
// the question — otherwise the number is stored while the form still shows
// "নেই" and hides the field it belongs to.
function profileFromForm(raw = {}) {
  const p = {};
  PROFILE_KEYS.forEach((k) => { p[k] = String(raw[k] || '').trim(); });

  if (!['single', 'married', 'divorced', 'widowed'].includes(p.maritalStatus)) p.maritalStatus = '';
  if (!['student', 'employee', 'business', 'freelancer', 'other'].includes(p.tenantType)) p.tenantType = '';
  if (!['nid', 'passport'].includes(p.govtIdType)) p.govtIdType = '';

  // A number on the page IS the "আছে" answer. No number ⇒ unanswered (''), NOT
  // "নেই" — the scanner cannot tell "has none" from "wasn't filled in", and
  // asserting the stronger claim on the tenant's behalf would be wrong.
  p.govtIdStatus = p.govtIdNumber ? 'has' : '';
  if (!p.govtIdStatus) { p.govtIdType = ''; p.govtIdNumber = ''; }
  p.professionalIdStatus = p.professionalIdNumber ? 'has' : '';

  // Department only means anything for a student, per the marked form.
  if (p.tenantType !== 'student') p.department = '';
  return p;
}

// ── Controller ────────────────────────────────────────────────────────────────

async function scanLedger(req, res, next) {
  try {
    const { imageBase64, mimeType = 'image/jpeg', defaultSettings = {}, mode = 'khata' } = req.body;

    if (!imageBase64) {
      throw ApiError.badRequest('imageBase64 is required.');
    }

    // Strip data-URI prefix if the client sent a full data URL
    const base64Clean = imageBase64.replace(/^data:[^;]+;base64,/, '');

    // Safety: rough size check (max ~8 MB base64 ≈ 10.9 MB raw)
    if (base64Clean.length > 11_000_000) {
      throw ApiError.badRequest('Image too large. Please use an image under 8 MB.');
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });

    // খাতা = many tenants, few fields. ভর্তি ফরম = one tenant, nearly all of them.
    const isFormMode = mode === 'form';
    const result = await model.generateContent([
      isFormMode ? FORM_PROMPT : SCAN_PROMPT,
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
      .map(t => sanitiseTenant(t, defaultSettings, isFormMode))
      // Drop completely empty rows (no name AND no rent)
      .filter(t => t.name || t.monthlyRent > 0);

    return res.json({
      tenants,
      count: tenants.length,
      rawText,
    });
  } catch (err) {
    if (err.message && err.message.includes('GoogleGenerativeAI')) {
      // Send a user-friendly message but append the real error for debugging
      return next(ApiError.internal(`AI স্ক্যানিং ব্যর্থ: ${err.message}`));
    }
    return next(err);
  }
}

// ── Batch booking creation ─────────────────────────────────────────────────────
// POST /api/bookings/batch
// The frontend calls this after the landlord reviews the scanned data and
// clicks "Save All". We reuse the same validation/defaults as createBooking.

// ── Batch save ────────────────────────────────────────────────────────────────
// POST /api/bookings/batch   body: { buildingId, tenants: [...] }
//
// Scanned tenants are placed through EXACTLY the same code as hand-typed ones:
// each is put INTO a unit via placeTenantInUnit(). That matters for two
// reasons. It used to be a separate Booking.create() that set no buildingId and
// no unitId, so every scanned lease landed unlinked to any building — the same
// orphaning bug we removed from every other screen, surviving in the one path
// nobody looked at. And a khata page listing four names in room 301 now
// produces ONE room with four seats, not four unrelated bookings.
//
// Rooms named on the page but not yet created are created here, because that is
// what the landlord means by scanning a ledger: the book IS the building.
async function batchCreateBookings(req, res, next) {
  try {
    const { tenants, buildingId } = req.body;

    if (!Array.isArray(tenants) || tenants.length === 0) {
      throw ApiError.badRequest('tenants array is required and must not be empty.');
    }
    if (tenants.length > 50) {
      throw ApiError.badRequest('Maximum 50 tenants per batch.');
    }

    const mongoose = require('mongoose');
    const Building = require('../models/Building');
    const Unit     = require('../models/Unit');
    const buildingCtrl = require('./building.controller');

    if (!mongoose.Types.ObjectId.isValid(String(buildingId || ''))) {
      throw ApiError.badRequest('বিল্ডিং বাছুন — কোন বিল্ডিংয়ে যোগ হবে তা জানা দরকার।');
    }
    const building = await Building.findOne({ _id: buildingId, landlordId: req.user._id });
    if (!building) throw ApiError.notFound('বিল্ডিং পাওয়া যায়নি।');

    // Floor arrives as free text off a page: "3rd", "৩য়", "3", "". Pull a
    // number out so the room can be ordered; unparseable means ground floor.
    const BN = { '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9' };
    const parseFloor = (raw) => {
      const s = String(raw ?? '').replace(/[০-৯]/g, (d) => BN[d] || d);
      const m = /-?\d+/.exec(s);
      const n = m ? parseInt(m[0], 10) : 0;
      return Number.isFinite(n) ? Math.max(-5, Math.min(200, n)) : 0;
    };

    const created = [];
    const errors  = [];
    // Two names in room 301 must resolve to the SAME room, so cache per batch.
    const unitCache = new Map();

    for (const [idx, t] of tenants.entries()) {
      try {
        const name = String(t.name || '').trim();
        if (!name) throw new Error('নাম নেই');
        const phone = String(t.phone || '').trim();
        if (!phone) throw new Error('মোবাইল নম্বর নেই');

        const floor = parseFloor(t.floorNumber);
        const roomNumber = String(t.roomNumber || '').trim();
        if (!roomNumber) throw new Error('রুম/ফ্ল্যাট নম্বর নেই');

        const key = `${floor}|${roomNumber.toLowerCase()}`;
        let unit = unitCache.get(key);
        if (!unit) {
          // eslint-disable-next-line no-await-in-loop
          unit = await Unit.findOne({ buildingId: building._id, roomNumber, floor, status: 'active' });
          if (!unit) {
            // eslint-disable-next-line no-await-in-loop
            unit = await Unit.create({
              buildingId: building._id,
              landlordId: req.user._id,
              floor,
              roomNumber,
              // Starts at one and grows below as more names in the same room
              // turn up. Guessing higher would invent vacant seats that may not
              // exist; the page is the only evidence of how many people are
              // actually in the room.
              seatCapacity: 1,
              monthlyRent:   Number(t.monthlyRent) > 0 ? Number(t.monthlyRent) : building.defaultMonthlyRent,
              serviceCharge: building.defaultServiceCharge,
              rentDueDay:    Number(t.rentDueDay) || building.defaultRentDueDay,
            });
          }
          unitCache.set(key, unit);
        }

        // Another name in a room we already filled ⇒ the room holds more seats
        // than we knew. Grow it rather than rejecting the tenant: the page is
        // the evidence of how many people actually live there.
        if (building.rentedAs === 'seat') {
          // eslint-disable-next-line no-await-in-loop
          const live = await buildingCtrl.liveBookingForUnit(unit._id);
          const taken = live && Array.isArray(live.members)
            ? live.members.filter((m) => m && m.status !== 'moved-out').length : 0;
          if (taken >= (Number(unit.seatCapacity) || 1)) {
            unit.seatCapacity = Math.min(60, taken + 1);
            // eslint-disable-next-line no-await-in-loop
            await unit.save();
          }
        }

        // eslint-disable-next-line no-await-in-loop
        const out = await buildingCtrl.placeTenantInUnit({
          landlordId: req.user._id,
          unit,
          building,
          input: buildingCtrl.tenantInputFrom({
            name,
            phone,
            moveInDate: t.moveInDate || t.leaseStart,
            tenantProfile: t.tenantProfile || {},
          }),
        });
        created.push({ bookingId: String(out.booking._id), memberId: out.memberId, name, roomNumber });
      } catch (err) {
        errors.push({ index: idx, name: t.name || '(no name)', reason: err.message });
      }
    }

    return res.status(created.length ? 201 : 400).json({
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
