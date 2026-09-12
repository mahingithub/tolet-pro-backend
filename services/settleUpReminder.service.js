'use strict';

/**
 * settleUpReminder.service — "আমি দিয়েছি, তোমার ভাগটা দাও" for the shared wallet.
 * ──────────────────────────────────────────────────────────────────────────
 * The joint wallet already knows who paid what and who owes whom. What it had
 * no way to do was SAY so: somebody fronts ৳2,000 for the electricity bill, the
 * split lands in the ledger, and then the asking happens over chai, or not at
 * all. This turns the balance the app already computed into one message.
 *
 * ── The rules, and why each one ───────────────────────────────────────────
 *   • YOU CAN ONLY CHASE WHAT IS OWED TO YOU. The debt is looked up in the
 *     server's own simplifyDebts() as `debtor → caller`. There is no way to
 *     send "you owe X" on somebody else's behalf, and no way to name your own
 *     figure: the amount is recomputed here (utils/livingLedger.js), never
 *     taken from the request. A number that lands in someone's WhatsApp signed
 *     TO-LET PRO has to be ours.
 *   • ONCE A DAY PER PAIR. Roommates argue about money; the app must not become
 *     the instrument. reminderLog on the Household holds the cap.
 *   • NOTHING OWED, NOTHING SENT. Settle up first and the button refuses.
 *   • THE MESSAGE IS A RECEIPT, NOT A DEMAND. It leads with what the sender
 *     actually paid for, so the recipient can check the claim rather than
 *     just be told.
 *
 * Delivery is in-app (they are all real users — that is the whole premise of a
 * connected household) PLUS WhatsApp. Deliberately no SMS: everyone here has
 * the app, so paying per message would buy nothing.
 */

const User = require('../models/User');
const notifications = require('./notification.service');
const whatsapp = require('./whatsapp.service');
const { publicAppBaseUrl } = require('../utils/inviteToken');
const { computeLedger, simplifyDebts, paymentBreakdown } = require('../utils/livingLedger');

// One nudge per creditor→debtor pair per 24h.
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const LOG_MEMORY = 200;

// Mirrors CATEGORIES + BILL types in the client's living/livingConfig.jsx. Only
// the Bangla label is needed here; an unknown key falls back to অন্যান্য rather
// than leaking a raw slug like "maid" into a formal message.
const CATEGORY_BN = {
  electricity: 'বিদ্যুৎ বিল',
  gas: 'গ্যাস বিল',
  water: 'পানির বিল',
  wifi: 'ওয়াইফাই',
  internet: 'ইন্টারনেট',
  groceries: 'বাজার',
  maid: 'বুয়ার বেতন',
  cleaning: 'পরিষ্কার',
  food: 'খাওয়া-দাওয়া',
  rent: 'বাসা ভাড়া',
  other: 'অন্যান্য',
};

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
const bn = (n) => String(n).replace(/\d/g, (d) => BN_DIGITS[Number(d)]);
const bnTaka = (n) => `৳${bn(Math.round(Number(n) || 0).toLocaleString('en-US'))}`;

/** The household in the exact shape the ledger port expects. */
function ledgerInput(hh) {
  return {
    roommates: hh.members.map((m) => ({ id: String(m._id), name: m.name, color: m.color })),
    expenses: (hh.expenses || []).map((e) => ({
      amount: e.amount, paidBy: e.paidBy, splitWith: e.splitWith || [],
      splitType: e.splitType, shares: e.shares || {}, category: e.category, date: e.date,
    })),
    bills: (hh.bills || []).map((b) => ({
      amount: b.amount, paidBy: b.paidBy, createdBy: b.createdBy,
      status: b.status, paidAmount: b.paidAmount, type: b.type,
    })),
    meals: (hh.meals || []).map((m) => ({
      roommateId: m.roommateId, date: m.date,
      breakfast: m.breakfast, lunch: m.lunch, dinner: m.dinner,
    })),
    groceries: (hh.groceries || []).map((g) => ({ amount: g.amount, paidBy: g.paidBy, date: g.date })),
    settlements: (hh.settlements || []).map((s) => ({ from: s.from, to: s.to, amount: s.amount })),
  };
}

const lastNudge = (hh, from, to) => {
  const rows = (hh.reminderLog || []).filter((r) => r.from === from && r.to === to);
  if (!rows.length) return null;
  return rows.reduce((latest, r) => (new Date(r.at) > new Date(latest.at) ? r : latest));
};

/**
 * "বিদ্যুৎ বিল ৳২,০০০ · বাজার ৳৫০০" — the top few things the creditor paid for,
 * biggest first. Capped at three so the message stays readable in a chat.
 */
function paidSummaryLine(cats, limit = 3) {
  return cats.slice(0, limit)
    .map((c) => `${CATEGORY_BN[c.key] || CATEGORY_BN.other} ${bnTaka(c.amount)}`)
    .join(' · ');
}

function reminderCopy({ householdName, creditorName, debtorName, amount, paidTotal, cats, creditorPhone }) {
  const link = `${publicAppBaseUrl()}/living`;
  const title = `💰 ${creditorName} হিসাব মেলানোর অনুরোধ করেছেন`;

  const lines = [`প্রিয় ${debtorName},`, ''];

  if (paidTotal > 0) {
    const detail = paidSummaryLine(cats);
    lines.push(
      `${householdName} — ${creditorName} সব মিলিয়ে ${bnTaka(paidTotal)} পরিশোধ করেছেন${detail ? ` (${detail})` : ''}।`,
    );
  } else {
    lines.push(`${householdName} — যৌথ হিসাব মেলানোর অনুরোধ।`);
  }

  lines.push(
    '',
    `ভাগ অনুযায়ী আপনার কাছে ${creditorName} ${bnTaka(amount)} পাবেন। অনুগ্রহ করে সুবিধামতো পরিশোধ করে দেওয়ার অনুরোধ রইলো।`,
  );

  // The whole point of the nudge is that it ends in a payment, so the way to
  // pay goes IN the message rather than being left as an exercise.
  if (creditorPhone) lines.push('', `${creditorName}-এর নম্বর: ${creditorPhone}`);

  lines.push(
    '',
    `পুরো হিসাব — কে কী দিয়েছে, কার কত বাকি — অ্যাপে দেখুন:`,
    link,
    '',
    '— TO-LET PRO (স্বয়ংক্রিয় বার্তা)',
  );

  return { title, body: lines.join('\n') };
}

/**
 * Work out who is being reminded, for how much, and what the message says —
 * WITHOUT sending or writing anything.
 *
 * Shared by the confirm dialog's preview and the send itself, so the words the
 * user approves are the words that go out. Two builders would drift, and then
 * the dialog would be showing a message nobody receives.
 *
 * @returns {Promise<object>} { ok:true, ... } or { ok:false, reason }
 */
async function resolveSettleUpReminder({ household, meMemberId, toMemberId, now = new Date() }) {
  const creditor = household.members.id(meMemberId);
  const debtor = household.members.id(toMemberId);
  if (!creditor) return { ok: false, reason: 'not_a_member' };
  if (!debtor) return { ok: false, reason: 'member_not_found' };
  if (String(creditor._id) === String(debtor._id)) return { ok: false, reason: 'self' };

  const input = ledgerInput(household);
  const net = computeLedger(input);
  const debts = simplifyDebts(net, input.roommates);

  // The ONLY debt this call may act on: money owed to the caller. Anything
  // else — including a debt between two other roommates — is not theirs to chase.
  const debt = debts.find((d) => d.from === String(debtor._id) && d.to === String(creditor._id));
  if (!debt) return { ok: false, reason: 'nothing_owed', debtorName: debtor.name };

  const breakdown = paymentBreakdown(input);
  const mine = breakdown.rows.find((r) => r.id === String(creditor._id)) || { total: 0, cats: [] };

  // A placeholder roommate (no linked account) has neither a phone nor an
  // inbox — there is nobody to deliver to.
  let phone = '';
  let debtorUserId = null;
  if (debtor.userId) {
    debtorUserId = debtor.userId;
    const u = await User.findById(debtor.userId).select('phone').lean().catch(() => null);
    if (u && u.phone) phone = String(u.phone).trim();
  }

  let creditorPhone = '';
  if (creditor.userId) {
    const u = await User.findById(creditor.userId).select('phone').lean().catch(() => null);
    if (u && u.phone) creditorPhone = String(u.phone).trim();
  }

  const { title, body } = reminderCopy({
    householdName: household.name || 'আমাদের বাসা',
    creditorName: creditor.name,
    debtorName: debtor.name,
    amount: debt.amount,
    paidTotal: mine.total,
    cats: mine.cats,
    creditorPhone,
  });

  const last = lastNudge(household, String(creditor._id), String(debtor._id));
  const onCooldown = !!last && now - new Date(last.at) < COOLDOWN_MS;

  return {
    ok: true,
    creditor,
    debtor,
    debtorUserId,
    phone,
    creditorPhone,
    amount: debt.amount,
    paidTotal: mine.total,
    cats: mine.cats,
    title,
    body,
    onCooldown,
    lastSentAt: last ? last.at : null,
    channels: { inApp: !!debtorUserId, whatsapp: !!phone },
  };
}

/** Preview only — what the confirm dialog shows. Sends nothing, writes nothing. */
async function previewSettleUpReminder(args) {
  const r = await resolveSettleUpReminder(args);
  if (!r.ok) return r;
  return {
    ok: true,
    debtorName: r.debtor.name,
    amount: r.amount,
    paidTotal: r.paidTotal,
    cats: r.cats,
    title: r.title,
    message: r.body,
    onCooldown: r.onCooldown,
    lastSentAt: r.lastSentAt,
    channels: r.channels,
  };
}

/**
 * Send one settle-up nudge. Writes the cooldown row and saves the household.
 *
 * The cooldown is burned even when WhatsApp fails — retrying a failed send is
 * exactly the pattern that gets a WhatsApp number banned, and the caller is
 * told which channel worked so they can follow up themselves.
 */
async function sendSettleUpReminder({ household, meMemberId, toMemberId, now = new Date() }) {
  const r = await resolveSettleUpReminder({ household, meMemberId, toMemberId, now });
  if (!r.ok) return r;
  if (r.onCooldown) {
    return { ok: false, reason: 'already_reminded_today', lastSentAt: r.lastSentAt, debtorName: r.debtor.name };
  }
  if (!r.channels.inApp && !r.channels.whatsapp) {
    return { ok: false, reason: 'no_channel', debtorName: r.debtor.name };
  }

  const out = { inApp: 'skipped', whatsapp: 'skipped' };

  if (r.debtorUserId) {
    out.inApp = 'queued';
    notifications.emit({
      userId: r.debtorUserId,
      type: 'payment',
      title: r.title,
      body: `${r.creditor.name} ${bnTaka(r.amount)} পাবেন — যৌথ হিসাবের ভাগ।`,
      data: {
        kind: 'settle_up_reminder',
        householdId: String(household._id),
        fromMemberId: String(r.creditor._id),
        amount: r.amount,
      },
    }).catch(() => {});
  }

  if (r.phone) {
    const waRes = await whatsapp
      .sendWhatsAppMessage(r.phone, { body: `${r.title}\n\n${r.body}` })
      .catch(() => ({ success: false }));
    out.whatsapp = waRes.success ? 'sent' : 'failed';
  }

  const cutoff = now.getTime() - COOLDOWN_MS;
  household.reminderLog = [
    ...(household.reminderLog || []).filter((row) => new Date(row.at).getTime() >= cutoff),
    { from: String(r.creditor._id), to: String(r.debtor._id), amount: r.amount, at: now },
  ].slice(-LOG_MEMORY);
  await household.save();

  return {
    ok: true,
    debtorName: r.debtor.name,
    amount: r.amount,
    channels: out,
  };
}

module.exports = {
  resolveSettleUpReminder,
  previewSettleUpReminder,
  sendSettleUpReminder,
  reminderCopy,
  COOLDOWN_MS,
};
