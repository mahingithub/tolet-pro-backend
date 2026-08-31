'use strict';

/**
 * livingSolo.controller — the private solo খাতা API.
 * ──────────────────────────────────────────────────────────────────────────
 * One SoloLedger document per user. Every route is scoped to `req.user._id`;
 * there is no sharing, no membership and no invite code — that is the whole
 * difference from living.controller (the shared household wallet).
 *
 * The phone remains the primary writer. It applies each change locally first
 * and queues the operation; this API is what the queue drains into, so the
 * ledger survives a reinstall and follows the account to another device.
 *
 * Rows carry the id the CLIENT minted (see models/SoloLedger.js) and deletes
 * are tombstones, which together make `mergeLedger` below a plain union — the
 * one-time path that uploads a খাতা written before syncing existed without
 * losing a single row.
 *
 *   GET    /solo              → the ledger (null if the server has none yet)
 *   POST   /solo/merge        → one-time union of this phone's local খাতা
 *   PATCH  /solo              → opening / budget
 *   POST   /solo/people       · PATCH /solo/people/:id  · DELETE /solo/people/:id
 *   POST   /solo/entries      · PATCH /solo/entries/:id · DELETE /solo/entries/:id
 *   DELETE /solo              → reset (tombstone everything)
 */

const SoloLedger = require('../models/SoloLedger');
const ApiError = require('../utils/ApiError');

const { ENTRY_TYPES, METHODS } = SoloLedger;

// ── helpers ──────────────────────────────────────────────────────────────────
const clampNum = (v, min = 0) => Math.max(min, Number(v) || 0);
const str = (v, max) => String(v == null ? '' : v).slice(0, max);
const parseDate = (v) => {
  const d = v ? new Date(v) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
};
// An id the phone minted. Rejected if absent — without it a replayed queue
// would insert the same row twice under two different ids.
const clientId = (v) => {
  const id = str(v, 40).trim();
  if (!id) throw ApiError.badRequest('id নেই।', { code: 'missing_id' });
  return id;
};

const alive = (row) => !row.deletedAt;

function findMine(userId) {
  return SoloLedger.findOne({ userId });
}

// The caller's ledger, created on demand. Every mutation needs one to exist;
// only GET is allowed to answer "there isn't one yet".
async function loadMine(req) {
  if (req._solo) return req._solo;
  let doc = await findMine(req.user._id);
  if (!doc) doc = new SoloLedger({ userId: req.user._id });
  req._solo = doc;
  return doc;
}

// ── validation ───────────────────────────────────────────────────────────────
function buildPerson(body = {}, existing = null) {
  const base = existing || {};
  return {
    id: existing ? existing.id : clientId(body.id),
    name: str(body.name ?? base.name ?? 'Friend', 60).trim() || 'Friend',
    color: str(body.color ?? base.color ?? '#64748b', 20),
    phone: str(body.phone ?? base.phone ?? '', 24),
    note: str(body.note ?? base.note ?? '', 300),
    createdAt: base.createdAt || parseDate(body.createdAt),
    editedAt: existing ? new Date() : null,
    deletedAt: base.deletedAt || null,
  };
}

function buildEntry(body = {}, existing = null) {
  const base = existing || {};
  const type = ENTRY_TYPES.includes(body.type) ? body.type : base.type || 'expense';
  const method = METHODS.includes(body.method) ? body.method : base.method || 'cash';
  // A plain খরচ / আয় has no friend attached; only the ধার-family types do.
  const personId = body.personId === undefined ? base.personId ?? null : str(body.personId, 40) || null;
  return {
    id: existing ? existing.id : clientId(body.id),
    type,
    amount: clampNum(body.amount ?? base.amount),
    category: str(body.category ?? base.category ?? 'other', 30) || 'other',
    personId,
    note: str(body.note ?? base.note ?? '', 300),
    method,
    date: body.date === undefined && base.date ? base.date : parseDate(body.date),
    createdAt: base.createdAt || parseDate(body.createdAt),
    editedAt: existing ? new Date() : null,
    deletedAt: base.deletedAt || null,
  };
}

// ── serialization ────────────────────────────────────────────────────────────
// Tombstones never leave the server: the client's soloUtils.js sums whatever it
// is handed, so a deleted row reaching it would land straight back in a total.
function serialize(doc) {
  return {
    // Whose খাতা this is. The client keeps it so that signing in as somebody
    // else on a shared phone downloads THEIR ledger instead of merging the
    // previous account's rows into it.
    userId: String(doc.userId),
    opening: doc.opening || 0,
    budget: doc.budget || 0,
    people: (doc.people || []).filter(alive).map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      phone: p.phone || '',
      note: p.note || '',
      createdAt: p.createdAt,
    })),
    entries: (doc.entries || []).filter(alive).map((e) => ({
      id: e.id,
      type: e.type,
      amount: e.amount,
      category: e.category,
      personId: e.personId || null,
      note: e.note || '',
      method: e.method,
      date: e.date,
      createdAt: e.createdAt,
      editedAt: e.editedAt || null,
    })),
    syncedAt: new Date(),
  };
}

// ── offline write dedupe ─────────────────────────────────────────────────────
// Identical contract to living.controller's: the phone stamps every mutation
// with an `opId` and we apply each exactly once. Kept local to this file
// because the lookup it needs is the SoloLedger, not the Household.
const OP_MEMORY = 400;
const OP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const readOpId = (req) => {
  const fromHeader = typeof req.get === 'function' ? req.get('X-Op-Id') : null;
  return String(req.body?.opId || fromHeader || '').slice(0, 40);
};

const alreadyApplied = (doc, opId) => !!opId && (doc.appliedOps || []).some((o) => o.opId === opId);

function rememberOp(doc, req) {
  const opId = req._opId;
  if (!opId || alreadyApplied(doc, opId)) return;
  const cutoff = Date.now() - OP_TTL_MS;
  doc.appliedOps = [...(doc.appliedOps || []), { opId, at: new Date() }]
    .filter((o) => new Date(o.at).getTime() >= cutoff)
    .slice(-OP_MEMORY);
}

/**
 * Answers a replayed opId with the ledger as it stands, without applying
 * anything. The document it loads is memoised onto the request, so the guard
 * costs no extra query.
 */
function idempotent(handler) {
  return async function guarded(req, res, next) {
    try {
      const opId = readOpId(req);
      if (opId) {
        req._opId = opId;
        const doc = await findMine(req.user._id);
        if (doc) {
          req._solo = doc;
          if (alreadyApplied(doc, opId)) {
            return res.json({ ledger: serialize(doc), replayed: true });
          }
        }
      }
      return await handler(req, res, next);
    } catch (err) {
      return next(err);
    }
  };
}

async function commit(doc, req, res, status = 200) {
  rememberOp(doc, req);
  await doc.save();
  return res.status(status).json({ ledger: serialize(doc) });
}

// ═══════════════════════════════════ READ ════════════════════════════════════
async function getSolo(req, res, next) {
  try {
    const doc = await findMine(req.user._id);
    // `null` is meaningful: it tells the phone the server has never seen this
    // খাতা, which is what triggers the one-time merge upload below.
    return res.json({ ledger: doc ? serialize(doc) : null });
  } catch (err) {
    return next(err);
  }
}

// ═══════════════════════════════════ MERGE ═══════════════════════════════════
/**
 * The one-time upload of a খাতা that was written before this phone ever
 * synced — and the reconciliation when a SECOND device shows up carrying its
 * own local rows.
 *
 * Union by id, never replace: whatever the server already holds stays, and
 * anything the phone has that the server doesn't is added. A row present on
 * both sides is resolved by "last edit wins", which is only ever reached when
 * the same id exists twice — i.e. the same row, edited in two places.
 *
 * `opening` and `budget` are single values, not rows, so they cannot be
 * unioned: the server's own setting wins unless it is still at its default,
 * which is the only case where the phone's answer is more informed.
 */
async function mergeSolo(req, res, next) {
  try {
    const doc = await loadMine(req);
    const body = req.body || {};

    if (!doc.opening && body.opening !== undefined) doc.opening = Number(body.opening) || 0;
    if (!doc.budget && body.budget !== undefined) doc.budget = clampNum(body.budget);

    // Plain objects throughout: the result is assigned straight back onto the
    // document array, and mixing live subdocuments into that assignment is how
    // you get Mongoose casting surprises.
    const mergeRows = (current, incoming, build) => {
      const rows = typeof current?.toObject === 'function' ? current.toObject() : current || [];
      const byId = new Map(rows.map((row) => [row.id, row]));
      (Array.isArray(incoming) ? incoming : []).forEach((raw) => {
        let id;
        try {
          id = clientId(raw && raw.id);
        } catch {
          return; // a row with no id is unmergeable — skip rather than reject the batch
        }
        const mine = byId.get(id);
        if (!mine) {
          byId.set(id, build(raw));
          return;
        }
        const theirs = { ...build(raw), id };

        // A delete is FINAL for a given row id. Ids are minted fresh and never
        // reused, so an incoming copy that still looks alive is always the
        // older truth — a device that was offline when the row was deleted. It
        // also cannot be timestamped out of the way: a phone that predates
        // these fields sends no createdAt at all, which would otherwise be read
        // as "written just now" and resurrect the row. Deleting a খরচ and
        // watching it come back is the one bug that ends trust in the number.
        if (mine.deletedAt) return;
        if (theirs.deletedAt) {
          byId.set(id, theirs);
          return;
        }

        // Both sides still hold the row: the later edit is the truth.
        const stamp = (r) => new Date(r.editedAt || r.createdAt || 0).getTime();
        if (stamp(theirs) > stamp(mine)) byId.set(id, theirs);
      });
      return [...byId.values()];
    };

    doc.people = mergeRows(doc.people, body.people, (raw) => ({
      ...buildPerson(raw),
      editedAt: raw.editedAt ? parseDate(raw.editedAt) : null,
      deletedAt: raw.deletedAt ? parseDate(raw.deletedAt) : null,
    }));
    doc.entries = mergeRows(doc.entries, body.entries, (raw) => ({
      ...buildEntry(raw),
      editedAt: raw.editedAt ? parseDate(raw.editedAt) : null,
      deletedAt: raw.deletedAt ? parseDate(raw.deletedAt) : null,
    }));

    return commit(doc, req, res);
  } catch (err) {
    return next(err);
  }
}

// ═══════════════════════════════════ CONFIG ══════════════════════════════════
async function updateSolo(req, res, next) {
  try {
    const doc = await loadMine(req);
    if (req.body.opening !== undefined) doc.opening = Number(req.body.opening) || 0;
    if (req.body.budget !== undefined) doc.budget = clampNum(req.body.budget);
    return commit(doc, req, res);
  } catch (err) {
    return next(err);
  }
}

// Reset the খাতা. Tombstoned rather than emptied so a second device that still
// holds the old rows cannot merge them back in afterwards.
async function resetSolo(req, res, next) {
  try {
    const doc = await loadMine(req);
    const now = new Date();
    doc.opening = 0;
    doc.budget = 0;
    (doc.people || []).forEach((p) => { p.deletedAt = p.deletedAt || now; });
    (doc.entries || []).forEach((e) => { e.deletedAt = e.deletedAt || now; });
    return commit(doc, req, res);
  } catch (err) {
    return next(err);
  }
}

// ═══════════════════════════════════ PEOPLE ══════════════════════════════════
async function addPerson(req, res, next) {
  try {
    const doc = await loadMine(req);
    const person = buildPerson(req.body);
    const existing = (doc.people || []).find((p) => p.id === person.id);
    // The queue can only deliver the same create twice if its opId changed too
    // (a re-typed row reusing an id). Treat it as an edit rather than a
    // duplicate so the ledger can never hold one id twice.
    if (existing) existing.set(buildPerson(req.body, existing));
    else doc.people.push(person);
    return commit(doc, req, res, existing ? 200 : 201);
  } catch (err) {
    return next(err);
  }
}

async function updatePerson(req, res, next) {
  try {
    const doc = await loadMine(req);
    const person = (doc.people || []).find((p) => p.id === req.params.id && alive(p));
    if (!person) throw ApiError.notFound('মানুষটি পাওয়া যায়নি।', { code: 'person_not_found' });
    person.set(buildPerson(req.body, person));
    return commit(doc, req, res);
  } catch (err) {
    return next(err);
  }
}

// Removes the person AND every entry tied to them — a ধার row is meaningless
// without the person it points at. Mirrors removePerson() in useLivingStore.
async function deletePerson(req, res, next) {
  try {
    const doc = await loadMine(req);
    const person = (doc.people || []).find((p) => p.id === req.params.id);
    if (!person) throw ApiError.notFound('মানুষটি পাওয়া যায়নি।', { code: 'person_not_found' });
    const now = new Date();
    person.deletedAt = person.deletedAt || now;
    (doc.entries || []).forEach((e) => {
      if (e.personId === person.id && !e.deletedAt) e.deletedAt = now;
    });
    return commit(doc, req, res);
  } catch (err) {
    return next(err);
  }
}

// ═══════════════════════════════════ ENTRIES ═════════════════════════════════
async function addEntry(req, res, next) {
  try {
    const doc = await loadMine(req);
    const entry = buildEntry(req.body);
    const existing = (doc.entries || []).find((e) => e.id === entry.id);
    if (existing) existing.set(buildEntry(req.body, existing));
    else doc.entries.push(entry);
    return commit(doc, req, res, existing ? 200 : 201);
  } catch (err) {
    return next(err);
  }
}

async function updateEntry(req, res, next) {
  try {
    const doc = await loadMine(req);
    const entry = (doc.entries || []).find((e) => e.id === req.params.id && alive(e));
    if (!entry) throw ApiError.notFound('এন্ট্রি পাওয়া যায়নি।', { code: 'entry_not_found' });
    entry.set(buildEntry(req.body, entry));
    return commit(doc, req, res);
  } catch (err) {
    return next(err);
  }
}

async function deleteEntry(req, res, next) {
  try {
    const doc = await loadMine(req);
    const entry = (doc.entries || []).find((e) => e.id === req.params.id);
    if (!entry) throw ApiError.notFound('এন্ট্রি পাওয়া যায়নি।', { code: 'entry_not_found' });
    entry.deletedAt = entry.deletedAt || new Date();
    return commit(doc, req, res);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getSolo,
  mergeSolo: idempotent(mergeSolo),
  updateSolo: idempotent(updateSolo),
  resetSolo: idempotent(resetSolo),
  addPerson: idempotent(addPerson),
  updatePerson: idempotent(updatePerson),
  deletePerson: idempotent(deletePerson),
  addEntry: idempotent(addEntry),
  updateEntry: idempotent(updateEntry),
  deleteEntry: idempotent(deleteEntry),
};
