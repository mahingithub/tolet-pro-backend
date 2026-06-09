'use strict';

const mongoose = require('mongoose');
const { computeTenantTrust, computeLandlordTrust, tierFor } = require('../utils/trustScore');

// ─── ROLES ─────────────────────────────────────────────────────────────────
// Every user can carry multiple roles (e.g. "I rent my flat AND I also
// rent from someone else"). `role` stays for backward compatibility — it
// always reflects whichever role is currently active in the UI. `roles[]`
// is the canonical superset and is what the auth gates check.
const ROLES = ['tenant', 'landlord', 'support_agent', 'moderator', 'super_admin'];

// ─── SUB-SCHEMAS ────────────────────────────────────────────────────────────
const VerificationSchema = new mongoose.Schema(
  {
    // ── Boolean "uploaded?" flags (kept for backwards-compat with the
    //     dashboard, which gates UI on these). True after a real file lands
    //     in Cloudinary; set back to false on delete.
    photo:              { type: Boolean, default: false },
    nidFront:           { type: Boolean, default: false },
    nidBack:            { type: Boolean, default: false },
    professionProof:    { type: Boolean, default: false },

    // ── Cloudinary URLs (display) + public_ids (deletion on replace).
    //     Empty string when no doc is uploaded. URLs are HTTPS-signed by
    //     Cloudinary so they're safe to put behind the privacy gate
    //     without extra signing on our end.
    photoUrl:                  { type: String, default: '', maxlength: 600 },
    photoPublicId:             { type: String, default: '', maxlength: 200 },
    nidFrontUrl:               { type: String, default: '', maxlength: 600 },
    nidFrontPublicId:          { type: String, default: '', maxlength: 200 },
    nidBackUrl:                { type: String, default: '', maxlength: 600 },
    nidBackPublicId:           { type: String, default: '', maxlength: 200 },
    professionProofUrl:        { type: String, default: '', maxlength: 600 },
    professionProofPublicId:   { type: String, default: '', maxlength: 200 },

    submittedForReview: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['unverified', 'pending', 'verified', 'rejected'],
      default: 'unverified',
    },
    reviewedAt:      { type: Date, default: null },
    // Who approved/rejected this submission. ObjectId of the admin user.
    reviewedBy:      { type: mongoose.Schema.Types.ObjectId, default: null },
    // Surfaced back to the tenant when status === 'rejected' so they know
    // what to fix on re-submission.
    rejectionReason: { type: String, default: '', maxlength: 500 },
  },
  { _id: false },
);

const TenantProfileSchema = new mongoose.Schema(
  {
    professionType: {
      type: String,
      enum: ['', 'student', 'employed', 'self-employed', 'other'],
      default: '',
    },

    // ─── Blueprint v2 fields ────────────────────────────────────────
    workPlace:   { type: String, default: '', trim: true, maxlength: 120 },
    workPlaceId: { type: String, default: '', trim: true, maxlength: 40 },
    familySize:  { type: String, enum: ['', '1', '2', '3', '4', '5+'], default: '' },
    emergencyContact: {
      name:  { type: String, default: '', trim: true, maxlength: 80 },
      phone: {
        type: String, default: '', trim: true, maxlength: 20,
        validate: {
          validator: (v) => v === '' || /^\+\d{8,15}$/.test(v),
          message:   'Emergency contact phone must be E.164 format.',
        },
      },
      relation: {
        type: String,
        enum: ['', 'parent', 'spouse', 'sibling', 'guardian', 'other'],
        default: '',
      },
    },

    trustScore: { type: Number, default: 0, min: 0, max: 100 },
    trustTier:  { type: String, enum: ['bronze', 'silver', 'gold', 'platinum'], default: 'bronze' },
    verification: { type: VerificationSchema, default: () => ({}) },
    // Cached so the public trust card can render "Member since 2026" without
    // computing on every read.
    memberSinceYear: { type: Number, default: null },
    // Privacy switch — when false, /api/tenants/:id returns 404 to
    // anonymous callers (matches the "default-public, opt-out" stance
    // pending user signoff).
    publicVisible: { type: Boolean, default: true },
  },
  { _id: false },
);

// ─── LANDLORD PROFILE ───────────────────────────────────────────────────────
// Landlord-specific verification mirrors the tenant block's shape but
// only collects the two extra docs we ask for when a user wants to
// list properties: a property address (text) + a utility bill (photo
// matching that address, used to prove ownership/tenancy). Everything
// else (NID, profile photo, profession proof) is reused from
// tenantProfile.verification — that's the "verify once, never re-ask"
// rule. A user who already verified as a tenant only needs these two
// fields to flip into landlord mode.
const LandlordVerificationSchema = new mongoose.Schema(
  {
    // Property address typed by the user. Free-form for now — admins
    // visually compare it against the utility bill.
    propertyAddress: { type: String, default: '', trim: true, maxlength: 300 },

    // Utility (electricity) bill photo. URL + publicId so we can delete
    // on replace without leaking quota.
    utilityBillUrl:      { type: String, default: '', maxlength: 600 },
    utilityBillPublicId: { type: String, default: '', maxlength: 200 },

    submittedForReview: { type: Boolean, default: false },
    submittedAt:        { type: Date, default: null },
    status: {
      type: String,
      enum: ['unverified', 'pending', 'verified', 'rejected'],
      default: 'unverified',
    },
    reviewedAt:      { type: Date, default: null },
    reviewedBy:      { type: mongoose.Schema.Types.ObjectId, default: null },
    rejectionReason: { type: String, default: '', maxlength: 500 },
  },
  { _id: false },
);

const LandlordProfileSchema = new mongoose.Schema(
  {
    fullName: { type: String, default: '', trim: true, maxlength: 80 },
    city:     { type: String, default: '', trim: true, maxlength: 40 },
    address:  { type: String, default: '', trim: true, maxlength: 200 },

    preferredTenants: {
      type: [String], default: [],
      enum: ['family', 'bachelor_m', 'bachelor_f', 'student', 'job_holder', 'business', 'anyone'],
    },
    communication: {
      type: [String], default: [],
      enum: ['phone', 'whatsapp', 'sms', 'imo', 'direct_call', 'caretaker', 'app_only'],
    },
    houseRules: {
      type: [String], default: [],
      enum: ['no_smoking', 'no_pets', 'no_late_guest', 'no_loud_music',
             'no_alteration', 'keep_clean', 'curfew_11pm', 'no_bachelor', 'no_sublet'],
    },
    // null = not answered, 0 = explicitly no service charge
    serviceCharge: { type: Number, default: null, min: 0, max: 100000 },

    trustScore: { type: Number, default: 0, min: 0, max: 100 },
    trustTier:  { type: String, enum: ['bronze', 'silver', 'gold', 'platinum'], default: 'bronze' },

    // Landlord-only KYC. See LandlordVerificationSchema above.
    verification: { type: LandlordVerificationSchema, default: () => ({}) },
  },
  { _id: false },
);

// ─── USER ───────────────────────────────────────────────────────────────────
const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    // E.164 format, e.g. +8801742898206. Unique across all users.
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      match: [/^\+\d{8,15}$/, 'Invalid phone format'],
    },
    // Always hidden from queries by default; explicit `.select('+password')` to load.
    password: { type: String, required: true, select: false },

    // Currently-active role for this session. Mutated by POST /api/auth/me/active-role.
    role: { type: String, enum: ROLES, default: 'tenant' },

    // ─── Multi-role support ───────────────────────────────────────────────
    // The canonical list of roles the user has unlocked. `addRole('landlord')`
    // is idempotent and surfaces the "Become a Landlord" / "Become a Tenant"
    // toggle in the Navbar pill + Tenant Dashboard banner. Auth gates check
    // membership in this array, not the single-valued `role` field.
    roles: {
      type: [String],
      enum: ROLES,
      default: function defaultRoles() {
        return [this.role || 'tenant'];
      },
    },

    phoneVerified: { type: Boolean, default: false },

    // ─── Optional profile fields (filled in via the dashboard) ───────────
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
      match: [/^$|.+@.+\..+/, 'Invalid email'],
      maxlength: 254,
    },
    dateOfBirth: { type: Date, default: null },
    avatar: {
      // Either a data: URL (base64 inline) or an https URL. Same shape as
      // Property.coverPhoto so the frontend doesn't need a special branch.
      type: String,
      trim: true,
      default: '',
      maxlength: 2_000_000,
    },
    // Cloudinary public_id for the avatar — used for clean overwrite +
    // future "delete avatar" support without leaking quota on stale bytes.
    avatarPublicId: {
      type: String,
      default: '',
      trim: true,
      maxlength: 200,
    },

    // Tenant-side trust + verification block.
    tenantProfile:  { type: TenantProfileSchema,  default: () => ({}) },
    landlordProfile: { type: LandlordProfileSchema, default: () => ({}) },

    // Verification + audit fields
    lastLoginAt:       { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
    // Brute-force protection
    loginAttempts: { type: Number, default: 0, select: false },
    lockUntil:     { type: Date,   default: null, select: false },
    // Linked Firebase UID after OTP verification.
    firebaseUid:   { type: String, default: null, index: true, select: false },

    // ─── Moderation flags ────────────────────────────────────────────────
    // Set by an admin via POST /api/admin/users/:id/ban. A banned user
    // can still log in (so they see the in-app rejection notice) but
    // every protected mutation should refuse the request. The auth
    // middleware checks `isBanned` before serving any request that
    // mutates state.
    isBanned:  { type: Boolean, default: false, index: true },
    banReason: { type: String,  default: '', maxlength: 500 },
    bannedAt:  { type: Date,    default: null },
    bannedBy:  { type: mongoose.Schema.Types.ObjectId, default: null },

    // ─── Phase 7: Privacy Center & Account Management ────────────────────
    preferences: {
      aiLearningOptIn: { type: Boolean, default: false },
      marketingEmails: { type: Boolean, default: true },
      smsAlerts:       { type: Boolean, default: true },
      // Phase Call-6: master switch for incoming-call push notifications.
      // When false, the backend skips sending FCM on CALL_INITIATED.
      callNotifications: { type: Boolean, default: true },
      theme:           { type: String, enum: ['system', 'light', 'dark'], default: 'system' },
      language:        { type: String, enum: ['en', 'bn'], default: 'en' },
    },
    sessions: [
      {
        sessionId:  { type: String, required: true },
        device:     { type: String, default: 'Unknown device' },
        ipAddress:  { type: String, default: '0.0.0.0' },
        lastSeenAt: { type: Date, default: Date.now },
        createdAt:  { type: Date, default: Date.now },
      }
    ],
    // ─── Phase Call-6: FCM device tokens for push notifications ──────────
    // One entry per browser/device the user has granted notification
    // permission on. POST /api/notifications/register-device upserts here;
    // dead tokens are pruned automatically when FCM reports them invalid.
    deviceTokens: [
      {
        token:      { type: String, required: true, index: true },
        platform:   { type: String, default: 'web', maxlength: 20 },
        userAgent:  { type: String, maxlength: 256 },
        addedAt:    { type: Date, default: Date.now },
        lastSeenAt: { type: Date, default: Date.now },
      }
    ],
    pendingDeletion: {
      scheduledAt:     { type: Date, default: null },
      restoreDeadline: { type: Date, default: null },
    }
  },
  { timestamps: true },
);

UserSchema.virtual('isLocked').get(function isLocked() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// ─── Pre-save: keep `roles[]` and `tenantProfile.trustScore` consistent ───
UserSchema.pre('save', function preSave(next) {
  // 1. `role` must always be present inside `roles[]`.
  if (this.role && Array.isArray(this.roles) && !this.roles.includes(this.role)) {
    this.roles.push(this.role);
  }
  if (!this.roles || this.roles.length === 0) {
    this.roles = [this.role || 'tenant'];
  }

  // 2. Recompute trust score whenever the verification block or profession
  //    type changes. We compute server-side so the public trust card never
  //    has to trust frontend math. BOTH the tenant-side and landlord-side
  //    scores are derived independently — a user wearing both hats has
  //    a separate trust number on each surface (the public landlord card
  //    reads landlordProfile.trustScore; the tenant card reads
  //    tenantProfile.trustScore).
  const { score: tenantScore, tier: tenantTier } =
    computeTenantTrust(this.tenantProfile || {}, this);
  this.tenantProfile = this.tenantProfile || {};
  this.tenantProfile.trustScore = tenantScore;
  this.tenantProfile.trustTier  = tenantTier;
  if (!this.tenantProfile.memberSinceYear) {
    this.tenantProfile.memberSinceYear = (this.createdAt || new Date()).getFullYear();
  }

  const { score: landlordScore, tier: landlordTier } = computeLandlordTrust(this);
  this.landlordProfile = this.landlordProfile || {};
  this.landlordProfile.trustScore = landlordScore;
  this.landlordProfile.trustTier  = landlordTier;

  next();
});

// Hide sensitive fields from JSON serialisation (e.g. when returned in responses).
UserSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret.password;
    delete ret.loginAttempts;
    delete ret.lockUntil;
    delete ret.firebaseUid;
    // We expose `id` via the virtual but suppress the internal `_id` copy.
    delete ret._id;
    return ret;
  },
});

UserSchema.statics.ROLES = ROLES;
UserSchema.statics.computeTenantTrust = computeTenantTrust;

module.exports = mongoose.model('User', UserSchema);
module.exports.ROLES = ROLES;
// Re-export from util so existing callers don't break.
module.exports.computeTenantTrust = computeTenantTrust;
module.exports.computeTrust       = require('../utils/trustScore').computeTrust;
