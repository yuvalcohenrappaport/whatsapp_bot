# Roadmap: WhatsApp Bot

## Milestones

- [x] **v1.0 Foundation** — Phases 1-3 (shipped 2026-02-22) — [archive](milestones/v1.1-ROADMAP.md)
- [x] **v1.1 Dashboard & Groups** — Phases 6-9 (shipped 2026-02-24) — [archive](milestones/v1.1-ROADMAP.md)
- [x] **v1.2 Group Auto-Response** — Phases 10-11 (shipped 2026-02-25) — [archive](milestones/v1.2-ROADMAP.md)
- [x] **v1.3 Voice Responses** — Phases 12-16 (shipped 2026-03-02)
- [x] **v1.4 Travel Agent** — Phases 17-21 (shipped 2026-03-02) — [archive](milestones/v1.4-ROADMAP.md)
- [ ] **v1.5 Personal Assistant** — Phases 22-26 (in progress)

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

### v1.5 Personal Assistant (In Progress)

**Milestone Goal:** Turn the bot into a daily personal assistant that detects events, reminders, and tasks from all chats and manages them automatically.

- [x] **Phase 22: Calendar Detection Refactor** - Extract shared CalendarDetectionService from group pipeline
- [x] **Phase 23: Universal Calendar Detection** - Detect and create calendar events from all chats
- [x] **Phase 24: Smart Reminders** - Reminder scheduling via commands, WhatsApp messages, and calendar events (completed 2026-03-16)
- [x] **Phase 25: Commitment Detection** - AI-powered extraction of commitments from private chats (completed 2026-03-16)
- [x] **Phase 26: Microsoft To Do Sync** - OAuth flow and task creation via Graph API (completed 2026-03-16)

## Phase Details

### Phase 22: Calendar Detection Refactor
**Goal**: Date extraction logic is a reusable shared module callable from both private and group message pipelines
**Depends on**: Phase 21 (v1.4 complete)
**Requirements**: CAL-05
**Success Criteria** (what must be TRUE):
  1. CalendarDetectionService exists as a standalone module separate from groupMessagePipeline.ts
  2. Group chat date extraction still works identically after the refactor (no behavior change)
  3. The shared service can be called from any message handler with a message text and source context
**Plans:** 2/2 plans complete
- [x] 22-01-PLAN.md -- Extract CalendarDetectionService and break circular dependencies
- [x] 22-02-PLAN.md -- Personal calendar OAuth2 infrastructure

### Phase 23: Universal Calendar Detection
**Goal**: Users get calendar event proposals from messages in any chat -- private or group -- with suggest-then-confirm flow
**Depends on**: Phase 22
**Requirements**: CAL-01, CAL-02, CAL-03, CAL-04, CAL-06
**Success Criteria** (what must be TRUE):
  1. When a private chat message mentions a date/event, the bot proposes it in the owner's self-chat
  2. When a group chat message mentions a date/event, the bot proposes it via the existing suggest-then-confirm flow
  3. Confirming a proposed event creates a Google Calendar entry with title, date/time, and source context
  4. Forwarding the same message to multiple chats does not create duplicate calendar events
  5. Messages without date/event content are filtered cheaply in JS before any Gemini API call
**Plans:** 3/3 plans complete
- [x] 23-01-PLAN.md -- Detection pipeline, dedup, schema, all-day events
- [x] 23-02-PLAN.md -- Self-chat approval flow (notifications + reply-based approve/reject/edit)
- [x] 23-03-PLAN.md -- Dashboard events UI with tabs and overview integration

### Phase 24: Smart Reminders
**Goal**: Users can set reminders via WhatsApp commands and receive them as messages or calendar events at the right time
**Depends on**: Phase 22
**Requirements**: REM-01, REM-03, REM-04, REM-05, REM-06
**Success Criteria** (what must be TRUE):
  1. User can send "remind me to X at Y" to the bot and get a confirmation that the reminder is set
  2. Quick reminders are delivered as WhatsApp messages to the owner's self-chat at the scheduled time
  3. Time-specific reminders create Google Calendar events with notifications
  4. Reminders survive a bot restart and fire at the correct time after recovery
  5. Near-term reminders (<24h) use precise setTimeout; distant reminders are picked up by periodic DB scan
**Plans:** 3/3 plans complete
- [x] 24-01-PLAN.md -- Core backend: DB schema, Gemini parser, two-tier scheduler, handleOwnerCommand wiring
- [x] 24-02-PLAN.md -- Smart delivery routing, restart recovery, cancel/edit commands
- [x] 24-03-PLAN.md -- Dashboard API routes and Reminders page with tabs

### Phase 25: Commitment Detection
**Goal**: The bot detects commitments in private conversations and proactively suggests follow-up reminders
**Depends on**: Phase 24
**Requirements**: REM-02
**Success Criteria** (what must be TRUE):
  1. When the owner says "I'll send it tomorrow" in a private chat, the bot suggests a follow-up reminder in self-chat
  2. Commitment detection uses a JS pre-filter (message length, temporal markers, action verbs) to avoid unnecessary Gemini calls
  3. Detected commitments propose reminders through the existing reminder service from Phase 24
**Plans:** 2/2 plans complete
- [ ] 25-01-PLAN.md -- DB migration, CommitmentDetectionService with pre-filter and Gemini extraction
- [ ] 25-02-PLAN.md -- Pipeline integration, auto-set reminders, self-chat notifications

### Phase 26: Microsoft To Do Sync
**Goal**: Actionable tasks detected in private chats are synced to Microsoft To Do for cross-device access
**Depends on**: Phase 23
**Requirements**: TODO-01, TODO-02, TODO-03, TODO-04, TODO-05
**Success Criteria** (what must be TRUE):
  1. User can authorize the bot to access Microsoft To Do via OAuth2 flow initiated from the dashboard
  2. When a private chat message contains an actionable task, the bot proposes it in self-chat with suggest-then-confirm
  3. Confirming a detected task creates it in Microsoft To Do via Graph API
  4. The OAuth refresh token is persisted and auto-renewed so the user does not need to re-authorize
  5. If Microsoft auth is not configured, the bot operates normally without To Do features (graceful degradation)
**Plans:** 3/3 plans complete
- [x] 26-01-PLAN.md -- MSAL auth service, Graph API service, DB schema, API routes
- [ ] 26-02-PLAN.md -- Extend Gemini schema for task classification, To Do pipeline, cancel handler
- [x] 26-03-PLAN.md -- Dashboard Integrations and Tasks pages

## Progress

**Execution Order:**
Phases execute in numeric order: 22 -> 23 -> 24 -> 25 -> 26

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
| 22. Calendar Detection Refactor | v1.5 | Complete    | 2026-03-16 | 2026-03-16 |
| 23. Universal Calendar Detection | v1.5 | Complete    | 2026-03-16 | 2026-03-16 |
| 24. Smart Reminders | 3/3 | Complete    | 2026-03-16 | - |
| 25. Commitment Detection | 2/2 | Complete    | 2026-03-16 | - |
| 26. Microsoft To Do Sync | 3/3 | Complete   | 2026-03-16 | - |
