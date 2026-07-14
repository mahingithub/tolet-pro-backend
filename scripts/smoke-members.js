'use strict';

/**
 * smoke-members.js — data-layer smoke test for multi-member rent.
 * Boots an in-memory MongoDB and exercises the Booking members[] model, the
 * member-aware applyPayment service, the per-member Receipt index, and the
 * legacy → members[0] migration. No HTTP / notifications involved (members are
 * placeholders so the notify path is skipped).
 *
 *   node scripts/smoke-members.js
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

(async () => {
  const mem = await MongoMemoryServer.create();
  process.env.MONGO_URI = mem.getUri('tolet-smoke');
  await mongoose.connect(process.env.MONGO_URI);

  const Booking = require('../models/Booking');
  const Receipt = require('../models/Receipt');
  const { applyPayment } = require('../services/bookingPayment.service');
  const { seedMembers } = require('../migrations/2026-07-14-booking-members');

  await Booking.syncIndexes();
  await Receipt.syncIndexes();

  const assert = (cond, msg) => {
    if (!cond) throw new Error('ASSERT FAILED: ' + msg);
    console.log('  ✓', msg);
  };

  const landlordId = new mongoose.Types.ObjectId();
  const propertyId = new mongoose.Types.ObjectId();

  console.log('\n[1] multi-member booking + per-member ledger + isolated receipts');
  let booking = await Booking.create({
    landlordId, propertyId, property: 'Test Hostel', propertyType: 'hostel',
    leaseStart: new Date('2026-01-01'), leaseEnd: new Date('2026-12-31'),
    monthlyRent: 5000, rentDueDay: 5, inviteCode: 'TEST01',
    members: [
      { name: 'Rakib', phone: '01711111111', rentType: 'seat', seatLabel: 'Bed 1', monthlyRent: 4000 },
      { name: 'Karim', phone: '01722222222', rentType: 'seat', seatLabel: 'Bed 2', monthlyRent: 4500 },
    ],
  });
  assert(booking.members.length === 2, 'booking has 2 members');
  assert(booking.members[0].rentType === 'seat', 'member rentType persisted');

  const mA = booking.members[0];
  await applyPayment({ booking, member: mA, monthKey: '2026-05', payment: { status: 'full', amount: 4000, monthLabel: 'May 2026' } });
  booking = await Booking.findById(booking._id);
  assert(booking.members[0].ledger.get('2026-05') && booking.members[0].ledger.get('2026-05').paid === true, 'member A 2026-05 marked paid');
  assert(!booking.members[1].ledger.get('2026-05'), 'member B 2026-05 untouched (isolation)');

  const rA = await Receipt.findOne({ bookingId: booking._id, memberId: mA._id, monthKey: '2026-05' });
  assert(rA && rA.memberName === 'Rakib' && rA.totalPaid === 4000, 'receipt created for member A with name/amount snapshot');

  const mB = booking.members[1];
  await applyPayment({ booking, member: mB, monthKey: '2026-05', payment: { status: 'full', amount: 4500, monthLabel: 'May 2026' } });
  const receiptsMay = await Receipt.find({ bookingId: booking._id, monthKey: '2026-05' });
  assert(receiptsMay.length === 2, 'two receipts for same booking+month (one per member) — new unique index OK');

  console.log('\n[2] toJSON shaping (member.id + plain ledger object)');
  const json = (await Booking.findById(booking._id)).toJSON();
  assert(typeof json.members[0].id === 'string' && !json.members[0]._id, 'member.id is a string, _id removed');
  assert(json.members[0].ledger['2026-05'] && json.members[0].ledger['2026-05'].paid === true, 'member ledger serialised as a plain object');

  console.log('\n[3] undo a per-member ledger entry');
  booking = await Booking.findById(booking._id);
  booking.members[0].ledger.delete('2026-05');
  booking.markModified('members');
  await booking.save();
  await Receipt.deleteOne({ bookingId: booking._id, memberId: mA._id, monthKey: '2026-05' });
  booking = await Booking.findById(booking._id);
  assert(!booking.members[0].ledger.get('2026-05'), 'member A 2026-05 removed');
  assert(booking.members[1].ledger.get('2026-05') && booking.members[1].ledger.get('2026-05').paid === true, 'member B 2026-05 still intact');

  console.log('\n[4] legacy single-tenant path unchanged (applyPayment without member)');
  let legacy = await Booking.create({
    landlordId, propertyId, propertyType: 'hostel', tenant: 'Legacy Tom', tenantPhone: '01799999999',
    leaseStart: new Date('2026-01-01'), leaseEnd: new Date('2026-12-31'), monthlyRent: 8000, inviteCode: 'LEG001',
  });
  await applyPayment({ booking: legacy, monthKey: '2026-03', payment: { status: 'full', amount: 8000, monthLabel: 'Mar 2026' } });
  legacy = await Booking.findById(legacy._id);
  assert(legacy.ledger.get('2026-03') && legacy.ledger.get('2026-03').paid === true, 'legacy booking-level ledger set');
  const legacyReceipt = await Receipt.findOne({ bookingId: legacy._id, memberId: null, monthKey: '2026-03' });
  assert(legacyReceipt && legacyReceipt.totalPaid === 8000, 'legacy receipt created with memberId:null');

  console.log('\n[5] migration seeds members[0] + is idempotent');
  assert((await Booking.findById(legacy._id)).members.length === 0, 'legacy booking has no members before migration');
  await seedMembers();
  let migrated = await Booking.findById(legacy._id);
  assert(migrated.members.length === 1, 'migration seeded members[0]');
  assert(migrated.members[0].name === 'Legacy Tom' && migrated.members[0].ledger.get('2026-03') && migrated.members[0].ledger.get('2026-03').paid === true, 'members[0] carries tenant identity + legacy ledger');
  await seedMembers();
  migrated = await Booking.findById(legacy._id);
  assert(migrated.members.length === 1, 'migration idempotent (no duplicate member on re-run)');

  console.log('\n[6] non-hostel (flat) booking is NOT seeded — stays single-tenant');
  const flat = await Booking.create({
    landlordId, propertyId, propertyType: 'flat', tenant: 'Flat Frank', tenantPhone: '01700000000',
    leaseStart: new Date('2026-01-01'), leaseEnd: new Date('2026-12-31'), monthlyRent: 12000, inviteCode: 'FLAT01',
  });
  await applyPayment({ booking: flat, monthKey: '2026-02', payment: { status: 'full', amount: 12000, monthLabel: 'Feb 2026' } });
  await seedMembers();
  const flatAfter = await Booking.findById(flat._id);
  assert(flatAfter.members.length === 0, 'flat booking got NO members (single-tenant preserved)');
  assert(flatAfter.ledger.get('2026-02') && flatAfter.ledger.get('2026-02').paid === true, 'flat booking legacy ledger intact');

  console.log('\nALL SMOKE CHECKS PASSED ✅');
  await mongoose.disconnect();
  await mem.stop();
  process.exit(0);
})().catch(async (err) => {
  console.error('\n❌ SMOKE FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
});
