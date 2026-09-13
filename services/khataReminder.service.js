'use strict';

/**
 * khataReminder.service — unattended "আপনার বাকি আছে" nudges for the তালি খাতা.
 * ──────────────────────────────────────────────────────────────────────────
 * One polite WhatsApp message to a customer who owes a shopkeeper money, sent
 * by the server rather than by the shopkeeper tapping a button.
 *
 * ── The person being messaged is not our user ─────────────────────────────
 * He took rice on credit from a shop. He never installed anything, never
 * agreed to anything, and cannot unsubscribe from a list he was never on. That
 * is the whole reason this file is as careful as it is, and every rule below is
 * a hard rule rather than a preference. They mirror soloDueReminder.service,
 * which faces the same problem from the other side of the app.
 *
 *   • CONSENT IS PER CUSTOMER, AND SPECIFICALLY FOR AUTOMATION.
 *     `party.reminder.auto` defaults false and is separate from the `optIn`
 *     that governs the manual button. "You may send this when you decide to"
 *     and "the server may send this on a schedule forever" are different
 *     promises; collapsing them into one boolean would have enrolled every
 *     customer already on file into unattended weekly messages.
 *
 *   • THE SHOPKEEPER HAS A KILL SWITCH. `merchant.khataAutoReminders` stops
 *     every one of his, in one tap, without unpicking each customer.
 *
 *   • NEVER IF IT IS SETTLED. The balance is read at send time. Somebody who
 *     has paid is not messaged, whatever the row said when the sweep started.
 *
 *   • NEVER FOR SMALL CHANGE. Chasing ৳40 by WhatsApp costs more goodwill than
 *     the debt is worth, and is how a shop gets a reputation.
 *
 *   • NEVER WHILE HE IS STILL A REGULAR. If the customer was in the shop this
 *     week, the shopkeeper can mention it himself. An automated demand sent to
 *     somebody actively trading with you is a way to lose him.
 *
 *   • AT MOST ONE A WEEK, whatever caused it. The clock is shared with the
 *     manual button — see LedgerParty.reminder.lastSentAt.
 *
 *   • CLAIMED BEFORE SENDING, so a restart mid-sweep or two overlapping runs
 *     cannot produce two messages. The failure mode is deliberately "sent at
 *     most once", never "sent at least once": a duplicate money message is
 *     worse than a missed one.
 *
 *   • SAYS WHO IT IS FROM AND THAT IT IS AUTOMATED. It arrives from OUR
 *     number, not the shop's. A money message from an unknown number that does
 *     not explain itself is indistinguishable from a scam.
 *
 * ── No SMS fallback ───────────────────────────────────────────────────────
 * The manual button falls back to SMS because a human just asked for it and is
 * watching. This one is unattended: a failed WhatsApp turning into a paid SMS,
 * unprompted, at scale, is a bill and a nuisance nobody authorised. A message
 * that cannot be delivered on WhatsApp simply is not sent, and the cooldown is
 * not spent either.
 */

const LedgerParty = require('../models/LedgerParty');
const Merchant = require('../models/Merchant');
const whatsapp = require('./whatsapp.service');

const TZ = process.env.CRON_TZ || 'Asia/Dhaka';

/** Matches REMINDER_COOLDOWN_DAYS in ledger.controller — one clock, one rule. */
const COOLDOWN_DAYS = 7;

/**
 * Below this, leave it alone. A shopkeeper writes ৳20 in the খাতা for a packet
 * of biscuits and forgets it; a WhatsApp demand for ৳20 is remembered.
 */
const MIN_BALANCE = 100;

/**
 * Don't chase somebody who is still shopping here. `lastEntryAt` inside this
 * window means he was at the counter recently and the shopkeeper had the
 * chance to say it in person, which is always better than a message.
 */
const QUIET_AFTER_ACTIVITY_DAYS = 7;

/**
 * Per merchant, per run. The WhatsApp account throttle already spaces sends and
 * caps the day, but that is an account-wide protection; this one keeps a single
 * shop with two hundred debtors from turning into a bulk sender in one morning,
 * which is what gets a number banned.
 */
const MAX_PER_MERCHANT = 20;

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
const bn = (n) => String(n).replace(/\d/g, (d) => BN_DIGITS[Number(d)]);

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);

/**
 * The message.
 *
 * Written from the CUSTOMER'S side, like the statement is: he owes, so it says
 * "আপনার বাকি" and never the shop's "আপনি পাবেন". It names the shop, states one
 * number, asks once, and signs off as automated.
 *
 * The "ইতিমধ্যে পরিশোধ করে থাকলে..." line is not politeness padding. The
 * shopkeeper writes his খাতা by hand and sometimes forgets to record a payment;
 * without that sentence, a customer who has already paid receives a flat
 * accusation from a number he does not recognise.
 */
function reminderBody({ customer, shopName, amount }) {
  return [
    `প্রিয় ${customer},`,
    '',
    `আসসালামু আলাইকুম। ${shopName}-এ আপনার বাকি ৳${bn(Math.round(amount))}।`,
    'সুবিধামতো পরিশোধ করলে উপকৃত হব।',
    '',
    'ইতিমধ্যে পরিশোধ করে থাকলে এই বার্তাটি উপেক্ষা করুন।',
    '',
    '— TO-LET PRO (স্বয়ংক্রিয় বার্তা)',
  ].join('\n');
}

/**
 * One sweep. Safe to run more often than daily: what caps the messages is the
 * `lastSentAt` claim, not the schedule.
 *
 * @returns {Promise<number>} how many reminders actually went out
 */
async function runKhataReminders() {
  const cooldownBefore = daysAgo(COOLDOWN_DAYS);

  const candidates = await LedgerParty.find({
    'reminder.auto': true,
    archivedAt: null,
    balance: { $gte: MIN_BALANCE },
    phone: { $nin: [null, ''] },
    // Either never reminded, or the cooldown has passed.
    $or: [
      { 'reminder.lastSentAt': null },
      { 'reminder.lastSentAt': { $lt: cooldownBefore } },
    ],
    // Quiet while he is still trading here. A missing `lastEntryAt` means no
    // entries at all, which cannot be "recently active".
    $and: [{
      $or: [
        { lastEntryAt: null },
        { lastEntryAt: { $lt: daysAgo(QUIET_AFTER_ACTIVITY_DAYS) } },
      ],
    }],
  })
    .sort({ balance: -1 })
    .limit(500)
    .lean();

  if (!candidates.length) return 0;

  // One merchant lookup per merchant, not per party — a shop with fifteen
  // debtors due is one query, not fifteen.
  const merchantIds = [...new Set(candidates.map((p) => String(p.merchantId)))];
  const merchants = await Merchant.find({ _id: { $in: merchantIds } })
    .select('name isBanned khataAutoReminders')
    .lean();
  const byMerchant = new Map(merchants.map((m) => [String(m._id), m]));

  const sentPerMerchant = new Map();
  let sent = 0;

  for (const party of candidates) {
    const key = String(party.merchantId);
    const merchant = byMerchant.get(key);

    // No merchant, kill switch off, or a suspended shop — none of these get to
    // send messages in somebody's name.
    if (!merchant || merchant.khataAutoReminders === false || merchant.isBanned) continue;

    const already = sentPerMerchant.get(key) || 0;
    if (already >= MAX_PER_MERCHANT) continue;

    // CLAIM BEFORE SENDING. The filter repeats the cooldown so that two
    // overlapping runs cannot both pass it — whichever update lands first wins
    // and the other modifies nothing.
    const claim = await LedgerParty.updateOne(
      {
        _id: party._id,
        'reminder.auto': true,
        balance: { $gte: MIN_BALANCE },
        $or: [
          { 'reminder.lastSentAt': null },
          { 'reminder.lastSentAt': { $lt: cooldownBefore } },
        ],
      },
      {
        $set: { 'reminder.lastSentAt': new Date() },
        $inc: { 'reminder.sentCount': 1 },
      },
    ).catch(() => ({ modifiedCount: 0 }));
    if (!claim.modifiedCount) continue;

    const body = reminderBody({
      customer: party.name || 'গ্রাহক',
      shopName: merchant.name || 'দোকান',
      amount: party.balance,
    });

    const res = await whatsapp
      .sendWhatsAppMessage(party.phone, { body })
      .catch(() => ({ success: false }));

    if (!res?.success) {
      // Undeliverable. Hand the cooldown back rather than burning a week of it
      // on a message nobody received — but only to what it was, so a send that
      // actually happened moments ago in another run is not undone.
      await LedgerParty.updateOne(
        { _id: party._id },
        {
          $set: { 'reminder.lastSentAt': party.reminder?.lastSentAt || null },
          $inc: { 'reminder.sentCount': -1 },
        },
      ).catch(() => {});
      continue;
    }

    sentPerMerchant.set(key, already + 1);
    sent += 1;
  }

  if (sent) console.log(`[khata-reminder] sent ${sent} reminder(s)`);
  return sent;
}

module.exports = {
  runKhataReminders,
  reminderBody,
  COOLDOWN_DAYS,
  MIN_BALANCE,
  QUIET_AFTER_ACTIVITY_DAYS,
  MAX_PER_MERCHANT,
  TZ,
};
