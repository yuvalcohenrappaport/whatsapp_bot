# Roadmap: WhatsApp Bot

## Milestones

- [x] **v1.0 Foundation** — Phases 1-3 (shipped 2026-02-22) — [archive](milestones/v1.1-ROADMAP.md)
- [x] **v1.1 Dashboard & Groups** — Phases 6-9 (shipped 2026-02-24) — [archive](milestones/v1.1-ROADMAP.md)
- [x] **v1.2 Group Auto-Response** — Phases 10-11 (shipped 2026-02-25) — [archive](milestones/v1.2-ROADMAP.md)
- [x] **v1.3 Voice Responses** — Phases 12-16 (shipped 2026-03-02)
- [x] **v1.4 Travel Agent** — Phases 17-21 (shipped 2026-03-02) — [archive](milestones/v1.4-ROADMAP.md)
- [x] **v1.5 Personal Assistant** — Phases 22-26 (shipped 2026-03-16)
- [x] **v1.6 Scheduled Replies** — Phases 27-32 (shipped 2026-03-30)
- [x] **v1.7 LinkedIn Bot Dashboard Integration** — Phases 33-38 (shipped 2026-04-17)
- [x] **v1.8 Task Approval & Context Enrichment** — Phases 39-43 (shipped 2026-04-20) — [archive](milestones/v1.8-ROADMAP.md)
- [ ] **v1.9 Dashboard Expansion** — Phases 44-49 (Phase 44 shipped 2026-04-20 as seed; planned 2026-04-20)

## Phases

<details>
<summary>v1.0 Foundation (Phases 1-3) — SHIPPED 2026-02-22</summary>

- [x] Phase 1: WhatsApp Foundation (3/3 plans) — completed 2026-02-22
- [x] Phase 2: AI Response Engine (3/3 plans) — completed 2026-02-22
- [x] Phase 3: Style Learning and Auto Mode (3/3 plans) — completed 2026-02-22

</details>

<details>
<summary>v1.1 Dashboard & Groups (Phases 6-9) — SHIPPED 2026-02-24</summary>

- [x] Phase 6: Web Dashboard (4/4 plans) — completed 2026-02-23
- [x] Phase 7: CLI Dashboard (3/3 plans) — completed 2026-02-23
- [x] Phase 8: Group Monitoring and Calendar (4/4 plans) — completed 2026-02-23
- [x] Phase 9: Travel Search (2/2 plans) — completed 2026-02-24

</details>

<details>
<summary>v1.2 Group Auto-Response (Phases 10-11) — SHIPPED 2026-02-25</summary>

- [x] Phase 10: Keyword Rules and Auto-Response Pipeline (2/2 plans) — completed 2026-02-24
- [x] Phase 11: Dashboard Rule Management (2/2 plans) — completed 2026-02-24

</details>

<details>
<summary>v1.3 Voice Responses (Phases 12-16) — SHIPPED 2026-03-02</summary>

- [x] Phase 12: Voice Infrastructure (3/3 plans) — completed 2026-03-01
- [x] Phase 13: Voice Service Modules (2/2 plans) — completed 2026-03-01
- [x] Phase 14: Core Voice Pipeline (2/2 plans) — completed 2026-03-01
- [x] Phase 15: Draft Queue Voice Integration (1/1 plans) — completed 2026-03-02
- [x] Phase 16: Voice Settings Management (1/1 plans) — completed 2026-03-02

</details>

<details>
<summary>v1.4 Travel Agent (Phases 17-21) — SHIPPED 2026-03-02</summary>

- [x] Phase 17: Pipeline Audit (2/2 plans) — completed 2026-03-02
- [x] Phase 18: Trip Memory (3/3 plans) — completed 2026-03-02
- [x] Phase 19: Itinerary Builder (3/3 plans) — completed 2026-03-02
- [x] Phase 20: Enriched Search (2/2 plans) — completed 2026-03-02
- [x] Phase 21: Travel Intelligence (2/2 plans) — completed 2026-03-02

</details>

<details>
<summary>v1.5 Personal Assistant (Phases 22-26) — SHIPPED 2026-03-16</summary>

- [x] Phase 22: Calendar Detection Refactor (2/2 plans) — completed 2026-03-16
- [x] Phase 23: Universal Calendar Detection (3/3 plans) — completed 2026-03-16
- [x] Phase 24: Smart Reminders (3/3 plans) — completed 2026-03-16
- [x] Phase 25: Commitment Detection (2/2 plans) — completed 2026-03-16
- [x] Phase 26: Microsoft To Do Sync (3/3 plans) — completed 2026-03-16

</details>

<details>
<summary>v1.6 Scheduled Replies (Phases 27-32) — SHIPPED 2026-03-30</summary>

- [x] Phase 27: DB Foundation (2/2 plans) — completed 2026-03-29
- [x] Phase 28: Core Scheduler and Text Delivery (2/2 plans) — completed 2026-03-30
- [x] Phase 29: Pre-Send Safety (2/2 plans) — completed 2026-03-30
- [x] Phase 30: Dashboard CRUD (2/2 plans) — completed 2026-03-30
- [x] Phase 31: Voice and AI Content Types (2/2 plans) — completed 2026-03-30
- [x] Phase 32: Recurring Schedules (2/2 plans) — completed 2026-03-30

</details>

<details>
<summary>v1.7 LinkedIn Bot Dashboard Integration (Phases 33-38) — SHIPPED 2026-04-17</summary>

- [x] Phase 33: pm-authority HTTP Service (5/5 plans) — completed 2026-04-13
- [x] Phase 34: Fastify Proxy Layer (4/4 plans) — completed 2026-04-13
- [x] Phase 35: LinkedIn Queue Read-Side UI (4/4 plans) — completed 2026-04-13
- [x] Phase 36: Review Actions (Write) (5/5 plans) — completed 2026-04-15
- [x] Phase 37: Lesson Mode UX (5/5 plans) — completed 2026-04-17
- [x] Phase 38: New Lesson Run Form (3/3 plans) — completed 2026-04-17

</details>

### v1.8 Task Approval & Context Enrichment (PLANNING 2026-04-19)

**Milestone Goal:** Turn commitment/task detection into a *draft → approve → sync* workflow. Detections become pending placeholders in the self-chat; the owner approves per-item; approved items push to Google Tasks with an LLM-enriched, self-contained title that uses prior conversation context and the other contact's name.

- [x] **Phase 39: Actionables Data Model & Migration** (3/3 plans) — completed 2026-04-19
- [x] **Phase 40: Unified Detection Pipeline** (3/3 plans) — completed 2026-04-19
- [x] **Phase 41: WhatsApp Approval UX** — Per-detection self-chat preview + quoted-reply approve/reject/edit grammar + 7-day auto-expiry + self-chat direct commands bypass (5/5 plans shipped, live verified on prod) (completed 2026-04-19)
- [x] **Phase 42: Context Enrichment at Approval** — Gemini second pass with last ~10 chat messages produces self-contained Google Tasks title + rich note at approval time; safe fallback on enrichment failure (completed 2026-04-20)
- [x] **Phase 43: Dashboard Pending Tasks View** — Read-only dashboard page for auditing pending + recent approved/rejected/expired actionables (completed 2026-04-20)
- [x] **Phase 44: Unified Editable Calendar** — /calendar surface merging tasks + personal events + LinkedIn posts with drag-reschedule, inline title edit, create-from-slot popover, delete-with-undo, SSE live sync, month/week/day views (completed 2026-04-20 — v1.9 seed)
- [ ] **Phase 45: Dashboard Pending-Tasks Write Actions** — Approve/Reject/Edit buttons on /pending-tasks page, routed through the Phase 41 `approvalHandler` with Phase 42 Gemini enrichment
- [ ] **Phase 46: Google Tasks Full-List Sync** — Pull all owner's Google Tasks lists into the unified calendar with per-list color + sidebar filter; de-dup against actionables
- [ ] **Phase 47: Google Calendar Events Sync** — Pull all owner's Google Calendar events into the unified calendar (read-only); de-dup against personal_pending_events; sidebar filter mechanism extends to gcal
- [ ] **Phase 48: LinkedIn Post Composer (Dashboard)** — "New Post" action on /linkedin queue page that composes via pm-authority's POST /v1/posts and returns the post in PENDING_REVIEW
- [ ] **Phase 49: Deploy + Verify + Close v1.9** — PM2 redeploy both services, dashboard bundle ship, owner walkthrough on all new requirements, milestone closeout

## Phase Details

### Phase 39: Actionables Data Model & Migration
**Goal**: A unified `actionables` table exists with the full lifecycle schema, and in-flight pending rows from the legacy `reminders(source=commitment)` and `todoTasks` surfaces are backfilled without losing Google Tasks IDs
**Depends on**: Phase 38 (v1.7 complete)
**Requirements**: ACT-01, ACT-02, MIGR-01
**Success Criteria** (what must be TRUE):
  1. An `actionables` table exists with columns for source type, source contact (JID + name), source message id + text, detected task, detected_at, status, enriched title, enriched note, todo task id / list id, approval preview message id, and timestamps
  2. A Drizzle migration applies cleanly on the existing DB, is idempotent on re-run, and adds no columns to legacy tables
  3. A backfill step migrates every pending `reminders` row with `source='commitment'` and every non-cancelled `todoTasks` row into `actionables`, preserving existing `todoTaskId`/`todoListId` pairs
  4. Status transitions are constrained to the lifecycle `pending_approval → approved → fired` (plus `rejected` / `expired` terminals) via a runtime check or typed helper
  5. A query layer exposes `createActionable`, `getActionableById`, `getPendingActionables`, `getExpiredActionables`, `updateActionableStatus`, `updateActionableEnrichment`, and `updateActionableTodoIds` with correct TypeScript types

### Phase 40: Unified Detection Pipeline
**Goal**: Detection in private chats produces exactly one `pending_approval` actionable per item and no Google Tasks entries, replacing the parallel `commitments → reminders` and `commitments → todoTasks` writes with a single pipeline
**Depends on**: Phase 39
**Requirements**: DETC-01, DETC-02, MIGR-02
**Success Criteria** (what must be TRUE):
  1. A detected commitment-type or task-type item in a private chat inserts exactly one row into `actionables` with status `pending_approval`
  2. No Google Tasks API call is made at detection time (verified by grep of the detection path + log audit)
  3. The legacy split in `commitmentPipeline.ts` that routes commitments to `reminders` and tasks to `todoPipeline` is retired in favor of a single write site
  4. Pre-filter, per-chat cooldown, blocklist, and incoming allowlist behaviors are preserved byte-for-byte from the prior pipeline
  5. No new rows are written to `todoTasks` after this phase ships; `reminders` continues to serve self-chat direct commands only

### Phase 41: WhatsApp Approval UX
**Goal**: The owner sees a per-detection preview in self-chat and can approve, reject, or edit via WhatsApp quoted-reply, while self-chat direct reminder commands bypass the gate and 7-day-old pending items auto-expire
**Depends on**: Phase 40
**Requirements**: APPR-01, APPR-02, APPR-03, APPR-04, APPR-05, DETC-03
**Success Criteria** (what must be TRUE):
  1. Immediately after detection, the bot sends a self-chat preview message (language-matched Hebrew or English) containing proposed task, contact name, source snippet, and detection timestamp, and records the preview message id on the actionable row
  2. A WhatsApp quoted-reply of ✅ (or `approve` / `✓` / `ok`) on the preview flips the actionable to `approved` and triggers the enrichment phase
  3. A WhatsApp quoted-reply of ❌ (or `reject` / `no` / `✗`) flips the actionable to `rejected` and the bot sends a one-line confirmation reply
  4. A WhatsApp quoted-reply of `edit: <new task>` replaces the detected task with the provided text and then runs the approval path end-to-end
  5. An hourly scan moves pending actionables older than 7 days to status `expired` without pushing anything to Google Tasks
  6. Typing `remind me to X at Y` in the owner's self-chat creates an actionable with status `approved` directly, skipping the approval preview entirely
**Plans:** 5/5 plans complete
Plans:
- [x] 41-01-PLAN.md — Preview composer + reply parser (pure TS modules; EN/HE grammar; 34/34 vitest green; see `.planning/phases/41-whatsapp-approval-ux/41-01-SUMMARY.md`)
- [x] 41-02-PLAN.md — Debounce bucket + preview sender + detectionService `interactive` gate value (18 new vitest cases green; 70/70 approval+detection suites; see `.planning/phases/41-whatsapp-approval-ux/41-02-SUMMARY.md`)
- [x] 41-03-PLAN.md — Reply handler: quoted-reply routing to approve/reject/edit (tryHandleApprovalReply + messageHandler wiring + 13 vitest cases; 65/65 approval suite green; see `.planning/phases/41-whatsapp-approval-ux/41-03-SUMMARY.md`)
- [x] 41-04-PLAN.md — Hourly 7-day expiry scan + first-boot digest + gate flip + self-chat dual-write (17 new approval vitest cases + 3 reminderService cases green; 81/81 approval suite; see `.planning/phases/41-whatsapp-approval-ux/41-04-SUMMARY.md`)
- [x] 41-05-PLAN.md — Live verification on prod (SC1-SC3 directly verified, SC2 organic, SC4+SC5 accepted via test coverage); gap-fix for baileys 7 LID self-chat mismatch (commit 3702a56) + Node 20 pin (commit f045cf9); see `.planning/phases/41-whatsapp-approval-ux/41-05-SUMMARY.md`

### Phase 42: Context Enrichment at Approval
**Goal**: On approval, a Gemini call that uses the last ~10 messages from the source chat produces a self-contained Google Tasks title plus a rich note, and Google Tasks receives the task at approval time instead of detection time
**Depends on**: Phase 41
**Requirements**: ENRI-01, ENRI-02, ENRI-03, ENRI-04
**Success Criteria** (what must be TRUE):
  1. On the `pending_approval → approved` transition, an enricher reads the most recent ~10 messages from the source chat (via the existing messages query layer) and calls Gemini with a structured output schema
  2. The resulting Google Tasks title is self-contained: includes the contact's name, includes a concrete deadline when a time was detected, and resolves pronouns / vague references from the chat context
  3. The Google Tasks note records contact name, a chat snippet, and the original trigger message text so the task is auditable from the Google Tasks UI alone
  4. Enrichment failures (Gemini error, empty response, Zod validation fail) fall back to the originally detected task plus a basic note, and the Google Tasks push still succeeds
  5. The Google Tasks entry is created at approval time (not detection time) and its `taskId` + `listId` are stored on the actionable row before the approval confirmation is sent to self-chat
**Plans:** 2/2 plans complete
Plans:
- [x] 42-01-PLAN.md — enrichmentService (Gemini + Zod + safe fallback) + approvalHandler wiring + vitest (see `.planning/phases/42-context-enrichment-at-approval/42-01-SUMMARY.md`)
- [x] 42-02-PLAN.md — Live prod verification + STATE/REQUIREMENTS/ROADMAP closeout (see `.planning/phases/42-context-enrichment-at-approval/42-02-SUMMARY.md`)

### Phase 43: Dashboard Pending Tasks View
**Goal**: A read-only dashboard page lists pending actionables and a recent-audit-trail view so the owner can audit detection quality and approval outcomes without touching WhatsApp
**Depends on**: Phase 42
**Requirements**: DASH-ACT-01, DASH-ACT-02
**Success Criteria** (what must be TRUE):
  1. A new dashboard route (e.g. `/actionables` or `/pending-tasks`) lists all `pending_approval` actionables with contact, proposed task, source snippet, detected_at, and language
  2. A second tab or section on the same page shows the most recent ~50 actionables in `approved`, `rejected`, or `expired` status with the enriched title alongside the originally detected task
  3. The page is backed by a new Fastify REST route against the `actionables` query layer, JWT-gated in the same style as existing `/api/linkedin/*` routes
  4. The view updates live via the existing SSE channel (or a minimal manual-refresh fallback) — approving something in WhatsApp causes the row to move to the audit section without a page reload
  5. The page performs no mutations — approve/reject/edit remain WhatsApp-only per the milestone scope
**Plans:** 3/3 plans complete
Plans:
- [x] 43-01-PLAN.md — Fastify REST + SSE routes for actionables (/api/actionables/pending, /recent, /stream) JWT-gated like /api/linkedin/* (see `.planning/phases/43-dashboard-pending-tasks-view/43-01-SUMMARY.md`)
- [x] 43-02-PLAN.md — /pending-tasks dashboard page: pending list + audit list + filter chips + sidebar entry + RTL/LTR mirroring + absolute IST timestamps + 300ms amber arrival flash (see `.planning/phases/43-dashboard-pending-tasks-view/43-02-SUMMARY.md`)
- [x] 43-03-PLAN.md — Live verification (PM2 restart + owner walk-through) + ROADMAP/REQUIREMENTS/STATE closeout (see `.planning/phases/43-dashboard-pending-tasks-view/43-03-SUMMARY.md`)

### Phase 27: DB Foundation
**Goal**: The scheduled_messages table exists with all columns needed by every downstream phase, and a complete query layer is ready to use
**Depends on**: Phase 26 (v1.5 complete)
**Requirements**: SCHED-02
**Success Criteria** (what must be TRUE):
  1. A scheduled_messages table exists in the DB with status, scheduledAt, cronExpression, notificationMsgId, cancelRequestedAt, sentAt, and failCount columns
  2. A Drizzle migration file applies cleanly with no errors
  3. All CRUD query functions (create, getById, getPending, updateStatus, markCancelled, incrementFailCount) are callable from TypeScript with correct types
  4. The table survives a bot restart with data intact (WAL mode, no in-memory state)
**Plans:** 2/2 plans complete
Plans:
- [ ] 27-01-PLAN.md — Schema definition, migration SQL, and journal update for both tables
- [ ] 27-02-PLAN.md — Query layer (15 CRUD functions across both tables)

### Phase 28: Core Scheduler and Text Delivery
**Goal**: A one-time plain text scheduled message fires at the correct time, survives a crash and restart, and never fires twice after a Baileys reconnect
**Depends on**: Phase 27
**Requirements**: SCHED-03, SCHED-04, TYPE-01
**Success Criteria** (what must be TRUE):
  1. A scheduled text message created in the DB fires at the specified time and is delivered via WhatsApp
  2. After a bot restart, any pending messages that were missed or near-term are rescheduled and fire correctly
  3. When Baileys reconnects, no scheduled message fires twice (dedup guard via activeTimers Map)
  4. A hung sendMessage call does not block the scheduler indefinitely (Promise.race timeout guard)
  5. A failed send writes status='failed' to the DB rather than silently dropping the message
**Plans:** 2/2 plans complete
Plans:
- [x] 28-01-PLAN.md — Window query + timer engine (scheduledMessageScheduler.ts)
- [x] 28-02-PLAN.md — Service layer, retry/recovery, and index.ts wiring

### Phase 29: Pre-Send Safety
**Goal**: The owner receives a self-chat warning before every scheduled send and can cancel it, even if PM2 restarts between the warning and the send
**Depends on**: Phase 28
**Requirements**: SAFE-01, SAFE-02, SAFE-03
**Success Criteria** (what must be TRUE):
  1. Before each scheduled send, the bot sends a self-chat notification identifying the recipient, content preview, and cancel instruction
  2. Replying to the notification with the cancel command stops the send
  3. A PM2 reload between the notification and the send does not lose the cancel state (cancel is DB-persisted, not in-memory)
  4. A send that fails is retried automatically up to 3 times via the hourly scan, with failure status visible in the DB
**Plans:** 2/2 plans complete
Plans:
- [x] 29-01-PLAN.md — Notification pipeline, cancel handler, retry notifications in service layer
- [x] 29-02-PLAN.md — Wire cancel handler into messageHandler.ts

### Phase 30: Dashboard CRUD
**Goal**: The owner can create, view, edit, and cancel scheduled messages entirely from the dashboard without touching the DB or CLI
**Depends on**: Phase 29
**Requirements**: SCHED-01, DASH-01, DASH-02, DASH-03, DASH-04, DASH-05
**Success Criteria** (what must be TRUE):
  1. The dashboard lists all scheduled messages with recipient, content preview, scheduled time, and status indicator
  2. The owner can create a scheduled message by selecting a recipient from a picker, entering content, and choosing a date/time
  3. The owner can edit the content or time of a pending scheduled message from the dashboard
  4. The owner can cancel a scheduled message from the dashboard and it no longer fires
  5. When a cron expression is entered, a human-readable description appears live next to the field (via cronstrue)
**Plans:** 2/2 plans complete
Plans:
- [ ] 30-01-PLAN.md — Fastify REST API (list, create, edit, cancel) + new DB queries + service export
- [ ] 30-02-PLAN.md — Dashboard frontend (list page, tab filters, create/edit dialog, cancel, navigation)

### Phase 31: Voice and AI Content Types
**Goal**: The owner can schedule voice notes and AI-generated messages, with content resolved at fire time rather than schedule time
**Depends on**: Phase 30
**Requirements**: TYPE-02, TYPE-03
**Success Criteria** (what must be TRUE):
  1. A scheduled message with type=voice generates a voice note via ElevenLabs TTS at fire time and delivers it as a PTT audio message
  2. A scheduled message with type=ai generates content via Gemini from the owner's prompt at fire time, using the contact's style context
  3. A TTS or Gemini timeout does not permanently block the fire callback (Promise.race with 30s limit)
  4. Concurrent TTS fires do not exceed ElevenLabs concurrency limits (p-queue with concurrency:1)
**Plans:** 1/2 plans complete
Plans:
- [x] 31-01-PLAN.md — Backend: resolveContent helper, sendVoiceWithTimeout, type-aware fireMessage dispatch, AI notification label
- [ ] 31-02-PLAN.md — Dashboard: enable Voice/AI radio buttons with dynamic textarea labels

### Phase 32: Recurring Schedules
**Goal**: The owner can schedule daily, weekly, or monthly recurring messages that re-arm automatically after each fire and survive DST transitions without drifting
**Depends on**: Phase 31
**Requirements**: SCHED-05
**Success Criteria** (what must be TRUE):
  1. A recurring scheduled message re-fires on the correct cadence (daily, weekly, or monthly) after each send
  2. The schedule does not drift by an hour across Israel's daylight saving time transitions in March and October
  3. If the bot is down during a recurring fire, the next occurrence is computed correctly on startup
  4. The owner can cancel a recurring series from the dashboard and all future fires stop
**Plans:** 2 plans
Plans:
- [x] 32-01-PLAN.md — Backend: cronUtils, re-arm logic, recovery fix, API cadence support
- [x] 32-02-PLAN.md — Dashboard: Repeat dropdown, cronstrue preview, cadence badge

### Phase 33: pm-authority HTTP Service
**Goal**: A long-running FastAPI sidecar inside pm-authority exposes read + mutate endpoints for post state, variants, and lesson candidates over 127.0.0.1, giving whatsapp-bot a stable HTTP contract to consume without ever importing Python code or touching state.db directly
**Depends on**: Phase 32 (v1.6 complete)
**Requirements**: LIN-01
**Success Criteria** (what must be TRUE):
  1. A FastAPI service in pm-authority can be started as a long-running process and binds to 127.0.0.1 only (never reachable off-box)
  2. A local HTTP GET returns posts filterable by status (DRAFT, PENDING_VARIANT, PENDING_LESSON_SELECTION, PENDING_PII_REVIEW, APPROVED, PUBLISHED) with content, variants, lesson candidates, image paths, and timestamps
  3. Local HTTP mutation endpoints (approve, reject, edit, regenerate, replace-image, pick-lesson, pick-variant, start-lesson-run) call through to pm-authority's existing ReviewManager / generate_lesson_variants / handle_select_lesson_sync / post_variant_and_generate_image_sync and return a consistent JSON result
  4. An unauthenticated request from any non-loopback origin is refused at the socket layer (binding, not middleware)
  5. Errors from pm-authority (validation, regen cap, state-machine violations) surface as structured JSON with an HTTP status code the TypeScript client can discriminate
**Plans:** 5/5 complete
- [x] 33-01-PLAN.md — Scaffold services.http package: FastAPI app + /v1/health + Pydantic schemas + error envelope + state.db WAL retry + six pre-wired empty routers + PM2 ecosystem entry (see `.planning/phases/33-pm-authority-http-service/33-01-SUMMARY.md`)
- [x] 33-02-PLAN.md — Read endpoints: GET /v1/posts list/filter + GET /v1/posts/{id} + image streaming with path-traversal guard + canonical dto_mapper.py + 13-test TestClient suite (see `.planning/phases/33-pm-authority-http-service/33-02-SUMMARY.md`)
- [x] 33-03-PLAN.md — JobTracker + state_guard + fast mutations (approve/reject/edit) + /v1/jobs/{id} polling — 22 new tests passing (see `.planning/phases/33-pm-authority-http-service/33-03-SUMMARY.md`)
- [x] 33-04-PLAN.md — Slow mutations (regenerate, pick-variant, pick-lesson, replace-image) + REAL /v1/lesson-runs call-through to PostGenerator.generate_lesson_variants — 16 new TestClient tests, 51/51 HTTP suite green, main.py untouched (see `.planning/phases/33-pm-authority-http-service/33-04-SUMMARY.md`)
- [x] 33-05-PLAN.md — End-to-end TestClient walkthrough (52/52 HTTP tests) + smoke script + README v1 route table + PM2 boot verification (live: pid 1875924, /v1/health green, 127.0.0.1:8765 loopback-only) (see `.planning/phases/33-pm-authority-http-service/33-05-SUMMARY.md`)

### Phase 34: Fastify Proxy Layer
**Goal**: whatsapp-bot's Fastify server exposes a typed, Zod-validated proxy surface that forwards every LinkedIn dashboard request to the pm-authority FastAPI service, so the frontend only ever talks to its own origin and no dashboard code has to know the Python service exists
**Depends on**: Phase 33
**Requirements**: LIN-02
**Success Criteria** (what must be TRUE):
  1. Hitting a `/api/linkedin/*` route on the whatsapp-bot server returns data sourced from the pm-authority FastAPI service with no direct SQLite access
  2. Every proxy route has a Zod request schema and a Zod response schema, and a schema mismatch produces a 500 with a descriptive error instead of leaking malformed data to the client
  3. Errors from the upstream FastAPI service (4xx, 5xx, timeouts, connection refused) are passed through to the dashboard with status code and message preserved
  4. When the FastAPI service is down, `/api/linkedin/health` returns a clear "upstream unavailable" state so the dashboard can render a degraded banner instead of spinning forever
**Plans:** 4/4 plans complete
Plans:
- [x] 34-01-PLAN.md — Foundation: Zod schemas + upstream client + error mapper + Fastify plugin scaffold + /api/linkedin/health (degraded state, SC#4) (see `.planning/phases/34-fastify-proxy-layer/34-01-SUMMARY.md`)
- [x] 34-02-PLAN.md — Read routes: posts list/get + image streaming + jobs polling (5 GET routes) (see `.planning/phases/34-fastify-proxy-layer/34-02-SUMMARY.md`)
- [x] 34-03-PLAN.md — Write routes: approve/reject/edit + regenerate/pick-variant (mixed 200/202)/pick-lesson/replace-image/lesson-runs (8 POST routes) (see `.planning/phases/34-fastify-proxy-layer/34-03-SUMMARY.md`)
- [x] 34-04-PLAN.md — Live integration smoke test against PM2-running pm-authority (auto-skip when upstream down) (see `.planning/phases/34-fastify-proxy-layer/34-04-SUMMARY.md`)

### Phase 35: LinkedIn Queue Read-Side UI
**Goal**: The owner can open the dashboard, navigate to `/linkedin/queue`, and see every pending-review post, the current publish queue status, and the recent-published history, all auto-refreshing as state changes — giving a complete read-only picture of the pm-authority pipeline before any write actions are wired up
**Depends on**: Phase 34
**Requirements**: LIN-03, LIN-04, LIN-05, LIN-06
**Success Criteria** (what must be TRUE):
  1. A `/linkedin/queue` page lists every post in DRAFT, PENDING_VARIANT, PENDING_LESSON_SELECTION, and PENDING_PII_REVIEW with a status badge, content preview, and image thumbnail
  2. A status strip on the queue page shows the next publish slot (Tue/Wed/Thu 06:30 IDT), pending count, approved count, and a preview of the last published post
  3. A recent-published history tab lists the last N published posts with published_at timestamp, clickable LinkedIn permalink, content preview, and any basic metrics available from pm-authority
  4. When a post's state changes in pm-authority (e.g. a regen completes, a variant is generated), the queue updates live over SSE without a manual page reload
**Plans:** 4/4 plans complete
- [x] 35-01-PLAN.md — Cross-repo PostDTO.analytics embed + PM2 whatsapp-bot unblocker (see `.planning/phases/35-linkedin-queue-read-side-ui/35-01-SUMMARY.md`)
- [x] 35-02-PLAN.md — Server-side SSE stream route with 3s upstream poll + sha1 dedup + 15s heartbeat + JWT-in-query-string (11 new vitest cases; 84/84 linkedin suite green) (see `.planning/phases/35-linkedin-queue-read-side-ui/35-02-SUMMARY.md`)
- [x] 35-03-PLAN.md — Dashboard primitives: LinkedInPostCard + StatusStrip + nextPublishSlot + LinkedInQueue page shell with mock wrapper (see `.planning/phases/35-linkedin-queue-read-side-ui/35-03-SUMMARY.md`)
- [x] 35-04-PLAN.md — Zod install + 3 data hooks (queue stream / published history / health) + real-data LinkedInQueue wrapper + route mount + Sidebar nav + live-verified browser checkpoint (see `.planning/phases/35-linkedin-queue-read-side-ui/35-04-SUMMARY.md`)

### Phase 36: Review Actions (Write)
**Goal**: Every per-post action the Telegram bot can perform — approve, reject, edit, regenerate, replace image — is available as a control on the dashboard queue and produces the same state transitions in pm-authority's state machine, so the owner can drive a full review cycle from the web UI end-to-end
**Depends on**: Phase 35
**Requirements**: LIN-07, LIN-08, LIN-09, LIN-10
**Success Criteria** (what must be TRUE):
  1. Per-post Approve and Reject buttons transition the post through pm-authority's state machine and the new state is reflected in the dashboard without a manual reload
  2. The owner can edit a post's content inline, with Hebrew and English sides editable separately for bilingual posts, and the edit persists across reloads
  3. Clicking Regenerate shows a live status indicator while Claude CLI runs, refuses once the existing 5-regeneration cap is reached, and replaces the preview with the new content when the run finishes
  4. The owner can drag-and-drop a replacement image onto a post card, the upload passes through the existing PENDING_PII_REVIEW gate, and the post cannot advance to APPROVED until PII review clears
**Plans:** 5/5 plans complete
- [x] 36-01-PLAN.md — Foundation: cross-repo upload-image + confirm-pii endpoints, DashboardPostSchema drift fix, LinkedInPostCard slot props (see `.planning/phases/36-review-actions-write/36-01-SUMMARY.md`)
- [x] 36-02-PLAN.md — Approve / Reject / Edit dashboard UX with optimistic updates + EditPostDialog (tabs, rtl/ltr) (see `.planning/phases/36-review-actions-write/36-02-SUMMARY.md`)
- [x] 36-03-PLAN.md — Regenerate UX: useLinkedInJob 1500ms polling + useLinkedInRegenerate + visual regen state + client-side cap (see `.planning/phases/36-review-actions-write/36-03-SUMMARY.md`)
- [x] 36-04-PLAN.md — Image replace drop zone + PENDING_PII_REVIEW gate UI + Mark PII Reviewed button (see `.planning/phases/36-review-actions-write/36-04-SUMMARY.md`)
- [x] 36-05-PLAN.md — Live E2E browser verification + STATE / ROADMAP / REQUIREMENTS updates (see `.planning/phases/36-review-actions-write/36-05-SUMMARY.md`)

### Phase 37: Lesson Mode UX
**Goal**: The owner can complete the two-phase lesson-mode review (pick 1 of 4 candidate lessons, then pick 1 of 2 full-post variants) entirely in the dashboard, with the generated fal.ai image rendered inline on variant cards — replacing the Telegram-only UX for the existing lesson-mode generation flow
**Depends on**: Phase 36
**Requirements**: LIN-11, LIN-12, LIN-13
**Success Criteria** (what must be TRUE):
  1. A PENDING_LESSON_SELECTION post shows a card list of the 4 candidate lessons with lesson text and rationale, and clicking one advances the post into the next generation step
  2. A PENDING_VARIANT post shows a side-by-side view of the 2 full-post variants with content and image prompt, and clicking one finalizes it as the chosen variant
  3. Once fal.ai image generation completes for a variant, the generated image renders inline on the variant card (replacing any earlier "file path only" placeholder) without a manual reload
**Plans:** 5/5 plans shipped — foundation (37-01), lesson selection page (37-02), variant finalization page (37-03), queue integration (37-04), live verification (37-05)
  - [x] 37-01-PLAN.md — Foundation: pm-authority DTO additions, proxy + dashboard Zod mirror, shared GenerationMetadata + StickyConfirmBar primitives, router routes with stub pages (completed 2026-04-15)
  - [x] 37-02-PLAN.md — Lesson selection page: 4-card vertical stack, focus-then-confirm, pick-lesson mutation, modal wait for variant generation, auto-navigate on success (completed 2026-04-15)
  - [x] 37-03-PLAN.md — Variant finalization page: 2-col responsive grid, focus-then-confirm, mixed 200/202 pick-variant flow, SSE-driven inline fal.ai image state (completed 2026-04-15)
  - [x] 37-04-PLAN.md — Queue integration: purple/indigo pills + 4px left stripes, PendingActionEntryButton, status strip 2 new counters, 300ms amber arrival flash (completed 2026-04-15)
  - [x] 37-05-PLAN.md — Live verification: all 3 SCs observed in owner's browser walkthrough, STATE/ROADMAP/REQUIREMENTS updated (completed 2026-04-17)

### Phase 38: New Lesson Run Form
**Goal**: The owner can start a brand-new lesson-mode generation run entirely from the dashboard via a form with a project-picker, perspective, and language fields — eliminating the need to SSH into the server and run `generate.py --mode lesson` by hand
**Depends on**: Phase 37
**Requirements**: LIN-14
**Success Criteria** (what must be TRUE):
  1. A dashboard form lists all pm-authority projects in a dropdown, accepts perspective and language inputs, and submits to a proxy route that kicks off a lesson-mode run in pm-authority
  2. After submission, the new run appears in the queue in its initial state within seconds and progresses through PENDING_LESSON_SELECTION as generation advances
  3. Validation errors (missing project, unsupported language, generator busy) are surfaced inline on the form instead of as opaque 500s
  4. The SSH + `generate.py --mode lesson` CLI workflow is no longer required for the owner's normal lesson-mode usage (CLI still works as an escape hatch)
**Plans:** 3/3 plans complete
Plans:
- [x] 38-01-PLAN.md — Cross-repo backend: GET /v1/projects + POST /v1/lesson-runs/generate + proxy routes (completed 2026-04-17)
- [x] 38-02-PLAN.md — Dashboard form: NewLessonRunSheet slide-out with project picker, perspective/language radios, topic hint, submit/retry UX (completed 2026-04-17)
- [x] 38-03-PLAN.md — Live E2E browser verification + STATE/ROADMAP/REQUIREMENTS updates (completed 2026-04-17)

## Progress

**Execution Order:**
Phases execute in numeric order: 27 → 28 → 29 → 30 → 31 → 32 → 33 → 34 → 35 → 36 → 37 → 38

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. WhatsApp Foundation | v1.0 | 3/3 | Complete | 2026-02-22 |
| 2. AI Response Engine | v1.0 | 3/3 | Complete | 2026-02-22 |
| 3. Style Learning | v1.0 | 3/3 | Complete | 2026-02-22 |
| 6. Web Dashboard | v1.1 | 4/4 | Complete | 2026-02-23 |
| 7. CLI Dashboard | v1.1 | 3/3 | Complete | 2026-02-23 |
| 8. Group Monitoring & Calendar | v1.1 | 4/4 | Complete | 2026-02-23 |
| 9. Travel Search | v1.1 | 2/2 | Complete | 2026-02-24 |
| 10. Keyword Rules & Pipeline | v1.2 | 2/2 | Complete | 2026-02-24 |
| 11. Dashboard Rule Management | v1.2 | 2/2 | Complete | 2026-02-24 |
| 12. Voice Infrastructure | v1.3 | 3/3 | Complete | 2026-03-01 |
| 13. Voice Service Modules | v1.3 | 2/2 | Complete | 2026-03-01 |
| 14. Core Voice Pipeline | v1.3 | 2/2 | Complete | 2026-03-01 |
| 15. Draft Queue Voice Integration | v1.3 | 1/1 | Complete | 2026-03-02 |
| 16. Voice Settings Management | v1.3 | 1/1 | Complete | 2026-03-02 |
| 17. Pipeline Audit | v1.4 | 2/2 | Complete | 2026-03-02 |
| 18. Trip Memory | v1.4 | 3/3 | Complete | 2026-03-02 |
| 19. Itinerary Builder | v1.4 | 3/3 | Complete | 2026-03-02 |
| 20. Enriched Search | v1.4 | 2/2 | Complete | 2026-03-02 |
| 21. Travel Intelligence | v1.4 | 2/2 | Complete | 2026-03-02 |
| 22. Calendar Detection Refactor | v1.5 | 2/2 | Complete | 2026-03-16 |
| 23. Universal Calendar Detection | v1.5 | 3/3 | Complete | 2026-03-16 |
| 24. Smart Reminders | v1.5 | 3/3 | Complete | 2026-03-16 |
| 25. Commitment Detection | v1.5 | 2/2 | Complete | 2026-03-16 |
| 26. Microsoft To Do Sync | v1.5 | 3/3 | Complete | 2026-03-16 |
| 27. DB Foundation | v1.6 | 2/2 | Complete | 2026-03-30 |
| 28. Core Scheduler and Text Delivery | v1.6 | 2/2 | Complete | 2026-03-30 |
| 29. Pre-Send Safety | v1.6 | 2/2 | Complete | 2026-03-30 |
| 30. Dashboard CRUD | v1.6 | 2/2 | Complete | 2026-03-30 |
| 31. Voice and AI Content Types | v1.6 | 2/2 | Complete | 2026-03-30 |
| 32. Recurring Schedules | v1.6 | 2/2 | Complete | 2026-03-30 |
| 33. pm-authority HTTP Service | v1.7 | 5/5 | Complete | 2026-04-13 |
| 34. Fastify Proxy Layer | v1.7 | 4/4 | Complete | 2026-04-13 |
| 35. LinkedIn Queue Read-Side UI | v1.7 | 4/4 | Complete | 2026-04-13 |
| 36. Review Actions (Write) | v1.7 | 5/5 | Complete | 2026-04-15 |
| 37. Lesson Mode UX | v1.7 | 5/5 | Complete | 2026-04-17 |
| 38. New Lesson Run Form | v1.7 | 3/3 | Complete | 2026-04-17 |
| 39. Actionables Data Model & Migration | v1.8 | 3/3 | Complete | 2026-04-19 |
| 40. Unified Detection Pipeline | v1.8 | 3/3 | Complete | 2026-04-19 |
| 41. WhatsApp Approval UX | v1.8 | 5/5 | Complete | 2026-04-19 |
| 42. Context Enrichment at Approval | v1.8 | 2/2 | Complete | 2026-04-20 |
| 43. Dashboard Pending Tasks View | v1.8 | 3/3 | Complete | 2026-04-20 |
| 44. Unified Editable Calendar | v1.9 | 6/6 | Complete | 2026-04-20 |
| 45. Dashboard Pending-Tasks Write Actions | 3/4 | In Progress|  | — |
| 46. Google Tasks Full-List Sync | v1.9 | 0/? | Not started | — |
| 47. Google Calendar Events Sync | v1.9 | 0/? | Not started | — |
| 48. LinkedIn Post Composer (Dashboard) | v1.9 | 0/? | Not started | — |
| 49. Deploy + Verify + Close v1.9 | v1.9 | 0/? | Not started | — |

### Phase 45: Dashboard Pending-Tasks Write Actions

**Goal:** The dashboard `/pending-tasks` page exposes Approve / Reject / Edit buttons per pending actionable row, routed through the Phase 41 `approvalHandler` so the outcome is identical to a WhatsApp quoted-reply — including Phase 42 Gemini enrichment and Google Tasks sync on approve.
**Depends on:** Phase 43 (pending-tasks read surface)
**Requirements:** DASH-APP-01, DASH-APP-02, DASH-APP-03
**Success Criteria:**
  1. Each `status='pending_approval'` row renders Approve + Reject + Edit controls
  2. Approve button triggers `approveAndSync` (Phase 42 enrichment + createTodoTask), row flips to `approved` in SSE within 3s
  3. Reject button flips to `rejected`, row disappears from pending list
  4. Edit opens an inline editor; save rewrites `task` then falls through to Approve
  5. All write routes JWT-gated and idempotent against concurrent WhatsApp replies on the same row

**Plans:** 3/4 plans executed

Plans:
- [x] 45-01-PLAN.md — Extract approve/reject primitives + unreject transition (backend refactor, no behavior drift) (see `.planning/phases/45-dashboard-pending-tasks-write-actions/45-01-SUMMARY.md`)
- [x] 45-02-PLAN.md — Four POST write routes on /api/actionables/:id/{approve,reject,edit,unreject} with race-arbitrated 409 `already_handled` (see `.planning/phases/45-dashboard-pending-tasks-write-actions/45-02-SUMMARY.md`)
- [x] 45-03-PLAN.md — Dashboard Approve/Reject/Edit buttons, inline edit card-morph, optimistic removal, 5s Reject Undo toast (see `.planning/phases/45-dashboard-pending-tasks-write-actions/45-03-SUMMARY.md`)
- [ ] 45-04-PLAN.md — Live verification + owner walkthrough of all 5 SCs + ROADMAP/REQUIREMENTS/STATE closeout

### Phase 46: Google Tasks Full-List Sync

**Goal:** Every Google Tasks list the owner maintains (not just the one configured for bot-driven task sync) appears in the dashboard calendar, with its own color stripe and a sidebar filter to toggle visibility per list.
**Depends on:** Phase 44 (unified calendar surface)
**Requirements:** GTASKS-01..05
**Success Criteria:**
  1. `GET /api/google-tasks/lists` returns the owner's task lists; `GET /api/google-tasks/items?from&to` returns CalendarItems for every list in window
  2. Unified aggregator + SSE stream include gtasks; per-source failure isolated from other sources
  3. Calendar page shows gtasks pills with stable per-list color (hash→palette)
  4. Sidebar filter panel lets owner toggle each list on/off; preference persisted to localStorage
  5. Google Tasks rows already mirrored into `actionables` (matching `todoTaskId`) render once — from the `actionables` row; gtasks payload drops the duplicate

### Phase 47: Google Calendar Events Sync

**Goal:** Every Google Calendar event the owner has access to (owned or writer role) appears in the dashboard calendar read-only, with its own color stripe and sidebar filter. Bot-detected events already in `personal_pending_events` take precedence (de-dup via calendar_event_id).
**Depends on:** Phase 44 (unified calendar surface), Phase 46 (sidebar filter mechanism established)
**Requirements:** GCAL-01..06
**Success Criteria:**
  1. `GET /api/google-calendar/calendars` lists calendars; `GET /api/google-calendar/events?from&to` returns CalendarItems in window across all owned/writable calendars
  2. Recurring events expanded via `singleEvents: true`; all-day events carry `isAllDay: true`
  3. Unified aggregator + SSE stream include gcal with partial-failure tolerance
  4. Sidebar filter extends to gcal calendars
  5. A gcal event whose id matches `personal_pending_events.calendar_event_id` is dropped — the bot-owned row renders instead
  6. gcal pills are read-only — drag disabled, no inline edit, no delete

### Phase 48: LinkedIn Post Composer (Dashboard)

**Goal:** The dashboard `/linkedin` queue page gets a "New Post" action that composes a new LinkedIn post end-to-end (title, content, language, project) via pm-authority's `POST /v1/posts` endpoint through the existing Fastify proxy pattern.
**Depends on:** Phase 36 (LinkedIn proxy pattern), Phase 38 (new lesson run form as compose-dialog reference)
**Requirements:** LIN-NEW-01
**Success Criteria:**
  1. "New Post" button on the LinkedIn queue page opens a modal with all required pm-authority fields
  2. Submit POSTs to the proxy → pm-authority → new post in `PENDING_REVIEW` status
  3. SSE-refreshed queue shows the new post within 3s without reload
  4. Form validation inline; errors map via `mapUpstreamErrorToReply`

### Phase 49: Deploy + Verify + Close v1.9

**Goal:** Both PM2 services (whatsapp-bot + pm-authority-http) ship v1.9 code, the dashboard bundle deploys, and the owner walks through every new requirement against live data. ROADMAP + REQUIREMENTS + STATE + MILESTONES reflect v1.9 closure.
**Depends on:** Phases 45, 46, 47, 48
**Requirements:** VER-01
**Success Criteria:**
  1. PM2 services restarted, fresh bundle served, sanity curls green
  2. Owner walkthrough covers DASH-APP-01..03, GTASKS-01..05, GCAL-01..06, LIN-NEW-01
  3. Milestone archived via `/gsd:complete-milestone v1.9`; git tag `v1.9` created

### Phase 44: Unified Editable Calendar (Tasks + Events + LinkedIn)

**Goal:** An editable dashboard calendar view renders tasks (approved actionables / Google Tasks), personal events, and LinkedIn scheduled posts side-by-side on a single timeline — matching the visual language planned for the LinkedIn post calendar — so the owner sees every committed-to item in one place.
**Depends on:** Phase 43
**Requirements:** _TBD — define via `/gsd:discuss-phase 44` before planning_
**Success Criteria** (what must be TRUE):
  1. A new dashboard route (e.g. `/calendar`) renders a month / week / day calendar showing three overlaid sources: approved actionables (tasks with deadlines), personal events, and LinkedIn scheduled posts, each visually distinguished
  2. Drag-and-drop on any item reschedules it — the drop target's date/time persists to the source-of-truth backend (Google Tasks for tasks, personal_events table for events, pm-authority schedule for LinkedIn posts)
  3. Clicking an item opens an inline edit affordance for its title; committing the edit persists to the correct source-of-truth
  4. A "create" affordance on any empty slot lets the owner choose which type to create (task / event / LinkedIn post) and drops it on the clicked date/time
  5. Clicking the body of an existing item opens the full edit dialog (the existing dialogs from Tasks / Events / LinkedIn pages) — calendar is an entry point, not a parallel edit surface
  6. Live updates via SSE — external changes (WhatsApp approval firing a Google Task, a scheduled message firing) reflect on the calendar without reload
  7. Month / week / day view toggle; week is the default landing view

**Plans:** 5/6 plans complete

Plans:
- [ ] 44-01-PLAN.md — pm-authority POST /v1/posts/:id/reschedule + whatsapp-bot /api/linkedin/posts/:id/reschedule proxy (wave 1)
- [ ] 44-02-PLAN.md — PATCH/POST actionables + personal-events mutation routes + todoService.updateTodoTask + personalCalendarService.updatePersonalCalendarEvent + calendar_event_id column (wave 1)
- [ ] 44-03-PLAN.md — Unified /api/calendar/items + /api/calendar/stream aggregator plugin (wave 2)
- [ ] 44-04-PLAN.md — Dashboard /calendar page read-only shell: zod schemas + SSE hook + IST helpers + month/week/day views + pill component + sidebar + router (wave 3)
- [ ] 44-05-PLAN.md — Drag-to-reschedule + inline title edit + empty-slot create popover + day-overflow popover + full-dialog delegation on body click (wave 4)
- [ ] 44-06-PLAN.md — Live verification (PM2 restart + owner 11-step walkthrough mapping all 7 SCs) + ROADMAP/REQUIREMENTS/STATE closeout + v1.8 milestone close (wave 5)
