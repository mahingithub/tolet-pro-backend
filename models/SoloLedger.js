'use strict';

/**
 * SoloLedger — one person's private খাতা, backed up so it survives the phone.
 * ──────────────────────────────────────────────────────────────────────────
 * The solo wallet was built device-local: `persist` → localStorage was the
 * whole storage layer. That kept it working with no internet, but it also meant
 * uninstalling the app — or signing in on a second phone — lost the ledger.
 * This collection is the backup half of that promise. The phone still writes
 * first and still works offline; the server is where the writing survives.
 *
 * ── Why the ids are the CLIENT's ──────────────────────────────────────────
 * Unlike Household, every row here keeps the id the phone minted (`id`, a plain
 * string — NOT the subdocument `_id`). A solo ledger has exactly one writer, so
 * there is no id to coordinate, and client-owned ids buy two things the joint
 * wallet cannot have:
 *
 *   • no tmp_ → real id swap, so an offline row never changes identity;
 *   • merging two devices is a union by id (see mergeLedger in the
 *     controller) — which is the only way a user who already had a খাতা on
 *     this phone can start syncing without losing it.
 *
 * ── Why deletes are tombstones ────────────────────────────────────────────
 * `deletedAt` instead of pulling the row. When two devices each hold a copy of
 * the ledger, a hard delete on one is invisible to the other, so the next merge
 * from the second device would resurrect the row. In a money app a deleted
 * entry coming back is the kind of bug that ends trust in the number, so the
 * row stays and is filtered out on read.
 */

const mongoose = require('mongoose');

// Mirrors ENTRY_TYPES in the frontend's components/living/soloConfig.jsx. A
// lend / borrow / repayment moves cash and a person's balance but is NEVER
// spending — that distinction lives in soloUtils.js on the client, which is
// also where every total is computed. The server only stores and authorizes.
const ENTRY_TYPES = ['expense', 'income', 'lend', 'borrow', 'repay-in', 'repay-out'];
const METHODS = ['cash', 'bkash', 'nagad', 'bank'];

const PersonSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, maxlength: 40 },
    name: { type: String, trim: true, default: 'Friend', maxlength: 60 },
    color: { type: String, default: '#64748b', maxlength: 20 },
    phone: { type: String, default: '', maxlength: 24 },
    note: { type: String, default: '', maxlength: 300 },
    createdAt: { type: Date, default: Date.now },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  // `id: false` matters as much as `_id: false` here: `id` is a real path on
  // this schema (the client's own id), and Mongoose would otherwise also hang
  // its default `id` virtual — an alias of `_id` — off the same name.
  { _id: false, id: false },
);

const EntrySchema = new mongoose.Schema(
  {
    id: { type: String, required: true, maxlength: 40 },
    type: { type: String, enum: ENTRY_TYPES, default: 'expense' },
    amount: { type: Number, default: 0, min: 0 },
    // Free-form on purpose: the spend/income category lists in soloConfig.jsx
    // grow without a migration, and an unknown key already falls back to
    // "other" on the client (getSpendCategory / getIncomeCategory).
    category: { type: String, default: 'other', maxlength: 30 },
    // The friend this ধার / পাওনা points at. Null for a plain খরচ or আয়.
    personId: { type: String, default: null, maxlength: 40 },
    note: { type: String, default: '', maxlength: 300 },
    method: { type: String, enum: METHODS, default: 'cash' },
    date: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { _id: false, id: false },
);

const SoloLedgerSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },

    // Cash already in hand before the খাতা started, so "হাতে আছে" is real.
    opening: { type: Number, default: 0 },
    // Monthly spending cap (0 = off) → drives the budget meter.
    budget: { type: Number, default: 0, min: 0 },

    people: { type: [PersonSchema], default: [] },
    entries: { type: [EntrySchema], default: [] },

    // ── offline write dedupe ────────────────────────────────────────────────
    // Same contract as Household.appliedOps: the phone stamps every mutation
    // with an `opId`, and a replayed queue (or a request whose response was
    // lost) must not write the same ৳500 twice. Capped + time-pruned in the
    // controller's rememberOp().
    appliedOps: {
      type: [
        {
          _id: false,
          opId: { type: String, required: true },
          at: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  { timestamps: true, minimize: false },
);

module.exports = mongoose.model('SoloLedger', SoloLedgerSchema);
module.exports.ENTRY_TYPES = ENTRY_TYPES;
module.exports.METHODS = METHODS;
