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
const bcrypt = require('bcryptjs');
const Household = require('../models/Household');
const User = require('../models/User');
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
// 'YYYY-MM' calendar-month key — used to dedupe recurring bill generation.
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const clampDueDay = (n, fallback = 1) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v >= 1 ? Math.min(28, v) : Math.min(28, fallback);
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

// The manager's member id — the household owner. They get full edit/delete
// rights over every entry (the "Meal Manager has full access" rule).
function ownerMemberId(hh) {
  const m =
    hh.members.find((x) => x.userId && String(x.userId) === String(hh.ownerUserId)) ||
    hh.members.find((x) => x.role === 'owner');
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

// Ownership rule: whoever ADDED an item may edit/delete it. The household
// MANAGER (owner) can edit/delete ANYTHING — full access. Legacy items with no
// `createdBy` stay editable by anyone so nothing locks up.
function assertCanEdit(item, myId, hh) {
  if (!item.createdBy) return;
  if (String(item.createdBy) === String(myId)) return;
  if (hh && ownerMemberId(hh) && String(ownerMemberId(hh)) === String(myId)) return; // manager override
  throw ApiError.forbidden('শুধু যিনি যোগ করেছেন বা ম্যানেজার এটি এডিট/মুছতে পারবেন।', { code: 'not_creator' });
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
    mealRate: hh.mealRate || 0,
    budgets: { grocery: hh.budgets?.grocery || 0, meal: hh.budgets?.meal || 0 },
    roommates: hh.members.map((m) => ({
      id: String(m._id),
      name: m.name,
      avatar: m.avatar || null,
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
      status: b.status, paidDate: b.paidDate || null, paidBy: b.paidBy || null,
      paidAmount: b.paidAmount || 0,
      reminder: b.reminder, recurring: !!b.recurring, dueDay: b.dueDay || null,
      period: b.period || null, recurringOf: b.recurringOf || null, createdBy: b.createdBy || null,
    })),
    meals: hh.meals.map((m) => ({
      id: String(m._id), date: m.date, roommateId: m.roommateId,
      breakfast: m.breakfast, lunch: m.lunch, dinner: m.dinner,
    })),
    groceries: hh.groceries.map((g) => ({
      id: String(g._id), amount: g.amount, paidBy: g.paidBy, note: g.note, createdBy: g.createdBy || null, date: g.date,
    })),
    deposits: (hh.deposits || []).map((d) => ({
      id: String(d._id), roommateId: d.roommateId, amount: d.amount, note: d.note, createdBy: d.createdBy || null, date: d.date,
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

// Lazily materialise recurring bills for the CURRENT month. Each bill flagged
// `recurring` is a template; if no instance of it exists for this calendar
// month yet, we spawn one unpaid bill (due on its dueDay). Runs on read
// (getHousehold) so there's no cron dependency. Returns true if it added any.
function generateRecurringBills(hh) {
  const now = new Date();
  const cur = monthKey(now);
  let changed = false;
  const templates = hh.bills.filter((b) => b.recurring);
  templates.forEach((t) => {
    const tid = String(t._id);
    const covered = hh.bills.some(
      (b) => b.period === cur && (String(b._id) === tid || String(b.recurringOf) === tid),
    );
    if (covered) return;
    const day = clampDueDay(t.dueDay || new Date(t.dueDate).getDate());
    const due = new Date(now.getFullYear(), now.getMonth(), day);
    hh.bills.push({
      type: t.type,
      amount: t.amount,
      dueDate: due,
      status: 'unpaid',
      paidDate: null,
      paidBy: '',
      reminder: t.reminder,
      recurring: false,
      dueDay: day,
      period: cur,
      recurringOf: tid,
      createdBy: t.createdBy,
    });
    changed = true;
    pushActivity(hh, 'bill', 'Recurring bill due', `${t.type} · ${taka(t.amount)} · ${cur}`);
  });
  return changed;
}

// ═══════════════════════════════════ HOUSEHOLD ═══════════════════════════════
async function getHousehold(req, res, next) {
  try {
    const hh = await findMine(req.user._id);
    if (!hh) return res.json({ household: null });
    // Materialise this month's recurring bills before serving the wallet.
    if (generateRecurringBills(hh)) {
      await hh.save();
      emitSync(hh);
    }
    return res.json({ household: serialize(hh, req.user._id) });
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
          avatar: req.user.avatar || null,
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
      avatar: req.user.avatar || null,
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

    // Dismissing the shared roommate wallet is destructive → require the caller
    // to re-enter their login password (loaded fresh; req.user omits it).
    const password = String(req.body.password || '');
    if (!password) throw ApiError.badRequest('পাসওয়ার্ড দিন।', { code: 'password_required' });
    const fresh = await User.findById(req.user._id).select('+password');
    const ok = fresh && fresh.password && (await bcrypt.compare(password, fresh.password));
    if (!ok) throw ApiError.unauthorized('পাসওয়ার্ড ভুল হয়েছে।', { code: 'invalid_password' });

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
    if (b.mealRate !== undefined) hh.mealRate = clampNum(b.mealRate);
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
    assertCanEdit(item, myMemberId(hh, req.user._id), hh);
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
    assertCanEdit(item, myMemberId(hh, req.user._id), hh);
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
    const valid = memberIdSet(hh);
    const mine = myMemberId(hh, req.user._id);
    const type = BILL_TYPES.includes(req.body.type) ? req.body.type : 'electricity';
    const dueDate = parseDate(req.body.dueDate);
    const status = req.body.status === 'paid' ? 'paid' : 'unpaid';
    // Who fronted the money — defaults to whoever is adding the bill.
    const paidBy = valid.has(String(req.body.paidBy)) ? String(req.body.paidBy) : mine;
    const recurring = req.body.recurring === true || req.body.recurring === 'true';
    hh.bills.push({
      type,
      amount: clampNum(req.body.amount),
      dueDate,
      status,
      paidDate: status === 'paid' ? new Date() : null,
      paidBy,
      paidAmount: status === 'paid' ? clampNum(req.body.amount) : 0,
      reminder: req.body.reminder !== false,
      recurring,
      dueDay: recurring ? clampDueDay(req.body.dueDay || dueDate.getDate()) : null,
      period: monthKey(dueDate),
      recurringOf: null,
      createdBy: mine,
    });
    pushActivity(hh, 'bill', recurring ? 'Recurring bill added' : 'Bill added', `${type} · ${taka(req.body.amount)}`);
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
    assertCanEdit(bill, myMemberId(hh, req.user._id), hh);
    const valid = memberIdSet(hh);
    const b = req.body || {};
    if (b.type !== undefined && BILL_TYPES.includes(b.type)) bill.type = b.type;
    if (b.amount !== undefined) bill.amount = clampNum(b.amount);
    if (b.dueDate !== undefined) { bill.dueDate = parseDate(b.dueDate); bill.period = monthKey(bill.dueDate); }
    if (b.reminder !== undefined) bill.reminder = !!b.reminder;
    if (b.paidBy !== undefined && valid.has(String(b.paidBy))) bill.paidBy = String(b.paidBy);
    if (b.recurring !== undefined) {
      bill.recurring = b.recurring === true || b.recurring === 'true';
      if (bill.recurring && !bill.dueDay) bill.dueDay = clampDueDay(new Date(bill.dueDate).getDate());
    }
    if (b.dueDay !== undefined) bill.dueDay = clampDueDay(b.dueDay);

    // Payment state — full / partial ("half") / unpaid. `paidAmount` is how much
    // has actually been paid toward the total; the ledger credits the payer for
    // exactly that amount, split equally across members.
    if (b.status !== undefined || b.paidAmount !== undefined) {
      const total = Number(bill.amount) || 0;
      const meId = myMemberId(hh, req.user._id);
      let amt;
      if (b.status === 'unpaid') amt = 0;
      else if (b.status === 'paid') amt = total;
      else if (b.paidAmount !== undefined) amt = Math.min(total, clampNum(b.paidAmount));
      else amt = Number(bill.paidAmount) || 0; // status 'partial' with no amount → keep

      if (amt <= 0) {
        bill.status = 'unpaid'; bill.paidAmount = 0; bill.paidDate = null;
      } else if (amt >= total) {
        const was = bill.status;
        bill.status = 'paid'; bill.paidAmount = total; bill.paidDate = new Date();
        if (!bill.paidBy) bill.paidBy = meId;
        if (was !== 'paid') pushActivity(hh, 'bill', 'Bill paid', `${bill.type} · ${taka(total)}`);
      } else {
        bill.status = 'partial'; bill.paidAmount = amt; bill.paidDate = new Date();
        if (!bill.paidBy) bill.paidBy = meId;
        pushActivity(hh, 'bill', 'Bill part-paid', `${bill.type} · ${taka(amt)} / ${taka(total)}`);
      }
    } else if (b.amount !== undefined) {
      // Amount edited without touching payment → keep paidAmount consistent.
      const total = Number(bill.amount) || 0;
      if (bill.status === 'paid') bill.paidAmount = total;
      else if (bill.status === 'partial') bill.paidAmount = Math.min(Number(bill.paidAmount) || 0, total);
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
    assertCanEdit(bill, myMemberId(hh, req.user._id), hh);
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
    assertCanEdit(item, myMemberId(hh, req.user._id), hh);
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
    assertCanEdit(item, myMemberId(hh, req.user._id), hh);
    hh.settlements.pull(req.params.id);
    return commit(hh, req, res);
  } catch (err) {
    return next(err);
  }
}

// ═══════════════════════════════════ DEPOSITS (মেস জমা) ══════════════════════
async function addDeposit(req, res, next) {
  try {
    const hh = await loadMine(req);
    const valid = memberIdSet(hh);
    const roommateId = valid.has(String(req.body.roommateId)) ? String(req.body.roommateId) : myMemberId(hh, req.user._id);
    hh.deposits.unshift({
      roommateId,
      amount: clampNum(req.body.amount),
      note: String(req.body.note || '').slice(0, 200),
      createdBy: myMemberId(hh, req.user._id),
      date: parseDate(req.body.date),
    });
    const m = hh.members.id(roommateId);
    pushActivity(hh, 'meal', 'Deposit added', `${m?.name || 'Someone'} deposited ${taka(req.body.amount)}`);
    return commit(hh, req, res, 201);
  } catch (err) {
    return next(err);
  }
}

async function deleteDeposit(req, res, next) {
  try {
    const hh = await loadMine(req);
    const item = hh.deposits.id(req.params.id);
    if (!item) throw ApiError.notFound('জমা পাওয়া যায়নি।');
    assertCanEdit(item, myMemberId(hh, req.user._id), hh);
    hh.deposits.pull(req.params.id);
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
  addDeposit,
  deleteDeposit,
};
