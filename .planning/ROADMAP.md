# Roadmap: WhatsApp Bot

## Milestones

- [x] **v1.0 Foundation** — Phases 1-3 (shipped 2026-02-22) — [archive](milestones/v1.1-ROADMAP.md)
- [x] **v1.1 Dashboard & Groups** — Phases 6-9 (shipped 2026-02-24) — [archive](milestones/v1.1-ROADMAP.md)
- [x] **v1.2 Group Auto-Response** — Phases 10-11 (shipped 2026-02-25) — [archive](milestones/v1.2-ROADMAP.md)
- [x] **v1.3 Voice Responses** — Phases 12-16 (shipped 2026-03-02)
- [x] **v1.4 Travel Agent** — Phases 17-21 (shipped 2026-03-02) — [archive](milestones/v1.4-ROADMAP.md)
- [x] **v1.5 Personal Assistant** — Phases 22-26 (shipped 2026-03-16)
- [x] **v1.6 Scheduled Replies** — Phases 27-32 (shipped 2026-03-30)
- [ ] **v1.7 LinkedIn Bot Dashboard Integration** — Phases 33-38 (in progress)

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

### v1.7 LinkedIn Bot Dashboard Integration (In Progress)

**Milestone Goal:** Surface pm-authority's LinkedIn content pipeline inside the whatsapp-bot dashboard so review, approve, reject, edit, regenerate, lesson-mode pick flows, queue status, and publish history can be driven from the web UI instead of Telegram — with the Telegram bot remaining as an untouched fallback.

- [x] **Phase 33: pm-authority HTTP Service** — FastAPI sidecar binding 127.0.0.1 exposing post/variant/lesson state + mutations over localhost (completed 2026-04-13)
- [x] **Phase 34: Fastify Proxy Layer** — Typed Zod-validated proxy routes in whatsapp-bot forwarding dashboard calls to the FastAPI service (completed 2026-04-13)
- [ ] **Phase 35: LinkedIn Queue Read-Side UI** — `/linkedin/queue` page with list, status strip, recent-published tab, and SSE auto-refresh
- [ ] **Phase 36: Review Actions (Write)** — Approve/reject/edit/regenerate/replace-image per-post controls wired end-to-end
- [ ] **Phase 37: Lesson Mode UX** — Two-phase lesson picker (4 candidates → 2 variants) with inline generated fal.ai images
- [ ] **Phase 38: New Lesson Run Form** — Dashboard form to start a lesson-mode generation run, replacing the SSH + `generate.py --mode lesson` CLI workflow

## Phase Details

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
**Plans:** TBD

### Phase 36: Review Actions (Write)
**Goal**: Every per-post action the Telegram bot can perform — approve, reject, edit, regenerate, replace image — is available as a control on the dashboard queue and produces the same state transitions in pm-authority's state machine, so the owner can drive a full review cycle from the web UI end-to-end
**Depends on**: Phase 35
**Requirements**: LIN-07, LIN-08, LIN-09, LIN-10
**Success Criteria** (what must be TRUE):
  1. Per-post Approve and Reject buttons transition the post through pm-authority's state machine and the new state is reflected in the dashboard without a manual reload
  2. The owner can edit a post's content inline, with Hebrew and English sides editable separately for bilingual posts, and the edit persists across reloads
  3. Clicking Regenerate shows a live status indicator while Claude CLI runs, refuses once the existing 5-regeneration cap is reached, and replaces the preview with the new content when the run finishes
  4. The owner can drag-and-drop a replacement image onto a post card, the upload passes through the existing PENDING_PII_REVIEW gate, and the post cannot advance to APPROVED until PII review clears
**Plans:** TBD

### Phase 37: Lesson Mode UX
**Goal**: The owner can complete the two-phase lesson-mode review (pick 1 of 4 candidate lessons, then pick 1 of 2 full-post variants) entirely in the dashboard, with the generated fal.ai image rendered inline on variant cards — replacing the Telegram-only UX for the existing lesson-mode generation flow
**Depends on**: Phase 36
**Requirements**: LIN-11, LIN-12, LIN-13
**Success Criteria** (what must be TRUE):
  1. A PENDING_LESSON_SELECTION post shows a card list of the 4 candidate lessons with lesson text and rationale, and clicking one advances the post into the next generation step
  2. A PENDING_VARIANT post shows a side-by-side view of the 2 full-post variants with content and image prompt, and clicking one finalizes it as the chosen variant
  3. Once fal.ai image generation completes for a variant, the generated image renders inline on the variant card (replacing any earlier "file path only" placeholder) without a manual reload
**Plans:** TBD

### Phase 38: New Lesson Run Form
**Goal**: The owner can start a brand-new lesson-mode generation run entirely from the dashboard via a form with a project-picker, perspective, and language fields — eliminating the need to SSH into the server and run `generate.py --mode lesson` by hand
**Depends on**: Phase 37
**Requirements**: LIN-14
**Success Criteria** (what must be TRUE):
  1. A dashboard form lists all pm-authority projects in a dropdown, accepts perspective and language inputs, and submits to a proxy route that kicks off a lesson-mode run in pm-authority
  2. After submission, the new run appears in the queue in its initial state within seconds and progresses through PENDING_LESSON_SELECTION as generation advances
  3. Validation errors (missing project, unsupported language, generator busy) are surfaced inline on the form instead of as opaque 500s
  4. The SSH + `generate.py --mode lesson` CLI workflow is no longer required for the owner's normal lesson-mode usage (CLI still works as an escape hatch)
**Plans:** TBD

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
| 35. LinkedIn Queue Read-Side UI | v1.7 | 0/? | Not started | — |
| 36. Review Actions (Write) | v1.7 | 0/? | Not started | — |
| 37. Lesson Mode UX | v1.7 | 0/? | Not started | — |
| 38. New Lesson Run Form | v1.7 | 0/? | Not started | — |
