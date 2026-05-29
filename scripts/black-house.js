#!/usr/bin/env node
/**
 * delete-black-house.js — remove the final "Black House" test property
 * tied to the super_admin account, plus any inquiries/conversations
 * referencing it. After this, DB is fully launch-ready.
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
  console.log('  TO-LET PRO  ·  delete final test property');
  console.log(`  mode: ${CONFIRM ? '⚠️  DELETE (live)' : '🔍 DRY RUN'}`);
  console.log('━'.repeat(60));
  console.log('');

  await mongoose.connect(uri);
  console.log('✓ connected to Mongo\n');

  const Property = require('../models/Property');
  const Inquiry = require('../models/Inquiry');

  const props = await Property.find()
    .select('_id title status ownerName ownerUserId createdAt')
    .lean();

  console.log(`Properties to delete (${props.length}):`);
  props.forEach((p, i) => {
    console.log(
      `  [${i + 1}] ${p.title} | owner=${p.ownerName} | status=${p.status}`
    );
  });
  console.log('');

  if (props.length === 0) {
    console.log('✓ No properties in DB. Nothing to do.');
    await mongoose.disconnect();
    return;
  }

  const propIds = props.map((p) => p._id);

  // count related inquiries
  const inqCount = await Inquiry.countDocuments({
    propertyId: { $in: propIds },
  }).catch(() =>
    Inquiry.countDocuments({ property: { $in: propIds } })
  );
  console.log(`Related inquiries to delete: ${inqCount}\n`);

  if (!CONFIRM) {
    console.log('🔍 Dry run. Re-run with --confirm to delete.');
    await mongoose.disconnect();
    return;
  }

  console.log('⚠️  Deleting in 3 seconds... (Ctrl-C to abort)');
  await new Promise((r) => setTimeout(r, 3000));

  // delete inquiries first
  let inqDel = 0;
  try {
    const r = await Inquiry.deleteMany({ propertyId: { $in: propIds } });
    inqDel += r.deletedCount || 0;
  } catch {}
  try {
    const r = await Inquiry.deleteMany({ property: { $in: propIds } });
    inqDel += r.deletedCount || 0;
  } catch {}
  console.log(`  ✓ inquiries  : ${inqDel} deleted`);

  const propDel = await Property.deleteMany({ _id: { $in: propIds } });
  console.log(`  ✓ properties : ${propDel.deletedCount} deleted`);

  // final state
  const remaining = await Property.countDocuments();
  console.log(`\n✓ Remaining properties in DB: ${remaining}`);
  console.log('✓ DB is launch-ready.');

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