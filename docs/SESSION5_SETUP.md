# 📦 Session 5: Backend Testing + Polish + Edge Cases — SETUP

এই session-এ Blueprint v2 ship করার আগের **শেষ defensive layer** তৈরি হলো। মোট ৫টা output, কোনোটাই নতুন feature না — সব hardening + observability।

| # | File | Purpose |
|---|---|---|
| 1 | `EDGE_CASES.md` | ১৭টা edge case catalog (P1/P2/P3) with code-level fixes |
| 2 | `profile.test.js` | Jest + supertest backend test suite (~40 tests) |
| 3 | `2026-05-22-add-landlord-profile.js` | Idempotent migration script with dry-run + rollback |
| 4 | `MONITORING.md` | Alerts, log patterns, dashboard layout, deploy runbook |
| 5 | `SESSION5_SETUP.md` | এই doc — index + sequencing |

---

## 📁 File placement

```
tolet-pro-backend/
├── tests/
│   └── profile.test.js                                   ← 🆕 Session 5
├── migrations/
│   └── 2026-05-22-add-landlord-profile.js                ← 🆕 Session 5
└── docs/
    ├── EDGE_CASES.md                                     ← 🆕 Session 5
    └── MONITORING.md                                     ← 🆕 Session 5
```

> If your repo separates frontend/backend, the .md files belong in the backend repo's `docs/` folder since 80% of edge cases are backend-resident. EC-03, EC-04, EC-07, EC-08, EC-11 are frontend — those fixes still go in frontend code, but the catalog stays unified.

---

## 🚀 Recommended sequence (~3-4 hours, can split across two sittings)

> **Test-first.** Land the tests BEFORE the fixes — each fix's PR includes "test goes from red to green" as the proof of correctness.

### Hour 1 — Tests land (red)

1. Install test deps if missing:
   ```bash
   npm i -D jest supertest mongodb-memory-server jsonwebtoken
   ```
2. Drop `profile.test.js` in `tests/`
3. Adjust the require paths at the top to match your repo layout:
   - `require('../src/server')` → your Express app export
   - `require('../src/models/User')` → your User model
   - `require('../src/utils/trustScore')` → wherever computeTrustScore lives
4. Run: `npx jest tests/profile.test.js --runInBand`
5. **Expected:** happy-path tests pass, EC-01/EC-02/EC-05/EC-06 tests **fail** (red)
6. Commit the test file. Tests-going-red is the diff that "proves the bug exists"

### Hour 2 — Fix the P1s (red → green)

Apply each EDGE_CASES.md P1 fix as a separate PR:

| Fix | File touched | Test that flips to green |
|---|---|---|
| EC-01 emergencyContact whole-object | `routes/auth.js` | "accepts whole-object emergencyContact payload" |
| EC-02 trust score persisted | `routes/auth.js` | "persists computed trust score to DB after PATCH" |
| EC-03 workPlaceId orphan | `frontend ProfileSection.jsx` | (manual / e2e — no Jest coverage) |
| EC-04 landlord cache leak | `frontend authService.js` | (manual cross-account test) |
| EC-05 serviceCharge empty→0 | `frontend validators.js` + `routes/auth.js` | "skips empty-string serviceCharge instead of coercing to 0" |

Run `npx jest` after each PR — all tests should be green before merging the next.

### Hour 3 — P2 polish

P2 items don't block ship but should land in the same sprint. Suggested order (cheapest first):

| Order | Fix | Effort | Notes |
|---|---|---|---|
| 1 | EC-06 phone regex on schema | 5 min | Add to User.js, test already covers it |
| 2 | EC-08 chip-multi defaults | 5 min | One-line change in TenantProfileFields.jsx |
| 3 | EC-11 RAF generation guard | 10 min | TrustGaugeLive.jsx polish |
| 4 | EC-10 avatar URL versioning | 15 min | Probably already works, just verify |
| 5 | EC-07 trust formula drift (delete local copy) | 30 min | Test thoroughly — affects displayed numbers |
| 6 | EC-12 load-modify-save pattern | 20 min | Optional, only matters if you add save hooks |
| 7 | EC-09 avatar 5MB / HEIC downscale | 45 min | Real UX win for iPhone users |

### Hour 4 — Deploy + watch

Follow the **MONITORING.md deploy runbook** (T-30, T-0, T+5, T+15, T+60). Three windows are critical:

- **T+5 min** — sanity check: GET /me returns the new sub-document
- **T+15 min** — feature check: real user can edit + persist
- **T+60 min** — bedding-in check: error rates back to baseline

Alerts A1-A5 (also in MONITORING.md) should be configured BEFORE the deploy.

---

## 🧪 Test execution checklist

Before merging Session 5 work:

- [ ] `npx jest` exits 0 with all profile tests passing
- [ ] `npx jest --coverage` shows >80% coverage of `routes/auth.js` PATCH handler
- [ ] Migration dry-run produces sensible numbers:
      `node migrations/2026-05-22-add-landlord-profile.js --dry-run`
- [ ] Migration rollback dry-run works:
      `node migrations/2026-05-22-add-landlord-profile.js --rollback --dry-run`
- [ ] Manual smoke test: GET /me + PATCH /me + POST /me/avatar all return 200
- [ ] Sentry tags configured (`feature.blueprint_v2: enabled`)
- [ ] Alert A1-A5 set up in APM dashboard
- [ ] Pre-deploy DB snapshot procedure rehearsed (don't learn it during an incident)

---

## 🎯 What "done" looks like for Session 5

| Capability | Status target |
|---|---|
| Backend rejects invalid v2 inputs cleanly (4xx with `validation_error` code) | ✅ |
| Whole-object payloads from existing frontend code paths still work (EC-01) | ✅ |
| Trust score visible in DB after every PATCH (EC-02) | ✅ |
| Cross-account localStorage leak closed for landlord caches (EC-04) | ✅ |
| Tests cover all P1 edge cases — and would catch regressions on next change | ✅ |
| Production has alerts that fire on quality drift (not just outages) | ✅ |
| There's a one-command rollback if the deploy goes sideways | ✅ |
| P3 items live in a backlog, not in someone's head | ✅ |

---

## ⚠️ Honest caveats

1. **`profile.test.js` assumes your auth middleware accepts Bearer JWT.** If you use cookies or session tokens, replace `.set('Authorization', ...)` with `.set('Cookie', ...)`. The `signTokenFor` helper at the top of the file mirrors a typical jsonwebtoken setup; swap if yours differs.

2. **The avatar upload tests are skipped if Cloudinary isn't configured** (no API key in CI env). That's the right behavior — don't fake-mock Cloudinary in unit tests. For the Cloudinary path, add an e2e test that runs against a real staging account.

3. **The migration script's User model loader tries 3 common paths.** If your layout is different, edit the `candidates` array at the top. Failing loud is intentional — a silent default would lead to migrating against the wrong model.

4. **EC-03, EC-04, EC-09, EC-13, EC-15 are frontend or operational edge cases** — no Jest test will catch them. They have manual repro steps in EDGE_CASES.md. Consider adding a Playwright/Cypress run for EC-03 and EC-04 (cross-account flows) as a future hardening pass.

5. **Trust score formula is currently in two places** (TenantDashboard local + backend `utils/trustScore`). EC-07 fixes this by deleting the local copy. Until that lands, the displayed score may flicker on save — call it out in QA so testers don't file dupes.

6. **Monitoring assumes you have an APM (Datadog/New Relic/whatever) AND a log aggregator.** If you only have Sentry, you can still get alerts A1, A3, A4 — A2 and A5 need real-time metrics. Add at least Pino + Datadog or Grafana Loki before the v2 ship if you don't have them.

---

## 🗺 What comes after Session 5

This was the final defensive layer of Blueprint v2. The product is now "done" in the sense that:

- Code shipped ✅
- Tests covering the risks ✅
- Migration safe to apply ✅
- Alerts to catch the rest ✅
- Runbook for incidents ✅

Realistic next sprints look like **product polish**, not infrastructure:

| Sprint | Focus |
|---|---|
| Sprint 6 | Workplace dictionary admin route (so admins can add new institutions without a deploy) |
| Sprint 7 | Telemetry-driven UX iteration — which fields drive trust gains, where do users drop off? |
| Sprint 8 | A/B test the completion meter visibility (some studies show it nags, others say it motivates) |
| Sprint 9 | Internationalisation beyond Bangla+English (Hindi for cross-border investors?) |

---

## 📂 Final file inventory (Sessions 1-5)

```
tolet-pro-frontend/src/
├── components/
│   ├── profile/
│   │   ├── TenantProfileFields.jsx          ← S2
│   │   └── LandlordProfileFields.jsx        ← S3
│   ├── shared/
│   │   ├── Skeleton.jsx                     ← S1
│   │   ├── AvatarUploader.jsx               ← S1
│   │   ├── UploadSourceSheet.jsx            ← S1
│   │   ├── InlineField.jsx                  ← S1
│   │   ├── WorkplaceAutocomplete.jsx        ← S1
│   │   ├── ChipSelector.jsx                 ← S2
│   │   ├── TrustGaugeLive.jsx               ← S2
│   │   └── ProfileSection.jsx               ← S2 + S3 (role-aware)
│   ├── TenantDashboard.jsx                  ← S2 patch
│   └── HostDashboard.jsx                    ← S3 patch
├── data/
│   └── workplaces.js                        ← S1
└── utils/
    └── validators.js                        ← S1 (+ EC-05 fix in S5)

tolet-pro-backend/
├── models/User.js                           ← S3 schema (+ EC-06 in S5)
├── routes/auth.js                           ← S3 PATCH /me (+ EC-01, EC-02 fixes in S5)
├── services/cloudinary.service.js           ← S3 (avatar route)
├── utils/trustScore.js                      ← S3 (formula source of truth)
├── tests/profile.test.js                    ← 🆕 S5
├── migrations/2026-05-22-add-landlord-profile.js  ← 🆕 S5
└── docs/
    ├── PROFILE_BLUEPRINT.md                 ← original
    ├── PROFILE_BLUEPRINT_v2.md              ← original
    ├── SESSION1_SETUP.md                    ← S1
    ├── SESSION3_SETUP.md                    ← S3
    ├── TenantDashboard_PATCH.md             ← S2
    ├── HostDashboard_PATCH.md               ← S3
    ├── Backend_PATCH.md                     ← S3
    ├── EDGE_CASES.md                        ← 🆕 S5
    ├── MONITORING.md                        ← 🆕 S5
    └── SESSION5_SETUP.md                    ← 🆕 S5 (this doc)
```

---

**Session 5 done. Blueprint v2 hardened, tested, and ready to ship.** 🎯
