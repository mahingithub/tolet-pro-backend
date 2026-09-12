'use strict';

/**
 * livingLedger — who owes whom in a shared household, computed server-side.
 * ──────────────────────────────────────────────────────────────────────────
 * A FAITHFUL PORT of the client's src/components/living/livingUtils.js
 * (expenseShares → billPaid → mealCountByRoommate → computeLedger →
 * simplifyDebts → paymentBreakdown). Same inputs, same numbers.
 *
 * ── Why this exists, given "all money math stays on the client" ───────────
 * That rule (see the Household model docblock) holds for everything drawn on
 * screen: the phone owns the ledger, works offline, and the server only stores
 * and authorizes. It stops being the right rule the moment a number LEAVES the
 * app — a settle-up reminder puts "you owe Mahin ৳500" into someone else's
 * WhatsApp, signed TO-LET PRO. A figure like that cannot be whatever the
 * sender's phone claimed it was; it has to be the server's own answer,
 * recomputed from the stored ledger.
 *
 * So this module is used for exactly one thing: the amount and the breakdown
 * inside a reminder. Nothing renders from it. The client keeps computing what
 * it shows, unchanged.
 *
 * Kept honest by tests/livingLedgerParity.test.js, which runs this and the real
 * client module over the same randomized households and asserts they agree —
 * a port that silently drifts is worse than no port, because the message would
 * still look authoritative.
 */

const num = (v) => Number(v) || 0;

/** Month bucket key, matching the client's `monthKey` (year + zero-based month). */
const monthKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${x.getMonth()}`;
};

/**
 * How much each participant owes for a single expense → { memberId: amount }.
 * Supports equal / percentage / custom splits.
 */
function expenseShares(expense, roommates) {
  const parts = expense.splitWith && expense.splitWith.length
    ? expense.splitWith
    : roommates.map((r) => r.id);
  const amount = num(expense.amount);
  const out = {};
  if (!parts.length) return out;

  if (expense.splitType === 'percentage') {
    const shares = expense.shares || {};
    const totalPct = parts.reduce((s, id) => s + num(shares[id]), 0) || 100;
    parts.forEach((id) => { out[id] = (amount * num(shares[id])) / totalPct; });
  } else if (expense.splitType === 'custom') {
    const shares = expense.shares || {};
    parts.forEach((id) => { out[id] = num(shares[id]); });
  } else {
    const each = amount / parts.length;
    parts.forEach((id) => { out[id] = each; });
  }
  return out;
}

/**
 * What was actually paid toward a bill. Rows that predate `paidAmount` fall
 * back to their full amount when marked paid.
 */
function billPaid(bill) {
  const total = num(bill && bill.amount);
  if (bill && bill.paidAmount != null && bill.paidAmount !== '') {
    return Math.max(0, Math.min(total, num(bill.paidAmount)));
  }
  return bill && bill.status === 'paid' ? total : 0;
}

/** Total meals (breakfast + lunch + dinner) per member, optionally one month. */
function mealCountByRoommate(meals, roommates, monthRef = null) {
  const counts = {};
  roommates.forEach((r) => { counts[r.id] = 0; });
  meals.forEach((m) => {
    if (monthRef && monthKey(m.date) !== monthKey(monthRef)) return;
    if (!(m.roommateId in counts)) counts[m.roommateId] = 0;
    counts[m.roommateId] += num(m.breakfast) + num(m.lunch) + num(m.dinner);
  });
  return counts;
}

/**
 * Net position per member. Positive = the group owes them; negative = they owe.
 * Grocery is distributed by each member's share of meals in that grocery's own
 * month (equal split when no meals are logged).
 */
function computeLedger({ expenses = [], groceries = [], meals = [], bills = [], settlements = [], roommates = [] }) {
  const net = {};
  roommates.forEach((r) => { net[r.id] = 0; });
  const ensure = (id) => { if (!(id in net)) net[id] = 0; };

  expenses.forEach((e) => {
    const amount = num(e.amount);
    ensure(e.paidBy);
    net[e.paidBy] += amount;
    const shares = expenseShares(e, roommates);
    Object.entries(shares).forEach(([id, amt]) => {
      ensure(id);
      net[id] -= amt;
    });
  });

  // A paid bill behaves like an equal-split expense: the payer is credited what
  // they actually paid, every member is debited an equal share of the full
  // bill. A partial payment leaves the shortfall owed to the utility, not to a
  // roommate — so no phantom debt appears.
  bills.forEach((b) => {
    const paid = billPaid(b);
    if (paid <= 0) return;
    const payer = b.paidBy || b.createdBy;
    if (!payer) return;
    ensure(payer);
    net[payer] += paid;
    const each = num(b.amount) / (roommates.length || 1);
    roommates.forEach((r) => { net[r.id] -= each; });
  });

  groceries.forEach((g) => {
    const amount = num(g.amount);
    ensure(g.paidBy);
    net[g.paidBy] += amount;
    const counts = mealCountByRoommate(meals, roommates, new Date(g.date));
    const total = Object.values(counts).reduce((s, v) => s + v, 0);
    if (total > 0) {
      roommates.forEach((r) => { net[r.id] -= amount * ((counts[r.id] || 0) / total); });
    } else {
      const each = amount / (roommates.length || 1);
      roommates.forEach((r) => { net[r.id] -= each; });
    }
  });

  settlements.forEach((st) => {
    ensure(st.from);
    ensure(st.to);
    net[st.from] += num(st.amount);
    net[st.to] -= num(st.amount);
  });

  return net;
}

/** Greedy minimal-transaction simplification → [{ from, to, amount }]. */
function simplifyDebts(net, roommates) {
  const creditors = [];
  const debtors = [];
  roommates.forEach((r) => {
    const v = net[r.id] || 0;
    if (v > 0.5) creditors.push({ id: r.id, amt: v });
    else if (v < -0.5) debtors.push({ id: r.id, amt: -v });
  });
  creditors.sort((a, b) => b.amt - a.amt);
  debtors.sort((a, b) => b.amt - a.amt);

  const out = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amt, creditors[j].amt);
    if (pay > 0.5) out.push({ from: debtors[i].id, to: creditors[j].id, amount: Math.round(pay) });
    debtors[i].amt -= pay;
    creditors[j].amt -= pay;
    if (debtors[i].amt <= 0.5) i += 1;
    if (creditors[j].amt <= 0.5) j += 1;
  }
  return out;
}

/**
 * What each member personally paid out, per category. This is the "why" behind
 * a balance, and it is what turns a reminder from a demand into a receipt:
 * "Mahin paid the ৳2,000 electricity bill and ৳500 bazar".
 */
function paymentBreakdown({ expenses = [], groceries = [], bills = [], roommates = [] }) {
  const byMember = {};
  const bump = (memberId, categoryKey, amount) => {
    if (!memberId || !(amount > 0)) return;
    if (!byMember[memberId]) byMember[memberId] = { total: 0, cats: {} };
    byMember[memberId].total += amount;
    byMember[memberId].cats[categoryKey] = (byMember[memberId].cats[categoryKey] || 0) + amount;
  };

  expenses.forEach((e) => bump(e.paidBy, e.category || 'other', num(e.amount)));
  groceries.forEach((g) => bump(g.paidBy, 'groceries', num(g.amount)));
  bills.forEach((b) => {
    const paid = billPaid(b);
    if (paid <= 0) return;
    bump(b.paidBy || b.createdBy, b.type || 'other', paid);
  });

  const grandTotal = Object.values(byMember).reduce((s, m) => s + m.total, 0);
  const rows = roommates
    .map((r) => {
      const m = byMember[r.id] || { total: 0, cats: {} };
      const cats = Object.entries(m.cats)
        .map(([key, amount]) => ({ key, amount }))
        .sort((a, b) => b.amount - a.amount);
      return { id: r.id, name: r.name, total: m.total, cats };
    })
    .sort((a, b) => b.total - a.total);

  return { rows, grandTotal };
}

module.exports = {
  expenseShares, billPaid, mealCountByRoommate,
  computeLedger, simplifyDebts, paymentBreakdown,
};
