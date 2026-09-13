'use strict';

/**
 * ─── ONE-TIME MIGRATION: pull ক্রয় back out of legacy খরচ ────────────────────
 *
 * Until `purchase` became its own entry kind, a shopkeeper who bought stock had
 * exactly one button for it: খরচ. So his history has মাল তোলা filed as expense,
 * which makes বিক্রি − ক্রয় − খরচ double-count the same money and report a
 * margin that is too low.
 *
 * ─── WHY THIS SCRIPT REFUSES TO GUESS ────────────────────────────────────────
 * There is no way to know from the data which old খরচ was stock. "৳২০০০" with
 * an empty note could be a delivery of rice or three months of electricity.
 * A heuristic that reclassified on its own would quietly rewrite a shopkeeper's
 * profit figures — the one thing in this app he is supposed to be able to
 * trust — and he would have no way to tell it had happened.
 *
 * So the split is a HUMAN decision and this tool only does the tedious parts:
 *
 *   1. REPORT (default) — group his old খরচ by note text, so somebody can
 *      actually see what is in there before deciding anything. Writes nothing.
 *   2. MATCH — reclassify only what an explicit pattern selects. The pattern
 *      comes from a person who looked at step 1.
 *   3. DRY RUN — even with a pattern, nothing is written without --apply. The
 *      dry run prints the exact lines that would change.
 *   4. JOURNAL + UNDO — an applied run writes every id it touched to a file,
 *      and --undo puts them all back.
 *
 * ─── USAGE ───────────────────────────────────────────────────────────────────
 *   # 1. Look first. Always.
 *   MONGODB_URI="…" node scripts/reclassify-purchases.js --merchant +8801711111111
 *
 *   # 2. Try a pattern. Still writes nothing.
 *   … --merchant +8801711111111 --match "মাল|চাল|ডাল|তেল|পাইকার"
 *
 *   # 3. Happy with the list? Write it, and keep the journal it prints.
 *   … --merchant +8801711111111 --match "মাল|চাল|ডাল|তেল|পাইকার" --apply
 *
 *   # 4. Regret it?
 *   … --undo .migrations/reclassify-1757740800000.json
 *
 * Options:
 *   --merchant <phone|id>  One shop. Omit to scan every shop (report only —
 *                          --apply without --merchant is refused; see below).
 *   --match <regex>        Case-insensitive, matched against the note.
 *   --empty-notes          Also select entries with NO note. Off by default:
 *                          an empty note is the case you can know least about.
 *   --from / --to          'YYYY-MM-DD' dayKey bounds.
 *   --apply                Actually write. Requires --match and --merchant.
 *   --undo <file>          Reverse an applied run.
 *   --limit <n>            Cap the report's group list (default 40).
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const { phoneCore } = require('../utils/phone');

const MONGO_URI = process.env.MONGODB_URI
  || process.env.MONGO_URI
  || process.env.MONGO_URL
  || process.env.DATABASE_URL;

const JOURNAL_DIR = path.join(__dirname, '..', '.migrations');

// ─── Arguments ───────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { limit: 40 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--merchant') out.merchant = next();
    else if (a === '--match') out.match = next();
    else if (a === '--from') out.from = next();
    else if (a === '--to') out.to = next();
    else if (a === '--undo') out.undo = next();
    else if (a === '--limit') out.limit = Number(next()) || 40;
    else if (a === '--apply') out.apply = true;
    else if (a === '--empty-notes') out.emptyNotes = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else {
      console.error(`✗ Unknown option: ${a}`);
      process.exit(1);
    }
  }
  return out;
}

const taka = (n) => `৳${Number(n || 0).toLocaleString('en-US')}`;

async function connect() {
  if (!MONGO_URI) {
    console.error('✗ No Mongo connection string. Set MONGODB_URI. Aborting.');
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI);
}

/**
 * Resolve `--merchant` as a phone number or an ObjectId.
 *
 * ─── EVERY SHAPE A BD NUMBER ARRIVES IN ──────────────────────────────────────
 * This began as a hand-rolled `value.replace(/^0/, '88')`, which is wrong for
 * the single most likely way anybody will type it. Swapping the leading 0 for
 * 88 gives `01711111111` → `881711111111`: twelve digits, the 0 eaten and only
 * two of the three country-code digits put back. It matched nothing, so the
 * script said "no merchant" for a number that was in the database all along.
 *
 * utils/phone.js already owns this question for the whole app — the last ten
 * digits are the subscriber, everything before them is formatting. Reusing it
 * covers all of these at once:
 *
 *   +8801711111111   8801711111111   01711111111
 *   1711111111       01711-111111    +88 01711 111111
 */
async function resolveMerchant(Merchant, value) {
  if (!value) return null;

  const byId = mongoose.isValidObjectId(value)
    ? await Merchant.findById(value).select('name phone').lean()
    : null;
  if (byId) return byId;

  const core = phoneCore(value);
  if (!core) {
    console.error(`✗ "${value}" is not a phone number or an id.`);
    process.exit(1);
  }

  // A suffix regex cannot use an index, which would matter in a request path
  // and does not here: one lookup, once, on a human's command.
  const matches = await Merchant.find({ phone: new RegExp(`${core}$`) })
    .select('name phone')
    .limit(2)
    .lean();

  if (!matches.length) {
    console.error(`✗ No merchant matches "${value}".`);
    process.exit(1);
  }
  // Refuse rather than pick. This value decides WHOSE ledger gets rewritten,
  // and quietly choosing the first of two is how the wrong shop's history
  // moves.
  if (matches.length > 1) {
    console.error(
      `✗ "${value}" matches more than one merchant. Pass the id instead:\n`
      + matches.map((m) => `    ${m._id}  ${m.name} (${m.phone})`).join('\n'),
    );
    process.exit(1);
  }
  return matches[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. REPORT — what is actually in his খরচ
// ─────────────────────────────────────────────────────────────────────────────
async function report(LedgerEntry, filter, limit) {
  const groups = await LedgerEntry.aggregate([
    { $match: filter },
    {
      $group: {
        _id: { $ifNull: ['$note', ''] },
        count: { $sum: 1 },
        total: { $sum: '$amount' },
      },
    },
    { $sort: { total: -1 } },
    { $limit: limit },
  ]);

  const all = await LedgerEntry.aggregate([
    { $match: filter },
    { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$amount' } } },
  ]);
  const totals = all[0] || { count: 0, total: 0 };

  console.log(`\n  ${totals.count} খরচ entries, ${taka(totals.total)} in total\n`);
  if (!groups.length) {
    console.log('  Nothing to look at.\n');
    return;
  }

  console.log('  what it says                                  count        total');
  console.log('  ' + '─'.repeat(68));
  groups.forEach((g) => {
    const label = (g._id || '(কোনো বিবরণ নেই)').slice(0, 40).padEnd(42);
    console.log(`  ${label}${String(g.count).padStart(5)}${taka(g.total).padStart(13)}`);
  });

  console.log(`
  Read that list, decide which of them were মাল তোলা, then re-run with a
  pattern. Nothing above has been changed.

    --match "মাল|চাল|ডাল|তেল|চিনি|আটা|পাইকার"

  That example is a STARTING POINT, not a recommendation — it is guessing at
  another shopkeeper's handwriting. Use the words that are actually in the
  list above.
`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. SELECT + 3. DRY RUN / APPLY
// ─────────────────────────────────────────────────────────────────────────────
async function reclassify(LedgerEntry, filter, opts) {
  const rx = new RegExp(opts.match, 'i');

  // `$or` rather than folding empty notes into the regex: an empty note matches
  // almost any loose pattern by accident, and an empty note is precisely the
  // case nobody can judge. It has to be asked for.
  const noteClause = opts.emptyNotes
    ? { $or: [{ note: rx }, { note: '' }, { note: null }] }
    : { note: rx };

  const selected = await LedgerEntry.find({ ...filter, ...noteClause })
    .sort({ at: 1 })
    .lean();

  if (!selected.length) {
    console.log('\n  Nothing matched that pattern. Nothing changed.\n');
    return;
  }

  const total = selected.reduce((s, e) => s + e.amount, 0);
  console.log(`\n  ${selected.length} entries match, ${taka(total)} in total:\n`);
  selected.slice(0, 60).forEach((e) => {
    console.log(`   ${e.dayKey}  ${taka(e.amount).padStart(12)}  ${e.note || '(কোনো বিবরণ নেই)'}`);
  });
  if (selected.length > 60) console.log(`   … and ${selected.length - 60} more`);

  if (!opts.apply) {
    console.log(`
  DRY RUN — nothing was written.

  Read the lines above. If every one of them is মাল তোলা, re-run with --apply.
  If even one is not, narrow the pattern first: a wrong line here moves real
  money out of খরচ and changes his লাভ.
`);
    return;
  }

  const ids = selected.map((e) => e._id);
  const res = await LedgerEntry.updateMany(
    { _id: { $in: ids }, kind: 'expense' },
    { $set: { kind: 'purchase' } },
  );

  // Journal AFTER the write, and only the ids the write actually claimed. A
  // journal listing rows that were never changed would put entries somebody
  // else's run had already moved back to খরচ on undo.
  fs.mkdirSync(JOURNAL_DIR, { recursive: true });
  const file = path.join(JOURNAL_DIR, `reclassify-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({
    at: new Date().toISOString(),
    merchant: opts.merchantLabel,
    match: opts.match,
    emptyNotes: Boolean(opts.emptyNotes),
    modified: res.modifiedCount,
    ids: ids.map(String),
  }, null, 2));

  console.log(`
  ✓ ${res.modifiedCount} entries moved খরচ → ক্রয়.

  Journal: ${file}
  Keep it. To put every one of them back:

    node scripts/reclassify-purchases.js --undo ${file}
`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. UNDO
// ─────────────────────────────────────────────────────────────────────────────
async function undo(LedgerEntry, file) {
  if (!fs.existsSync(file)) {
    console.error(`✗ No journal at ${file}`);
    process.exit(1);
  }
  const journal = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ids = (journal.ids || []).map((id) => new mongoose.Types.ObjectId(id));

  // Scoped to `kind: 'purchase'` so that an entry the shopkeeper has since
  // edited, or one he genuinely recorded as ক্রয় afterwards, is not dragged
  // back by an old journal.
  const res = await LedgerEntry.updateMany(
    { _id: { $in: ids }, kind: 'purchase' },
    { $set: { kind: 'expense' } },
  );

  console.log(`
  ✓ ${res.modifiedCount} of ${ids.length} entries moved back ক্রয় → খরচ.
  ${res.modifiedCount < ids.length
    ? `  (${ids.length - res.modifiedCount} were no longer ক্রয় and were left alone.)`
    : ''}
`);
}

// ─────────────────────────────────────────────────────────────────────────────
(async function main() {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
    process.exit(0);
  }

  // The one hard refusal. Reclassifying every shop in the database from one
  // pattern is not a migration, it is an accident with a wide blast radius —
  // and the person running it cannot have read forty shopkeepers' notes.
  if (opts.apply && !opts.merchant) {
    console.error('\n✗ --apply needs --merchant. One shop at a time.\n');
    process.exit(1);
  }
  if (opts.apply && !opts.match) {
    console.error('\n✗ --apply needs --match. This tool does not guess.\n');
    process.exit(1);
  }

  await connect();
  const LedgerEntry = require('../models/LedgerEntry');
  const Merchant = require('../models/Merchant');

  try {
    if (opts.undo) {
      await undo(LedgerEntry, opts.undo);
      return;
    }

    const merchant = await resolveMerchant(Merchant, opts.merchant);

    const filter = {
      kind: 'expense',
      // Voided lines contribute nothing to any total, so moving them is risk
      // with no upside.
      voidedAt: null,
    };
    if (merchant) filter.merchantId = merchant._id;
    if (opts.from) filter.dayKey = { ...(filter.dayKey || {}), $gte: opts.from };
    if (opts.to) filter.dayKey = { ...(filter.dayKey || {}), $lte: opts.to };

    const who = merchant ? `${merchant.name} (${merchant.phone})` : 'every shop';
    console.log(`\n  খরচ → ক্রয়  ·  ${who}${opts.from || opts.to ? `  ·  ${opts.from || '…'} → ${opts.to || '…'}` : ''}`);

    if (opts.match) await reclassify(LedgerEntry, filter, { ...opts, merchantLabel: who });
    else await report(LedgerEntry, filter, opts.limit);
  } finally {
    await mongoose.disconnect();
  }
}()).catch((err) => {
  console.error('✗ Failed:', err.message);
  process.exit(1);
});
