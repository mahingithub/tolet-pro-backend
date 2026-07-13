'use strict';

/**
 * Household model — the shared "Roommate Wallet" group.
 * ──────────────────────────────────────────────────────────────────────────
 * A Household links several REAL users (each with their own login/device) into
 * ONE shared living-cost ledger. This is what turns the Living tab from a
 * single-device planner into a connected, multi-user wallet.
 *
 *   • members[]     — the roommates. A member with a `userId` is a real joined
 *                     user; a member with userId === null is a "placeholder"
 *                     (someone you split with who hasn't joined the app yet).
 *   • inviteCode    — short shareable code; others join with it.
 *   • config        — rent, monthlyIncome, budgets (shared across the group).
 *   • embedded data — expenses / bills / meals / groceries / settlements /
 *                     activities. Everything lives in one document so a single
 *                     read returns the whole wallet and a single save keeps it
 *                     consistent. All money math stays on the client
 *                     (livingUtils.js) — the server only stores + authorizes.
 *
 * Member ids (the subdocument _id) are the identity used by paidBy / splitWith
 * / from / to / roommateId across the embedded data, so the client's existing
 * id-based calculations work unchanged.
 */

const mongoose = require('mongoose');

const SPLIT_TYPES = ['equal', 'percentage', 'custom'];
const BILL_TYPES = ['electricity', 'gas', 'water', 'internet'];
const BILL_STATUS = ['paid', 'unpaid'];
const METHODS = ['cash', 'bkash', 'nagad', 'bank'];

const MemberSchema = new mongoose.Schema(
  {
    // null → placeholder roommate (not a real app user yet).
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    name: { type: String, trim: true, required: true, maxlength: 60 },
    color: { type: String, default: '#64748b', maxlength: 20 },
    role: { type: String, enum: ['owner', 'member'], default: 'member' },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const ExpenseSchema = new mongoose.Schema(
  {
    category: { type: String, default: 'other', maxlength: 30 },
    amount: { type: Number, default: 0, min: 0 },
    paidBy: { type: String, default: '' }, // member id
    splitWith: { type: [String], default: [] }, // member ids
    splitType: { type: String, enum: SPLIT_TYPES, default: 'equal' },
    shares: { type: mongoose.Schema.Types.Mixed, default: {} }, // { memberId: number }
    note: { type: String, default: '', maxlength: 300 },
    // Short receipt URL only. Base64 images are dropped server-side to protect
    // the 16MB document cap (shared receipt hosting = Cloudinary, future work).
    receipt: { type: String, default: null, maxlength: 512 },
    createdBy: { type: String, default: null }, // member id of whoever added it (edit/delete owner)
    date: { type: Date, default: Date.now },
  },
  { _id: true, minimize: false },
);

const BillSchema = new mongoose.Schema(
  {
    type: { type: String, enum: BILL_TYPES, default: 'electricity' },
    amount: { type: Number, default: 0, min: 0 },
    dueDate: { type: Date, default: Date.now },
    status: { type: String, enum: BILL_STATUS, default: 'unpaid' },
    paidDate: { type: Date, default: null },
    reminder: { type: Boolean, default: true },
    createdBy: { type: String, default: null }, // member id of whoever added it (edit/delete owner)
  },
  { _id: true },
);

const MealSchema = new mongoose.Schema(
  {
    date: { type: Date, default: Date.now },
    roommateId: { type: String, default: '' }, // member id
    breakfast: { type: Number, default: 0, min: 0 },
    lunch: { type: Number, default: 0, min: 0 },
    dinner: { type: Number, default: 0, min: 0 },
  },
  { _id: true },
);

const GrocerySchema = new mongoose.Schema(
  {
    amount: { type: Number, default: 0, min: 0 },
    paidBy: { type: String, default: '' }, // member id
    note: { type: String, default: '', maxlength: 200 },
    createdBy: { type: String, default: null }, // member id of whoever added it (edit/delete owner)
    date: { type: Date, default: Date.now },
  },
  { _id: true },
);

const SettlementSchema = new mongoose.Schema(
  {
    from: { type: String, default: '' }, // member id
    to: { type: String, default: '' }, // member id
    amount: { type: Number, default: 0, min: 0 },
    method: { type: String, enum: METHODS, default: 'cash' },
    note: { type: String, default: '', maxlength: 200 },
    date: { type: Date, default: Date.now },
  },
  { _id: true },
);

const ActivitySchema = new mongoose.Schema(
  {
    type: { type: String, default: 'expense', maxlength: 20 },
    title: { type: String, default: '', maxlength: 120 },
    detail: { type: String, default: '', maxlength: 200 },
    date: { type: Date, default: Date.now },
  },
  { _id: true },
);

const HouseholdSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: 'Our Flat', maxlength: 80 },
    inviteCode: { type: String, required: true, unique: true, index: true, uppercase: true },
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    members: { type: [MemberSchema], default: [] },

    // Shared config.
    rent: { type: Number, default: 0, min: 0 },
    monthlyIncome: { type: Number, default: 0, min: 0 },
    budgets: {
      grocery: { type: Number, default: 0, min: 0 },
      meal: { type: Number, default: 0, min: 0 },
    },

    // Shared ledger data.
    expenses: { type: [ExpenseSchema], default: [] },
    bills: { type: [BillSchema], default: [] },
    meals: { type: [MealSchema], default: [] },
    groceries: { type: [GrocerySchema], default: [] },
    settlements: { type: [SettlementSchema], default: [] },
    activities: { type: [ActivitySchema], default: [] },
  },
  { timestamps: true, minimize: false },
);

// Fast "which household am I in?" lookup (used on every request).
HouseholdSchema.index({ 'members.userId': 1 });

module.exports = mongoose.model('Household', HouseholdSchema);
module.exports.SPLIT_TYPES = SPLIT_TYPES;
module.exports.BILL_TYPES = BILL_TYPES;
module.exports.BILL_STATUS = BILL_STATUS;
module.exports.METHODS = METHODS;
