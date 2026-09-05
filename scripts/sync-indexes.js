'use strict';

/**
 * sync-indexes — reconcile the live database's indexes with the model files.
 * ──────────────────────────────────────────────────────────────────────────
 * WHY A SCRIPT AND NOT JUST autoIndex
 *
 * server.js connects with `mongoose.connect(uri)` and no options, so autoIndex
 * defaults to on and Mongoose CREATES anything the schemas declare. What it
 * never does is DROP. Remove an index from a model file and the b-tree stays in
 * the database forever — still written on every insert, still consuming RAM in
 * the working set, invisible in code review because the declaration is gone.
 *
 * This work removed 12 such indexes (redundant single-field copies of compound
 * prefixes, and fields nothing ever filtered on). Without a syncIndexes() pass
 * the deployment keeps paying for all 12 and none of the write-path savings
 * land. Hence this.
 *
 * IT ALSO FIXES TWO TTL INDEXES THAT NEVER EXISTED. LoginHistory.loginAt and
 * RefreshToken.expiresAt each declared `index: true` on the field AND a TTL
 * index on the same key. Mongo rejects the second createIndex with
 * IndexOptionsConflict, and the one it rejected was the TTL — so neither
 * collection has ever expired a document. After this runs they will, and the
 * first pass may delete a large backlog. That is the intended behaviour
 * (90-day login history, expired refresh tokens), but see --dry-run first.
 *
 * USAGE
 *   node scripts/sync-indexes.js --dry-run   # print the plan, change nothing
 *   node scripts/sync-indexes.js             # apply
 *
 * SAFETY
 *   • Dry-run by default in production unless --yes is passed.
 *   • Index builds on Mongo 4.2+ are backgroundish but still take locks
 *     briefly. Run it in a maintenance window on a large collection.
 *   • Dropping an index is instant and reversible — re-running after a revert
 *     rebuilds it. Building one is the slow half.
 */

require('dotenv').config();

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const args    = process.argv.slice(2);
const DRY     = args.includes('--dry-run');
const YES     = args.includes('--yes');
const isProd  = (process.env.NODE_ENV || 'development') === 'production';

function keyStr(spec) {
  return JSON.stringify(spec);
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is not set. Refusing to run against nothing.');
    process.exit(1);
  }

  if (isProd && !DRY && !YES) {
    console.error('Refusing to modify production indexes without --yes (or use --dry-run).');
    process.exit(1);
  }

  // autoIndex off: this script decides what happens, not the connection.
  await mongoose.connect(uri, { autoIndex: false });
  console.log(`connected → ${mongoose.connection.name}\n`);

  const modelsDir = path.join(__dirname, '..', 'models');
  for (const f of fs.readdirSync(modelsDir).filter((x) => x.endsWith('.js'))) {
    require(path.join(modelsDir, f));
  }

  let created = 0;
  let dropped = 0;
  let failed  = 0;

  for (const name of mongoose.modelNames().sort()) {
    const Model = mongoose.model(name);
    const coll  = Model.collection;

    // What the database has right now. A collection that does not exist yet
    // simply has nothing — its indexes are built on first write.
    let existing = [];
    try {
      existing = await coll.indexes();
    } catch (err) {
      if (err.codeName === 'NamespaceNotFound') continue;
      throw err;
    }

    const declared = Model.schema.indexes();

    // _id_ is implicit and must never be touched.
    const existingByKey = new Map(
      existing.filter((i) => i.name !== '_id_').map((i) => [keyStr(i.key), i]),
    );
    const declaredKeys = new Set(declared.map(([spec]) => keyStr(spec)));

    const toDrop = [...existingByKey.entries()].filter(([k]) => !declaredKeys.has(k));
    const toAdd  = declared.filter(([spec]) => !existingByKey.has(keyStr(spec)));

    // Also catch the IndexOptionsConflict case: same key, different options
    // (a plain index where a TTL is declared, or vice versa). Those need the
    // old one dropped before the new one can be built.
    const toRebuild = declared.filter(([spec, opts]) => {
      const cur = existingByKey.get(keyStr(spec));
      if (!cur) return false;
      const wantTtl = opts && opts.expireAfterSeconds;
      const hasTtl  = cur.expireAfterSeconds;
      return (wantTtl == null) !== (hasTtl == null) || (wantTtl != null && wantTtl !== hasTtl);
    });

    if (!toDrop.length && !toAdd.length && !toRebuild.length) continue;

    console.log(`── ${name} (${coll.collectionName})`);

    for (const [key, ix] of toDrop) {
      console.log(`   DROP    ${key}  [${ix.name}]`);
      if (!DRY) {
        try { await coll.dropIndex(ix.name); dropped += 1; } catch (e) {
          console.log(`           ✗ ${e.codeName || e.message}`); failed += 1;
        }
      }
    }

    for (const [spec, opts] of toRebuild) {
      const cur = existingByKey.get(keyStr(spec));
      console.log(`   REBUILD ${keyStr(spec)}  [${cur.name}] — options changed (TTL)`);
      if (!DRY) {
        try {
          await coll.dropIndex(cur.name);
          await coll.createIndex(spec, opts || {});
          created += 1; dropped += 1;
        } catch (e) {
          console.log(`           ✗ ${e.codeName || e.message}`); failed += 1;
        }
      }
    }

    for (const [spec, opts] of toAdd) {
      const flags = [];
      if (opts && opts.unique) flags.push('unique');
      if (opts && opts.sparse) flags.push('sparse');
      if (opts && opts.expireAfterSeconds != null) flags.push(`ttl=${opts.expireAfterSeconds}`);
      console.log(`   CREATE  ${keyStr(spec)}${flags.length ? '  [' + flags.join(',') + ']' : ''}`);
      if (!DRY) {
        try { await coll.createIndex(spec, opts || {}); created += 1; } catch (e) {
          // A unique index fails to build when the data already violates it.
          // Report it loudly rather than continuing as if it succeeded.
          console.log(`           ✗ ${e.codeName || e.message}`); failed += 1;
        }
      }
    }
    console.log('');
  }

  if (DRY) {
    console.log('dry run — nothing was changed. Re-run without --dry-run to apply.');
  } else {
    console.log(`done: ${created} created, ${dropped} dropped, ${failed} failed.`);
  }

  await mongoose.disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
