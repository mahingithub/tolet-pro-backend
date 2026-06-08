# TO-LET PRO Engineering Audit Report

Generated: 2026-06-08  
Scope: Full-stack static engineering audit  
Mode: Read-only audit report. No application code changes were made for this report.

## 1. Executive Summary

TO-LET PRO has a solid product foundation: React/Vite frontend, Express backend, MongoDB schemas, Socket.IO real-time messaging, WebRTC/Zego calling, Firebase Cloud Messaging, PWA workers, Cloudinary media, and a multi-role rental workflow.

The project is functional, but it is not production-ready for heavy real-world usage yet. The biggest risks are around call security, background call expectations on mobile, oversized property media, debug endpoints, missing validation, and long-lived frontend components that are doing too much work.

The strongest immediate improvements are:

- Remove production diagnostic/debug endpoints.
- Add strict Socket.IO authorization for all call and signaling events.
- Decide whether the production call provider is Zego-only or native WebRTC, then remove the incomplete path.
- Stop storing or returning large full-resolution property media in listing flows.
- Improve FCM token ownership, notification action handling, and service worker update strategy.
- Add focused validation, indexes, and tests around auth, calls, chat, listings, and notifications.

## 2. Overall Project Score

Score: 62 / 100

| Area | Score | Status |
| --- | ---: | --- |
| Architecture | 68 | Warning |
| Frontend maintainability | 58 | Warning |
| Backend maintainability | 65 | Warning |
| Property listing performance | 70 | Warning |
| Chat system | 63 | Warning |
| Call system | 45 | Critical |
| Push notifications / PWA | 55 | Warning |
| Security | 48 | Critical |
| Database performance | 60 | Warning |
| Production readiness | 52 | Warning |

## 3. Project Health Check

### Healthy

| Area | Evidence | Status |
| --- | --- | --- |
| Separate frontend/backend repos | `tolet-pro-frontend`, `tolet-pro-backend` | Healthy |
| Clear role-driven product model | Tenant, Landlord, Admin flows are represented across routes and UI | Healthy |
| Main integrations exist | Socket.IO, FCM, Cloudinary, MongoDB, PWA/service workers | Healthy |
| Backend syntax sweep passed | `node --check` passed across backend `.js` files | Healthy |

### Warning

| Issue | File | Location | Root Cause | Recommended Fix |
| --- | --- | --- | --- | --- |
| Very large frontend components | `tolet-pro-frontend/src/components/HostDashboard.jsx` | Whole file, about 5,531 lines | Too many responsibilities in one component | Split into data hooks, stats widgets, property list, ledger panel, and action panels |
| Very large frontend components | `tolet-pro-frontend/src/components/TenantDashboard.jsx` | Whole file, about 3,198 lines | Dashboard UI, data fetching, and business logic are tightly coupled | Extract hooks and smaller dashboard sections |
| Very large chat component | `tolet-pro-frontend/src/components/ChatSystem.jsx` | Whole file, about 2,477 lines | Conversation state, socket listeners, UI, media, and calls share one component | Split into chat state hook, message list, composer, call controls, and conversation shell |
| Very large property details component | `tolet-pro-frontend/src/components/PropertyDetails.jsx` | Whole file, about 2,335 lines | Details rendering, gallery, maps, actions, and API logic are combined | Extract gallery, map, landlord card, action bar, and detail sections |
| Duplicate or legacy call provider | `tolet-pro-frontend/src/components/callProvider.jsx` | Whole file | Old provider appears unused and differs from active call provider | Verify references, then remove or archive after tests pass |
| Likely orphaned frontend files | `tolet-pro-frontend/src/components/Footer.jsx`, `LandlordOnboardingModal.jsx`, `shared/Trustgaugelive.jsx` | Whole files | Static reference scan did not find active imports | Confirm with build and route scan before deletion |
| Dirty generated files exist | `tolet-pro-frontend/dist/*`, `.DS_Store` files | Working tree | Build artifacts and OS files are present in repo tree | Clean intentionally after confirming what should be tracked |

## 4. Critical Issues

### 4.1 Production Cloudinary Diagnostic Endpoint

Severity: Critical  
Status: Critical  
File: `tolet-pro-backend/server.js`  
Location: around line 63

Root cause:

The backend exposes a temporary Cloudinary diagnostic route guarded by a static query key. It can reveal credential metadata and detailed upload errors in production.

Risk:

An attacker who discovers the endpoint/key pattern can inspect production media configuration and diagnostic behavior.

Recommended fix:

- Remove the endpoint from production code.
- If diagnostics are still needed, move them behind admin authentication and `NODE_ENV !== "production"`.
- Never use static query keys for operational diagnostics.

### 4.2 Socket Call Lifecycle Is Not Participant-Authorized

Severity: Critical  
Status: Critical  
File: `tolet-pro-backend/socket.js`  
Location: around line 133 and following call/signaling handlers

Root cause:

Socket handlers such as `CALL_INITIATED`, `CALL_ACCEPTED`, `CALL_REJECTED`, `CALL_ENDED`, `OFFER`, `ANSWER`, and `ICE_CANDIDATE` trust client-supplied IDs.

Risk:

Users may be able to spoof call events, force-call other users, end calls they do not own, or inject signaling data into another call.

Recommended fix:

- Load the `Call` document for every lifecycle/signaling event.
- Verify `socket.userId` is either the caller or receiver.
- Verify the target user belongs to that call.
- Reject unauthorized events and log security-relevant failures.
- Add integration tests for unauthorized call accept/reject/end/signaling attempts.

### 4.3 Native WebRTC Flow Is Incomplete

Severity: Critical  
Status: Critical  
File: `tolet-pro-frontend/src/services/callProvider.js`  
Location: around line 596

Root cause:

The caller creates an SDP offer in the native WebRTC path but the production flow mainly expects Zego join behavior. `CALL_ACCEPTED` does not fully complete the native WebRTC offer/answer path.

Risk:

Calls can fail or behave differently depending on provider mode, causing runtime confusion and production call failures.

Recommended fix:

- Choose one production path:
  - Zego-only for production, or
  - complete native WebRTC signaling.
- If Zego-only, remove or disable the incomplete native branch.
- If native WebRTC remains, emit `OFFER`, handle `ANSWER`, exchange ICE candidates, and add tests for caller/receiver flows.

### 4.4 Large Media Can Be Stored Inline In MongoDB

Severity: Critical  
Status: Critical  
File: `tolet-pro-backend/models/Property.js`  
Location: around line 180

Root cause:

Property media fields such as `coverPhoto`, `roomPhotos.url`, and `videoUrl` allow large inline/base64 strings.

Risk:

Mongo documents can become very large, API responses can become slow, listing pages can overfetch media, and database reads can become expensive.

Recommended fix:

- Upload all media to Cloudinary first.
- Store only URLs, public IDs, dimensions, category metadata, and derived thumbnail URLs.
- Add server-side validation to reject base64 media payloads above a tiny threshold.
- Keep listing payloads separate from details payloads.

### 4.5 Web/PWA Cannot Provide True Native Phone Call UI

Severity: Critical product limitation  
Status: Critical  
File: `tolet-pro-frontend/public/call-notification-sw.js`  
Location: around line 83

Root cause:

Browser notifications can show actions, but they cannot create the same full-screen native incoming-call UI as Android/iOS phone calls when the app is closed or the screen is off.

Risk:

Users expect receive/reject full-screen call UI, but browser/PWA APIs cannot reliably provide it across mobile platforms.

Recommended fix:

- For true native call UX, add a native mobile layer:
  - Android: ConnectionService and full-screen intent.
  - iOS: CallKit and PushKit/VoIP push where allowed.
- For PWA/browser, keep best-effort notification actions and open the app to the call screen.
- Communicate browser limitations clearly in product planning.

## 5. High Priority Issues

### 5.1 Chat CallProvider Subscriptions Lack Cleanup

Severity: High  
Status: Warning  
File: `tolet-pro-frontend/src/components/ChatSystem.jsx`  
Location: around line 410

Root cause:

Subscription callbacks returned by the call provider are not consistently cleaned up.

Risk:

Duplicate listeners, repeated UI events, memory leaks, and multiple call popups after navigating between chats.

Recommended fix:

- Store unsubscribe callbacks returned by the call provider.
- Call them in `useEffect` cleanup.
- Add a test or manual verification path for repeated open/close chat navigation.

### 5.2 Opposite-Direction Duplicate Active Calls Are Possible

Severity: High  
Status: Warning  
File: `tolet-pro-backend/controllers/calls.controller.js`  
Location: around line 86

Root cause:

Duplicate active-call checks only verify one caller-to-receiver direction.

Risk:

Two users can initiate calls to each other at nearly the same time, creating conflicting active calls.

Recommended fix:

- Check both `(caller, receiver)` and `(receiver, caller)` while status is active/ringing/accepted.
- Consider a compound index or transactional guard.

### 5.3 Public Landlord Profile Loads Full Property Documents To Count

Severity: High  
Status: Warning  
File: `tolet-pro-backend/controllers/landlord.controller.js`  
Location: around line 42

Root cause:

The profile flow loads active property documents when it only needs a count.

Risk:

Large media-heavy documents can be loaded unnecessarily, slowing landlord profile requests.

Recommended fix:

- Use `countDocuments()`.
- If any property IDs are needed, use `.select("_id")`.

### 5.4 Property Search Uses Regex Over Large Text Fields

Severity: High  
Status: Warning  
File: `tolet-pro-backend/services/searchService.js`  
Location: around line 47

Root cause:

Regex search across fields does not effectively use MongoDB text indexes.

Risk:

Search gets slower as the property collection grows.

Recommended fix:

- Use MongoDB `$text` search where appropriate.
- Add normalized fields for city, area, type, rent range, and listing status.
- Keep regex fallback limited and indexed where possible.

### 5.5 Listing UI Fetches Too Many Properties At Once

Severity: High  
Status: Warning  
File: `tolet-pro-frontend/src/services/Propertyservice.js`  
Location: around line 291

Root cause:

Listing fetch uses a high limit and does not fully use pagination metadata from the backend.

Risk:

Users wait longer for initial listing render, especially with property images and large payloads.

Recommended fix:

- Use a smaller initial page size.
- Render the first page immediately.
- Add infinite scroll or explicit pagination.
- Keep listing payload limited to card fields and four prioritized images.

### 5.6 Hard-Coded Google Maps API Key Fallback

Severity: High  
Status: Critical security warning  
File: `tolet-pro-frontend/src/components/PropertyListing.jsx`  
Location: around line 40

Root cause:

Frontend code has a hard-coded API key fallback.

Risk:

Key exposure and quota abuse if the key is valid or reused.

Recommended fix:

- Remove hard-coded fallback.
- Require `VITE_GOOGLE_MAPS_API_KEY`.
- Restrict key by domain and API in Google Cloud Console.

### 5.7 Password Reset Token Reuse Risk

Severity: High  
Status: Warning  
File: `tolet-pro-backend/services/auth.service.js`  
Location: around line 173

Root cause:

Reset token flow relies on signed token expiry but does not clearly enforce one-time use with a stored nonce or `passwordChangedAt` check.

Risk:

Reset links may remain valid until expiry even after password change.

Recommended fix:

- Add `passwordChangedAt`.
- Add reset token version/nonce stored server-side.
- Invalidate reset tokens after successful password change.

### 5.8 Cron Billing Jobs Are Not Started

Severity: High  
Status: Warning  
File: `tolet-pro-backend/services/cron.service.js`  
Location: around line 130

Root cause:

`startCronJobs()` exists but is not imported or called from the backend entrypoint.

Risk:

Overdue bill reminders and scheduled billing automation may never run in production.

Recommended fix:

- Start cron jobs intentionally from `server.js` or a worker process.
- Ensure only one production instance runs scheduled jobs, or use a queue/lock.

### 5.9 Backend Test Path Is Stale

Severity: High  
Status: Warning  
File: `tolet-pro-backend/tests/profile.test.js`  
Location: around line 43

Root cause:

Test imports `../src/server`, but the actual server entrypoint is at repo root.

Risk:

Tests fail or are skipped, reducing confidence in backend changes.

Recommended fix:

- Export the Express app cleanly.
- Update tests to import the correct app module.
- Separate app creation from server listen side effects.

## 6. Medium Priority Issues

### 6.1 SupportTicket Index Typo

Severity: Medium  
Status: Warning  
File: `tolet-pro-backend/models/SupportTicket.js`  
Location: around lines 35 and 39

Root cause:

Schema options use `indexed: true`, which Mongoose ignores. The correct key is `index: true`.

Risk:

Ticket queries by user/status may be slower than expected.

Recommended fix:

- Change `indexed: true` to `index: true`.
- Confirm indexes with MongoDB after deployment.

### 6.2 Conversation Creation Race

Severity: Medium  
Status: Warning  
File: `tolet-pro-backend/services/chat.service.js`  
Location: around line 49

Root cause:

Conversation creation appears to use find-then-create without a unique normalized participant key.

Risk:

Two simultaneous requests can create duplicate conversations.

Recommended fix:

- Add a normalized participants key.
- Add a unique index.
- Use upsert with `$setOnInsert`.

### 6.3 Message Delta Polling Can Miss Same-Millisecond Messages

Severity: Medium  
Status: Warning  
File: `tolet-pro-frontend/src/components/ChatSystem.jsx`  
Location: around line 1505

Root cause:

Polling uses `createdAt > since`.

Risk:

Messages with the same timestamp boundary can be missed.

Recommended fix:

- Use a cursor with `(createdAt, _id)`.
- Prefer Socket.IO push for live messages and keep polling only as a fallback.

### 6.4 FCM Token Registration Can Leave Tokens Under Old Users

Severity: Medium  
Status: Warning  
File: `tolet-pro-backend/controllers/notification.controller.js`  
Location: around line 42

Root cause:

Token cleanup only pulls from the current user before adding the token.

Risk:

Shared browsers or re-login flows can leave the same FCM token attached to old users.

Recommended fix:

- Pull the incoming token from all users first.
- Add token metadata such as device type, user agent, createdAt, updatedAt, and lastSeenAt.

### 6.5 Service Worker Cache Version Is Static

Severity: Medium  
Status: Warning  
File: `tolet-pro-frontend/public/service-worker.js`  
Location: around line 22

Root cause:

`CACHE_VERSION` is static.

Risk:

Users may keep stale assets after deployments.

Recommended fix:

- Generate cache version from build/version hash.
- Ensure activation deletes old caches.
- Test update behavior after deploy.

### 6.6 Shared Request Validation Is Inconsistent

Severity: Medium  
Status: Warning  
Files: `tolet-pro-backend/routes/booking.routes.js`, `tolet-pro-backend/routes/support.routes.js`, billing-related routes

Root cause:

Some routes rely on controller-level assumptions instead of shared schema validation.

Risk:

Unexpected payloads, inconsistent errors, and security gaps.

Recommended fix:

- Add shared validation middleware using a schema library such as Zod or Joi.
- Validate body, query, and params.

## 7. Low Priority Issues

### 7.1 Production Debug Logging

Severity: Low  
Status: Warning  
File: `tolet-pro-frontend/src/services/callProvider.js`  
Location: around line 175 and other call lifecycle logs

Root cause:

Verbose console logs are left in production-facing call flow.

Risk:

Noisy console output and possible accidental exposure of call IDs or user IDs.

Recommended fix:

- Gate logs behind an environment debug flag.
- Keep warnings/errors only where useful.

### 7.2 OS Metadata Files

Severity: Low  
Status: Warning  
Files: `.DS_Store`, `tolet-pro-frontend/src/.DS_Store`, backend nested `.DS_Store` files

Root cause:

macOS metadata files are present in working directories.

Risk:

Repository noise and accidental commits.

Recommended fix:

- Add `.DS_Store` to `.gitignore`.
- Remove tracked `.DS_Store` files only after confirming ownership.

## 8. Property Listing System Audit

### Current Strengths

- Listing and details concepts are separated.
- Listing performance work already reduced card image load.
- Priority image categories are understood by the product:
  - Cover photo
  - Bedroom
  - Bathroom
  - Living room
  - Kitchen
  - Other fallback

### Main Weak Points

| Issue | File | Location | Severity | Recommended Fix |
| --- | --- | --- | --- | --- |
| Listing may still fetch too many records | `tolet-pro-frontend/src/services/Propertyservice.js` | around line 291 | High | Smaller initial page, pagination/infinite scroll |
| Backend search can scan too much | `tolet-pro-backend/services/searchService.js` | around line 47 | High | Use indexed fields and `$text` |
| Media document risk | `tolet-pro-backend/models/Property.js` | around line 180 | Critical | Store Cloudinary URLs/public IDs only |
| Landlord profile overfetch | `tolet-pro-backend/controllers/landlord.controller.js` | around line 42 | High | Replace full document load with count/select |

### Recommended Listing API Shape

The listing API should return only:

- `_id`
- title/name
- location summary
- rent/price
- property type
- bedroom/bathroom counts
- card badges/status
- landlord summary needed by the card
- exactly four prioritized card media items
- pagination metadata

The details API should return:

- Full gallery
- All descriptions
- Amenities
- Nearby data
- Full landlord/contact context
- Reviews and related expanded data

## 9. Chat System Audit

### Main Weak Points

| Issue | File | Location | Severity | Recommended Fix |
| --- | --- | --- | --- | --- |
| Subscription cleanup missing | `tolet-pro-frontend/src/components/ChatSystem.jsx` | around line 410 | High | Store and call unsubscribe functions |
| Polling can miss boundary messages | `tolet-pro-frontend/src/components/ChatSystem.jsx` | around line 1505 | Medium | Use `(createdAt, _id)` cursor |
| Conversation race | `tolet-pro-backend/services/chat.service.js` | around line 49 | Medium | Unique participant key and upsert |
| Socket delivery not fully central | `tolet-pro-backend/services/chat.service.js` | service/controller boundary | Medium | Emit socket messages consistently from server |

### Recommended Chat Improvements

- Make Socket.IO the primary live-delivery path.
- Keep HTTP polling as a fallback only.
- Add read receipt event tests.
- Add conversation uniqueness at database level.
- Add cleanup for every listener registered by Chat UI.

## 10. Call System Audit

### Main Weak Points

| Issue | File | Location | Severity | Recommended Fix |
| --- | --- | --- | --- | --- |
| Socket call event authorization missing | `tolet-pro-backend/socket.js` | around line 133 | Critical | Verify call participants for every event |
| Native WebRTC path incomplete | `tolet-pro-frontend/src/services/callProvider.js` | around line 596 | Critical | Complete native signaling or enforce Zego-only |
| Browser/PWA cannot show true native call screen | `tolet-pro-frontend/public/call-notification-sw.js` | around line 83 | Critical | Native mobile wrapper required |
| Duplicate active calls possible | `tolet-pro-backend/controllers/calls.controller.js` | around line 86 | High | Check both call directions |
| Legacy call provider exists | `tolet-pro-frontend/src/components/callProvider.jsx` | whole file | Warning | Remove after confirming unused |

### Scenario Verification

| Scenario | Expected Result | Current Risk |
| --- | --- | --- |
| App open | In-app call popup can appear | Works best in this state |
| Browser minimized | Browser notification can appear if permission/token is valid | Action handling varies by browser/platform |
| Screen off | Browser notification may appear, but full-screen call UI is not reliable | Product expectation exceeds web platform |
| PWA installed | Better app-like open behavior | Still not equivalent to native phone call UI |
| Notification Accept | Should open app and join/accept call | Needs end-to-end verification per platform |
| Notification Decline | Should reject call and notify caller | Needs robust backend action path |
| Auto-join flow | Should validate call, authenticate user, then join | Risk if event auth and provider path are incomplete |
| Missed call | Should produce a missed-call notification | Supported conceptually, needs platform verification |

## 11. FCM And Push Notification Audit

### Main Weak Points

| Issue | File | Location | Severity | Recommended Fix |
| --- | --- | --- | --- | --- |
| Token can remain assigned to old users | `tolet-pro-backend/controllers/notification.controller.js` | around line 42 | Medium | Pull token from all users before assigning |
| Browser notification is not native call UI | `tolet-pro-frontend/public/call-notification-sw.js` | notification action handlers | Critical | Use native mobile layer for real call screen |
| Service worker action path needs strict payload handling | `tolet-pro-frontend/public/firebase-messaging-sw.js`, `public/call-notification-sw.js` | notification click/action handlers | Warning | Normalize payloads and test action URLs |

### Recommended FCM Improvements

- Store token metadata: device ID, platform, browser, createdAt, updatedAt, lastSeenAt.
- Clean token from all users before assigning it to the current user.
- Handle token refresh and logout cleanup.
- Add backend notification delivery logs with redacted tokens.
- Test notification click/action behavior on Android Chrome, installed PWA, desktop Chrome, and iOS Safari/PWA.

## 12. PWA And Service Worker Audit

### Main Weak Points

| Issue | File | Location | Severity | Recommended Fix |
| --- | --- | --- | --- | --- |
| Static cache version | `tolet-pro-frontend/public/service-worker.js` | around line 22 | Medium | Use build hash/version |
| Multiple workers can create scope confusion | `public/service-worker.js`, `public/firebase-messaging-sw.js`, `public/call-notification-sw.js` | registration flow | Warning | Document scopes and registration order |
| Update behavior needs verification | frontend PWA registration flow | service worker lifecycle | Warning | Add update prompt or auto-refresh strategy |

### Recommended PWA Improvements

- Keep one primary app service worker and one Firebase messaging worker only if scopes are clear.
- Document which worker owns notificationclick.
- Version caches automatically.
- Test install/update/offline/notification flows after each production build.

## 13. Backend Audit

### Security And Reliability Issues

| Issue | File | Location | Severity | Recommended Fix |
| --- | --- | --- | --- | --- |
| Debug diagnostic route | `tolet-pro-backend/server.js` | around line 63 | Critical | Remove or admin-only non-production |
| Socket event trust | `tolet-pro-backend/socket.js` | call handlers | Critical | Authorize every event |
| Reset token reuse risk | `tolet-pro-backend/services/auth.service.js` | around line 173 | High | One-time nonce and `passwordChangedAt` |
| Missing route validation consistency | backend routes/controllers | multiple | Medium | Add shared validation middleware |
| Cron not started | `tolet-pro-backend/services/cron.service.js` | around line 130 | High | Start intentionally or remove |

### Recommended Backend Priorities

- Add centralized validation.
- Add centralized error response format.
- Add rate limits for auth, call initiation, notification registration, and media upload.
- Add authorization checks at controller and socket layers.
- Add tests for critical flows before refactors.

## 14. Database Audit

### Main Weak Points

| Issue | File | Location | Severity | Recommended Fix |
| --- | --- | --- | --- | --- |
| Large property documents | `tolet-pro-backend/models/Property.js` | media fields | Critical | Store media in Cloudinary only |
| SupportTicket index typo | `tolet-pro-backend/models/SupportTicket.js` | around lines 35 and 39 | Medium | Use `index: true` |
| Conversation uniqueness risk | chat/conversation models and service | conversation creation | Medium | Unique normalized participant key |
| Search index usage weak | `tolet-pro-backend/services/searchService.js` | around line 47 | High | Use text and structured indexes |

### Recommended Indexes To Review

- `Property`: status, city/area, type, rent, landlord/owner, createdAt.
- `Property`: text index for title/description/address if using Mongo text search.
- `Conversation`: normalized participant key unique index.
- `Message`: conversationId + createdAt + _id.
- `Call`: callerId, receiverId, status, createdAt.
- `NotificationToken`: token unique ownership or user token metadata.
- `SupportTicket`: user, status, createdAt.

## 15. Performance Audit

### Highest Impact Performance Issues

| Rank | Issue | Severity | Impact |
| ---: | --- | --- | --- |
| 1 | Large media in listing/document payloads | Critical | Slow listings, high bandwidth, DB pressure |
| 2 | Listing loads too many items initially | High | Delayed first render |
| 3 | Huge frontend components | High | More re-renders and harder optimization |
| 4 | Regex property search | High | Slow search at scale |
| 5 | Missing listener cleanup | High | Memory leaks and duplicate behavior |
| 6 | Static service worker cache | Medium | Stale app after deployment |

### Performance Recommendations

- Keep card API payloads minimal.
- Use Cloudinary thumbnail transformations for listing cards.
- Lazy load card images.
- Use pagination or infinite scroll.
- Split large components and memoize expensive subtrees only after splitting.
- Add database indexes for high-traffic filters.
- Track API response size in logs for property listing/details.

## 16. Security Recommendations

Immediate security actions:

- Remove the Cloudinary diagnostic endpoint.
- Add socket authorization for call and signaling events.
- Remove hard-coded Google Maps fallback key.
- Add rate limits to auth, calls, notification registration, and media upload.
- Add request validation middleware.
- Make reset tokens one-time use.
- Sanitize and validate uploaded media metadata.
- Restrict CORS and credentials to known production domains.

## 17. Production Readiness

Current status: Not fully production-ready.

The platform can work for controlled testing and small user groups, but real production usage can expose serious weaknesses:

- Call spoofing or call-state corruption through socket events.
- Browser/PWA limitations around call UI that users may interpret as broken calling.
- Slow property listing under larger media and larger property collections.
- Stale service worker assets after deployments.
- Notification tokens staying attached to the wrong account.
- Scheduled billing/reminder jobs not running.
- Tests not covering critical production flows.

## 18. Next Development Priorities

### Fix Immediately

1. Remove or lock down the Cloudinary diagnostic endpoint.
2. Add participant authorization to all call socket events.
3. Decide and enforce Zego-only or complete native WebRTC.
4. Remove hard-coded API key fallback.
5. Fix call/chat listener cleanup.
6. Fix FCM token ownership cleanup.

### Fix This Week

1. Move property media fully to Cloudinary URL/public ID storage.
2. Add listing/details payload separation with enforced projection.
3. Add pagination/infinite scroll to property listing.
4. Add schema validation for backend routes.
5. Fix reset-token one-time use.
6. Start or intentionally disable cron jobs.
7. Fix backend tests and add critical flow tests.

### Can Wait

1. Split huge dashboard components after critical fixes.
2. Remove confirmed orphaned files.
3. Clean console logs behind debug flags.
4. Improve service worker update prompt.
5. Add bundle analysis and deeper render profiling.

## 19. Recommended Roadmap For Next 7 Days

### Day 1: Critical Security Cleanup

- Remove Cloudinary diagnostic route.
- Remove hard-coded Google Maps fallback.
- Add rate limits to auth/call/notification endpoints.
- Add basic validation to high-risk routes.

### Day 2: Call System Hardening

- Add backend participant checks for all call socket events.
- Add active call conflict checks in both directions.
- Add tests for unauthorized accept/reject/end/signaling events.

### Day 3: Call Provider Decision

- Choose Zego-only or complete native WebRTC.
- Remove incomplete/dead call branch or finish offer/answer/candidate flow.
- Test app open, minimized, PWA installed, and notification action scenarios.

### Day 4: Listing Payload And Media

- Enforce listing projection at backend level.
- Ensure only four prioritized thumbnail images are returned for cards.
- Keep full gallery only on property details.
- Track listing API payload size before/after.

### Day 5: Chat And Notification Reliability

- Add cleanup for call/chat listeners.
- Fix FCM token reassignment across users.
- Add notification click/action tests for call accept/decline/missed call.

### Day 6: Database And Search

- Add missing indexes.
- Fix `SupportTicket` index typo.
- Replace high-cost regex search paths with indexed search.
- Add conversation uniqueness.

### Day 7: Test And Release Readiness

- Fix stale backend tests.
- Add smoke tests for auth, listings, chat, calls, notifications.
- Run frontend build and backend syntax/tests.
- Clean generated artifacts and prepare production release checklist.

## 20. Verification Performed During Audit

Backend syntax verification:

```bash
find tolet-pro-backend -type f -name '*.js' -not -path '*/node_modules/*' -print0 | xargs -0 -n1 node --check
```

Result:

- Backend JavaScript syntax check passed.

Frontend build:

- Not run during the read-only audit because the frontend build writes generated files into `dist`.

## 21. Final Recommendation

The best next engineering move is to fix the critical security and call-system issues first, then finish listing payload/media optimization, then stabilize notifications and service workers. Once those are handled, the project will be much closer to a safe production launch.
