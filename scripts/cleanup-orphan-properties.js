#!/usr/bin/env node
/**
 * cleanup-orphan-properties.js — delete properties whose ownerUserId
 * doesn't match any existing user in the DB.
 *
 * USAGE (run from inside tolet-pro-backend/):
 *   node scripts/cleanup-orphan-properties.js              # dry run
 *   node scripts/cleanup-orphan-properties.js --confirm    # actually delete
 *
 * NOTE: Property model uses `ownerUserId` (not `owner`/`ownerId`).
 * This is inconsistent with Inquiry (`inquirerUserId`, `propertyOwnerId`)
 * — see STATE_OF_THE_PROJECT.md.
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const CONFIRM = process.argv.includes('--confirm');

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('✗ MONGODB_URI / MONGO_URI not in .env');
    process.exit(1);
  }

  console.log('');
  console.log('━'.repeat(60));
  console.log('  TO-LET PRO  ·  orphan property cleanup');
  console.log(`  mode: ${CONFIRM ? '⚠️  DELETE (live)' : '🔍 DRY RUN'}`);
  console.log('━'.repeat(60));
  console.log('');

  await mongoose.connect(uri);
  console.log('✓ connected to Mongo\n');

  const Property = require('../models/Property');
  const User = require('../models/User');

  const allProps = await Property.find()
    .select('_id title ownerUserId ownerName status createdAt')
    .lean();
  console.log(`Total properties in Mongo: ${allProps.length}`);

  const validOwnerIds = await User.distinct('_id');
  const validOwnerSet = new Set(validOwnerIds.map(String));
  console.log(`Valid owners in DB: ${validOwnerSet.size}\n`);

  const orphans = allProps.filter(
    (p) => !p.ownerUserId || !validOwnerSet.has(String(p.ownerUserId))
  );

  console.log(`Orphan properties: ${orphans.length}`);
  orphans.forEach((p, i) => {
    const created = p.createdAt
      ? new Date(p.createdAt).toISOString().slice(0, 10)
      : 'no-date';
    console.log(
      `  [${i + 1}] ${p.title || '(no title)'}`
    );
    console.log(
      `       owner=${p.ownerName || 'n/a'} | ownerUserId=${
        p.ownerUserId || 'missing'
      }`
    );
    console.log(`       status=${p.status || 'n/a'} | created=${created}`);
  });

  if (orphans.length === 0) {
    console.log('\n✓ No orphans. DB is clean.');
  } else if (!CONFIRM) {
    console.log('\n🔍 Dry run. Re-run with --confirm to delete.');
  } else {
    console.log('\n⚠️  Deleting in 3 seconds... (Ctrl-C to abort)');
    await new Promise((r) => setTimeout(r, 3000));
    const result = await Property.deleteMany({
      _id: { $in: orphans.map((o) => o._id) },
    });
    console.log(`\n✓ Deleted ${result.deletedCount} orphan properties.`);

    const remaining = await Property.countDocuments();
    console.log(`✓ Remaining properties in DB: ${remaining}`);
  }

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('\n✗ failed:', e.message);
  console.error(e.stack);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});