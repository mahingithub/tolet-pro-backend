/**
 * 2026-09-12-sell-interest-source-key.js
 * ─────────────────────────────────────────────────────────────────────────
 * Re-keys SellInterest from (userId, kind) to (userId, kind, source), and
 * builds the unique index that enforces it.
 *
 * WHY: `recordInterest` upserted on (userId, kind) with `source` inside $set.
 * For a logged-in user every category tap therefore OVERWROTE the previous
 * one — a tenant who tapped Internet → Cleaning → Movers left a single row
 * reading `source: 'service_movers', clickCount: 3`. The per-category demand
 * signal, which is the entire reason kind:'service' rows are recorded, was
 * being destroyed on write. Guests were unaffected (one row per tap, no
 * identity to dedupe on), so the only intact category data we have is from
 * logged-out users.
 *
 * ⚠ THIS MIGRATION CANNOT RECOVER THE OVERWRITTEN HISTORY. What was clobbered
 * is gone. It exists to make the NEW key safe to enforce. From the deploy
 * onwards the breakdown is correct; before it, treat logged-in category data
 * as unreliable and lean on the guest rows.
 *
 * WHAT IT DOES:
 *   Phase 1 — merges any duplicate (userId, kind, source) groups into one row:
 *     clickCount summed, earliest createdAt kept, most recent name/phone kept,
 *     extras deleted. Duplicates can exist because the old upsert had no
 *     unique index behind it, so two simultaneous taps could both insert.
 *   Phase 2 — builds { userId, kind, source } unique, restricted to rows with
 *     a real ObjectId userId. The partial filter matters: a plain unique index
 *     would treat every guest's null userId as the same value and allow only
 *     ONE guest row per (kind, source) to ever exist.
 *
 * RUN THIS BEFORE OR WITH THE DEPLOY. `autoIndex` is on, so the app will try
 * to build the same index itself on boot — if duplicates are still present
 * that build fails, Mongoose logs it, and the collection is left with no
 * unique protection while the app happily keeps running. Running Phase 1
 * first is what stops that happening quietly.
 *
 * Idempotent — safe to re-run. A second pass finds no duplicates and sees the
 * index already in place.
 *
 * Usage:
 *   Dry run (no writes):   node migrations/2026-09-12-sell-interest-source-key.js --dry-run
 *   Apply:                 node migrations/2026-09-12-sell-interest-source-key.js
 *   Specific DB:           MONGO_URI=mongodb://host/tolet node migrations/2026-09-12-sell-interest-source-key.js
 *
 * Rollback:
 *   node migrations/2026-09-12-sell-interest-source-key.js --rollback
 *   Drops the unique index only. The merged rows are NOT un-merged — merging
 *   loses nothing (clicks are summed), so there is nothing to restore.
 */

'use strict';

const mongoose = require('mongoose');

const argv      = process.argv.slice(2);
const DRY_RUN   = argv.includes('--dry-run');
const ROLLBACK  = argv.includes('--rollback');
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/tolet';

const SellInterest = require('../models/SellInterest');

const INDEX_NAME = 'userId_1_kind_1_source_1';

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 1 — merge duplicate (userId, kind, source) rows
// ═══════════════════════════════════════════════════════════════════════════
async function mergeDuplicates() {
  log('▶ Phase 1 — merge duplicate (userId, kind, source) rows');

  const groups = await SellInterest.aggregate([
    { $match: { userId: { $ne: null } } },
    {
      $group: {
        _id: { userId: '$userId', kind: '$kind', source: '$source' },
        ids: { $push: '$_id' },
        count: { $sum: 1 },
        totalClicks: { $sum: '$clickCount' },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  if (!groups.length) {
    log('  ✓ no duplicates — the collection is already consistent with the new key');
    return { groups: 0, deleted: 0 };
  }

  log(`  ${groups.length} duplicated group(s) found`);
  let deleted = 0;

  for (const g of groups) {
    const { userId, kind, source } = g._id;
    const label = `${userId} / ${kind} / ${source}`;

    // Keep the oldest row — it carries the true "first interested at" date,
    // which is what makes `createdAt` usable as a demand timeline.
    // eslint-disable-next-line no-await-in-loop
    const rows = await SellInterest.find({ _id: { $in: g.ids } }).sort({ createdAt: 1 }).lean();
    const keep = rows[0];
    const drop = rows.slice(1);

    // Newest non-empty contact details win — the agency needs a number that
    // still works, not the one from the first tap.
    const newest = [...rows].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];

    if (DRY_RUN) {
      log(`  [dry-run] ${label}: ${rows.length} rows → 1 (clickCount ${g.totalClicks})`);
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    await SellInterest.updateOne(
      { _id: keep._id },
      {
        $set: {
          clickCount: g.totalClicks,
          name: newest.name || keep.name || '',
          phone: newest.phone || keep.phone || '',
        },
      },
    );
    // eslint-disable-next-line no-await-in-loop
    const res = await SellInterest.deleteMany({ _id: { $in: drop.map((d) => d._id) } });
    deleted += res.deletedCount;
    log(`  ✓ ${label}: ${rows.length} rows → 1 (clickCount ${g.totalClicks})`);
  }

  log(`  ${DRY_RUN ? '[dry-run] would delete' : '✓ deleted'} ${DRY_RUN ? groups.reduce((n, g) => n + g.count - 1, 0) : deleted} redundant row(s)`);
  return { groups: groups.length, deleted };
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 2 — build the unique index
// ═══════════════════════════════════════════════════════════════════════════
async function buildIndex() {
  log('▶ Phase 2 — unique index on (userId, kind, source)');

  const collection = SellInterest.collection;
  const existing = await collection.indexes();
  if (existing.some((i) => i.name === INDEX_NAME)) {
    log('  ✓ index already present');
    return { created: false };
  }

  if (DRY_RUN) {
    log('  [dry-run] would create unique partial index', INDEX_NAME);
    return { created: false };
  }

  await collection.createIndex(
    { userId: 1, kind: 1, source: 1 },
    { unique: true, partialFilterExpression: { userId: { $type: 'objectId' } }, name: INDEX_NAME },
  );
  log('  ✓ created', INDEX_NAME);
  return { created: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// Rollback — drop the index, leave the data merged
// ═══════════════════════════════════════════════════════════════════════════
async function rollback() {
  log('▶ Rollback — dropping', INDEX_NAME);
  const collection = SellInterest.collection;
  const existing = await collection.indexes();
  if (!existing.some((i) => i.name === INDEX_NAME)) {
    log('  ✓ index not present — nothing to do');
    return;
  }
  if (DRY_RUN) {
    log('  [dry-run] would drop', INDEX_NAME);
    return;
  }
  await collection.dropIndex(INDEX_NAME);
  log('  ✓ dropped. NOTE: merged rows stay merged — merging summed the clicks,');
  log('    so nothing was lost and there is nothing to restore.');
}

// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  const banner = ROLLBACK ? '⏪ ROLLBACK' : (DRY_RUN ? '🧪 DRY RUN' : '🚀 APPLY');
  log('═══════════════════════════════════════════════════');
  log(`  ${banner} — SellInterest keyed by source`);
  log('═══════════════════════════════════════════════════');

  // autoIndex off: the point of Phase 1 is to clean up BEFORE any index build,
  // so we must not let model compilation race ahead and try it first.
  await mongoose.connect(MONGO_URI, { autoIndex: false });
  log('Connected to', MONGO_URI.replace(/:\/\/[^@]+@/, '://****@'));

  try {
    if (ROLLBACK) {
      await rollback();
    } else {
      await mergeDuplicates();
      await buildIndex();
    }
    log('───────────────────────────────────────────────────');
    log('✓ Migration complete.');
    if (DRY_RUN) log('  (dry run — nothing was written)');
  } catch (err) {
    log('❌ Migration failed:', err.message);
    log(err.stack);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    log('Disconnected.');
  }
}

if (require.main === module) {
  main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
}

module.exports = { mergeDuplicates, buildIndex, rollback, INDEX_NAME };
