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
