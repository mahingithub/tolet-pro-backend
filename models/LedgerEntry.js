'use strict';

/**
 * LedgerEntry — one line in the খাতা.
 * ─────────────────────────────────────────────────────────────────────────────
 * The paper book has two kinds of page and this collection carries both:
 *
 *   বাকির খাতা  (has a party)   credit  = দিলাম — he owes more
 *                               payment = পেলাম — he owes less
 *   দৈনিক হিসাব (no party)      sale     = বিক্রি
 *                               expense  = খরচ
 *                               purchase = ক্রয় (মাল তোলা)
 *
 * `kind` is the whole distinction. A `credit`/`payment` line moves a party's
 * balance; a `sale`/`expense` line moves only the day's totals. Keeping them in
 * one collection matches how a shopkeeper thinks — it is one book — and means
 * one write path, one idempotency rule, one void rule.
 *
 * ─── ENTRIES ARE NOT EDITED ──────────────────────────────────────────────────
 * A mistake is fixed by VOIDING the line and writing a new one, exactly as it
 * is fixed on paper by crossing out and rewriting. There is no update path.
 *
 * This is not pedantry: the running total is the only thing the shopkeeper
 * actually trusts, and an editable history means a total that can change
 * without any visible cause. A voided line stays visible, struck through, with
 * the reason — so the book always explains itself.
 *
 * ─── OFFLINE IS THE NORMAL CASE ──────────────────────────────────────────────
 * He is standing in a shop with two bars of signal, writing an entry while a
 * customer waits. The client applies it locally and syncs later, so the same
 * entry WILL arrive twice — `clientEntryId` makes the second one a no-op, the
 * same opId dedupe the offline write queues already use elsewhere.
 */

const mongoose = require('mongoose');

// credit / payment always carry a party; the cash kinds never do.
const KINDS = ['credit', 'payment', 'sale', 'expense', 'purchase'];
const PARTY_KINDS = ['credit', 'payment'];
const CASH_KINDS = ['sale', 'expense', 'purchase'];

/**
 * ─── WHY ক্রয় IS NOT JUST ANOTHER খরচ ────────────────────────────────────────
 * Both are money leaving the shop, so one kind would have been less code. They
 * answer different questions though, and merging them destroys the only one
 * that matters:
 *
 *   খরচ (expense)  — rent, electricity, tea, the boy's wages. Gone.
 *   ক্রয় (purchase) — stock bought to sell again. Still in the shop.
 *
 * বিক্রি − ক্রয় is what the shop earns on what it sells; খরচ is what it costs
 * to keep the doors open. Added together they become one meaningless number,
 * and a shopkeeper who stocked up heavily cannot tell a bad month from a big
 * delivery.
 */

/**
 * Where the money moved. Only meaningful for kinds that move money at all —
 * বিক্রি, খরচ, ক্রয় and পেলাম. দিলাম is goods leaving on credit with no cash
 * either way, so it carries no account.
 *
 * This is the half of "Tally" that a shopkeeper actually asks for: not debit
 * and credit columns, but "বিকাশে কত আছে".
 */
const ACCOUNTS = ['cash', 'bkash', 'bank'];
const ACCOUNT_KINDS = ['sale', 'expense', 'purchase', 'payment'];

/** +1 = money came in, −1 = money went out, 0 = no cash moved. */
const CASH_DIRECTION = {
  sale: 1,
  payment: 1,
  expense: -1,
  purchase: -1,
  credit: 0,
};

const LedgerEntrySchema = new mongoose.Schema(
  {
    merchantId: {
      type: mongoose.Schema.Types.ObjectId, ref: 'Merchant', required: true, index: true,
    },
    // Null for a cash-book line. Required for credit/payment — enforced below,
    // because an orphaned credit line is a balance nobody owns.
    partyId: {
      type: mongoose.Schema.Types.ObjectId, ref: 'LedgerParty', default: null, index: true,
    },
    // Snapshotted so a voided party or a renamed one still reads correctly on
    // an old page. The paper book does not rewrite last month's entries when
    // somebody changes their name.
    partyName: { type: String, trim: true, default: '', maxlength: 120 },

    kind: { type: String, enum: KINDS, required: true },

    // Whole taka. Always POSITIVE — direction lives in `kind`, never in the
    // sign, so a negative amount can never quietly invert an entry's meaning.
    amount: { type: Number, required: true, min: 1, max: 10_000_000 },

    note: { type: String, trim: true, default: '', maxlength: 300 },

    // Which pocket. Defaults to cash because that is what a counter sale is
    // unless he says otherwise, and because every entry written before this
    // field existed was cash.
    account: {
      type: String,
      enum: ACCOUNTS,
      default: 'cash',
    },

    // When it HAPPENED, which is not when it was synced. A shopkeeper entering
    // yesterday's sales this morning must see them under yesterday.
    at: { type: Date, default: Date.now, index: true },
    // 'YYYY-MM-DD' in Asia/Dhaka, so the daily page is one equality match
    // rather than a timezone-sensitive range scan.
    dayKey: { type: String, required: true, index: true },

    // ─── Void, not delete ────────────────────────────────────────────────────
    voidedAt:     { type: Date, default: null },
    voidedReason: { type: String, trim: true, default: '', maxlength: 200 },

    // Where the line came from. An entry the shopkeeper typed and one the AI
    // read off a photograph of his paper page are not equally trustworthy, and
    // he should be able to tell them apart when a total looks wrong.
    source: {
      type: String,
      enum: ['manual', 'scan', 'order'],
      default: 'manual',
    },
    // For source:'order' — the in-app order this line settles, so his walk-in
    // customers and his app orders live in ONE book rather than two.
    serviceRequestId: {
      type: mongoose.Schema.Types.ObjectId, ref: 'ServiceRequest', default: null,
    },

    // Offline idempotency. See the header note.
    clientEntryId: { type: String, default: null, maxlength: 64 },
  },
  { timestamps: true },
);

// ─── Indexes ─────────────────────────────────────────────────────────────────

// A party's page, newest first.
LedgerEntrySchema.index({ partyId: 1, at: -1 });
// The daily cash page.
LedgerEntrySchema.index({ merchantId: 1, dayKey: -1, kind: 1 });
// The merchant's whole book, newest first.
LedgerEntrySchema.index({ merchantId: 1, at: -1 });

// Offline dedupe. Partial for the same reason every other partial unique index
// in this codebase is: a plain one would treat every null `clientEntryId` as
// the same value and allow exactly ONE entry without a client id to exist per
// merchant — which is every entry made from a browser.
LedgerEntrySchema.index(
  { merchantId: 1, clientEntryId: 1 },
  { unique: true, partialFilterExpression: { clientEntryId: { $type: 'string' } } },
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** 'YYYY-MM-DD' in Asia/Dhaka — the day boundary a shopkeeper lives in. */
function dhakaDayKey(at = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at);
}

/**
 * What this line does to its party's balance, where balance means "what the
 * party owes the merchant".
 *
 *   credit  (দিলাম, goods out)  → +amount
 *   payment (পেলাম, cash in)    → −amount
 *
 * Cash-book lines touch no party and return 0.
 */
LedgerEntrySchema.methods.balanceDelta = function balanceDelta() {
  if (this.voidedAt) return 0;
  if (this.kind === 'credit') return this.amount;
  if (this.kind === 'payment') return -this.amount;
  return 0;
};

LedgerEntrySchema.pre('validate', function normalise(next) {
  if (PARTY_KINDS.includes(this.kind) && !this.partyId) {
    return next(new Error(`A "${this.kind}" entry needs a party.`));
  }
  if (CASH_KINDS.includes(this.kind) && this.partyId) {
    return next(new Error(`A "${this.kind}" entry must not have a party.`));
  }
  if (!this.dayKey) this.dayKey = dhakaDayKey(this.at || new Date());
  return next();
});

LedgerEntrySchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
});

/** What this line does to the account it names. Voided lines move nothing. */
LedgerEntrySchema.methods.cashDelta = function cashDelta() {
  if (this.voidedAt) return 0;
  return (CASH_DIRECTION[this.kind] || 0) * this.amount;
};

LedgerEntrySchema.statics.ACCOUNTS = ACCOUNTS;
LedgerEntrySchema.statics.ACCOUNT_KINDS = ACCOUNT_KINDS;
LedgerEntrySchema.statics.CASH_DIRECTION = CASH_DIRECTION;
LedgerEntrySchema.statics.KINDS = KINDS;
LedgerEntrySchema.statics.PARTY_KINDS = PARTY_KINDS;
LedgerEntrySchema.statics.CASH_KINDS = CASH_KINDS;
LedgerEntrySchema.statics.dhakaDayKey = dhakaDayKey;

module.exports = mongoose.model('LedgerEntry', LedgerEntrySchema);
module.exports.KINDS = KINDS;
module.exports.ACCOUNTS = ACCOUNTS;
module.exports.ACCOUNT_KINDS = ACCOUNT_KINDS;
module.exports.CASH_DIRECTION = CASH_DIRECTION;
module.exports.PARTY_KINDS = PARTY_KINDS;
module.exports.CASH_KINDS = CASH_KINDS;
module.exports.dhakaDayKey = dhakaDayKey;
