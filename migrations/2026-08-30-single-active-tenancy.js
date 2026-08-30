/**
 * 2026-08-30-single-active-tenancy.js
 * ─────────────────────────────────────────────────────────────────────────
 * Closes the tenancies people already left but nobody stamped.
 *
 * WHAT WENT WRONG
 * `settleMoveOut` — "joining somewhere new means leaving everywhere else" —
 * ran on the QR and link onboarding paths but NOT on
 * booking.controller.joinByInvite, the invite-CODE path behind the "Add code"
 * button on the tenant dashboard. A tenant who moved by code kept every
 * previous landlord's booking live. One real account ended up showing four
 * simultaneous homes and ৳97,377 of combined dues across rooms they had left
 * months earlier.
 *
 * joinByInvite now calls settleMoveOut like every other entry point. This
 * migration deals with the rows written before that.
 *
 * WHAT IT DOES
 * For every person holding more than one LIVE tenancy, keeps the most recently
 * started one and stamps the rest moved-out — the same closeMembership() the
 * live code path uses, so there is one definition of what "left" means.
 *
 * "Most recently started" = their own member joinDate, else the lease's
 * leaseStart, else createdAt (see tenancy.service.tenancyStartedAt).
 *
 * SAFETY
 *   • Idempotent — a second run finds nothing to do.
 *   • NOTHING IS DELETED. A tenancy ends by being stamped with a move-out
 *     date. The rent ledger, the receipts and the tenant's details stay
 *     exactly where they are, and the landlord keeps their history.
 *   • Landlord notifications are OFF by default. The live path notifies
 *     because it is a live event; a bulk sweep over months of stale rows would
 *     be a push-notification storm. Pass --notify to send them.
 *   • A person genuinely holding two lets at once (a shop and a home) will
 *     have the older one closed. That is the same trade the live code already
 *     makes, and the landlord can re-add them — no data is lost. Use
 *     --dry-run first and read the list.
 *
 * Usage:
 *   node migrations/2026-08-30-single-active-tenancy.js --dry-run
 *   node migrations/2026-08-30-single-active-tenancy.js
 *   node migrations/2026-08-30-single-active-tenancy.js --notify
 *   MONGO_URI=mongodb://host/tolet node migrations/2026-08-30-single-active-tenancy.js
 */

'use strict';

const mongoose = require('mongoose');

const argv    = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const NOTIFY  = argv.includes('--notify');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/tolet';

const Booking = require('../models/Booking');
const User    = require('../models/User');
const {
  phoneCore, closeMembership, findLiveTenancies, tenancyStartedAt, notifyLandlordOfMoveOut,
} = require('../services/tenancy.service');

const log = (...a) => console.log(...a);

const label = (b) => {
  const bits = [b.property || '(no name)', b.floorNumber && `${b.floorNumber} তলা`, b.roomNumber && `রুম ${b.roomNumber}`];
  return bits.filter(Boolean).join(' · ');
};
const day = (d) => {
  const x = d ? new Date(d) : null;
  return x && !Number.isNaN(x.getTime()) ? x.toISOString().slice(0, 10) : '—';
};

/**
 * Everyone who currently holds a live tenancy, as { userId, phone } identities.
 * A person can appear via a linked account or via a phone-only placeholder;
 * both are collected, and findLiveTenancies matches on either, so processing
 * one identity settles the other (the second pass then finds one tenancy left).
 */
async function collectTenants() {
  const live = await Booking.find({
    status: { $nin: ['cancelled', 'completed'] },
    deletedAt: null,
  }).select('tenantId tenantPhone members').lean();

  const byUser = new Map();
  const byPhone = new Map();

  const add = (userId, phone) => {
    if (userId) {
      const k = String(userId);
      const prev = byUser.get(k);
      byUser.set(k, { userId, phone: prev?.phone || phone || '' });
      return;
    }
    const core = phoneCore(phone);
    if (core && !byPhone.has(core)) byPhone.set(core, { userId: null, phone });
  };

  for (const b of live) {
    add(b.tenantId, b.tenantPhone);
    for (const m of (b.members || [])) {
      if (!m || m.status === 'moved-out') continue;
      add(m.userId, m.phone);
    }
  }

  // A linked account's own phone is the canonical one to match placeholders by.
  const users = await User.find({ _id: { $in: [...byUser.keys()] } }).select('phone name').lean();
  const userPhone = new Map(users.map((u) => [String(u._id), u.phone || '']));
  const userName  = new Map(users.map((u) => [String(u._id), u.name || '']));

  const identities = [...byUser.entries()].map(([k, v]) => ({
    userId: v.userId,
    phone: userPhone.get(k) || v.phone || '',
    name: userName.get(k) || '',
  }));

  // Phone-only occupants who never linked an account. Skip any whose number
  // already belongs to one of the identities above.
  const known = new Set(identities.map((i) => phoneCore(i.phone)).filter(Boolean));
  for (const [core, v] of byPhone) {
    if (known.has(core)) continue;
    identities.push({ userId: null, phone: v.phone, name: '' });
  }

  return identities;
}

async function settleEveryone() {
  const identities = await collectTenants();
  log(`  ${identities.length} tenant identit${identities.length === 1 ? 'y' : 'ies'} with a live tenancy`);

  let multiple = 0;
  let closed = 0;

  for (const who of identities) {
    // eslint-disable-next-line no-await-in-loop
    const live = await findLiveTenancies(who.userId, who.phone);
    if (live.length <= 1) continue;

    multiple += 1;
    const [keep, ...leave] = live; // findLiveTenancies returns newest-first
    const whoLabel = who.name || who.phone || String(who.userId);
    log(`\n  ${whoLabel} — ${live.length} live tenancies`);
    log(`    keep : ${label(keep)}  (started ${day(tenancyStartedAt(keep, who.userId, who.phone))})`);

    for (const booking of leave) {
      const when = tenancyStartedAt(keep, who.userId, who.phone);
      log(`    close: ${label(booking)}  (started ${day(tenancyStartedAt(booking, who.userId, who.phone))})`);
      if (DRY_RUN) { closed += 1; continue; }

      if (!closeMembership(booking, who.userId, who.phone, when)) {
        log('           ↳ nothing to close on this row (already settled)');
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await booking.save();
      closed += 1;

      if (NOTIFY) {
        // eslint-disable-next-line no-await-in-loop
        await notifyLandlordOfMoveOut({
          booking,
          tenantName: whoLabel,
          reason: `${whoLabel} নতুন বাসায় উঠেছেন।`,
        }).catch(() => {});
      }
    }
  }

  log('');
  log(`  ${multiple} tenant(s) held more than one home`);
  log(`  ${DRY_RUN ? '[dry-run] would close' : '✓ closed'} ${closed} stale tenanc${closed === 1 ? 'y' : 'ies'}`);
  if (!DRY_RUN && !NOTIFY && closed > 0) {
    log('  (landlords were NOT notified — re-run with --notify if you want them told)');
  }
  return { multiple, closed };
}

async function main() {
  log('═══════════════════════════════════════════════════');
  log(`  ${DRY_RUN ? '🧪 DRY RUN' : '🚀 APPLY'} — one person, one home`);
  log('═══════════════════════════════════════════════════');

  await mongoose.connect(MONGO_URI, { autoIndex: false });
  log('Connected to', MONGO_URI.replace(/:\/\/[^@]+@/, '://****@'));

  try {
    await settleEveryone();
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

module.exports = { collectTenants, settleEveryone };
