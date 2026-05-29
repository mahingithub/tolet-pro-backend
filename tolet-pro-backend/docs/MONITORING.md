# 📈 MONITORING — Session 5

Blueprint v2 ship হওয়ার পর কী watch করতে হবে — Sentry tags, log patterns, alerts, dashboards। এই doc-টা runbook + reference, একই সাথে।

> Audience: anyone on-call after the v2 deploy। Bookmark করো।

---

## 🎯 Why monitor specifically these?

V2-এর নতুন কোডের risk profile তিন রকম:

1. **Validation failures** — নতুন enum, regex, length limits। Misconfigured frontend বা rogue client সব fail করতে পারে।
2. **Cloudinary spend** — নতুন avatar route + NID document uploads। Quota leak হলে bill spike হবে।
3. **Trust score / sub-document writes** — নতুন PATCH /me code path অনেক optional field handle করে। Silent data loss সবচেয়ে dangerous (user complains weeks later)।

---

## 🚨 Alerts (set these BEFORE deploy)

### A1 — Sudden spike in PATCH /me 4xx

**Threshold:** `4xx_rate > 5% over a 10-minute window` on PATCH /api/auth/me
**Why:** Validation failures should be rare (<1%) in steady state — frontend pre-validates. Spike means either:
- A frontend regression (validator drifted from schema) — EC-06 / EC-08 type issues
- A malicious client probing — auto-investigate

**Where:** APM (Datadog / New Relic / whatever you use). Tag the metric with `route=PATCH /me` and `status_class=4xx`.

**On-page action:**
1. Check Sentry's `validation_error` events from the last hour
2. Group by `details.errors.path` — which field is breaking?
3. If one field dominates: check schema vs frontend validator for that field
4. If broadly distributed: probably a malicious scan; check requesting IPs

---

### A2 — Cloudinary monthly storage growth > N% above baseline

**Threshold:** `storage_used_gb > rolling_30d_baseline * 1.20`
**Why:** Avatar / NID uploads should overwrite (same publicId, `overwrite: true`). If quota grows faster than user signup rate, there's a leak — likely `cloudinary.destroy()` not being called when a user replaces an asset. See EC-10 around versioning too.

**Where:** Cloudinary Admin API exposes `/usage`. Cron a daily fetch into your metrics store. Anthropic-style: just curl from a daily GitHub Action.

```bash
# Daily cron — drops one Prometheus-style metric per run
curl -u "$CLOUDINARY_API_KEY:$CLOUDINARY_API_SECRET" \
  "https://api.cloudinary.com/v1_1/$CLOUD_NAME/usage" | \
  jq -r '. | "cloudinary_storage_gb \(.storage.usage / 1e9)"' \
  >> /var/log/cloudinary_usage.prom
```

**On-page action:**
1. Run a Cloudinary search for orphaned assets:
   ```bash
   # Folders with files but no matching user (orphans)
   cloudinary search "folder:tolet-pro/* AND uploaded_at>1d"
   ```
2. Compare with `User.distinct('avatarPublicId')` — anything in Cloudinary but not in DB is an orphan
3. Use the existing `cloudinary.destroy(publicId)` helper to clean up

---

### A3 — Mongoose ValidationError rate (any model)

**Threshold:** `validation_errors_per_minute > 10` for 5 consecutive minutes
**Why:** Direct DB writes from controllers should validate cleanly in steady state. A burst means either a bad deploy or someone forgot to update the frontend after a schema change.

**Where:** Sentry — these surface as `Error: User validation failed: ...` with `name: 'ValidationError'`.

**Sentry filter:**
```
issue.tag:env=production AND error.value:"validation failed"
```

**On-page action:**
1. Group by `error.value` — what's the rejected field?
2. Cross-reference with last deploy diff
3. If it's `tenantProfile.familySize` or `landlordProfile.preferredTenants`: check if anyone added an enum value to the frontend but forgot the schema. Common mistake.

---

### A4 — Trust score distribution shifts unexpectedly

**Threshold:** Daily check, alert if `mean(trustScore)` moves > 5 points in 24h
**Why:** Trust score is computed server-side now (EC-02 fix). A formula bug could make scores jump or crash uniformly. Real users earn trust incrementally — sudden uniform shifts indicate a code bug.

**Where:** Daily aggregation:
```javascript
// scripts/daily-metrics.js
const result = await User.aggregate([
  { $match: { phoneVerified: true } },
  { $group: {
      _id: null,
      mean: { $avg: '$trustScore' },
      p50:  { $median: { input: '$trustScore', method: 'approximate' } },
      p95:  { $percentile: { input: '$trustScore', p: [0.95], method: 'approximate' } },
    } },
]);
```

**On-page action:** If alarm fires, diff the formula in `computeTrustScore` vs last week's git log. Manual check 10 random users — their displayed score should match the formula.

---

### A5 — Avatar upload P95 latency

**Threshold:** `p95(avatar_upload_duration_ms) > 5000` for 15 min
**Why:** Avatar uploads stream through your backend to Cloudinary. If backend gets slow (memory pressure, CPU starve) the upload-streaming endpoint suffers first because it holds a connection open. Also: Cloudinary outage manifests here before anywhere else.

**Where:** APM. Tag with `route=POST /me/avatar`.

**On-page action:**
1. Check Cloudinary status page (status.cloudinary.com)
2. Check backend pod CPU/memory
3. If Cloudinary is down: serve a friendly toast in the UI ("avatar upload temporarily unavailable") — don't block other features

---

## 📝 Structured log patterns

Use **structured JSON logs** for the new endpoints so the patterns below are greppable in your log store. The minimal pattern:

```javascript
// routes/auth.js — at the top of the handler
const log = require('../utils/logger');  // pino / winston / bunyan

router.patch('/me', requireAuth, async (req, res) => {
  const t0 = Date.now();
  const ctx = { userId: req.user.id, route: 'PATCH /me' };
  try {
    // ... existing logic ...
    log.info({ ...ctx, fieldsUpdated: Object.keys($set), ms: Date.now() - t0 },
      'profile.update.ok');
    return res.json({ user });
  } catch (err) {
    log.warn({ ...ctx, err: err.message, code: err.code, ms: Date.now() - t0 },
      'profile.update.fail');
    // ... existing error response ...
  }
});
```

### Required log events (search queries you'll want)

| Event name | When | Use |
|---|---|---|
| `profile.update.ok` | Every successful PATCH /me | Funnel: which fields are users actually editing? |
| `profile.update.fail` | Every 4xx/5xx PATCH /me | Triage validation failures |
| `profile.update.dropped` | Allowlist drop happened | Detect malicious key-probing (EC-04 style) |
| `avatar.upload.ok` | Successful avatar upload | Cloudinary usage tracking |
| `avatar.upload.fail` | 413 / Cloudinary error | Latency + outage detection |
| `trust.recompute` | After computeTrustScore call | Validate formula is being applied |

### What to AVOID logging

- ❌ Full request bodies (PII in emergency contacts, phone numbers)
- ❌ JWT tokens (even partial)
- ❌ Cloudinary API secrets (obviously)
- ✅ User IDs are OK (already in your auth logs)
- ✅ Field NAMES are OK (`fieldsUpdated: ['workPlace']`) but not VALUES

---

## 📊 Dashboard layout (suggested)

One dashboard, four rows:

```
┌────────────────────────────────────────────────────────────────┐
│ Row 1 — Health                                                  │
│  [PATCH /me success rate]  [Avatar upload success rate]         │
│  [Mean response time]      [Open Sentry issues]                 │
├────────────────────────────────────────────────────────────────┤
│ Row 2 — Volume                                                  │
│  [PATCH /me / hour]  [Avatar uploads / day]  [New signups / day]│
├────────────────────────────────────────────────────────────────┤
│ Row 3 — Data quality                                            │
│  [% users with workPlace set]                                   │
│  [% landlords with preferredTenants set]                        │
│  [Trust score histogram]                                        │
├────────────────────────────────────────────────────────────────┤
│ Row 4 — Cost                                                    │
│  [Cloudinary storage GB used]  [Cloudinary bandwidth this month]│
│  [MongoDB ops/sec on users collection]                          │
└────────────────────────────────────────────────────────────────┘
```

Row 3 ("data quality") is the most novel — track adoption of the new fields. If `% users with workPlace set` is <5% after a week, the field is buried or unclear; investigate UX. If it's >50%, you nailed the prompt.

---

## 🔍 Sentry tags (apply on every event)

```javascript
// In your Sentry init (probably app.js or server.js):
Sentry.setTag('app.version', process.env.APP_VERSION);
Sentry.setTag('feature.blueprint_v2', 'enabled');

// In each route handler that touches new code, before any await:
Sentry.setContext('profile_update', {
  role:      req.user.activeRole,
  numFields: Object.keys(req.body || {}).length,
});
```

Tags let you filter Sentry to ONLY blueprint-v2-related issues during the post-deploy watch window.

---

## 🚦 Deploy + watch runbook

The first 60 minutes after the v2 deploy are where most issues surface. Concrete steps:

### T-30 min (before deploy)

- [ ] Pre-deploy DB snapshot:
  `mongodump --uri="$MONGO_URI" --out=/backups/pre-v2-$(date +%F)`
- [ ] Verify Cloudinary usage baseline (record number)
- [ ] Confirm Sentry release tag is set in CI
- [ ] Brief the on-call: "v2 deploy in 30, watch for A1-A5"

### T-0 (deploy)

- [ ] Ship backend
- [ ] Run migration in dry-run mode first:
  `node migrations/2026-05-22-add-landlord-profile.js --dry-run`
- [ ] Verify counts match expectations (~all existing users)
- [ ] Run for real:
  `node migrations/2026-05-22-add-landlord-profile.js`
- [ ] Ship frontend

### T+5 min — sanity check

- [ ] Hit GET /api/auth/me as a known user — does response include `landlordProfile`?
- [ ] Hit PATCH /api/auth/me with `{ workPlace: 'Test' }` — does it persist?
- [ ] Check error rate in APM — should be < baseline + 1%

### T+15 min — feature check

- [ ] Open the production dashboard as a real tenant account
- [ ] Edit one field, verify the green check flash + persistence
- [ ] Refresh → value still there
- [ ] Same for landlord account

### T+60 min — bedding-in check

- [ ] Review Sentry for any new issue types since deploy
- [ ] Check the dashboard Row 1 — no red metrics
- [ ] Check Cloudinary usage — growth proportional to upload count
- [ ] If all green: stand down, normal on-call applies
- [ ] If anything red: see "Rollback" below

---

## ⏪ Rollback procedure

If alarm A1, A3, or A5 fires sustained for >10 min and you can't identify the cause:

1. **Frontend revert** — most issues come from the frontend / schema mismatch. Revert the frontend bundle to the pre-v2 hash. Users will see the old dashboard; their newly-saved fields won't appear, but no data is lost.

2. **Backend revert** — if backend itself is the issue (e.g. computeTrustScore throwing):
   ```bash
   # Revert to previous Docker tag / git SHA
   kubectl set image deploy/api api=tolet-pro/api:pre-v2
   # OR
   git revert <merge-commit-hash> && deploy
   ```

3. **Migration rollback** — usually NOT needed (the new fields are additive with empty defaults). Only run this if the schema itself is corrupted:
   ```bash
   node migrations/2026-05-22-add-landlord-profile.js --rollback
   ```
   This removes only fields that are still at their empty default — users who entered real data keep it.

4. **DB restore** — last resort. Restore the pre-deploy snapshot:
   ```bash
   mongorestore --drop --uri="$MONGO_URI" /backups/pre-v2-$(date +%F)/
   ```
   This LOSES all PATCH /me writes that landed between deploy and restore. Communicate the window clearly to affected users.

---

## 📓 Weekly review checklist (first 4 weeks post-deploy)

Every Monday for 4 weeks, run:

- [ ] **Adoption** — `% users with each v2 field set`. Sparkline trend.
- [ ] **Trust score distribution** — histogram, look for bimodal shapes (suggests formula bug)
- [ ] **Storage growth** — Cloudinary GB delta this week vs last
- [ ] **New Sentry issues** — any v2-tagged issues older than 7 days unresolved?
- [ ] **Support tickets** — search for "profile", "workplace", "avatar" — any new themes?

After 4 weeks: drop to monthly review.

---

## 🛠 Useful one-liners

```bash
# How many users have a landlordProfile set (any field)
mongosh "$MONGO_URI" --eval '
  db.users.countDocuments({ "landlordProfile.fullName": { $ne: "" } })
'

# Distribution of trust tiers
mongosh "$MONGO_URI" --eval '
  db.users.aggregate([{ $group: { _id: "$trustTier", n: { $sum: 1 } } }])
'

# Top 20 most-common workplaces (validation: are users typing free-form
# or picking from autocomplete?)
mongosh "$MONGO_URI" --eval '
  db.users.aggregate([
    { $group: { _id: "$tenantProfile.workPlace", n: { $sum: 1 } } },
    { $sort: { n: -1 } },
    { $limit: 20 },
  ])
'

# Find users whose workPlaceId points to nothing (EC-03 orphans)
mongosh "$MONGO_URI" --eval '
  db.users.find({
    "tenantProfile.workPlaceId": { $ne: "", $exists: true },
    "tenantProfile.workPlace":   { $eq: ""  },
  }).count()
'
```

---

**Save this doc with the runbook bookmark. The first 24-72 hours after v2 ship are where 80% of the issues will surface — don't be surprised, be prepared.** 🎯
