/**
 * 2026-05-22-add-landlord-profile.js
 * ─────────────────────────────────────────────────────────────────────────
 * Adds `landlordProfile` sub-document with sane defaults to every User
 * that doesn't have one. Also normalises tenant fields introduced in
 * Blueprint v2 so old users don't fail validation on their next save.
 *
 * Idempotent — safe to re-run. Uses `$exists: false` filters per-field
 * so partial migrations (or simultaneous user writes) don't clobber
 * already-set values. See EC-14 in EDGE_CASES.md for the TOCTOU window.
 *
 * Usage:
 *   • Dry run (no writes, just counts):
 *       node migrations/2026-05-22-add-landlord-profile.js --dry-run
 *   • Apply:
 *       node migrations/2026-05-22-add-landlord-profile.js
 *   • Apply against a specific DB:
 *       MONGO_URI=mongodb://prod-host/tolet node migrations/...
 *
 * Rollback:
 *   This migration ADDS fields with empty defaults. To roll back:
 *     node migrations/2026-05-22-add-landlord-profile.js --rollback
 *   The rollback uses `$unset` and only removes empty/default values
 *   (never removes data the user has actually entered).
 *
 * Pre-deploy checklist (also in MONITORING.md):
 *   1. Take a DB snapshot: `mongodump --db tolet --out backups/pre-v2/`
 *   2. Run with `--dry-run` first, verify the counts
 *   3. Apply during a quiet window (low PATCH /me traffic)
 *   4. Watch the Sentry dashboard for ValidationError spikes for 15 min
 *   5. If anything goes wrong: `--rollback` then restore from snapshot
 */

'use strict';

const mongoose = require('mongoose');
const path     = require('path');

// ─── Config ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const DRY_RUN  = argv.includes('--dry-run');
const ROLLBACK = argv.includes('--rollback');
const VERBOSE  = argv.includes('--verbose') || argv.includes('-v');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/tolet';

// ─── Default shapes ───────────────────────────────────────────────────
// MUST match the User.js schema defaults exactly. If they drift, this
// migration will write a different shape than new users get, and code
// that reads landlordProfile.X will need null-checks everywhere.
const DEFAULT_LANDLORD_PROFILE = {
  fullName:         '',
  city:             '',
  address:          '',
  preferredTenants: [],
  communication:    [],
  houseRules:       [],
  serviceCharge:    null,
};

// New tenant fields introduced in v2. Some users may already have
// `emergencyContact: {...}` from the old free-form path; we don't touch
// those.
const DEFAULT_TENANT_V2_FIELDS = {
  'tenantProfile.workPlace':    '',
  'tenantProfile.workPlaceId':  '',
  'tenantProfile.familySize':   '',
  'tenantProfile.emergencyContact.name':     '',
  'tenantProfile.emergencyContact.phone':    '',
  'tenantProfile.emergencyContact.relation': '',
};

// ─── Helpers ──────────────────────────────────────────────────────────
function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}
function vlog(...args) { if (VERBOSE) log(...args); }

// We connect AFTER importing the model so Mongoose registers the schema
// against the right connection.
async function connect() {
  await mongoose.connect(MONGO_URI, { autoIndex: false });
  log('Connected to', MONGO_URI.replace(/:\/\/[^@]+@/, '://****@'));
}

// Use the actual User model so Mongoose schema validation runs. If you
// keep the model elsewhere, adjust the require path.
function loadUserModel() {
  // Try common paths — adjust the first one to match your layout.
  const candidates = [
    '../src/models/User',
    '../models/User',
    '../app/models/User',
  ];
  for (const p of candidates) {
    try { return require(path.resolve(__dirname, p)); }
    catch { /* try next */ }
  }
  throw new Error(
    'Could not locate User model. Update the require path at the top of ' +
    'this migration script.',
  );
}

// ═══════════════════════════════════════════════════════════════════
// MIGRATION — landlordProfile defaults
// ═══════════════════════════════════════════════════════════════════
async function migrateLandlordProfile(User) {
  log('▶ Phase 1 — landlordProfile defaults');

  const filter = { landlordProfile: { $exists: false } };
  const count  = await User.countDocuments(filter);
  log(`  Users without landlordProfile: ${count}`);

  if (DRY_RUN) {
    log('  [dry-run] would $set landlordProfile to default on', count, 'users');
    return { matched: count, modified: 0 };
  }

  if (count === 0) {
    log('  Skip — nothing to do.');
    return { matched: 0, modified: 0 };
  }

  const result = await User.updateMany(
    filter,
    { $set: { landlordProfile: DEFAULT_LANDLORD_PROFILE } },
  );

  log(`  ✓ matched=${result.matchedCount} modified=${result.modifiedCount}`);
  return result;
}

// ═══════════════════════════════════════════════════════════════════
// MIGRATION — tenant v2 fields
// ═══════════════════════════════════════════════════════════════════
async function migrateTenantV2Fields(User) {
  log('▶ Phase 2 — tenantProfile v2 field defaults');

  // We do this field-by-field with `$exists: false` filters so partial
  // saves (a user who already set workPlace but not familySize) keep
  // their data. updateMany with a compound filter would still need
  // per-field guard logic, so we just loop.
  const summary = { matched: 0, modified: 0, byField: {} };

  for (const [fieldPath, defaultValue] of Object.entries(DEFAULT_TENANT_V2_FIELDS)) {
    const filter = { [fieldPath]: { $exists: false } };
    const count  = await User.countDocuments(filter);
    vlog(`  ${fieldPath}: ${count} users missing`);

    if (DRY_RUN || count === 0) {
      summary.byField[fieldPath] = { matched: count, modified: 0 };
      summary.matched += count;
      continue;
    }

    const result = await User.updateMany(filter, { $set: { [fieldPath]: defaultValue } });
    summary.byField[fieldPath] = result;
    summary.matched  += result.matchedCount;
    summary.modified += result.modifiedCount;
  }

  log(`  ✓ matched=${summary.matched} modified=${summary.modified}`);
  return summary;
}

// ═══════════════════════════════════════════════════════════════════
// MIGRATION — normalize null familySize to '' (Mongoose enum demands string)
// ═══════════════════════════════════════════════════════════════════
async function normalizeNullFamilySize(User) {
  log('▶ Phase 3 — normalise null familySize → ""');

  const filter = { 'tenantProfile.familySize': null };
  const count  = await User.countDocuments(filter);
  log(`  Users with null familySize: ${count}`);

  if (DRY_RUN || count === 0) {
    return { matched: count, modified: 0 };
  }

  const result = await User.updateMany(filter, { $set: { 'tenantProfile.familySize': '' } });
  log(`  ✓ matched=${result.matchedCount} modified=${result.modifiedCount}`);
  return result;
}

// ═══════════════════════════════════════════════════════════════════
// ROLLBACK
// ═══════════════════════════════════════════════════════════════════
// Only removes fields that match the empty defaults — never removes
// data the user has typed in. The check is per-field, not per-document.
async function rollback(User) {
  log('▶ Rollback — removing empty default v2 fields');

  // 1. Remove default landlordProfile (only if it still equals the
  //    untouched default — never trample real data).
  if (!DRY_RUN) {
    const r = await User.updateMany(
      {
        'landlordProfile.fullName':         '',
        'landlordProfile.city':             '',
        'landlordProfile.address':          '',
        'landlordProfile.preferredTenants': { $size: 0 },
        'landlordProfile.communication':    { $size: 0 },
        'landlordProfile.houseRules':       { $size: 0 },
        $or: [
          { 'landlordProfile.serviceCharge': null },
          { 'landlordProfile.serviceCharge': { $exists: false } },
        ],
      },
      { $unset: { landlordProfile: '' } },
    );
    log(`  ✓ landlordProfile removed on ${r.modifiedCount} users (default-only)`);
  }

  // 2. Remove the v2 tenant fields the migration added — same logic.
  const v2EmptyFilter = {};
  for (const [path, def] of Object.entries(DEFAULT_TENANT_V2_FIELDS)) {
    if (Array.isArray(def)) v2EmptyFilter[path] = { $size: 0 };
    else                    v2EmptyFilter[path] = def;
  }
  if (!DRY_RUN) {
    const unsetSpec = Object.keys(DEFAULT_TENANT_V2_FIELDS)
      .reduce((acc, k) => (acc[k] = '', acc), {});
    const r = await User.updateMany(v2EmptyFilter, { $unset: unsetSpec });
    log(`  ✓ tenant v2 fields removed on ${r.modifiedCount} users (default-only)`);
  }

  log('  Rollback complete. (Users who set real values keep them.)');
}

// ═══════════════════════════════════════════════════════════════════
// ENTRY POINT
// ═══════════════════════════════════════════════════════════════════
async function main() {
  const banner = ROLLBACK ? '⏪ ROLLBACK MODE' : DRY_RUN ? '🧪 DRY RUN' : '🚀 APPLY';
  log('═══════════════════════════════════════════════════');
  log(`  ${banner} — landlordProfile + tenant v2 fields`);
  log('═══════════════════════════════════════════════════');

  await connect();
  const User = loadUserModel();

  // Quick sanity check — fail fast if the schema doesn't include
  // landlordProfile yet (means the deployer forgot to apply Backend_PATCH §1).
  const schemaPaths = User.schema.paths;
  if (!schemaPaths['landlordProfile']) {
    log('❌ User schema has no `landlordProfile` path. Apply Backend_PATCH §1 first.');
    process.exit(2);
  }

  try {
    if (ROLLBACK) {
      await rollback(User);
    } else {
      const r1 = await migrateLandlordProfile(User);
      const r2 = await migrateTenantV2Fields(User);
      const r3 = await normalizeNullFamilySize(User);

      log('───────────────────────────────────────────────────');
      log('Summary:');
      log('  Phase 1 landlord defaults  :', r1.modifiedCount ?? 0, 'updated');
      log('  Phase 2 tenant v2 defaults :', r2.modified, 'updated');
      log('  Phase 3 familySize cleanup :', r3.modifiedCount ?? 0, 'updated');
    }
  } catch (err) {
    log('❌ Migration failed:', err.message);
    log(err.stack);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    log('Disconnected.');
  }
}

main().catch((err) => {
  // Belt-and-suspenders — main() already catches, but if connect fails
  // before the try block, surface it here.
  console.error('Fatal:', err);
  process.exit(1);
});
