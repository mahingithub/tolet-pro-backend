'use strict';

/**
 * idempotency — apply an offline-queued write exactly once.
 * ──────────────────────────────────────────────────────────────────────────
 * Wrap a mutation handler with `idempotent()` and a repeated `X-Op-Id` is
 * answered with the current state instead of being applied a second time.
 *
 * The claim is an insert against SyncOp's unique index, taken BEFORE the
 * handler runs and released if the handler fails — so a write that errored is
 * still retryable, while a write that succeeded can never be replayed.
 *
 * Used by every landlord-facing mutation (rent ledger, occupants, rooms). See
 * models/SyncOp.js for why this matters more here than in most APIs.
 */

const SyncOp = require('../models/SyncOp');

/** The client's operation id, from the header (or the body, for older callers). */
const readOpId = (req) => {
  const fromHeader = typeof req.get === 'function' ? req.get('X-Op-Id') : null;
  return String((req.body && req.body.opId) || fromHeader || '').slice(0, 40);
};

/**
 * Try to claim this operation. True = we are the first and should do the work;
 * false = it has already been applied.
 */
async function claimOp(userId, opId) {
  if (!opId) return true;
  try {
    await SyncOp.create({ userId, opId });
    return true;
  } catch (err) {
    if (err && err.code === 11000) return false; // someone got here first
    throw err;
  }
}

/** Give the claim back, so a write that failed can be retried. */
async function releaseOp(userId, opId) {
  if (!opId) return;
  try {
    await SyncOp.deleteOne({ userId, opId });
  } catch {
    /* best effort — a stranded claim only costs one retry, and expires anyway */
  }
}

/**
 * @param {Function} handler  the express handler to protect
 * @param {Function} replay   (req, res) → the response for an already-applied
 *                            operation. Usually "re-read it and send it back".
 */
function idempotent(handler, replay) {
  return async function guarded(req, res, next) {
    const opId = readOpId(req);
    if (!opId) return handler(req, res, next);
    req._opId = opId;

    let mine;
    try {
      mine = await claimOp(req.user._id, opId);
    } catch (err) {
      return next(err);
    }
    if (!mine) {
      try {
        return await replay(req, res, next);
      } catch (err) {
        return next(err);
      }
    }

    // These handlers report failure by calling next(err) rather than throwing,
    // so the claim is released from there as well as from a genuine throw.
    const releasingNext = async (err) => {
      if (err) await releaseOp(req.user._id, opId);
      return next(err);
    };
    try {
      return await handler(req, res, releasingNext);
    } catch (err) {
      await releaseOp(req.user._id, opId);
      return next(err);
    }
  };
}

module.exports = { idempotent, readOpId, claimOp, releaseOp };
