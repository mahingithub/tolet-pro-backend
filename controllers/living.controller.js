'use strict';

/**
 * living.controller — the connected "Roommate Wallet" (Household) API.
 * ──────────────────────────────────────────────────────────────────────────
 * Turns the Living tab into a real multi-user, multi-device shared wallet.
 * One Household document per group holds the members + config + the whole
 * ledger (expenses/bills/meals/groceries/settlements/activities).
 *
 * Every request is scoped to the household the caller is a MEMBER of — a user
 * can only ever read/mutate their own group. Each mutation returns the full
 * serialized household and pushes a `living:sync` socket event to every joined
 * member so all phones stay in sync live (with client polling as a backstop).
 *
 *   Household : GET/POST /household · POST /household/join · /leave
 *               /regenerate-code · PATCH /household · members add/remove
 *   Ledger    : expenses, bills, meals, groceries, settlements (CRUD)
 */

const crypto = require('crypto');
const Household = require('../models/Household');
const ApiError = require('../utils/ApiError');

const { SPLIT_TYPES, BILL_TYPES, METHODS } = Household;

const MEMBER_COLORS = ['#ba0036', '#1B8553', '#2563eb', '#D99B28', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

// ── helpers ──────────────────────────────────────────────────────────────────
const taka = (n) => `৳${Math.round(Number(n) || 0).toLocaleString('en-BD')}`;
const clampNum = (v, min = 0) => Math.max(min, Number(v) || 0);
const parseDate = (v) => {
  const d = v ? new Date(v) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
};

// Ambiguity-free code (no 0/O/1/I) so it's easy to read aloud / type.
function genCode(len = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

async function uniqueCode() {
  for (let i = 0; i < 8; i++) {
    const code = genCode();
    // eslint-disable-next-line no-await-in-loop
    const clash = await Household.exists({ inviteCode: code });
    if (!clash) return code;
  }
  return genCode(8); // extremely unlikely fallback
}

function pickColor(hh) {
  const used = new Set((hh.members || []).map((m) => m.color));
  return MEMBER_COLORS.find((c) => !used.has(c)) || MEMBER_COLORS[hh.members.length % MEMBER_COLORS.length];
}

// The household the caller belongs to (as a joined member). Null if none.
function findMine(userId) {
  return Household.findOne({ 'members.userId': userId });
}

async function loadMine(req) {
  const hh = await findMine(req.user._id);
  if (!hh) throw ApiError.notFound('আপনি কোনো হাউসহোল্ডে নেই।', { code: 'no_household' });
  return hh;
}

function myMemberId(hh, userId) {
  const m = hh.members.find((x) => x.userId && String(x.userId) === String(userId));
  return m ? String(m._id) : null;
}

function memberIdSet(hh) {
  return new Set(hh.members.map((m) => String(m._id)));
}

// Keep only real member ids; drop anything the client made up.
function cleanIds(ids, valid) {
  return (Array.isArray(ids) ? ids : []).map(String).filter((id) => valid.has(id));
}

// Receipts: only persist short URLs. Base64 data URLs are dropped (16MB cap).
function sanitizeReceipt(r) {
  if (typeof r === 'string' && /^https?:\/\//i.test(r) && r.length <= 512) return r;
  return null;
}

function pushActivity(hh, type, title, detail) {
  hh.activities.unshift({ type, title, detail, date: new Date() });
  if (hh.activities.length > 60) hh.activities = hh.activities.slice(0, 60);
}

// Ownership rule: whoever ADDED an item is the only one who may edit/delete it.
// (Legacy items with no `createdBy` stay editable by anyone so nothing locks up.)
function assertCanEdit(item, myId) {
  if (item.createdBy && String(item.createdBy) !== String(myId)) {
    throw ApiError.forbidden('শুধু যিনি যোগ করেছেন তিনিই এটি এডিট বা মুছতে পারবেন।', { code: 'not_creator' });
  }
}

// ── serialization ────────────────────────────────────────────────────────────
// Per-user view: `me` + each roommate's `isMe` depend on who's asking.
function serialize(hh, userId) {
  const uid = String(userId);
  const meMember = hh.members.find((m) => m.userId && String(m.userId) === uid);
  return {
    id: String(hh._id),
    name: hh.name,
    inviteCode: hh.inviteCode,
    ownerUserId: String(hh.ownerUserId),
    isOwner: String(hh.ownerUserId) === uid,
    me: meMember ? String(meMember._id) : null,
    rent: hh.rent,
    monthlyIncome: hh.monthlyIncome,
    budgets: { grocery: hh.budgets?.grocery || 0, meal: hh.budgets?.meal || 0 },
    roommates: hh.members.map((m) => ({
      id: String(m._id),
      name: m.name,
      color: m.color,
      userId: m.userId ? String(m.userId) : null,
      isMe: !!(m.userId && String(m.userId) === uid),
      joined: !!m.userId,
      role: m.role,
    })),
    expenses: hh.expenses.map((e) => ({
      id: String(e._id), category: e.category, amount: e.amount, paidBy: e.paidBy,
      splitWith: e.splitWith || [], splitType: e.splitType, shares: e.shares || {},
      note: e.note, receipt: e.receipt || null, createdBy: e.createdBy || null, date: e.date,
    })),
    bills: hh.bills.map((b) => ({
      id: String(b._id), type: b.type, amount: b.amount, dueDate: b.dueDate,
      status: b.status, paidDate: b.paidDate || null, reminder: b.reminder, createdBy: b.createdBy || null,
    })),
    meals: hh.meals.map((m) => ({
      id: String(m._id), date: m.date, roommateId: m.roommateId,
      breakfast: m.breakfast, lunch: m.lunch, dinner: m.dinner,
    })),
    groceries: hh.groceries.map((g) => ({
      id: String(g._id), amount: g.amount, paidBy: g.paidBy, note: g.note, createdBy: g.createdBy || null, date: g.date,
    })),
    settlements: hh.settlements.map((s) => ({
      id: String(s._id), from: s.from, to: s.to, amount: s.amount, method: s.method, note: s.note, createdBy: s.createdBy || null, date: s.date,
    })),
    activities: hh.activities.slice(0, 60).map((a) => ({
      id: String(a._id), type: a.type, title: a.title, detail: a.detail, date: a.date,
    })),
  };
}

// Live push to every joined member (each gets their own `me`-aware payload).
function emitSync(hh) {
  try {
    const { getIo, emitToUser } = require('../socket');
    const io = getIo();
    if (!io) return;
    hh.members.forEach((m) => {
      if (m.userId) emitToUser(io, String(m.userId), 'living:sync', serialize(hh, m.userId));
    });
  } catch (_e) {
    /* socket is best-effort; polling covers the gap */
  }
}

// Save + broadcast + respond in one go.
async function commit(hh, req, res, status = 200) {
  await hh.save();
  emitSync(hh);
  return res.status(status).json({ household: serialize(hh, req.user._id) });
}

// ═══════════════════════════════════ HOUSEHOLD ═══════════════════════════════
async function getHousehold(req, res, next) {
  try {
    const hh = await findMine(req.user._id);
    return res.json({ household: hh ? serialize(hh, req.user._id) : null });
  } catch (err) {
    return next(err);
  }
}

async function createHousehold(req, res, next) {
  try {
    const existing = await findMine(req.user._id);
    if (existing) throw ApiError.conflict('আপনি ইতিমধ্যে একটি হাউসহোল্ডে আছেন।', { code: 'already_member' });

    const name = String(req.body.name || '').trim().slice(0, 80) || 'Our Flat';
    const inviteCode = await uniqueCode();
    const hh = await Household.create({
      name,
      inviteCode,
      ownerUserId: req.user._id,
      members: [
        {
          userId: req.user._id,
          name: (req.user.name || 'You').slice(0, 60),
          color: MEMBER_COLORS[0],
          role: 'owner',
        },
      ],
      budgets: { grocery: 0, meal: 0 },
    });
    emitSync(hh);
    return res.status(201).json({ household: serialize(hh, req.user._id) });
  } catch (err) {
    return next(err);
  }
}

async function joinHousehold(req, res, next) {
  try {
    const code = String(req.body.code || '').trim().toUpperCase();
    if (!code) throw ApiError.badRequest('ইনভাইট কোড দিন।', { code: 'code_required' });

    const existing = await findMine(req.user._id);
    if (existing) {
      // Idempotent: if they're already in THIS household, just return it.
      if (existing.inviteCode === code) return res.json({ household: serialize(existing, req.user._id) });
      throw ApiError.conflict('আপনি ইতিমধ্যে একটি হাউসহোল্ডে আছেন। আগে সেটি ছাড়ুন।', { code: 'already_member' });
    }

    const hh = await Household.findOne({ inviteCode: code });
    if (!hh) throw ApiError.notFound('কোডটি সঠিক নয়।', { code: 'invalid_code' });

    hh.members.push({
      userId: req.user._id,
      name: (req.user.name || 'Member').slice(0, 60),
      color: pickColor(hh),
      role: 'member',
    });
    pushActivity(hh, 'settlement', 'Roommate joined', `${req.user.name || 'A roommate'} joined the wallet`);
    return commit(hh, req, res, 200);
  } catch (err) {
    return next(err);
  }
}

async function leaveHousehold(req, res, next) {
  try {
    const hh = await loadMine(req);
    const meId = myMemberId(hh, req.user._id);
    if (meId) hh.members.pull(meId);

    const joinedRemain = hh.members.filter((m) => m.userId);
    if (joinedRemain.length === 0) {
      // Last real member left → delete the whole household.
      await hh.deleteOne();
      return res.json({ household: null });
    }

    // If the owner left, hand ownership to the next joined member.
    if (String(hh.ownerUserId) === String(req.user._id)) {
      hh.ownerUserId = joinedRemain[0].userId;
      joinedRemain[0].role = 'owner';
    }
    await hh.save();
    emitSync(hh);
    return res.json({ household: null });
  } catch (err) {
    return next(err);
  }
}

async function regenerateCode(req, res, next) {
  try {
    const hh = await loadMine(req);
    if (String(hh.ownerUserId) !== String(req.user._id)) {
      throw ApiError.forbidden('শুধু ওনার কোড পরিবর্তন করতে পারে।', { code: 'not_owner' });
    }
    hh.inviteCode = await uniqueCode();
    return commit(hh, req, res);
  } catch (err) {
    return next(err);
  }
}

async function updateHousehold(req, res, next) {
  try {
    const hh = await loadMine(req);
    const b = req.body || {};
    if (b.name !== undefined) hh.name = String(b.name).trim().slice(0, 80) || hh.name;
    if (b.rent !== undefined) hh.rent = clampNum(b.rent);
    if (b.monthlyIncome !== undefined) hh.monthlyIncome = clampNum(b.monthlyIncome);
    if (b.budgets && typeof b.budgets === 'object') {
      if (b.budgets.grocery !== undefined) hh.budgets.grocery = clampNum(b.budgets.grocery);
      if (b.budgets.meal !== undefined) hh.budgets.meal = clampNum(b.budgets.meal);
    }
    return commit(hh, req, res);
  } catch (err) {
    return next(err);
  }
}

// ── members ──────────────────────────────────────────────────────────────────
async function addMember(req, res, next) {
  try {
    const hh = await loadMine(req);
    const name = String(req.body.name || '').trim().slice(0, 60);
    if (!name) throw ApiError.badRequest('নাম দিন।', { code: 'name_required' });
    if (hh.members.length >= 20) throw ApiError.badRequest('সর্বোচ্চ ২০ জন রুমমেট।', { code: 'member_limit' });
    hh.members.push({ userId: null, name, color: req.body.color || pickColor(hh), role: 'member' });
    return commit(hh, req, res, 201);
  } catch (err) {
    return next(err);
  }
}

async function removeMember(req, res, next) {
  try {
    const hh = await loadMine(req);
    const member = hh.members.id(req.params.id);
    if (!member) throw ApiError.notFound('রুমমেট পাওয়া যায়নি।');
    if (member.userId) throw ApiError.badRequest('জয়েন করা রুমমেট নিজে ছাড়তে পারবে।', { code: 'joined_member' });
    hh.members.pull(req.params.id);
    return commit(hh, req, res);
  } catch (err) {
    return next(err);
  }
}

// ═══════════════════════════════════ EXPENSES ════════════════════════════════
function buildExpense(hh, body, fallbackPaidBy) {
  const valid = memberIdSet(hh);
  const paidBy = valid.has(String(body.paidBy)) ? String(body.paidBy) : fallbackPaidBy;
  let splitWith = cleanIds(body.splitWith, valid);
  if (!splitWith.length) splitWith = [...valid];
  const splitType = SPLIT_TYPES.includes(body.splitType) ? body.splitType : 'equal';
  const shares = {};
  if (splitType !== 'equal' && body.shares && typeof body.shares === 'object') {
    splitWith.forEach((id) => { shares[id] = clampNum(body.shares[id]); });
  }
  return {
    category: String(body.category || 'other').slice(0, 30),
    amount: clampNum(body.amount),
    paidBy,
    splitWith,
    splitType,
    shares,
    note: String(body.note || '').slice(0, 300),
    receipt: sanitizeReceipt(body.receipt),
    date: parseDate(body.date),
  };
}

async function addExpense(req, res, next) {
  try {
    const hh = await loadMine(req);
    const mine = myMemberId(hh, req.user._id);
    const item = buildExpense(hh, req.body, mine);
    item.createdBy = mine;
    hh.expenses.unshift(item);
    pushActivity(hh, 'expense', 'Expense added', `${item.note || item.category} · ${taka(item.amount)}`);
    return commit(hh, req, res, 201);
  } catch (err) {
    return next(err);
  }
}

async function updateExpense(req, res, next) {
  try {
    const hh = await loadMine(req);
    const item = hh.expenses.id(req.params.id);
    if (!item) throw ApiError.notFound('খরচ পাওয়া যায়নি।');
    assertCanEdit(item, myMemberId(hh, req.user._id));
    const next2 = buildExpense(hh, { ...item.toObject(), ...req.body }, item.paidBy);
    item.set(next2);
    item.markModified('shares');
    return commit(hh, req, res);
  } catch (err) {
    return next(err);
  }
}

async function deleteExpense(req, res, next) {
  try {
    const hh = await loadMine(req);
    const item = hh.expenses.id(req.params.id);
    if (!item) throw ApiError.notFound('খরচ পাওয়া যায়নি।');
    assertCanEdit(item, myMemberId(hh, req.user._id));
    hh.expenses.pull(req.params.id);
    return commit(hh, req, res);
  } catch (err) {
    return next(err);
  }
}

// ═══════════════════════════════════ BILLS ═══════════════════════════════════
async function addBill(req, res, next) {
  try {
    const hh = await loadMine(req);
    const type = BILL_TYPES.includes(req.body.type) ? req.body.type : 'electricity';
    hh.bills.push({
      type,
      amount: clampNum(req.body.amount),
      dueDate: parseDate(req.body.dueDate),
      status: req.body.status === 'paid' ? 'paid' : 'unpaid',
      paidDate: req.body.status === 'paid' ? new Date() : null,
      reminder: req.body.reminder !== false,
      createdBy: myMemberId(hh, req.user._id),
    });
    pushActivity(hh, 'bill', 'Bill added', `${type} · ${taka(req.body.amount)}`);
    return commit(hh, req, res, 201);
  } catch (err) {
    return next(err);
  }
}

async function updateBill(req, res, next) {
  try {
    const hh = await loadMine(req);
    const bill = hh.bills.id(req.params.id);
    if (!bill) throw ApiError.notFound('বিল পাওয়া যায়নি।');
    assertCanEdit(bill, myMemberId(hh, req.user._id));
    const b = req.body || {};
    if (b.type !== undefined && BILL_TYPES.includes(b.type)) bill.type = b.type;
    if (b.amount !== undefined) bill.amount = clampNum(b.amount);
    if (b.dueDate !== undefined) bill.dueDate = parseDate(b.dueDate);
    if (b.reminder !== undefined) bill.reminder = !!b.reminder;
    if (b.status !== undefined) {
      if (b.status === 'paid' && bill.status !== 'paid') {
        bill.status = 'paid';
        bill.paidDate = new Date();
        pushActivity(hh, 'bill', 'Bill paid', `${bill.type} · ${taka(bill.amount)}`);
      } else if (b.status === 'unpaid') {
        bill.status = 'unpaid';
        bill.paidDate = null;
      }
    }
    return commit(hh, req, res);
  } catch (err) {
    return next(err);
  }
}

async function deleteBill(req, res, next) {
  try {
    const hh = await loadMine(req);
    const bill = hh.bills.id(req.params.id);
    if (!bill) throw ApiError.notFound('বিল পাওয়া যায়নি।');
    assertCanEdit(bill, myMemberId(hh, req.user._id));
    hh.bills.pull(req.params.id);
    return commit(hh, req, res);
  } catch (err) {
    return next(err);
  }
}

// ═══════════════════════════════════ MEALS ═══════════════════════════════════
async function setMeal(req, res, next) {
  try {
    const hh = await loadMine(req);
    const { roommateId, meal } = req.body;
    const valid = memberIdSet(hh);
    if (!valid.has(String(roommateId))) throw ApiError.badRequest('রুমমেট সঠিক নয়।');
    if (!['breakfast', 'lunch', 'dinner'].includes(meal)) throw ApiError.badRequest('মিল টাইপ সঠিক নয়।');

    const date = parseDate(req.body.date);
    const dayKey = date.toISOString().slice(0, 10);
    const value = clampNum(req.body.value);

    let entry = hh.meals.find(
      (m) => String(m.roommateId) === String(roommateId) && new Date(m.date).toISOString().slice(0, 10) === dayKey,
    );
    if (entry) {
      entry[meal] = value;
    } else {
      const created = { date, roommateId: String(roommateId), breakfast: 0, lunch: 0, dinner: 0 };
      created[meal] = value;
      hh.meals.push(created);
    }
    return commit(hh, req, res);
  } catch (err) {
    return next(err);
  }
}

// ═══════════════════════════════════ GROCERIES ═══════════════════════════════
async function addGrocery(req, res, next) {
  try {
    const hh = await loadMine(req);
    const valid = memberIdSet(hh);
    const paidBy = valid.has(String(req.body.paidBy)) ? String(req.body.paidBy) : myMemberId(hh, req.user._id);
    hh.groceries.unshift({
      amount: clampNum(req.body.amount),
      paidBy,
      note: String(req.body.note || '').slice(0, 200),
      createdBy: myMemberId(hh, req.user._id),
      date: parseDate(req.body.date),
    });
    pushActivity(hh, 'meal', 'Grocery added', `${req.body.note || 'Meal groceries'} · ${taka(req.body.amount)}`);
    return commit(hh, req, res, 201);
  } catch (err) {
    return next(err);
  }
}

async function deleteGrocery(req, res, next) {
  try {
    const hh = await loadMine(req);
    const item = hh.groceries.id(req.params.id);
    if (!item) throw ApiError.notFound('আইটেম পাওয়া যায়নি।');
    assertCanEdit(item, myMemberId(hh, req.user._id));
    hh.groceries.pull(req.params.id);
    return commit(hh, req, res);
  } catch (err) {
    return next(err);
  }
}

// ═══════════════════════════════════ SETTLEMENTS ═════════════════════════════
async function addSettlement(req, res, next) {
  try {
    const hh = await loadMine(req);
    const valid = memberIdSet(hh);
    const from = valid.has(String(req.body.from)) ? String(req.body.from) : null;
    const to = valid.has(String(req.body.to)) ? String(req.body.to) : null;
    if (!from || !to || from === to) throw ApiError.badRequest('সেটেলমেন্ট তথ্য সঠিক নয়।');
    const method = METHODS.includes(req.body.method) ? req.body.method : 'cash';
    hh.settlements.unshift({
      from, to, amount: clampNum(req.body.amount), method,
      note: String(req.body.note || '').slice(0, 200), createdBy: myMemberId(hh, req.user._id), date: new Date(),
    });
    const fromM = hh.members.id(from);
    const toM = hh.members.id(to);
    pushActivity(hh, 'settlement', 'Settlement completed',
      `${fromM?.name || 'Someone'} → ${toM?.name || 'someone'} · ${taka(req.body.amount)} (${method})`);
    return commit(hh, req, res, 201);
  } catch (err) {
    return next(err);
  }
}

async function deleteSettlement(req, res, next) {
  try {
    const hh = await loadMine(req);
    const item = hh.settlements.id(req.params.id);
    if (!item) throw ApiError.notFound('সেটেলমেন্ট পাওয়া যায়নি।');
    assertCanEdit(item, myMemberId(hh, req.user._id));
    hh.settlements.pull(req.params.id);
    return commit(hh, req, res);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getHousehold,
  createHousehold,
  joinHousehold,
  leaveHousehold,
  regenerateCode,
  updateHousehold,
  addMember,
  removeMember,
  addExpense,
  updateExpense,
  deleteExpense,
  addBill,
  updateBill,
  deleteBill,
  setMeal,
  addGrocery,
  deleteGrocery,
  addSettlement,
  deleteSettlement,
};
