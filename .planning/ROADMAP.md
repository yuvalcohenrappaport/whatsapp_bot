# Roadmap: WhatsApp Bot

## Milestones

- [x] **v1.0 Foundation** — Phases 1-3 (shipped 2026-02-22) — [archive](milestones/v1.1-ROADMAP.md)
- [x] **v1.1 Dashboard & Groups** — Phases 6-9 (shipped 2026-02-24) — [archive](milestones/v1.1-ROADMAP.md)
- [x] **v1.2 Group Auto-Response** — Phases 10-11 (shipped 2026-02-25) — [archive](milestones/v1.2-ROADMAP.md)
- [x] **v1.3 Voice Responses** — Phases 12-16 (shipped 2026-03-02)
- [x] **v1.4 Travel Agent** — Phases 17-21 (shipped 2026-03-02) — [archive](milestones/v1.4-ROADMAP.md)
- [x] **v1.5 Personal Assistant** — Phases 22-26 (shipped 2026-03-16)
- [ ] **v1.6 Scheduled Replies** — Phases 27-32 (in progress)

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

### v1.6 Scheduled Replies (In Progress)

**Milestone Goal:** Let the owner schedule messages to any contact or group from the dashboard, with support for text, voice, and AI-generated content on one-off or recurring schedules.

- [x] **Phase 27: DB Foundation** - scheduled_messages table, migration, and query layer (completed 2026-03-29)
- [ ] **Phase 28: Core Scheduler and Text Delivery** - two-tier scheduler, one-time text send end-to-end, reconnect dedup
- [ ] **Phase 29: Pre-Send Safety** - self-chat cancel notification with DB-persisted cancel state and retry
- [ ] **Phase 30: Dashboard CRUD** - list, create, edit, and cancel scheduled messages from the dashboard
- [ ] **Phase 31: Voice and AI Content Types** - ElevenLabs TTS and Gemini generation at fire time
- [ ] **Phase 32: Recurring Schedules** - daily/weekly/monthly cron recurrence with DST-safe next-fire computation

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
**Plans:** 1/2 plans executed
Plans:
- [ ] 28-01-PLAN.md — Window query + timer engine (scheduledMessageScheduler.ts)
- [ ] 28-02-PLAN.md — Service layer, retry/recovery, and index.ts wiring

### Phase 29: Pre-Send Safety
**Goal**: The owner receives a self-chat warning before every scheduled send and can cancel it, even if PM2 restarts between the warning and the send
**Depends on**: Phase 28
**Requirements**: SAFE-01, SAFE-02, SAFE-03
**Success Criteria** (what must be TRUE):
  1. Before each scheduled send, the bot sends a self-chat notification identifying the recipient, content preview, and cancel instruction
  2. Replying to the notification with the cancel command stops the send
  3. A PM2 reload between the notification and the send does not lose the cancel state (cancel is DB-persisted, not in-memory)
  4. A send that fails is retried automatically up to 3 times via the hourly scan, with failure status visible in the DB
**Plans**: TBD

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
**Plans**: TBD

### Phase 31: Voice and AI Content Types
**Goal**: The owner can schedule voice notes and AI-generated messages, with content resolved at fire time rather than schedule time
**Depends on**: Phase 30
**Requirements**: TYPE-02, TYPE-03
**Success Criteria** (what must be TRUE):
  1. A scheduled message with type=voice generates a voice note via ElevenLabs TTS at fire time and delivers it as a PTT audio message
  2. A scheduled message with type=ai generates content via Gemini from the owner's prompt at fire time, using the contact's style context
  3. A TTS or Gemini timeout does not permanently block the fire callback (Promise.race with 30s limit)
  4. Concurrent TTS fires do not exceed ElevenLabs concurrency limits (p-queue with concurrency:1)
**Plans**: TBD

### Phase 32: Recurring Schedules
**Goal**: The owner can schedule daily, weekly, or monthly recurring messages that re-arm automatically after each fire and survive DST transitions without drifting
**Depends on**: Phase 31
**Requirements**: SCHED-05
**Success Criteria** (what must be TRUE):
  1. A recurring scheduled message re-fires on the correct cadence (daily, weekly, or monthly) after each send
  2. The schedule does not drift by an hour across Israel's daylight saving time transitions in March and October
  3. If the bot is down during a recurring fire, the next occurrence is computed correctly on startup
  4. The owner can cancel a recurring series from the dashboard and all future fires stop
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 27 → 28 → 29 → 30 → 31 → 32

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
| 27. DB Foundation | 2/2 | Complete    | 2026-03-30 | - |
| 28. Core Scheduler and Text Delivery | 1/2 | In Progress|  | - |
| 29. Pre-Send Safety | v1.6 | 0/? | Not started | - |
| 30. Dashboard CRUD | v1.6 | 0/? | Not started | - |
| 31. Voice and AI Content Types | v1.6 | 0/? | Not started | - |
| 32. Recurring Schedules | v1.6 | 0/? | Not started | - |
