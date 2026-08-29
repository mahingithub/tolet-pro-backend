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

const ApiError = require('../utils/ApiError');

// ── AI backend toggle ─────────────────────────────────────────────────────────
// The scanner runs on ONE of two Google backends. Exactly one of the blocks
// below is live at a time, and switching is a matter of moving the `//` — here
// and at the matching `const model = ...` toggle inside scanLedger(). Both
// places must agree; nothing else in this file cares which one is running.
//
// === [PAUSED] Google AI Studio — GEMINI_API_KEY ===
// Bring this back when the Cloud credit runs out: uncomment the two lines
// below, comment out the Vertex block, and do the same at the model line in
// scanLedger(). GEMINI_API_KEY is still in .env, so nothing else changes.
// const { GoogleGenerativeAI } = require('@google/generative-ai');
// const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// === [ACTIVE] Vertex AI — bills against the Google Cloud $300 credit ===
const { VertexAI } = require('@google-cloud/vertexai');

const VERTEX_PROJECT  = process.env.VERTEX_PROJECT_ID || 'to-let-pro-14e09';
const VERTEX_LOCATION = process.env.VERTEX_LOCATION   || 'us-central1';
const VERTEX_MODEL    = process.env.VERTEX_MODEL      || 'gemini-2.5-flash';

// Service-account credentials — deliberately NOT a JSON key file sitting next
// to package.json. This backend deploys to Render straight from git (see
// render.yaml), so a key file in the tree is a private key pushed to the
// remote; .gitignore now catches the usual key filenames, but a filename it
// doesn't recognise would still go through. The project already carries Google
// credentials the safe way — FIREBASE_SERVICE_ACCOUNT_BASE64, entered in the
// Render dashboard, never in the repo — so Vertex uses the same shape:
//
//     VERTEX_SERVICE_ACCOUNT_BASE64=$(base64 -i your-key.json)
//
// Unset, google-auth-library falls back on its own: GOOGLE_APPLICATION_CREDENTIALS
// (a path on disk, convenient for local dev), then Application Default
// Credentials from `gcloud auth application-default login`. A missing or
// malformed credential surfaces as a failed scan, never a boot crash — the
// rest of the API must keep serving even when the AI backend is misconfigured.
function vertexAuthOptions() {
  const b64 = process.env.VERTEX_SERVICE_ACCOUNT_BASE64 || '';
  if (!b64) return undefined;
  try {
    return { credentials: JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) };
  } catch (err) {
    console.error('[vertex-ai] VERTEX_SERVICE_ACCOUNT_BASE64 is not valid base64-JSON:', err.message);
    return undefined;
  }
}

const vertexAI = new VertexAI({
  project: VERTEX_PROJECT,
  location: VERTEX_LOCATION,
  googleAuthOptions: vertexAuthOptions(),
});

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

// The two SDKs hand back the SAME text in different shapes: AI Studio wraps it
// in a response.text() helper, Vertex AI returns the raw candidate parts and has
// no such method — calling .text() on a Vertex response is a TypeError, not a
// wrong answer. Reading both keeps the backend toggle at the top of this file
// the only thing that has to change when the credit runs out.
function responseText(result) {
  const resp = result?.response ?? result;
  if (typeof resp?.text === 'function') return String(resp.text() || '');
  const parts = resp?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => (p && p.text) || '').join('');
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

    // === [PAUSED] AI Studio model — pairs with the paused require at the top ===
    // const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });

    // === [ACTIVE] Vertex AI model ===
    const model = vertexAI.getGenerativeModel({ model: VERTEX_MODEL });

    // খাতা = many tenants, few fields. ভর্তি ফরম = one tenant, nearly all of them.
    const isFormMode = mode === 'form';
    // Sent as a full request object rather than the bare [prompt, image] array
    // the AI Studio SDK allows: Vertex's generateContent takes only a string or
    // a request, so an array arrives as a malformed call. Both SDKs accept THIS
    // shape, so the request survives the toggle untouched.
    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [
          { text: isFormMode ? FORM_PROMPT : SCAN_PROMPT },
          { inlineData: { mimeType: mimeType, data: base64Clean } },
        ],
      }],
    });

    const rawText = responseText(result).trim();

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
    // Anything thrown by the AI backend gets the Bangla wrapper. The old check
    // matched only the string 'GoogleGenerativeAI', which no Vertex error
    // carries — under Vertex a quota or auth failure would have fallen through
    // as a bare 500 with no hint of what went wrong.
    const msg = err.message || '';
    const fromAiBackend = /GoogleGenerativeAI|VertexAI|Vertex|aiplatform|GoogleAuth|Could not (load|refresh) the default credentials/i.test(msg);
    if (fromAiBackend) {
      // Send a user-friendly message but append the real error for debugging
      return next(ApiError.internal(`AI স্ক্যানিং ব্যর্থ: ${msg}`));
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
    const { tenants, buildingId, unitId } = req.body;

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

    const { normaliseRoomNumber, cleanRoomLabel, parseFloorLabel } = require('../utils/roomKey');

    // ── THE ROOM THE LANDLORD ALREADY PICKED ────────────────────────────────
    // When the scanner is opened from a specific room ("this form is for 203"),
    // that room is the answer and nothing on the page can override it. No unit
    // is looked up, matched or created — which makes a duplicate impossible by
    // construction rather than by heuristic.
    //
    // This is the path to prefer whenever the landlord knows the room, because
    // OCR on a handwritten room number is the least reliable field on the page
    // and the one with the worst failure mode.
    let pinnedUnit = null;
    if (unitId) {
      if (!mongoose.Types.ObjectId.isValid(String(unitId))) {
        throw ApiError.badRequest('রুম পাওয়া যায়নি।');
      }
      pinnedUnit = await Unit.findOne({
        _id: unitId, buildingId: building._id, landlordId: req.user._id, status: 'active',
      });
      if (!pinnedUnit) throw ApiError.badRequest('এই বিল্ডিংয়ে এই রুমটি পাওয়া যায়নি।');
    }

    // ── EVERY ROOM THIS BUILDING ALREADY HAS ────────────────────────────────
    // Loaded once, up front, and indexed by MEANING rather than by exact
    // spelling. The old code did an exact-match findOne per row, so a room
    // written "Room 101" on the page never found the "101" that already
    // existed, and a second room was created next to it.
    // NOT .lean() and NOT field-selected, on purpose: these documents are handed
    // to placeTenantInUnit (which reads monthlyRent / serviceCharge / rentDueDay
    // off the unit) and to the seat-capacity growth below (which calls .save()).
    // A lean or partially-selected unit would create bookings with an undefined
    // rent and blow up on save — both silently, one row at a time.
    const existing = await Unit.find({ buildingId: building._id, status: 'active' });

    // `${floor}|${key}` → unit, for when the page tells us the floor.
    const byFloorAndRoom = new Map();
    // key → [units], for when it does not. A room number that is unique across
    // the whole building can be resolved without a floor at all.
    const byRoom = new Map();
    for (const u of existing) {
      const key = normaliseRoomNumber(u.roomNumber);
      if (!key) continue;
      byFloorAndRoom.set(`${u.floor}|${key}`, u);
      if (!byRoom.has(key)) byRoom.set(key, []);
      byRoom.get(key).push(u);
    }

    const created = [];
    const errors  = [];
    // Two names in room 301 must resolve to the SAME room, so cache per batch.
    const unitCache = new Map();

    // Resolve one row to a real Unit, creating one only when the room genuinely
    // is new. Throws a message the landlord can act on rather than guessing.
    async function resolveUnit(t) {
      const rawRoom = String(t.roomNumber || '').trim();
      const key = normaliseRoomNumber(rawRoom);
      if (!key) throw new Error('রুম/ফ্ল্যাট নম্বর নেই');

      const floor = parseFloorLabel(t.floorNumber);

      const cacheKey = `${floor === null ? '?' : floor}|${key}`;
      if (unitCache.has(cacheKey)) return unitCache.get(cacheKey);

      let unit = null;

      if (floor !== null) {
        unit = byFloorAndRoom.get(`${floor}|${key}`) || null;
      } else {
        // No floor on the page. If exactly ONE room in the building carries
        // this number, it is unambiguously that room — this is the case the
        // old code got wrong by defaulting the floor to 0 and creating a twin.
        const candidates = byRoom.get(key) || [];
        if (candidates.length === 1) {
          [unit] = candidates;
        } else if (candidates.length > 1) {
          const floors = candidates.map((c) => c.floor).join(', ');
          throw new Error(`এই রুম নম্বর একাধিক তলায় আছে (তলা ${floors}) — কোন তলা তা লিখুন`);
        } else if (existing.length > 0) {
          // The building has rooms, just none matching. Creating one on a
          // guessed ground floor is exactly how the duplicate used to appear.
          throw new Error('তলা নম্বর লিখুন — নয়তো একই রুম দুইবার তৈরি হতে পারে');
        }
      }

      if (!unit) {
        // Genuinely new. Stored under its cleaned label ("Room 101" → "101") so
        // that the database's own unique index on
        // { buildingId, floor, roomNumber } can catch a future duplicate too.
        unit = await Unit.create({
          buildingId: building._id,
          landlordId: req.user._id,
          floor: floor === null ? 0 : floor,
          roomNumber: cleanRoomLabel(rawRoom) || rawRoom,
          // Starts at one and grows below as more names in the same room turn
          // up. Guessing higher would invent vacant seats that may not exist;
          // the page is the only evidence of how many people are in the room.
          seatCapacity: 1,
          monthlyRent:   Number(t.monthlyRent) > 0 ? Number(t.monthlyRent) : building.defaultMonthlyRent,
          serviceCharge: building.defaultServiceCharge,
          rentDueDay:    Number(t.rentDueDay) || building.defaultRentDueDay,
        });
        // A room created mid-batch must be findable by the rows after it, by
        // both lookup paths — otherwise two names in one new room make two rooms.
        byFloorAndRoom.set(`${unit.floor}|${key}`, unit);
        if (!byRoom.has(key)) byRoom.set(key, []);
        byRoom.get(key).push(unit);
        existing.push(unit);
      }

      unitCache.set(cacheKey, unit);
      return unit;
    }

    for (const [idx, t] of tenants.entries()) {
      try {
        const name = String(t.name || '').trim();
        if (!name) throw new Error('নাম নেই');
        const phone = String(t.phone || '').trim();
        if (!phone) throw new Error('মোবাইল নম্বর নেই');

        // Pinned room wins outright; otherwise match by meaning, and create
        // only when the room is genuinely new.
        // eslint-disable-next-line no-await-in-loop
        const unit = pinnedUnit || await resolveUnit(t);
        const roomNumber = unit.roomNumber;

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
