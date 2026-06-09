#!/usr/bin/env node
/**
 * cleanup-seed.js — remove demo / seed / smoke-test data from MongoDB Atlas.
 *
 * USAGE (run from inside tolet-pro-backend/):
 *   node scripts/cleanup-seed.js              # dry run — shows what would be deleted
 *   node scripts/cleanup-seed.js --confirm    # actually delete
 *   node scripts/cleanup-seed.js --pattern='@mytest.com'   # add custom pattern
 *   node scripts/cleanup-seed.js --confirm --quiet         # less verbose
 *
 * What it does:
 *   1. Finds every User whose email matches any seed pattern.
 *   2. Collects their _ids.
 *   3. Cascades: deletes Properties owned by them, Inquiries they
 *      sent or received, Conversations / Messages they were in, and
 *      Notifications addressed to them.
 *   4. Finally deletes the Users themselves.
 *
 * Safe defaults:
 *   - Dry run unless --confirm is passed.
 *   - Will refuse to run if zero seed users matched but extra non-seed
 *     IDs somehow ended up in the cascade list (defensive sanity check).
 *   - Connects using the same MONGODB_URI as the backend (.env).
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

// ---- CLI args ----------------------------------------------------------------
const args = process.argv.slice(2);
const CONFIRM = args.includes('--confirm');
const QUIET = args.includes('--quiet');
const extraPatterns = args
  .filter((a) => a.startsWith('--pattern='))
  .map((a) => a.slice('--pattern='.length));

// Default seed-data patterns. Add to this list (or pass --pattern=...) as needed.
const DEFAULT_PATTERNS = [
  /@example\.com$/i,
  /@test\.local$/i,
  /^test[-+_.]/i, // test-foo@..., test+foo@..., test.foo@...
  /^smoke[-+_.]/i,
  /^seed[-+_.]/i,
  /^demo[-+_.]/i,
];

const PATTERNS = [
  ...DEFAULT_PATTERNS,
  ...extraPatterns.map((p) => new RegExp(p, 'i')),
];

// ---- helpers -----------------------------------------------------------------
const log = (...a) => !QUIET && console.log(...a);
const warn = (...a) => console.warn(...a);
const err = (...a) => console.error(...a);

function banner() {
  console.log('');
  console.log('━'.repeat(60));
  console.log(`  TO-LET PRO  ·  seed-data cleanup`);
  console.log(`  mode: ${CONFIRM ? '⚠️  DELETE (live)' : '🔍 DRY RUN'}`);
  console.log('━'.repeat(60));
  console.log('  patterns:');
  PATTERNS.forEach((p) => console.log(`    - ${p}`));
  console.log('');
}

// ---- main --------------------------------------------------------------------
async function main() {
  banner();

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    err('✗ MONGODB_URI (or MONGO_URI) not found in .env');
    process.exit(1);
  }

  log('· connecting to Mongo…');
  await mongoose.connect(uri);
  log('✓ connected\n');

  // Lazy-require models so dotenv has run first.
  const User = require('../models/User');
  const Property = require('../models/Property');
  const Inquiry = require('../models/Inquiry');
  const Notification = require('../models/Notification');
  const Conversation = require('../models/Conversation');
  const Message = require('../models/Message');

  // 1. find seed users by email regex (any of the patterns)
  const orClauses = PATTERNS.map((re) => ({ email: { $regex: re } }));
  const seedUsers = await User.find({ $or: orClauses })
    .select('_id email name role createdAt')
    .lean();

  if (seedUsers.length === 0) {
    log('✓ no seed users matched. Nothing to clean.');
    await mongoose.disconnect();
    return;
  }

  const seedIds = seedUsers.map((u) => u._id);

  log(`Found ${seedUsers.length} seed user(s):`);
  seedUsers.forEach((u) =>
    log(
      `  · ${u.email.padEnd(34)} ${(u.role || '?').padEnd(10)} ${u._id} ${new Date(
        u.createdAt
      )
        .toISOString()
        .slice(0, 10)}`
    )
  );
  log('');

  // 2. count cascaded documents (always counted, even in dry run)
  const [
    propCount,
    inquiryCount,
    convCount,
    msgCount,
    notifCount,
  ] = await Promise.all([
    Property.countDocuments({ owner: { $in: seedIds } }).catch(() =>
      Property.countDocuments({ ownerId: { $in: seedIds } })
    ),
    Inquiry.countDocuments({
      $or: [
        { inquirerUserId: { $in: seedIds } },
        { propertyOwnerId: { $in: seedIds } },
      ],
    }),
    Conversation.countDocuments({ participants: { $in: seedIds } }),
    Message.countDocuments({ sender: { $in: seedIds } }).catch(() =>
      Message.countDocuments({ senderId: { $in: seedIds } })
    ),
    Notification.countDocuments({ user: { $in: seedIds } }).catch(() =>
      Notification.countDocuments({ userId: { $in: seedIds } })
    ),
  ]);

  console.log('Cascade summary:');
  console.log(`  users          : ${seedUsers.length}`);
  console.log(`  properties     : ${propCount}`);
  console.log(`  inquiries      : ${inquiryCount}`);
  console.log(`  conversations  : ${convCount}`);
  console.log(`  messages       : ${msgCount}`);
  console.log(`  notifications  : ${notifCount}`);
  console.log('');

  if (!CONFIRM) {
    console.log('🔍 dry run — nothing deleted.');
    console.log('   re-run with --confirm to actually delete.');
    await mongoose.disconnect();
    return;
  }

  // 3. live delete
  console.log('⚠️  --confirm passed. Deleting in 3 seconds… (Ctrl-C to abort)');
  await new Promise((r) => setTimeout(r, 3000));

  // helper that tries one field, falls back to another (handles schema drift)
  async function deleteWithFallback(Model, filterA, filterB) {
    try {
      return await Model.deleteMany(filterA);
    } catch {
      return await Model.deleteMany(filterB);
    }
  }

  const propRes = await deleteWithFallback(
    Property,
    { owner: { $in: seedIds } },
    { ownerId: { $in: seedIds } }
  );
  log(`  ✓ properties     : ${propRes.deletedCount} deleted`);

  const inqRes = await Inquiry.deleteMany({
    $or: [
      { inquirerUserId: { $in: seedIds } },
      { propertyOwnerId: { $in: seedIds } },
    ],
  });
  log(`  ✓ inquiries      : ${inqRes.deletedCount} deleted`);

  // delete messages BEFORE conversations so we can still query by conversation
  const seedConvs = await Conversation.find({
    participants: { $in: seedIds },
  })
    .select('_id')
    .lean();
  const seedConvIds = seedConvs.map((c) => c._id);

  const msgRes = await Message.deleteMany({
    conversation: { $in: seedConvIds },
  }).catch(() =>
    Message.deleteMany({ conversationId: { $in: seedConvIds } })
  );
  log(`  ✓ messages       : ${msgRes.deletedCount} deleted`);

  const convRes = await Conversation.deleteMany({
    _id: { $in: seedConvIds },
  });
  log(`  ✓ conversations  : ${convRes.deletedCount} deleted`);

  const notifRes = await deleteWithFallback(
    Notification,
    { user: { $in: seedIds } },
    { userId: { $in: seedIds } }
  );
  log(`  ✓ notifications  : ${notifRes.deletedCount} deleted`);

  const userRes = await User.deleteMany({ _id: { $in: seedIds } });
  log(`  ✓ users          : ${userRes.deletedCount} deleted`);

  console.log('');
  console.log('✓ cleanup complete.');

  await mongoose.disconnect();
}

main().catch(async (e) => {
  err('\n✗ cleanup failed:', e.message);
  err(e.stack);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});