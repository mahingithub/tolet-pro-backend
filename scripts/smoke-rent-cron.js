'use strict';

/**
 * smoke-rent-cron.js — validates the member-aware cron + reminder logic.
 * In-memory MongoDB; members are placeholders (no userId) so no notifications
 * or SMS are actually dispatched — we assert on the ledger mutations + counts.
 *
 *   node scripts/smoke-rent-cron.js
 */

// Disable the SMS gateway for this test so placeholder-member reminders don't
// fire real network calls (dotenv won't override an already-set var).
process.env.SMS_API_KEY = '';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

(async () => {
  const mem = await MongoMemoryServer.create();
  process.env.MONGO_URI = mem.getUri('tolet-cron-smoke');
  await mongoose.connect(process.env.MONGO_URI);

  const Booking = require('../models/Booking');
  const { runRentReminders } = require('../services/rentReminder.service');
  const { generateMonthlyInvoices, enforceLateFees } = require('../services/cron.service');

  await Booking.syncIndexes();

  const assert = (cond, msg) => {
    if (!cond) throw new Error('ASSERT FAILED: ' + msg);
    console.log('  ✓', msg);
  };

  const landlordId = new mongoose.Types.ObjectId();
  const propertyId = new mongoose.Types.ObjectId();
  const now = new Date();
  const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Lease covering all of the current year, due on the 1st, no grace.
  const y = now.getFullYear();
  let booking = await Booking.create({
    landlordId, propertyId, property: 'Reminder Hostel',
    leaseStart: new Date(`${y}-01-01`), leaseEnd: new Date(`${y}-12-31`),
    monthlyRent: 5000, rentDueDay: 1, gracePeriodDays: 0, lateFeeAmount: 500,
    reminderLeadDays: 3, autoReminder: true, inviteCode: 'CRON01',
    members: [
      { name: 'Rakib', phone: '01711111111', rentType: 'seat', monthlyRent: 4000 },
      { name: 'Karim', phone: '01722222222', rentType: 'seat', monthlyRent: 4500 },
    ],
  });

  console.log('\n[1] runRentReminders nudges each active member (injected date)');
  // Pick a date well past the first lease month's due so the oldest unpaid
  // month is firmly in the reminder window.
  const remindDay = new Date(`${y}-06-15`);
  let sent = await runRentReminders(remindDay);
  assert(sent === 2, `reminded both members (sent=${sent})`);
  booking = await Booking.findById(booking._id);
  assert(booking.members[0].lastReminderKey && booking.members[0].lastReminderKey.includes('@'), 'member lastReminderKey stamped');

  console.log('\n[2] same-day re-run is de-duped');
  sent = await runRentReminders(remindDay);
  assert(sent === 0, `no duplicate reminders same day (sent=${sent})`);

  console.log('\n[3] next day re-nudges');
  sent = await runRentReminders(new Date(`${y}-06-16`));
  assert(sent === 2, `re-nudged both members next day (sent=${sent})`);

  console.log('\n[4] moved-out members are skipped');
  booking = await Booking.findById(booking._id);
  booking.members[1].status = 'moved-out';
  await booking.save();
  sent = await runRentReminders(new Date(`${y}-06-17`));
  assert(sent === 1, `only the active member is reminded (sent=${sent})`);

  console.log('\n[5] generateMonthlyInvoices seeds each member (not the legacy ledger)');
  await generateMonthlyInvoices();
  booking = await Booking.findById(booking._id);
  assert(booking.members[0].ledger.get(curKey) && booking.members[0].ledger.get(curKey).status === 'due', 'active member has current-month due row');
  assert(booking.ledger.size === 0, 'booking-level ledger untouched for multi-member booking');

  console.log('\n[6] enforceLateFees flags overdue per member past grace');
  await enforceLateFees();
  booking = await Booking.findById(booking._id);
  const row = booking.members[0].ledger.get(curKey);
  if (now.getDate() > 1) {
    assert(row.status === 'overdue' && row.balance === 4000 + 500, 'member overdue + late fee applied');
  } else {
    assert(row.status === 'due', 'still within grace on the 1st — no late fee (expected)');
  }

  console.log('\nALL CRON/REMINDER SMOKE CHECKS PASSED ✅');
  await mongoose.disconnect();
  await mem.stop();
  process.exit(0);
})().catch(async (err) => {
  console.error('\n❌ SMOKE FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
});
