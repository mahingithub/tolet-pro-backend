#!/usr/bin/env node
/**
 * cleanup-non-admin.js — delete every user who is NOT an admin-tier role,
 * plus all their owned/related data (properties, inquiries, conversations,
 * messages, notifications). Useful for clearing test/demo data before launch
 * while preserving admin accounts.
 *
 * USAGE (run from inside tolet-pro-backend/):
 *   node scripts/cleanup-non-admin.js              # dry run
 *   node scripts/cleanup-non-admin.js --confirm    # actually delete
 *   node scripts/cleanup-non-admin.js --keep=ID1,ID2   # extra IDs to spare
 *
 * Admin-tier roles (always preserved):
 *   super_admin, moderator, support_agent
 *
 * Safe defaults:
 *   - Dry-run unless --confirm is passed
 *   - Refuses to run if zero admin accounts exist (would wipe everyone)
 *   - 3-second abort window before live delete
 *   - Final summary of remaining users in DB
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const args = process.argv.slice(2);
const CONFIRM = args.includes('--confirm');
const keepArg = args.find((a) => a.startsWith('--keep='));
const EXTRA_KEEP_IDS = keepArg
  ? keepArg
      .slice('--keep='.length)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  : [];

const ADMIN_ROLES = ['super_admin', 'moderator', 'support_agent'];

function banner() {
  console.log('');
  console.log('━'.repeat(60));
  console.log('  TO-LET PRO  ·  non-admin cleanup');
  console.log(`  mode: ${CONFIRM ? '⚠️  DELETE (live)' : '🔍 DRY RUN'}`);
  console.log('━'.repeat(60));
  console.log(`  preserve roles : ${ADMIN_ROLES.join(', ')}`);
  if (EXTRA_KEEP_IDS.length) {
    console.log(`  also preserve  : ${EXTRA_KEEP_IDS.join(', ')}`);
  }
  console.log('');
}

async function main() {
  banner();

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('✗ MONGODB_URI / MONGO_URI not in .env');
    process.exit(1);
  }

  console.log('· connecting to Mongo…');
  await mongoose.connect(uri);
  console.log('✓ connected\n');

  const User = require('../models/User');
  const Property = require('../models/Property');
  const Inquiry = require('../models/Inquiry');
  const Notification = require('../models/Notification');
  const Conversation = require('../models/Conversation');
  const Message = require('../models/Message');

  // 1. find admins (preserved)
  const admins = await User.find({ role: { $in: ADMIN_ROLES } })
    .select('_id name phone phoneNumber email role')
    .lean();

  if (admins.length === 0) {
    console.error('✗ SAFETY ABORT: no admin-tier accounts found.');
    console.error('  Running this would wipe every user in the DB.');
    console.error('  Promote at least one user to super_admin first.');
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`Preserved admin accounts (${admins.length}):`);
  admins.forEach((a) =>
    console.log(
      `  ✓ ${(a.name || '(no name)').padEnd(20)} ${a.role.padEnd(14)} ${
        a.phone || a.phoneNumber || a.email || '(no contact)'
      }`
    )
  );
  console.log('');

  // 2. find victims (everyone else)
  const keepIds = [
    ...admins.map((a) => a._id),
    ...EXTRA_KEEP_IDS.map((s) => {
      try {
        return new mongoose.Types.ObjectId(s);
      } catch {
        console.warn(`  ⚠  --keep id ignored (invalid ObjectId): ${s}`);
        return null;
      }
    }).filter(Boolean),
  ];

  const victims = await User.find({ _id: { $nin: keepIds } })
    .select('_id name phone phoneNumber email role createdAt')
    .lean();

  if (victims.length === 0) {
    console.log('✓ no users to delete. DB is already clean.');
    await mongoose.disconnect();
    return;
  }

  const victimIds = victims.map((v) => v._id);

  console.log(`Users to delete (${victims.length}):`);
  victims.forEach((v) => {
    const created = v.createdAt
      ? new Date(v.createdAt).toISOString().slice(0, 10)
      : 'no-date';
    console.log(
      `  ✗ ${(v.name || '(no name)').padEnd(20)} ${(v.role || '?').padEnd(
        10
      )} ${v.phone || v.phoneNumber || v.email || '(no contact)'}  ${created}`
    );
  });
  console.log('');

  // 3. count cascade (try multiple field-name conventions, take max)
  async function safeCount(Model, ...filters) {
    let max = 0;
    for (const f of filters) {
      try {
        const n = await Model.countDocuments(f);
        if (n > max) max = n;
      } catch {
        /* field doesn't exist on schema, skip */
      }
    }
    return max;
  }

  const propCount = await safeCount(
    Property,
    { owner: { $in: victimIds } },
    { ownerId: { $in: victimIds } }
  );
  const inquiryCount = await Inquiry.countDocuments({
    $or: [
      { inquirerUserId: { $in: victimIds } },
      { propertyOwnerId: { $in: victimIds } },
    ],
  });
  const convCount = await Conversation.countDocuments({
    participants: { $in: victimIds },
  });
  // collect those conversation ids so we can count their messages
  const victimConvs = await Conversation.find({
    participants: { $in: victimIds },
  })
    .select('_id')
    .lean();
  const victimConvIds = victimConvs.map((c) => c._id);
  const msgCount = await safeCount(
    Message,
    { conversation: { $in: victimConvIds } },
    { conversationId: { $in: victimConvIds } }
  );
  const notifCount = await safeCount(
    Notification,
    { user: { $in: victimIds } },
    { userId: { $in: victimIds } }
  );

  console.log('Cascade summary:');
  console.log(`  users          : ${victims.length}`);
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

  console.log('⚠️  --confirm passed. Deleting in 3 seconds… (Ctrl-C to abort)');
  await new Promise((r) => setTimeout(r, 3000));

  async function safeDeleteMany(Model, ...filters) {
    let total = 0;
    for (const f of filters) {
      try {
        const r = await Model.deleteMany(f);
        total += r.deletedCount || 0;
      } catch {
        /* field doesn't exist, skip */
      }
    }
    return total;
  }

  const propDel = await safeDeleteMany(
    Property,
    { owner: { $in: victimIds } },
    { ownerId: { $in: victimIds } }
  );
  console.log(`  ✓ properties     : ${propDel} deleted`);

  const inqDel = await Inquiry.deleteMany({
    $or: [
      { inquirerUserId: { $in: victimIds } },
      { propertyOwnerId: { $in: victimIds } },
    ],
  });
  console.log(`  ✓ inquiries      : ${inqDel.deletedCount} deleted`);

  const msgDel = await safeDeleteMany(
    Message,
    { conversation: { $in: victimConvIds } },
    { conversationId: { $in: victimConvIds } }
  );
  console.log(`  ✓ messages       : ${msgDel} deleted`);

  const convDel = await Conversation.deleteMany({
    _id: { $in: victimConvIds },
  });
  console.log(`  ✓ conversations  : ${convDel.deletedCount} deleted`);

  const notifDel = await safeDeleteMany(
    Notification,
    { user: { $in: victimIds } },
    { userId: { $in: victimIds } }
  );
  console.log(`  ✓ notifications  : ${notifDel} deleted`);

  const userDel = await User.deleteMany({ _id: { $in: victimIds } });
  console.log(`  ✓ users          : ${userDel.deletedCount} deleted`);

  console.log('');

  // final sanity check
  const remaining = await User.find().select('_id name phone phoneNumber role').lean();
  console.log(`Remaining users in DB (${remaining.length}):`);
  remaining.forEach((u) =>
    console.log(
      `  · ${(u.name || '(no name)').padEnd(20)} ${(u.role || '?').padEnd(
        14
      )} ${u.phone || u.phoneNumber || '(no contact)'}`
    )
  );

  console.log('\n✓ cleanup complete.');
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('\n✗ cleanup failed:', e.message);
  console.error(e.stack);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});