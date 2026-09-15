'use strict';

/**
 * Canonicalize phone identities for Bangladesh and international accounts.
 * Despite the historical filename, EVERY country's old digit-only key is
 * rebuilt, along with the source phone. No records are merged or deleted.
 *
 * Run during a maintenance window after old suffix-matching writers stop.
 * Always review a dry run first. Duplicate canonical user identities and
 * invalid user phones abort before any write; resolve these manually.
 * Unparseable optional booking contacts retain their text and an empty key.
 *
 * MONGO_URI must explicitly identify the intended database:
 *   node migrations/2026-09-14-foreign-phone-core.js --dry-run
 *   node migrations/2026-09-14-foreign-phone-core.js --apply
 * Omitting --apply is always a dry run; --dry-run takes precedence.
 */

const mongoose = require('mongoose');
const { coreExpr, verify } = require('./2026-09-06-phone-core');

function canonicalRawExpr(field) {
  return {
    $let: {
      vars: { canonical: coreExpr(field) },
      in: { $cond: [{ $ne: ['$$canonical', ''] }, '$$canonical', { $ifNull: [field, ''] }] },
    },
  };
}

async function auditUsers(db) {
  const col = db.collection('users');
  const invalid = await col.countDocuments({ $expr: { $eq: [coreExpr('$phone'), ''] } });
  const collisions = await col.aggregate([
    { $project: { canonical: coreExpr('$phone') } },
    { $match: { canonical: { $ne: '' } } },
    { $group: { _id: '$canonical', count: { $sum: 1 }, userIds: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();
  // Log IDs only; phone numbers need not be exposed in deployment logs.
  return { invalid, collisions: collisions.map(({ userIds }) => userIds.map(String)) };
}

async function rekeyUsers(db, { dryRun = true } = {}) {
  const audit = await auditUsers(db);
  if (audit.invalid || audit.collisions.length) {
    const error = new Error(`Phone migration needs manual review: ${audit.invalid} invalid user phone(s), ${audit.collisions.length} duplicate identity group(s).`);
    error.audit = audit;
    throw error;
  }
  const col = db.collection('users');
  const filter = {
    $expr: {
      $or: [
        { $ne: [{ $ifNull: ['$phoneCore', ''] }, coreExpr('$phone')] },
        { $ne: ['$phone', coreExpr('$phone')] },
      ],
    },
  };
  const todo = await col.countDocuments(filter);
  console.log(`users: ${todo} phone identity update(s)`);
  if (dryRun || todo === 0) return 0;
  const result = await col.updateMany(filter, [{ $set: { phone: coreExpr('$phone'), phoneCore: coreExpr('$phone') } }]);
  return result.modifiedCount;
}

async function rekeyBookings(db, { dryRun = true } = {}) {
  const col = db.collection('bookings');
  const changedPhone = (raw, key) => ({
    $or: [
      { $ne: [{ $ifNull: [key, ''] }, coreExpr(raw)] },
      { $ne: [{ $ifNull: [raw, ''] }, canonicalRawExpr(raw)] },
    ],
  });
  const filter = {
    $expr: {
      $or: [
        changedPhone('$tenantPhone', '$tenantPhoneCore'),
        { $anyElementTrue: [{ $map: {
          input: { $ifNull: ['$members', []] },
          as: 'm',
          in: changedPhone('$$m.phone', '$$m.phoneCore'),
        } }] },
      ],
    },
  };
  const todo = await col.countDocuments(filter);
  console.log(`bookings: ${todo} phone identity update(s)`);
  if (dryRun || todo === 0) return 0;
  const result = await col.updateMany(filter, [{ $set: {
    tenantPhone: canonicalRawExpr('$tenantPhone'),
    tenantPhoneCore: coreExpr('$tenantPhone'),
    members: { $map: {
      input: { $ifNull: ['$members', []] },
      as: 'm',
      in: { $mergeObjects: ['$$m', {
        phone: canonicalRawExpr('$$m.phone'),
        phoneCore: coreExpr('$$m.phone'),
      }] },
    } },
  } }]);
  return result.modifiedCount;
}

async function main() {
  require('dotenv').config();
  if (!process.env.MONGO_URI) throw new Error('Set MONGO_URI explicitly before running this migration.');
  const dryRun = !process.argv.includes('--apply') || process.argv.includes('--dry-run');
  await mongoose.connect(process.env.MONGO_URI);
  try {
    console.log(`Phone identity migration: ${mongoose.connection.name}${dryRun ? ' (dry run)' : ''}`);
    const db = mongoose.connection.db;
    await rekeyUsers(db, { dryRun });
    await rekeyBookings(db, { dryRun });
    if (!dryRun && await verify(db)) throw new Error('Phone identity verification failed.');
    console.log(dryRun ? 'Dry run complete; no data was changed.' : 'Phone identities canonicalized.');
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    if (error.audit) console.error(JSON.stringify(error.audit));
    process.exitCode = 1;
  });
}

module.exports = { auditUsers, rekeyUsers, rekeyBookings, canonicalRawExpr };
