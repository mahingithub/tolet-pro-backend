# 🪲 EDGE_CASES — Session 5

Session 1-3 (frontend + backend) ship করার পর code path পুরোপুরি rescan করেছি। **১৭টা edge case** পাওয়া গেছে — কিছু blocking, কিছু polish, কিছু future-risk।

> Severity scale:
> - 🔴 **P1 / Blocking** — ship-stopper, user-visible breakage, security
> - 🟠 **P2 / Polish** — degraded UX বা data quality, ship-পরে fix করা যায়
> - 🟡 **P3 / Future** — তখনই issue হবে যখন scale বাড়বে, এখন watchlist-এ রাখো

প্রতিটা case-এর জন্য: **What** (reproduction), **Why** (root cause), **Fix** (concrete code/strategy)।

---

## 🔴 P1 — Blocking

### EC-01: `emergencyContact` whole-object payload silently dropped

**What:** Frontend-এর TenantDashboard `persistProfile(next)` call করলে whole `tenantProfile` object posted হয়, যার ভেতরে `emergencyContact: { name, phone, relation }` থাকে একটা nested object হিসেবে। Backend controller's allowlist এই bare key `'emergencyContact'` চিনে না — শুধু dotted-path `'emergencyContact.phone'` allowed। Silent drop, no error to client. User তার emergency contact save করেছে ভাবে, refresh-এ field খালি।

**Why:** Controller's Path A loop checks `ALLOWED_TOP_LEVEL.has(key)` and `NESTED_TENANT_KEYS.includes(key)`। `'emergencyContact'` কোনটাতেই নেই, so it falls to "silently drop" branch।

**Fix:** Controller-এ nested-object handler যোগ করো:

```javascript
// In routes/auth.js PATCH /me handler, inside the for-loop after the
// existing 3 branches — handle whole-sub-object payloads by walking
// one level deep and re-checking each child key.
if (key === 'emergencyContact' && value && typeof value === 'object') {
  for (const [subKey, subVal] of Object.entries(value)) {
    const path = `tenantProfile.emergencyContact.${subKey}`;
    if (ALLOWED_DOTTED.has(path)) $set[path] = subVal;
  }
  continue;
}
```

Better — generalize: any top-level object value, walk its entries, check against `ALLOWED_DOTTED` with `<key>.<subKey>` and `tenantProfile.<key>.<subKey>` prefixes. Test coverage in `profile.test.js` § "nested-object payload"।

---

### EC-02: Trust score never persisted to DB

**What:** `PATCH /me` controller computes `trustScore` after the update and attaches it to the **response object** (`user.trustScore = trust.score`)। But `.lean()` was called → `user` is a plain JS object, never written back to MongoDB। So:
- API consumers (other routes, admin dashboard, listing search filters by tier) read the **stored** value, never updated since signup
- Frontend refresh-এ correct value আসে (PATCH response), কিন্তু other consumers stale

**Why:** Code computes-and-attaches but skips a write. Likely an oversight — performance reasons (avoid 2nd write) but breaks consistency.

**Fix:** Two options:

**Option A (preferred):** Persist trust score in same write:
```javascript
// Compute trust score BEFORE the update — but we need the post-update doc
// for accurate computation. So: do the $set, then a second targeted $set.
const user = await User.findByIdAndUpdate(userId, { $set }, { new: true });
const trust = computeTrustScore(user);
await User.updateOne(
  { _id: userId },
  { $set: { trustScore: trust.score, trustTier: trust.tier } },
);
user.trustScore = trust.score;
user.trustTier  = trust.tier;
```

**Option B:** Pre/post save hook on User schema that recomputes on any modify. Cleaner but harder to opt out of in batch operations:
```javascript
// models/User.js
userSchema.pre('save', function (next) {
  if (this.isModified()) {
    const trust = computeTrustScore(this);
    this.trustScore = trust.score;
    this.trustTier  = trust.tier;
  }
  next();
});
```

Pick Option A — explicit, doesn't risk surprising future maintainers.

---

### EC-03: `workPlaceId` orphaned when free-form `workPlace` typed later

**What:** User picks "BRAC University" from the autocomplete → backend stores `workPlace: "BRAC University", workPlaceId: "biust"`. Later user edits the field manually, types "My freelance business". `workPlace` updates to "My freelance business" but `workPlaceId` still says `"biust"`. Analytics group this user under BRAC University forever.

**Why:** WorkplaceAutocomplete-এ `onSelect` sets both fields; manual edit only fires `onChange` which sets only `workPlace`. The parent's `patch({ 'tenantProfile.workPlace': v })` never clears `workPlaceId`.

**Fix:** Frontend — InlineField's save handler for workplace field should clear `workPlaceId` UNLESS the editor's `onSelect` fired in this edit session. Simplest:

```jsx
// In ProfileSection.jsx, the workplace renderField branch:
renderEditor={(p) => (
  <WorkplaceAutocomplete
    value={p.value}
    onChange={p.onChange}
    onCommit={(committedValue, matchedWorkplace) => {
      // If user picked a known workplace via the dropdown, save BOTH.
      // If they typed free-form (matchedWorkplace is null/undefined),
      // save the text and explicitly null the workPlaceId.
      if (matchedWorkplace) {
        handleFieldSave(field, committedValue);
        handleFieldSave(
          { key: 'workPlaceId', path: ['workPlaceId'] },
          matchedWorkplace.id,
        );
      } else {
        handleFieldSave(field, committedValue);
        handleFieldSave({ key: 'workPlaceId', path: ['workPlaceId'] }, '');
      }
      p.onCommit?.(committedValue);
    }}
    onCancel={p.onCancel}
    inputRef={p.inputRef}
    language={language}
  />
)}
```

Two PATCH calls in quick succession is OK — the controller's `$set` is atomic per call, and the second call's response carries the final state. Alternative: send one combined patch `{ workPlace, workPlaceId }` from the save handler — needs InlineField to support multi-key save (not currently designed for it).

---

### EC-04: Cross-account leak via landlord localStorage (Session-3 regression)

**What:** `authService.purgeTenantProfileCaches()` purges keys matching `tolet_tenant_profile:*`. HostDashboard_PATCH §2 introduced `tolet_landlord_profile:<uid>` keys. On logout/login flow, **landlord caches are NOT purged**. Account A logs out, Account B logs in on same browser → B's dashboard hydrates from A's localStorage → sees A's `preferredTenants`, `address`, etc.

**Why:** Session 1's purge function was hardcoded to one prefix; Session 3 added a parallel prefix without updating the purge list.

**Fix:** Generalize `authService.js`:

```javascript
// authService.js — replace purgeTenantProfileCaches with a multi-prefix
// version. Order matters: keep adding new prefixes here whenever a new
// per-user cache key is introduced anywhere in the app.
const USER_SCOPED_CACHE_PREFIXES = [
  'tolet_tenant_profile:',
  'tolet_landlord_profile:',
  // Add here when new dashboards add per-user caches.
];
const LEGACY_GLOBAL_KEYS = [
  'tolet_tenant_profile',
  'userName',
  'userPhone',
];

function purgeUserScopedCaches() {
  try {
    LEGACY_GLOBAL_KEYS.forEach((k) => localStorage.removeItem(k));
    const toDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && USER_SCOPED_CACHE_PREFIXES.some((p) => k.startsWith(p))) {
        toDelete.push(k);
      }
    }
    toDelete.forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}
```

Rename function (the old name leaks "tenant" semantics). Replace 3 call sites: `signupVerify`, `loginWithPassword`, `logout`.

---

### EC-05: `serviceCharge` empty string silently saves as 0

**What:** Landlord opens edit on Service Charge, accidentally blurs without typing → `value = ''`. Frontend validator: `!isNaN('') && Number('') >= 0` → both true → validates as OK → fires PATCH with `serviceCharge: ''`. Mongoose coerces `''` to `0`. User now has serviceCharge=0 ("there is no service charge") instead of "unanswered". Their trust score jumps +10 they didn't earn.

**Why:** Validator uses `!isNaN(v)`. `isNaN('') === false` because `Number('') === 0`. Empty-string-as-zero is a classic JS footgun.

**Fix:** Validator:

```javascript
// utils/validators.js
serviceCharge: (v) => {
  // Reject empty / whitespace-only as "not answered". A user wanting
  // to record "no service charge" must actually type 0.
  const s = String(v ?? '').trim();
  if (s === '') return {
    ok: false,
    msg: { bn: 'টাকার পরিমাণ লিখুন (০ বা তার বেশি)', en: 'Enter an amount (0 or more)' },
  };
  const n = Number(s);
  return {
    ok: Number.isFinite(n) && n >= 0 && n <= 100000,
    msg: { bn: '০ থেকে ১,০০,০০০ টাকার মধ্যে', en: 'Between 0 and 100,000 BDT' },
  };
},
```

Backend: also add a guard in the controller — if frontend ever bypasses validation, don't accept empty string for a Number field:

```javascript
if (key === 'landlordProfile.serviceCharge' || key === 'serviceCharge') {
  if (value === '' || value == null) continue;  // skip, don't coerce to 0
}
```

---

## 🟠 P2 — Polish

### EC-06: Backend phone format unenforced

**What:** Mongoose schema has `phone: { type: String, maxlength: 20 }` for emergency contact. No regex. If a client bypasses the frontend validator (custom request, old web view, malicious tool), they can save `phone: "abc"` or `phone: "+8801234567890123"` (way over 11 digits). Listing-page display breaks, click-to-call fails.

**Why:** Defensive validation should sit at both layers; only frontend has it currently.

**Fix:** Schema regex matching the frontend validator:

```javascript
// models/User.js — inside tenantProfile.emergencyContact
phone: {
  type: String,
  default: '',
  trim: true,
  maxlength: 20,
  validate: {
    validator: (v) => v === '' || /^\+880\d{10}$/.test(v.replace(/\s/g, '')),
    message:   'Phone must be +880 followed by 10 digits.',
  },
},
```

Same regex for any other phone field that gets added later. Test in `profile.test.js` § "schema validation"。

---

### EC-07: Trust score formula drift (TenantDashboard local copy)

**What:** TenantDashboard.jsx line ~112 has its own `computeTrustScore` with the OLD 4-item formula (`phone +20`, `photo +20`, `nid +30`, `professionProof +30`)। Backend now uses Blueprint v2 formula (`phone +20`, `avatar +10`, `professionType +10`, `workPlace +10`, `familySize +5`, `emergencyContact.phone +15`, `nid +30`)। After a save, frontend re-renders with the backend-returned score, then `useEffect` triggers local recompute → score visibly *changes* a second time. Confusing flash.

**Why:** Two sources of truth for a derived value. Session 3's SESSION3_SETUP.md flagged this as a known caveat but didn't fix.

**Fix:** Delete the local computeTrustScore entirely. Replace TenantDashboard's usage with the server value:

```jsx
// TenantDashboard.jsx — replace the local computation
const trustScore = {
  score: user?.trustScore ?? 0,
  tier:  user?.trustTier  ?? 'bronze',
  breakdown: buildBreakdownItems(tenantProfile),  // for QuickWins, no score math
};
```

The `breakdown` array (for QuickWinsCard) doesn't need to compute totals — it just needs to know which items are `done` and what they're worth. Move the items list to a constant, keep `done` boolean flags.

Side benefit: QuickWinsCard can show "+10 more" hints without doing arithmetic that might disagree with the server.

---

### EC-08: TenantProfileFields helpers don't default chip-multi arrays

**What:** `TenantProfileFields.readFieldValue` returns `''` (empty string) for any unset field. But Tenant's chip-multi fields don't currently exist — only chip-single — so this didn't matter. **Landlord side does have chip-multi**, and `LandlordProfileFields.readFieldValue` correctly returns `[]` for those. Inconsistency: if someone later adds a chip-multi field to TENANT_FIELDS (e.g. "languages spoken"), it'll come back as `''` and ChipSelector will crash on `.includes()`.

**Why:** Subtle copy/paste evolution between the two field files.

**Fix:** Make TenantProfileFields.readFieldValue type-aware like the landlord version (already done in LandlordProfileFields)。Simply align:

```javascript
// TenantProfileFields.jsx
export function readFieldValue(profile, field) {
  const emptyDefault = field.type === 'chip-multi' ? [] : '';
  if (!profile) return emptyDefault;
  if (field.path) {
    return field.path.reduce(
      (obj, key) => (obj == null ? undefined : obj[key]),
      profile,
    ) ?? emptyDefault;
  }
  return profile[field.key] ?? emptyDefault;
}
```

Five-line change, zero behavior impact for existing fields, future-proof.

---

### EC-09: Avatar upload 5MB limit too tight for HEIC

**What:** `POST /me/avatar` uses Multer with `limits: { fileSize: 5 * 1024 * 1024 }`. Modern iPhones default to HEIC at ~6-12 MB per photo (especially "selfie with bokeh"). User taps avatar, picks gallery, gets a stock photo → 413 Payload Too Large with no Bengali message → confused.

**Why:** 5 MB was a reasonable 2020-era default; phone cameras have outgrown it.

**Fix:** Two-pronged:

1. **Bump limit** to 12 MB. Cloudinary's auto-quality transform on the receive side keeps storage cost flat:
   ```javascript
   multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } })
   ```

2. **Client-side downscale before upload** in AvatarUploader.jsx — if file > 2 MB, draw to a canvas at max 1024x1024 and re-export as JPEG quality 0.85. Cuts upload time on 4G dramatically. Use the existing `<canvas>` API, no library:

   ```jsx
   async function downscaleIfLarge(file, maxBytes = 2 * 1024 * 1024) {
     if (file.size <= maxBytes) return file;
     const img = await loadImage(file);
     const { width, height } = clampDims(img.width, img.height, 1024);
     const canvas = document.createElement('canvas');
     canvas.width = width; canvas.height = height;
     canvas.getContext('2d').drawImage(img, 0, 0, width, height);
     return new Promise((resolve) =>
       canvas.toBlob((b) => resolve(new File([b], file.name, { type: 'image/jpeg' })),
         'image/jpeg', 0.85));
   }
   ```

3. **Friendly error** when 413 happens anyway: show a Bengali toast "ছবিটা খুব বড় — ছোট ছবি বেছে নিন" instead of the generic XHR error.

---

### EC-10: Avatar publicId uses just `'avatar'` — no version bust

**What:** Avatar upload uses `publicId: 'avatar'` with `overwrite: true`. Cloudinary returns the SAME secure URL for every upload (e.g. `https://res.cloudinary.com/.../tolet-pro/avatars/<userId>/avatar.jpg`). Browser caches aggressively. User uploads new avatar → backend stores same URL → browser shows OLD photo until cache flushes.

**Why:** Cloudinary's `overwrite: true` replaces the bytes but the URL is identical — only the `version` segment changes (e.g. `v1716000000`). The User schema doesn't store the version.

**Fix:** Either include version in stored URL, or append a cache buster:

```javascript
// cloudinary.service.js — return the FULL versioned URL
return {
  // Use secureUrl which includes /v1716.../
  secureUrl: result.secure_url,        // already versioned ✓ — confirm in tests
  publicId:  result.public_id,
  version:   result.version,
  bytes:     result.bytes,
  format:    result.format,
};
```

Cloudinary's `result.secure_url` DOES include `/v<timestamp>/` by default. Verify in tests. If for some reason it doesn't on your account, fall back:

```javascript
const versioned = result.secure_url.replace(
  '/upload/',
  `/upload/v${result.version}/`,
);
```

---

### EC-11: TrustGaugeLive RAF leak on rapid score changes

**What:** Component receives a new `score` prop while a tween is in flight. `useEffect` cancels the previous RAF and starts a new one, using `displayed` as the start point. But `displayed` is captured at the time the effect runs, not at the time RAF actually fires. If the score updates super fast (e.g. 5 saves in 1 second), interim animations get jittery.

**Why:** `fromRef.current = displayed` reads the latest state — fine. But the cancellation of the previous RAF happens AFTER React batches state updates, so there's a 1-frame window where two RAFs could overlap.

**Fix:** Track a generation counter to short-circuit stale RAFs:

```jsx
const genRef = useRef(0);

useEffect(() => {
  genRef.current += 1;
  const gen = genRef.current;
  // ... tick function ...
  const tick = (ts) => {
    if (gen !== genRef.current) return;  // stale, abort
    // ... existing logic ...
  };
  rafRef.current = requestAnimationFrame(tick);
  return () => { genRef.current += 1; };  // invalidate on cleanup
}, [clamped]);
```

Low impact — current code is functionally correct, this is just smoother.

---

### EC-12: `findByIdAndUpdate` with `.lean()` skips schema hooks

**What:** PATCH /me uses `User.findByIdAndUpdate(id, { $set }, { new: true, runValidators: true }).lean()`. `runValidators` does work with findByIdAndUpdate, BUT pre/post `save` hooks DO NOT run on update operations — only `findOneAndUpdate` hooks fire. If anyone later adds a `pre('save', ...)` hook (audit logging, derived field computation, etc.), it'll silently skip on profile edits.

**Why:** Mongoose hook taxonomy is famously surprising. `save` and `update` are separate hook channels.

**Fix:** Convert to a load-modify-save pattern in the controller:

```javascript
const user = await User.findById(userId);
if (!user) return res.status(404).json({ message: 'User not found.' });

for (const [path, value] of Object.entries($set)) {
  user.set(path, value);  // Mongoose deep-set, triggers pre('save')
}
await user.save();        // runs validators + hooks

const trust = computeTrustScore(user);
user.trustScore = trust.score;
user.trustTier  = trust.tier;
await user.save();
return res.json({ user: user.toObject() });
```

Slightly slower (2 round-trips, no `.lean()`), but correct. For high-throughput endpoints this matters; for profile edits the user does ~10 per session at most.

---

## 🟡 P3 — Future / Watchlist

### EC-13: Concurrent PATCH /me races on different fields

**What:** User opens two tabs, edits "Workplace" in tab A and "Family size" in tab B simultaneously. Both PATCH /me in flight. Mongoose `$set` is atomic per-field, so workPlace and familySize don't conflict directly. But: after both writes land, both responses compute trustScore independently. Whichever response arrives last wins for the trustTier shown in that tab. Other tab still shows the older tier until refresh.

**Why:** Trust score is derived from the whole document but cached in the response. No real-time push.

**Fix (when it becomes a problem):** WebSocket / Server-Sent-Events broadcast for user-scoped changes. Subscribe the dashboard to its own user ID; any PATCH /me result rebroadcasts to all the user's tabs. For now: not worth building — the disagreement is brief and self-resolves on next save or refresh.

---

### EC-14: Migration runs against in-flight writes

**What:** Deploy the new schema. Migration script `add-landlord-profile.js` runs while users are actively patching. A user's PATCH /me lands in the middle of the migration's `updateMany` → their `landlordProfile` write gets overwritten by the migration's `{ $set: { landlordProfile: {...} } }` (the default empty doc).

**Why:** `updateMany` with `$set` overwrites unconditionally. The `$exists: false` filter prevents this MOSTLY but there's a TOCTOU window: filter checks doc has no landlordProfile, then a PATCH adds it, then the migration writes the empty default over it.

**Fix:** Use `$setOnInsert` semantics with a guard:

```javascript
// Idempotent migration — uses $exists filter on the field itself, which
// MongoDB evaluates atomically with the write. Still has a TOCTOU
// window if a write lands between filter eval and write commit, but
// that window is now <1ms vs ~ms-to-seconds for the for-each version.
await User.bulkWrite(
  users.map((u) => ({
    updateOne: {
      filter: { _id: u._id, landlordProfile: { $exists: false } },
      update: { $set: { landlordProfile: DEFAULT_LANDLORD_PROFILE } },
    },
  })),
  { ordered: false },
);
```

Better: run the migration in maintenance window with a feature flag that disables PATCH /me for the duration. See `MONITORING.md` for the runbook.

---

### EC-15: `houseRules` / `preferredTenants` array order isn't preserved meaningfully

**What:** ChipSelector keeps insertion order — first-picked appears first in the array. If the user picks Family then Bachelor, the order is `['family', 'bachelor_m']`. Later they de-select Family and re-add it — order becomes `['bachelor_m', 'family']`. Listing-page filter doesn't care about order, but if you ever want a UI like "primary preference" (first item), it's not stable.

**Why:** ChipSelector's multi-mode uses `[...selected, v]` for new adds, fine. But UI surfaces that depend on ordering need an explicit "primary" concept.

**Fix (when needed):** Add a `primaryPreferredTenant` field, or change ChipSelector multi-mode to sort-on-write by the option list's declaration order. The latter is one line:

```jsx
const next = isSelected(v)
  ? selected.filter((x) => x !== v)
  : [...selected, v].sort(
      (a, b) => options.findIndex((o) => o.value === a)
              - options.findIndex((o) => o.value === b),
    );
```

Defer until the listing-page UI actually depends on it.

---

### EC-16: `landlordProfile.fullName` desyncs from auth `user.name`

**What:** HostDashboard_PATCH §2 mirrors `userData.fullName` into `landlordProfile.fullName` via useEffect, and persists both ways. Edge: user edits fullName via ProfileSection → persistLandlordProfile sets `landlordProfile.fullName` AND `userData.fullName`. BUT the auth user `user.name` (returned by `fetchMe`) stays old until next page load. Two displayed names diverge for ~1 page-load cycle.

**Why:** `user.name` lives in auth context (from `/auth/me`), separate from `userData`. Backend stores it on `User.name` (not `landlordProfile.fullName`). PATCH /me updates `tenantProfile.fullName` / `landlordProfile.fullName` but NOT the top-level `User.name`.

**Fix:** Backend — also mirror name updates to `User.name` for any role:

```javascript
// In PATCH /me handler, after computing $set:
if ($set['tenantProfile.fullName'] || $set['landlordProfile.fullName']) {
  $set['name'] = $set['tenantProfile.fullName'] || $set['landlordProfile.fullName'];
}
```

Simple, idempotent.

---

### EC-17: `req.user.id` vs `req.user._id` confusion

**What:** Controller uses `req.user.id` (Mongoose virtual returning string). Some auth middleware sets `req.user` from JWT payload (which has `id` as ObjectId string), others attach the full Mongoose doc (which has `.id` virtual). `findByIdAndUpdate(req.user.id, ...)` works with both. But `req.user._id` only works with the Mongoose doc variant. Inconsistency if future code mixes them.

**Why:** Two valid patterns coexist in Node.js + Mongoose codebases.

**Fix:** Pick one convention and document it. In `routes/auth.js` add a comment block:

```javascript
// CONVENTION: requireAuth middleware attaches `req.user` as a plain
// object with { id: string, role: string }. NOT a Mongoose document.
// To get the doc, call `await User.findById(req.user.id)`.
```

If the middleware actually attaches the doc, prefer `req.user._id` everywhere because it's the ObjectId (faster, no virtual call). Decide and document.

---

## 📊 Edge case summary

| ID | Title | Severity | Surface | Fix effort |
|----|---|---|---|---|
| EC-01 | emergencyContact whole-object dropped | 🔴 P1 | Backend | 10 min |
| EC-02 | Trust score not persisted | 🔴 P1 | Backend | 15 min |
| EC-03 | workPlaceId orphan | 🔴 P1 | Frontend | 20 min |
| EC-04 | Landlord cache cross-account leak | 🔴 P1 | Frontend | 15 min |
| EC-05 | serviceCharge empty → 0 | 🔴 P1 | F+B   | 15 min |
| EC-06 | Backend phone format unenforced | 🟠 P2 | Backend | 5 min |
| EC-07 | Trust formula drift (tenant local) | 🟠 P2 | Frontend | 30 min |
| EC-08 | Tenant chip-multi default | 🟠 P2 | Frontend | 5 min |
| EC-09 | Avatar 5MB / HEIC | 🟠 P2 | F+B    | 45 min |
| EC-10 | Avatar URL cache bust | 🟠 P2 | F+B    | 15 min |
| EC-11 | TrustGaugeLive RAF leak | 🟠 P2 | Frontend | 10 min |
| EC-12 | findByIdAndUpdate skips save hooks | 🟠 P2 | Backend | 20 min |
| EC-13 | Two-tab race on trust score | 🟡 P3 | Backend | — defer |
| EC-14 | Migration TOCTOU | 🟡 P3 | Ops    | 15 min |
| EC-15 | Array order semantics | 🟡 P3 | Frontend | — defer |
| EC-16 | name vs fullName desync | 🟡 P3 | Backend | 5 min |
| EC-17 | req.user.id convention | 🟡 P3 | Backend | 5 min |

**P1 total fix time: ~75 min**
**P2 total fix time: ~3 hours**
**P3 total fix time: ~25 min + 2 deferred items**

---

## 🎯 Recommended ship order

1. **Fix all P1** before staging deploy — these are user-visible breakage or security
2. **Land tests** (`tests/profile.test.js`) before fixes — proves the fix works, prevents regression
3. **Deploy to staging** + smoke test with the QA plan in `SESSION5_SETUP.md`
4. **Fix P2 in next sprint** — UX polish, ship one at a time
5. **P3 → backlog** with watch-conditions documented (when to escalate)

---

**See `profile.test.js` for runnable tests of EC-01, EC-02, EC-05, EC-06, EC-08 and the happy paths.**
