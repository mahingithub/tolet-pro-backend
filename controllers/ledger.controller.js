'use strict';

/**
 * Ledger Controller — তালি খাতা.
 * ─────────────────────────────────────────────────────────────────────────────
 * The shopkeeper's own credit book, digitised as-is. Two buttons he has used
 * his whole working life — **দিলাম** and **পেলাম** — a page per person, and a
 * running total. Plus the daily বিক্রি / খরচ page from the same book.
 *
 * Everything here belongs to ONE merchant and is private to him. It is not a
 * platform ledger, there is no double-entry, and no accountant will ever read
 * it. The measure of success is that he stops carrying the paper one.
 *
 * ─── THE THREE RULES ─────────────────────────────────────────────────────────
 * 1. THE TOTAL MUST ALWAYS BE EXPLAINABLE. Balances move by `$inc` from a real
 *    entry and never by direct assignment, a void reverses exactly what its
 *    entry added, and `recompute()` can rebuild any balance from the lines. A
 *    shopkeeper who cannot trust the number goes back to paper the same day.
 *
 * 2. A DUPLICATE SYNC MUST NOT DOUBLE A DEBT. He writes entries on two bars of
 *    signal; the same one will arrive twice. `clientEntryId` makes the second
 *    a no-op that returns the FIRST entry, so the client sees success rather
 *    than an error it would retry again.
 *
 * 3. REMINDERS GO TO STRANGERS. The person who owes him money is not a user of
 *    this platform and never agreed to hear from us. See `remind()`.
 */

const mongoose = require('mongoose');

const LedgerParty = require('../models/LedgerParty');
const LedgerEntry = require('../models/LedgerEntry');
const ApiError = require('../utils/ApiError');
const whatsapp = require('../services/whatsapp.service');
const sms = require('../services/sms.service');

const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// A customer may be reminded at most this often. Deliberately long: the paper
// alternative is the shopkeeper mentioning it next time he walks past, and
// anything more frequent than that is us nagging on his behalf.
const REMINDER_COOLDOWN_DAYS = 7;

const PARTY_KINDS = LedgerEntry.PARTY_KINDS;

/** Fetch a party this merchant owns, or 404. The only door. */
async function loadParty(id, merchant) {
  if (!mongoose.isValidObjectId(id)) {
    throw ApiError.notFound('খাতা পাওয়া যায়নি।', { code: 'party_not_found' });
  }
  const party = await LedgerParty.findById(id);
  // 404 rather than 403 — a caller who does not own this page should not learn
  // that it exists.
  if (!party || String(party.merchantId) !== String(merchant._id)) {
    throw ApiError.notFound('খাতা পাওয়া যায়নি।', { code: 'party_not_found' });
  }
  return party;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ledger/summary — the number he opens the app to see
// ─────────────────────────────────────────────────────────────────────────────
exports.summary = asyncH(async (req, res) => {
  const merchantId = req.merchant._id;
  const today = LedgerEntry.dhakaDayKey();

  const [balances, todayTotals] = await Promise.all([
    LedgerParty.aggregate([
      { $match: { merchantId, archivedAt: null } },
      {
        $group: {
          _id: null,
          // Split rather than netted: "পাবেন ১২,৪০০" and "দেবেন ৮০০" are two
          // facts a shopkeeper acts on differently. A single net figure hides
          // both.
          willReceive: { $sum: { $cond: [{ $gt: ['$balance', 0] }, '$balance', 0] } },
          willPay: { $sum: { $cond: [{ $lt: ['$balance', 0] }, { $abs: '$balance' }, 0] } },
          parties: { $sum: 1 },
          owing: { $sum: { $cond: [{ $gt: ['$balance', 0] }, 1, 0] } },
        },
      },
    ]),
    LedgerEntry.aggregate([
      { $match: { merchantId, dayKey: today, voidedAt: null } },
      { $group: { _id: '$kind', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
  ]);

  const byKind = Object.fromEntries(todayTotals.map((r) => [r._id, r.total]));
  const b = balances[0] || { willReceive: 0, willPay: 0, parties: 0, owing: 0 };

  return res.json({
    summary: {
      willReceive: b.willReceive,
      willPay: b.willPay,
      parties: b.parties,
      owing: b.owing,
      today: {
        dayKey: today,
        sale: byKind.sale || 0,
        expense: byKind.expense || 0,
        purchase: byKind.purchase || 0,
        credit: byKind.credit || 0,
        payment: byKind.payment || 0,
      },
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Parties
// ─────────────────────────────────────────────────────────────────────────────
exports.listParties = asyncH(async (req, res) => {
  const filter = { merchantId: req.merchant._id, archivedAt: null };

  if (req.query.q) {
    const safe = String(req.query.q).trim().slice(0, 60)
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ name: new RegExp(safe, 'i') }, { phone: new RegExp(safe, 'i') }];
  }
  // "who owes me" is the default question this list answers.
  if (req.query.owing === '1') filter.balance = { $gt: 0 };

  const parties = await LedgerParty.find(filter)
    .sort({ balance: -1, lastEntryAt: -1 })
    .limit(Math.min(200, Number.parseInt(req.query.limit, 10) || 100));

  return res.json({ parties: parties.map((p) => p.toJSON()) });
});

exports.createParty = asyncH(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (name.length < 1) throw ApiError.badRequest('নাম দিন।', { code: 'name_required' });

  const phone = String(req.body?.phone || '').trim();

  // Same phone under the same merchant is nearly always the same person added
  // twice — which is how one debt silently becomes two half-debts. Hand back
  // the existing page instead of creating a rival.
  if (phone) {
    const existing = await LedgerParty.findOne({ merchantId: req.merchant._id, phone });
    if (existing) {
      return res.status(200).json({ party: existing.toJSON(), existing: true });
    }
  }

  const party = await LedgerParty.create({
    merchantId: req.merchant._id,
    name,
    phone,
    note: String(req.body?.note || '').trim(),
  });
  return res.status(201).json({ party: party.toJSON() });
});

exports.getParty = asyncH(async (req, res) => {
  const party = await loadParty(req.params.id, req.merchant);
  const entries = await LedgerEntry.find({ partyId: party._id })
    .sort({ at: -1 })
    .limit(Math.min(500, Number.parseInt(req.query.limit, 10) || 100));

  return res.json({
    party: party.toJSON(),
    entries: entries.map((e) => e.toJSON()),
    canRemind: canRemind(party).ok,
  });
});

exports.updateParty = asyncH(async (req, res) => {
  const party = await loadParty(req.params.id, req.merchant);

  if (typeof req.body?.name === 'string' && req.body.name.trim()) {
    party.name = req.body.name.trim();
  }
  if (typeof req.body?.phone === 'string') party.phone = req.body.phone.trim();
  if (typeof req.body?.note === 'string') party.note = req.body.note.trim();
  // Consent is the merchant's to give on his customer's behalf and his to
  // withdraw. It is never implied by having a phone number on file.
  if (typeof req.body?.reminderOptIn === 'boolean') {
    party.reminder.optIn = req.body.reminderOptIn;
    // Withdrawing consent withdraws ALL of it. Leaving `auto` armed under a
    // revoked opt-in would mean the server kept messaging somebody the
    // shopkeeper had just told us to stop messaging.
    if (!req.body.reminderOptIn) party.reminder.auto = false;
  }
  // A SEPARATE switch: "the server may send these unattended, on a schedule".
  // Refused unless the manual consent is already on, so automation can never
  // be the first thing anybody agrees to.
  if (typeof req.body?.reminderAuto === 'boolean') {
    if (req.body.reminderAuto && !party.reminder.optIn) {
      throw ApiError.badRequest('আগে রিমাইন্ডারের অনুমতি চালু করুন।', {
        code: 'reminder_not_opted_in',
      });
    }
    party.reminder.auto = req.body.reminderAuto;
  }

  await party.save();
  return res.json({ party: party.toJSON() });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ledger/entries — দিলাম / পেলাম / বিক্রি / খরচ
// ─────────────────────────────────────────────────────────────────────────────
exports.createEntry = asyncH(async (req, res) => {
  const body = req.body || {};
  const kind = String(body.kind || '');
  if (!LedgerEntry.KINDS.includes(kind)) {
    throw ApiError.badRequest('কী ধরনের এন্ট্রি সেটা বলুন।', { code: 'bad_kind' });
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 1) {
    throw ApiError.badRequest('সঠিক টাকার পরিমাণ দিন।', { code: 'bad_amount' });
  }

  const clientEntryId = body.clientEntryId ? String(body.clientEntryId).slice(0, 64) : null;

  // Idempotency FIRST: a retried sync must return the original entry, not an
  // error the client would keep retrying.
  if (clientEntryId) {
    const already = await LedgerEntry.findOne({ merchantId: req.merchant._id, clientEntryId });
    if (already) {
      return res.status(200).json({ entry: already.toJSON(), duplicate: true });
    }
  }

  let party = null;
  if (PARTY_KINDS.includes(kind)) {
    if (!body.partyId) throw ApiError.badRequest('কার খাতায়?', { code: 'party_required' });
    party = await loadParty(body.partyId, req.merchant);
  } else if (body.partyId) {
    // A বিক্রি or খরচ line with somebody attached is a confused request —
    // probably the wrong button. Silently dropping the party (which is what
    // ignoring it amounts to) files the entry on the cash page while the
    // shopkeeper goes looking for it on somebody's credit page, and the debt
    // he meant to record never exists.
    throw ApiError.badRequest(
      'বিক্রি বা খরচের সাথে কারও নাম যুক্ত হয় না। বাকি লিখতে "দিলাম" বেছে নিন।',
      { code: 'party_not_allowed' },
    );
  }

  const at = body.at ? new Date(body.at) : new Date();
  if (Number.isNaN(at.getTime())) {
    throw ApiError.badRequest('তারিখ সঠিক নয়।', { code: 'bad_date' });
  }

  // Which pocket the money moved through. Rejected rather than ignored on a
  // দিলাম: that line moves no cash at all, so an account on it would be a
  // number filed against a pocket nothing ever entered or left.
  let account = 'cash';
  if (body.account !== undefined && body.account !== null && body.account !== '') {
    if (!LedgerEntry.ACCOUNTS.includes(body.account)) {
      throw ApiError.badRequest('অ্যাকাউন্ট সঠিক নয়।', { code: 'bad_account' });
    }
    if (!LedgerEntry.ACCOUNT_KINDS.includes(kind)) {
      throw ApiError.badRequest('এই ধরনের এন্ট্রিতে নগদ/বিকাশ/ব্যাংক লাগে না।', {
        code: 'account_not_allowed',
      });
    }
    account = body.account;
  }

  let entry;
  try {
    entry = await LedgerEntry.create({
      merchantId: req.merchant._id,
      partyId: party ? party._id : null,
      partyName: party ? party.name : '',
      kind,
      amount: Math.round(amount),
      note: String(body.note || '').trim(),
      at,
      dayKey: LedgerEntry.dhakaDayKey(at),
      account,
      source: ['manual', 'scan', 'order'].includes(body.source) ? body.source : 'manual',
      clientEntryId,
    });
  } catch (err) {
    // Two syncs raced past the check above. The winner's row is the answer.
    if (err?.code === 11000 && clientEntryId) {
      const winner = await LedgerEntry.findOne({ merchantId: req.merchant._id, clientEntryId });
      if (winner) return res.status(200).json({ entry: winner.toJSON(), duplicate: true });
    }
    throw err;
  }

  if (party) {
    // `$inc`, never an assignment: two entries written at the same moment must
    // both land, and a read-modify-write would lose one of them.
    await LedgerParty.updateOne({ _id: party._id }, {
      $inc: { balance: entry.balanceDelta(), entryCount: 1 },
      $set: { lastEntryAt: entry.at },
    });
    party = await LedgerParty.findById(party._id);
  }

  return res.status(201).json({
    entry: entry.toJSON(),
    party: party ? party.toJSON() : null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ledger/entries/:id/void
//
// A mistake is crossed out, not erased. The line stays visible with its reason
// so the running total always explains itself.
// ─────────────────────────────────────────────────────────────────────────────
exports.voidEntry = asyncH(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw ApiError.notFound('এন্ট্রি পাওয়া যায়নি।', { code: 'entry_not_found' });
  }
  const entry = await LedgerEntry.findById(req.params.id);
  if (!entry || String(entry.merchantId) !== String(req.merchant._id)) {
    throw ApiError.notFound('এন্ট্রি পাওয়া যায়নি।', { code: 'entry_not_found' });
  }
  if (entry.voidedAt) {
    throw ApiError.badRequest('এটি আগেই বাতিল করা হয়েছে।', { code: 'already_voided' });
  }

  // Read the delta BEFORE marking it void — balanceDelta() returns 0 once
  // `voidedAt` is set, which would silently reverse nothing at all.
  const delta = entry.balanceDelta();

  entry.voidedAt = new Date();
  entry.voidedReason = String(req.body?.reason || '').trim().slice(0, 200);
  await entry.save();

  let party = null;
  if (entry.partyId) {
    await LedgerParty.updateOne({ _id: entry.partyId }, {
      $inc: { balance: -delta, entryCount: -1 },
    });
    party = await LedgerParty.findById(entry.partyId);
  }

  return res.json({ entry: entry.toJSON(), party: party ? party.toJSON() : null });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ledger/entries — the daily page
// ─────────────────────────────────────────────────────────────────────────────
exports.listEntries = asyncH(async (req, res) => {
  const filter = { merchantId: req.merchant._id };
  if (req.query.dayKey) filter.dayKey = String(req.query.dayKey).slice(0, 10);
  if (req.query.kind && LedgerEntry.KINDS.includes(req.query.kind)) {
    filter.kind = req.query.kind;
  }
  // The cash page is the one without people on it.
  if (req.query.cashOnly === '1') filter.partyId = null;

  const entries = await LedgerEntry.find(filter)
    .sort({ at: -1 })
    .limit(Math.min(500, Number.parseInt(req.query.limit, 10) || 100));

  return res.json({ entries: entries.map((e) => e.toJSON()) });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reminders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * May this party be reminded right now?
 *
 * The recipient is a STRANGER to this platform — somebody who owes a shopkeeper
 * money and never signed up for anything. Every condition below exists so that
 * To-Let Pro cannot become the thing that harassed a shopkeeper's customer on
 * his behalf. They mirror the rules the ধার reminders already follow.
 */
function canRemind(party) {
  if (!party.phone) return { ok: false, reason: 'no_phone' };
  if (!party.reminder?.optIn) return { ok: false, reason: 'not_opted_in' };
  // Nothing owed, nothing to ask for. This is the one that matters most: a
  // reminder sent after somebody has already paid is the worst possible
  // message to receive.
  if (party.balance <= 0) return { ok: false, reason: 'settled' };

  const last = party.reminder.lastSentAt;
  if (last) {
    const days = (Date.now() - new Date(last).getTime()) / 86_400_000;
    if (days < REMINDER_COOLDOWN_DAYS) return { ok: false, reason: 'too_soon', days };
  }
  return { ok: true };
}

exports.remind = asyncH(async (req, res) => {
  const party = await loadParty(req.params.id, req.merchant);

  const gate = canRemind(party);
  if (!gate.ok) {
    const messages = {
      no_phone: 'এই ব্যক্তির ফোন নম্বর নেই।',
      not_opted_in: 'রিমাইন্ডার পাঠানোর অনুমতি দেওয়া নেই।',
      settled: 'কোনো বাকি নেই — রিমাইন্ডার পাঠানো হবে না।',
      too_soon: `সম্প্রতি পাঠানো হয়েছে। ${REMINDER_COOLDOWN_DAYS} দিন পর আবার পাঠাতে পারবেন।`,
    };
    throw ApiError.badRequest(messages[gate.reason] || 'পাঠানো যাবে না।', {
      code: `reminder_${gate.reason}`,
    });
  }

  const shopName = req.merchant.name || 'দোকান';
  const body = `আসসালামু আলাইকুম। ${shopName}-এ আপনার বাকি ৳${party.balance}। `
    + 'সুবিধামতো পরিশোধ করলে উপকৃত হব। ধন্যবাদ।';

  // WhatsApp first, SMS as the fallback. Both no-op safely when the channel is
  // not configured, so an unconfigured environment reports "not sent" rather
  // than throwing.
  let result = await whatsapp.sendWhatsAppMessage(party.phone, { body });
  let channel = 'whatsapp';
  if (!result?.success) {
    result = await sms.sendSms(party.phone, body).then(
      (r) => ({ success: r !== false, ...r }),
      () => ({ success: false }),
    );
    channel = 'sms';
  }

  if (!result?.success) {
    throw ApiError.badRequest('বার্তা পাঠানো গেল না।', { code: 'send_failed' });
  }

  // Stamped only on a SEND that actually happened, so a failed attempt does
  // not start the cooldown and lock him out of trying again.
  await LedgerParty.updateOne({ _id: party._id }, {
    $set: { 'reminder.lastSentAt': new Date() },
    $inc: { 'reminder.sentCount': 1 },
  });

  return res.json({ sent: true, channel });
});

exports.canRemind = canRemind;
exports.REMINDER_COOLDOWN_DAYS = REMINDER_COOLDOWN_DAYS;

// ─────────────────────────────────────────────────────────────────────────────
// Statements and reports — the read side
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Everything below is READ-ONLY and computed on the server, deliberately.
 *
 * A running balance that the phone works out for itself is a running balance
 * that disagrees with the shopkeeper's when one of them has an entry the other
 * has not synced yet — and the moment a customer is shown a statement, a
 * disagreement is an argument in the shop. The write path stays offline-first
 * and untouched; the numbers anybody is asked to BELIEVE are recomputed here
 * from the lines.
 */

/** 'YYYY-MM-DD' or nothing. Rejects anything else rather than guessing. */
function dayKeyOrNull(value) {
  const s = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** N days back from today, Dhaka-local, as a dayKey. */
function daysAgoKey(n) {
  return LedgerEntry.dhakaDayKey(new Date(Date.now() - n * 86_400_000));
}

/**
 * Resolve ?from= &to= into a closed dayKey range, defaulting to this month so
 * far. Both ends are INCLUSIVE, which is what "১ থেকে ৩১ তারিখ" means to
 * everyone who is not a programmer.
 */
function resolveRange(query) {
  const today = LedgerEntry.dhakaDayKey();
  const to = dayKeyOrNull(query.to) || today;
  const from = dayKeyOrNull(query.from) || `${today.slice(0, 7)}-01`;
  if (from > to) {
    throw ApiError.badRequest('শুরুর তারিখ শেষ তারিখের পরে হতে পারে না।', {
      code: 'bad_range',
    });
  }
  return { from, to };
}

/**
 * GET /api/ledger/parties/:id/statement?from=&to=
 *
 * The page a shopkeeper turns his phone around to show a customer. Opening
 * balance, every line in the period with the balance AFTER it, and the closing
 * balance — which is the Tally habit the paper book already has and the app
 * did not: the party page showed lines and one final number, so "কত ছিল, কত
 * দিলাম, এখন কত" could not be read off it.
 *
 * Voided lines stay in the list, struck through, contributing nothing. A
 * statement that quietly omits a cancelled entry is a statement whose totals
 * cannot be checked against the paper it replaced.
 */
/**
 * Opening balance, every line in the period with the balance AFTER it, closing
 * balance and the period totals.
 *
 * Shared by the screen and by the WhatsApp message ON PURPOSE. The number a
 * customer reads on the shopkeeper's phone and the number that arrives on his
 * own must come from the same arithmetic — two implementations of "the running
 * total" is two chances to disagree, in front of the one person who will
 * notice.
 */
async function buildStatement(party, from, to) {
  const [openingRows, lines] = await Promise.all([
    // Everything before the window, netted. `credit` adds to what he owes,
    // `payment` takes away — the same rule as LedgerEntry.balanceDelta(), which
    // this must not be allowed to drift from.
    LedgerEntry.aggregate([
      { $match: { partyId: party._id, voidedAt: null, dayKey: { $lt: from } } },
      {
        $group: {
          _id: null,
          opening: {
            $sum: {
              $cond: [{ $eq: ['$kind', 'credit'] }, '$amount', { $multiply: ['$amount', -1] }],
            },
          },
        },
      },
    ]),
    // Oldest FIRST here, unlike the party page: a running balance only reads
    // correctly downwards.
    LedgerEntry.find({ partyId: party._id, dayKey: { $gte: from, $lte: to } })
      .sort({ at: 1, _id: 1 })
      .limit(1000),
  ]);

  const opening = openingRows[0]?.opening || 0;

  let running = opening;
  let totalCredit = 0;
  let totalPayment = 0;

  const rows = lines.map((e) => {
    const delta = e.balanceDelta();
    running += delta;
    if (!e.voidedAt) {
      if (e.kind === 'credit') totalCredit += e.amount;
      if (e.kind === 'payment') totalPayment += e.amount;
    }
    return { ...e.toJSON(), delta, balanceAfter: running };
  });

  return {
    range: { from, to },
    opening,
    closing: running,
    totals: { credit: totalCredit, payment: totalPayment },
    entries: rows,
  };
}

exports.partyStatement = asyncH(async (req, res) => {
  const party = await loadParty(req.params.id, req.merchant);
  const { from, to } = resolveRange(req.query);
  const statement = await buildStatement(party, from, to);
  return res.json({ party: party.toJSON(), ...statement });
});

/**
 * GET /api/ledger/report?from=&to=
 *
 * The month-end page. What came in, what went out, what is still owed, and —
 * the number a shopkeeper actually checks against the tin box — how much cash
 * the book says should be there.
 *
 * CASH IS NOT PROFIT, and the split matters:
 *   বিক্রি (sale)     cash in    — goods out, money in
 *   পেলাম (payment)   cash in    — an old debt collected
 *   খরচ (expense)     cash out
 *   দিলাম (credit)    NO CASH    — goods left the shop, money did not arrive
 *
 * Netting দিলাম into the cash line is the single easiest way to make a
 * shopkeeper think he has money he does not have, so it is kept out and
 * reported separately as what it is: a debt he is owed.
 */
exports.report = asyncH(async (req, res) => {
  const merchantId = req.merchant._id;
  const { from, to } = resolveRange(req.query);

  const [byKind, byDay, openingRows, topDebtors, byAccount] = await Promise.all([
    LedgerEntry.aggregate([
      { $match: { merchantId, voidedAt: null, dayKey: { $gte: from, $lte: to } } },
      { $group: { _id: '$kind', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    // One row per day, so the client can draw the period without a second call.
    LedgerEntry.aggregate([
      { $match: { merchantId, voidedAt: null, dayKey: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: { day: '$dayKey', kind: '$kind' },
          total: { $sum: '$amount' },
        },
      },
      { $sort: { '_id.day': 1 } },
    ]),
    // What the whole book was owed before the window opened.
    LedgerEntry.aggregate([
      {
        $match: {
          merchantId, voidedAt: null, partyId: { $ne: null }, dayKey: { $lt: from },
        },
      },
      {
        $group: {
          _id: null,
          opening: {
            $sum: {
              $cond: [{ $eq: ['$kind', 'credit'] }, '$amount', { $multiply: ['$amount', -1] }],
            },
          },
        },
      },
    ]),
    LedgerParty.find({ merchantId, archivedAt: null, balance: { $gt: 0 } })
      .sort({ balance: -1 })
      .limit(5),
    // ALL TIME, not the period. "বিকাশে কত আছে" is a question about right now;
    // answering it with one month's movement would report a pocket as empty
    // because nothing happened to it since the 1st.
    LedgerEntry.aggregate([
      { $match: { merchantId, voidedAt: null, kind: { $in: ['sale', 'payment', 'expense', 'purchase'] } } },
      {
        $group: {
          _id: '$account',
          in: { $sum: { $cond: [{ $in: ['$kind', ['sale', 'payment']] }, '$amount', 0] } },
          out: { $sum: { $cond: [{ $in: ['$kind', ['expense', 'purchase']] }, '$amount', 0] } },
        },
      },
    ]),
  ]);

  const k = Object.fromEntries(byKind.map((r) => [r._id, r.total]));
  const counts = Object.fromEntries(byKind.map((r) => [r._id, r.count]));
  const sale = k.sale || 0;
  const expense = k.expense || 0;
  const purchase = k.purchase || 0;
  const credit = k.credit || 0;
  const payment = k.payment || 0;

  const openingReceivable = openingRows[0]?.opening || 0;

  // Collapse the per-(day, kind) rows into one row per day.
  const days = {};
  byDay.forEach(({ _id, total }) => {
    const row = days[_id.day] || (days[_id.day] = {
      dayKey: _id.day, sale: 0, expense: 0, purchase: 0, credit: 0, payment: 0,
    });
    row[_id.kind] = total;
  });

  return res.json({
    range: { from, to },
    totals: {
      sale, expense, purchase, credit, payment, counts,
      cashIn: sale + payment,
      cashOut: expense + purchase,
      netCash: sale + payment - expense - purchase,
      /**
       * বিক্রি − ক্রয় − খরচ over the period.
       *
       * An ESTIMATE, and the screen has to keep saying so. It is not profit in
       * the accounting sense because stock does not sell in the month it is
       * bought: a shopkeeper who filled his shelves on the 28th shows a
       * terrible month, and one who sold down old stock without restocking
       * shows a wonderful one. Over a quarter it converges; over a week it can
       * be nonsense.
       *
       * Reported anyway because the alternative is what the app did before,
       * which was to offer no answer at all to "লাভ কত হলো" — and a rough
       * answer he can sanity-check beats a shopkeeper guessing.
       */
      margin: sale - purchase - expense,
    },
    /**
     * Balance per pocket, according to the book. Not a bank statement: it is
     * only as right as what he wrote down, which is exactly why it is worth
     * showing — the gap between this and the real বিকাশ balance is how he finds
     * the entry he forgot.
     */
    accounts: LedgerEntry.ACCOUNTS.map((id) => {
      const row = byAccount.find((a) => (a._id || 'cash') === id);
      return {
        id,
        in: row?.in || 0,
        out: row?.out || 0,
        balance: (row?.in || 0) - (row?.out || 0),
      };
    }),
    receivable: {
      opening: openingReceivable,
      // Rebuilt from the lines rather than read off LedgerParty.balance, so a
      // period that ends in the past reports what was true THEN.
      closing: openingReceivable + credit - payment,
      given: credit,
      collected: payment,
    },
    days: Object.values(days),
    topDebtors: topDebtors.map((p) => p.toJSON()),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sending a statement to the customer
// ─────────────────────────────────────────────────────────────────────────────
/**
 * A statement may be sent at most this often. Far shorter than the reminder
 * cooldown because the two messages are not the same kind of thing: a reminder
 * is pushed AT somebody, a statement is nearly always asked for by the person
 * standing at the counter. A week-long lock on answering "আমার কত বাকি?" would
 * simply send him back to reading it out loud.
 */
const STATEMENT_COOLDOWN_HOURS = 24;

/** Longest line list a WhatsApp text can carry before it stops being readable. */
const STATEMENT_MAX_LINES = 25;

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
/** Latin digits → Bengali. The recipient is a shopkeeper's customer, not a dev. */
const bnNum = (v) => String(v).replace(/\d/g, (d) => BN_DIGITS[Number(d)]);
const taka = (v) => `৳${bnNum(Math.abs(Math.round(v)))}`;

const bnDay = (iso) => new Date(iso).toLocaleDateString('bn-BD', {
  timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short',
});

/**
 * May this party be sent a statement right now?
 *
 * Shares `reminder.optIn` with reminders — one consent, given once — but
 * deliberately NOT the "must owe something" rule. A statement on a settled
 * account is a receipt, and "আপনার হিসাব মিটে গেছে" is the single best message
 * a customer can get from a shop. Refusing to send it would be refusing the
 * only message here that is unambiguously good news.
 */
function canSendStatement(party) {
  if (!party.phone) return { ok: false, reason: 'no_phone' };
  if (!party.reminder?.optIn) return { ok: false, reason: 'not_opted_in' };

  const last = party.statement?.lastSentAt;
  if (last) {
    const hours = (Date.now() - new Date(last).getTime()) / 3_600_000;
    if (hours < STATEMENT_COOLDOWN_HOURS) return { ok: false, reason: 'too_soon' };
  }
  return { ok: true };
}

/**
 * The message, written from the CUSTOMER'S side of the counter.
 *
 * This is the part that is easy to get quietly, badly wrong. Everything in the
 * app reads from the shopkeeper's view — `balance > 0` means "আপনি পাবেন", and
 * a line is "দিলাম" because he gave the goods. Send those words to the customer
 * unchanged and every one of them is inverted: the customer is told he will
 * RECEIVE the money he in fact owes, about goods he is told he gave away.
 *
 * So the whole message is flipped once, here, where it can be checked:
 *
 *   credit  (দিলাম, shop→customer)   → "বাকি"  — what he took on credit
 *   payment (পেলাম, customer→shop)   → "জমা"   — what he paid in
 *   balance > 0                      → "আপনার বাকি"
 *   balance < 0                      → "আপনি বেশি জমা দিয়েছেন"
 */
function buildStatementMessage({ shopName, party, statement }) {
  const { opening, closing, totals, entries, range } = statement;

  const standingLine = (value, prefix) => {
    if (value > 0) return `${prefix}: ${taka(value)} (বাকি)`;
    if (value < 0) return `${prefix}: ${taka(value)} (জমা বেশি)`;
    return `${prefix}: ${taka(0)}`;
  };

  const lines = [];
  lines.push(`*${shopName}*`);
  lines.push(`হিসাবের বিবরণী — ${party.name}`);
  lines.push(`${bnDay(`${range.from}T06:00:00Z`)} – ${bnDay(`${range.to}T06:00:00Z`)}`);
  lines.push('');
  lines.push(standingLine(opening, 'আগের জের'));
  lines.push('——————————');

  // Too many lines to read on a phone. Show the most recent ones and carry the
  // balance INTO them, so the column still adds up instead of starting from a
  // number the reader cannot account for.
  const shown = entries.slice(-STATEMENT_MAX_LINES);
  const hidden = entries.length - shown.length;
  if (hidden > 0) {
    const carried = shown.length ? shown[0].balanceAfter - shown[0].delta : opening;
    lines.push(`(আগের ${bnNum(hidden)}টি লাইন বাদ)`);
    lines.push(standingLine(carried, 'চলতি জের'));
    lines.push('——————————');
  }

  shown.forEach((e) => {
    const what = e.kind === 'credit' ? 'বাকি' : 'জমা';
    const struck = e.voidedAt ? ' (বাতিল)' : '';
    const note = e.note ? ` — ${e.note}` : '';
    lines.push(`${bnDay(e.at)}  ${what} ${taka(e.amount)}${struck}${note}`);
  });

  lines.push('——————————');
  lines.push(`মোট বাকি নিয়েছেন: ${taka(totals.credit)}`);
  lines.push(`মোট জমা দিয়েছেন: ${taka(totals.payment)}`);
  lines.push('');

  if (closing > 0) {
    lines.push(`*এখন আপনার বাকি: ${taka(closing)}*`);
  } else if (closing < 0) {
    lines.push(`*আপনি ${taka(closing)} বেশি জমা দিয়েছেন।*`);
  } else {
    lines.push('*আপনার হিসাব মিটে গেছে। ধন্যবাদ।*');
  }

  return lines.join('\n');
}

/**
 * POST /api/ledger/parties/:id/statement/send
 *
 * ─── WHATSAPP ONLY, NO SMS FALLBACK ──────────────────────────────────────────
 * `remind` falls back to SMS because a reminder is one short sentence. A
 * statement is twenty lines, which is several SMS segments — each one billed,
 * to send a wall of text to somebody who did not ask for it in that form. When
 * WhatsApp cannot deliver, the honest answer is to say so: the shopkeeper is
 * standing next to the customer and can simply turn the phone around, which is
 * what the on-screen statement is for.
 */
exports.sendStatement = asyncH(async (req, res) => {
  const party = await loadParty(req.params.id, req.merchant);

  const gate = canSendStatement(party);
  if (!gate.ok) {
    const messages = {
      no_phone: 'এই ব্যক্তির ফোন নম্বর নেই।',
      not_opted_in: 'বার্তা পাঠানোর অনুমতি দেওয়া নেই।',
      too_soon: 'আজ একবার পাঠানো হয়েছে। আগামীকাল আবার পাঠাতে পারবেন।',
    };
    throw ApiError.badRequest(messages[gate.reason] || 'পাঠানো যাবে না।', {
      code: `statement_${gate.reason}`,
    });
  }

  const { from, to } = resolveRange(req.body || {});
  const statement = await buildStatement(party, from, to);

  const body = buildStatementMessage({
    shopName: req.merchant.name || 'দোকান',
    party,
    statement,
  });

  const result = await whatsapp.sendWhatsAppMessage(party.phone, { body });
  if (!result?.success) {
    throw ApiError.badRequest(
      'হোয়াটসঅ্যাপে পাঠানো গেল না। আপাতত স্ক্রিনে দেখিয়ে দিন।',
      { code: 'send_failed' },
    );
  }

  // Stamped only on a send that actually happened, so a gateway that was down
  // does not start the cooldown and lock him out of trying again.
  await LedgerParty.updateOne({ _id: party._id }, {
    $set: { 'statement.lastSentAt': new Date() },
    $inc: { 'statement.sentCount': 1 },
  });

  return res.json({
    sent: true,
    channel: 'whatsapp',
    range: statement.range,
    lines: statement.entries.length,
  });
});

exports.canSendStatement = canSendStatement;
exports.buildStatementMessage = buildStatementMessage;
exports.STATEMENT_COOLDOWN_HOURS = STATEMENT_COOLDOWN_HOURS;

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/ledger/settings — the shop-wide switches
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Currently one switch: the kill for automated খাতা reminders.
 *
 * It is not a consent gate — consent lives per customer and defaults off, so
 * nothing sends until he arms it there. This is the thing he reaches for when
 * one customer complains and he wants ALL of it to stop now, without hunting
 * through however many pages he switched on.
 */
exports.updateSettings = asyncH(async (req, res) => {
  if (typeof req.body?.autoReminders === 'boolean') {
    req.merchant.khataAutoReminders = req.body.autoReminders;
    await req.merchant.save();
  }
  return res.json({ merchant: req.merchant.toJSON() });
});
