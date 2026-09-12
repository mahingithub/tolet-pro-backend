'use strict';

/**
 * soloDueReminder.service — "ফেরত দেওয়ার তারিখ" nudges for the private খাতা.
 * ──────────────────────────────────────────────────────────────────────────
 * When someone writes a ধার দিলাম in the solo wallet they can put a date on it:
 * the day the money was promised back. This sweep sends ONE polite message to
 * the borrower the day before that date — WhatsApp first, SMS only if WhatsApp
 * could not deliver.
 *
 * ── The person being messaged is not our user ─────────────────────────────
 * That is the whole reason this file is careful. The borrower is a friend whose
 * number the lender typed into a friend profile; they never signed up, never
 * agreed to anything, and cannot unsubscribe from a list they were never on.
 * So every one of these is a hard rule, not a preference:
 *
 *   • OPT-IN PER LOAN. `entry.remind` defaults to false in the schema and is
 *     only ever true because the lender ticked the switch shown next to that
 *     friend's phone number (SoloEntrySheet.jsx). A date on its own sends
 *     nothing.
 *   • ONCE PER LOAN, EVER. `reminderSentAt` is claimed atomically before the
 *     send, so overlapping runs, a restart mid-sweep or a retried cron cannot
 *     produce a second message. Re-armed only when the lender actually moves
 *     the date (see buildEntry in livingSolo.controller).
 *   • NEVER AFTER THE DUE DATE. The window closes the moment the day arrives.
 *     Chasing an overdue debt on the lender's behalf is a different product
 *     with different consent, and this is not it.
 *   • NEVER IF IT IS ALREADY SETTLED. The balance is recomputed from the
 *     ledger at send time; somebody who has paid up is not messaged, whatever
 *     the old row still says.
 *   • SAYS WHO IT IS FROM. The body names the lender and signs off as an
 *     automated TO-LET PRO message, because it arrives from OUR number, not
 *     theirs. A money message from an unknown number that doesn't explain
 *     itself is indistinguishable from a scam.
 *
 * Sends also pass through whatsapp.service's shared throttle (per-recipient and
 * per-account daily caps), so this can never become a blast.
 */

const SoloLedger = require('../models/SoloLedger');
const User = require('../models/User');
const whatsapp = require('./whatsapp.service');
const env = require('../config/env');
const { publicAppBaseUrl } = require('../utils/inviteToken');

// Optional SMS fallback — absent in installs that don't ship the provider.
let sms = null;
try { sms = require('./sms.service'); } catch { sms = null; }

const TZ = process.env.CRON_TZ || 'Asia/Dhaka';
const BST_OFFSET = '+06:00';

// How far ahead to look. 1 = "the day before", which is the promise the UI
// makes. The window also covers TODAY, so a run the server slept through (Render
// free tier) still gets the message out on the due day rather than never.
const LEAD_DAYS = 1;

/**
 * What each entry type does to a friend's balance: +1 = they owe me more.
 * Mirrors ENTRY_TYPES in the frontend's components/living/soloConfig.jsx, which
 * remains the source of truth — the server only needs this to answer one
 * question ("do they still owe anything?") before messaging a stranger.
 */
const PERSON_DELTA = {
  lend: 1,
  borrow: -1,
  'repay-in': -1,
  'repay-out': 1,
};

const dhakaDay = (offsetDays = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
};

/** Midnight in Dhaka on a `YYYY-MM-DD`, as a real instant. */
const dhakaMidnight = (day) => new Date(`${day}T00:00:00${BST_OFFSET}`);

const MONTHS_BN = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
  'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
const bn = (n) => String(n).replace(/\d/g, (d) => BN_DIGITS[Number(d)]);

/** "১৯ সেপ্টেম্বর ২০২৬", read in Dhaka time whatever the server's clock says. */
function bnDate(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(new Date(date));
  const get = (t) => Number(parts.find((p) => p.type === t)?.value || 0);
  return `${bn(get('day'))} ${MONTHS_BN[get('month') - 1]} ${bn(get('year'))}`;
}

/** What that friend still owes, from every live row pointing at them. */
function outstandingFor(doc, personId) {
  return (doc.entries || []).reduce((sum, e) => {
    if (e.deletedAt || e.personId !== personId) return sum;
    return sum + (PERSON_DELTA[e.type] || 0) * (Number(e.amount) || 0);
  }, 0);
}

/**
 * The message the borrower receives. Formal, names both people, states the
 * amount and the date, and ends with the link that lets them keep the same
 * khata themselves — which is the only reason a stranger would want to hear
 * from us at all.
 */
function reminderBody({ borrower, lender, amount, outstanding, lentOn, dueOn, dueToday }) {
  const link = `${publicAppBaseUrl()}/living?ref=due-reminder`;
  const who = lender ? `${lender}` : 'আপনার পরিচিত একজন';
  const when = dueToday ? 'আজ' : 'আগামীকাল';

  const lines = [
    `প্রিয় ${borrower},`,
    '',
    `শুভেচ্ছা জানবেন। ${who} গত ${bnDate(lentOn)} তারিখে আপনাকে ৳${bn(amount)} ধার দিয়েছিলেন, যা ফেরত দেওয়ার নির্ধারিত তারিখ ${when} (${bnDate(dueOn)})।`,
  ];

  // Only worth saying when it differs from the loan itself — otherwise it reads
  // as the same number written twice.
  if (Math.round(outstanding) !== Math.round(amount)) {
    lines.push('', `এই মুহূর্তে মোট বকেয়া ৳${bn(Math.round(outstanding))}।`);
  }

  lines.push(
    '',
    'অনুগ্রহ করে নির্ধারিত সময়ের মধ্যে পরিশোধ করার জন্য অনুরোধ করা হলো। ইতিমধ্যে পরিশোধ করে থাকলে এই বার্তাটি উপেক্ষা করুন।',
    '',
    `নিজের ধার-দেনা ও খরচের হিসাব রাখতে TO-LET PRO ব্যবহার করতে পারেন — একদম বিনামূল্যে:`,
    link,
    '',
    '— TO-LET PRO (স্বয়ংক্রিয় বার্তা)',
  );

  return lines.join('\n');
}

/**
 * One sweep. Safe to run more often than daily — the reminderSentAt claim is
 * what caps the messages, not the schedule.
 *
 * @returns {Promise<number>} how many reminders actually went out
 */
async function runSoloDueReminders() {
  const from = dhakaMidnight(dhakaDay(0));
  // Exclusive upper bound: midnight at the START of the day after the lead
  // window, so "due tomorrow" is included and "due in two days" is not.
  const to = dhakaMidnight(dhakaDay(LEAD_DAYS + 1));

  const match = {
    type: 'lend',
    remind: true,
    reminderSentAt: null,
    deletedAt: null,
    dueDate: { $gte: from, $lt: to },
  };

  const ledgers = await SoloLedger.find({ entries: { $elemMatch: match } })
    .select('userId people entries')
    .lean();

  let sent = 0;

  for (const doc of ledgers) {
    // One name lookup per ledger, not per entry — a lender with three loans
    // falling due the same week is one query, not three.
    let lenderName = '';
    const user = await User.findById(doc.userId).select('name').lean().catch(() => null);
    if (user && user.name) lenderName = String(user.name).trim();

    const dueEntries = (doc.entries || []).filter(
      (e) => e.type === 'lend'
        && e.remind
        && !e.reminderSentAt
        && !e.deletedAt
        && e.dueDate
        && new Date(e.dueDate) >= from
        && new Date(e.dueDate) < to,
    );

    for (const entry of dueEntries) {
      const person = (doc.people || []).find((p) => p.id === entry.personId && !p.deletedAt);
      const phone = person ? String(person.phone || '').trim() : '';
      // No friend, no number → nothing to do, and nothing worth burning the
      // one-shot claim on either: the lender may still add the number today.
      if (!person || phone.length < 8) continue;

      // Already square? Then the promise was kept and there is nothing to ask
      // for. Left unclaimed on purpose — if a repayment row is corrected later
      // and the balance comes back, so does the reminder.
      const outstanding = outstandingFor(doc, person.id);
      if (outstanding < 1) continue;

      // CLAIM BEFORE SENDING. A duplicate money message is worse than a missed
      // one, so the failure mode is deliberately "sent at most once", never
      // "sent at least once" — same contract as visitReminder.service.
      const claim = await SoloLedger.updateOne(
        { _id: doc._id, entries: { $elemMatch: { id: entry.id, reminderSentAt: null } } },
        { $set: { 'entries.$.reminderSentAt': new Date() } },
      ).catch(() => ({ modifiedCount: 0 }));
      if (!claim.modifiedCount) continue;

      const body = reminderBody({
        borrower: person.name || 'বন্ধু',
        lender: lenderName,
        amount: Math.round(Number(entry.amount) || 0),
        outstanding,
        lentOn: entry.date,
        dueOn: entry.dueDate,
        dueToday: new Date(entry.dueDate) < dhakaMidnight(dhakaDay(1)),
      });

      const waRes = await whatsapp.sendWhatsAppMessage(phone, { body }).catch(() => ({ success: false }));

      // SMS costs real money per message and a Bangla body is several segments,
      // so it is strictly a fallback for a WhatsApp that could not deliver —
      // never a second copy alongside it.
      if (!waRes.success && env.smsApiKey && sms) {
        await sms.sendSms(phone, body).catch((e) =>
          console.warn(`[solo-due] sms fallback failed for entry ${entry.id}:`, e.message));
      }

      sent += 1;
    }
  }

  if (sent) console.log(`[solo-due] sent ${sent} repayment reminder(s)`);
  return sent;
}

module.exports = { runSoloDueReminders, reminderBody, outstandingFor };
