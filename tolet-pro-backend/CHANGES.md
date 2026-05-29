# TO-LET PRO — Rounds 1–4 Patch Notes

All 14 audit items from Rounds 1–3 plus the full Round 4 build (notifications + polling chat) are fixed and smoke-tested against MongoDB Atlas. Four smoke suites all pass: `test-inquiry-flow`, `test-verification-flow`, `test-moderation-flow`, `test-chat-notification-flow`.

---

## Round 1 — Inquiry pipeline (deploy-blockers)

| # | File | Change |
|---|---|---|
| A1 | `tolet-pro-backend/utils/Trustscore.js` → `trustScore.js` | Renamed; User.js imports lowercase path. Was MODULE_NOT_FOUND on Linux. |
| A4 | `tolet-pro-frontend/src/services/Propertyservice.js` | Token key `'tolet_token'` → `'auth:token'`. Landlord listings now actually reach Mongo. |
| A2 | `tolet-pro-backend/services/inquiry.service.js` | Rewrote `createInquiry()` to use the real model field names: `inquirerUserId`, `propertyOwnerId`, `msg`, `propTitle`. |
| A2 | `tolet-pro-backend/validators/inquiry.validators.js` | Validator now accepts the model's status enum `['new','active','archived','converted','rejected']` and the real payload shape (`message`, `leaseStart`, `leaseEnd`). |
| A3 | `tolet-pro-frontend/src/services/inquiryService.js` (NEW) | `createInquiry`, `getMyInquiries`, `updateInquiryStatus`. |
| A3 | `tolet-pro-frontend/src/components/InquiryModal.jsx` | Replaced 900 ms fake spinner with a real `POST /api/inquiries`. |
| A10 | `tolet-pro-frontend/src/components/HostDashboard.jsx` | Polls `/api/host/inquiries` every 20 s. |
| A12 | `tolet-pro-frontend/src/components/TenantDashboard.jsx` | Polls `/api/inquiries/mine` every 30 s. Removed all `sampleApplications` mock data. |

**Smoke test:** `scripts/test-inquiry-flow.js` — signs up a tenant, logs in, POSTs an inquiry, fetches it as host, fetches it as tenant. **PASSES.**

---

## Round 2 — Verification + privacy + ban gate

| # | File | Change |
|---|---|---|
| A6 | `tolet-pro-backend/middleware/optionalAuth.js` (NEW) | Decodes Bearer token if present, otherwise lets the request through anonymous. |
| A6 | `tolet-pro-backend/routes/tenant.routes.js` | `GET /api/tenants/:id` now uses `optionalAuth` instead of importing a non-existent file. |
| A5 | `tolet-pro-backend/controllers/landlord.controller.js` | Reads `tenantProfile.verification.status` for `idStatus`/`idVerified`, and `landlordProfile.verification.status` for `addressStatus`/`addressVerified`/`landlordVerified`. |
| A8 | `tolet-pro-backend/controllers/auth.controller.additions.js` | `addRole('landlord')` now requires `landlordProfile.verification.status === 'verified'`. `submitVerification` no longer auto-promotes to landlord. |
| A11 | `tolet-pro-backend/models/Property.js` | Status enum now includes `'paused'`. |
| A11 | `tolet-pro-backend/services/property.service.js` | Public `listProperties()` defaults `status='active'` so paused/inactive/rented listings are hidden from tenants. |
| A11 | `tolet-pro-frontend/src/components/HostDashboard.jsx` | "Pause/Unpause" and "Mark Rented" now call `propertyService.updateProperty()` so the change persists in Mongo. |
| A9 | `tolet-pro-backend/middleware/requireAuth.js` | Banned users can still GET/HEAD (so they see why they're banned), but all writes return 403 with `banReason`. |

**Smoke test:** `scripts/test-verification-flow.js` — verifies tenant identity grants `tenantVerified` but NOT the landlord role; only an admin-issued landlord verification grants it. Also asserts ban blocks writes but not reads. **PASSES.**

---

## Round 3 — Admin panel real-data wiring

| # | File | Change |
|---|---|---|
| A7 | `tolet-pro-backend/controllers/admin.controller.js` | `getOverview()` returns real counts: totalUsers, totalLandlords, totalTenants, pendingKyc, pendingLandlordKyc, bannedUsers, activeProperties, pausedProperties, rentedProperties, draftProperties, totalProperties, pendingModeration. |
| A7 | `tolet-pro-frontend/src/components/AdminOverview.jsx` | Hydrates from `getOverviewStats()` and re-polls every 60 s. No more hard-coded numbers. |
| Mod | `tolet-pro-backend/controllers/admin.controller.js` + `routes/admin.routes.js` | New endpoints: `GET /api/admin/properties` (filterable by status), `POST /api/admin/properties/:id/moderate` (action: approve / reject / remove). |
| Mod | `tolet-pro-backend/models/Property.js` | Added `moderationReason`, `moderatedAt`, `moderatedBy`. |
| Mod | `tolet-pro-frontend/src/services/adminService.js` | `listAdminProperties()`, `moderateProperty()`. |
| Mod | `tolet-pro-frontend/src/components/PropertyModeration.jsx` | Fetches real properties, filters by status tab, calls real moderation endpoints. |
| A18 | `tolet-pro-backend/utils/trustScore.js` | New `computeLandlordTrust()` (separate from tenant trust). |
| A18 | `tolet-pro-backend/models/User.js` | `pre('save')` now computes `tenantProfile.trustScore` AND `landlordProfile.trustScore` independently. |

**Smoke test:** `scripts/test-moderation-flow.js` — admin sees pending properties, approves one, lists by status, banned user can read but not POST. **PASSES.**

---

## Round 4 — Notifications + real chat (polling)

You chose option (b). Built and tested.

### Backend

| File | Purpose |
|---|---|
| `models/Notification.js` (NEW) | Per-user notifications with type enum `inquiry_new` / `inquiry_status` / `message_new` / `system`. Index on `(userId, read, createdAt)`. |
| `models/Conversation.js` (NEW) | 1-to-1 chat thread. Sorted `participants: [ObjectId, ObjectId]` for deterministic lookup. `lastMessageText`, `lastMessageAt`, `lastSenderId`, `unreadCounts: Map<userIdString, count>`. Optional `propertyId` + `inquiryId`. |
| `models/Message.js` (NEW) | Single message in a conversation. Index `(conversationId, createdAt)`. `readBy[]` for ticks. |
| `services/notification.service.js` (NEW) | `emit()`, `listForUser()`, `countUnread()`, `markRead()`, `markAllRead()`. All emits are fire-and-forget — never block the primary action. |
| `services/chat.service.js` (NEW) | `openConversation()` (idempotent on sorted participants + property), `listConversations()` (hydrates peer name/avatar/roles + my unread count), `listMessages()` (supports `?since=<iso>` for delta polling), `sendMessage()` (writes msg → bumps `lastMessage*` + peer's `unreadCounts` → fires `message_new` notif), `markRead()` (zeroes my unread, sets `readBy` on all unread msgs). |
| `services/inquiry.service.js` (Mod) | `createInquiry()` now emits `inquiry_new` to the property owner. `updateInquiryStatus()` emits `inquiry_status` to the tenant. |
| `controllers/notification.controller.js` (NEW), `controllers/chat.controller.js` (NEW) | Thin wrappers around the services. |
| `routes/notification.routes.js` (NEW) | `GET /api/notifications`, `GET /api/notifications/unread-count`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`. |
| `routes/chat.routes.js` (NEW) | `GET /api/conversations`, `POST /api/conversations/open`, `GET /api/conversations/:id/messages?since=`, `POST /api/conversations/:id/messages`, `POST /api/conversations/:id/read`. |
| `server.js` (Mod) | Both route files mounted. |

### Frontend

| File | Purpose |
|---|---|
| `src/services/notificationService.js` (NEW) | `listNotifications()`, `getUnreadCount()`, `markRead()`, `markAllRead()`. |
| `src/services/chatService.js` (NEW) | `listConversations()`, `openConversation({peerUserId, propertyId})`, `listMessages(id, {since})`, `sendMessage(id, text)`, `markRead(id)`. |
| `src/components/NotificationBell.jsx` (NEW) | Header bell with unread badge. Polls `/api/notifications/unread-count` every 15s. Click → dropdown panel with the latest 20 notifications; deep-links by type (message → /messages, inquiry_new → host dashboard, inquiry_status → tenant dashboard). |
| `src/components/Navbar.jsx` (Mod) | Renders `<NotificationBell />` on both desktop and mobile when authed. |
| `src/components/ChatSystem.jsx` (Mod) | localStorage chat history retired. AI bot stays local; every other thread is a real backend conversation. On mount, fetches `/api/conversations` and re-polls every 15s. On active-thread change, does an initial `/messages` fetch then a 5s delta poll using `?since=<latest iso>`. Outgoing messages go optimistic → `POST /messages` → reconciled. `markRead` is called on open and after every new batch. |
| `src/components/PropertyDetails.jsx` (Mod) | "Contact Host" and "Call" CTAs now pass `{ peerUserId: landlord.id, propertyId }` so ChatSystem can open the real conversation. |
| `src/components/HostDashboard.jsx` (Mod) | Inquiry "Message" CTA now passes `{ peerUserId: inquiry.inquirerUserId, propertyId }` to open a backend thread instead of a localStorage one. |

### Polling cadence

| Surface | Endpoint | Interval |
|---|---|---|
| Header bell | `GET /api/notifications/unread-count` | 15s |
| Chat sidebar | `GET /api/conversations` | 15s |
| Active thread | `GET /api/conversations/:id/messages?since=` | 5s |

### Smoke test

`scripts/test-chat-notification-flow.js`:
1. Tenant POSTs an inquiry → landlord receives `inquiry_new` notification.
2. Landlord PATCHes status → tenant receives `inquiry_status` notification.
3. Tenant opens conversation with landlord → idempotent (reopen returns same id).
4. Tenant sends a message → landlord sidebar shows it with `unread === 1`.
5. Future-`since` delta returns empty (correct behavior).
6. Landlord fetches messages → 1 visible.
7. Landlord `POST /read` → unread → 0.
8. Landlord replies → tenant receives `message_new` notification.
9. Tenant lists notifications, marks one read → unread count drops by 1.
10. `read-all` → unread count → 0.

**Result:** all 13 assertions PASS. Full output in stdout when you run `node scripts/test-chat-notification-flow.js` (backend must be running).

---

## Other things you should do before launch (NOT in this patch)

1. **Rotate secrets.** Your committed `.env` leaked the Mongo password, JWT secret, Firebase service-account key, and Cloudinary API secret. I added `.env` to `.gitignore` and created `.env.example` files — you must:
   - Change Mongo Atlas password.
   - Generate a new `JWT_SECRET` (`openssl rand -hex 32`).
   - Revoke the Firebase service-account key in GCP IAM and create a new one.
   - Regenerate the Cloudinary API secret.
2. **Delete fake/seed data.** I didn't touch this. There's still sample data in `tolet-pro-backend/scripts/` and in some collections. Tell me when you want me to do this; I'll write a `cleanup-seed.js` you can run once.
3. **Move from `192.168.31.74` to a real domain** in both `.env` and CORS_ORIGINS.
4. **Pre-launch checklist** (separate file `LAUNCH_CHECKLIST.md` I can write if you want).
